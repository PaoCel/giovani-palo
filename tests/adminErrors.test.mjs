import test from "node:test";
import assert from "node:assert/strict";
import { FirebaseError } from "firebase/app";

import { ADMIN } from "../src/copy/admin.ts";
import { PAROLE } from "../src/copy/parole.ts";
import { getAdminActionError } from "../src/utils/adminErrors.ts";
import {
  WRITE_TIMEOUT_CODE,
  isConnectionError,
  isOffline,
  withWriteTimeout,
} from "../src/utils/writeTimeout.ts";

// Messaggio per un'azione dell'admin non riuscita (`src/utils/adminErrors.ts`),
// mostrato dentro il foglio o il modale aperto. In ordine:
//  1. codice `write-timeout` (scrittura Firestore scaduta, che resta in coda e
//     parte al ritorno della rete) -> «Il server non risponde… La richiesta
//     resta in coda…» (PAROLE.erroreReteInCoda): «Tieni» non la ferma;
//  2. altri errori di rete o tempo scaduto, oppure `navigator.onLine === false`
//     (con qualunque errore: offline una callable risponde `functions/internal`)
//     -> «Il server non risponde: controlla la connessione e riprova.»
//     (PAROLE.erroreRete);
//  3. un `TypeError` (errori del browser: «Failed to fetch», «Failed to fetch
//     dynamically imported module») -> la frase dell'azione, mai il suo messaggio;
//  4. codice `functions/*` con un messaggio (tranne internal e unknown, e tranne
//     il messaggio di default dell'SDK: il nome del codice, «not-found», o lo
//     stato, «PERMISSION_DENIED») -> il messaggio, che le callable del progetto
//     scrivono già in italiano;
//  5. qualunque altro codice (Firestore: «permission-denied», in inglese e senza
//     prefisso) -> la frase dell'azione con il codice, così chi chiede aiuto sa
//     cosa riferire: «Impossibile eliminare il file. (codice: permission-denied)»;
//  6. nessun codice -> il messaggio dell'Error, se c'è; altrimenti la frase
//     dell'azione.
//
// Gli errori sono costruiti come li lancia l'SDK: un Error con `code` e il
// messaggio inglese di Firebase (`FirebaseError` è la classe da cui discendono
// quelli di Firestore, Functions e Auth).
//
// Comando: node --test tests/adminErrors.test.mjs

const FALLBACK = ADMIN.erroreEliminaMedia;
const withCode = (code, message) => Object.assign(new Error(message), { code });
const actionError = (error) => getAdminActionError(error, FALLBACK);
const withCodeText = (code) => `${FALLBACK} (codice: ${code})`;

// `navigator` in Node è un getter su globalThis: qui si ridefinisce e, a prova
// finita, si rimette com'era. Le prove sono sincrone, una alla volta.
function withNavigator(value, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
}
const offline = (run) =>
  withNavigator({ onLine: false }, () => {
    assert.equal(isOffline(), true, "navigator.onLine === false non basta a dire offline: la prova non vale");
    return run();
  });

// ---------------------------------------------------------------------------
// 1. Scrittura scaduta, che resta in coda
// ---------------------------------------------------------------------------

test("in coda: write-timeout dice che la richiesta resta in coda e parte da sola", () => {
  assert.equal(actionError(withCode(WRITE_TIMEOUT_CODE, "write-timeout")), PAROLE.erroreReteInCoda);
  assert.equal(actionError(withCode("write-timeout", "")), ADMIN.erroreReteInCoda);
  assert.equal(actionError({ code: WRITE_TIMEOUT_CODE }), PAROLE.erroreReteInCoda);
});

test("in coda: la frase non è quella dell'errore di rete e non porta il codice né la frase dell'azione", () => {
  const message = actionError(withCode(WRITE_TIMEOUT_CODE, "write-timeout"));
  assert.notEqual(message, PAROLE.erroreRete);
  assert.match(message, /in coda/u);
  assert.ok(!message.includes("codice"), message);
  assert.ok(!message.includes(FALLBACK), message);
});

test("in coda: il tempo scaduto di withWriteTimeout dà la frase della richiesta in coda", async () => {
  // Una scrittura offline resta in sospeso per sempre: dopo il tempo limite
  // l'errore che esce è proprio quello che il foglio deve spiegare.
  const never = new Promise(() => {});
  const error = await withWriteTimeout(never, 1).then(
    () => assert.fail("la promessa non doveva chiudersi"),
    (caught) => caught,
  );
  assert.equal(actionError(error), PAROLE.erroreReteInCoda);
});

test("in coda: il messaggio dell'errore non conta, qualunque sia", () => {
  for (const message of ["", "   ", "Tempo scaduto.", "write-timeout", "The write timed out."]) {
    assert.equal(actionError(withCode(WRITE_TIMEOUT_CODE, message)), PAROLE.erroreReteInCoda, `«${message}»`);
  }
});

// ---------------------------------------------------------------------------
// 2. Rete assente
// ---------------------------------------------------------------------------

// Gli altri codici di `isConnectionError`; se la funzione ne impara uno nuovo,
// il test sotto lo ricorda.
const CONNECTION_CODES = [
  "unavailable",
  "deadline-exceeded",
  "firestore/unavailable",
  "firestore/deadline-exceeded",
  "functions/unavailable",
  "functions/deadline-exceeded",
];

test("errore di rete: ogni codice di connessione dà la frase del server che non risponde", () => {
  for (const code of CONNECTION_CODES) {
    assert.equal(isConnectionError({ code }), true, `${code} non è più un errore di connessione`);
    assert.equal(actionError(withCode(code, "Qualcosa in inglese")), PAROLE.erroreRete, code);
  }
  // Anche write-timeout è un errore di connessione, ma ha la sua frase.
  assert.equal(isConnectionError({ code: WRITE_TIMEOUT_CODE }), true);
});

test("errore di rete: vale qualunque sia il messaggio, anche italiano o vuoto", () => {
  for (const code of CONNECTION_CODES) {
    for (const message of ["", "   ", "Tempo scaduto.", "The service is currently unavailable."]) {
      assert.equal(actionError(withCode(code, message)), PAROLE.erroreRete, `${code} «${message}»`);
    }
  }
});

test("errore di rete: functions/deadline-exceeded con un messaggio non mostra il messaggio", () => {
  // La rete viene prima delle callable: «controlla la connessione» è più utile
  // di un messaggio qualunque.
  assert.equal(
    actionError(withCode("functions/deadline-exceeded", "Operazione troppo lenta.")),
    PAROLE.erroreRete,
  );
  assert.equal(
    actionError(withCode("functions/unavailable", "Servizio non disponibile.")),
    PAROLE.erroreRete,
  );
});

test("errore di rete: un oggetto con il solo codice vale come un Error", () => {
  assert.equal(actionError({ code: "unavailable" }), PAROLE.erroreRete);
  assert.equal(actionError({ code: "deadline-exceeded" }), PAROLE.erroreRete);
});

test("errore di rete: l'errore di rete non porta il codice né la frase dell'azione", () => {
  const message = actionError(withCode("unavailable", "x"));
  assert.ok(!message.includes("codice"), message);
  assert.ok(!message.includes(FALLBACK), message);
});

test("errore di rete: la frase di rete e quella in coda sono due frasi diverse", () => {
  assert.notEqual(PAROLE.erroreRete, PAROLE.erroreReteInCoda);
  assert.equal(ADMIN.erroreRete, PAROLE.erroreRete);
  assert.equal(ADMIN.erroreReteInCoda, PAROLE.erroreReteInCoda);
});

// ---------------------------------------------------------------------------
// 2b. navigator.onLine === false: qualunque errore è un errore di rete
// ---------------------------------------------------------------------------

test("senza rete: una callable che risponde functions/internal dà la frase del server che non risponde", () => {
  offline(() => {
    assert.equal(actionError(withCode("functions/internal", "internal")), PAROLE.erroreRete);
    assert.equal(actionError(new FirebaseError("functions/internal", "internal")), PAROLE.erroreRete);
  });
});

test("senza rete: qualunque errore dà la frase del server che non risponde", () => {
  offline(() => {
    for (const error of [
      new Error("Scegli almeno un file."),
      new Error(""),
      withCode("permission-denied", "Missing or insufficient permissions."),
      withCode("functions/failed-precondition", "Il modulo non è ancora pubblicato."),
      withCode("functions/unknown", "unknown"),
      withCode("unavailable", "x"),
      new TypeError("Failed to fetch"),
      { code: "not-found" },
      "stringa",
      null,
      undefined,
    ]) {
      assert.equal(actionError(error), PAROLE.erroreRete, String(error));
    }
  });
});

test("senza rete: una scrittura scaduta dice ancora che resta in coda", () => {
  offline(() => {
    assert.equal(actionError(withCode(WRITE_TIMEOUT_CODE, "write-timeout")), PAROLE.erroreReteInCoda);
    assert.equal(actionError({ code: WRITE_TIMEOUT_CODE }), PAROLE.erroreReteInCoda);
  });
});

test("senza rete: la frase non porta il codice né la frase dell'azione", () => {
  offline(() => {
    const message = actionError(withCode("permission-denied", "Missing or insufficient permissions."));
    assert.ok(!message.includes("codice"), message);
    assert.ok(!message.includes(FALLBACK), message);
  });
});

test("con la rete, o senza saperlo, gli errori restano quelli di sempre", () => {
  const error = withCode("permission-denied", "Missing or insufficient permissions.");
  const internal = withCode("functions/internal", "internal");
  for (const value of [{ onLine: true }, {}, { onLine: undefined }, undefined]) {
    withNavigator(value, () => {
      assert.equal(isOffline(), false, JSON.stringify(value));
      assert.equal(actionError(error), withCodeText("permission-denied"), JSON.stringify(value));
      assert.equal(actionError(internal), withCodeText("functions/internal"), JSON.stringify(value));
      assert.equal(actionError(new Error("Messaggio.")), "Messaggio.", JSON.stringify(value));
    });
  }
});

test("senza rete: la prova ha rimesso navigator com'era", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  offline(() => {});
  const after = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  assert.deepEqual(after, before);
  assert.equal(isOffline(), false);
});

// ---------------------------------------------------------------------------
// 3. Errori del browser (TypeError)
// ---------------------------------------------------------------------------

test("TypeError: gli errori del browser danno la frase dell'azione e mai il loro messaggio", () => {
  for (const message of [
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource.",
    "Failed to fetch dynamically imported module: https://example.test/assets/xlsx-abc123.js",
    "Importing a module script failed.",
    "Cannot read properties of undefined (reading 'id')",
  ]) {
    assert.equal(actionError(new TypeError(message)), FALLBACK, message);
  }
});

test("TypeError: nemmeno con un messaggio italiano", () => {
  assert.equal(actionError(new TypeError("Titolo mancante.")), FALLBACK);
  assert.equal(actionError(new TypeError("")), FALLBACK);
});

test("TypeError: la frase dell'azione è senza codice, anche se l'errore ne ha uno", () => {
  for (const code of ["permission-denied", "functions/failed-precondition", "functions/internal", "unknown"]) {
    const message = actionError(Object.assign(new TypeError("Failed to fetch"), { code }));
    assert.equal(message, FALLBACK, code);
    assert.ok(!message.includes("codice"), message);
  }
});

test("TypeError: un modulo che non si carica più dopo un aggiornamento dice di ricaricare", () => {
  const error = new TypeError("Failed to fetch dynamically imported module: https://example.test/assets/xlsx-abc123.js");
  const message = getAdminActionError(error, ADMIN.erroreExcel);
  assert.equal(message, ADMIN.erroreExcel);
  assert.match(message, /Ricarica la pagina/u);
});

test("TypeError: una fetch fallita offline resta un errore di rete", () => {
  offline(() => assert.equal(actionError(new TypeError("Failed to fetch")), PAROLE.erroreRete));
});

test("TypeError: la rete e la scrittura in coda vengono prima del TypeError", () => {
  assert.equal(
    actionError(Object.assign(new TypeError("x"), { code: "unavailable" })),
    PAROLE.erroreRete,
  );
  assert.equal(
    actionError(Object.assign(new TypeError("x"), { code: WRITE_TIMEOUT_CODE })),
    PAROLE.erroreReteInCoda,
  );
});

test("TypeError: gli altri Error con un messaggio italiano restano come sono", () => {
  assert.equal(actionError(new Error("Scegli almeno un file.")), "Scegli almeno un file.");
  assert.equal(actionError(new RangeError("Fuori intervallo.")), "Fuori intervallo.");
  assert.equal(actionError(new SyntaxError("Formato non valido.")), "Formato non valido.");
  // E anche uno con il messaggio del browser, se non è un TypeError, non si tocca.
  assert.equal(actionError(new Error("Failed to fetch")), "Failed to fetch");
});

// ---------------------------------------------------------------------------
// 2. Callable: il messaggio c'è, in italiano, ed è il testo per l'admin
// ---------------------------------------------------------------------------

test("callable: functions/failed-precondition con un messaggio italiano mostra il messaggio", () => {
  const message = "Il modulo non è ancora pubblicato.";
  assert.equal(actionError(withCode("functions/failed-precondition", message)), message);
});

test("callable: ogni codice functions/* con un messaggio mostra il messaggio", () => {
  for (const code of [
    "functions/failed-precondition",
    "functions/invalid-argument",
    "functions/permission-denied",
    "functions/not-found",
    "functions/already-exists",
    "functions/resource-exhausted",
    "functions/unauthenticated",
    "functions/aborted",
  ]) {
    const message = `Messaggio per ${code}.`;
    assert.equal(actionError(withCode(code, message)), message, code);
  }
});

test("callable: il messaggio si mostra senza gli spazi ai bordi", () => {
  assert.equal(actionError(withCode("functions/invalid-argument", "  Titolo mancante.  \n")), "Titolo mancante.");
});

test("callable: un messaggio su più righe resta com'è", () => {
  const message = "Prima riga.\nSeconda riga.";
  assert.equal(actionError(withCode("functions/failed-precondition", message)), message);
});

test("callable: functions/internal e functions/unknown non mostrano il loro messaggio generico", () => {
  for (const code of ["functions/internal", "functions/unknown"]) {
    assert.equal(actionError(withCode(code, "internal")), withCodeText(code), code);
    assert.equal(actionError(withCode(code, "unknown")), withCodeText(code), code);
    // Nemmeno se il messaggio sembra buono: la callable non l'ha scritto lei.
    assert.equal(actionError(withCode(code, "Qualcosa è andato storto.")), withCodeText(code), code);
  }
});

test("callable: functions/* senza messaggio, o con soli spazi, dà la frase dell'azione e il codice", () => {
  for (const message of ["", "   ", "\n\t"]) {
    assert.equal(
      actionError(withCode("functions/failed-precondition", message)),
      withCodeText("functions/failed-precondition"),
      JSON.stringify(message),
    );
  }
});

test("callable: l'errore dell'SDK Firebase si comporta come un Error con codice", () => {
  const italian = new FirebaseError("functions/failed-precondition", "Il modulo non è ancora pubblicato.");
  assert.equal(actionError(italian), "Il modulo non è ancora pubblicato.");

  const generic = new FirebaseError("functions/internal", "internal");
  assert.equal(actionError(generic), withCodeText("functions/internal"));

  const offline = new FirebaseError("functions/unavailable", "unavailable");
  assert.equal(actionError(offline), PAROLE.erroreRete);
});

// ---------------------------------------------------------------------------
// 3. Gli altri codici: la frase dell'azione e il codice, mai il messaggio inglese
// ---------------------------------------------------------------------------

test("Firestore: permission-denied con il messaggio inglese dà la frase dell'azione e il codice", () => {
  const error = withCode("permission-denied", "Missing or insufficient permissions.");
  assert.equal(actionError(error), "Impossibile eliminare il file. (codice: permission-denied)");
  assert.ok(!actionError(error).includes("Missing"), "il messaggio inglese non deve arrivare a schermo");
});

test("Firestore: l'errore dell'SDK mostra il codice e non il messaggio", () => {
  const error = new FirebaseError("permission-denied", "Missing or insufficient permissions.");
  assert.equal(actionError(error), withCodeText("permission-denied"));
});

test("altri codici: Firestore, Auth e Storage danno la frase dell'azione con il proprio codice", () => {
  for (const code of [
    "permission-denied",
    "not-found",
    "failed-precondition",
    "already-exists",
    "resource-exhausted",
    "aborted",
    "cancelled",
    "firestore/permission-denied",
    "auth/requires-recent-login",
    "auth/network-request-failed",
    "storage/unauthorized",
  ]) {
    assert.equal(actionError(withCode(code, "English message from the SDK.")), withCodeText(code), code);
  }
});

test("altri codici: anche con un messaggio italiano si mostra la frase dell'azione e il codice", () => {
  // Il codice vince: i messaggi si mostrano solo per le callable (functions/*)
  // e per gli errori senza codice.
  assert.equal(actionError(withCode("permission-denied", "Non puoi farlo.")), withCodeText("permission-denied"));
});

test("altri codici: un codice che comincia per «functions» ma non è functions/* non vale come callable", () => {
  for (const code of ["functions", "functionsx/internal", "Functions/failed-precondition", "my-functions/x"]) {
    assert.equal(actionError(withCode(code, "Messaggio.")), withCodeText(code), code);
  }
});

test("altri codici: un codice senza messaggio dà comunque la frase dell'azione e il codice", () => {
  assert.equal(actionError(withCode("permission-denied", "")), withCodeText("permission-denied"));
  assert.equal(actionError({ code: "permission-denied" }), withCodeText("permission-denied"));
});

test("altri codici: la frase dell'azione è quella passata, ogni azione la sua", () => {
  const error = withCode("permission-denied", "Missing or insufficient permissions.");
  for (const fallback of [
    ADMIN.erroreEliminaIscrizione,
    ADMIN.erroreEliminaPost,
    ADMIN.erroreCover,
    ADMIN.erroreSposta,
    ADMIN.erroreImpostazioni,
  ]) {
    assert.equal(getAdminActionError(error, fallback), `${fallback} (codice: permission-denied)`);
  }
});

// ---------------------------------------------------------------------------
// 4. Nessun codice
// ---------------------------------------------------------------------------

test("senza codice: un Error mostra il proprio messaggio, senza gli spazi ai bordi", () => {
  assert.equal(actionError(new Error("Scegli almeno un file.")), "Scegli almeno un file.");
  assert.equal(actionError(new Error("  Scegli almeno un file.  ")), "Scegli almeno un file.");
});

test("senza codice: un messaggio vuoto o di soli spazi dà la frase dell'azione", () => {
  for (const message of ["", " ", "   ", "\n", "\t \n"]) {
    assert.equal(actionError(new Error(message)), FALLBACK, JSON.stringify(message));
  }
});

test("senza codice: un codice vuoto, nullo o indefinito vale come nessun codice", () => {
  for (const code of ["", null, undefined]) {
    assert.equal(actionError(Object.assign(new Error("Messaggio."), { code })), "Messaggio.", String(code));
    assert.equal(actionError(Object.assign(new Error(""), { code })), FALLBACK, String(code));
  }
});

test("senza codice: l'errore scritto dal client non finisce con un codice inventato", () => {
  const message = actionError(new Error("Scegli almeno un file."));
  assert.ok(!message.includes("codice"), message);
});

// ---------------------------------------------------------------------------
// Valori che non sono un Error
// ---------------------------------------------------------------------------

test("non-Error: stringa, numero, null e undefined danno la frase dell'azione", () => {
  for (const value of ["Qualcosa è andato storto", "", 42, 0, true, null, undefined]) {
    assert.equal(actionError(value), FALLBACK, String(value));
  }
});

test("non-Error: un oggetto senza codice dà la frase dell'azione, anche con un messaggio", () => {
  assert.equal(actionError({}), FALLBACK);
  assert.equal(actionError([]), FALLBACK);
  assert.equal(actionError({ message: "Qualcosa è andato storto." }), FALLBACK, "il messaggio si legge solo da un Error");
});

test("non-Error: un oggetto con un codice usa il codice", () => {
  assert.equal(actionError({ code: "permission-denied" }), withCodeText("permission-denied"));
  assert.equal(actionError({ code: "unavailable" }), PAROLE.erroreRete);
});

test("non-Error: un codice che non è una stringa non fa saltare niente", () => {
  assert.equal(actionError({ code: 7 }), withCodeText("7"));
  assert.equal(actionError({ code: {} }), withCodeText("[object Object]"));
});

// ---------------------------------------------------------------------------
// Proprietà valide per ogni errore
// ---------------------------------------------------------------------------

const SAMPLE_ERRORS = [
  new Error("Messaggio."),
  new Error(""),
  withCode("permission-denied", "Missing or insufficient permissions."),
  withCode("functions/failed-precondition", "Il modulo non è ancora pubblicato."),
  withCode("functions/internal", "internal"),
  withCode("functions/unavailable", ""),
  withCode("write-timeout", "write-timeout"),
  { code: "not-found" },
  "stringa",
  null,
  undefined,
  {},
];

test("ogni errore dà una frase non vuota, senza spazi ai bordi", () => {
  for (const error of SAMPLE_ERRORS) {
    const message = actionError(error);
    assert.equal(typeof message, "string");
    assert.ok(message.length > 0, String(error));
    assert.equal(message, message.trim(), `«${message}»`);
  }
});

test("la frase non dice mai «undefined», «null» né «[object»", () => {
  for (const error of SAMPLE_ERRORS) {
    assert.doesNotMatch(actionError(error), /undefined|null|\[object/u, String(error));
  }
});

test("lo stesso errore dà sempre la stessa frase", () => {
  for (const error of SAMPLE_ERRORS) {
    assert.equal(actionError(error), actionError(error));
  }
});

test("ogni frase d'azione di ADMIN (errore*) arriva intera, con il codice, a schermo", () => {
  const actions = Object.entries(ADMIN).filter(([key]) => /^errore/u.test(key));
  assert.ok(actions.length >= 10, `trovate solo ${actions.length} frasi errore* in ADMIN`);

  const error = withCode("permission-denied", "Missing or insufficient permissions.");
  for (const [key, fallback] of actions) {
    // Sono l'esito della rete (anche in coda), non frasi d'azione.
    if (key === "erroreRete" || key === "erroreReteInCoda") continue;
    assert.equal(getAdminActionError(error, fallback), `${fallback} (codice: permission-denied)`, key);
  }
});

// ---------------------------------------------------------------------------
// Callable: il messaggio di default dell'SDK non è un messaggio nostro
// ---------------------------------------------------------------------------

// Quando la callable risponde senza un messaggio applicativo (funzione non
// deployata: HTTP 404; token scaduto: 401; quota: 429; corpo con il solo stato)
// l'SDK Firebase costruisce l'errore con il NOME DEL CODICE ("not-found") o con
// lo STATO ("PERMISSION_DENIED") come messaggio (`_errorForResponse` in
// @firebase/functions). Non è un testo per l'admin: si mostra la frase
// dell'azione con il codice, come per gli altri codici. Un messaggio scritto
// dalla callable (HttpsError, in italiano) resta com'è.

// I codici di `FunctionsErrorCode` che non sono errori di rete (quelli stanno
// in CONNECTION_CODES) né generici già trattati sopra (internal, unknown).
const CALLABLE_CODES = [
  "cancelled",
  "invalid-argument",
  "not-found",
  "already-exists",
  "permission-denied",
  "unauthenticated",
  "resource-exhausted",
  "failed-precondition",
  "aborted",
  "out-of-range",
  "unimplemented",
  "data-loss",
];

// Come l'SDK scrive lo stato: PERMISSION_DENIED.
const asStatus = (name) => name.toUpperCase().replaceAll("-", "_");

test("callable: il messaggio uguale al codice non va a schermo (funzione non deployata, token scaduto, quota)", () => {
  for (const [code, message] of [
    ["functions/not-found", "not-found"], // HTTP 404
    ["functions/unauthenticated", "unauthenticated"], // HTTP 401
    ["functions/resource-exhausted", "resource-exhausted"], // HTTP 429
    ["functions/permission-denied", "permission-denied"], // HTTP 403
    ["functions/invalid-argument", "invalid-argument"], // HTTP 400
  ]) {
    assert.equal(actionError(new FirebaseError(code, message)), withCodeText(code), `${code} «${message}»`);
  }
});

test("callable: il messaggio uguale allo stato HTTP non va a schermo", () => {
  for (const [code, message] of [
    ["functions/unauthenticated", "UNAUTHENTICATED"],
    ["functions/permission-denied", "PERMISSION_DENIED"],
    ["functions/not-found", "NOT_FOUND"],
    ["functions/failed-precondition", "FAILED_PRECONDITION"],
  ]) {
    assert.equal(actionError(new FirebaseError(code, message)), withCodeText(code), `${code} «${message}»`);
  }
});

test("callable: ogni codice con il proprio nome, in minuscolo, in maiuscolo o con il trattino basso, è generico", () => {
  for (const name of CALLABLE_CODES) {
    const code = `functions/${name}`;
    for (const message of [name, asStatus(name), name.replaceAll("-", "_"), name.toUpperCase(), `${name[0].toUpperCase()}${name.slice(1)}`]) {
      assert.equal(actionError(withCode(code, message)), withCodeText(code), `${code} «${message}»`);
    }
  }
});

test("callable: il messaggio generico è generico anche con gli spazi ai bordi", () => {
  assert.equal(
    actionError(withCode("functions/not-found", "  not-found \n")),
    withCodeText("functions/not-found"),
  );
});

test("callable: un messaggio scritto dalla callable resta com'è, anche se nomina il codice", () => {
  for (const [code, message] of [
    ["functions/unauthenticated", "Non hai fatto l'accesso."],
    ["functions/not-found", "L'attività non esiste più."],
    ["functions/permission-denied", "Solo gli admin possono farlo."],
    // Il nome del codice dentro una frase più lunga: è un testo, non il default.
    ["functions/unauthenticated", "Errore unauthenticated: accedi di nuovo."],
    ["functions/not-found", "not-found: manca il modulo."],
    ["functions/failed-precondition", "failed-precondition non è un errore, è un avviso."],
  ]) {
    assert.equal(actionError(withCode(code, message)), message, `${code} «${message}»`);
  }
});

test("callable: il messaggio generico è generico solo per le callable", () => {
  // Gli altri codici non mostrano il messaggio in nessun caso.
  assert.equal(actionError(withCode("not-found", "not-found")), withCodeText("not-found"));
  assert.equal(actionError(withCode("permission-denied", "PERMISSION_DENIED")), withCodeText("permission-denied"));
  // Senza codice il messaggio è dell'Error e si mostra: «not-found» non è un codice.
  assert.equal(actionError(new Error("not-found")), "not-found");
});

test("callable: l'errore di rete resta un errore di rete anche con il messaggio di default", () => {
  assert.equal(actionError(withCode("functions/deadline-exceeded", "deadline-exceeded")), PAROLE.erroreRete);
  assert.equal(actionError(withCode("functions/unavailable", "UNAVAILABLE")), PAROLE.erroreRete);
});

test("callable: functions/internal e functions/unknown con il proprio nome o con altro, sempre il codice", () => {
  for (const code of ["functions/internal", "functions/unknown"]) {
    const name = code.slice("functions/".length);
    for (const message of [name, name.toUpperCase(), "Errore del server.", ""]) {
      assert.equal(actionError(withCode(code, message)), withCodeText(code), `${code} «${message}»`);
    }
  }
});
