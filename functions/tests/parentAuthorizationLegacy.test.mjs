import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isLegacyApprovalCandidate, getLegacyApprovalDate } = require("../lib/parentAuthorization.js");

const CLIENT_PAGE = new URL("../../src/pages/admin/AdminEventDetailPage.tsx", import.meta.url);
const SERVER_MODULE = new URL("../lib/parentAuthorization.js", import.meta.url);

// Regola del recupero "col vecchio metodo": genera il modulo ufficiale solo per
// chi ha già un'autorizzazione scritta dal server (parentAuthorization.status
// "authorized") ma nessun PDF e nessun documento caricato. Un documento caricato
// esclude: il recupero ne sovrascriveva percorso, nome e url con il PDF generato.
// La data stampata come conferma del genitore è solo authorizedAt: senza, la
// callable salta l'iscrizione invece di inventarla.

// Una iscrizione "col vecchio metodo" senza nessuna prova: la base su cui ogni
// caso aggiunge solo ciò che vuole provare.
function registration(overrides = {}) {
  return {
    id: "iscrizione-1",
    status: "active",
    registrationStatus: "pending_parent_authorization",
    answers: {
      parentAuthorizationRequest: {
        parentFirstName: "Genitore",
        parentLastName: "Esempio",
        parentEmail: "genitore@example.invalid",
        parentPhone: "3000000000",
      },
    },
    parentAuthorization: null,
    parentConsentDocumentPath: null,
    ...overrides,
  };
}

function withAnswers(extra, overrides = {}) {
  const base = registration();
  return registration({ answers: { ...base.answers, ...extra }, ...overrides });
}

function authorized(extra = {}) {
  return { status: "authorized", ...extra };
}

const DOCUMENT_PATH =
  "protected/stakes/palo-prova/activities/evento-prova/parent-consents/iscrizione-1/modulo.pdf";

function label(value) {
  if (value instanceof Date) return "Date";
  return JSON.stringify(value) ?? String(value);
}

// ---------------------------------------------------------------------------
// Le risposte del modulo scritte dal partecipante non sono una prova
// ---------------------------------------------------------------------------

test("answers.parentConfirmed da solo non basta: il client modificato non si fa confermare", () => {
  assert.equal(isLegacyApprovalCandidate(withAnswers({ parentConfirmed: true })), false);
});

test("answers.parentalConsentAccepted da solo non basta", () => {
  assert.equal(isLegacyApprovalCandidate(withAnswers({ parentalConsentAccepted: true })), false);
});

test("le due risposte insieme, con le loro date, non bastano", () => {
  assert.equal(
    isLegacyApprovalCandidate(
      withAnswers({
        parentConfirmed: true,
        parentConfirmedAt: "2026-07-01T10:00:00.000Z",
        parentalConsentAccepted: true,
        parentalConsentAcceptedAt: "2026-07-01T10:00:00.000Z",
        parentAuthorizationAcceptedAt: "2026-07-01T10:00:00.000Z",
      }),
    ),
    false,
  );
});

test("le risposte del modulo non cambiano l'esito: conta solo lo stato scritto dal server", () => {
  for (const extra of [{}, { parentConfirmed: false }, { parentConfirmed: true, parentalConsentAccepted: true }]) {
    assert.equal(isLegacyApprovalCandidate(withAnswers(extra, { parentAuthorization: authorized() })), true);
    assert.equal(isLegacyApprovalCandidate(withAnswers(extra)), false);
  }
});

test("le risposte vere con uno stato diverso da authorized non sono una prova", () => {
  for (const status of ["email_sent", "pending", "not_started", "revoked", ""]) {
    assert.equal(
      isLegacyApprovalCandidate(
        withAnswers({ parentConfirmed: true, parentalConsentAccepted: true }, { parentAuthorization: { status } }),
      ),
      false,
      `status "${status}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// L'unica prova: parentAuthorization.status "authorized" (scritto dal server)
// ---------------------------------------------------------------------------

test("parentAuthorization.status authorized senza pdf e senza documento è candidata", () => {
  assert.equal(isLegacyApprovalCandidate(registration({ parentAuthorization: authorized() })), true);
});

test("parentAuthorization.status diverso da authorized (anche simile) non è una prova", () => {
  for (const status of ["Authorized", "AUTHORIZED", " authorized", "authorized ", true, 1, null, undefined, {}]) {
    assert.equal(
      isLegacyApprovalCandidate(registration({ parentAuthorization: { status } })),
      false,
      label(status),
    );
  }
});

test("gli altri stati dell'iscrizione non escludono: confirmed, active e in attesa restano candidate", () => {
  for (const registrationStatus of ["confirmed", "active", "pending_parent_authorization"]) {
    assert.equal(
      isLegacyApprovalCandidate(registration({ registrationStatus, parentAuthorization: authorized() })),
      true,
      registrationStatus,
    );
  }
});

// ---------------------------------------------------------------------------
// Un documento caricato non è più una prova: esclude
// ---------------------------------------------------------------------------

test("parentConsentDocumentPath da solo non rende candidata l'iscrizione", () => {
  assert.equal(isLegacyApprovalCandidate(registration({ parentConsentDocumentPath: DOCUMENT_PATH })), false);
});

test("un documento caricato toglie la candidatura anche con lo stato authorized", () => {
  assert.equal(
    isLegacyApprovalCandidate(
      registration({ parentConsentDocumentPath: DOCUMENT_PATH, parentAuthorization: authorized() }),
    ),
    false,
  );
});

test("il percorso con spazi intorno ma contenuto vero esclude comunque", () => {
  assert.equal(
    isLegacyApprovalCandidate(
      registration({ parentConsentDocumentPath: `  ${DOCUMENT_PATH}\n`, parentAuthorization: authorized() }),
    ),
    false,
  );
});

test("parentConsentDocumentPath vuoto o di soli spazi non è un documento: non esclude", () => {
  for (const value of ["", " ", "   ", "\t", "\n", " \t\n "]) {
    assert.equal(
      isLegacyApprovalCandidate(registration({ parentConsentDocumentPath: value, parentAuthorization: authorized() })),
      true,
      JSON.stringify(value),
    );
    // E da solo non è comunque una prova.
    assert.equal(isLegacyApprovalCandidate(registration({ parentConsentDocumentPath: value })), false);
  }
});

test("parentConsentDocumentPath non stringa non lancia, non è una prova e non è un documento", () => {
  const values = [true, 1, 0, {}, { path: DOCUMENT_PATH }, [DOCUMENT_PATH], [], null, undefined];
  for (const value of values) {
    assert.doesNotThrow(() => isLegacyApprovalCandidate(registration({ parentConsentDocumentPath: value })));
    assert.equal(
      isLegacyApprovalCandidate(registration({ parentConsentDocumentPath: value })),
      false,
      `da solo ${label(value)}`,
    );
    assert.equal(
      isLegacyApprovalCandidate(registration({ parentConsentDocumentPath: value, parentAuthorization: authorized() })),
      true,
      `con authorized ${label(value)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Esclusioni: vincono sempre, anche con lo stato authorized
// ---------------------------------------------------------------------------

test("con parentAuthorization.pdfPath già presente non è candidata (idempotenza del backfill)", () => {
  assert.equal(
    isLegacyApprovalCandidate(
      registration({ parentAuthorization: authorized({ pdfPath: "protected/stakes/s/a/pdf/firmato.pdf" }) }),
    ),
    false,
  );
  // Anche con il documento caricato insieme.
  assert.equal(
    isLegacyApprovalCandidate(
      registration({
        parentConsentDocumentPath: DOCUMENT_PATH,
        parentAuthorization: authorized({ pdfPath: "protected/stakes/s/a/pdf/firmato.pdf" }),
      }),
    ),
    false,
  );
});

test("pdfPath vuoto o null non conta come pdf presente", () => {
  for (const pdfPath of ["", null, undefined]) {
    assert.equal(
      isLegacyApprovalCandidate(registration({ parentAuthorization: authorized({ pdfPath }) })),
      true,
      label(pdfPath),
    );
  }
});

test("rejected_by_parent non è mai candidata", () => {
  assert.equal(
    isLegacyApprovalCandidate(registration({ parentAuthorization: { status: "rejected_by_parent" } })),
    false,
  );
  assert.equal(
    isLegacyApprovalCandidate(
      registration({
        parentConsentDocumentPath: DOCUMENT_PATH,
        parentAuthorization: { status: "rejected_by_parent" },
      }),
    ),
    false,
  );
  assert.equal(
    isLegacyApprovalCandidate(
      withAnswers(
        { parentConfirmed: true, parentalConsentAccepted: true },
        { parentAuthorization: { status: "rejected_by_parent" } },
      ),
    ),
    false,
  );
});

test("annullata su status non è mai candidata, nemmeno con lo stato authorized", () => {
  assert.equal(isLegacyApprovalCandidate(registration({ status: "cancelled" })), false);
  assert.equal(
    isLegacyApprovalCandidate(registration({ status: "cancelled", parentAuthorization: authorized() })),
    false,
  );
});

test("annullata su registrationStatus non è mai candidata, nemmeno con lo stato authorized", () => {
  assert.equal(isLegacyApprovalCandidate(registration({ registrationStatus: "cancelled" })), false);
  assert.equal(
    isLegacyApprovalCandidate(registration({ registrationStatus: "cancelled", parentAuthorization: authorized() })),
    false,
  );
});

test("annullata su entrambi i campi, con ogni altra prova insieme, non è candidata", () => {
  assert.equal(
    isLegacyApprovalCandidate(
      registration({
        status: "cancelled",
        registrationStatus: "cancelled",
        parentConsentDocumentPath: DOCUMENT_PATH,
        parentAuthorization: authorized(),
      }),
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// Input anomali: nessuna eccezione, nessuna candidata
// ---------------------------------------------------------------------------

test("input nulli o senza answers/parentAuthorization non lanciano e non sono candidate", () => {
  const inputs = [
    null,
    undefined,
    {},
    { answers: null },
    { answers: undefined },
    { answers: "parentConfirmed" },
    { answers: ["parentConfirmed"] },
    { answers: 42 },
    { parentAuthorization: null },
    { parentAuthorization: undefined },
    { parentAuthorization: "authorized" },
    { parentAuthorization: ["authorized"] },
    { parentAuthorization: 42 },
    { parentAuthorization: true },
    { answers: null, parentAuthorization: null, parentConsentDocumentPath: null },
    { id: "solo-id" },
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => isLegacyApprovalCandidate(input), label(input));
    assert.equal(isLegacyApprovalCandidate(input), false, label(input));
  }
});

test("usata come callback di filter sceglie solo le iscrizioni authorized senza pdf né documento", () => {
  // La callable la usa proprio così: .filter(isLegacyApprovalCandidate).
  const list = [
    withAnswers({ parentConfirmed: true }, { id: "solo-risposta" }),
    registration({ id: "authorized", parentAuthorization: authorized() }),
    registration({ id: "solo-documento", parentConsentDocumentPath: DOCUMENT_PATH }),
    registration({ id: "authorized-con-documento", parentConsentDocumentPath: DOCUMENT_PATH, parentAuthorization: authorized() }),
    registration({ id: "gia-fatta", parentAuthorization: authorized({ pdfPath: "x.pdf" }) }),
    registration({ id: "rifiutata", parentAuthorization: { status: "rejected_by_parent" } }),
    registration({ id: "annullata", status: "cancelled", parentAuthorization: authorized() }),
    registration({ id: "annullata-2", registrationStatus: "cancelled", parentAuthorization: authorized() }),
    registration({ id: "spazi", parentConsentDocumentPath: "   " }),
    registration({ id: "authorized-spazi", parentConsentDocumentPath: "   ", parentAuthorization: authorized() }),
  ];
  assert.deepEqual(
    list.filter(isLegacyApprovalCandidate).map((item) => item.id),
    ["authorized", "authorized-spazi"],
  );
});

// ---------------------------------------------------------------------------
// Data del consenso: solo authorizedAt, altrimenti null (mai l'ora attuale)
// ---------------------------------------------------------------------------

// Tutte le date che il partecipante può scrivere (risposte, richiesta, createdAt),
// che il suo client risalva (updatedAt) o che non sono la data della firma
// (parentConsentUploadedAt è la data di caricamento): nessuna deve finire nel modulo.
const NOT_THE_SIGNATURE_DATES = {
  "answers.parentAuthorizationAcceptedAt": "2020-01-01T00:00:00.000Z",
  "answers.parentConfirmedAt": "2020-01-02T00:00:00.000Z",
  "answers.parentalConsentAcceptedAt": "2020-01-03T00:00:00.000Z",
  "request.approvedAt": "2020-01-04T00:00:00.000Z",
  "request.acceptedAt": "2020-01-05T00:00:00.000Z",
  "request.submittedAt": "2020-01-06T00:00:00.000Z",
  "registration.updatedAt": "2020-01-07T00:00:00.000Z",
  "registration.createdAt": "2020-01-08T00:00:00.000Z",
  "registration.parentConsentUploadedAt": "2020-01-09T00:00:00.000Z",
};

function datedRegistration(overrides = {}) {
  return registration({
    answers: {
      parentAuthorizationAcceptedAt: NOT_THE_SIGNATURE_DATES["answers.parentAuthorizationAcceptedAt"],
      parentConfirmedAt: NOT_THE_SIGNATURE_DATES["answers.parentConfirmedAt"],
      parentalConsentAcceptedAt: NOT_THE_SIGNATURE_DATES["answers.parentalConsentAcceptedAt"],
    },
    updatedAt: NOT_THE_SIGNATURE_DATES["registration.updatedAt"],
    createdAt: NOT_THE_SIGNATURE_DATES["registration.createdAt"],
    parentConsentUploadedAt: NOT_THE_SIGNATURE_DATES["registration.parentConsentUploadedAt"],
    ...overrides,
  });
}

function datedRequest() {
  return {
    approvedAt: NOT_THE_SIGNATURE_DATES["request.approvedAt"],
    acceptedAt: NOT_THE_SIGNATURE_DATES["request.acceptedAt"],
    submittedAt: NOT_THE_SIGNATURE_DATES["request.submittedAt"],
  };
}

test("senza authorizedAt la data è null: non l'ora attuale né nessuna data del partecipante", () => {
  for (const existingState of [undefined, null, {}, authorized(), { status: "authorized", authorizedAt: null }]) {
    const result = getLegacyApprovalDate(datedRegistration(), datedRequest(), existingState);
    assert.equal(result, null, label(existingState));
  }
});

test("authorizedAt valido è l'unica fonte: esce in ISO", () => {
  assert.equal(
    getLegacyApprovalDate(registration(), {}, authorized({ authorizedAt: "2026-07-20T09:00:00.000Z" })),
    "2026-07-20T09:00:00.000Z",
  );
});

test("authorizedAt vince su ogni altra data, compresa la data di caricamento del documento", () => {
  const result = getLegacyApprovalDate(
    datedRegistration({ parentConsentUploadedAt: "2026-06-15T08:30:00.000Z" }),
    datedRequest(),
    authorized({ authorizedAt: "2026-07-20T09:00:00.000Z" }),
  );
  assert.equal(result, "2026-07-20T09:00:00.000Z");
  for (const [name, other] of Object.entries(NOT_THE_SIGNATURE_DATES)) {
    assert.notEqual(result, other, name);
  }
});

test("parentConsentUploadedAt da solo non è più una fonte", () => {
  assert.equal(
    getLegacyApprovalDate(registration({ parentConsentUploadedAt: "2026-06-15T08:30:00.000Z" }), {}, {}),
    null,
  );
  assert.equal(
    getLegacyApprovalDate(
      registration({ parentConsentUploadedAt: "2026-06-15T08:30:00.000Z" }),
      {},
      authorized({ authorizedAt: "not a date" }),
    ),
    null,
  );
});

test("authorizedAt non ISO ma interpretabile, o con spazi, esce normalizzato in ISO", () => {
  assert.equal(
    getLegacyApprovalDate(registration(), {}, authorized({ authorizedAt: "2026-07-20T11:00:00+02:00" })),
    "2026-07-20T09:00:00.000Z",
  );
  assert.equal(
    getLegacyApprovalDate(registration(), {}, authorized({ authorizedAt: "  2026-07-20T09:00:00.000Z \n" })),
    "2026-07-20T09:00:00.000Z",
  );
});

test("authorizedAt non valido o non stringa dà null senza eccezioni, mai una data di ripiego", () => {
  const garbage = [
    "",
    "   ",
    "non è una data",
    "2026-13-45",
    "undefined",
    null,
    undefined,
    0,
    1767225600000,
    true,
    {},
    [],
    ["2026-07-20T09:00:00.000Z"],
    new Date("2026-07-20T09:00:00.000Z"),
  ];
  for (const value of garbage) {
    assert.doesNotThrow(() =>
      getLegacyApprovalDate(datedRegistration(), datedRequest(), authorized({ authorizedAt: value })),
    );
    assert.equal(
      getLegacyApprovalDate(datedRegistration(), datedRequest(), authorized({ authorizedAt: value })),
      null,
      label(value),
    );
  }
});

test("registration null o senza campi non lancia: il risultato dipende solo da existingState", () => {
  for (const args of [
    [null, undefined, undefined],
    [undefined, undefined, undefined],
    [null, null, null],
    [{}, {}, {}],
    [null, datedRequest(), { authorizedAt: undefined }],
    ["registration", "request", "state"],
  ]) {
    assert.doesNotThrow(() => getLegacyApprovalDate(...args));
    assert.equal(getLegacyApprovalDate(...args), null);
  }
  // La data arriva da existingState anche se registration e request mancano.
  assert.equal(
    getLegacyApprovalDate(null, null, { authorizedAt: "2026-07-20T09:00:00.000Z" }),
    "2026-07-20T09:00:00.000Z",
  );
});

test("il risultato è sempre null o una stringa ISO valida", () => {
  const cases = [
    getLegacyApprovalDate(null, null, null),
    getLegacyApprovalDate(registration(), {}, authorized({ authorizedAt: "2026-07-20" })),
    getLegacyApprovalDate(registration(), {}, authorized({ authorizedAt: "2026-07-20T09:00:00.000Z" })),
  ];
  assert.equal(cases[0], null);
  for (const result of cases.slice(1)) {
    assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(new Date(result).toISOString(), result);
  }
});

// ---------------------------------------------------------------------------
// Callable: salta senza authorizedAt prima di generare il PDF (controllo testuale)
// ---------------------------------------------------------------------------

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function extractBlock(source, startPattern, endPattern) {
  const start = source.search(startPattern);
  if (start === -1) return null;
  const rest = source.slice(start);
  const end = rest.search(endPattern);
  if (end === -1) return null;
  const endMatch = rest.slice(end).match(endPattern);
  return rest.slice(0, end + endMatch[0].length);
}

function loadCallableSource() {
  const source = stripComments(readFileSync(SERVER_MODULE, "utf8"));
  const start = source.indexOf("const parentAuthorizationBackfillLegacyApprovals = onCall(");
  assert.notEqual(start, -1, "callable parentAuthorizationBackfillLegacyApprovals non trovata in parentAuthorization.js");
  const rest = source.slice(start);
  const end = rest.indexOf("module.exports");
  return end === -1 ? rest : rest.slice(0, end);
}

test("la callable salta con missing_authorized_at dopo missing_parent_identity e prima del PDF", () => {
  const body = loadCallableSource();

  const identityAt = body.indexOf('reason: "missing_parent_identity"');
  const missingDateAt = body.indexOf('reason: "missing_authorized_at"');
  const firstPdfAt = body.search(/await\s+generateOfficialConsentPdf\s*\(/);
  assert.notEqual(identityAt, -1, "manca il salto missing_parent_identity");
  assert.notEqual(missingDateAt, -1, "manca il salto missing_authorized_at");
  assert.notEqual(firstPdfAt, -1, "chiamata a generateOfficialConsentPdf non trovata nella callable");
  assert.ok(identityAt < missingDateAt, "missing_authorized_at deve stare dopo missing_parent_identity");
  assert.ok(missingDateAt < firstPdfAt, "missing_authorized_at deve stare prima della generazione del PDF");

  // Il salto è un vero salto: conta come skipped e passa all'iscrizione dopo.
  const skipBlock = body.slice(body.lastIndexOf("if (", missingDateAt), missingDateAt + 200);
  assert.ok(/if\s*\(\s*!acceptedAt\s*\)/.test(skipBlock), "il salto non è condizionato a !acceptedAt");
  assert.ok(/result\.skipped\s*\+=\s*1/.test(skipBlock), "il salto non incrementa result.skipped");
  assert.ok(/\bcontinue\s*;/.test(skipBlock), "il salto non fa continue");
});

test("la callable prende la data da getLegacyApprovalDate e i candidati da isLegacyApprovalCandidate", () => {
  const body = loadCallableSource();
  assert.ok(/\.filter\(\s*isLegacyApprovalCandidate\s*\)/.test(body), "i candidati non passano da isLegacyApprovalCandidate");
  assert.ok(/const\s+acceptedAt\s*=\s*getLegacyApprovalDate\(/.test(body), "acceptedAt non viene da getLegacyApprovalDate");
  // Nessuna data di ripiego sul ramo della conferma.
  assert.ok(!/acceptedAt\s*=\s*[^;]*\bnowIso\(\)/.test(body), "acceptedAt ha un ripiego su nowIso()");
  assert.ok(!/acceptedAt\s*\|\|/.test(body), "acceptedAt ha un ripiego con ||");
  assert.ok(!/acceptedAt\s*\?\?/.test(body), "acceptedAt ha un ripiego con ??");
});

// ---------------------------------------------------------------------------
// Parità col client: guardia testuale contro il ritorno della vecchia regola
// ---------------------------------------------------------------------------

test("parità client/server: il conteggio legacyApprovedWithoutPdfCount ha la stessa regola del server", () => {
  const source = readFileSync(CLIENT_PAGE, "utf8");
  const block = extractBlock(
    source,
    /const legacyApprovedWithoutPdfCount\s*=/,
    /\)\s*\.length\s*;/,
  );
  assert.ok(
    block,
    "blocco legacyApprovedWithoutPdfCount non trovato in AdminEventDetailPage.tsx: se è stato rinominato, aggiorna questo test",
  );

  // Sul blocco senza commenti: un commento che spiega la regola può nominare i campi.
  const code = stripComments(block);
  assert.ok(code.includes(".filter("), "il blocco estratto non sembra il filtro atteso");
  assert.ok(code.length < 1200, "il blocco estratto è troppo lungo: ha inglobato altro codice");

  // Le risposte del modulo non sono una prova.
  assert.ok(!code.includes("parentConfirmed"), "il filtro client usa ancora parentConfirmed");
  assert.ok(!code.includes("parentalConsentAccepted"), "il filtro client usa ancora parentalConsentAccepted");
  assert.ok(!/\banswers\b/.test(code), "il filtro client legge ancora le risposte del modulo (answers)");

  // L'unica prova è lo stato authorized.
  assert.ok(
    /parentAuthorization\?\.status\s*===\s*"authorized"/.test(code),
    "manca la prova parentAuthorization.status === authorized",
  );

  // Esclusioni: pdf già presente e rifiutata.
  assert.ok(/parentAuthorization\?\.pdfPath/.test(code), "manca l'esclusione di chi ha già il pdf");
  assert.ok(code.includes("rejected_by_parent"), "manca l'esclusione di rejected_by_parent");

  // Il documento caricato esclude, non è più una prova: un `return false` sul
  // percorso, con il controllo di tipo prima di trim() (altrimenti lancia).
  assert.ok(code.includes("parentConsentDocumentPath"), "il filtro client non guarda il documento caricato");
  assert.ok(
    /typeof\s+registration\.parentConsentDocumentPath\s*===\s*"string"/.test(code),
    "il filtro client chiama trim() sul percorso senza controllare che sia una stringa",
  );
  const documentGuard = code.match(
    /if\s*\(\s*typeof\s+registration\.parentConsentDocumentPath\s*===\s*"string"\s*&&\s*registration\.parentConsentDocumentPath\.trim\(\)\s*!==\s*""\s*\)\s*return\s+false\s*;/,
  );
  assert.ok(documentGuard, "il documento caricato non esclude più (manca if (...parentConsentDocumentPath...) return false)");

  // Il documento non deve ricomparire tra le condizioni che contano l'iscrizione:
  // dopo l'esclusione il return finale guarda solo lo stato authorized.
  const afterGuard = code.slice(code.indexOf(documentGuard[0]) + documentGuard[0].length);
  assert.ok(
    !afterGuard.includes("parentConsentDocumentPath"),
    "il documento caricato conta ancora come prova dopo l'esclusione",
  );
  assert.ok(
    /return\s+registration\.parentAuthorization\?\.status\s*===\s*"authorized"\s*;/.test(afterGuard),
    "il return finale non è più solo lo stato authorized",
  );
  assert.ok(!/\|\|/.test(code), "il filtro client ha una condizione in or: una seconda prova oltre ad authorized?");
});

test("parità client/server: le annullate sono escluse a monte su status e registrationStatus", () => {
  // Sul client le annullate non entrano in activeRegistrations; sul server le
  // esclude isLegacyApprovalCandidate. Se questo filtro cambia, il conteggio
  // legacy smette di coincidere con quello che farà il backfill.
  const source = readFileSync(CLIENT_PAGE, "utf8");
  const block = extractBlock(source, /const activeRegistrations\s*=/, /\[\s*sortedRegistrations\s*\]\s*,?\s*\)\s*;/);
  assert.ok(block, "blocco activeRegistrations non trovato in AdminEventDetailPage.tsx");
  const code = stripComments(block);
  assert.ok(/registrationStatus\s*!==\s*"cancelled"/.test(code), "activeRegistrations non esclude registrationStatus cancelled");
  assert.ok(/\bstatus\s*!==\s*"cancelled"/.test(code), "activeRegistrations non esclude status cancelled");

  const counted = stripComments(
    extractBlock(source, /const legacyApprovedWithoutPdfCount\s*=/, /\)\s*\.length\s*;/) ?? "",
  );
  assert.ok(
    /activeRegistrations\s*\.filter\(/.test(counted),
    "legacyApprovedWithoutPdfCount non parte più da activeRegistrations",
  );
});
