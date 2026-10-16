// Logica pura dei consensi foto e social (functions/lib/consentCore.js): nessun
// emulatore, nessun accesso a Firestore.
// Rilancio dalla radice del repository:
//   node --test functions/tests/consentCore.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CHOICE_REQUIRED_MESSAGE,
  CONSENT_LINK_TTL_DAYS,
  CONSENT_TEXT_VERSION,
  SOCIAL_NEEDS_PHOTO_MESSAGE,
  computeConsentLinkExpiry,
  consentLabel,
  deriveConsentLinkStatus,
  hashLinkToken,
  isUnanswered,
  nextStoredValue,
  resolveConsentUpdate,
  validateConsentChoices,
} = require("../lib/consentCore.js");

const REQUIRED = "Scegli una risposta per le foto e per i social";
const NEEDS_PHOTO = "Per pubblicare sui social serve anche il consenso alle foto";

function expectInvalid(fn, message, reason) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, "invalid-argument");
    assert.equal(error.message, message);
    assert.deepEqual(error.details, { reason });
    return true;
  });
}

// -----------------------------------------------------------------------------
// validateConsentChoices
// -----------------------------------------------------------------------------

test("i messaggi esportati sono quelli concordati con il client", () => {
  assert.equal(CHOICE_REQUIRED_MESSAGE, REQUIRED);
  assert.equal(SOCIAL_NEEDS_PHOTO_MESSAGE, NEEDS_PHOTO);
  assert.match(CONSENT_TEXT_VERSION, /^v\d+-\d{4}-\d{2}$/u);
});

test("le quattro combinazioni di risposte valide: solo social sì con foto no è respinta", () => {
  assert.deepEqual(validateConsentChoices("accepted", "accepted"), {
    photoConsent: "accepted",
    socialPublicationConsent: "accepted",
  });
  assert.deepEqual(validateConsentChoices("accepted", "refused"), {
    photoConsent: "accepted",
    socialPublicationConsent: "refused",
  });
  assert.deepEqual(validateConsentChoices("refused", "refused"), {
    photoConsent: "refused",
    socialPublicationConsent: "refused",
  });
  expectInvalid(() => validateConsentChoices("refused", "accepted"), NEEDS_PHOTO, "social_needs_photo");
});

test("risposte mancanti, not_answered, revoked e valori strani danno consent_required", () => {
  const strange = [
    undefined,
    null,
    "",
    " ",
    "not_answered",
    "revoked",
    "Accepted",
    "ACCEPTED",
    " accepted",
    "accepted ",
    "refused\n",
    "true",
    "yes",
    "si",
    "sì",
    "<script>alert(1)</script>",
    "accepted; refused",
    true,
    false,
    0,
    1,
    [],
    ["accepted"],
    {},
    { value: "accepted" },
  ];
  for (const value of strange) {
    expectInvalid(() => validateConsentChoices(value, "accepted"), REQUIRED, "consent_required");
    expectInvalid(() => validateConsentChoices("accepted", value), REQUIRED, "consent_required");
    expectInvalid(() => validateConsentChoices(value, value), REQUIRED, "consent_required");
  }
  expectInvalid(() => validateConsentChoices(), REQUIRED, "consent_required");
});

test("risposta mancante ha la precedenza sull'incoerenza social senza foto", () => {
  // Foto non valida con social accepted: il client deve prima scegliere, non vedere "serve il consenso foto".
  expectInvalid(() => validateConsentChoices("not_answered", "accepted"), REQUIRED, "consent_required");
  expectInvalid(() => validateConsentChoices(undefined, "accepted"), REQUIRED, "consent_required");
  expectInvalid(() => validateConsentChoices("revoked", "accepted"), REQUIRED, "consent_required");
});

// -----------------------------------------------------------------------------
// nextStoredValue
// -----------------------------------------------------------------------------

test("nextStoredValue: matrice precedente x scelta", () => {
  const expected = {
    accepted: { accepted: "accepted", refused: "revoked" },
    refused: { accepted: "accepted", refused: "refused" },
    revoked: { accepted: "accepted", refused: "revoked" },
    not_answered: { accepted: "accepted", refused: "refused" },
  };
  for (const [previous, byChoice] of Object.entries(expected)) {
    for (const [choice, value] of Object.entries(byChoice)) {
      assert.equal(nextStoredValue(previous, choice), value, `${previous} + ${choice}`);
    }
  }
});

test("nextStoredValue: un precedente assente o sconosciuto vale not_answered", () => {
  for (const previous of [undefined, null, "", "boh", 3]) {
    assert.equal(nextStoredValue(previous, "refused"), "refused");
    assert.equal(nextStoredValue(previous, "accepted"), "accepted");
  }
});

// -----------------------------------------------------------------------------
// resolveConsentUpdate
// -----------------------------------------------------------------------------

function state(photo, social) {
  return { photoConsent: photo, socialPublicationConsent: social };
}

function choose(photoConsent, socialPublicationConsent) {
  return { photoConsent, socialPublicationConsent };
}

test("resolveConsentUpdate: accepted -> refused è una revoca, con flag e valori precedenti", () => {
  const result = resolveConsentUpdate(state("accepted", "accepted"), choose("refused", "refused"));
  assert.deepEqual(result, {
    photoConsent: "revoked",
    socialPublicationConsent: "revoked",
    previousPhotoConsent: "accepted",
    previousSocialPublicationConsent: "accepted",
    changed: true,
    photoRevoked: true,
    socialRevoked: true,
  });
});

test("resolveConsentUpdate: si revoca solo il social, la foto resta accepted", () => {
  const result = resolveConsentUpdate(state("accepted", "accepted"), choose("accepted", "refused"));
  assert.equal(result.photoConsent, "accepted");
  assert.equal(result.socialPublicationConsent, "revoked");
  assert.equal(result.changed, true);
  assert.equal(result.photoRevoked, false);
  assert.equal(result.socialRevoked, true);
});

test("resolveConsentUpdate: revoked -> refused resta revoked e non cambia nulla", () => {
  const result = resolveConsentUpdate(state("revoked", "revoked"), choose("refused", "refused"));
  assert.equal(result.photoConsent, "revoked");
  assert.equal(result.socialPublicationConsent, "revoked");
  assert.equal(result.previousPhotoConsent, "revoked");
  assert.equal(result.changed, false);
  assert.equal(result.photoRevoked, false, "la revoca era già avvenuta: niente nuovo compito");
  assert.equal(result.socialRevoked, false);
});

test("resolveConsentUpdate: not_answered -> refused diventa refused, non revoked", () => {
  for (const existing of [state("not_answered", "not_answered"), state(undefined, undefined), {}, null, undefined]) {
    const result = resolveConsentUpdate(existing, choose("refused", "refused"));
    assert.equal(result.photoConsent, "refused");
    assert.equal(result.socialPublicationConsent, "refused");
    assert.equal(result.previousPhotoConsent, "not_answered");
    assert.equal(result.previousSocialPublicationConsent, "not_answered");
    assert.equal(result.changed, true, "da nessuna risposta a un no esplicito è un cambio");
    assert.equal(result.photoRevoked, false);
    assert.equal(result.socialRevoked, false);
  }
});

test("resolveConsentUpdate: not_answered -> accepted", () => {
  const result = resolveConsentUpdate(state(undefined, undefined), choose("accepted", "accepted"));
  assert.equal(result.photoConsent, "accepted");
  assert.equal(result.socialPublicationConsent, "accepted");
  assert.equal(result.changed, true);
  assert.equal(result.photoRevoked, false);
  assert.equal(result.socialRevoked, false);
});

test("resolveConsentUpdate: refused -> accepted e revoked -> accepted ridanno il consenso", () => {
  for (const previous of ["refused", "revoked"]) {
    const result = resolveConsentUpdate(state(previous, previous), choose("accepted", "accepted"));
    assert.equal(result.photoConsent, "accepted");
    assert.equal(result.socialPublicationConsent, "accepted");
    assert.equal(result.changed, true);
    assert.equal(result.photoRevoked, false);
    assert.equal(result.socialRevoked, false);
  }
});

test("resolveConsentUpdate: idempotenza, lo stesso valore due volte non cambia nulla", () => {
  const scelte = [choose("accepted", "accepted"), choose("accepted", "refused"), choose("refused", "refused")];
  for (const scelta of scelte) {
    const first = resolveConsentUpdate(state("not_answered", "not_answered"), scelta);
    const second = resolveConsentUpdate(
      state(first.photoConsent, first.socialPublicationConsent),
      scelta,
    );
    assert.equal(second.changed, false, JSON.stringify(scelta));
    assert.equal(second.photoRevoked, false);
    assert.equal(second.socialRevoked, false);
    assert.equal(second.photoConsent, first.photoConsent);
    assert.equal(second.socialPublicationConsent, first.socialPublicationConsent);
  }
  // Dopo una revoca, ripetere "non acconsento" non è un nuovo cambio.
  const revoked = resolveConsentUpdate(state("accepted", "accepted"), choose("refused", "refused"));
  const again = resolveConsentUpdate(
    state(revoked.photoConsent, revoked.socialPublicationConsent),
    choose("refused", "refused"),
  );
  assert.equal(again.changed, false);
  assert.equal(again.photoRevoked, false);
  assert.equal(again.socialRevoked, false);
});

test("resolveConsentUpdate: matrice completa su ogni precedente e ogni scelta valida", () => {
  const previousValues = ["accepted", "refused", "revoked", "not_answered"];
  const choices = [
    ["accepted", "accepted"],
    ["accepted", "refused"],
    ["refused", "refused"],
  ];
  for (const previousPhoto of previousValues) {
    for (const previousSocial of previousValues) {
      for (const [photo, social] of choices) {
        const label = `${previousPhoto}/${previousSocial} -> ${photo}/${social}`;
        const result = resolveConsentUpdate(state(previousPhoto, previousSocial), choose(photo, social));
        const expectedPhoto = nextStoredValue(previousPhoto, photo);
        const expectedSocial = nextStoredValue(previousSocial, social);
        assert.equal(result.photoConsent, expectedPhoto, label);
        assert.equal(result.socialPublicationConsent, expectedSocial, label);
        assert.equal(result.previousPhotoConsent, previousPhoto, label);
        assert.equal(result.previousSocialPublicationConsent, previousSocial, label);
        assert.equal(
          result.changed,
          expectedPhoto !== previousPhoto || expectedSocial !== previousSocial,
          label,
        );
        assert.equal(result.photoRevoked, previousPhoto === "accepted" && photo === "refused", label);
        assert.equal(result.socialRevoked, previousSocial === "accepted" && social === "refused", label);
        // I valori memorizzati sono sempre uno dei quattro: mai la scelta grezza "refused" su un sì precedente.
        assert.ok(previousValues.includes(result.photoConsent), label);
        assert.ok(previousValues.includes(result.socialPublicationConsent), label);
        assert.notEqual(result.photoConsent, "not_answered", label);
      }
    }
  }
});

test("resolveConsentUpdate: un precedente con valore strano vale not_answered", () => {
  const result = resolveConsentUpdate(state("boh", 7), choose("refused", "refused"));
  assert.equal(result.previousPhotoConsent, "not_answered");
  assert.equal(result.previousSocialPublicationConsent, "not_answered");
  assert.equal(result.photoConsent, "refused");
});

test("resolveConsentUpdate: input non valido lancia gli stessi errori del validatore", () => {
  expectInvalid(
    () => resolveConsentUpdate(state("accepted", "accepted"), choose("not_answered", "refused")),
    REQUIRED,
    "consent_required",
  );
  expectInvalid(
    () => resolveConsentUpdate(state("accepted", "accepted"), choose("revoked", "revoked")),
    REQUIRED,
    "consent_required",
  );
  expectInvalid(
    () => resolveConsentUpdate(state("accepted", "accepted"), choose("refused", "accepted")),
    NEEDS_PHOTO,
    "social_needs_photo",
  );
  expectInvalid(() => resolveConsentUpdate(state("accepted", "accepted"), undefined), REQUIRED, "consent_required");
  expectInvalid(() => resolveConsentUpdate(state("accepted", "accepted"), null), REQUIRED, "consent_required");
  expectInvalid(() => resolveConsentUpdate(state("accepted", "accepted"), {}), REQUIRED, "consent_required");
});

test("resolveConsentUpdate non modifica gli oggetti in ingresso", () => {
  const existing = Object.freeze(state("accepted", "accepted"));
  const input = Object.freeze(choose("refused", "refused"));
  assert.doesNotThrow(() => resolveConsentUpdate(existing, input));
});

// -----------------------------------------------------------------------------
// isUnanswered / consentLabel
// -----------------------------------------------------------------------------

test("isUnanswered: solo i valori mancanti o sconosciuti", () => {
  for (const value of [undefined, null, "", "not_answered", "boh", 0]) {
    assert.equal(isUnanswered(value), true, String(value));
  }
  for (const value of ["accepted", "refused", "revoked"]) {
    assert.equal(isUnanswered(value), false, value);
  }
});

test("consentLabel: Acconsento solo per accepted", () => {
  assert.equal(consentLabel("accepted"), "Acconsento");
  for (const value of ["refused", "revoked", "not_answered", undefined, null, "boh"]) {
    assert.equal(consentLabel(value), "Non acconsento", String(value));
  }
});

// -----------------------------------------------------------------------------
// Link di gestione
// -----------------------------------------------------------------------------

test("hashLinkToken è uno sha256 esadecimale deterministico", () => {
  const hash = hashLinkToken("abc");
  assert.equal(hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(hashLinkToken("abc"), hash);
  assert.notEqual(hashLinkToken("abd"), hash);
});

test("computeConsentLinkExpiry aggiunge un anno di giorni al momento dato", () => {
  assert.equal(CONSENT_LINK_TTL_DAYS, 365);
  const now = new Date("2026-10-16T10:00:00.000Z");
  const expiry = new Date(computeConsentLinkExpiry(now));
  const days = Math.round((expiry.getTime() - now.getTime()) / 86_400_000);
  assert.ok(days >= 364 && days <= 366, `giorni: ${days}`);
  assert.equal(new Date(now).toISOString(), "2026-10-16T10:00:00.000Z", "l'argomento non viene mutato");
});

const NOW = new Date("2026-10-16T10:00:00.000Z");
const FUTURE = "2027-10-16T10:00:00.000Z";
const PAST = "2026-10-15T10:00:00.000Z";

function link(extra = {}) {
  return { parentEmail: "genitore@example.invalid", expiresAt: FUTURE, ...extra };
}

function registration(email = "genitore@example.invalid") {
  return { parentAuthorization: { parentEmail: email } };
}

test("deriveConsentLinkStatus: valid", () => {
  assert.equal(deriveConsentLinkStatus(link(), registration(), NOW), "valid");
});

test("deriveConsentLinkStatus: link o iscrizione mancante è not_found", () => {
  assert.equal(deriveConsentLinkStatus(null, registration(), NOW), "not_found");
  assert.equal(deriveConsentLinkStatus(undefined, registration(), NOW), "not_found");
  assert.equal(deriveConsentLinkStatus(link(), null, NOW), "not_found");
  assert.equal(deriveConsentLinkStatus(link(), undefined, NOW), "not_found");
});

test("deriveConsentLinkStatus: link invalidato è not_found, anche se scaduto o con mail diversa", () => {
  const invalidated = link({ invalidatedAt: PAST });
  assert.equal(deriveConsentLinkStatus(invalidated, registration(), NOW), "not_found");
  assert.equal(
    deriveConsentLinkStatus(link({ invalidatedAt: PAST, expiresAt: PAST }), registration(), NOW),
    "not_found",
  );
  assert.equal(
    deriveConsentLinkStatus(invalidated, registration("altro@example.invalid"), NOW),
    "not_found",
  );
});

test("deriveConsentLinkStatus: scaduto, anche al secondo esatto di scadenza", () => {
  assert.equal(deriveConsentLinkStatus(link({ expiresAt: PAST }), registration(), NOW), "expired");
  assert.equal(
    deriveConsentLinkStatus(link({ expiresAt: NOW.toISOString() }), registration(), NOW),
    "expired",
    "scadenza == adesso conta come scaduto",
  );
  assert.equal(
    deriveConsentLinkStatus(link({ expiresAt: new Date(NOW.getTime() + 1).toISOString() }), registration(), NOW),
    "valid",
  );
});

test("deriveConsentLinkStatus: scadenza assente o illeggibile è expired", () => {
  assert.equal(deriveConsentLinkStatus(link({ expiresAt: undefined }), registration(), NOW), "expired");
  assert.equal(deriveConsentLinkStatus(link({ expiresAt: null }), registration(), NOW), "expired");
  assert.equal(deriveConsentLinkStatus(link({ expiresAt: "non-una-data" }), registration(), NOW), "expired");
});

test("deriveConsentLinkStatus: scaduto ha la precedenza su mail cambiata", () => {
  assert.equal(
    deriveConsentLinkStatus(link({ expiresAt: PAST }), registration("altro@example.invalid"), NOW),
    "expired",
  );
});

test("deriveConsentLinkStatus: mail del genitore cambiata o assente è mismatch", () => {
  assert.equal(deriveConsentLinkStatus(link(), registration("altro@example.invalid"), NOW), "mismatch");
  assert.equal(deriveConsentLinkStatus(link(), registration(""), NOW), "mismatch");
  assert.equal(deriveConsentLinkStatus(link(), { parentAuthorization: {} }, NOW), "mismatch");
  assert.equal(deriveConsentLinkStatus(link(), {}, NOW), "mismatch");
  assert.equal(deriveConsentLinkStatus(link(), { parentAuthorization: null }, NOW), "mismatch");
});

test("deriveConsentLinkStatus: la mail si confronta senza maiuscole né spazi", () => {
  assert.equal(
    deriveConsentLinkStatus(link(), registration("  Genitore@Example.INVALID "), NOW),
    "valid",
  );
});

test("deriveConsentLinkStatus senza data esplicita usa l'orologio di sistema", () => {
  const soon = new Date(Date.now() + 60_000).toISOString();
  const gone = new Date(Date.now() - 60_000).toISOString();
  assert.equal(deriveConsentLinkStatus(link({ expiresAt: soon }), registration()), "valid");
  assert.equal(deriveConsentLinkStatus(link({ expiresAt: gone }), registration()), "expired");
});
