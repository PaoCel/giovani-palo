import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  mapGuestContext,
  mapGuestMine,
  mapGuestRequest,
  mapStaffQueue,
  mapStaffRequest,
} from "../src/services/firestore/recordNightGuestMappers.ts";
import {
  GUEST_COPY,
  GUEST_STATE_TEXTS,
  MAX_BULK_REJECT_REQUESTS,
  RECORD_NIGHT_GUEST_LIMITS,
  RecordNightGuestClientError,
  SERVER_GUEST_MESSAGES,
  buildGuestSubmitPayload,
  buildStaffQueueUnitFilters,
  checkGuestName,
  chunkRequestIds,
  classifyGuestError,
  countOpenGuestRequests,
  createAnonymousSessionGate,
  createGuestSubmissionKeeper,
  createSubmissionId,
  filterStaffQueue,
  getGuestStateText,
  getRecordNightGuestErrorMessage,
  groupPublicRecordsByCategory,
  isAtGuestPhoneLimit,
  isGuestIntakeOpen,
  normalizeGuestName,
  splitStaffRequests,
  validateGuestDraft,
} from "../src/utils/recordNightGuest.ts";

// Notte dei Record, richieste senza account (docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md):
// strato dati del client. Helper puri provati con Node; la sezione "Contratto con
// il backend" li confronta con i parser e le funzioni vere di functions/lib/
// (senza emulatori: Firestore e Auth non servono).
//
// Comando: node --test tests/recordNightGuest.test.mjs

const require = createRequire(import.meta.url);
let backend = null;
try {
  backend = {
    night: require("../functions/lib/recordNight.js"),
    guest: require("../functions/lib/recordNightGuest.js"),
  };
} catch (error) {
  console.warn(`Contratto con il backend saltato: functions/ non caricabile (${error?.message}).`);
}
const needsBackend = { skip: backend ? false : "functions/node_modules non disponibile" };

// ---------------------------------------------------------------------------
// Nome e cognome
// ---------------------------------------------------------------------------

const VALID_NAMES = [
  ["Anna", "Anna"],
  ["  Anna   Maria ", "Anna Maria"],
  ["D'Angelo", "D'Angelo"],
  ["D’Angelo", "D'Angelo"],
  ["D‘Angelo", "D'Angelo"],
  ["Rossi-Bianchi", "Rossi-Bianchi"],
  ["Rossi - Bianchi", "Rossi - Bianchi"],
  ["Dell' Orto", "Dell' Orto"],
  ["José", "José"],
  // Lettera e accento separati (come li incolla un Mac): diventa la forma composta.
  ["José", "José"],
  ["Åsa", "Åsa"],
  ["Anna\tMaria", "Anna Maria"],
  ["Li", "Li"],
  ["a".repeat(40), "a".repeat(40)],
];

const INVALID_NAMES = [
  ["", "required"],
  ["    ", "required"],
  ["A", "too_short"],
  ["a".repeat(41), "too_long"],
  ["Anna2", "invalid"],
  ["4nna", "invalid"],
  ["Anna!", "invalid"],
  ["<b>Anna</b>", "invalid"],
  ["http://anna.it", "invalid"],
  ["anna@example.com", "invalid"],
  ["-Anna", "invalid"],
  ["Anna-", "invalid"],
  ["'Anna", "invalid"],
  ["O''Neil", "invalid"],
  ["Anna--Maria", "invalid"],
  ["Anna \u0000", "invalid"],
  ["Anna\u0007", "invalid"],
  ["Anna 😀", "invalid"],
];

test("nome e cognome: accetta lettere, spazio, apostrofo e trattino e li porta in forma pulita", () => {
  for (const [raw, expected] of VALID_NAMES) {
    const result = checkGuestName(raw, "firstName");
    assert.equal(result.problem, null, JSON.stringify(raw));
    assert.equal(result.message, null);
    assert.equal(result.value, expected, JSON.stringify(raw));
  }
});

test("nome e cognome: rifiuta vuoti, corti, lunghi, cifre, markup, URL e caratteri di controllo", () => {
  for (const [raw, problem] of INVALID_NAMES) {
    const result = checkGuestName(raw, "lastName");
    assert.equal(result.problem, problem, JSON.stringify(raw));
    assert.ok(result.message, JSON.stringify(raw));
  }
});

test("nome e cognome: i testi dell'errore parlano di nome o di cognome", () => {
  assert.equal(checkGuestName("", "firstName").message, "Scrivi il nome.");
  assert.equal(checkGuestName("", "lastName").message, "Scrivi il cognome.");
  assert.match(checkGuestName("A", "firstName").message, /nome è troppo corto.*2 lettere/u);
  assert.match(checkGuestName("a".repeat(41), "lastName").message, /cognome è troppo lungo.*40/u);
  assert.match(checkGuestName("Anna2", "firstName").message, /Nel nome puoi usare solo lettere/u);
  // Mai l'apostrofo al posto della lettera accentata nei testi (regola di progetto).
  assert.doesNotMatch(checkGuestName("Anna2", "lastName").message, /\b\w+'(?![\p{L}\p{N}])/u);
});

test("normalizeGuestName non cambia una stringa già pulita ed è idempotente", () => {
  for (const [raw] of VALID_NAMES) {
    const once = normalizeGuestName(raw);
    assert.equal(normalizeGuestName(once), once);
  }
});

// ---------------------------------------------------------------------------
// Bozza -> campi puliti
// ---------------------------------------------------------------------------

const UNITS = [{ id: "unit1", name: "Ramo 1" }, { id: "unit2", name: "Ramo 2" }];
const RECORDS = [{ id: "rec1" }, { id: "rec2" }];

const proposalDraft = (extra = {}) => ({
  kind: "proposal",
  firstName: " Marco ",
  lastName: "D’Angelo",
  unitId: "unit1",
  text: "  Salti   con la corda ",
  measure: "count_in_time",
  durationSeconds: 30,
  needs: " Una corda ",
  ...extra,
});

test("proposta valida: campi puliti e durata solo per le prove a tempo", () => {
  const result = validateGuestDraft(proposalDraft(), { units: UNITS });
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, {
    kind: "proposal",
    firstName: "Marco",
    lastName: "D'Angelo",
    unitId: "unit1",
    text: "Salti con la corda",
    measure: "count_in_time",
    durationSeconds: 30,
    needs: "Una corda",
  });
  const other = validateGuestDraft(proposalDraft({ measure: "other", durationSeconds: 45 }), { units: UNITS });
  assert.equal(other.ok, true);
  assert.equal(other.fields.durationSeconds, null, "per le altre misure la durata non parte");
});

test("proposta: gli errori sono per campo e riusano il copy esistente", () => {
  const empty = validateGuestDraft(
    { kind: "proposal", firstName: "", lastName: "", unitId: "", text: "", measure: "", needs: "" },
    { units: UNITS },
  );
  assert.equal(empty.ok, false);
  assert.deepEqual(Object.keys(empty.errors).sort(), ["firstName", "lastName", "measure", "text", "unitId"]);
  assert.equal(empty.errors.text, "Scrivi cosa fai.");
  assert.equal(empty.errors.measure, "Scegli come si misura.");
  assert.equal(empty.errors.unitId, "Scegli la tua unità.");

  const long = validateGuestDraft(proposalDraft({ text: "x".repeat(121), needs: "y".repeat(121) }), { units: UNITS });
  assert.equal(long.ok, false);
  assert.deepEqual(Object.keys(long.errors).sort(), ["needs", "text"]);
  assert.equal(validateGuestDraft(proposalDraft({ text: "x".repeat(120), needs: "y".repeat(120) }), { units: UNITS }).ok, true);

  assert.equal(validateGuestDraft(proposalDraft({ text: "Salti\u0000" }), { units: UNITS }).ok, false);
});

test("proposta: durata da 10 a 60 secondi interi per la prova a tempo", () => {
  for (const durationSeconds of [9, 61, 30.5, null, undefined, Number.NaN]) {
    const result = validateGuestDraft(proposalDraft({ durationSeconds }), { units: UNITS });
    assert.equal(result.ok, false, String(durationSeconds));
    assert.ok(result.errors.durationSeconds);
  }
  for (const durationSeconds of [10, 35, 60]) {
    assert.equal(validateGuestDraft(proposalDraft({ durationSeconds }), { units: UNITS }).ok, true);
  }
  assert.equal(validateGuestDraft(proposalDraft({ measure: "boh" }), { units: UNITS }).errors.measure, "Scegli come si misura.");
});

test("sfida: serve il record, non porta testo; l'unità e il record devono esistere", () => {
  const draft = { kind: "challenge", firstName: "Anna", lastName: "Bianchi", unitId: "unit2", recordId: "rec2" };
  const ok = validateGuestDraft({ ...draft, text: "ignorato", measure: "other" }, { units: UNITS, records: RECORDS });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.fields, {
    kind: "challenge",
    firstName: "Anna",
    lastName: "Bianchi",
    unitId: "unit2",
    recordId: "rec2",
  });
  assert.equal(validateGuestDraft({ ...draft, recordId: "" }, { units: UNITS }).errors.recordId, "Scegli il record da sfidare.");
  assert.equal(
    validateGuestDraft({ ...draft, recordId: "gone" }, { units: UNITS, records: RECORDS }).errors.recordId,
    "Questo record non è più disponibile.",
  );
  assert.equal(validateGuestDraft({ ...draft, unitId: "unit9" }, { units: UNITS }).errors.unitId, "Scegli la tua unità.");
  assert.equal(validateGuestDraft({ ...draft, unitId: "../x" }).ok, false);
  assert.equal(validateGuestDraft({ ...draft, kind: "altro" }).ok, false);
});

test("payload di invio: solo le chiavi ammesse per il tipo", () => {
  const proposal = validateGuestDraft(proposalDraft(), { units: UNITS }).fields;
  assert.deepEqual(Object.keys(buildGuestSubmitPayload("tok", proposal)).sort(), [
    "durationSeconds",
    "firstName",
    "kind",
    "lastName",
    "measure",
    "needs",
    "submissionId",
    "text",
    "unitId",
  ]);
  const noDuration = { ...proposal, measure: "distance", durationSeconds: 45 };
  assert.equal(buildGuestSubmitPayload("tok", noDuration).durationSeconds, null);

  const challenge = validateGuestDraft(
    { kind: "challenge", firstName: "Anna", lastName: "Bianchi", unitId: "unit1", recordId: "rec1" },
    { units: UNITS },
  ).fields;
  assert.deepEqual(Object.keys(buildGuestSubmitPayload("tok", challenge)).sort(), [
    "firstName",
    "kind",
    "lastName",
    "recordId",
    "submissionId",
    "unitId",
  ]);
});

// ---------------------------------------------------------------------------
// submissionId
// ---------------------------------------------------------------------------

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ID_SCHEMA = /^[A-Za-z0-9_-]{1,128}$/u;

test("submissionId: usa crypto.randomUUID se c'è", () => {
  assert.equal(createSubmissionId({ randomUUID: () => "11111111-2222-4333-8444-555555555555" }), "11111111-2222-4333-8444-555555555555");
  assert.match(createSubmissionId(), UUID_V4);
});

test("submissionId: senza randomUUID ripiega su getRandomValues, poi su Math.random", () => {
  let calls = 0;
  const viaValues = createSubmissionId({
    getRandomValues(array) {
      calls += 1;
      array.forEach((_, index) => {
        array[index] = (index * 37 + 11) & 0xff;
      });
      return array;
    },
  });
  assert.equal(calls, 1);
  assert.match(viaValues, UUID_V4);
  assert.match(createSubmissionId({}), UUID_V4);
  assert.match(createSubmissionId(null), UUID_V4);
  const ids = new Set(Array.from({ length: 200 }, () => createSubmissionId({})));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, ID_SCHEMA);
});

test("token del foglio: stessi campi = stesso token, campi cambiati o foglio nuovo = token nuovo", () => {
  let counter = 0;
  const keeper = createGuestSubmissionKeeper(() => `tok-${(counter += 1)}`);
  const a = validateGuestDraft(proposalDraft(), { units: UNITS }).fields;
  const b = validateGuestDraft(proposalDraft({ lastName: "Rossi" }), { units: UNITS }).fields;

  const first = keeper.tokenFor(a);
  assert.equal(keeper.tokenFor(a), first, "doppio tocco");
  assert.equal(keeper.tokenFor({ ...a }), first, "rinvio con gli stessi campi");
  const second = keeper.tokenFor(b);
  assert.notEqual(second, first, "campi cambiati dopo un invio non riuscito");
  assert.equal(keeper.tokenFor(b), second);
  keeper.renew();
  assert.notEqual(keeper.tokenFor(b), second, "foglio nuovo");
});

// ---------------------------------------------------------------------------
// Sessione anonima
// ---------------------------------------------------------------------------

function fakeAuth({ user = null, ready } = {}) {
  const auth = {
    currentUser: user,
    async authStateReady() {
      if (ready) await ready;
    },
  };
  return auth;
}

const REAL = { uid: "real1", isAnonymous: false };
const ANON = { uid: "anon1", isAnonymous: true };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("sessione: un account vero non riceve mai una sessione anonima", async () => {
  const auth = fakeAuth({ user: REAL });
  let signIns = 0;
  const gate = createAnonymousSessionGate(auth, async () => {
    signIns += 1;
  });
  await assert.rejects(gate.ensure(), (error) => error instanceof RecordNightGuestClientError && error.kind === "account");
  await assert.rejects(gate.requireExisting(), (error) => error.kind === "account");
  assert.equal(signIns, 0);
  assert.equal(auth.currentUser, REAL);
});

test("sessione: aspetta che Firebase abbia riletto la sessione salvata prima di decidere", async () => {
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  const auth = fakeAuth({ user: null, ready });
  let signIns = 0;
  const gate = createAnonymousSessionGate(auth, async () => {
    signIns += 1;
    auth.currentUser = ANON;
  });
  const pending = gate.ensure();
  await tick();
  assert.equal(signIns, 0, "prima che Firebase sia pronto non si crea nulla");
  // La sessione vera arriva dal disco proprio ora.
  auth.currentUser = REAL;
  release();
  await assert.rejects(pending, (error) => error.kind === "account");
  assert.equal(signIns, 0);
});

test("sessione: una sessione anonima già presente si riusa", async () => {
  const auth = fakeAuth({ user: ANON });
  let signIns = 0;
  const gate = createAnonymousSessionGate(auth, async () => {
    signIns += 1;
  });
  assert.equal(await gate.ensure(), "anon1");
  assert.equal(await gate.requireExisting(), "anon1");
  assert.equal(signIns, 0);
});

test("sessione: senza sessione la crea una volta sola anche con chiamate ravvicinate", async () => {
  const auth = fakeAuth();
  let signIns = 0;
  const gate = createAnonymousSessionGate(auth, async () => {
    signIns += 1;
    await tick();
    auth.currentUser = ANON;
  });
  const [one, two] = await Promise.all([gate.ensure(), gate.ensure()]);
  assert.deepEqual([one, two], ["anon1", "anon1"]);
  assert.equal(signIns, 1);
  assert.equal(await gate.ensure(), "anon1");
  assert.equal(signIns, 1, "la terza chiamata trova la sessione");
});

test("sessione: usa il signIn passato alla chiamata (quello dell'AuthProvider)", async () => {
  const auth = fakeAuth();
  let fromDefault = 0;
  let fromCaller = 0;
  const gate = createAnonymousSessionGate(auth, async () => {
    fromDefault += 1;
    auth.currentUser = ANON;
  });
  await gate.ensure(async () => {
    fromCaller += 1;
    auth.currentUser = ANON;
  });
  assert.deepEqual([fromDefault, fromCaller], [0, 1]);
});

test("sessione: requireExisting non crea nulla", async () => {
  const auth = fakeAuth();
  let signIns = 0;
  const gate = createAnonymousSessionGate(auth, async () => {
    signIns += 1;
  });
  await assert.rejects(gate.requireExisting(), (error) => error.kind === "session");
  assert.equal(signIns, 0);
});

test("sessione: un accesso fallito si può ritentare; un esito strano non passa", async () => {
  const auth = fakeAuth();
  let signIns = 0;
  const gate = createAnonymousSessionGate(auth, async () => {
    signIns += 1;
    if (signIns === 1) throw Object.assign(new Error("rete"), { code: "auth/network-request-failed" });
    auth.currentUser = ANON;
  });
  await assert.rejects(gate.ensure(), (error) => error.code === "auth/network-request-failed");
  assert.equal(await gate.ensure(), "anon1");
  assert.equal(signIns, 2);

  const strange = createAnonymousSessionGate(fakeAuth(), async () => {});
  await assert.rejects(strange.ensure(), (error) => error.kind === "session");
  const becameReal = fakeAuth();
  const swapped = createAnonymousSessionGate(becameReal, async () => {
    becameReal.currentUser = REAL;
  });
  await assert.rejects(swapped.ensure(), (error) => error.kind === "account");
});

// ---------------------------------------------------------------------------
// Errori delle callable
// ---------------------------------------------------------------------------

const callableError = (code, message = "messaggio del server") => Object.assign(new Error(message), { code });

test("errori: si distingue sul codice, e sul messaggio solo dove il codice è lo stesso", () => {
  const cases = [
    [callableError("functions/permission-denied", GUEST_COPY.account), "account"],
    [callableError("functions/permission-denied", "altro testo"), "account"],
    [callableError("functions/unauthenticated"), "session"],
    [callableError("functions/invalid-argument"), "invalid"],
    [callableError("functions/not-found"), "unavailable"],
    [callableError("functions/failed-precondition", SERVER_GUEST_MESSAGES.closed), "closed"],
    [callableError("functions/failed-precondition", SERVER_GUEST_MESSAGES.disabled), "disabled"],
    [callableError("functions/failed-precondition", SERVER_GUEST_MESSAGES.phoneCap), "phone_limit"],
    [callableError("functions/failed-precondition", SERVER_GUEST_MESSAGES.recordGone), "record_gone"],
    [callableError("functions/failed-precondition", "Non riesco a riceverla ora. Parlane con il dirigente della tua unità."), "unavailable"],
    [callableError("functions/failed-precondition", "qualunque altra cosa"), "unavailable"],
    [callableError("functions/unavailable"), "network"],
    [callableError("functions/deadline-exceeded"), "network"],
    [callableError("functions/internal"), "network"],
    [callableError("functions/resource-exhausted"), "busy"],
    [callableError("auth/network-request-failed"), "network"],
    [callableError("auth/too-many-requests"), "busy"],
    [callableError("auth/operation-not-allowed"), "session"],
    [callableError("functions/boh"), "unknown"],
    [new Error("TypeError: x is undefined"), "unknown"],
    [null, "unknown"],
    ["stringa", "unknown"],
  ];
  for (const [error, kind] of cases) {
    assert.equal(classifyGuestError(error), kind, String(error?.code ?? error));
  }
});

test("errori: il testo è neutro, in italiano e non espone mai il messaggio sconosciuto", () => {
  const leaks = ["TypeError: x is undefined", "internal error stack", "FirebaseError: auth/xyz", "messaggio del server"];
  for (const code of ["functions/internal", "functions/boh", "functions/unavailable", "auth/boh", "functions/invalid-argument", "functions/not-found"]) {
    for (const leak of leaks) {
      for (const action of ["load", "submit", "withdraw", "restore"]) {
        const message = getRecordNightGuestErrorMessage(callableError(code, leak), action);
        assert.ok(message.length > 5);
        assert.ok(!leaks.some((item) => message.includes(item)), `${code}/${action}: ${message}`);
      }
    }
  }
  assert.equal(getRecordNightGuestErrorMessage(new TypeError("boom")), "Non è stato possibile completare l'operazione. Controlla la connessione e riprova.");
  assert.equal(getRecordNightGuestErrorMessage(undefined), "Non è stato possibile completare l'operazione. Controlla la connessione e riprova.");
});

test("errori: i testi della spec per account, chiusura, tetti e richiesta non gestibile", () => {
  const message = (code, text, action) => getRecordNightGuestErrorMessage(callableError(code, text), action);
  assert.equal(message("functions/permission-denied", "x"), "Hai un account: accedi");
  assert.equal(message("functions/failed-precondition", SERVER_GUEST_MESSAGES.closed), "Le iscrizioni ai record sono chiuse.");
  assert.equal(
    message("functions/failed-precondition", SERVER_GUEST_MESSAGES.phoneCap),
    "Hai già inviato il massimo di richieste da questo telefono.",
  );
  assert.equal(
    message("functions/failed-precondition", "x", "submit"),
    "Non riesco a riceverla ora. Parlane con il dirigente della tua unità.",
  );
  assert.equal(
    message("functions/failed-precondition", "x", "withdraw"),
    "Non riesco a ritirarla ora. Parlane con il dirigente della tua unità.",
  );
  assert.equal(
    message("functions/failed-precondition", "x", "restore"),
    "Non riesco a ripristinarla ora. Parlane con il dirigente della tua unità.",
  );
});

test("errori: quelli nati nel client portano già il loro testo", () => {
  const invalid = new RecordNightGuestClientError("invalid", "Scrivi il nome.", { firstName: "Scrivi il nome." });
  assert.equal(classifyGuestError(invalid), "invalid");
  assert.equal(getRecordNightGuestErrorMessage(invalid, "withdraw"), "Scrivi il nome.");
  assert.deepEqual(invalid.fieldErrors, { firstName: "Scrivi il nome." });
  assert.ok(invalid instanceof Error);
  const account = new RecordNightGuestClientError("account", GUEST_COPY.account);
  assert.equal(getRecordNightGuestErrorMessage(account), "Hai un account: accedi");
});

// ---------------------------------------------------------------------------
// Stati e testi
// ---------------------------------------------------------------------------

test("tabella degli stati: testi esatti della spec", () => {
  assert.deepEqual(Object.keys(GUEST_STATE_TEXTS).sort(), [
    "approved",
    "not_linked",
    "pending",
    "received",
    "rejected",
    "removed",
    "withdrawn",
  ]);
  assert.deepEqual(getGuestStateText("received"), { title: "Richiesta ricevuta", description: "La controlla un adulto." });
  assert.deepEqual(getGuestStateText("received", { closed: true }), {
    title: "Le iscrizioni sono chiuse",
    description: "Se non vedi «Ci sei», parlane con il dirigente della tua unità.",
  });
  assert.equal(getGuestStateText("withdrawn").title, "Ritiro fatto");
  assert.deepEqual(getGuestStateText("not_linked"), {
    title: "Non siamo riusciti a collegare la richiesta",
    description: "Se hai già l'iscrizione al viaggio, parlane con il dirigente della tua unità.",
  });
  assert.equal(getGuestStateText("pending").title, "In attesa di approvazione");
  assert.equal(getGuestStateText("approved").title, "Ci sei");
  assert.equal(getGuestStateText("rejected").title, "Non accettata");
  assert.deepEqual(getGuestStateText("removed"), {
    title: "Non sei più in elenco",
    description: "Se non lo volevi, parlane con un dirigente.",
  });
});

test("tabella degli stati: il motivo c'è solo per \"Non accettata\"; la chiusura cambia solo \"ricevuta\"", () => {
  assert.equal(getGuestStateText("rejected", { reason: "  Troppo rischioso.  " }).description, "Troppo rischioso.");
  assert.equal(getGuestStateText("rejected").description, "");
  assert.equal(getGuestStateText("pending", { reason: "non deve comparire" }).description, GUEST_STATE_TEXTS.pending.description);
  for (const state of ["withdrawn", "not_linked", "pending", "approved", "rejected", "removed"]) {
    assert.deepEqual(getGuestStateText(state, { closed: true }), getGuestStateText(state));
  }
  assert.deepEqual(getGuestStateText("boh"), getGuestStateText("received"));
});

test("testi fissi: nessun apostrofo al posto della lettera accentata", () => {
  const texts = [
    ...Object.values(GUEST_COPY),
    ...Object.values(SERVER_GUEST_MESSAGES),
    ...Object.values(GUEST_STATE_TEXTS).flatMap((item) => [item.title, item.description, item.closed?.title, item.closed?.description]),
  ].filter(Boolean);
  for (const text of texts) assert.doesNotMatch(text, /\b(?:pi|gi|unit|cio|puo|perche)'(?![\p{L}\p{N}])/iu, text);
});

// ---------------------------------------------------------------------------
// Contesto pubblico, richieste del telefono
// ---------------------------------------------------------------------------

test("intakeOpen: il server lo accende, la chiusura lo spegne anche senza ricaricare", () => {
  const context = { intakeOpen: true, closeAt: "2026-10-15T19:00:00.000Z" };
  assert.equal(isGuestIntakeOpen(context, new Date("2026-10-15T18:59:59.000Z")), true);
  assert.equal(isGuestIntakeOpen(context, new Date("2026-10-15T19:00:00.000Z")), false);
  assert.equal(isGuestIntakeOpen({ ...context, intakeOpen: false }, new Date("2026-10-01T00:00:00.000Z")), false);
  assert.equal(isGuestIntakeOpen({ intakeOpen: true, closeAt: null }), false);
  assert.equal(isGuestIntakeOpen({ intakeOpen: true, closeAt: "boh" }), false);
  assert.equal(isGuestIntakeOpen(null), false);
});

test("record pubblici: per categoria nell'ordine fisso e per titolo, senza conteggi", () => {
  const records = [
    { id: "c", title: "Zeta", category: "mente", measure: "other", durationSeconds: null },
    { id: "a", title: "Salti", category: "resistenza", measure: "count_in_time", durationSeconds: 30 },
    { id: "b", title: "Apnea", category: "resistenza", measure: "longest_time", durationSeconds: null },
  ];
  const groups = groupPublicRecordsByCategory(records);
  assert.deepEqual(groups.map((group) => group.category), ["resistenza", "mente"]);
  assert.deepEqual(groups[0].records.map((record) => record.id), ["b", "a"]);
  assert.deepEqual(groupPublicRecordsByCategory([]), []);
});

test("tetto del telefono: contano solo le richieste in coda", () => {
  const requests = (states) => states.map((state) => ({ state }));
  assert.equal(countOpenGuestRequests(requests(["received", "withdrawn", "pending", "received"])), 2);
  assert.equal(isAtGuestPhoneLimit(requests(Array(RECORD_NIGHT_GUEST_LIMITS.openPerPhone - 1).fill("received"))), false);
  assert.equal(isAtGuestPhoneLimit(requests(Array(RECORD_NIGHT_GUEST_LIMITS.openPerPhone).fill("received"))), true);
  assert.equal(isAtGuestPhoneLimit(requests(Array(10).fill("approved"))), false);
});

// ---------------------------------------------------------------------------
// Risposte del server -> tipi
// ---------------------------------------------------------------------------

test("mapper del contesto: valori mancanti o strani diventano valori neutri", () => {
  assert.deepEqual(mapGuestContext(null), { open: false, closeAt: null, intakeOpen: false, units: [], records: [] });
  assert.deepEqual(
    mapGuestContext({
      open: true,
      closeAt: "2026-10-15T19:00:00.000Z",
      intakeOpen: true,
      units: [{ id: "u1", name: "Ramo 1" }, { name: "senza id" }, null, "x"],
      records: [
        { id: "r1", title: "Salti", category: "resistenza", measure: "count_in_time", durationSeconds: 30 },
        { id: "r2", title: "Boh", category: "sconosciuta", measure: "strana", durationSeconds: "x" },
        { title: "senza id" },
      ],
    }),
    {
      open: true,
      closeAt: "2026-10-15T19:00:00.000Z",
      intakeOpen: true,
      units: [{ id: "u1", name: "Ramo 1" }],
      records: [
        { id: "r1", title: "Salti", category: "resistenza", measure: "count_in_time", durationSeconds: 30 },
        { id: "r2", title: "Boh", category: "fantasia", measure: "other", durationSeconds: null },
      ],
    },
  );
  assert.equal(mapGuestContext({ open: "true", intakeOpen: 1 }).open, false);
});

test("mapper di mine: stato sconosciuto = ricevuta, richieste senza id scartate", () => {
  const mine = mapGuestMine({
    open: true,
    closeAt: null,
    requests: [
      { requestId: "r1", kind: "challenge", firstName: "Anna", lastName: "Bianchi", unitName: "Ramo 1", recordId: "rec1", recordTitle: "Salti", state: "approved", canWithdraw: false, canRestore: false },
      { requestId: "r2", state: "nuovo-stato" },
      { state: "pending" },
    ],
  });
  assert.equal(mine.open, true);
  assert.deepEqual(mine.requests.map((request) => [request.requestId, request.state]), [["r1", "approved"], ["r2", "received"]]);
  assert.equal(mine.requests[0].kind, "challenge");
  assert.equal(mine.requests[0].recordTitle, "Salti");
  assert.deepEqual(mapGuestMine(undefined), { open: false, closeAt: null, requests: [] });
});

test("mapper dello staff: coda, doppioni e suggerimenti", () => {
  const queue = mapStaffQueue({
    requests: [
      {
        id: "r1",
        status: "open",
        kind: "proposal",
        firstName: "Marco",
        lastName: "Rossi",
        unitId: "u1",
        unitName: "Ramo 1",
        personKey: "marco rossi|u1",
        proposedText: "Salto",
        proposedMeasure: "count_in_time",
        proposedDurationSeconds: 30,
        proposedNeeds: "",
        duplicates: ["r2", 5, null],
        suggestions: [{ registrationId: "user_a", name: "Marco Rossi", unitName: "Ramo 1", type: "child", activeEntries: 1, alreadyOnRecord: true }, null],
        createdAt: "2026-10-10T08:00:00.000Z",
        updatedAt: "2026-10-10T08:00:00.000Z",
      },
      { id: "", status: "open" },
    ],
    openCount: 1,
    openLimit: 100,
  });
  assert.equal(queue.requests.length, 1);
  assert.equal(queue.openCount, 1);
  assert.equal(queue.openLimit, 100);
  const [request] = queue.requests;
  assert.deepEqual(request.duplicates, ["r2"]);
  assert.deepEqual(request.suggestions, [
    { registrationId: "user_a", name: "Marco Rossi", unitName: "Ramo 1", type: "child", activeEntries: 1, alreadyOnRecord: true },
  ]);
  assert.equal(request.recordTitle, null);
  assert.deepEqual(mapStaffQueue(null), { requests: [], openCount: 0, openLimit: 0 });
  // Negli esiti delle azioni non ci sono doppioni e suggerimenti: restano vuoti.
  const result = mapStaffRequest({ id: "r9", requestId: "r9", status: "linked", kind: "challenge", recordId: "rec1" });
  assert.deepEqual([result.id, result.status, result.duplicates, result.suggestions], ["r9", "linked", [], []]);
});

// ---------------------------------------------------------------------------
// Coda dello staff
// ---------------------------------------------------------------------------

const staffRequest = (id, extra = {}) =>
  mapStaffRequest({
    id,
    status: "open",
    kind: "proposal",
    firstName: "Nome",
    lastName: id,
    unitId: "u1",
    unitName: "Ramo 1",
    createdAt: `2026-10-10T08:0${id.length}:00.000Z`,
    updatedAt: "2026-10-10T08:00:00.000Z",
    suggestions: [],
    ...extra,
  });

const suggestion = { registrationId: "user_a", name: "Nome", unitName: "Ramo 1", type: "user", activeEntries: 0, alreadyOnRecord: false };

test("coda: sezioni separate, le aperte dalla più vecchia", () => {
  const sections = splitStaffRequests([
    staffRequest("bb", { createdAt: "2026-10-10T09:00:00.000Z" }),
    staffRequest("a", { createdAt: "2026-10-10T08:00:00.000Z" }),
    staffRequest("c", { status: "rejected", updatedAt: "2026-10-10T10:00:00.000Z" }),
    staffRequest("d", { status: "rejected", updatedAt: "2026-10-10T11:00:00.000Z" }),
    staffRequest("e", { status: "withdrawn" }),
    staffRequest("f", { status: "linked" }),
  ]);
  assert.deepEqual(sections.open.map((request) => request.id), ["a", "bb"]);
  assert.deepEqual(sections.notLinked.map((request) => request.id), ["d", "c"]);
  assert.deepEqual(sections.withdrawn.map((request) => request.id), ["e"]);
  assert.deepEqual(sections.linked.map((request) => request.id), ["f"]);
});

test("coda: filtro per unità, \"Senza abbinamento\" e la sua unità in alto", () => {
  const open = [
    staffRequest("a", { unitId: "u1", unitName: "Ramo 1", suggestions: [suggestion] }),
    staffRequest("b", { unitId: "u2", unitName: "Ramo 2" }),
    staffRequest("c", { unitId: "u2", unitName: "Ramo 2", suggestions: [suggestion] }),
    staffRequest("d", { unitId: "u3", unitName: "Ramo 3" }),
  ];
  assert.deepEqual(filterStaffQueue(open).map((request) => request.id), ["a", "b", "c", "d"]);
  assert.deepEqual(filterStaffQueue(open, { unitId: "u2" }).map((request) => request.id), ["b", "c"]);
  assert.deepEqual(filterStaffQueue(open, { unmatchedOnly: true }).map((request) => request.id), ["b", "d"]);
  assert.deepEqual(filterStaffQueue(open, { unitId: "u2", unmatchedOnly: true }).map((request) => request.id), ["b"]);
  assert.deepEqual(filterStaffQueue(open, {}, { unitId: "u2" }).map((request) => request.id), ["b", "c", "a", "d"]);
  assert.deepEqual(filterStaffQueue(open, {}, { unitName: "  RAMO 3 " }).map((request) => request.id), ["d", "a", "b", "c"]);

  const filters = buildStaffQueueUnitFilters(open, { unitId: "u3" });
  assert.deepEqual(filters.map((item) => [item.unitId, item.count, item.isOwn]), [["u3", 1, true], ["u1", 1, false], ["u2", 2, false]]);
});

test("rifiuto in blocco: gruppi da 50 senza doppioni", () => {
  const ids = Array.from({ length: 120 }, (_, index) => `r${index}`);
  const chunks = chunkRequestIds([...ids, "r0", "r1"]);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [50, 50, 20]);
  assert.equal(MAX_BULK_REJECT_REQUESTS, 50);
  assert.deepEqual(chunkRequestIds([]), []);
  assert.deepEqual(chunkRequestIds(["a", "b", "c"], 2), [["a", "b"], ["c"]]);
});

// ---------------------------------------------------------------------------
// Contratto con il backend (functions/lib, senza emulatori)
// ---------------------------------------------------------------------------

const SERVICE_SOURCE = readFileSync(new URL("../src/services/firestore/recordNightGuestService.ts", import.meta.url), "utf8").replace(
  /\/\/.*$/gmu,
  "",
);

// Chiavi del payload di ogni chiamata `callGuest(stakeId, activityId, "azione", {...})`
// / `callStaff(...)` del servizio, lette dal sorgente (non copiate qui): se il client
// aggiunge o rinomina un campo, il parser del server lo rifiuta e questa prova diventa rossa.
function clientCalls() {
  const calls = [];
  const pattern = /call(Guest|Staff)\(\s*stakeId,\s*activityId,\s*"(\w+)"\s*(,\s*)?/gu;
  for (const match of SERVICE_SOURCE.matchAll(pattern)) {
    const rest = SERVICE_SOURCE.slice(match.index + match[0].length);
    if (!match[3] || !rest.startsWith("{")) {
      calls.push({ callee: match[1], action: match[2], keys: [], builder: match[3] ? /^\w+\(/u.test(rest) : false });
      continue;
    }
    const keys = [];
    let depth = 0;
    let segment = "";
    const flush = () => {
      const part = segment.trim();
      segment = "";
      if (!part) return;
      if (part.startsWith("...")) keys.push(...[...part.matchAll(/\{\s*(\w+)\s*[:},]/gu)].map((item) => item[1]));
      else keys.push(/^(\w+)/u.exec(part)[1]);
    };
    for (let index = 1; index < rest.length; index += 1) {
      const char = rest[index];
      if ("{([".includes(char)) depth += 1;
      else if ("})]".includes(char)) {
        if (depth === 0) {
          flush();
          break;
        }
        depth -= 1;
      }
      if (char === "," && depth === 0) flush();
      else segment += char;
    }
    calls.push({ callee: match[1], action: match[2], keys, builder: false });
  }
  return calls;
}

const SAMPLE_VALUES = {
  requestId: "req1",
  registrationId: "user_abc",
  verified: true,
  requestIds: ["req1", "req2"],
  note: "una nota",
};

test("contratto: nomi e payload delle chiamate del servizio sono accettati dai parser del server", needsBackend, () => {
  const calls = clientCalls();
  const guestActions = calls.filter((call) => call.callee === "Guest").map((call) => call.action).sort();
  const staffActions = calls.filter((call) => call.callee === "Staff").map((call) => call.action).sort();
  assert.deepEqual(guestActions, ["context", "mine", "restore", "submit", "withdraw"]);
  assert.deepEqual(staffActions, ["linkRequest", "listRequests", "rejectRequest", "rejectRequests", "reopenRequest", "unlinkRequest"]);
  assert.deepEqual(
    [...SERVICE_SOURCE.matchAll(/httpsCallable<[\s\S]*?>\(\s*functions,\s*"(\w+)"/gu)].map((match) => match[1]).sort(),
    ["recordNightAdmin", "recordNightGuest"],
  );

  for (const call of calls) {
    const base = { stakeId: "stake1", activityId: "act1", action: call.action };
    if (call.callee === "Guest" && call.action === "submit") {
      assert.ok(call.builder, "submit manda il payload di buildGuestSubmitPayload");
      continue;
    }
    const values = {};
    for (const key of call.keys) {
      assert.ok(Object.hasOwn(SAMPLE_VALUES, key), `il client manda "${key}" per ${call.action}, che la prova non conosce`);
      values[key] = SAMPLE_VALUES[key];
    }
    const parsed =
      call.callee === "Guest"
        ? backend.guest.parseGuestRequest({ ...base, ...values })
        : backend.night.parseAdminRequest({ ...base, ...values });
    assert.equal(parsed.action, call.action);
  }
});

test("contratto: i payload di invio passano il parser del server e ne escono gli stessi valori", needsBackend, () => {
  const base = { stakeId: "stake1", activityId: "act1", action: "submit" };
  for (const measure of ["count_in_time", "count_streak", "longest_time", "fastest_time", "distance", "other"]) {
    const draft = proposalDraft({ measure, durationSeconds: measure === "count_in_time" ? 30 : 45 });
    const { fields } = validateGuestDraft(draft, { units: UNITS });
    const payload = buildGuestSubmitPayload("11111111-2222-4333-8444-555555555555", fields);
    const parsed = backend.guest.parseGuestRequest({ ...base, ...payload }).fields;
    assert.equal(parsed.kind, "proposal");
    assert.equal(parsed.firstName, fields.firstName);
    assert.equal(parsed.lastName, fields.lastName);
    assert.equal(parsed.text, fields.text);
    assert.equal(parsed.measure, measure);
    assert.equal(parsed.durationSeconds, measure === "count_in_time" ? 30 : null);
    assert.equal(parsed.needs, fields.needs);
    assert.equal(parsed.submissionId, "11111111-2222-4333-8444-555555555555");
  }
  const challenge = validateGuestDraft(
    { kind: "challenge", firstName: "Anna", lastName: "Bianchi", unitId: "unit2", recordId: "rec2" },
    { units: UNITS },
  ).fields;
  const parsed = backend.guest.parseGuestRequest({ ...base, ...buildGuestSubmitPayload(createSubmissionId(), challenge) }).fields;
  assert.equal(parsed.kind, "challenge");
  assert.equal(parsed.recordId, "rec2");
  assert.equal(parsed.text, null);
  // Un token generato dal client passa lo schema degli id del server.
  assert.doesNotThrow(() => backend.guest.parseGuestRequest({ ...base, ...buildGuestSubmitPayload(createSubmissionId({}), challenge) }));
});

test("contratto: nome e cognome, ciò che parte lo accetta il server e il client non è più severo", needsBackend, () => {
  const corpus = [...VALID_NAMES.map(([raw]) => raw), ...INVALID_NAMES.map(([raw]) => raw), "Marc\u00ed\u00e1", "Mc Donald", "De  Luca", "Anna\u00a0Maria", "Zo\u00eb", "Nguy\u1ec5n", "\u0141ukasz", "O\u2019Brien", "L'Aquila", "Mary-Jane", "Jean Claude Van Damme"];
  const serverVerdict = (value) => {
    try {
      return backend.guest.parsePersonName(value, "Nome");
    } catch {
      return null;
    }
  };
  for (const raw of corpus) {
    const client = checkGuestName(raw, "firstName");
    const label = `${JSON.stringify(raw)}: client ${client.problem}`;
    if (client.problem === null) {
      // Il valore che parte (già pulito) lo accetta il server e non lo cambia.
      assert.equal(serverVerdict(client.value), client.value, label);
    } else {
      // Se il client rifiuta, rifiuta anche il server: nessun nome valido respinto.
      assert.equal(serverVerdict(raw), null, label);
    }
    // Quando il server accetta il testo così com'è, il client ne ricava lo stesso valore.
    const direct = serverVerdict(raw);
    if (direct !== null) assert.equal(client.value, direct, label);
  }
});

test("contratto: i testi di errore del server che il client riconosce sono quelli veri", needsBackend, () => {
  const { MESSAGES } = backend.guest;
  assert.equal(SERVER_GUEST_MESSAGES.closed, MESSAGES.closed);
  assert.equal(SERVER_GUEST_MESSAGES.disabled, MESSAGES.disabled);
  assert.equal(SERVER_GUEST_MESSAGES.phoneCap, MESSAGES.phoneCap);
  assert.equal(GUEST_COPY.account, MESSAGES.account);
  assert.equal(getRecordNightGuestErrorMessage(callableError("functions/failed-precondition", MESSAGES.unavailable), "submit"), MESSAGES.unavailable);
  const guestSource = readFileSync(new URL("../functions/lib/recordNightGuest.js", import.meta.url), "utf8");
  assert.ok(guestSource.includes(`"${SERVER_GUEST_MESSAGES.recordGone}"`), "il server non scrive più il testo del record non disponibile");
});

test("contratto: gli stati di mine del server sono quelli della tabella dei testi", needsBackend, () => {
  const { deriveRequesterState } = backend.guest;
  const states = new Set();
  for (const status of ["open", "withdrawn", "rejected", "linked"]) {
    for (const entry of [null, { status: "pending" }, { status: "approved" }, { status: "rejected" }, { status: "withdrawn" }]) {
      states.add(deriveRequesterState({ status }, entry));
    }
  }
  assert.deepEqual([...states].sort(), Object.keys(GUEST_STATE_TEXTS).sort());
});

test("contratto: mine del server letto dal client, campo per campo", needsBackend, () => {
  const request = (extra = {}) => ({
    kind: "proposal",
    firstName: "Marco",
    lastName: "Rossi",
    unitName: "Ramo 1",
    proposedText: "Salti con la corda",
    proposedMeasure: "count_in_time",
    proposedDurationSeconds: 30,
    proposedNeeds: "Una corda",
    recordId: null,
    status: "open",
    staffNote: "NOTA INTERNA",
    anonUid: "uid-segreto",
    linkedRegistrationId: "user_segreto",
    createdAt: "2026-10-10T08:00:00.000Z",
    ...extra,
  });
  const read = (data, entry, extra = {}) =>
    mapGuestRequest(backend.guest.buildMineItem("req1", data, entry, { recordTitle: null, windowOpen: true, ...extra }));

  const received = read(request(), null);
  assert.deepEqual(received, {
    requestId: "req1",
    kind: "proposal",
    firstName: "Marco",
    lastName: "Rossi",
    unitName: "Ramo 1",
    text: "Salti con la corda",
    measure: "count_in_time",
    durationSeconds: 30,
    needs: "Una corda",
    recordId: null,
    recordTitle: null,
    state: "received",
    reason: "",
    createdAt: "2026-10-10T08:00:00.000Z",
    canWithdraw: true,
    canRestore: false,
  });
  // Nessun campo in più o in meno rispetto a quelli che il server manda.
  const serverItem = backend.guest.buildMineItem("req1", request(), null, { recordTitle: null, windowOpen: true });
  assert.deepEqual(Object.keys(received).sort(), Object.keys(serverItem).sort());
  assert.doesNotMatch(JSON.stringify(received), /uid-segreto|user_segreto|NOTA INTERNA/u);

  assert.equal(read(request({ status: "withdrawn" }), null).canRestore, true);
  assert.equal(read(request(), null, { windowOpen: false }).canWithdraw, false);
  const challenge = read(request({ kind: "challenge", recordId: "rec1" }), null, { recordTitle: "Salti" });
  assert.deepEqual([challenge.kind, challenge.recordId, challenge.recordTitle, challenge.text, challenge.measure], ["challenge", "rec1", "Salti", null, null]);
  const rejected = read(request({ status: "linked", linkedEntryId: "e1" }), { status: "rejected", rejectionReason: "Troppo rischioso." });
  assert.deepEqual([rejected.state, rejected.reason], ["rejected", "Troppo rischioso."]);
  assert.equal(read(request({ status: "linked", linkedEntryId: "e1" }), { status: "withdrawn" }).state, "removed");
});

test("contratto: richiesta dello staff e suggerimenti del server letti dal client", needsBackend, () => {
  const { staffRequestView, buildRequestSuggestions } = backend.night;
  const data = {
    status: "open",
    kind: "proposal",
    firstName: "Marco",
    lastName: "Rossi",
    unitId: "u1",
    unitName: "Ramo 1",
    personKey: "marco rossi|u1",
    proposedText: "Salti con la corda",
    proposedMeasure: "count_in_time",
    proposedDurationSeconds: 30,
    proposedNeeds: "",
    recordId: null,
    staffNote: "da controllare",
    anonUid: "uid-segreto",
    submissionId: "sub-segreto",
    expiresAt: { seconds: 1, nanoseconds: 0 },
    createdAt: "2026-10-10T08:00:00.000Z",
    updatedAt: "2026-10-10T08:05:00.000Z",
  };
  const view = staffRequestView("req1", data);
  const mapped = mapStaffRequest(view);
  assert.equal(mapped.id, "req1");
  assert.equal(mapped.staffNote, "da controllare");
  assert.equal(mapped.unitId, "u1");
  assert.equal(mapped.personKey, "marco rossi|u1");
  assert.equal(mapped.proposedDurationSeconds, 30);
  assert.doesNotMatch(JSON.stringify(mapped), /uid-segreto|sub-segreto/u);
  // Ogni campo del server arriva al client (requestId è un doppione di id); il client
  // aggiunge solo quelli che metterà listRequests.
  const expectedKeys = new Set([...Object.keys(view).filter((key) => key !== "requestId"), "recordTitle", "recordStatus", "duplicates", "suggestions"]);
  assert.deepEqual(new Set(Object.keys(mapped)), expectedKeys);

  const registrations = [
    { id: "user_a", data: { firstName: "Marco", lastName: "Rossi", unitId: "u1", unitName: "Ramo 1" } },
    { id: "child_p_k", data: { firstName: "Marco", lastName: "Rossi", unitId: "u2", unitName: "Ramo 2" } },
    { id: "manual_x", data: { fullName: "Laura Verdi", unitName: "Ramo 1" } },
  ];
  const entries = new Map([["user_a", [{ id: "e1", status: "approved", kind: "proposal", proposedText: "Salti con la corda", proposedMeasure: "count_in_time", proposedDurationSeconds: 30 }]]]);
  const suggestions = buildRequestSuggestions(data, registrations, entries);
  assert.ok(suggestions.length >= 2);
  const read = mapStaffRequest({ ...view, duplicates: ["req2"], suggestions }).suggestions;
  assert.deepEqual(read, suggestions, "il client non perde né cambia nessun campo del suggerimento");
  const userSuggestion = read.find((item) => item.registrationId === "user_a");
  assert.deepEqual([userSuggestion.type, userSuggestion.activeEntries, userSuggestion.alreadyOnRecord], ["user", 1, true]);
  assert.equal(read.find((item) => item.registrationId === "child_p_k").type, "child");
  assert.ok(read.every((item) => ["user", "child", "manual"].includes(item.type)));
});

test("contratto: categorie e misure dei record pubblici sono quelle del server", needsBackend, () => {
  const { RECORD_CATEGORIES, RECORD_MEASURES } = backend.night;
  const context = mapGuestContext({
    records: [...RECORD_CATEGORIES.map((category, index) => ({ id: `c${index}`, title: category, category, measure: "other" })), ...RECORD_MEASURES.map((measure, index) => ({ id: `m${index}`, title: measure, category: "mente", measure }))],
  });
  assert.deepEqual(context.records.slice(0, RECORD_CATEGORIES.length).map((record) => record.category), RECORD_CATEGORIES);
  assert.deepEqual(context.records.slice(RECORD_CATEGORIES.length).map((record) => record.measure), RECORD_MEASURES);
});

test("contratto: i limiti e le lunghezze del client sono quelli del server", needsBackend, () => {
  const { guest, night } = backend;
  assert.equal(RECORD_NIGHT_GUEST_LIMITS.openPerPhone, guest.MAX_OPEN_PER_PHONE);
  assert.equal(RECORD_NIGHT_GUEST_LIMITS.openPerPerson, guest.MAX_OPEN_PER_PERSON);
  assert.equal(RECORD_NIGHT_GUEST_LIMITS.openPerActivity, night.MAX_OPEN_REQUESTS_PER_ACTIVITY);
  assert.equal(MAX_BULK_REJECT_REQUESTS, night.MAX_BULK_REJECT);
  // Testi e "serve qualcosa": al limite passano, un carattere in più no, su entrambi i lati.
  const base = { stakeId: "s", activityId: "a", action: "submit", submissionId: "t", kind: "proposal", firstName: "Anna", lastName: "Bianchi", unitId: "u1", measure: "other" };
  for (const [field, key] of [["text", "text"], ["needs", "needs"]]) {
    const atLimit = { ...base, text: "x", needs: "", [key]: "x".repeat(night.LIMITS[field]) };
    assert.doesNotThrow(() => guest.parseGuestRequest(atLimit));
    assert.throws(() => guest.parseGuestRequest({ ...atLimit, [key]: "x".repeat(night.LIMITS[field] + 1) }));
  }
});
