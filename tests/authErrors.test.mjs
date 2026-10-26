import test from "node:test";
import assert from "node:assert/strict";

import { ACCEDI } from "../src/copy/accedi.ts";
import { getAuthErrorMessage } from "../src/utils/authErrors.ts";

// Errori di accesso in italiano (docs/FLUSSO_GENITORE.md, C: "Google chiuso o
// annullato: si resta su C, nessun messaggio d'errore"). Si decide sul codice,
// mai sul messaggio: il testo di Firebase ("Firebase: Error (auth/…)") è
// inglese e non arriva mai a schermo.
//
// Gli errori sono costruiti come li lancia l'SDK: un Error con `code` e il
// messaggio inglese di Firebase.
//
// Comando: node --test tests/authErrors.test.mjs

const firebaseError = (code, message = `Firebase: Error (${code}).`) => Object.assign(new Error(message), { code });

/** Nessun testo per l'utente può parlare di Firebase o mostrare un codice. */
function assertUserCopy(message, label) {
  assert.equal(typeof message, "string", label);
  assert.ok(message.length > 0, label);
  assert.ok(!/firebase/iu.test(message), `${label}: ${message}`);
  assert.ok(!message.includes("auth/"), `${label}: ${message}`);
}

test("Google chiuso o annullato: nessun messaggio", () => {
  for (const code of ["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]) {
    assert.equal(getAuthErrorMessage(firebaseError(code)), null, code);
    // Anche come oggetto semplice con il solo codice.
    assert.equal(getAuthErrorMessage({ code }), null, `${code} (oggetto)`);
  }
});

const MAPPED = [
  // [codice, testo atteso]
  ["auth/invalid-credential", ACCEDI.erroreCredenziali],
  ["auth/invalid-login-credentials", ACCEDI.erroreCredenziali],
  ["auth/wrong-password", ACCEDI.erroreCredenziali],
  ["auth/user-not-found", ACCEDI.erroreCredenziali],
  ["auth/email-already-in-use", ACCEDI.erroreEmailGiaUsata],
  ["auth/account-exists-with-different-credential", ACCEDI.erroreAltroAccesso],
  ["auth/credential-already-in-use", ACCEDI.erroreAltroAccesso],
  ["auth/invalid-email", ACCEDI.erroreEmail],
  ["auth/missing-email", ACCEDI.erroreEmail],
  ["auth/weak-password", ACCEDI.errorePassword],
  ["auth/missing-password", ACCEDI.errorePassword],
  ["auth/too-many-requests", ACCEDI.erroreTroppiTentativi],
  ["auth/network-request-failed", ACCEDI.erroreRete],
  ["auth/popup-blocked", ACCEDI.errorePopupBloccato],
  ["auth/user-disabled", ACCEDI.erroreAccountDisattivato],
  ["auth/operation-not-allowed", ACCEDI.erroreCreazioneChiusa],
  ["auth/admin-restricted-operation", ACCEDI.erroreCreazioneChiusa],
  ["auth/existing-account-retry", ACCEDI.accountEsistenteRiprova],
  // Firestore senza rete al salvataggio del profilo.
  ["unavailable", ACCEDI.erroreRete],
];

for (const [code, expected] of MAPPED) {
  test(`codice ${code} → testo di ACCEDI`, () => {
    const message = getAuthErrorMessage(firebaseError(code));
    assert.equal(message, expected);
    assertUserCopy(message, code);
    // Il messaggio inglese non conta: stesso testo con qualunque messaggio.
    assert.equal(getAuthErrorMessage(firebaseError(code, "Messaggio a caso")), expected);
    assert.equal(getAuthErrorMessage({ code }), expected);
  });
}

test("Google già legato a un altro account: «Premi di nuovo»", () => {
  assert.equal(getAuthErrorMessage({ code: "auth/existing-account-retry" }), ACCEDI.accountEsistenteRiprova);
});

test("i testi di errore di ACCEDI non parlano di Firebase", () => {
  for (const [key, value] of Object.entries(ACCEDI)) {
    if (!/^errore|accountEsistenteRiprova/u.test(key)) continue;
    assertUserCopy(value, key);
  }
});

test("codice sconosciuto → erroreGenerico, mai il messaggio inglese", () => {
  const cases = [
    firebaseError("auth/internal-error"),
    firebaseError("auth/something-new-in-sdk-13"),
    firebaseError("permission-denied", "Missing or insufficient permissions."),
    firebaseError("permission-denied", "Mancano i permessi"),
    firebaseError("failed-precondition", "The query requires an index."),
    { code: "permission-denied", message: "Missing or insufficient permissions." },
  ];
  for (const error of cases) {
    const message = getAuthErrorMessage(error);
    assert.equal(message, ACCEDI.erroreGenerico, `${error.code}: ${message}`);
  }
});

test("Error senza codice con messaggio nostro in italiano → resta com'è", () => {
  for (const text of [
    "Seleziona un'unità valida dalla lista configurata dall'admin.",
    "Profilo utente non trovato.",
    "Inserisci nome e cognome.",
  ]) {
    assert.equal(getAuthErrorMessage(new Error(text)), text);
  }
});

test("messaggio Firebase senza codice → erroreGenerico", () => {
  assert.equal(getAuthErrorMessage(new Error("Firebase: Error (auth/invalid-credential).")), ACCEDI.erroreGenerico);
  assert.equal(getAuthErrorMessage(new Error("Firebase: Missing or insufficient permissions.")), ACCEDI.erroreGenerico);
  assert.equal(getAuthErrorMessage("Firebase: Error (auth/network-request-failed).",), ACCEDI.erroreGenerico);
});

test("errore vuoto, null o undefined → erroreGenerico", () => {
  for (const error of [undefined, null, "", "   ", new Error(""), new Error("   "), {}, { message: "" }, 0, false]) {
    assert.equal(getAuthErrorMessage(error), ACCEDI.erroreGenerico, String(error));
  }
});

test("codici che sono nomi di proprietà di Object non tornano funzioni", () => {
  for (const code of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
    for (const error of [{ code }, firebaseError(code), Object.assign(new Error("Messaggio nostro"), { code })]) {
      const message = getAuthErrorMessage(error);
      assert.equal(typeof message, "string", `${code}: ${typeof message}`);
      assert.equal(message, ACCEDI.erroreGenerico, code);
    }
  }
});

test("il risultato è sempre una stringa o null", () => {
  const inputs = [
    ...MAPPED.map(([code]) => firebaseError(code)),
    firebaseError("auth/popup-closed-by-user"),
    new Error("Testo nostro"),
    "Testo nostro",
    { code: 42, message: "x" },
    Symbol("x"),
  ];
  for (const input of inputs) {
    const message = getAuthErrorMessage(input);
    assert.ok(message === null || typeof message === "string", String(input?.code ?? typeof input));
  }
});
