import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "node:module";
import * as XLSX from "xlsx";

// Alias `@/`, `.tsx` e `.css` non li carica Node da solo: vedi tests/support.
register("./support/aliasLoader.mjs", import.meta.url);

const { getPhotoConsentBadges, needsPhotoConsentQuestion } = await import(
  "../src/utils/parentAuthorization.ts"
);
const { downloadRegistrationsExcel, EXCEL_EXPORT_FIELDS } = await import(
  "../src/utils/registrationExcel.ts"
);
const { consentChoiceFromDecision, getConsentChoicesProblem, CONSENT_MISSING_MESSAGE, CONSENT_SOCIAL_NEEDS_PHOTO_MESSAGE } =
  await import("../src/components/ConsentChoices.tsx");

function yearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  date.setDate(date.getDate() - 7); // il compleanno è già passato
  return date.toISOString().slice(0, 10);
}

const MINOR = yearsAgo(14);
const ADULT = yearsAgo(30);

function registration({ birthDate = MINOR, authorization, answers = {}, name = "Mario" } = {}) {
  return {
    id: name,
    firstName: name,
    lastName: "Rossi",
    fullName: `${name} Rossi`,
    birthDate,
    genderRoleCategory: "giovane_uomo",
    registrationStatus: "active",
    submittedByMode: "authenticated",
    answers,
    parentAuthorization: authorization === undefined ? null : authorization,
  };
}

const signed = (photoConsent, socialPublicationConsent, status = "authorized") => ({
  status,
  photoConsent,
  socialPublicationConsent,
});

const PHOTO = {
  accepted: { label: "Foto: sì", tone: "success" },
  refused: { label: "Foto: no", tone: "neutral" },
  not_answered: { label: "Foto: da chiedere", tone: "warning" },
  revoked: { label: "Foto: revocato", tone: "danger" },
};
const SOCIAL = {
  accepted: { label: "Social: sì", tone: "success" },
  refused: { label: "Social: no", tone: "neutral" },
  not_answered: { label: "Social: da chiedere", tone: "warning" },
  revoked: { label: "Social: revocato", tone: "danger" },
};

// --- pill -----------------------------------------------------------------

for (const value of ["accepted", "refused", "revoked", "not_answered"]) {
  test(`pill foto con photoConsent "${value}"`, () => {
    const badges = getPhotoConsentBadges(
      registration({ authorization: signed(value, "accepted") }),
    );
    assert.deepEqual(badges.photo, PHOTO[value]);
  });

  test(`pill social con socialPublicationConsent "${value}"`, () => {
    const badges = getPhotoConsentBadges(
      registration({ authorization: signed("accepted", value) }),
    );
    assert.deepEqual(badges.social, SOCIAL[value]);
  });
}

test("valore assente (firma vecchia) vale come da chiedere, per foto e social", () => {
  const badges = getPhotoConsentBadges(
    registration({ authorization: { status: "authorized" } }),
  );
  assert.deepEqual(badges.photo, PHOTO.not_answered);
  assert.deepEqual(badges.social, SOCIAL.not_answered);
});

test("foto e social sono indipendenti nella stessa iscrizione", () => {
  const badges = getPhotoConsentBadges(
    registration({ authorization: signed("accepted", "revoked") }),
  );
  assert.deepEqual(badges, { photo: PHOTO.accepted, social: SOCIAL.revoked });
});

test("minore con autorizzazione revocata mostra le scelte revocate", () => {
  const badges = getPhotoConsentBadges(
    registration({ authorization: signed("revoked", "revoked", "revoked") }),
  );
  assert.deepEqual(badges, { photo: PHOTO.revoked, social: SOCIAL.revoked });
});

test("minore non firmato: foto e social da chiedere", () => {
  for (const authorization of [
    null,
    { status: "pending_parent_authorization" },
    { status: "email_sent" },
    { status: "expired" },
    { status: "email_error" },
    { status: "rejected_by_parent", photoConsent: "accepted", socialPublicationConsent: "accepted" },
  ]) {
    const badges = getPhotoConsentBadges(registration({ authorization }));
    assert.deepEqual(
      badges,
      { photo: PHOTO.not_answered, social: SOCIAL.not_answered },
      `stato ${authorization?.status ?? "nessuna autorizzazione"}`,
    );
  }
});

test("minore con autorizzazione rifiutata dal genitore: sempre le due pill, da chiedere", () => {
  const badges = getPhotoConsentBadges(
    registration({ authorization: { status: "rejected_by_parent", photoConsent: "accepted" } }),
  );
  assert.deepEqual(badges, { photo: PHOTO.not_answered, social: SOCIAL.not_answered });
  assert.equal(badges.photo.tone, "warning");
  assert.equal(badges.social.tone, "warning");
});

test("social sì con foto diversa da sì (firma incoerente): social da chiedere, foto invariata", () => {
  for (const photo of ["not_answered", "refused", "revoked"]) {
    const badges = getPhotoConsentBadges(
      registration({ authorization: signed(photo, "accepted") }),
    );
    assert.deepEqual(badges.photo, PHOTO[photo], `foto ${photo}`);
    assert.deepEqual(badges.social, SOCIAL.not_answered, `social con foto ${photo}`);
    assert.equal(badges.social.tone, "warning");
  }
  // Vale anche con firma revocata, e foto assente.
  assert.deepEqual(
    getPhotoConsentBadges(registration({ authorization: signed("revoked", "accepted", "revoked") })).social,
    SOCIAL.not_answered,
  );
  assert.deepEqual(
    getPhotoConsentBadges(
      registration({ authorization: { status: "authorized", socialPublicationConsent: "accepted" } }),
    ).social,
    SOCIAL.not_answered,
  );
});

test("social sì con foto sì: invariato, sì", () => {
  const badges = getPhotoConsentBadges(registration({ authorization: signed("accepted", "accepted") }));
  assert.deepEqual(badges, { photo: PHOTO.accepted, social: SOCIAL.accepted });
});

test("l'incoerenza vale solo per il social sì: gli altri valori social non cambiano", () => {
  for (const social of ["refused", "revoked", "not_answered"]) {
    for (const photo of ["accepted", "refused", "revoked", "not_answered"]) {
      const badges = getPhotoConsentBadges(registration({ authorization: signed(photo, social) }));
      assert.deepEqual(badges.social, SOCIAL[social], `social ${social} con foto ${photo}`);
    }
  }
});

test("adulto senza parentAuthorization: nessuna pill", () => {
  assert.equal(getPhotoConsentBadges(registration({ birthDate: ADULT })), null);
  assert.equal(
    getPhotoConsentBadges(registration({ birthDate: ADULT, authorization: { status: "pending_parent_authorization" } })),
    null,
  );
});

test("la data di nascita mancante non fa passare per minorenne", () => {
  assert.equal(getPhotoConsentBadges(registration({ birthDate: "" })), null);
});

test("per un minore la pill non dipende dalla spunta del modulo", () => {
  const withTick = registration({
    answers: { photoInternalConsent: true, photoPublicConsent: true },
    authorization: signed("not_answered", "not_answered"),
  });
  assert.deepEqual(getPhotoConsentBadges(withTick), {
    photo: PHOTO.not_answered,
    social: SOCIAL.not_answered,
  });

  const withoutTick = registration({
    answers: { photoInternalConsent: false, photoPublicConsent: false },
    authorization: signed("accepted", "accepted"),
  });
  assert.deepEqual(getPhotoConsentBadges(withoutTick), {
    photo: PHOTO.accepted,
    social: SOCIAL.accepted,
  });

  // Stesso risultato con o senza spunta.
  const noAnswers = registration({ authorization: signed("accepted", "accepted") });
  assert.deepEqual(getPhotoConsentBadges(withoutTick), getPhotoConsentBadges(noAnswers));
});

test("minore non firmato con spunta true resta da chiedere", () => {
  const badges = getPhotoConsentBadges(
    registration({ answers: { photoInternalConsent: true, photoPublicConsent: true } }),
  );
  assert.equal(badges.photo.label, "Foto: da chiedere");
  assert.equal(badges.social.label, "Social: da chiedere");
});

test("needsPhotoConsentQuestion", () => {
  assert.equal(needsPhotoConsentQuestion(registration()), true, "minore non firmato");
  assert.equal(
    needsPhotoConsentQuestion(registration({ authorization: signed("accepted", "not_answered") })),
    true,
    "manca solo il social",
  );
  assert.equal(
    needsPhotoConsentQuestion(registration({ authorization: signed("not_answered", "refused") })),
    true,
    "manca solo la foto",
  );
  assert.equal(
    needsPhotoConsentQuestion(registration({ authorization: signed("accepted", "accepted") })),
    false,
  );
  assert.equal(
    needsPhotoConsentQuestion(registration({ authorization: signed("refused", "refused") })),
    false,
    "un no è una risposta",
  );
  assert.equal(
    needsPhotoConsentQuestion(registration({ authorization: signed("revoked", "revoked", "revoked") })),
    false,
    "revocato non è da chiedere",
  );
  assert.equal(needsPhotoConsentQuestion(registration({ birthDate: ADULT })), false);
  assert.equal(
    needsPhotoConsentQuestion(registration({ authorization: { status: "rejected_by_parent" } })),
    true,
    "rifiutata dal genitore: da chiedere",
  );
  for (const photo of ["not_answered", "refused", "revoked"]) {
    assert.equal(
      needsPhotoConsentQuestion(registration({ authorization: signed(photo, "accepted") })),
      true,
      `social sì con foto ${photo}`,
    );
  }
});

// --- Excel ----------------------------------------------------------------

async function exportSheet(registrations, fields) {
  const previous = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), "photo-consent-"));
  try {
    process.chdir(dir);
    await downloadRegistrationsExcel("evento", registrations, { fields, includeOverallSheet: true });
    const workbook = XLSX.read(readFileSync(path.join(dir, "evento.xlsx")));
    return XLSX.utils.sheet_to_json(workbook.Sheets["Elenco generale"], { defval: "" });
  } finally {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("le due colonne nuove sono nella lista dei campi esportabili, nel gruppo consensi", () => {
  const byKey = Object.fromEntries(EXCEL_EXPORT_FIELDS.map((field) => [field.key, field]));
  assert.equal(byKey.parentPhotoConsent.label, "Foto (genitore)");
  assert.equal(byKey.parentSocialConsent.label, "Social (genitore)");
  assert.equal(byKey.parentPhotoConsent.group, "consensi");
  assert.equal(byKey.parentSocialConsent.group, "consensi");
  assert.equal(byKey.photoInternalConsent.label, "Foto uso interno");
  assert.equal(byKey.photoPublicConsent.label, "Foto uso pubblico");
});

test("Excel: celle Sì / No / Revocato / Da chiedere, vuote solo per gli adulti", async () => {
  const rows = await exportSheet(
    [
      registration({ name: "A", authorization: signed("accepted", "accepted") }),
      registration({ name: "B", authorization: signed("refused", "refused") }),
      registration({ name: "C", authorization: signed("revoked", "revoked", "revoked") }),
      registration({ name: "D", authorization: signed("not_answered", "not_answered") }),
      registration({ name: "E", authorization: null }),
      registration({ name: "F", authorization: { status: "rejected_by_parent" } }),
      registration({ name: "G", birthDate: ADULT }),
      registration({ name: "H", authorization: signed("refused", "accepted") }),
      registration({ name: "I", authorization: signed("not_answered", "accepted") }),
      registration({ name: "J", authorization: signed("revoked", "accepted", "revoked") }),
      registration({ name: "K", authorization: signed("accepted", "accepted") }),
    ],
    ["fullName", "parentPhotoConsent", "parentSocialConsent"],
  );
  const get = (name) => {
    const row = rows.find((candidate) => String(Object.values(candidate)[0]).startsWith(name));
    return [row["Foto (genitore)"], row["Social (genitore)"]];
  };

  assert.deepEqual(get("A "), ["Sì", "Sì"]);
  assert.deepEqual(get("B "), ["No", "No"]);
  assert.deepEqual(get("C "), ["Revocato", "Revocato"]);
  assert.deepEqual(get("D "), ["Da chiedere", "Da chiedere"]);
  assert.deepEqual(get("E "), ["Da chiedere", "Da chiedere"]);
  assert.deepEqual(get("F "), ["Da chiedere", "Da chiedere"]);
  assert.deepEqual(get("G "), ["", ""]);
  // Social sì con foto diversa da sì: social "Da chiedere", foto invariata.
  assert.deepEqual(get("H "), ["No", "Da chiedere"]);
  assert.deepEqual(get("I "), ["Da chiedere", "Da chiedere"]);
  assert.deepEqual(get("J "), ["Revocato", "Da chiedere"]);
  assert.deepEqual(get("K "), ["Sì", "Sì"]);
});

test("Excel: foto e social possono avere esiti diversi", async () => {
  const rows = await exportSheet(
    [registration({ name: "A", authorization: signed("accepted", "refused") })],
    ["parentPhotoConsent", "parentSocialConsent"],
  );
  assert.deepEqual(rows, [{ "Foto (genitore)": "Sì", "Social (genitore)": "No" }]);
});

const LEGACY_AND_PARENT = [
  "fullName",
  "photoInternalConsent",
  "photoPublicConsent",
  "parentPhotoConsent",
  "parentSocialConsent",
];

async function exportByName(registrations) {
  const rows = await exportSheet(registrations, LEGACY_AND_PARENT);
  return Object.fromEntries(
    rows.map((row) => [
      String(Object.values(row)[0]).split(" ")[0],
      [row["Foto uso interno"], row["Foto uso pubblico"], row["Foto (genitore)"], row["Social (genitore)"]],
    ]),
  );
}

const TICKED = { photoInternalConsent: true, photoPublicConsent: true };
const UNTICKED = { photoInternalConsent: false, photoPublicConsent: false };

test("Excel: le colonne Foto uso interno/pubblico (spunte del modulo) sono vuote quando c'è la pill", async () => {
  const cells = await exportByName([
    registration({ name: "A", answers: TICKED, authorization: signed("revoked", "revoked", "revoked") }),
    registration({ name: "B", answers: TICKED, authorization: signed("accepted", "accepted") }),
    registration({ name: "C", answers: TICKED }),
    registration({ name: "D", answers: TICKED, authorization: { status: "rejected_by_parent" } }),
    registration({ name: "E", answers: UNTICKED, authorization: signed("accepted", "accepted") }),
    registration({ name: "F", birthDate: ADULT, answers: TICKED, authorization: signed("accepted", "refused") }),
  ]);
  // Minore con spunta true e consenso revocato.
  assert.deepEqual(cells.A, ["", "", "Revocato", "Revocato"]);
  // Minore firmato: conta solo la scelta del genitore.
  assert.deepEqual(cells.B, ["", "", "Sì", "Sì"]);
  // Minore non firmato e minore rifiutato dal genitore: spunta ignorata.
  assert.deepEqual(cells.C, ["", "", "Da chiedere", "Da chiedere"]);
  assert.deepEqual(cells.D, ["", "", "Da chiedere", "Da chiedere"]);
  // Spunta false e consenso sì: legacy vuote comunque.
  assert.deepEqual(cells.E, ["", "", "Sì", "Sì"]);
  // Chiunque abbia le pill, anche un adulto con firma del genitore.
  assert.deepEqual(cells.F, ["", "", "Sì", "No"]);
});

test("Excel: adulto senza firma, spunte del modulo invariate (Sì/No) e colonne genitore vuote", async () => {
  const cells = await exportByName([
    registration({ name: "A", birthDate: ADULT, answers: TICKED }),
    registration({ name: "B", birthDate: ADULT, answers: UNTICKED }),
    registration({
      name: "C",
      birthDate: ADULT,
      answers: { photoInternalConsent: true, photoPublicConsent: false },
    }),
    registration({
      name: "D",
      birthDate: ADULT,
      answers: { photoInternalConsent: false, photoPublicConsent: true },
      authorization: { status: "pending_parent_authorization" },
    }),
    registration({ name: "E", birthDate: ADULT }),
  ]);
  assert.deepEqual(cells.A, ["Sì", "Sì", "", ""]);
  assert.deepEqual(cells.B, ["No", "No", "", ""]);
  assert.deepEqual(cells.C, ["Sì", "No", "", ""]);
  assert.deepEqual(cells.D, ["No", "Sì", "", ""]);
  assert.deepEqual(cells.E, ["", "", "", ""]);
});

// --- ConsentChoices -------------------------------------------------------

test("getConsentChoicesProblem: manca una risposta", () => {
  assert.equal(getConsentChoicesProblem(null, null), CONSENT_MISSING_MESSAGE);
  assert.equal(getConsentChoicesProblem("accepted", null), CONSENT_MISSING_MESSAGE);
  assert.equal(getConsentChoicesProblem(null, "refused"), CONSENT_MISSING_MESSAGE);
  assert.equal(getConsentChoicesProblem(null, "accepted"), CONSENT_MISSING_MESSAGE);
});

test("getConsentChoicesProblem: social sì con foto no", () => {
  assert.equal(
    getConsentChoicesProblem("refused", "accepted"),
    CONSENT_SOCIAL_NEEDS_PHOTO_MESSAGE,
  );
});

test("getConsentChoicesProblem: combinazioni valide", () => {
  assert.equal(getConsentChoicesProblem("accepted", "accepted"), null);
  assert.equal(getConsentChoicesProblem("accepted", "refused"), null);
  assert.equal(getConsentChoicesProblem("refused", "refused"), null);
});

test("consentChoiceFromDecision", () => {
  assert.equal(consentChoiceFromDecision("accepted"), "accepted");
  assert.equal(consentChoiceFromDecision("not_answered"), null);
  assert.equal(consentChoiceFromDecision("refused"), "refused");
  assert.equal(consentChoiceFromDecision("revoked"), "refused");
  assert.equal(consentChoiceFromDecision(undefined), null);
  assert.equal(consentChoiceFromDecision(null), null);
});
