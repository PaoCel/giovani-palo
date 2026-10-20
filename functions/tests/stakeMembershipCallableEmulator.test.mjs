// Appartenenza al palo (S2), fase 2: la callable `stakeMembership` provata
// nell'emulatore Functions DAL CONTRATTO di docs/APPARTENENZA_AL_PALO.md
// («Callable e trigger: interfaccia (fase 2, 2026-10-20)»), con utenti VERI
// dell'Auth emulator e l'SDK client; l'Admin SDK serve solo per seminare e per
// ispezionare (ignora le rules). Scritto prima del codice, da chi non lo ha
// letto: una cella rossa è un disaccordo fra spec e codice, e uno dei due è un bug.
//
// Rilancio (Auth 9429, Firestore 8429, Functions 5429, Storage 9529, hub 4429;
// progetto demo-*; la porta delle Functions si chiede all'hub):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --config firebase.membership-functions-test.json --project demo-s2-functions \
//     'node --test --test-concurrency=1 functions/tests/stakeMembershipCallableEmulator.test.mjs'
// Sul Mac mini, da un worktree: `npm ci && (cd functions && npm ci)` nello
// stesso comando (ogni sync cancella i node_modules ignorati). Con le porte
// occupate da un'altra sessione non fermarla: copia la config su porte diverse
// in un file temporaneo nella radice del progetto e rimuovilo a fine prova.
//
// Il trigger `onUserStakeMembership` gira davvero nell'emulatore: ogni profilo
// seminato con l'Admin SDK lo fa partire. Perciò si semina PRIMA il documento
// members e POI il profilo coerente, e prima di ogni azione si aspetta che i
// members del giro restino fermi (settleAll). La persona N (profilo completo,
// nessun members) nasce cancellando con l'Admin SDK il pending che il trigger
// le ha creato: cancellare un members non fa partire nulla.
//
// Persone (sigle del contratto): V visitatore, O sessione anonima, N senza
// members, P in attesa, M attivo, F fuori, X attivo in un altro palo, D
// dirigente di unità (D2: di un'altra unità), A admin del palo (A2: secondo
// admin, così A non è mai l'ultimo), SA super admin, AB admin di un altro palo.
//
// Interpretazioni scelte dove la spec lascia margine (sempre la più stretta):
//  - `changed: false` (nessuna scrittura, version e history invariate) quando il
//    documento è già nello stato a cui l'azione porta («quando lo stato era già
//    quello»: `approve` su active, `block` su blocked, `withdraw` su withdrawn,
//    `confirmKnown` senza reviewNeeded...) e nei casi «nessun cambio» della
//    tabella (`request` da active); da ogni altro stato fuori dalla colonna
//    «Da» è `failed-precondition` / `invalid_state`;
//  - `by` (history e previous) è chi ha chiamato: per le azioni per sé l'uid
//    dell'utente, mai `system`; `previous.role` è il valore di prima di
//    `users.role`, come gli altri campi di `previous` (chiavi in più ammesse);
//  - il controllo del palo viene prima di tutto: `request` su un palo che non
//    esiste è `not-found`, non `stake_not_chosen`;
//  - un members si toglie dal seed con `recursiveDelete`: la history del trigger
//    (by `system`) altrimenti resterebbe sotto un documento che non c'è più;
//  - `request` di chi ha un ruolo staff del palo segue la regola 1 del trigger:
//    `active` con `staffRole`, `decidedBy: "system"`, un solo motivo
//    `staff_approval` con `ref: "role"`, senza chiedere il profilo completo
//    (solo `users.stakeId` uguale al palo); la copia in `staffRole` di un
//    `super_admin` è `admin` (è il ruolo che dà i poteri dello staff); i tetti
//    (`cooldown`) non sono provati per lo staff: il rifiuto di prova è vecchio;
//  - «ciascuno solo se nel frattempo non è cambiato» (undo): per l'altro palo
//    conta la `version`, per gli elenchi dello staff `updatedAt`, per il ruolo
//    `users.stakeId` e, per un dirigente, `users.unitId` (`previous.roleUnitId`);
//    un documento spostato che torna `active` torna con `staffRole: null`.
//  - le verifiche di autorizzazione precedono quelle di stato: un dirigente su
//    una persona con ruolo staff riceve `permission-denied` qualunque sia lo
//    stato del documento; `notMyUnit` è solo del dirigente (l'admin riceve
//    `permission-denied`);
//  - un documento nuovo nasce con `version: 1` e `fromStatus` null nella
//    history; `declineCount` non si azzera con una nuova richiesta (il tetto
//    dei 3 rifiuti vale per sempre);
//  - `reactivate` di chi ha cambiato palo nel frattempo: `users.role` resta
//    `participant` e `staffRole` resta null (il ruolo non torna, e `staffRole`
//    ne è la copia);
//  - una scrittura della callable (es. `users.role` dopo `leave`) fa partire il
//    trigger, che deve essere un no-op: `version` non cambia dopo la quiete.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, setDoc } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp } = require("firebase-admin/app");
const { FieldValue, Timestamp, getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

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
const adminApp = initializeAdminApp({ projectId: PROJECT }, `s2-callable-admin-${runId}`);
const adminDb = getAdminFirestore(adminApp);

const PASSWORD = `Pw-${runId}-s2c!`; // credenziale di test, vale solo nell'emulatore
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UNIT1 = { id: "unit-1", name: "Rione Uno" };
const UNIT2 = { id: "unit-2", name: "Rione Due" };

// ---------------------------------------------------------------------------
// Pali
// ---------------------------------------------------------------------------
const STAKES = new Map(); // id -> { id, slug, name }
async function newStake(label) {
  const id = `s2c-${label}-${runId}`;
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
const MISSING_STAKE = `s2c-assente-${runId}`;

// ---------------------------------------------------------------------------
// Documenti seminati (Admin SDK)
// ---------------------------------------------------------------------------
const memberPath = (stake, uid) => `stakes/${stake}/members/${uid}`;
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
const declinedData = (daysAgo, declineCount = 1, unit = UNIT1) =>
  memberData({
    status: "declined",
    claimedUnitId: unit.id,
    claimedUnitName: unit.name,
    sources: [],
    decidedAt: Timestamp.fromMillis(Date.now() - daysAgo * DAY),
    decidedBy: "staff-di-prova",
    declineCount,
  });

/** Profilo `users/{uid}` con le sole chiavi di validUserPayload. `complete: false` = nato dall'accesso e mai finito. */
function profileData({ role = "participant", stakeId = STAKE_A, unit = UNIT1, label, email, complete = true }) {
  const stake = STAKES.get(stakeId) ?? { slug: stakeId, name: stakeId };
  const now = iso();
  const base = {
    email: email ?? null,
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
  };
  if (!complete) {
    return { ...base, firstName: label, lastName: "", fullName: label, birthDate: "", genderRoleCategory: "", unitId: "", unitName: "" };
  }
  const staff = role === "admin" || role === "unit_leader" || role === "super_admin";
  return {
    ...base,
    firstName: "Prova",
    lastName: label,
    fullName: `Prova ${label}`,
    birthDate: role === "parent" ? "" : staff ? "1985-01-30" : "2009-04-21",
    genderRoleCategory: role === "parent" ? "" : staff ? "dirigente" : "giovane_uomo",
    unitId: unit?.id ?? "",
    unitName: unit?.name ?? "",
  };
}

const adminData = async (path) => {
  const snap = await adminDb.doc(path).get();
  return snap.exists ? snap.data() : null;
};
const memberOf = (stake, uid) => adminData(memberPath(stake, uid));
const userOf = (uid) => adminData(`users/${uid}`);
async function memberMeta(stake, uid) {
  const snap = await adminDb.doc(memberPath(stake, uid)).get();
  return snap.exists ? { data: snap.data(), updateTime: snap.updateTime.toMillis() } : null;
}
async function historyOf(stake, uid) {
  const snap = await adminDb.collection(`${memberPath(stake, uid)}/history`).get();
  return snap.docs.map((item) => item.data()).sort((left, right) => (left.version ?? 0) - (right.version ?? 0));
}

/** Elenchi dello staff di un'attività (campeggio e Notte dei Record) con gli uid dati. */
async function seedStaffLists(stake, activityId, uids) {
  const activity = `stakes/${stake}/activities/${activityId}`;
  await adminDb.doc(activity).set({ title: `Attività ${activityId}`, activityType: "camp", isPublic: true, startDate: iso(), endDate: iso(Date.now() + DAY) });
  await adminDb.doc(`${activity}/management/campStaff`).set({ staffUids: uids, updatedAt: iso() });
  await adminDb.doc(`${activity}/management/recordNight`).set({ staffUids: uids, updatedAt: iso() });
}
async function staffLists(stake, activityId) {
  const activity = `stakes/${stake}/activities/${activityId}`;
  return {
    camp: (await adminData(`${activity}/management/campStaff`))?.staffUids ?? null,
    night: (await adminData(`${activity}/management/recordNight`))?.staffUids ?? null,
  };
}

// ---------------------------------------------------------------------------
// Persone (SDK client)
// ---------------------------------------------------------------------------
const apps = [];
const seededUids = []; // profili users/{uid} da togliere a fine giro
let personSeq = 0;

/**
 * Utente vero dell'Auth emulator con Firestore e callable. `members`: documenti
 * da seminare PRIMA del profilo (il trigger legge il profilo e li trova già
 * coerenti). `profile`: "complete" | "incomplete" | null.
 */
async function newPerson({
  mode = "password",
  role = "participant",
  stake = STAKE_A,
  unit = UNIT1,
  member = null,
  members = [],
  profile = "complete",
  label,
} = {}) {
  const index = ++personSeq;
  const name = label ?? `p${index}`;
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${index}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.raw}`, { disableWarnings: true });
  const email = `${name}-${index}-${runId}@example.invalid`.toLowerCase();
  if (mode === "anonymous") await signInAnonymously(auth);
  else if (mode === "password") await createUserWithEmailAndPassword(auth, email, PASSWORD);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE.host, FIRESTORE.port);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  const uid = auth.currentUser?.uid ?? null;
  const person = {
    name,
    uid,
    db,
    stake,
    call: (data) => httpsCallable(functions, "stakeMembership")(data).then((result) => result.data),
  };
  if (!uid) return person;
  const seeds = member ? [{ stake, ...member }, ...members] : members;
  for (const seed of seeds) {
    const { stake: seedStake, ...fields } = seed;
    await adminDb.doc(memberPath(seedStake, uid)).set(memberData(fields));
  }
  seededUids.push(uid);
  if (profile) {
    await adminDb.doc(`users/${uid}`).set(profileData({ role, stakeId: stake, unit, label: name, email: mode === "password" ? email : null, complete: profile === "complete" }));
  }
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

/** Toglie un members con tutta la sua history: un `delete()` del solo documento lascerebbe le righe vecchie. */
const removeMember = (stake, uid) => adminDb.recursiveDelete(adminDb.doc(memberPath(stake, uid)));

/** Persona N: profilo completo e nessun members (il pending creato dal trigger si toglie con l'Admin SDK). */
async function freshN(label = "n") {
  const [person] = await fresh([{ label }]);
  await removeMember(STAKE_A, person.uid);
  return person;
}

// ---------------------------------------------------------------------------
// Esiti
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
function assertUnchanged(result, { action, status, version }) {
  assert.equal(result?.ok, true, JSON.stringify(result));
  assert.equal(result.action, action);
  assert.equal(result.status, status);
  assert.equal(result.changed, false, "changed");
  assert.equal(result.version, version, "version invariata nella risposta");
}

/** Azione su un documento già nello stato di arrivo: ok, changed false, nessuna scrittura né history. */
async function expectNoop(stake, uid, attempt, { action, status }) {
  const before = await memberMeta(stake, uid);
  const rows = (await historyOf(stake, uid)).length;
  assertUnchanged(await attempt(), { action, status, version: before.data.version });
  assert.deepEqual(await memberMeta(stake, uid), before, `${action} su ${status}: documento riscritto`);
  assert.equal((await historyOf(stake, uid)).length, rows, `${action} su ${status}: riga di history in più`);
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

/** Esito di una Promise.allSettled: [fulfilled[], rejected[]]. */
const split = (outcomes) => [
  outcomes.filter((item) => item.status === "fulfilled").map((item) => item.value),
  outcomes.filter((item) => item.status === "rejected").map((item) => item.reason),
];

// ---------------------------------------------------------------------------
// Avvio e chiusura
// ---------------------------------------------------------------------------
const P = {};
let triggerAlive = false;

before(async () => {
  // Il primo evento della sessione carica il runtime delle Functions (decine di
  // secondi): lo si scalda con un profilo completo e si aspetta che il trigger
  // crei il pending. Se il trigger non esiste ancora, si prosegue lo stesso:
  // i casi che lo richiedono falliranno da soli, uno per uno.
  const warm = await newPerson({ label: "scaldamento" });
  try {
    await waitFor(() => memberOf(STAKE_A, warm.uid), (data) => data?.status === "pending", "trigger (scaldamento)", 60_000);
    triggerAlive = true;
  } catch {
    triggerAlive = false;
  }

  const [V, O, N, Pp, M, F, X, D, D2, A, A2, SA, AB] = await Promise.all([
    newPerson({ mode: "none", label: "v" }),
    // Anonima con profilo che punta al palo A e un members attivo scritto per errore.
    newPerson({ mode: "anonymous", label: "o", member: { status: "active" } }),
    newPerson({ label: "n" }),
    newPerson({ label: "p", member: pendingData() }),
    newPerson({ label: "m", member: { status: "active" } }),
    newPerson({ label: "f", member: declinedData(1) }),
    newPerson({ label: "x", stake: STAKE_B, member: { status: "active" } }),
    newPerson({ label: "d", role: "unit_leader", unit: UNIT1, member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } }),
    newPerson({ label: "d2", role: "unit_leader", unit: UNIT2, member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT2.id, claimedUnitName: UNIT2.name } }),
    newPerson({ label: "a", role: "admin", unit: null, member: { status: "active", staffRole: "admin" } }),
    newPerson({ label: "a2", role: "admin", unit: null, member: { status: "active", staffRole: "admin" } }),
    // Super admin: profilo su un altro palo, nessun members seminato (decide il ruolo).
    newPerson({ label: "sa", role: "super_admin", stake: STAKE_B, unit: null }),
    newPerson({ label: "ab", role: "admin", stake: STAKE_B, unit: null, member: { status: "active", staffRole: "admin" } }),
  ]);
  Object.assign(P, { V, O, N, P: Pp, M, F, X, D, D2, A, A2, SA, AB });
  await settleAll();
  await removeMember(STAKE_A, N.uid);
});

after(async () => {
  try {
    for (const stakeId of STAKES.keys()) await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
    await Promise.all(seededUids.map((uid) => adminDb.doc(`users/${uid}`).delete()));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// Scorciatoie sulle azioni.
const forSelf = (person, action, stakeId = STAKE_A) => person.call({ action, stakeId });
const onUid = (person, action, target, stakeId = STAKE_A, extra = {}) => person.call({ action, stakeId, uid: target.uid, ...extra });
const undo = (person, target, version, stakeId = STAKE_A) => person.call({ action: "undo", stakeId, uid: target.uid, version });

// ===========================================================================
// Controllo: rules caricate, trigger osservato
// ===========================================================================
describe("controllo", () => {
  test("le rules sono caricate: nessuno scrive members né legge la history da client", async () => {
    await assert.rejects(
      setDoc(doc(P.P.db, memberPath(STAKE_A, P.P.uid)), { status: "active", version: 99 }),
      (error) => error?.code === "permission-denied",
    );
    await assert.rejects(
      getDocFromServer(doc(P.A.db, `${memberPath(STAKE_A, P.P.uid)}/history/x`)),
      (error) => error?.code === "permission-denied",
    );
  });

  test("il trigger su users ha risposto allo scaldamento (altrimenti i casi che ne dipendono spiegano il rosso)", (t) => {
    t.diagnostic(`trigger osservato: ${triggerAlive}`);
    assert.equal(triggerAlive, true, "nessun pending creato dal trigger entro 60 s");
  });

  test("le persone sono seminate come dice il contratto", async () => {
    assert.equal(await memberOf(STAKE_A, P.N.uid), null, "N non ha members");
    assert.equal((await memberOf(STAKE_A, P.P.uid)).status, "pending");
    assert.equal((await memberOf(STAKE_A, P.M.uid)).status, "active");
    assert.equal((await memberOf(STAKE_A, P.F.uid)).status, "declined");
    assert.equal((await memberOf(STAKE_B, P.X.uid)).status, "active");
    assert.equal((await memberOf(STAKE_A, P.D.uid)).staffRole, "unit_leader");
    assert.equal((await memberOf(STAKE_A, P.A.uid)).staffRole, "admin");
    assert.equal((await userOf(P.A2.uid)).role, "admin");
  });
});

// ===========================================================================
// Identità e argomenti
// ===========================================================================
describe("identità e argomenti", () => {
  test("V senza login: unauthenticated su ogni azione", async () => {
    for (const action of ["request", "withdraw", "leave"]) await expectError(forSelf(P.V, action), "unauthenticated");
    for (const action of ["approve", "decline", "remove", "undo"]) {
      await expectError(P.V.call({ action, stakeId: STAKE_A, uid: P.P.uid, version: 1 }), "unauthenticated");
    }
  });

  test("O sessione anonima: permission-denied, anche con un members attivo scritto per errore", async () => {
    const before = await memberMeta(STAKE_A, P.O.uid);
    for (const action of ["request", "withdraw", "leave"]) await expectDenied(forSelf(P.O, action));
    await expectDenied(onUid(P.O, "approve", P.P));
    assert.deepEqual(await memberMeta(STAKE_A, P.O.uid), before, "il documento di O non cambia");
  });

  test("argomenti non validi: invalid-argument", async () => {
    await expectError(P.A.call({ action: "boh", stakeId: STAKE_A, uid: P.P.uid }), "invalid-argument");
    await expectError(P.M.call({ action: "request" }), "invalid-argument");
    await expectError(P.M.call({ action: "request", stakeId: "a/b" }), "invalid-argument");
    await expectError(P.A.call({ action: "approve", stakeId: STAKE_A }), "invalid-argument");
    await expectError(P.A.call({ action: "approve", stakeId: STAKE_A, uid: 42 }), "invalid-argument");
    await expectError(P.A.call({ action: "undo", stakeId: STAKE_A, uid: P.P.uid }), "invalid-argument");
    await expectError(P.A.call({ action: "undo", stakeId: STAKE_A, uid: P.P.uid, version: "1" }), "invalid-argument");
    assert.equal((await memberOf(STAKE_A, P.P.uid)).status, "pending", "P intatto");
  });

  test("palo inesistente o members assente: not-found", async () => {
    await expectError(P.SA.call({ action: "approve", stakeId: MISSING_STAKE, uid: P.P.uid }), "not-found");
    // Il controllo del palo viene prima di tutto: anche per `request` (non `stake_not_chosen`).
    await expectError(P.M.call({ action: "request", stakeId: MISSING_STAKE }), "not-found");
    assert.equal(await memberOf(MISSING_STAKE, P.M.uid), null);
    await expectError(onUid(P.A, "approve", P.N), "not-found");
    await expectError(onUid(P.A, "remove", P.N), "not-found");
    await expectError(onUid(P.A, "block", P.N), "not-found");
    assert.equal(await memberOf(STAKE_A, P.N.uid), null, "N resta senza members");
  });
});

// ===========================================================================
// request
// ===========================================================================
describe("request", () => {
  test("N (nessun documento): pending con unità, nome, anno e suggerimenti dal profilo; version 1; history", async () => {
    const n = await freshN("richiesta");
    await adminDb.doc(`stakes/${STAKE_A}/activities/viaggio-${runId}`).set({ title: "Viaggio al tempio", activityType: "trip", isPublic: true });
    await adminDb.doc(`stakes/${STAKE_A}/activities/viaggio-${runId}/registrations/user_${n.uid}`).set({ userId: n.uid, registrationStatus: "confirmed" });
    const profile = await userOf(n.uid);

    const result = await forSelf(n, "request");
    assertChanged(result, { action: "request", status: "pending", version: 1 });

    const data = await memberOf(STAKE_A, n.uid);
    assert.equal(data.status, "pending");
    assert.equal(data.version, 1);
    assert.equal(data.claimedUnitId, profile.unitId);
    assert.equal(data.claimedUnitName, profile.unitName);
    assert.equal(data.displayName, profile.fullName);
    assert.equal(data.birthYear, 2009);
    assert.equal(data.reviewNeeded, false);
    assert.equal(data.staffRole, null);
    assert.equal(data.declineCount, 0);
    assert.ok(data.requestedAt instanceof Timestamp, "requestedAt dal server");
    assert.deepEqual(data.registrationHints, [{ activityId: `viaggio-${runId}`, title: "Viaggio al tempio" }]);
    assert.equal(JSON.stringify(data).includes("2009-04-21"), false, "niente data di nascita completa");
    await expectHistoryRow(STAKE_A, n.uid, { action: "request", by: n.uid, fromStatus: null, toStatus: "pending", version: 1 });
  });

  test("da pending e da active: changed false, nessuna scrittura, version e history invariate", async () => {
    for (const [person, status] of [[P.P, "pending"], [P.M, "active"]]) {
      const before = await memberMeta(STAKE_A, person.uid);
      const rows = (await historyOf(STAKE_A, person.uid)).length;
      const result = await forSelf(person, "request");
      assertUnchanged(result, { action: "request", status, version: before.data.version });
      assert.deepEqual(await memberMeta(STAKE_A, person.uid), before, `${status}: documento riscritto`);
      assert.equal((await historyOf(STAKE_A, person.uid)).length, rows, `${status}: riga di history in più`);
    }
  });

  test("da withdrawn: pending (version +1); il pending dello stesso uid in un altro palo passa a withdrawn", async () => {
    const [who] = await fresh([{ label: "ritorna", member: { status: "withdrawn", sources: [], decidedBy: null, decidedAt: null } }]);
    // Il pending in B si semina DOPO la quiete: il trigger (profilo su A) lo porterebbe a withdrawn da solo.
    await adminDb.doc(memberPath(STAKE_B, who.uid)).set(pendingData(UNIT1, { version: 3 }));
    const before = await memberOf(STAKE_A, who.uid);

    const result = await forSelf(who, "request");
    assertChanged(result, { action: "request", status: "pending", version: before.version + 1 });
    const a = await memberOf(STAKE_A, who.uid);
    assert.equal(a.status, "pending");
    assert.equal(a.claimedUnitId, UNIT1.id);
    assert.equal(a.reviewNeeded, false);
    assertPrevious(a.previous, { status: "withdrawn", action: "request", by: who.uid });
    const b = await memberOf(STAKE_B, who.uid);
    assert.equal(b.status, "withdrawn", "l'altra richiesta aperta si chiude");
    assert.equal(b.version, 4, "anche l'altro documento incrementa version");
    await expectHistoryRow(STAKE_A, who.uid, { action: "request", by: who.uid, fromStatus: "withdrawn", toStatus: "pending", version: before.version + 1 });
  });

  test("da declined entro 7 giorni: cooldown con retryAt; dopo 7 giorni passa e declineCount resta", async () => {
    const [target] = await fresh([{ label: "rifiutato", member: pendingData() }]);
    const declined = await onUid(P.A, "decline", target);
    assertChanged(declined, { action: "decline", status: "declined", version: 2 });
    const decidedAt = (await memberOf(STAKE_A, target.uid)).decidedAt;
    assert.ok(decidedAt instanceof Timestamp);

    await assert.rejects(forSelf(target, "request"), (error) => {
      assert.equal(error?.code, "functions/failed-precondition", `${error?.code}: ${error?.message}`);
      assert.equal(error?.details?.reason, "cooldown", JSON.stringify(error?.details ?? null));
      const retryAt = Date.parse(error.details.retryAt);
      assert.ok(Number.isFinite(retryAt), "retryAt ISO");
      assert.ok(Math.abs(retryAt - (decidedAt.toMillis() + 7 * DAY)) < 2 * 60_000, `retryAt = decidedAt + 7 giorni (${error.details.retryAt})`);
      return true;
    });
    assert.equal((await memberOf(STAKE_A, target.uid)).version, 2, "nessuna scrittura");

    // Il tempo passa: decidedAt otto giorni fa (Admin SDK su members: nessun trigger).
    await adminDb.doc(memberPath(STAKE_A, target.uid)).update({ decidedAt: Timestamp.fromMillis(Date.now() - 8 * DAY) });
    const again = await forSelf(target, "request");
    assertChanged(again, { action: "request", status: "pending", version: 3 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.declineCount, 1, "il contatore dei rifiuti non si azzera");
    assert.equal(data.reviewNeeded, false);
  });

  test("dopo 3 rifiuti: too_many_declines; con 2 passa", async () => {
    const [three, two] = await fresh([
      { label: "tre-rifiuti", member: declinedData(30, 3) },
      { label: "due-rifiuti", member: declinedData(30, 2) },
    ]);
    await expectError(forSelf(three, "request"), "failed-precondition", "too_many_declines");
    assert.equal((await memberOf(STAKE_A, three.uid)).status, "declined");
    assertChanged(await forSelf(two, "request"), { action: "request", status: "pending", version: 2 });
    assert.equal((await memberOf(STAKE_A, two.uid)).declineCount, 2);
  });

  test("su un palo diverso da users.stakeId: stake_not_chosen, nessun documento nell'altro palo", async () => {
    await expectError(forSelf(P.M, "request", STAKE_B), "failed-precondition", "stake_not_chosen");
    assert.equal(await memberOf(STAKE_B, P.M.uid), null);
  });

  test("profilo incompleto: profile_incomplete, nessun documento", async () => {
    const [who] = await fresh([{ label: "incompleto", profile: "incomplete" }]);
    assert.equal(await memberOf(STAKE_A, who.uid), null, "il trigger non mette in coda un profilo incompleto");
    await expectError(forSelf(who, "request"), "failed-precondition", "profile_incomplete");
    assert.equal(await memberOf(STAKE_A, who.uid), null);
  });

  test("da removed e da blocked: invalid_state (serve lo staff)", async () => {
    const [removed, blocked] = await fresh([
      { label: "rimosso", member: { status: "removed" } },
      { label: "bloccato", member: { status: "blocked" } },
    ]);
    await expectInvalidState(forSelf(removed, "request"));
    await expectInvalidState(forSelf(blocked, "request"));
    assert.equal((await memberOf(STAKE_A, removed.uid)).status, "removed");
    assert.equal((await memberOf(STAKE_A, blocked.uid)).status, "blocked");
  });

  test("chi ha un ruolo staff del palo (unit_leader, admin, super_admin): da N, pending, withdrawn, declined → active con staffRole, decidedBy system, un solo motivo staff_approval ref role", async () => {
    const roles = [["unit_leader", "unit_leader"], ["admin", "admin"], ["super_admin", "admin"]];
    const starts = [
      ["nessun-documento", null],
      ["pending", pendingData(UNIT1)],
      ["withdrawn", { status: "withdrawn", sources: [], decidedAt: null, decidedBy: null }],
      ["declined", declinedData(30, 1)],
    ];
    const defs = [];
    for (const [role] of roles) {
      for (const [label] of starts) {
        // Anche admin e super admin con l'unità nel profilo: `request` vuole il profilo completo (unità compresa).
        defs.push({ label: `staff-${role.replace("_", "-")}-${label}`, role, unit: UNIT1, member: { status: "active", staffRole: role === "unit_leader" ? "unit_leader" : "admin" } });
      }
    }
    const people = await fresh(defs);
    let index = 0;
    for (const [role, staffRole] of roles) {
      for (const [label, start] of starts) {
        const who = people[index++];
        // Lo stato di partenza si scrive con l'Admin SDK dopo la quiete: il trigger sul profilo lo avrebbe già attivato.
        if (start) await adminDb.doc(memberPath(STAKE_A, who.uid)).set(memberData({ ...start, staffRole: null }));
        else await removeMember(STAKE_A, who.uid);
        const version = start ? 2 : 1;
        const tag = `${role} da ${label}`;
        assertChanged(await forSelf(who, "request"), { action: "request", status: "active", version });
        const data = await memberOf(STAKE_A, who.uid);
        assert.equal(data.status, "active", tag);
        assert.equal(data.staffRole, staffRole, `${tag}: staffRole`);
        assert.equal(data.reviewNeeded, false, tag);
        assert.equal(data.decidedBy, "system", tag);
        assert.ok(data.decidedAt instanceof Timestamp, tag);
        const approvals = data.sources.filter((source) => source.kind === "staff_approval");
        assert.equal(approvals.length, 1, `${tag}: un solo motivo staff_approval (${JSON.stringify(data.sources)})`);
        assert.equal(approvals[0].ref, "role", tag);
        assert.equal((await userOf(who.uid)).role, role, `${tag}: il ruolo del profilo non cambia`);
        await expectHistoryRow(STAKE_A, who.uid, { action: "request", by: who.uid, fromStatus: start ? start.status : null, toStatus: "active", version });
      }
    }
  });

  test("staff già active con reviewNeeded: reviewNeeded false, staffRole, nessun motivo in più; già confermato: changed false; da removed e blocked: invalid_state", async () => {
    const [review, done, removed, blocked] = await fresh([
      { label: "staff-review", role: "unit_leader", member: { status: "active", staffRole: "unit_leader" } },
      { label: "staff-done", role: "admin", unit: UNIT1, member: { status: "active", staffRole: "admin" } },
      { label: "staff-removed", role: "unit_leader", member: { status: "removed", staffRole: null } },
      { label: "staff-blocked", role: "admin", unit: UNIT1, member: { status: "blocked", staffRole: null } },
    ]);
    // Migrato da confermare, con il motivo del ruolo già presente (Admin SDK dopo la quiete).
    await adminDb.doc(memberPath(STAKE_A, review.uid)).set(memberData({
      status: "active",
      staffRole: null,
      reviewNeeded: true,
      sources: [{ kind: "migration", ref: "a3-2026-10", at: Timestamp.now() }, { kind: "staff_approval", ref: "role", at: Timestamp.now() }],
    }));
    assertChanged(await forSelf(review, "request"), { action: "request", status: "active", version: 2 });
    const data = await memberOf(STAKE_A, review.uid);
    assert.equal(data.reviewNeeded, false);
    assert.equal(data.staffRole, "unit_leader");
    assert.equal(data.sources.filter((source) => source.kind === "staff_approval").length, 1, `nessun motivo doppio: ${JSON.stringify(data.sources)}`);
    assert.equal(data.sources.length, 2, "gli altri motivi restano");
    await expectNoop(STAKE_A, done.uid, () => forSelf(done, "request"), { action: "request", status: "active" });
    await expectInvalidState(forSelf(removed, "request"));
    await expectInvalidState(forSelf(blocked, "request"));
    assert.equal((await memberOf(STAKE_A, removed.uid)).status, "removed");
    assert.equal((await memberOf(STAKE_A, blocked.uid)).status, "blocked");
  });

  test("staff senza unità nel profilo (admin migrato): da N → active con staffRole, come la regola 1; un participant con lo stesso profilo resta profile_incomplete", async () => {
    const [admin, leader, plain] = await fresh([
      { label: "admin-senza-unita", role: "admin", unit: null, member: { status: "active", staffRole: "admin" } },
      { label: "dirigente-senza-unita", role: "unit_leader", unit: null, member: { status: "active", staffRole: "unit_leader" } },
      { label: "participant-senza-unita", unit: null },
    ]);
    for (const person of [admin, leader]) await removeMember(STAKE_A, person.uid);
    assert.equal(await memberOf(STAKE_A, plain.uid), null, "premessa: senza unità il trigger non mette in coda");
    for (const [person, staffRole] of [[admin, "admin"], [leader, "unit_leader"]]) {
      const profile = await userOf(person.uid);
      assert.equal(profile.unitId, "", `${person.name}: premessa`);
      assert.equal(profile.unitName, "", `${person.name}: premessa`);
      assertChanged(await forSelf(person, "request"), { action: "request", status: "active", version: 1 });
      const data = await memberOf(STAKE_A, person.uid);
      assert.equal(data.status, "active", person.name);
      assert.equal(data.staffRole, staffRole, person.name);
      assert.equal(data.claimedUnitId, "", person.name);
      assert.equal(data.decidedBy, "system", person.name);
      assert.equal(data.sources.filter((source) => source.kind === "staff_approval" && source.ref === "role").length, 1, person.name);
    }
    await expectError(forSelf(plain, "request"), "failed-precondition", "profile_incomplete");
    assert.equal(await memberOf(STAKE_A, plain.uid), null, "il participant resta senza documento");
  });

  test("tetti senza scrittura: declined in cooldown, withdrawn o declined con 3 rifiuti → errore e documento identico (dati, updateTime, history)", async () => {
    const [cooling, withdrawnThree, declinedThree, declinedThreeRecent] = await fresh([
      { label: "tetto-cooldown", member: declinedData(1, 1) },
      { label: "tetto-withdrawn-3", member: { status: "withdrawn", sources: [], decidedAt: Timestamp.fromMillis(Date.now() - 30 * DAY), decidedBy: "staff-di-prova", declineCount: 3 } },
      { label: "tetto-declined-3", member: declinedData(30, 3) },
      { label: "tetto-declined-3-recente", member: declinedData(1, 3) },
    ]);
    const cases = [
      [cooling, ["cooldown"]],
      [withdrawnThree, ["too_many_declines"]],
      [declinedThree, ["too_many_declines"]],
      // Rifiutato tre volte e di recente: entrambi i tetti valgono, la spec non dice quale si legge prima.
      [declinedThreeRecent, ["cooldown", "too_many_declines"]],
    ];
    for (const [person, reasons] of cases) {
      const before = await memberMeta(STAKE_A, person.uid);
      const rows = (await historyOf(STAKE_A, person.uid)).length;
      await assert.rejects(forSelf(person, "request"), (error) => {
        assert.equal(error?.code, "functions/failed-precondition", `${person.name}: ${error?.code}: ${error?.message}`);
        assert.ok(reasons.includes(error?.details?.reason), `${person.name}: ${JSON.stringify(error?.details ?? null)}`);
        return true;
      });
      assert.deepEqual(await memberMeta(STAKE_A, person.uid), before, `${person.name}: documento riscritto`);
      assert.equal((await historyOf(STAKE_A, person.uid)).length, rows, `${person.name}: riga di history in più`);
    }
  });
});

// ===========================================================================
// withdraw e leave
// ===========================================================================
describe("withdraw e leave", () => {
  test("withdraw: pending → withdrawn per sé; da withdrawn changed false; da active invalid_state", async () => {
    const [who] = await fresh([{ label: "ritiro", member: pendingData() }]);
    assertChanged(await forSelf(who, "withdraw"), { action: "withdraw", status: "withdrawn", version: 2 });
    const data = await memberOf(STAKE_A, who.uid);
    assert.equal(data.status, "withdrawn");
    assertPrevious(data.previous, { status: "pending", action: "withdraw", by: who.uid });
    await expectHistoryRow(STAKE_A, who.uid, { action: "withdraw", by: who.uid, fromStatus: "pending", toStatus: "withdrawn", version: 2 });
    await expectNoop(STAKE_A, who.uid, () => forSelf(who, "withdraw"), { action: "withdraw", status: "withdrawn" });
    await expectInvalidState(forSelf(P.M, "withdraw"));
    assert.equal((await memberOf(STAKE_A, P.M.uid)).status, "active");
  });

  test("leave: active → withdrawn per sé; da pending invalid_state", async () => {
    const [who] = await fresh([{ label: "uscita", member: { status: "active" } }]);
    assertChanged(await forSelf(who, "leave"), { action: "leave", status: "withdrawn", version: 2 });
    assert.equal((await memberOf(STAKE_A, who.uid)).status, "withdrawn");
    await expectHistoryRow(STAKE_A, who.uid, { action: "leave", by: who.uid, fromStatus: "active", toStatus: "withdrawn", version: 2 });
    await expectInvalidState(forSelf(P.P, "leave"));
    assert.equal((await memberOf(STAKE_A, P.P.uid)).status, "pending");
  });

  test("leave di un dirigente: users.role participant e staffRole null nella stessa azione; il trigger che segue è un no-op", async () => {
    const [leader] = await fresh([{ label: "dirigente-esce", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id } }]);
    assert.equal((await userOf(leader.uid)).role, "unit_leader");
    assertChanged(await forSelf(leader, "leave"), { action: "leave", status: "withdrawn", version: 2 });
    const [data, profile] = await Promise.all([memberOf(STAKE_A, leader.uid), userOf(leader.uid)]);
    assert.equal(data.status, "withdrawn");
    assert.equal(data.staffRole, null);
    assert.equal(profile.role, "participant", "il ruolo del profilo cade con l'uscita");
    assertPrevious(data.previous, { status: "active", action: "leave", by: leader.uid, extraKeys: ["role", "roleAfter", "roleUnitId"] });
    assert.equal(data.previous.staffRole, "unit_leader");
    assert.equal(data.previous.role, "unit_leader");
    assert.equal(data.previous.roleAfter, "participant");
    assert.equal(data.previous.roleUnitId, UNIT1.id);
    await settleAll();
    assert.equal((await memberOf(STAKE_A, leader.uid)).version, 2, "il trigger sul cambio di ruolo non riscrive il documento");
  });

  test("leave di un super admin: esce dal palo ma tiene il ruolo", async () => {
    const [sa] = await fresh([{ label: "super-esce", role: "super_admin", unit: null, member: { status: "active", staffRole: "admin" } }]);
    // La copia di `super_admin` in staffRole non è fissata dalla spec: la version di partenza si legge.
    const before = (await memberOf(STAKE_A, sa.uid)).version;
    assertChanged(await forSelf(sa, "leave"), { action: "leave", status: "withdrawn", version: before + 1 });
    assert.equal((await memberOf(STAKE_A, sa.uid)).status, "withdrawn");
    assert.equal((await userOf(sa.uid)).role, "super_admin", "super_admin non è un ruolo del palo");
  });

  test("l'ultimo admin del palo non può uscire (last_admin); con un secondo admin sì", async () => {
    const stake = await newStake("ultimo-leave");
    const [only] = await fresh([{ label: "unico-admin", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } }]);
    await expectError(forSelf(only, "leave", stake), "failed-precondition", "last_admin");
    assert.equal((await memberOf(stake, only.uid)).status, "active");
    assert.equal((await userOf(only.uid)).role, "admin");

    await fresh([{ label: "secondo-admin", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } }]);
    assertChanged(await forSelf(only, "leave", stake), { action: "leave", status: "withdrawn", version: 2 });
    assert.equal((await userOf(only.uid)).role, "participant");
  });
});

// ===========================================================================
// approve, decline, notMyUnit
// ===========================================================================
describe("approve, decline, notMyUnit", () => {
  test("approve: chi non può (O, N, P, M, F, X, D di un'altra unità, admin di un altro palo) riceve permission-denied e non cambia nulla", async () => {
    const [target] = await fresh([{ label: "da-approvare", member: pendingData(UNIT1) }]);
    const before = await memberMeta(STAKE_A, target.uid);
    for (const person of [P.O, P.N, P.P, P.M, P.F, P.X, P.D2, P.AB]) {
      await expectDenied(onUid(person, "approve", target));
    }
    await expectError(onUid(P.V, "approve", target), "unauthenticated");
    assert.deepEqual(await memberMeta(STAKE_A, target.uid), before, "il documento non cambia");
    assert.equal((await historyOf(STAKE_A, target.uid)).length, 0);
  });

  test("approve del dirigente della unità dichiarata: active, motivo staff_approval con il suo uid, reviewNeeded false, history", async () => {
    const [target] = await fresh([{ label: "approvato-d", member: pendingData(UNIT1) }]);
    const result = await onUid(P.D, "approve", target);
    assertChanged(result, { action: "approve", status: "active", version: 2 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "active");
    assert.equal(data.reviewNeeded, false);
    assert.equal(data.decidedBy, P.D.uid);
    assert.ok(data.decidedAt instanceof Timestamp);
    assert.ok(data.sources.some((source) => source.kind === "staff_approval" && source.ref === P.D.uid), JSON.stringify(data.sources));
    assert.ok(data.sources.every((source) => source.at instanceof Timestamp), "sources[].at sono Timestamp");
    assertPrevious(data.previous, { status: "pending", action: "approve", by: P.D.uid });
    await expectHistoryRow(STAKE_A, target.uid, { action: "approve", by: P.D.uid, fromStatus: "pending", toStatus: "active", version: 2 });
  });

  test("approve dell'admin del palo e del super admin, su qualunque unità", async () => {
    const [one, two] = await fresh([
      { label: "approvato-a", unit: UNIT2, member: pendingData(UNIT2) },
      { label: "approvato-sa", unit: UNIT2, member: pendingData(UNIT2) },
    ]);
    assertChanged(await onUid(P.A, "approve", one), { action: "approve", status: "active", version: 2 });
    assertChanged(await onUid(P.SA, "approve", two), { action: "approve", status: "active", version: 2 });
    assert.equal((await memberOf(STAKE_A, two.uid)).decidedBy, P.SA.uid);
  });

  test("approve da active: changed false senza scrittura; da declined e withdrawn: invalid_state", async () => {
    const [active, declined, withdrawn] = await fresh([
      { label: "gia-attivo", member: { status: "active" } },
      { label: "gia-rifiutato", member: declinedData(1) },
      { label: "gia-uscito", member: { status: "withdrawn" } },
    ]);
    await expectNoop(STAKE_A, active.uid, () => onUid(P.A, "approve", active), { action: "approve", status: "active" });
    for (const target of [declined, withdrawn]) {
      const before = await memberMeta(STAKE_A, target.uid);
      await expectInvalidState(onUid(P.A, "approve", target));
      assert.deepEqual(await memberMeta(STAKE_A, target.uid), before);
    }
  });

  test("approve con un active in un altro palo: quello passa a withdrawn con movedToStakeId", async () => {
    // Attivo in B, profilo ormai su A con richiesta in A (seminata: il trigger non deve decidere l'esito).
    const [mover] = await fresh([{ label: "cambia-palo", members: [{ stake: STAKE_B, status: "active", version: 5 }, { stake: STAKE_A, ...pendingData(UNIT1) }] }]);
    assert.equal((await memberOf(STAKE_B, mover.uid)).status, "active", "l'attivo nel palo vecchio resta finché il nuovo non è approvato");
    assertChanged(await onUid(P.A, "approve", mover), { action: "approve", status: "active", version: 2 });
    const [a, b] = await Promise.all([memberOf(STAKE_A, mover.uid), memberOf(STAKE_B, mover.uid)]);
    assert.equal(a.status, "active");
    assert.ok("moved" in a.previous, "previous.moved registra lo spostamento");
    assert.equal(b.status, "withdrawn");
    assert.equal(b.movedToStakeId, STAKE_A);
    assert.equal(b.version, 6);
  });

  test("decline: solo D della unità e A; declined con declineCount +1; da active invalid_state", async () => {
    const [target, other] = await fresh([
      { label: "da-rifiutare", member: pendingData(UNIT1) },
      { label: "da-rifiutare-2", member: pendingData(UNIT1) },
    ]);
    await expectDenied(onUid(P.D2, "decline", target));
    await expectDenied(onUid(P.M, "decline", target));
    await expectDenied(onUid(P.AB, "decline", target));
    assertChanged(await onUid(P.D, "decline", target), { action: "decline", status: "declined", version: 2 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "declined");
    assert.equal(data.declineCount, 1);
    assert.equal(data.decidedBy, P.D.uid);
    assert.ok(data.decidedAt instanceof Timestamp);
    await expectHistoryRow(STAKE_A, target.uid, { action: "decline", by: P.D.uid, fromStatus: "pending", toStatus: "declined", version: 2 });

    assertChanged(await onUid(P.A, "decline", other), { action: "decline", status: "declined", version: 2 });
    await expectNoop(STAKE_A, other.uid, () => onUid(P.A, "decline", other), { action: "decline", status: "declined" });
    await expectInvalidState(onUid(P.A, "decline", P.M));
    assert.equal((await memberOf(STAKE_A, P.M.uid)).status, "active");
  });

  test("notMyUnit: il dirigente la passa agli admin (claimedUnitId vuoto, nome conservato); poi può agire solo l'admin", async () => {
    const [target] = await fresh([{ label: "unita-sbagliata", member: pendingData(UNIT1) }]);
    await expectDenied(onUid(P.D2, "notMyUnit", target));
    await expectDenied(onUid(P.A, "notMyUnit", target));
    assertChanged(await onUid(P.D, "notMyUnit", target), { action: "notMyUnit", status: "pending", version: 2 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "pending");
    assert.equal(data.claimedUnitId, "");
    assert.equal(data.claimedUnitName, UNIT1.name, "il nome dichiarato resta per chi approva");
    assertPrevious(data.previous, { status: "pending", action: "notMyUnit", by: P.D.uid });
    await expectHistoryRow(STAKE_A, target.uid, { action: "notMyUnit", by: P.D.uid, fromStatus: "pending", toStatus: "pending", version: 2 });

    await expectDenied(onUid(P.D, "approve", target));
    assertChanged(await onUid(P.A, "approve", target), { action: "approve", status: "active", version: 3 });
  });

  test("notMyUnit da active: invalid_state", async () => {
    const [target] = await fresh([{ label: "attivo-unita", member: { status: "active", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } }]);
    await expectInvalidState(onUid(P.D, "notMyUnit", target));
  });
});

// ===========================================================================
// confirmKnown e markUnknown (membri migrati da confermare)
// ===========================================================================
describe("confirmKnown e markUnknown", () => {
  const review = (unit = UNIT1) => ({ status: "active", reviewNeeded: true, claimedUnitId: unit.id, claimedUnitName: unit.name });

  test("confirmKnown: D della unità e A; reviewNeeded false, active, version +1; D2 permission-denied", async () => {
    const [one, two] = await fresh([{ label: "lo-conosco", member: review() }, { label: "lo-conosco-a", member: review(UNIT2) }]);
    await expectDenied(onUid(P.D2, "confirmKnown", one));
    await expectDenied(onUid(P.M, "confirmKnown", one));
    assertChanged(await onUid(P.D, "confirmKnown", one), { action: "confirmKnown", status: "active", version: 2 });
    const data = await memberOf(STAKE_A, one.uid);
    assert.equal(data.status, "active");
    assert.equal(data.reviewNeeded, false);
    assert.equal(data.previous.reviewNeeded, true);
    await expectHistoryRow(STAKE_A, one.uid, { action: "confirmKnown", by: P.D.uid, fromStatus: "active", toStatus: "active", version: 2 });
    assertChanged(await onUid(P.A, "confirmKnown", two), { action: "confirmKnown", status: "active", version: 2 });
  });

  test("markUnknown: active con reviewNeeded → pending, reviewNeeded false", async () => {
    const [target] = await fresh([{ label: "non-lo-conosco", member: review() }]);
    await expectDenied(onUid(P.D2, "markUnknown", target));
    assertChanged(await onUid(P.D, "markUnknown", target), { action: "markUnknown", status: "pending", version: 2 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "pending");
    assert.equal(data.reviewNeeded, false);
    assertPrevious(data.previous, { status: "active", action: "markUnknown", by: P.D.uid });
    await expectHistoryRow(STAKE_A, target.uid, { action: "markUnknown", by: P.D.uid, fromStatus: "active", toStatus: "pending", version: 2 });
  });

  test("active già confermato: confirmKnown changed false, markUnknown invalid_state; pending: confirmKnown invalid_state, markUnknown changed false", async () => {
    const [plain] = await fresh([{ label: "attivo-confermato", member: { status: "active", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } }]);
    await expectNoop(STAKE_A, plain.uid, () => onUid(P.D, "confirmKnown", plain), { action: "confirmKnown", status: "active" });
    await expectInvalidState(onUid(P.D, "markUnknown", plain));
    await expectInvalidState(onUid(P.A, "confirmKnown", P.P));
    await expectNoop(STAKE_A, P.P.uid, () => onUid(P.A, "markUnknown", P.P), { action: "markUnknown", status: "pending" });
    assert.equal((await memberOf(STAKE_A, plain.uid)).version, 1);
  });
});

// ===========================================================================
// remove, block, unblock, reactivate
// ===========================================================================
describe("remove, block, unblock, reactivate", () => {
  test("remove: solo A (D, M, P, admin di un altro palo: permission-denied); active → removed; da pending invalid_state; da removed changed false", async () => {
    const [target] = await fresh([{ label: "da-rimuovere", member: { status: "active" } }]);
    for (const person of [P.D, P.M, P.P, P.AB, P.N]) await expectDenied(onUid(person, "remove", target));
    assert.equal((await memberOf(STAKE_A, target.uid)).version, 1);
    assertChanged(await onUid(P.A, "remove", target), { action: "remove", status: "removed", version: 2 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "removed");
    assert.equal(data.decidedBy, P.A.uid);
    assertPrevious(data.previous, { status: "active", action: "remove", by: P.A.uid });
    await expectHistoryRow(STAKE_A, target.uid, { action: "remove", by: P.A.uid, fromStatus: "active", toStatus: "removed", version: 2 });
    await expectInvalidState(onUid(P.A, "remove", P.P));
    await expectNoop(STAKE_A, target.uid, () => onUid(P.A, "remove", target), { action: "remove", status: "removed" });
  });

  test("remove di un dirigente: ruolo a participant, staffRole null, via dagli elenchi dello staff del palo e NON di un altro palo", async () => {
    const [leader, other] = await fresh([
      { label: "dirigente-rimosso", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id } },
      { label: "collega", member: { status: "active" } },
    ]);
    const actA1 = `campo-${runId}-1`;
    const actA2 = `notte-${runId}-2`;
    const actB = `campo-b-${runId}`;
    await seedStaffLists(STAKE_A, actA1, [leader.uid, other.uid]);
    await seedStaffLists(STAKE_A, actA2, [other.uid, leader.uid]);
    await seedStaffLists(STAKE_B, actB, [leader.uid]);

    assertChanged(await onUid(P.A, "remove", leader), { action: "remove", status: "removed", version: 2 });
    const [data, profile] = await Promise.all([memberOf(STAKE_A, leader.uid), userOf(leader.uid)]);
    assert.equal(data.status, "removed");
    assert.equal(data.staffRole, null);
    assert.equal(profile.role, "participant");
    assertPrevious(data.previous, { status: "active", action: "remove", by: P.A.uid, extraKeys: ["role", "roleAfter", "roleUnitId", "staffLists"] });
    assert.equal(data.previous.role, "unit_leader");
    assert.equal(data.previous.roleAfter, "participant");
    assert.equal(data.previous.roleUnitId, UNIT1.id, "l'unità al momento della rimozione");
    assert.deepEqual(await staffLists(STAKE_A, actA1), { camp: [other.uid], night: [other.uid] });
    assert.deepEqual(await staffLists(STAKE_A, actA2), { camp: [other.uid], night: [other.uid] });
    assert.deepEqual(await staffLists(STAKE_B, actB), { camp: [leader.uid], night: [leader.uid] }, "gli elenchi di un altro palo non si toccano");
    await settleAll();
    assert.equal((await memberOf(STAKE_A, leader.uid)).version, 2, "il trigger sul cambio di ruolo non riscrive");
  });

  test("block: da pending, active, declined, withdrawn, removed → blocked; da blocked changed false; D permission-denied", async () => {
    const states = ["pending", "active", "declined", "withdrawn", "removed", "blocked"];
    const people = await fresh(states.map((status) => ({
      label: `blocco-${status}`,
      member: status === "pending" ? pendingData() : status === "declined" ? declinedData(1) : { status },
    })));
    await expectDenied(onUid(P.D, "block", people[0]));
    await expectDenied(onUid(P.AB, "block", people[0]));
    for (const [index, status] of states.entries()) {
      const person = people[index];
      if (status === "blocked") {
        await expectNoop(STAKE_A, person.uid, () => onUid(P.A, "block", person), { action: "block", status: "blocked" });
        continue;
      }
      assertChanged(await onUid(P.A, "block", person), { action: "block", status: "blocked", version: 2 });
      const data = await memberOf(STAKE_A, person.uid);
      assert.equal(data.status, "blocked", status);
      assertPrevious(data.previous, { status, action: "block", by: P.A.uid });
      await expectHistoryRow(STAKE_A, person.uid, { action: "block", by: P.A.uid, fromStatus: status, toStatus: "blocked", version: 2 });
    }
  });

  test("block di un dirigente: ruolo a participant e via dagli elenchi dello staff", async () => {
    const [leader] = await fresh([{ label: "dirigente-bloccato", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id } }]);
    const act = `campo-blocco-${runId}`;
    await seedStaffLists(STAKE_A, act, [leader.uid, "altro-uid"]);
    assertChanged(await onUid(P.SA, "block", leader), { action: "block", status: "blocked", version: 2 });
    assert.equal((await memberOf(STAKE_A, leader.uid)).staffRole, null);
    assert.equal((await userOf(leader.uid)).role, "participant");
    assert.deepEqual(await staffLists(STAKE_A, act), { camp: ["altro-uid"], night: ["altro-uid"] });
  });

  test("unblock: solo A; blocked → pending (non active); da active invalid_state; da pending changed false", async () => {
    const [target] = await fresh([{ label: "da-sbloccare", member: { status: "blocked", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } }]);
    await expectDenied(onUid(P.D, "unblock", target));
    assertChanged(await onUid(P.A, "unblock", target), { action: "unblock", status: "pending", version: 2 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "pending", "va riverificato");
    assert.equal(data.reviewNeeded, false);
    assertPrevious(data.previous, { status: "blocked", action: "unblock", by: P.A.uid });
    await expectHistoryRow(STAKE_A, target.uid, { action: "unblock", by: P.A.uid, fromStatus: "blocked", toStatus: "pending", version: 2 });
    await expectInvalidState(onUid(P.A, "unblock", P.M));
    await expectNoop(STAKE_A, target.uid, () => onUid(P.A, "unblock", target), { action: "unblock", status: "pending" });
  });

  test("reactivate: removed → stato e motivi di prima; D permission-denied; da active changed false; da blocked invalid_state", async () => {
    const [target] = await fresh([{ label: "da-riattivare", member: { status: "active", sources: [{ kind: "link_code", ref: "codice-1", at: Timestamp.now() }] } }]);
    assertChanged(await onUid(P.A, "remove", target), { action: "remove", status: "removed", version: 2 });
    await expectDenied(onUid(P.D, "reactivate", target));
    assertChanged(await onUid(P.A, "reactivate", target), { action: "reactivate", status: "active", version: 3 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "active");
    assert.deepEqual(data.sources.map((source) => [source.kind, source.ref]), [["link_code", "codice-1"]], "i motivi di prima tornano");
    assert.equal(data.staffRole, null);
    assertPrevious(data.previous, { status: "removed", action: "reactivate", by: P.A.uid });
    await expectHistoryRow(STAKE_A, target.uid, { action: "reactivate", by: P.A.uid, fromStatus: "removed", toStatus: "active", version: 3 });
    await expectNoop(STAKE_A, target.uid, () => onUid(P.A, "reactivate", target), { action: "reactivate", status: "active" });
    const [blocked] = await fresh([{ label: "bloccato-riattiva", member: { status: "blocked" } }]);
    await expectInvalidState(onUid(P.A, "reactivate", blocked));
  });

  test("reactivate di un dirigente rimosso: torna anche il ruolo (profilo e staffRole)", async () => {
    const [leader] = await fresh([{ label: "dirigente-riattivato", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id } }]);
    assertChanged(await onUid(P.A, "remove", leader), { action: "remove", status: "removed", version: 2 });
    assert.equal((await userOf(leader.uid)).role, "participant");
    await settleAll();
    assertChanged(await onUid(P.A, "reactivate", leader), { action: "reactivate", status: "active", version: 3 });
    const [data, profile] = await Promise.all([memberOf(STAKE_A, leader.uid), userOf(leader.uid)]);
    assert.equal(data.status, "active");
    assert.equal(data.staffRole, "unit_leader");
    assert.equal(profile.role, "unit_leader");
    await settleAll();
    assert.equal((await memberOf(STAKE_A, leader.uid)).version, 3, "il trigger sul ruolo ripristinato non riscrive");
  });

  test("reactivate di un dirigente che nel frattempo ha cambiato palo: torna active, ma senza ruolo", async () => {
    const [leader] = await fresh([{ label: "dirigente-altrove", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id } }]);
    assertChanged(await onUid(P.A, "remove", leader), { action: "remove", status: "removed", version: 2 });
    await settleAll();
    // Il profilo cambia palo (console/Admin SDK): il trigger apre al più una richiesta in B.
    const stakeB = STAKES.get(STAKE_B);
    await adminDb.doc(`users/${leader.uid}`).update({ stakeId: STAKE_B, stakeSlug: stakeB.slug, stakeName: stakeB.name, updatedAt: iso() });
    await settleAll();
    assertChanged(await onUid(P.A, "reactivate", leader), { action: "reactivate", status: "active", version: 3 });
    const [data, profile] = await Promise.all([memberOf(STAKE_A, leader.uid), userOf(leader.uid)]);
    assert.equal(data.status, "active");
    assert.equal(data.staffRole, null, "il ruolo non torna: il palo del profilo è un altro");
    assert.equal(profile.role, "participant");
    assert.equal(profile.stakeId, STAKE_B);
  });

  test("reactivate e undo di un dirigente rimosso con un previous vecchio senza roleUnitId e profilo senza unità: ruolo non restituito, staffRole null", async () => {
    // Documento "vecchio": rimozione di un dirigente registrata prima che previous avesse roleUnitId.
    const oldPrevious = () => ({
      status: "active",
      sources: [{ kind: "migration", ref: "a3-2026-10", at: Timestamp.now() }],
      staffRole: "unit_leader",
      reviewNeeded: false,
      claimedUnitId: UNIT1.id,
      claimedUnitName: UNIT1.name,
      declineCount: 0,
      decidedAt: Timestamp.now(),
      decidedBy: "system",
      role: "unit_leader",
      roleAfter: "participant",
      action: "remove",
      by: "admin-di-prova",
    });
    const [viaReactivate, viaUndo] = await fresh([
      { label: "vecchio-riattiva", unit: null, member: { status: "removed", staffRole: null, previous: oldPrevious(), version: 3, decidedBy: "admin-di-prova" } },
      { label: "vecchio-undo", unit: null, member: { status: "removed", staffRole: null, previous: oldPrevious(), version: 3, decidedBy: "admin-di-prova" } },
    ]);
    for (const person of [viaReactivate, viaUndo]) {
      const profile = await userOf(person.uid);
      assert.equal(profile.unitId, "", `${person.name}: premessa`);
      assert.equal(profile.role, "participant", `${person.name}: premessa`);
      assert.equal("roleUnitId" in (await memberOf(STAKE_A, person.uid)).previous, false, `${person.name}: premessa`);
    }
    assertChanged(await onUid(P.A, "reactivate", viaReactivate), { action: "reactivate", status: "active", version: 4 });
    assertChanged(await undo(P.A, viaUndo, 3), { action: "undo", status: "active", version: 4 });
    for (const person of [viaReactivate, viaUndo]) {
      const [data, profile] = await Promise.all([memberOf(STAKE_A, person.uid), userOf(person.uid)]);
      assert.equal(data.status, "active", person.name);
      assert.equal(data.staffRole, null, `${person.name}: staffRole`);
      assert.equal(profile.role, "participant", `${person.name}: il ruolo non torna senza l'unità di allora`);
    }
  });

  test("reactivate senza un previous attivo (documento removed nato così): active con staffRole null", async () => {
    const [target] = await fresh([{ label: "removed-senza-previous", member: { status: "removed", previous: null, sources: [] } }]);
    assertChanged(await onUid(P.A, "reactivate", target), { action: "reactivate", status: "active", version: 2 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "active");
    assert.equal(data.staffRole, null);
  });

  test("l'ultimo admin non si rimuove né si blocca (last_admin); con due admin sì", async () => {
    const stake = await newStake("ultimo-remove");
    const [only] = await fresh([{ label: "unico-admin-r", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } }]);
    await expectError(P.SA.call({ action: "remove", stakeId: stake, uid: only.uid }), "failed-precondition", "last_admin");
    await expectError(P.SA.call({ action: "block", stakeId: stake, uid: only.uid }), "failed-precondition", "last_admin");
    assert.equal((await memberOf(stake, only.uid)).status, "active");
    assert.equal((await userOf(only.uid)).role, "admin");
    const [second] = await fresh([{ label: "secondo-admin-r", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } }]);
    assertChanged(await second.call({ action: "remove", stakeId: stake, uid: only.uid }), { action: "remove", status: "removed", version: 2 });
    assert.equal((await userOf(only.uid)).role, "participant");
    // Ora `second` è l'ultimo: nemmeno il super admin lo blocca.
    await expectError(P.SA.call({ action: "block", stakeId: stake, uid: second.uid }), "failed-precondition", "last_admin");
  });

  test("divieti: lo staff non agisce su sé stesso, il dirigente non su chi ha un ruolo staff, l'admin del palo non su un super admin", async () => {
    for (const action of ["remove", "block", "approve", "decline", "confirmKnown", "reactivate"]) {
      await expectDenied(onUid(P.A, action, P.A));
    }
    for (const action of ["approve", "decline", "notMyUnit", "confirmKnown", "markUnknown"]) {
      await expectDenied(onUid(P.D, action, P.D));
    }
    // D (unità 1) su chi ha un ruolo staff: l'admin A (attivo, staffRole admin) e il dirigente D2.
    for (const target of [P.A, P.D2]) {
      for (const action of ["approve", "decline", "notMyUnit", "confirmKnown", "markUnknown"]) {
        await expectDenied(onUid(P.D, action, target));
      }
    }
    // Admin del palo su un super admin membro del palo.
    const [sa] = await fresh([{ label: "super-nel-palo", role: "super_admin", unit: null, member: { status: "active", staffRole: "admin" } }]);
    for (const action of ["remove", "block", "decline", "confirmKnown"]) await expectDenied(onUid(P.A, action, sa));
    assert.equal((await memberOf(STAKE_A, sa.uid)).status, "active");
    assert.equal((await memberOf(STAKE_A, P.A.uid)).status, "active");
    assert.equal((await memberOf(STAKE_A, P.D2.uid)).status, "active");
  });
});

// ===========================================================================
// undo
// ===========================================================================
describe("undo", () => {
  test("il dirigente annulla la propria approvazione con la version restituita: torna pending, previous null, version +1, history", async () => {
    const [target] = await fresh([{ label: "annulla-approva", member: pendingData(UNIT1) }]);
    const approved = await onUid(P.D, "approve", target);
    assertChanged(approved, { action: "approve", status: "active", version: 2 });
    const undone = await undo(P.D, target, approved.version);
    assertChanged(undone, { action: "undo", status: "pending", version: 3 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "pending");
    assert.equal(data.reviewNeeded, false);
    assert.equal(data.claimedUnitId, UNIT1.id);
    assert.equal(data.previous, null, "dopo l'annullamento non c'è più nulla da annullare");
    assert.equal(data.sources.some((source) => source.kind === "staff_approval"), false, "il motivo dell'approvazione sparisce");
    await expectHistoryRow(STAKE_A, target.uid, { action: "undo", by: P.D.uid, fromStatus: "active", toStatus: "pending", version: 3 });
    await expectError(undo(P.D, target, 3), "failed-precondition", "nothing_to_undo");
  });

  test("version vecchia: version_conflict e nessuna scrittura; con quella giusta si annulla l'ultima azione", async () => {
    const [target] = await fresh([{ label: "annulla-vecchia", member: pendingData(UNIT1) }]);
    const approved = await onUid(P.A, "approve", target);
    const blocked = await onUid(P.A, "block", target);
    assertChanged(blocked, { action: "block", status: "blocked", version: 3 });
    const before = await memberMeta(STAKE_A, target.uid);
    await expectError(undo(P.A, target, approved.version), "failed-precondition", "version_conflict");
    await expectError(undo(P.A, target, 99), "failed-precondition", "version_conflict");
    assert.deepEqual(await memberMeta(STAKE_A, target.uid), before, "nessuna scrittura");
    assertChanged(await undo(P.A, target, blocked.version), { action: "undo", status: "active", version: 4 });
    assert.equal((await memberOf(STAKE_A, target.uid)).status, "active");
  });

  test("un dirigente non annulla l'azione di un altro (permission-denied); l'admin annulla quella del dirigente", async () => {
    const [byAdmin, byLeader] = await fresh([
      { label: "annulla-di-admin", member: pendingData(UNIT1) },
      { label: "annulla-di-dirigente", member: pendingData(UNIT1) },
    ]);
    const first = await onUid(P.A, "approve", byAdmin);
    await expectDenied(undo(P.D, byAdmin, first.version));
    assert.equal((await memberOf(STAKE_A, byAdmin.uid)).status, "active");
    const second = await onUid(P.D, "decline", byLeader);
    await expectDenied(undo(P.D2, byLeader, second.version));
    assertChanged(await undo(P.A, byLeader, second.version), { action: "undo", status: "pending", version: 3 });
    const data = await memberOf(STAKE_A, byLeader.uid);
    assert.equal(data.status, "pending");
    assert.equal(data.declineCount, 0, "il rifiuto annullato non conta");
  });

  test("dopo un'azione dell'utente (withdraw, leave) non c'è nulla da annullare", async () => {
    const [left, withdrawn] = await fresh([{ label: "uscito-undo", member: { status: "active" } }, { label: "ritirato-undo", member: pendingData() }]);
    const leave = await forSelf(left, "leave");
    await expectError(undo(P.A, left, leave.version), "failed-precondition", "nothing_to_undo");
    const withdraw = await forSelf(withdrawn, "withdraw");
    await expectError(undo(P.A, withdrawn, withdraw.version), "failed-precondition", "nothing_to_undo");
    assert.equal((await memberOf(STAKE_A, left.uid)).status, "withdrawn");
    assert.equal((await memberOf(STAKE_A, withdrawn.uid)).status, "withdrawn");
  });

  test("due undo insieme sulla stessa version: uno solo passa", async () => {
    const [target] = await fresh([{ label: "undo-doppio", member: pendingData(UNIT1) }]);
    const approved = await onUid(P.A, "approve", target);
    const [ok, ko] = split(await Promise.allSettled([undo(P.A, target, approved.version), undo(P.A2, target, approved.version)]));
    assert.equal(ok.length, 1, `annullamenti riusciti: ${ok.length}`);
    assert.equal(ko.length, 1);
    assert.equal(ko[0]?.code, "functions/failed-precondition", `${ko[0]?.code}: ${ko[0]?.message}`);
    assert.ok(["version_conflict", "nothing_to_undo"].includes(ko[0]?.details?.reason), JSON.stringify(ko[0]?.details ?? null));
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "pending");
    assert.equal(data.version, 3, "una sola scrittura in più");
    assert.equal(data.previous, null);
  });

  test("undo della rimozione di un dirigente: ruolo, staffRole ed elenchi dello staff tornano", async () => {
    const [leader, other] = await fresh([
      { label: "dirigente-undo", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id } },
      { label: "collega-undo", member: { status: "active" } },
    ]);
    const act = `campo-undo-${runId}`;
    await seedStaffLists(STAKE_A, act, [other.uid, leader.uid]);
    const removed = await onUid(P.A, "remove", leader);
    assert.deepEqual(await staffLists(STAKE_A, act), { camp: [other.uid], night: [other.uid] });
    await settleAll();
    assertChanged(await undo(P.A, leader, removed.version), { action: "undo", status: "active", version: 3 });
    const [data, profile, lists] = await Promise.all([memberOf(STAKE_A, leader.uid), userOf(leader.uid), staffLists(STAKE_A, act)]);
    assert.equal(data.status, "active");
    assert.equal(data.staffRole, "unit_leader");
    assert.equal(data.previous, null);
    assert.equal(profile.role, "unit_leader");
    assert.deepEqual(new Set(lists.camp), new Set([other.uid, leader.uid]), "campStaff ripristinato");
    assert.deepEqual(new Set(lists.night), new Set([other.uid, leader.uid]), "recordNight ripristinato");
    await settleAll();
    assert.equal((await memberOf(STAKE_A, leader.uid)).version, 3, "il trigger sul ruolo ripristinato non riscrive");
  });

  test("undo di un'approvazione che aveva spostato l'appartenenza: l'altro palo torna active", async () => {
    const [mover] = await fresh([{ label: "undo-spostamento", members: [{ stake: STAKE_B, status: "active", version: 2 }, { stake: STAKE_A, ...pendingData(UNIT1) }] }]);
    const approved = await onUid(P.A, "approve", mover);
    assert.equal((await memberOf(STAKE_B, mover.uid)).status, "withdrawn");
    assertChanged(await undo(P.A, mover, approved.version), { action: "undo", status: "pending", version: 3 });
    const [a, b] = await Promise.all([memberOf(STAKE_A, mover.uid), memberOf(STAKE_B, mover.uid)]);
    assert.equal(a.status, "pending");
    assert.equal(b.status, "active", "l'appartenenza spostata torna");
    assert.ok(!b.movedToStakeId, "movedToStakeId sparisce");
    assert.equal(b.version, 4);
  });

  test("undo di un approve con appartenenza spostata: l'altro documento non si tocca se è cambiato (version diversa); se torna, torna senza staffRole", async () => {
    const [changed, withRole] = await fresh([
      { label: "spostato-cambiato", members: [{ stake: STAKE_B, status: "active", version: 2 }, { stake: STAKE_A, ...pendingData(UNIT1) }] },
      { label: "spostato-con-ruolo", members: [{ stake: STAKE_B, status: "active", version: 2 }, { stake: STAKE_A, ...pendingData(UNIT1) }] },
    ]);
    // In B `withRole` aveva un ruolo: scritto dopo la quiete, perché il trigger (regola 4) lo azzererebbe.
    await adminDb.doc(memberPath(STAKE_B, withRole.uid)).update({ staffRole: "unit_leader" });

    const approvedChanged = await onUid(P.A, "approve", changed);
    assert.equal((await memberOf(STAKE_B, changed.uid)).status, "withdrawn");
    // Nel frattempo in B qualcun altro agisce sul documento: version diversa.
    await adminDb.doc(memberPath(STAKE_B, changed.uid)).update({ version: FieldValue.increment(1), decidedBy: "altro-admin" });
    const bBefore = await memberMeta(STAKE_B, changed.uid);
    assertChanged(await undo(P.A, changed, approvedChanged.version), { action: "undo", status: "pending", version: 3 });
    assert.equal((await memberOf(STAKE_A, changed.uid)).status, "pending");
    assert.deepEqual(await memberMeta(STAKE_B, changed.uid), bBefore, "il documento cambiato nell'altro palo non si tocca");

    const approvedWithRole = await onUid(P.A, "approve", withRole);
    assert.equal((await memberOf(STAKE_B, withRole.uid)).status, "withdrawn");
    assertChanged(await undo(P.A, withRole, approvedWithRole.version), { action: "undo", status: "pending", version: 3 });
    const b = await memberOf(STAKE_B, withRole.uid);
    assert.equal(b.status, "active", "l'appartenenza spostata torna");
    assert.equal(b.staffRole, null, "il ruolo vale solo nel palo scelto: torna senza staffRole");
    assert.ok(!b.movedToStakeId);
  });

  test("undo della riattivazione di un admin rimosso: il ruolo torna participant", async () => {
    const stake = await newStake("undo-riattiva");
    const [ax] = await fresh([
      { label: "admin-x", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } },
      { label: "admin-y", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } },
    ]);
    const act = (action, target, extra = {}) => P.SA.call({ action, stakeId: stake, uid: target.uid, ...extra });
    assertChanged(await act("remove", ax), { action: "remove", status: "removed", version: 2 });
    assert.equal((await userOf(ax.uid)).role, "participant");
    await settleAll();
    const reactivated = await act("reactivate", ax);
    assertChanged(reactivated, { action: "reactivate", status: "active", version: 3 });
    assert.equal((await userOf(ax.uid)).role, "admin");
    assert.equal((await memberOf(stake, ax.uid)).previous.roleAfter, "admin");
    await settleAll();
    assertChanged(await act("undo", ax, { version: reactivated.version }), { action: "undo", status: "removed", version: 4 });
    const [data, profile] = await Promise.all([memberOf(stake, ax.uid), userOf(ax.uid)]);
    assert.equal(data.status, "removed");
    assert.equal(data.staffRole, null);
    assert.equal(data.previous, null);
    assert.equal(profile.role, "participant", "il ruolo ridato dalla riattivazione viene tolto");
    await settleAll();
    assert.equal((await memberOf(stake, ax.uid)).version, 4, "il trigger sul ruolo non riscrive");
  });

  test("undo della riattivazione di un admin che nel frattempo è rimasto l'unico: last_admin", async () => {
    const stake = await newStake("undo-ultimo");
    const [bx, by] = await fresh([
      { label: "admin-bx", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } },
      { label: "admin-by", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } },
    ]);
    const act = (action, target, extra = {}) => P.SA.call({ action, stakeId: stake, uid: target.uid, ...extra });
    assertChanged(await act("remove", bx), { action: "remove", status: "removed", version: 2 });
    await settleAll();
    const reactivated = await act("reactivate", bx);
    assertChanged(reactivated, { action: "reactivate", status: "active", version: 3 });
    await settleAll();
    assertChanged(await forSelf(by, "leave", stake), { action: "leave", status: "withdrawn", version: 2 });
    await settleAll();
    await expectError(act("undo", bx, { version: reactivated.version }), "failed-precondition", "last_admin");
    assert.equal((await memberOf(stake, bx.uid)).status, "active");
    assert.equal((await userOf(bx.uid)).role, "admin");
  });

  test("undo di remove e reactivate di un dirigente che nel frattempo ha cambiato unità o palo: ruolo non restituito, staffRole null", async () => {
    const leaderDef = (label) => ({ label, role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } });
    const cases = [
      ["undo-unita", "undo", "unit"],
      ["undo-palo", "undo", "stake"],
      ["riattiva-unita", "reactivate", "unit"],
      ["riattiva-palo", "reactivate", "stake"],
    ];
    const people = await fresh(cases.map(([label]) => leaderDef(`dirigente-${label}`)));
    const stakeB = STAKES.get(STAKE_B);
    for (const [index, [label, action, change]] of cases.entries()) {
      const leader = people[index];
      const removed = await onUid(P.A, "remove", leader);
      const afterRemove = await memberOf(STAKE_A, leader.uid);
      assert.equal(afterRemove.previous.role, "unit_leader", label);
      assert.equal(afterRemove.previous.roleUnitId, UNIT1.id, label);
      assert.equal((await userOf(leader.uid)).role, "participant", label);
      await settleAll();
      // Ora è participant: può cambiare unità (o palo) da solo. Qui lo fa la console.
      const patch = change === "unit"
        ? { unitId: UNIT2.id, unitName: UNIT2.name, updatedAt: iso() }
        : { stakeId: STAKE_B, stakeSlug: stakeB.slug, stakeName: stakeB.name, updatedAt: iso() };
      await adminDb.doc(`users/${leader.uid}`).update(patch);
      await settleAll();
      const result = action === "undo" ? await undo(P.A, leader, removed.version) : await onUid(P.A, "reactivate", leader);
      assertChanged(result, { action, status: "active", version: 3 });
      const [data, profile] = await Promise.all([memberOf(STAKE_A, leader.uid), userOf(leader.uid)]);
      assert.equal(data.status, "active", label);
      assert.equal(data.staffRole, null, `${label}: staffRole`);
      assert.equal(profile.role, "participant", `${label}: il ruolo non torna`);
    }
  });

  test("undo degli elenchi dello staff: un elenco cambiato dopo la rimozione (updatedAt diverso) non riprende l'uid, l'altro sì", async () => {
    const [leader, other] = await fresh([
      { label: "dirigente-elenchi", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id } },
      { label: "collega-elenchi", member: { status: "active" } },
    ]);
    const act = `campo-elenchi-${runId}`;
    await seedStaffLists(STAKE_A, act, [leader.uid, other.uid]);
    const removed = await onUid(P.A, "remove", leader);
    assert.deepEqual(await staffLists(STAKE_A, act), { camp: [other.uid], night: [other.uid] });
    await settleAll();
    // Un admin cambia lo staff del campeggio nel frattempo: terzo in elenco, updatedAt nuovo.
    await adminDb.doc(`stakes/${STAKE_A}/activities/${act}/management/campStaff`).set({ staffUids: [other.uid, "terzo-uid"], updatedAt: iso(Date.now() + 5_000) });
    assertChanged(await undo(P.A, leader, removed.version), { action: "undo", status: "active", version: 3 });
    const lists = await staffLists(STAKE_A, act);
    assert.deepEqual(lists.camp, [other.uid, "terzo-uid"], "campStaff cambiato dopo: non si tocca");
    assert.deepEqual(new Set(lists.night), new Set([other.uid, leader.uid]), "recordNight invariato: l'uid torna");
    assert.equal((await userOf(leader.uid)).role, "unit_leader");
    assert.equal((await memberOf(STAKE_A, leader.uid)).staffRole, "unit_leader");
  });

  test("motivi unici: super admin del palo che esce e rientra due volte ha un solo staff_approval ref role", async () => {
    const [sa] = await fresh([{ label: "super-va-e-viene", role: "super_admin", unit: UNIT1 }]);
    const first = await memberOf(STAKE_A, sa.uid);
    assert.equal(first?.status, "active", "premessa: il trigger lo ha attivato");
    const approvals = (data) => data.sources.filter((source) => source.kind === "staff_approval");
    let version = first.version;
    for (let round = 1; round <= 2; round += 1) {
      assertChanged(await forSelf(sa, "leave"), { action: "leave", status: "withdrawn", version: ++version });
      assert.equal((await userOf(sa.uid)).role, "super_admin", `giro ${round}: tiene il ruolo`);
      assertChanged(await forSelf(sa, "request"), { action: "request", status: "active", version: ++version });
      const data = await memberOf(STAKE_A, sa.uid);
      assert.equal(data.staffRole, "admin", `giro ${round}`);
      assert.deepEqual(approvals(data).map((source) => source.ref), ["role"], `giro ${round}: motivi ${JSON.stringify(data.sources)}`);
    }
  });

  test("motivi unici: approve dello stesso dirigente dopo uscita e nuova richiesta, dopo undo, dopo un rifiuto annullato, o ripetuto: un solo staff_approval con il suo uid", async () => {
    const [again, undone, declinedFirst] = await fresh([
      { label: "approva-esce-rientra", member: pendingData(UNIT1) },
      { label: "approva-undo-approva", member: pendingData(UNIT1) },
      { label: "rifiuta-undo-approva", member: pendingData(UNIT1) },
    ]);
    const byD = (data) => data.sources.filter((source) => source.kind === "staff_approval" && source.ref === P.D.uid);

    // approve → l'utente esce → chiede di nuovo → lo stesso D approva.
    assertChanged(await onUid(P.D, "approve", again), { action: "approve", status: "active", version: 2 });
    assertChanged(await forSelf(again, "leave"), { action: "leave", status: "withdrawn", version: 3 });
    assertChanged(await forSelf(again, "request"), { action: "request", status: "pending", version: 4 });
    assertChanged(await onUid(P.D, "approve", again), { action: "approve", status: "active", version: 5 });
    assert.equal(byD(await memberOf(STAKE_A, again.uid)).length, 1, JSON.stringify((await memberOf(STAKE_A, again.uid)).sources));

    // approve → undo → approve → approve ripetuto (changed false).
    const approved = await onUid(P.D, "approve", undone);
    assertChanged(await undo(P.D, undone, approved.version), { action: "undo", status: "pending", version: 3 });
    assert.equal(byD(await memberOf(STAKE_A, undone.uid)).length, 0, "l'annullamento toglie il motivo");
    assertChanged(await onUid(P.D, "approve", undone), { action: "approve", status: "active", version: 4 });
    await expectNoop(STAKE_A, undone.uid, () => onUid(P.D, "approve", undone), { action: "approve", status: "active" });
    assert.equal(byD(await memberOf(STAKE_A, undone.uid)).length, 1, JSON.stringify((await memberOf(STAKE_A, undone.uid)).sources));

    // decline → undo → approve.
    const declined = await onUid(P.D, "decline", declinedFirst);
    assertChanged(await undo(P.D, declinedFirst, declined.version), { action: "undo", status: "pending", version: 3 });
    assertChanged(await onUid(P.D, "approve", declinedFirst), { action: "approve", status: "active", version: 4 });
    assert.equal(byD(await memberOf(STAKE_A, declinedFirst.uid)).length, 1, JSON.stringify((await memberOf(STAKE_A, declinedFirst.uid)).sources));
  });

  test("il dirigente annulla il proprio notMyUnit anche se la richiesta non è più della sua unità", async () => {
    const [target] = await fresh([{ label: "undo-notmyunit", member: pendingData(UNIT1) }]);
    const passed = await onUid(P.D, "notMyUnit", target);
    assertChanged(passed, { action: "notMyUnit", status: "pending", version: 2 });
    assert.equal((await memberOf(STAKE_A, target.uid)).claimedUnitId, "");
    await expectDenied(undo(P.D2, target, passed.version));
    assertChanged(await undo(P.D, target, passed.version), { action: "undo", status: "pending", version: 3 });
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.claimedUnitId, UNIT1.id, "l'unità dichiarata torna");
    assert.equal(data.claimedUnitName, UNIT1.name);
    assert.equal(data.previous, null);
    await expectHistoryRow(STAKE_A, target.uid, { action: "undo", by: P.D.uid, fromStatus: "pending", toStatus: "pending", version: 3 });
  });
});

// ===========================================================================
// Gare
// ===========================================================================
describe("gare", () => {
  test("approve contro decline sulla stessa richiesta: esattamente uno vince, version +1 una volta, una riga di history", async () => {
    const [target] = await fresh([{ label: "gara-approva-rifiuta", member: pendingData(UNIT1) }]);
    const [ok, ko] = split(await Promise.allSettled([onUid(P.D, "approve", target), onUid(P.A, "decline", target)]));
    assert.equal(ok.length, 1, `riuscite: ${ok.length}`);
    assert.equal(ko.length, 1);
    assert.equal(ko[0]?.code, "functions/failed-precondition", `${ko[0]?.code}: ${ko[0]?.message}`);
    assert.equal(ko[0]?.details?.reason, "invalid_state");
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, ok[0].status);
    assert.ok(["active", "declined"].includes(data.status));
    assert.equal(data.version, 2);
    assert.equal((await historyOf(STAKE_A, target.uid)).length, 1);
  });

  test("due approve insieme: una sola scrittura (l'altra trova già active: changed false)", async () => {
    const [target] = await fresh([{ label: "gara-approva-approva", member: pendingData(UNIT2) }]);
    const [ok, ko] = split(await Promise.allSettled([onUid(P.A, "approve", target), onUid(P.SA, "approve", target)]));
    assert.equal(ko.length, 0, `errori: ${ko.map((error) => `${error?.code}: ${error?.message}`).join("; ")}`);
    assert.equal(ok.filter((result) => result.changed === true).length, 1, `changed true: ${JSON.stringify(ok)}`);
    assert.equal(ok.filter((result) => result.changed === false).length, 1, `changed false: ${JSON.stringify(ok)}`);
    assert.ok(ok.every((result) => result.status === "active" && result.version === 2), JSON.stringify(ok));
    const data = await memberOf(STAKE_A, target.uid);
    assert.equal(data.status, "active");
    assert.equal(data.version, 2);
    assert.equal(data.sources.filter((source) => source.kind === "staff_approval").length, 1, "un solo motivo di approvazione");
  });

  test("gli ultimi due admin escono insieme: ne resta uno", async () => {
    const stake = await newStake("due-admin");
    const [one, two] = await fresh([
      { label: "admin-gara-1", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } },
      { label: "admin-gara-2", role: "admin", stake, unit: null, member: { status: "active", staffRole: "admin" } },
    ]);
    const [ok, ko] = split(await Promise.allSettled([forSelf(one, "leave", stake), forSelf(two, "leave", stake)]));
    assert.equal(ok.length, 1, `uscite riuscite: ${ok.length}`);
    assert.equal(ko[0]?.code, "functions/failed-precondition", `${ko[0]?.code}: ${ko[0]?.message}`);
    assert.equal(ko[0]?.details?.reason, "last_admin");
    const [roleOne, roleTwo] = [(await userOf(one.uid)).role, (await userOf(two.uid)).role];
    assert.deepEqual([roleOne, roleTwo].sort(), ["admin", "participant"], "un admin resta");
    const statuses = [(await memberOf(stake, one.uid)).status, (await memberOf(stake, two.uid)).status].sort();
    assert.deepEqual(statuses, ["active", "withdrawn"]);
  });

  test("request insieme alla creazione del trigger (profilo completato dal client): un solo documento pending, version 1", async () => {
    const person = await newPerson({ label: "gara-trigger", profile: null });
    const profile = profileData({ label: person.name, email: `${person.name}@example.invalid` });
    // Scrittura del client (rules canCreateOwnUser) e richiesta nello stesso istante.
    const [write, request] = await Promise.allSettled([
      setDoc(doc(person.db, `users/${person.uid}`), profile),
      forSelf(person, "request"),
    ]);
    assert.equal(write.status, "fulfilled", `profilo non scritto: ${write.reason?.code} ${write.reason?.message}`);
    if (request.status === "rejected") {
      // Il profilo poteva non esserci ancora: l'unico errore ammesso è profile_incomplete (o not-found del profilo).
      assert.equal(request.reason?.code, "functions/failed-precondition", `${request.reason?.code}: ${request.reason?.message}`);
    }
    await settleAll();
    const data = await waitFor(() => memberOf(STAKE_A, person.uid), (item) => item?.status === "pending", "pending dopo profilo completo");
    assert.equal(data.status, "pending");
    assert.equal(data.claimedUnitId, UNIT1.id);
    assert.equal(data.displayName, profile.fullName);
    assert.equal(data.version, 1, "transazioni giuste: il documento nasce una volta sola, chi arriva dopo non scrive");
    assert.equal(data.sources.filter((source) => source.kind === "staff_approval").length, 0);
    const docs = await adminDb.collection(`stakes/${STAKE_A}/members`).where("displayName", "==", profile.fullName).get();
    assert.equal(docs.size, 1, "un solo documento per questo uid");
  });
});
