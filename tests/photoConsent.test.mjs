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
  ]) {
    const badges = getPhotoConsentBadges(registration({ authorization }));
    assert.deepEqual(
      badges,
      { photo: PHOTO.not_answered, social: SOCIAL.not_answered },
      `stato ${authorization?.status ?? "nessuna autorizzazione"}`,
    );
  }
});

test("minore con autorizzazione rifiutata dal genitore: nessuna pill", () => {
  assert.equal(
    getPhotoConsentBadges(
      registration({ authorization: { status: "rejected_by_parent", photoConsent: "accepted" } }),
    ),
    null,
  );
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
    false,
  );
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

test("Excel: celle Sì / No / Revocato / Da chiedere, vuote per gli adulti", async () => {
  const rows = await exportSheet(
    [
      registration({ name: "A", authorization: signed("accepted", "accepted") }),
      registration({ name: "B", authorization: signed("refused", "refused") }),
      registration({ name: "C", authorization: signed("revoked", "revoked", "revoked") }),
      registration({ name: "D", authorization: signed("not_answered", "not_answered") }),
      registration({ name: "E", authorization: null }),
      registration({ name: "F", authorization: { status: "rejected_by_parent" } }),
      registration({ name: "G", birthDate: ADULT }),
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
  assert.deepEqual(get("F "), ["", ""]);
  assert.deepEqual(get("G "), ["", ""]);
});

test("Excel: foto e social possono avere esiti diversi", async () => {
  const rows = await exportSheet(
    [registration({ name: "A", authorization: signed("accepted", "refused") })],
    ["parentPhotoConsent", "parentSocialConsent"],
  );
  assert.deepEqual(rows, [{ "Foto (genitore)": "Sì", "Social (genitore)": "No" }]);
});

test("Excel: le colonne Foto uso interno/pubblico restano quelle del modulo", async () => {
  const rows = await exportSheet(
    [
      registration({
        name: "A",
        answers: { photoInternalConsent: true, photoPublicConsent: false },
        authorization: signed("not_answered", "revoked", "revoked"),
      }),
      registration({ name: "B", birthDate: ADULT, answers: { photoInternalConsent: false, photoPublicConsent: true } }),
      registration({ name: "C", birthDate: ADULT }),
    ],
    ["photoInternalConsent", "photoPublicConsent", "parentPhotoConsent", "parentSocialConsent"],
  );
  assert.deepEqual(rows, [
    {
      "Foto uso interno": "Sì",
      "Foto uso pubblico": "No",
      "Foto (genitore)": "Da chiedere",
      "Social (genitore)": "Revocato",
    },
    { "Foto uso interno": "No", "Foto uso pubblico": "Sì", "Foto (genitore)": "", "Social (genitore)": "" },
    { "Foto uso interno": "", "Foto uso pubblico": "", "Foto (genitore)": "", "Social (genitore)": "" },
  ]);
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
