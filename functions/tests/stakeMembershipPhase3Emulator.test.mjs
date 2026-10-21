// Appartenenza al palo (S2), fase 3: le aggiunte server provate nell'emulatore
// Functions DAL CONTRATTO di docs/APPARTENENZA_AL_PALO.md («Aggiunte server
// della fase 3 (2026-10-21)», con l'interfaccia della fase 2 per azioni, errori,
// `previous` e history): la nota dello staff "stesso nome e data"
// (`members/{uid}/staff/note`), l'azione `hasAccount` e il promemoria dopo 48
// ore (`stakeMembershipQueueReminder`, provato attraverso la funzione nuda
// `runStakeMembershipQueueReminder({ db, nowMs, sendPush })` con un invio del
// push finto che registra le chiamate). Utenti VERI dell'Auth emulator e SDK
// client per callable e rules; l'Admin SDK semina e ispeziona (ignora le
// rules). Scritto prima del codice, da chi non lo ha letto: una cella rossa è
// un disaccordo fra spec e codice, e uno dei due è un bug.
//
// Rilancio (Auth 9429, Firestore 8429, Functions 5429, hub 4429; progetto demo-*;
// la porta delle Functions si chiede all'hub):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only auth,firestore,functions --config firebase.membership-functions-test.json --project demo-s2-functions \
//     'node --test --test-concurrency=1 functions/tests/stakeMembershipPhase3Emulator.test.mjs'
// Sul Mac mini, da un worktree: `npm ci && (cd functions && npm ci)` nello
// stesso comando (ogni sync cancella i node_modules ignorati).
//
// Il trigger `onUserStakeMembership` gira davvero nell'emulatore: ogni profilo
// seminato con l'Admin SDK lo fa partire. Perciò si semina PRIMA il members e
// POI il profilo coerente, e prima di ogni azione si aspetta la quiete dei
// members del giro (settleAll). Un members si toglie con `recursiveDelete`: un
// `delete()` del solo documento lascerebbe history e `staff/note`.
//
// Interpretazioni scelte dove la spec lascia margine (sempre la più stretta):
//  - ogni caso della nota usa un anno di nascita proprio: il confronto parte
//    dai membri attivi con lo stesso `birthYear`, così i casi non si vedono fra
//    loro; il tetto dei 30 profili si prova in un palo a parte;
//  - la nota si prova con gli attivi dello stesso palo: un doppione `pending` o
//    `declined`, o attivo in un altro palo, non conta;
//  - `hasAccount` su `declined` è «identico a un rifiuto»: come `decline` può
//    essere `changed: false`, oppure `invalid_state` (la tabella dice solo
//    `pending` → `declined`); in entrambi i casi il documento non si riscrive.
//    Da `active`, `withdrawn` e `blocked` è `invalid_state`;
//  - il richiedente legge il proprio members, `previous` compreso: dopo
//    `hasAccount` lì l'azione è `decline` (chiarimento del 2026-10-21), e solo
//    la riga di history dice `hasAccount`;
//  - il promemoria conta come in ritardo ogni `pending` con `requestedAt` più
//    vecchio di 48 ore (47 ore no, 49 sì; il confine esatto non si prova);
//    `sendPush` finto: una chiamata per palo e per giro, `payload` è la stringa
//    JSON con `title`, `body`, `tag`, `url`; il valore di ritorno
//    `{ stakes: [{ stakeId, stale, notified }] }` si legge solo se c'è.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(import.meta.url);
const { deleteApp: deleteAdminApp, getApps: getAdminApps, initializeApp: initializeAdminApp } = require("firebase-admin/app");
const { Timestamp, getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

// ---------------------------------------------------------------------------
// Guardie: mai fuori dagli emulatori locali
// ---------------------------------------------------------------------------
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
const hostOf = (value, label) => {
  assert.match(value || "", /^(127\.0\.0\.1|localhost):\d+$/u, `${label}: emulatore locale richiesto`);
  const [host, port] = value.split(":");
  return { host, port: Number(port), raw: value };
};
const FIRESTORE = hostOf(process.env.FIRESTORE_EMULATOR_HOST, "Firestore");
const AUTH = hostOf(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth");

/** Porta delle Functions: variabile esplicita, altrimenti l'elenco dell'hub, altrimenti 5429. */
async function functionsHost() {
  if (process.env.FUNCTIONS_EMULATOR_HOST) return hostOf(process.env.FUNCTIONS_EMULATOR_HOST, "Functions");
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (hub) {
    const { host, port } = hostOf(hub, "Hub");
    const list = await (await fetch(`http://${host}:${port}/emulators`)).json();
    if (list.functions) return hostOf(`${list.functions.host}:${list.functions.port}`, "Functions");
  }
  return { host: "127.0.0.1", port: 5429, raw: "127.0.0.1:5429" };
}
const FUNCTIONS = await functionsHost();

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const adminApp = initializeAdminApp({ projectId: PROJECT }, `s2-fase3-admin-${runId}`);
const adminDb = getAdminFirestore(adminApp);

// ---------------------------------------------------------------------------
// Codice server caricato nel processo del test: `index.js` per l'export
// schedulato (crea l'app admin di default), la lib per la funzione nuda del
// promemoria. Se manca, i casi che ne dipendono lo dicono uno per uno.
// ---------------------------------------------------------------------------
const serverCode = { index: null, lib: null, errors: [] };
try {
  serverCode.index = require("../index.js");
} catch (error) {
  serverCode.errors.push(`index.js: ${error?.message}`);
}
try {
  if (!getAdminApps().some((app) => app.name === "[DEFAULT]")) initializeAdminApp({ projectId: PROJECT });
  serverCode.lib = require("../lib/stakeMembershipFunctions.js");
} catch (error) {
  serverCode.errors.push(`lib/stakeMembershipFunctions.js: ${error?.message}`);
}
function runReminder(args) {
  const fn = serverCode.lib?.runStakeMembershipQueueReminder;
  assert.equal(
    typeof fn,
    "function",
    `runStakeMembershipQueueReminder non esportata da functions/lib/stakeMembershipFunctions.js (${serverCode.errors.join("; ") || "export assente"})`,
  );
  return fn(args);
}

const PASSWORD = `Pw-${runId}-s2f3!`; // credenziale di test, vale solo nell'emulatore
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UNIT1 = { id: "unit-1", name: "Rione Uno" };
const UNIT2 = { id: "unit-2", name: "Rione Due" };

// Copy del promemoria, come nella spec.
const REMINDER_TITLE = "Richieste di accesso in attesa";
const reminderBody = (n) => (n === 1 ? "1 richiesta aspetta da più di 2 giorni." : `${n} richieste aspettano da più di 2 giorni.`);

// ---------------------------------------------------------------------------
// Pali
// ---------------------------------------------------------------------------
const STAKES = new Map(); // id -> { id, slug, name }
async function newStake(label) {
  const id = `s2f3-${label}-${runId}`;
  const stake = { id, slug: id, name: `Palo ${label}` };
  STAKES.set(id, stake);
  await adminDb.doc(`stakes/${id}`).set({ name: stake.name, slug: id, isActive: true });
  await Promise.all([UNIT1, UNIT2].map((unit) =>
    adminDb.doc(`stakes/${id}/units/${unit.id}`).set({ name: unit.name, type: "rione", isActive: true, stakeId: id }),
  ));
  return id;
}
const STAKE_A = await newStake("a");
const STAKE_B = await newStake("b");
const STAKE_CAP = await newStake("tetto");

// ---------------------------------------------------------------------------
// Documenti seminati (Admin SDK)
// ---------------------------------------------------------------------------
const memberPath = (stake, uid) => `stakes/${stake}/members/${uid}`;
const notePath = (stake, uid) => `${memberPath(stake, uid)}/staff/note`;
const queueStatePath = (stake) => `stakes/${stake}/private/membershipQueue`;
const memberData = (extra = {}) => ({
  status: "active",
  sources: [{ kind: "migration", ref: "a3-2026-10", at: Timestamp.now() }],
  previous: null,
  staffRole: null,
  claimedUnitId: "",
  claimedUnitName: "",
  displayName: "Persona Prova",
  birthYear: 2009,
  registrationHints: [],
  reviewNeeded: false,
  requestedAt: Timestamp.now(),
  decidedAt: Timestamp.now(),
  decidedBy: "system",
  declineCount: 0,
  version: 1,
  ...extra,
});
const pendingData = (unit = UNIT1, extra = {}) =>
  memberData({ status: "pending", claimedUnitId: unit.id, claimedUnitName: unit.name, sources: [], decidedAt: null, decidedBy: null, ...extra });

/** Profilo `users/{uid}` con le sole chiavi di validUserPayload; `over` sovrascrive (nome, data di nascita). */
function profileData({ role = "participant", stakeId = STAKE_A, unit = UNIT1, label, email = null, over = {} }) {
  const stake = STAKES.get(stakeId) ?? { slug: stakeId, name: stakeId };
  const now = iso();
  const staff = role === "admin" || role === "unit_leader" || role === "super_admin";
  return {
    email,
    phone: "",
    role,
    city: role === "parent" ? "Roma" : "",
    mustChangePassword: false,
    stakeId,
    stakeSlug: stake.slug,
    stakeName: stake.name,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    firstName: "Prova",
    lastName: label,
    fullName: `Prova ${label}`,
    birthDate: role === "parent" ? "" : staff ? "1985-01-30" : "2009-04-21",
    genderRoleCategory: role === "parent" ? "" : staff ? "dirigente" : "giovane_uomo",
    unitId: unit?.id ?? "",
    unitName: unit?.name ?? "",
    ...over,
  };
}

/** Nome e data di nascita di un profilo (il resto come profileData). */
const named = (firstName, lastName, birthDate, extra = {}) => ({
  firstName,
  lastName,
  fullName: `${firstName} ${lastName}`.trim(),
  birthDate,
  ...extra,
});
const yearOf = (birthDate) => (birthDate ? Number(birthDate.slice(0, 4)) : null);
/** Definizione di un membro attivo del palo con quel nome e quella data nel profilo. */
const activeNamed = (label, firstName, lastName, birthDate, { profile = {}, member = {} } = {}) => ({
  label,
  member: { status: "active", birthYear: yearOf(birthDate), ...member },
  over: named(firstName, lastName, birthDate, profile),
});

const adminData = async (path) => {
  const snap = await adminDb.doc(path).get();
  return snap.exists ? snap.data() : null;
};
const memberOf = (stake, uid) => adminData(memberPath(stake, uid));
const userOf = (uid) => adminData(`users/${uid}`);
const noteOf = (stake, uid) => adminData(notePath(stake, uid));
const queueStateOf = (stake) => adminData(queueStatePath(stake));
async function memberMeta(stake, uid) {
  const snap = await adminDb.doc(memberPath(stake, uid)).get();
  return snap.exists ? { data: snap.data(), updateTime: snap.updateTime.toMillis() } : null;
}
async function historyOf(stake, uid) {
  const snap = await adminDb.collection(`${memberPath(stake, uid)}/history`).get();
  return snap.docs.map((item) => item.data()).sort((left, right) => (left.version ?? 0) - (right.version ?? 0));
}

// ---------------------------------------------------------------------------
// Persone (SDK client)
// ---------------------------------------------------------------------------
const apps = [];
const seededUids = []; // profili users/{uid} da togliere a fine giro
let personSeq = 0;

/**
 * Utente vero dell'Auth emulator con Firestore e callable. `member(s)`: documenti
 * da seminare PRIMA del profilo (il trigger legge il profilo e li trova già
 * coerenti). `over`: campi del profilo da sovrascrivere.
 */
async function newPerson({ role = "participant", stake = STAKE_A, unit = UNIT1, member = null, members = [], label, over = {} } = {}) {
  const index = ++personSeq;
  const name = label ?? `p${index}`;
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${index}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.raw}`, { disableWarnings: true });
  const email = `${name}-${index}-${runId}@example.invalid`.toLowerCase();
  await createUserWithEmailAndPassword(auth, email, PASSWORD);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE.host, FIRESTORE.port);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  const uid = auth.currentUser.uid;
  const person = {
    name,
    uid,
    db,
    stake,
    call: (data) => httpsCallable(functions, "stakeMembership")(data).then((result) => result.data),
  };
  const seeds = member ? [{ stake, ...member }, ...members] : members;
  for (const seed of seeds) {
    const { stake: seedStake, ...fields } = seed;
    await adminDb.doc(memberPath(seedStake, uid)).set(memberData(fields));
  }
  seededUids.push(uid);
  await adminDb.doc(`users/${uid}`).set(profileData({ role, stakeId: stake, unit, label: name, email, over }));
  return person;
}

/** Istantanea di tutti i members dei pali del giro: chiave, version, ora di scrittura. */
async function snapshotMembers() {
  const rows = [];
  for (const stakeId of STAKES.keys()) {
    const snap = await adminDb.collection(`stakes/${stakeId}/members`).get();
    for (const item of snap.docs) rows.push(`${stakeId}/${item.id}:${item.data().version}:${item.updateTime.toMillis()}`);
  }
  return rows.sort().join("|");
}

/** Aspetta che il trigger si sia calmato: nessun members dei pali del giro cambia per `quietMs` di fila. */
async function settleAll({ quietMs = 1500, timeoutMs = 45_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let ultima = await snapshotMembers();
  let fermaDa = Date.now();
  while (Date.now() < deadline) {
    await pausa(200);
    const attuale = await snapshotMembers();
    if (attuale !== ultima) {
      ultima = attuale;
      fermaDa = Date.now();
    } else if (Date.now() - fermaDa >= quietMs) {
      return;
    }
  }
  assert.fail(`members ancora in movimento dopo ${timeoutMs} ms`);
}

async function waitFor(read, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await pausa(250);
  }
  assert.fail(`${label}: condizione non raggiunta in ${timeoutMs} ms. Ultimo stato: ${JSON.stringify(last)}`);
}

/** Crea più persone insieme e aspetta la quiete del trigger. */
async function fresh(defs) {
  const people = await Promise.all(defs.map((def) => newPerson(def)));
  await settleAll();
  return people;
}

/** Toglie un members con history e staff/note: un `delete()` del solo documento li lascerebbe. */
const removeMember = (stake, uid) => adminDb.recursiveDelete(adminDb.doc(memberPath(stake, uid)));

// ---------------------------------------------------------------------------
// Letture dal client (passano dalle rules)
// ---------------------------------------------------------------------------
const clientGet = (person, path) => getDocFromServer(doc(person.db, path)).then((snap) => (snap.exists() ? snap.data() : null));
const clientList = (person, path) => getDocsFromServer(collection(person.db, path)).then((snap) => snap.docs.map((item) => item.data()));
async function expectRuleDenied(promise, label = "") {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, "permission-denied", `${label}${label ? ": " : ""}${error?.code}: ${error?.message}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Esiti della callable
// ---------------------------------------------------------------------------
async function expectError(promise, code, reason) {
  await assert.rejects(promise, (error) => {
    assert.equal(
      error?.code,
      `functions/${code}`,
      `atteso functions/${code}${reason ? ` (${reason})` : ""}, ricevuto ${error?.code}: ${error?.message} ${JSON.stringify(error?.details ?? null)}`,
    );
    if (reason) assert.equal(error?.details?.reason, reason, `details.reason: ${JSON.stringify(error?.details ?? null)}`);
    return true;
  });
}
const expectDenied = (promise) => expectError(promise, "permission-denied");
const expectInvalidState = (promise) => expectError(promise, "failed-precondition", "invalid_state");

function assertChanged(result, { action, status, version }) {
  assert.equal(result?.ok, true, JSON.stringify(result));
  assert.equal(result.action, action);
  assert.equal(result.status, status);
  assert.equal(result.changed, true, "changed");
  assert.equal(result.version, version, "version nella risposta");
}

const PREVIOUS_KEYS = ["status", "sources", "staffRole", "reviewNeeded", "claimedUnitId", "claimedUnitName", "declineCount", "decidedAt", "decidedBy", "action", "by"];
function assertPrevious(previous, { status, action, by, extraKeys = [] }) {
  assert.ok(previous && typeof previous === "object", "previous assente");
  for (const key of [...PREVIOUS_KEYS, ...extraKeys]) assert.ok(key in previous, `previous.${key} assente: ${Object.keys(previous).join(",")}`);
  assert.equal(previous.status, status, "previous.status");
  assert.equal(previous.action, action, "previous.action");
  assert.equal(previous.by, by, "previous.by");
}

/** La riga di history dell'ultima azione: una sola con quella `version`, ed è la più alta. */
async function expectHistoryRow(stake, uid, { action, by, fromStatus, toStatus, version }) {
  const rows = await historyOf(stake, uid);
  const summary = JSON.stringify(rows.map((item) => [item.action, item.version, item.by]));
  const matching = rows.filter((item) => item.version === version);
  assert.equal(matching.length, 1, `una sola riga di history con version ${version}: ${summary}`);
  const [row] = matching;
  assert.equal(row.action, action, `history.action: ${summary}`);
  assert.equal(Math.max(...rows.map((item) => item.version ?? 0)), version, `la riga ${version} è l'ultima: ${summary}`);
  assert.equal(row.by, by, "history.by");
  assert.equal(row.fromStatus ?? null, fromStatus ?? null, "history.fromStatus");
  assert.equal(row.toStatus, toStatus, "history.toStatus");
  assert.ok(row.at instanceof Timestamp, "history.at è un Timestamp del server");
  return rows;
}

/** La nota "stesso nome e data" con il numero di corrispondenze atteso. */
function assertNote(note, matches, label = "") {
  assert.ok(note, `${label}: nota staff/note assente`);
  assert.equal(note.kind, "same_name_birth", `${label}: kind`);
  assert.equal(note.matches, matches, `${label}: matches`);
  assert.ok(note.at instanceof Timestamp, `${label}: at è un Timestamp del server`);
}

// ---------------------------------------------------------------------------
// Avvio e chiusura
// ---------------------------------------------------------------------------
const P = {};
let triggerAlive = false;

before(async () => {
  // Il primo evento della sessione carica il runtime delle Functions (decine di
  // secondi): lo si scalda con un profilo completo e si aspetta che il trigger
  // crei il pending. Se il trigger non esiste ancora, si prosegue lo stesso.
  const warm = await newPerson({ label: "scaldamento" });
  try {
    await waitFor(() => memberOf(STAKE_A, warm.uid), (data) => data?.status === "pending", "trigger (scaldamento)", 60_000);
    triggerAlive = true;
  } catch {
    triggerAlive = false;
  }

  // P in attesa (unità 1), M attivo, D dirigente dell'unità 1, D2 dell'unità 2,
  // A admin del palo, AB admin di un altro palo.
  const [Pp, M, D, D2, A, AB] = await Promise.all([
    newPerson({ label: "p", member: pendingData() }),
    newPerson({ label: "m", member: { status: "active" } }),
    newPerson({ label: "d", role: "unit_leader", unit: UNIT1, member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } }),
    newPerson({ label: "d2", role: "unit_leader", unit: UNIT2, member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT2.id, claimedUnitName: UNIT2.name } }),
    newPerson({ label: "a", role: "admin", unit: null, member: { status: "active", staffRole: "admin" } }),
    newPerson({ label: "ab", role: "admin", stake: STAKE_B, unit: null, member: { status: "active", staffRole: "admin" } }),
  ]);
  Object.assign(P, { P: Pp, M, D, D2, A, AB });
  await settleAll();
});

after(async () => {
  try {
    for (const stakeId of STAKES.keys()) await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
    await Promise.all(seededUids.map((uid) => adminDb.doc(`users/${uid}`).delete()));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await adminDb.terminate();
    const defaultApp = getAdminApps().find((app) => app.name === "[DEFAULT]");
    if (defaultApp) await deleteAdminApp(defaultApp).catch(() => {});
  }
});

// Scorciatoie sulle azioni.
const forSelf = (person, action, stakeId = STAKE_A) => person.call({ action, stakeId });
const onUid = (person, action, target, stakeId = STAKE_A, extra = {}) => person.call({ action, stakeId, uid: target.uid, ...extra });
const undo = (person, target, version, stakeId = STAKE_A) => person.call({ action: "undo", stakeId, uid: target.uid, version });

// ===========================================================================
// Controllo
// ===========================================================================
describe("controllo", () => {
  test("il trigger su users ha risposto allo scaldamento (altrimenti i casi che ne dipendono spiegano il rosso)", (t) => {
    t.diagnostic(`trigger osservato: ${triggerAlive}`);
    assert.equal(triggerAlive, true, "nessun pending creato dal trigger entro 60 s");
  });

  test("le persone sono seminate come dice il contratto", async () => {
    assert.equal((await memberOf(STAKE_A, P.P.uid)).status, "pending");
    assert.equal((await memberOf(STAKE_A, P.M.uid)).status, "active");
    assert.equal((await memberOf(STAKE_A, P.D.uid)).staffRole, "unit_leader");
    assert.equal((await memberOf(STAKE_A, P.D2.uid)).staffRole, "unit_leader");
    assert.equal((await memberOf(STAKE_A, P.A.uid)).staffRole, "admin");
    assert.equal((await memberOf(STAKE_B, P.AB.uid)).staffRole, "admin");
  });
});

// ===========================================================================
// Nota dello staff "stesso nome e data"
// ===========================================================================
describe("nota dello staff: stesso nome e data di un membro attivo", () => {
  test("request: nota con matches 1 quando un attivo ha lo stesso nome normalizzato (maiuscole, accenti, spazi doppi; fullName o nome + cognome) e la stessa birthDate; la nota è del dirigente dell'unità, mai del richiedente", async () => {
    const [, byFullName, byParts] = await fresh([
      // L'attivo ha solo nome e cognome nel profilo (fullName vuoto): il confronto usa nome + cognome.
      activeNamed("doppione-attivo", "Mario", "Rossi", "2010-03-15", { profile: { fullName: "" } }),
      { label: "doppione-fullname", over: named("MÀRIO", "ROSSI", "2010-03-15", { fullName: "MÀRIO  ROSSI" }) },
      { label: "doppione-parti", over: named("màrio", "rossi", "2010-03-15") },
    ]);
    for (const who of [byFullName, byParts]) {
      await removeMember(STAKE_A, who.uid);
      assert.equal(await noteOf(STAKE_A, who.uid), null, `${who.name}: premessa, nessuna nota prima della richiesta`);
      assertChanged(await forSelf(who, "request"), { action: "request", status: "pending", version: 1 });
      assert.equal((await memberOf(STAKE_A, who.uid)).status, "pending", who.name);
      assertNote(await noteOf(STAKE_A, who.uid), 1, who.name);
      // Rules: il dirigente dell'unità dichiarata la legge, il richiedente no.
      assert.equal((await clientGet(P.D, notePath(STAKE_A, who.uid)))?.kind, "same_name_birth", `${who.name}: il dirigente legge la nota`);
      await expectRuleDenied(clientGet(who, notePath(STAKE_A, who.uid)), `${who.name}: il richiedente legge la propria nota`);
    }
  });

  test("request: nessuna nota con solo il nome uguale (stesso anno, data diversa) o solo la data uguale", async () => {
    const [, sameNameOtherDate, , sameDateOtherName] = await fresh([
      activeNamed("solo-nome-attivo", "Luca", "Bianchi", "2011-01-10"),
      { label: "solo-nome", over: named("Luca", "Bianchi", "2011-02-20") },
      activeNamed("solo-data-attivo", "Anna", "Verdi", "2012-05-05"),
      { label: "solo-data", over: named("Sara", "Neri", "2012-05-05") },
    ]);
    for (const who of [sameNameOtherDate, sameDateOtherName]) {
      await removeMember(STAKE_A, who.uid);
      assertChanged(await forSelf(who, "request"), { action: "request", status: "pending", version: 1 });
      assert.equal(await noteOf(STAKE_A, who.uid), null, `${who.name}: nessuna nota`);
    }
  });

  test("request: contano solo i membri active dello stesso palo (un doppione declined, o attivo in un altro palo, non dà nota)", async () => {
    const [, withDeclinedTwin, , withTwinElsewhere] = await fresh([
      { label: "gemello-rifiutato", member: { status: "declined", birthYear: 2017, declineCount: 1 }, over: named("Piero", "Galli", "2017-02-02") },
      { label: "con-gemello-rifiutato", over: named("Piero", "Galli", "2017-02-02") },
      // Profilo e appartenenza attiva nel palo B: per il palo A non è un membro.
      { label: "gemello-altro-palo", stake: STAKE_B, member: { status: "active", birthYear: 2018 }, over: named("Carla", "Fontana", "2018-06-06") },
      { label: "con-gemello-altrove", over: named("Carla", "Fontana", "2018-06-06") },
    ]);
    for (const who of [withDeclinedTwin, withTwinElsewhere]) {
      await removeMember(STAKE_A, who.uid);
      assertChanged(await forSelf(who, "request"), { action: "request", status: "pending", version: 1 });
      assert.equal(await noteOf(STAKE_A, who.uid), null, `${who.name}: nessuna nota`);
    }
  });

  test("request di un genitore (senza data di nascita): nessuna nota, anche con un genitore attivo con lo stesso nome", async () => {
    const [, parent] = await fresh([
      { label: "genitore-attivo", role: "parent", member: { status: "active", birthYear: null }, over: named("Paola", "Gialli", "") },
      { label: "genitore", role: "parent", over: named("Paola", "Gialli", "") },
    ]);
    await removeMember(STAKE_A, parent.uid);
    assertChanged(await forSelf(parent, "request"), { action: "request", status: "pending", version: 1 });
    const data = await memberOf(STAKE_A, parent.uid);
    assert.equal(data.birthYear, null);
    assert.equal(await noteOf(STAKE_A, parent.uid), null, "nessuna nota per chi non ha data di nascita");
  });

  test("regola 3 del trigger (profilo completato scegliendo il palo): la nota nasce insieme al pending; senza doppione nessuna nota", async () => {
    await fresh([activeNamed("trigger-attivo", "Giulia", "Conti", "2013-07-07")]);
    const [twin, plain] = await fresh([
      { label: "trigger-doppione", over: named("giulia", "conti", "2013-07-07") },
      { label: "trigger-senza-doppione", over: named("Nadia", "Moretti", "2013-07-07") },
    ]);
    const data = await waitFor(() => memberOf(STAKE_A, twin.uid), (item) => item?.status === "pending", "pending dalla regola 3");
    assert.equal(data.version, 1);
    const note = await waitFor(() => noteOf(STAKE_A, twin.uid), (item) => item?.kind === "same_name_birth", "nota dalla regola 3");
    assertNote(note, 1, twin.name);
    assert.equal((await memberOf(STAKE_A, plain.uid))?.status, "pending", "premessa: anche l'altro è in coda");
    assert.equal(await noteOf(STAKE_A, plain.uid), null, "senza doppione nessuna nota");
  });

  test("richiesta riaperta: una nota vecchia dello stesso tipo si cancella se non c'è più corrispondenza, e torna se c'è di nuovo", async () => {
    const [twin, who] = await fresh([
      activeNamed("scaduta-attivo", "Marco", "Russo", "2014-08-08"),
      { label: "scaduta", over: named("Marco", "Russo", "2014-08-08") },
    ]);
    await removeMember(STAKE_A, who.uid);
    assertChanged(await forSelf(who, "request"), { action: "request", status: "pending", version: 1 });
    assertNote(await noteOf(STAKE_A, who.uid), 1, "premessa: la prima richiesta ha la nota");
    assertChanged(await forSelf(who, "withdraw"), { action: "withdraw", status: "withdrawn", version: 2 });

    // Il doppione esce dal palo (Admin SDK sui members: nessun trigger): alla riapertura non corrisponde più nessuno.
    await adminDb.doc(memberPath(STAKE_A, twin.uid)).update({ status: "removed" });
    assertChanged(await forSelf(who, "request"), { action: "request", status: "pending", version: 3 });
    assert.equal(await noteOf(STAKE_A, who.uid), null, "la nota vecchia si cancella con la richiesta riaperta");

    // Il doppione torna attivo: la richiesta riaperta ha di nuovo la nota.
    await adminDb.doc(memberPath(STAKE_A, twin.uid)).update({ status: "active" });
    assertChanged(await forSelf(who, "withdraw"), { action: "withdraw", status: "withdrawn", version: 4 });
    assertChanged(await forSelf(who, "request"), { action: "request", status: "pending", version: 5 });
    assertNote(await noteOf(STAKE_A, who.uid), 1, "richiesta riaperta con il doppione di nuovo attivo");
  });

  test("azioni dello staff che riportano in coda (markUnknown, unblock): nessuna nota, anche con un doppione attivo", async () => {
    const [, unknown, blocked] = await fresh([
      activeNamed("staff-attivo", "Elena", "Ferri", "2015-09-09"),
      activeNamed("staff-unknown", "Elena", "Ferri", "2015-09-09", { member: { reviewNeeded: true, claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } }),
      { label: "staff-blocked", member: { status: "blocked", birthYear: 2015 }, over: named("Elena", "Ferri", "2015-09-09") },
    ]);
    assertChanged(await onUid(P.A, "markUnknown", unknown), { action: "markUnknown", status: "pending", version: 2 });
    assert.equal(await noteOf(STAKE_A, unknown.uid), null, "markUnknown non calcola la nota");
    assertChanged(await onUid(P.A, "unblock", blocked), { action: "unblock", status: "pending", version: 2 });
    assert.equal(await noteOf(STAKE_A, blocked.uid), null, "unblock non calcola la nota");
  });

  test("tetto dei 30 profili letti: con 35 attivi dello stesso anno la richiesta parte lo stesso", async () => {
    // 35 attivi del 2016 seminati solo con l'Admin SDK (uid senza utente Auth: il trigger li salta), nessuno con il nome del richiedente.
    const batch = adminDb.batch();
    const uids = Array.from({ length: 35 }, (_, index) => `tetto-${index}-${runId}`);
    for (const [index, uid] of uids.entries()) {
      batch.set(adminDb.doc(memberPath(STAKE_CAP, uid)), memberData({ birthYear: 2016, displayName: `Persona ${index}` }));
      batch.set(adminDb.doc(`users/${uid}`), profileData({ stakeId: STAKE_CAP, label: `tetto-${index}`, over: named("Persona", `Numero${index}`, "2016-01-01") }));
    }
    await batch.commit();
    seededUids.push(...uids);
    const [who] = await fresh([{ label: "tetto-richiesta", stake: STAKE_CAP, over: named("Persona", "Zero", "2016-01-01") }]);
    await removeMember(STAKE_CAP, who.uid);
    assertChanged(await forSelf(who, "request", STAKE_CAP), { action: "request", status: "pending", version: 1 });
    assert.equal((await memberOf(STAKE_CAP, who.uid)).status, "pending");
    assert.equal(await noteOf(STAKE_CAP, who.uid), null, "nessuno dei 35 ha il suo nome: nessuna nota");
  });
});

// ===========================================================================
// Rules: nota dello staff e stato del promemoria
// ===========================================================================
describe("rules: staff/note e private/membershipQueue", () => {
  test("staff/note: la leggono l'admin e il dirigente dell'unità dichiarata; mai il richiedente, un dirigente di un'altra unità o un membro; la lista solo l'admin", async () => {
    const [who] = await fresh([{ label: "nota-rules", member: pendingData(UNIT1) }]);
    const path = notePath(STAKE_A, who.uid);
    await adminDb.doc(path).set({ kind: "same_name_birth", matches: 1, at: Timestamp.now() });
    assert.equal((await clientGet(P.A, path))?.kind, "same_name_birth", "admin del palo");
    assert.equal((await clientGet(P.D, path))?.kind, "same_name_birth", "dirigente dell'unità dichiarata");
    await expectRuleDenied(clientGet(who, path), "richiedente");
    await expectRuleDenied(clientGet(P.D2, path), "dirigente di un'altra unità");
    await expectRuleDenied(clientGet(P.M, path), "membro attivo");
    await expectRuleDenied(clientGet(P.AB, path), "admin di un altro palo");
    const staffCollection = `${memberPath(STAKE_A, who.uid)}/staff`;
    assert.equal((await clientList(P.A, staffCollection)).length, 1, "l'admin elenca le note");
    await expectRuleDenied(clientList(P.D, staffCollection), "lista del dirigente");
    await expectRuleDenied(clientList(who, staffCollection), "lista del richiedente");
  });

  test("staff/note dopo notMyUnit (claimedUnitId vuoto): il dirigente non la legge più, l'admin sì", async () => {
    const [who] = await fresh([{ label: "nota-unita-vuota", member: pendingData(UNIT1) }]);
    const path = notePath(STAKE_A, who.uid);
    await adminDb.doc(path).set({ kind: "same_name_birth", matches: 2, at: Timestamp.now() });
    assertChanged(await onUid(P.D, "notMyUnit", who), { action: "notMyUnit", status: "pending", version: 2 });
    await expectRuleDenied(clientGet(P.D, path), "dirigente dopo notMyUnit");
    assert.equal((await clientGet(P.A, path))?.matches, 2, "admin");
  });

  test("private/membershipQueue: nessuna rule lo apre, nemmeno all'admin del palo", async () => {
    const path = queueStatePath(STAKE_B);
    await adminDb.doc(path).set({ remindedUids: [] });
    await expectRuleDenied(clientGet(P.AB, path), "admin del palo");
    await expectRuleDenied(clientGet(P.A, path), "admin di un altro palo");
    await expectRuleDenied(clientGet(P.P, path), "utente");
  });
});

// ===========================================================================
// hasAccount ("Ha già un account")
// ===========================================================================
describe("hasAccount", () => {
  test("D della unità dichiarata: pending → declined, declineCount +1, history action hasAccount; per il richiedente è un rifiuto (previous.action decline, nulla dice hasAccount)", async () => {
    const [target] = await fresh([{ label: "ha-account-d", member: pendingData(UNIT1) }]);
    assertChanged(await onUid(P.D, "hasAccount", target), { action: "hasAccount", status: "declined", version: 2 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "declined");
    assert.equal(data.declineCount, 1);
    assert.equal(data.decidedBy, P.D.uid);
    assert.ok(data.decidedAt instanceof Timestamp, "decidedAt dal server");
    assertPrevious(data.previous, { status: "pending", action: "decline", by: P.D.uid });
    await expectHistoryRow(STAKE_A, target.uid, { action: "hasAccount", by: P.D.uid, fromStatus: "pending", toStatus: "declined", version: 2 });

    // Quello che il richiedente può leggere (SDK client, rules): identico a un rifiuto.
    const seen = await clientGet(target, memberPath(STAKE_A, target.uid));
    assert.equal(seen?.status, "declined");
    assert.equal(seen?.declineCount, 1);
    assert.equal(seen?.previous?.action, "decline", "nel documento letto dal richiedente l'azione è un rifiuto");
    assert.equal(JSON.stringify(seen).includes("hasAccount"), false, `nulla di leggibile dice hasAccount: ${JSON.stringify(seen)}`);
    await expectRuleDenied(clientList(target, `${memberPath(STAKE_A, target.uid)}/history`), "history del richiedente");
    await expectRuleDenied(clientGet(target, `${memberPath(STAKE_A, target.uid)}/history/x`), "riga di history del richiedente");
  });

  test("A del palo: su qualunque unità; con uid assente invalid-argument", async () => {
    const [target] = await fresh([{ label: "ha-account-a", unit: UNIT2, member: pendingData(UNIT2) }]);
    await expectError(P.A.call({ action: "hasAccount", stakeId: STAKE_A }), "invalid-argument");
    assertChanged(await onUid(P.A, "hasAccount", target), { action: "hasAccount", status: "declined", version: 2 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "declined");
    assert.equal(data.declineCount, 1);
    assert.equal(data.decidedBy, P.A.uid);
    await expectHistoryRow(STAKE_A, target.uid, { action: "hasAccount", by: P.A.uid, fromStatus: "pending", toStatus: "declined", version: 2 });
  });

  test("chi non può (D di un'altra unità, membro, admin di un altro palo, l'utente in attesa, sé stesso): permission-denied e nessuna scrittura", async () => {
    const [target] = await fresh([{ label: "ha-account-negato", member: pendingData(UNIT1) }]);
    const before = await memberMeta(STAKE_A, target.uid);
    for (const person of [P.D2, P.M, P.AB, P.P, target]) {
      await expectDenied(onUid(person, "hasAccount", target));
    }
    assert.deepEqual(await memberMeta(STAKE_A, target.uid), before, "il documento non cambia");
    assert.equal((await historyOf(STAKE_A, target.uid)).length, 0, "nessuna riga di history");
    assert.equal(await noteOf(STAKE_A, target.uid), null);
  });

  test("da active, withdrawn e blocked: invalid_state senza scrittura; da declined come un rifiuto ripetuto (changed false o invalid_state), senza scrittura", async () => {
    const [active, withdrawn, blocked, declined] = await fresh([
      { label: "ha-account-attivo", member: { status: "active", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } },
      { label: "ha-account-ritirato", member: { status: "withdrawn", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } },
      { label: "ha-account-bloccato", member: { status: "blocked", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } },
      { label: "ha-account-rifiutato", member: { status: "declined", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name, declineCount: 1, decidedBy: "staff-di-prova" } },
    ]);
    for (const target of [active, withdrawn, blocked]) {
      const before = await memberMeta(STAKE_A, target.uid);
      await expectInvalidState(onUid(P.A, "hasAccount", target));
      assert.deepEqual(await memberMeta(STAKE_A, target.uid), before, `${target.name}: documento riscritto`);
    }
    const before = await memberMeta(STAKE_A, declined.uid);
    const rows = (await historyOf(STAKE_A, declined.uid)).length;
    await onUid(P.A, "hasAccount", declined).then(
      (result) => {
        assert.equal(result?.ok, true, JSON.stringify(result));
        assert.equal(result.changed, false, `da declined: ${JSON.stringify(result)}`);
        assert.equal(result.status, "declined");
      },
      (error) => {
        assert.equal(error?.code, "functions/failed-precondition", `${error?.code}: ${error?.message}`);
        assert.equal(error?.details?.reason, "invalid_state", JSON.stringify(error?.details ?? null));
      },
    );
    assert.deepEqual(await memberMeta(STAKE_A, declined.uid), before, "da declined: documento riscritto");
    assert.equal((await historyOf(STAKE_A, declined.uid)).length, rows, "da declined: riga di history in più");
  });

  test("undo del dirigente sulla propria hasAccount: torna pending, declineCount com'era, previous null, version +1; version vecchia: version_conflict senza scrittura", async () => {
    const [target] = await fresh([{ label: "ha-account-undo", member: pendingData(UNIT1) }]);
    const done = await onUid(P.D, "hasAccount", target);
    assertChanged(done, { action: "hasAccount", status: "declined", version: 2 });
    const before = await memberMeta(STAKE_A, target.uid);
    await expectError(undo(P.D, target, 1), "failed-precondition", "version_conflict");
    await expectError(undo(P.D, target, 99), "failed-precondition", "version_conflict");
    assert.deepEqual(await memberMeta(STAKE_A, target.uid), before, "nessuna scrittura con la version sbagliata");

    assertChanged(await undo(P.D, target, done.version), { action: "undo", status: "pending", version: 3 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "pending");
    assert.equal(data.declineCount, 0, "il rifiuto annullato non conta");
    assert.equal(data.claimedUnitId, UNIT1.id);
    assert.equal(data.previous, null, "dopo l'annullamento non c'è più nulla da annullare");
    await expectHistoryRow(STAKE_A, target.uid, { action: "undo", by: P.D.uid, fromStatus: "declined", toStatus: "pending", version: 3 });
    await expectError(undo(P.D, target, 3), "failed-precondition", "nothing_to_undo");
    // Dopo l'annullamento la persona può essere rifiutata di nuovo, come dopo un decline annullato.
    assertChanged(await onUid(P.D, "decline", target), { action: "decline", status: "declined", version: 4 });
    assert.equal((await memberOf(STAKE_A, target.uid)).declineCount, 1);
  });

  test("undo di hasAccount: un altro dirigente no (permission-denied), l'admin sì", async () => {
    const [target] = await fresh([{ label: "ha-account-undo-admin", member: pendingData(UNIT1) }]);
    const done = await onUid(P.D, "hasAccount", target);
    await expectDenied(undo(P.D2, target, done.version));
    assert.equal((await memberOf(STAKE_A, target.uid)).status, "declined");
    assertChanged(await undo(P.A, target, done.version), { action: "undo", status: "pending", version: 3 });
    assert.equal((await memberOf(STAKE_A, target.uid)).declineCount, 0);
  });

  test("uscita dello staff come decline: hasAccount dell'admin su un pending con ruolo unit_leader toglie il ruolo (users.role participant, previous.role/roleAfter); il dirigente non può", async () => {
    const [leader] = await fresh([{ label: "ha-account-dirigente", role: "unit_leader", unit: UNIT1, member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } }]);
    // Lo stato di partenza (pending senza staffRole) si scrive con l'Admin SDK dopo la quiete: un caso da console, il trigger lo avrebbe attivato.
    await adminDb.doc(memberPath(STAKE_A, leader.uid)).set(pendingData(UNIT1));
    assert.equal((await userOf(leader.uid)).role, "unit_leader", "premessa");
    await expectDenied(onUid(P.D, "hasAccount", leader));
    assertChanged(await onUid(P.A, "hasAccount", leader), { action: "hasAccount", status: "declined", version: 2 });
    const [data, profile] = await Promise.all([memberOf(STAKE_A, leader.uid), userOf(leader.uid)]);
    assert.equal(data.status, "declined");
    assert.equal(data.staffRole, null);
    assert.equal(profile.role, "participant", "il ruolo del profilo cade con il rifiuto");
    assertPrevious(data.previous, { status: "pending", action: "decline", by: P.A.uid, extraKeys: ["role", "roleAfter", "roleUnitId"] });
    assert.equal(data.previous.role, "unit_leader");
    assert.equal(data.previous.roleAfter, "participant");
    await expectHistoryRow(STAKE_A, leader.uid, { action: "hasAccount", by: P.A.uid, fromStatus: "pending", toStatus: "declined", version: 2 });
    await settleAll();
    assert.equal((await memberOf(STAKE_A, leader.uid)).version, 2, "il trigger sul cambio di ruolo non riscrive il documento");
  });
});

// ===========================================================================
// Promemoria dopo 48 ore
// ===========================================================================
describe("promemoria dopo 48 ore (runStakeMembershipQueueReminder)", () => {
  const staleUid = (label) => `attesa-${label}-${runId}`;

  /** Un members del palo con `requestedAt` di `hoursAgo` ore prima di `nowMs`. */
  async function seedQueued(stake, uid, { nowMs, hoursAgo, status = "pending", extra = {} }) {
    const base = status === "pending" ? pendingData(UNIT1) : memberData({ status, claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name });
    await adminDb.doc(memberPath(stake, uid)).set({ ...base, requestedAt: Timestamp.fromMillis(nowMs - hoursAgo * HOUR), ...extra });
  }

  /** Invio del push finto: registra le chiamate, con il payload decodificato. */
  function fakePush() {
    const calls = [];
    return {
      calls,
      sendPush: async ({ stakeId, payload }) => {
        calls.push({ stakeId, payload });
      },
      forStake: (stake) => calls.filter((call) => call.stakeId === stake),
      reset: () => calls.splice(0, calls.length),
    };
  }

  function payloadOf(call, label = "") {
    assert.equal(typeof call.payload, "string", `${label}: payload è la stringa JSON del push`);
    const payload = JSON.parse(call.payload);
    assert.equal(payload.title, REMINDER_TITLE, `${label}: title`);
    assert.equal(typeof payload.tag, "string", `${label}: tag`);
    assert.ok(payload.tag.length > 0, `${label}: tag vuoto`);
    assert.equal(typeof payload.url, "string", `${label}: url`);
    assert.ok(payload.url.startsWith("/admin"), `${label}: url alla coda dell'admin (${payload.url})`);
    return payload;
  }

  /** Esattamente un push per il palo, con il corpo di `n` richieste. */
  function expectOnePush(push, stake, n, label = "") {
    const calls = push.forStake(stake);
    assert.equal(calls.length, 1, `${label}: push per il palo ${stake}: ${calls.length}`);
    assert.equal(payloadOf(calls[0], label).body, reminderBody(n), `${label}: body`);
  }

  async function expectRemindedUids(stake, uids, label = "") {
    const state = await queueStateOf(stake);
    if (uids.length === 0) {
      assert.deepEqual([...(state?.remindedUids ?? [])].sort(), [], `${label}: remindedUids di ${stake}`);
      return;
    }
    assert.ok(state, `${label}: stato ${queueStatePath(stake)} assente`);
    assert.deepEqual([...state.remindedUids].sort(), [...uids].sort(), `${label}: remindedUids di ${stake}`);
  }

  function stakeResult(result, stake) {
    if (!Array.isArray(result?.stakes)) return null;
    return result.stakes.find((item) => item?.stakeId === stake) ?? null;
  }

  test("stakeMembershipQueueReminder è esportata da functions/index.js come funzione schedulata (ogni giorno alle 18:00 Europe/Rome, europe-west1)", (t) => {
    const indexErrors = serverCode.errors.filter((item) => item.startsWith("index.js"));
    assert.equal(indexErrors.length, 0, indexErrors.join("; "));
    const fn = serverCode.index?.stakeMembershipQueueReminder;
    assert.equal(typeof fn, "function", "export stakeMembershipQueueReminder assente da functions/index.js");
    const endpoint = fn.__endpoint ?? null;
    t.diagnostic(`__endpoint: ${JSON.stringify(endpoint ?? null)}`);
    if (endpoint?.scheduleTrigger) {
      assert.match(String(endpoint.scheduleTrigger.schedule ?? ""), /18:00|^0 18 \* \* \*$/u, "ogni giorno alle 18:00");
      assert.equal(endpoint.scheduleTrigger.timeZone, "Europe/Rome");
      assert.ok([].concat(endpoint.region ?? []).includes("europe-west1"), `region: ${JSON.stringify(endpoint.region ?? null)}`);
    }
  });

  test("pending da più di 48 ore: un push per palo con il corpo al singolare o al plurale e il link alla coda dell'admin; i pending giovani, i rifiutati e gli attivi non contano", async () => {
    const nowMs = Date.now();
    const [two, one, young] = await Promise.all([newStake("promemoria-due"), newStake("promemoria-una"), newStake("promemoria-giovane")]);
    const [a, b] = [staleUid("a"), staleUid("b")];
    await Promise.all([
      seedQueued(two, a, { nowMs, hoursAgo: 49 }),
      seedQueued(two, b, { nowMs, hoursAgo: 72 }),
      seedQueued(two, staleUid("giovane"), { nowMs, hoursAgo: 47 }),
      seedQueued(two, staleUid("rifiutato"), { nowMs, hoursAgo: 72, status: "declined", extra: { declineCount: 1, decidedBy: "staff-di-prova" } }),
      seedQueued(two, staleUid("attivo"), { nowMs, hoursAgo: 72, status: "active" }),
      seedQueued(one, staleUid("sola"), { nowMs, hoursAgo: 50 }),
      seedQueued(young, staleUid("fresca"), { nowMs, hoursAgo: 47 }),
    ]);
    const push = fakePush();
    const result = await runReminder({ db: adminDb, nowMs, sendPush: push.sendPush });

    expectOnePush(push, two, 2, "due in ritardo");
    expectOnePush(push, one, 1, "una in ritardo");
    assert.equal(push.forStake(young).length, 0, "nessun push per il palo senza ritardi");
    await expectRemindedUids(two, [a, b], "dopo il primo giro");
    await expectRemindedUids(one, [staleUid("sola")], "dopo il primo giro");
    await expectRemindedUids(young, [], "palo senza ritardi: nessuno stato, o vuoto");

    const forTwo = stakeResult(result, two);
    if (forTwo) {
      assert.equal(forTwo.stale, 2, "stale del palo con due in ritardo");
      assert.equal(forTwo.notified, true);
    }
    const forYoung = stakeResult(result, young);
    if (forYoung) assert.equal(forYoung.notified, false, "palo senza ritardi: nessun avviso");
  });

  test("stesso elenco al giro dopo: nessun push; un uid nuovo in ritardo: push con il totale dei ritardi e remindedUids sostituito", async () => {
    const nowMs = Date.now();
    const stake = await newStake("promemoria-ripetuto");
    const [a, b, c] = [staleUid("ra"), staleUid("rb"), staleUid("rc")];
    await Promise.all([seedQueued(stake, a, { nowMs, hoursAgo: 49 }), seedQueued(stake, b, { nowMs, hoursAgo: 60 })]);
    const push = fakePush();

    await runReminder({ db: adminDb, nowMs, sendPush: push.sendPush });
    expectOnePush(push, stake, 2, "primo giro");
    push.reset();

    await runReminder({ db: adminDb, nowMs: nowMs + DAY, sendPush: push.sendPush });
    assert.equal(push.forStake(stake).length, 0, "secondo giro con lo stesso elenco: nessun push");
    await expectRemindedUids(stake, [a, b], "secondo giro");

    await seedQueued(stake, c, { nowMs: nowMs + DAY, hoursAgo: 49 });
    await runReminder({ db: adminDb, nowMs: nowMs + DAY, sendPush: push.sendPush });
    expectOnePush(push, stake, 3, "terzo giro con un uid nuovo");
    await expectRemindedUids(stake, [a, b, c], "terzo giro");
  });

  test("una richiesta che esce dalla coda sparisce da remindedUids; se rientra e torna in ritardo si ricorda di nuovo (non prima)", async () => {
    const nowMs = Date.now();
    const stake = await newStake("promemoria-rientro");
    const [a, b] = [staleUid("ia"), staleUid("ib")];
    await Promise.all([seedQueued(stake, a, { nowMs, hoursAgo: 49 }), seedQueued(stake, b, { nowMs, hoursAgo: 49 })]);
    const push = fakePush();
    await runReminder({ db: adminDb, nowMs, sendPush: push.sendPush });
    expectOnePush(push, stake, 2, "primo giro");
    push.reset();

    // `a` viene approvata (Admin SDK sui members: nessun trigger).
    await adminDb.doc(memberPath(stake, a)).update({ status: "active", decidedBy: "staff-di-prova", decidedAt: Timestamp.fromMillis(nowMs) });
    await runReminder({ db: adminDb, nowMs: nowMs + DAY, sendPush: push.sendPush });
    assert.equal(push.forStake(stake).length, 0, "`b` è già stata ricordata: nessun push");
    await expectRemindedUids(stake, [b], "remindedUids sostituito con l'elenco attuale");

    // `a` rientra in coda con una richiesta fresca: non è in ritardo, nessun push.
    await adminDb.doc(memberPath(stake, a)).update({ status: "pending", requestedAt: Timestamp.fromMillis(nowMs + DAY), decidedBy: null, decidedAt: null });
    await runReminder({ db: adminDb, nowMs: nowMs + DAY, sendPush: push.sendPush });
    assert.equal(push.forStake(stake).length, 0, "rientrata da poco: nessun push");
    await expectRemindedUids(stake, [b], "la richiesta fresca non entra in remindedUids");

    // Tre giorni dopo è di nuovo in ritardo: si ricorda di nuovo, con il totale dei ritardi.
    await runReminder({ db: adminDb, nowMs: nowMs + 4 * DAY, sendPush: push.sendPush });
    expectOnePush(push, stake, 2, "rientrata e di nuovo in ritardo");
    await expectRemindedUids(stake, [a, b], "ultimo giro");
  });

  test("palo con soli pending giovani: nessun push e nessun uid ricordato; un giro senza nulla in ritardo non inventa pali", async () => {
    const nowMs = Date.now();
    const stake = await newStake("promemoria-niente");
    await seedQueued(stake, staleUid("na"), { nowMs, hoursAgo: 1 });
    const push = fakePush();
    const result = await runReminder({ db: adminDb, nowMs, sendPush: push.sendPush });
    assert.equal(push.forStake(stake).length, 0);
    await expectRemindedUids(stake, [], "nessun ritardo");
    const entry = stakeResult(result, stake);
    if (entry) {
      assert.equal(entry.stale, 0);
      assert.equal(entry.notified, false);
    }
  });
});
