// Notte dei Record: callable vere nell'emulatore Functions, con utenti
// dell'Auth emulator. Riferimento: docs/NOTTE_DEI_RECORD.md (non il codice).
//
// Rilancio (solo emulatori, progetto demo-room-planner, porte 9199/8180/5101),
// questo file e le rules insieme:
//   firebase emulators:exec --config firebase.room-test.json --project demo-room-planner \
//     'node --test --test-concurrency=1 functions/tests/recordNightRulesEmulator.test.mjs functions/tests/recordNightEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (i test accettano solo 8180/9199/5101, quindi anche la copia
// del file) e rimuovi i file temporanei a fine prova.
//
// Sezioni: flusso e casi della spec; tabelle stato x azione (admin e ragazzo);
// sequenze casuali con seed fisso (RECORD_NIGHT_FUZZ_SEEDS / _STEPS); contratto
// con recordNightService.ts; letture dirette con token veri; prova che ogni
// azione legge e scrive solo nella transazione; trigger.
//
// Ogni scenario crea una propria attività: stato e limite di 2 non si
// mescolano fra test. Scostamenti dalla spec già accettati dal backend:
// withdrawEntry dell'admin salva statusBeforeWithdraw null; reopen solo per
// proposte; challenge richiede challengerCount > 0; addParticipant/restore
// ammettono record a zero ma non hidden; proposta identica attiva = errore;
// withdraw/restore/reopen ripetuti sono no-op.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { deleteApp, initializeApp as initializeClientApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore as getClientFirestore,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");
const night = require("../lib/recordNight.js");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
assert.equal(PROJECT, "demo-room-planner", "Usare esclusivamente il progetto demo-room-planner");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):8180$/u, "Firestore Emulator richiesto sulla porta 8180");
assert.match(AUTH_HOST, /^(127\.0\.0\.1|localhost):9199$/u, "Auth Emulator richiesto sulla porta 9199");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `record-night-${runId}`;

const LIMIT_MSG = "Limite di 2 record raggiunto: ritirane uno per sceglierne un altro.";
const ADMIN_LIMIT_MSG = "Limite di 2 record raggiunto per questa persona: ne va ritirato uno prima.";
const CLOSED_MSG = "Le iscrizioni ai record sono chiuse.";
const ALREADY_MSG = "Già in gara per questo record.";
const ADMIN_ALREADY_MSG = "Questa persona è già iscritta a questo record.";
const NOT_ENROLLED_MSG = "Per partecipare ai record serve l'iscrizione all'attività.";
const NOT_STAFF_MSG = "Non hai i permessi per gestire i record di questa attività.";
const DUPLICATE_MSG = "Questa proposta è già presente.";

const HOUR = 3600 * 1000;
const inFuture = (hours = 48) => new Date(Date.now() + hours * HOUR).toISOString();
const inPast = (hours = 2) => new Date(Date.now() - hours * HOUR).toISOString();

const PEOPLE = {
  boyA: "Anna Prima",
  boyB: "Bruno Secondo",
  boyC: "Carlo Terzo",
  boyD: "Diana Quarta",
  boyE: "Enrico Quinto",
  boyF: "Fiora Sesta",
};

// ---------------------------------------------------------------------------
// Clienti e dati
// ---------------------------------------------------------------------------

const pool = {};
const apps = [];
const seededUsers = [];

async function makeClient(name, mode) {
  const app = initializeClientApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  if (mode === "anonymous") await signInAnonymously(auth);
  else if (mode === "password") {
    await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, "record-test-password");
  }
  const firestore = getClientFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8180);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5101);
  return {
    name,
    auth,
    firestore,
    uid: auth.currentUser?.uid ?? null,
    participantFn: httpsCallable(functions, "recordNightParticipant"),
    adminFn: httpsCallable(functions, "recordNightAdmin"),
  };
}

const PROFILES = {
  admin: { role: "admin", stakeId },
  superAdmin: { role: "super_admin", stakeId: "other-stake" },
  otherAdmin: { role: "admin", stakeId: "other-stake" },
  leader: { role: "unit_leader", stakeId, unitId: "unit-1" },
  boyA: { role: "participant", stakeId },
  boyB: { role: "participant", stakeId },
  boyC: { role: "participant", stakeId },
  boyD: { role: "participant", stakeId },
  boyE: { role: "participant", stakeId },
  boyF: { role: "participant", stakeId },
  parent: { role: "parent", stakeId },
  noReg: { role: "participant", stakeId },
  cancelled: { role: "participant", stakeId },
  rejectedByParent: { role: "participant", stakeId },
  legacyCancelled: { role: "participant", stakeId },
  elsewhere: { role: "participant", stakeId },
  // Anonimo con profilo e iscrizione user_: deve fallire per l'anonimato.
  anon: { role: "participant", stakeId },
  // Genitori e staff per iscrizione (la categoria sta sull'iscrizione, per attività).
  parent2: { role: "parent", stakeId },
  leaderOther: { role: "unit_leader", stakeId: "other-stake", unitId: "unit-9" },
  adultLeader: { role: "participant", stakeId },
  adultCompanion: { role: "participant", stakeId },
  adultCancelled: { role: "participant", stakeId },
  adultYouth: { role: "participant", stakeId },
  adultNoReg: { role: "participant", stakeId },
  adultOtherStake: { role: "participant", stakeId: "other-stake" },
};

before(async () => {
  const names = Object.keys(PROFILES).filter((name) => name !== "anon");
  const created = await Promise.all(names.map((name) => makeClient(name, "password")));
  for (const client of created) pool[client.name] = client;
  pool.anon = await makeClient("anon", "anonymous");
  pool.signedOut = await makeClient("signed-out", "none");
  pool.noProfile = await makeClient("no-profile", "password");
  await Promise.all(
    Object.entries(PROFILES).map(([name, profile]) => {
      seededUsers.push(pool[name].uid);
      return adminDb.doc(`users/${pool[name].uid}`).set(profile);
    }),
  );
});

after(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
  await Promise.all(seededUsers.map((uid) => adminDb.doc(`users/${uid}`).delete()));
  await adminDb.terminate();
});

let sequence = 0;
const activityPath = (activityId) => `stakes/${stakeId}/activities/${activityId}`;
const entriesRef = (activityId) => adminDb.collection(`${activityPath(activityId)}/recordEntries`);
const recordsRef = (activityId) => adminDb.collection(`${activityPath(activityId)}/records`);

async function enroll(activityId, client, extra = {}) {
  await adminDb.doc(`${activityPath(activityId)}/registrations/user_${client.uid}`).set({
    userId: client.uid,
    fullName: PEOPLE[client.name] ?? "Partecipante Test",
    genderRoleCategory: "giovane_uomo",
    registrationStatus: "confirmed",
    unitId: "unit-1",
    ...extra,
  });
}

// Iscrizione di un adulto (staff "per iscrizione" se dirigente/accompagnatore e non annullata).
async function enrollAdult(activityId, client, category = "dirigente", extra = {}) {
  await enroll(activityId, client, { genderRoleCategory: category, fullName: `Adulto ${client.name}`, ...extra });
}

// Iscrizione di un figlio: child_<parentUid>_<childId>, con parentUid come le scrive l'app.
async function enrollChild(activityId, parent, childId, firstName, extra = {}) {
  const registrationId = `child_${parent.uid}_${childId}`;
  await adminDb.doc(`${activityPath(activityId)}/registrations/${registrationId}`).set({
    parentUid: parent.uid,
    firstName,
    lastName: "Rossi",
    genderRoleCategory: "giovane_uomo",
    registrationStatus: "confirmed",
    unitName: "Unità prova",
    ...extra,
  });
  return registrationId;
}

// Crea un'attività con la Notte dei Record accesa e iscrive i `members`.
// closeAt: undefined = fra 48 ore; null = null salvato; "absent" = campo assente.
async function newActivity({ members = [], enabled = true, closeAt, startDate = "2026-10-16", extra = {} } = {}) {
  const activityId = `act-${++sequence}`;
  const data = { title: "Viaggio al tempio (test)", activityType: "trip", startDate, ...extra };
  if (enabled !== "absent") data.recordsEnabled = enabled;
  if (closeAt !== "absent") data.recordsCloseAt = closeAt === undefined ? inFuture() : closeAt;
  await adminDb.doc(activityPath(activityId)).set(data);
  await Promise.all(members.map((client) => enroll(activityId, client)));
  return activityId;
}

const P = (client, activityId, action, payload = {}) =>
  client.participantFn({ stakeId, activityId, action, ...payload }).then((result) => result.data);
const A = (client, activityId, action, payload = {}) =>
  client.adminFn({ stakeId, activityId, action, ...payload }).then((result) => result.data);

const proposal = (text, extra = {}) => ({ text, measure: "count_in_time", durationSeconds: 60, needs: "", ...extra });
const recordInput = (title, extra = {}) => ({
  title,
  category: "resistenza",
  measure: "count_in_time",
  durationSeconds: 60,
  notes: "",
  ...extra,
});

async function entryData(activityId, entryId) {
  const snap = await entriesRef(activityId).doc(entryId).get();
  assert.equal(snap.exists, true, `tentativo ${entryId} assente`);
  return snap.data();
}
async function recordData(activityId, recordId) {
  const snap = await recordsRef(activityId).doc(recordId).get();
  assert.equal(snap.exists, true, `record ${recordId} assente`);
  return snap.data();
}
async function entriesOfRegistration(activityId, registrationId) {
  const snap = await entriesRef(activityId).where("registrationId", "==", registrationId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// Un ragazzo propone e l'admin approva: restituisce { entry, record } con
// challengerCount 1.
async function makeRecord(activityId, proposer, title, extra = {}) {
  const proposed = await P(proposer, activityId, "propose", proposal(`Proposta: ${title}`, extra));
  const approved = await A(pool.admin, activityId, "approve", {
    entryId: proposed.entry.id,
    ...recordInput(title),
  });
  return { entry: approved.entry, record: approved.record };
}

// Invarianti sempre vere (spec, "Vincoli lato server"): challengerCount =
// tentativi approved del record; max 2 tentativi pending/approved per
// iscrizione; nessuna persona due volte sullo stesso record.
async function assertConsistent(activityId) {
  const [recordSnap, entrySnap] = await Promise.all([recordsRef(activityId).get(), entriesRef(activityId).get()]);
  const allEntries = entrySnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const active = allEntries.filter((entry) => entry.status === "pending" || entry.status === "approved");
  for (const record of recordSnap.docs) {
    const approved = allEntries.filter((entry) => entry.status === "approved" && entry.recordId === record.id).length;
    assert.equal(record.data().challengerCount, approved, `contatore del record ${record.id} (${record.data().title}) non coincide con i tentativi approved`);
    assert.ok(record.data().challengerCount >= 0);
    // Spec: nascondere un record ritira i tentativi approved e azzera il contatore.
    if (record.data().status === "hidden") {
      assert.equal(record.data().challengerCount, 0, `record nascosto ${record.id} con contatore diverso da 0`);
    }
  }
  for (const entry of allEntries) {
    if (entry.status === "approved") {
      assert.equal(typeof entry.recordId, "string", `tentativo approved ${entry.id} senza recordId`);
      assert.ok(recordSnap.docs.some((doc) => doc.id === entry.recordId), `tentativo ${entry.id} punta a un record inesistente`);
    }
  }
  const byRegistration = new Map();
  for (const entry of active) {
    byRegistration.set(entry.registrationId, [...(byRegistration.get(entry.registrationId) ?? []), entry]);
  }
  for (const [registrationId, list] of byRegistration) {
    assert.ok(list.length <= 2, `${registrationId} ha ${list.length} tentativi attivi (massimo 2)`);
    const recordIds = list.map((entry) => entry.recordId).filter(Boolean);
    assert.equal(new Set(recordIds).size, recordIds.length, `${registrationId} è due volte sullo stesso record`);
  }
}

async function expectFail(promise, code, expected) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${code}`, `atteso functions/${code}, ricevuto ${error?.code}: ${error?.message}`);
    if (expected instanceof RegExp) assert.match(error.message, expected);
    else if (typeof expected === "string") assert.equal(error.message, expected);
    return true;
  });
}

async function waitFor(read, predicate, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.fail(`Timeout in attesa di ${description}. Ultimo valore: ${JSON.stringify(last)}`);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Flusso principale
// ---------------------------------------------------------------------------

test("propose → approve → challenge di un secondo ragazzo → contatore 2", async () => {
  const { boyA, boyB, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });

  const proposed = await P(boyA, act, "propose", proposal("Salti a piedi uniti con la corda", { needs: "Una corda" }));
  assert.equal(proposed.ok, true);
  assert.equal(proposed.action, "propose");
  assert.equal(proposed.record, null);
  assert.equal(proposed.entry.status, "pending");
  assert.equal(proposed.entry.kind, "proposal");
  assert.equal(proposed.entry.ownerUid, boyA.uid);
  assert.equal(proposed.entry.registrationId, `user_${boyA.uid}`);
  assert.equal(proposed.entry.recordId, null);
  assert.equal(proposed.entry.participantName, PEOPLE.boyA);
  assert.equal(proposed.entry.proposedText, "Salti a piedi uniti con la corda");
  assert.equal(proposed.entry.proposedMeasure, "count_in_time");
  assert.equal(proposed.entry.proposedDurationSeconds, 60);
  assert.equal(proposed.entry.proposedNeeds, "Una corda");
  assert.equal(proposed.entry.createdByAdmin, false);
  const stored = await entryData(act, proposed.entry.id);
  assert.equal(stored.status, "pending");
  assert.equal(stored.ownerUid, boyA.uid);
  assert.equal((await recordsRef(act).get()).size, 0, "una proposta non crea nessun record");

  const approved = await A(admin, act, "approve", {
    entryId: proposed.entry.id,
    title: "Salti a piedi uniti in 60 secondi",
    category: "resistenza",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "Corda fornita",
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.action, "approve");
  assert.equal(approved.record.status, "open");
  assert.equal(approved.record.challengerCount, 1);
  assert.equal(approved.record.title, "Salti a piedi uniti in 60 secondi");
  assert.equal(approved.record.createdBy, admin.uid);
  assert.equal(approved.entry.status, "approved");
  assert.equal(approved.entry.recordId, approved.record.id);
  assert.equal(approved.entry.decidedBy, admin.uid);
  const afterApprove = await entryData(act, proposed.entry.id);
  assert.equal(afterApprove.proposedText, "Salti a piedi uniti con la corda", "il testo originale non si modifica mai");
  assert.equal(afterApprove.status, "approved");
  assert.equal((await recordData(act, approved.record.id)).challengerCount, 1);

  const challenged = await P(boyB, act, "challenge", { recordId: approved.record.id });
  assert.equal(challenged.ok, true);
  assert.equal(challenged.action, "challenge");
  assert.equal(challenged.entry.status, "approved");
  assert.equal(challenged.entry.kind, "challenge");
  assert.equal(challenged.entry.recordId, approved.record.id);
  assert.equal(challenged.entry.ownerUid, boyB.uid);
  assert.equal(challenged.entry.participantName, PEOPLE.boyB);
  assert.equal(challenged.record.challengerCount, 2);
  assert.equal((await recordData(act, approved.record.id)).challengerCount, 2);

  // Letture del client con i token veri (rules + callable nello stesso giro).
  const recordsPath = `${activityPath(act)}/records`;
  const entriesPath = `${activityPath(act)}/recordEntries`;
  const listRecords = await getDocsFromServer(query(collection(boyB.firestore, recordsPath), where("status", "==", "open")));
  assert.equal(listRecords.size, 1);
  assert.equal(listRecords.docs[0].data().challengerCount, 2);
  // La collection intera non è concessa ai membri (conterrebbe i nascosti).
  await assert.rejects(getDocsFromServer(collection(boyB.firestore, recordsPath)), /permission|insufficient/iu);
  const boyBOwn = await getDocsFromServer(query(collection(boyB.firestore, entriesPath), where("ownerUid", "==", boyB.uid)));
  assert.equal(boyBOwn.size, 1);
  assert.equal(boyBOwn.docs[0].data().kind, "challenge");
  const boyAOwn = await getDocsFromServer(query(collection(boyA.firestore, entriesPath), where("ownerUid", "==", boyA.uid)));
  assert.equal(boyAOwn.size, 1);
  assert.equal(boyAOwn.docs[0].data().status, "approved");
  await assert.rejects(getDocsFromServer(collection(boyB.firestore, entriesPath)), /permission|insufficient/iu);
  const adminAll = await getDocsFromServer(collection(admin.firestore, entriesPath));
  assert.equal(adminAll.size, 2);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Limite di 2 e unicità
// ---------------------------------------------------------------------------

test("limite di 2: la terza azione è rifiutata con il messaggio della spec", async () => {
  const { boyA, boyC, admin } = pool;
  const act = await newActivity({ members: [boyA, boyC] });
  const r1 = await makeRecord(act, boyC, "Equilibrio su un piede");

  const p1 = await P(boyA, act, "propose", proposal("Prima idea", { measure: "other", durationSeconds: null }));
  await P(boyA, act, "propose", proposal("Seconda idea", { measure: "other", durationSeconds: null }));
  await expectFail(P(boyA, act, "propose", proposal("Terza idea", { measure: "other", durationSeconds: null })), "failed-precondition", LIMIT_MSG);
  await expectFail(P(boyA, act, "challenge", { recordId: r1.record.id }), "failed-precondition", LIMIT_MSG);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1, "la sfida rifiutata non muove il contatore");
  assert.equal((await entriesOfRegistration(act, `user_${boyA.uid}`)).length, 2, "nessun tentativo creato dalla terza azione");

  // L'admin che iscrive qualcuno rispetta lo stesso limite.
  await expectFail(
    A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: `user_${boyA.uid}` }),
    "failed-precondition",
    ADMIN_LIMIT_MSG,
  );

  // Un tentativo ritirato libera un posto.
  await P(boyA, act, "withdraw", { entryId: p1.entry.id });
  const challenged = await P(boyA, act, "challenge", { recordId: r1.record.id });
  assert.equal(challenged.record.challengerCount, 2);
  // 2 attivi di nuovo: terza azione ancora rifiutata (approved e pending contano allo stesso modo).
  await expectFail(P(boyA, act, "propose", proposal("Quarta idea", { measure: "other", durationSeconds: null })), "failed-precondition", LIMIT_MSG);

  // Un tentativo rifiutato non conta nel limite.
  const rejectedTarget = (await entriesOfRegistration(act, `user_${boyA.uid}`)).find((e) => e.status === "pending");
  await A(admin, act, "reject", { entryId: rejectedTarget.id, reason: "Troppo rumoroso." });
  const again = await P(boyA, act, "propose", proposal("Idea nuova dopo il rifiuto", { measure: "other", durationSeconds: null }));
  assert.equal(again.entry.status, "pending");
  await assertConsistent(act);
});

test("due tentativi approved occupano il limite quanto due in attesa", async () => {
  const { boyA, boyB, boyC } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC] });
  const r1 = await makeRecord(act, boyB, "Record uno");
  const r2 = await makeRecord(act, boyC, "Record due");
  const r3 = await makeRecord(act, boyB, "Record tre");
  await P(boyA, act, "challenge", { recordId: r1.record.id });
  await P(boyA, act, "challenge", { recordId: r2.record.id });
  await expectFail(P(boyA, act, "challenge", { recordId: r3.record.id }), "failed-precondition", LIMIT_MSG);
  assert.equal((await recordData(act, r3.record.id)).challengerCount, 1);
  await assertConsistent(act);
});

test("sfida doppia dello stesso record rifiutata", async () => {
  const { boyA, boyB } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");

  const first = await P(boyB, act, "challenge", { recordId: r1.record.id });
  assert.equal(first.record.challengerCount, 2);
  await expectFail(P(boyB, act, "challenge", { recordId: r1.record.id }), "failed-precondition", ALREADY_MSG);
  // Anche chi ha proposto quel record (approvato dall'admin) ci è già.
  await expectFail(P(boyA, act, "challenge", { recordId: r1.record.id }), "failed-precondition", ALREADY_MSG);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);

  // Ritirarsi e risfidare è lecito, ma poi "Annulla" del vecchio ritiro non deve duplicare.
  await P(boyB, act, "withdraw", { entryId: first.entry.id });
  const second = await P(boyB, act, "challenge", { recordId: r1.record.id });
  assert.equal(second.record.challengerCount, 2);
  await expectFail(P(boyB, act, "restore", { entryId: first.entry.id }), "failed-precondition", ALREADY_MSG);
  assert.equal((await entryData(act, first.entry.id)).status, "withdrawn");
  await assertConsistent(act);
});

test("sfida a un record inesistente o nascosto rifiutata", async () => {
  const { boyA, boyB, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const r1 = await makeRecord(act, boyA, "Record visibile");
  await expectFail(P(boyB, act, "challenge", { recordId: "non-esiste" }), "failed-precondition");
  await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record visibile"), status: "hidden" });
  await expectFail(P(boyB, act, "challenge", { recordId: r1.record.id }), "failed-precondition");
  assert.equal((await entriesOfRegistration(act, `user_${boyB.uid}`)).length, 0);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Ritiro e ripristino
// ---------------------------------------------------------------------------

test("withdraw + restore di una sfida approvata riportano stato e contatore", async () => {
  const { boyA, boyB } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  const challenge = await P(boyB, act, "challenge", { recordId: r1.record.id });
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);

  const withdrawn = await P(boyB, act, "withdraw", { entryId: challenge.entry.id });
  assert.equal(withdrawn.action, "withdraw");
  assert.equal(withdrawn.entry.status, "withdrawn");
  assert.equal(withdrawn.entry.statusBeforeWithdraw, "approved");
  assert.equal(withdrawn.record.challengerCount, 1);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);

  // Ritiro ripetuto (doppio tocco): nessun secondo decremento, nessuna perdita dello stato di prima.
  const twice = await P(boyB, act, "withdraw", { entryId: challenge.entry.id });
  assert.equal(twice.entry.status, "withdrawn");
  assert.equal(twice.entry.statusBeforeWithdraw, "approved");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);

  const restored = await P(boyB, act, "restore", { entryId: challenge.entry.id });
  assert.equal(restored.action, "restore");
  assert.equal(restored.entry.status, "approved");
  assert.equal(restored.entry.recordId, r1.record.id);
  assert.equal(restored.record.challengerCount, 2);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);

  // Annulla ripetuto: nessun secondo incremento.
  const restoredTwice = await P(boyB, act, "restore", { entryId: challenge.entry.id });
  assert.equal(restoredTwice.entry.status, "approved");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  await assertConsistent(act);
});

test("withdraw + restore di una proposta in attesa riportano testo e stato", async () => {
  const { boyA } = pool;
  const act = await newActivity({ members: [boyA] });
  const proposed = await P(boyA, act, "propose", proposal("Torre di bicchieri", { needs: "Dieci bicchieri" }));
  const withdrawn = await P(boyA, act, "withdraw", { entryId: proposed.entry.id });
  assert.equal(withdrawn.entry.status, "withdrawn");
  assert.equal(withdrawn.entry.statusBeforeWithdraw, "pending");
  assert.equal(withdrawn.record, null);

  const restored = await P(boyA, act, "restore", { entryId: proposed.entry.id });
  assert.equal(restored.entry.status, "pending");
  const stored = await entryData(act, proposed.entry.id);
  assert.equal(stored.status, "pending");
  assert.equal(stored.recordId, null);
  assert.equal(stored.proposedText, "Torre di bicchieri");
  assert.equal(stored.proposedNeeds, "Dieci bicchieri");
  assert.equal(stored.proposedMeasure, "count_in_time");
  assert.equal(stored.proposedDurationSeconds, 60);
  await assertConsistent(act);
});

test("annulla il ritiro con il limite pieno o il record nascosto: l'errore lo dice", async () => {
  const { boyA, boyB, boyD, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyD] });
  const r1 = await makeRecord(act, boyB, "Record uno");
  const r2 = await makeRecord(act, boyB, "Record due");
  const r3 = await makeRecord(act, boyD, "Record tre");

  const c1 = await P(boyA, act, "challenge", { recordId: r1.record.id });
  await P(boyA, act, "withdraw", { entryId: c1.entry.id });
  // Nel frattempo il ragazzo riempie il limite con altri due record.
  const c2 = await P(boyA, act, "challenge", { recordId: r2.record.id });
  await P(boyA, act, "challenge", { recordId: r3.record.id });
  await expectFail(P(boyA, act, "restore", { entryId: c1.entry.id }), "failed-precondition", LIMIT_MSG);
  assert.equal((await entryData(act, c1.entry.id)).status, "withdrawn");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);

  // Record nascosto dall'admin: non si ripristina.
  await P(boyA, act, "withdraw", { entryId: c2.entry.id });
  await A(admin, act, "updateRecord", { recordId: r2.record.id, ...recordInput("Record due"), status: "hidden" });
  await expectFail(P(boyA, act, "restore", { entryId: c2.entry.id }), "failed-precondition");
  assert.equal((await entryData(act, c2.entry.id)).status, "withdrawn");
  await assertConsistent(act);
});

test("ritiro, modifica e ripristino di un tentativo altrui: rifiutati", async () => {
  const { boyA, boyB } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const pending = await P(boyA, act, "propose", proposal("Idea di Anna", { measure: "other", durationSeconds: null }));
  await expectFail(P(boyB, act, "withdraw", { entryId: pending.entry.id }), "not-found");
  await expectFail(P(boyB, act, "restore", { entryId: pending.entry.id }), "not-found");
  await expectFail(P(boyB, act, "edit", { entryId: pending.entry.id, ...proposal("Presa", { measure: "other", durationSeconds: null }) }), "not-found");
  const stored = await entryData(act, pending.entry.id);
  assert.equal(stored.status, "pending");
  assert.equal(stored.proposedText, "Idea di Anna");
  await expectFail(P(boyA, act, "withdraw", { entryId: "inesistente" }), "not-found");
});

test("restore di un tentativo mai ritirato non fa danni; ripristino dopo ritiro d'ufficio negato", async () => {
  const { boyA, boyB, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  const challenge = await P(boyB, act, "challenge", { recordId: r1.record.id });
  const same = await P(boyB, act, "restore", { entryId: challenge.entry.id });
  assert.equal(same.entry.status, "approved");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);

  // Scostamento accettato: il ritiro dell'admin non è annullabile dal ragazzo.
  const byAdmin = await A(admin, act, "withdrawEntry", { entryId: challenge.entry.id });
  assert.equal(byAdmin.entry.status, "withdrawn");
  assert.equal(byAdmin.entry.statusBeforeWithdraw, null);
  assert.equal(byAdmin.record.challengerCount, 1);
  await expectFail(P(boyB, act, "restore", { entryId: challenge.entry.id }), "failed-precondition", /niente da ripristinare/u);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
  // Ritiro admin ripetuto: no-op.
  const again = await A(admin, act, "withdrawEntry", { entryId: challenge.entry.id });
  assert.equal(again.entry.status, "withdrawn");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);

  // Spec: dopo un ritiro l'admin re-iscrive con "Iscrivi qualcuno" (nuovo tentativo, il vecchio resta ritirato).
  const reEnrolled = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: `user_${boyB.uid}` });
  assert.equal(reEnrolled.entry.status, "approved");
  assert.equal(reEnrolled.entry.createdByAdmin, true);
  assert.notEqual(reEnrolled.entry.id, challenge.entry.id);
  assert.equal(reEnrolled.record.challengerCount, 2);
  assert.equal((await entryData(act, challenge.entry.id)).status, "withdrawn");
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Decisioni dell'admin
// ---------------------------------------------------------------------------

test("reject con motivo: il ragazzo lo legge dal proprio tentativo e può proporre altro", async () => {
  const { boyA, admin } = pool;
  const act = await newActivity({ members: [boyA] });
  const proposed = await P(boyA, act, "propose", proposal("Salto dal tavolo", { measure: "distance", durationSeconds: null }));
  const reason = "Troppo pericoloso: scegli una prova da fare con i piedi per terra.";
  const rejected = await A(admin, act, "reject", { entryId: proposed.entry.id, reason });
  assert.equal(rejected.entry.status, "rejected");
  assert.equal(rejected.entry.rejectionReason, reason);
  assert.equal(rejected.entry.decidedBy, admin.uid);
  assert.equal(rejected.record, null);
  assert.equal((await recordsRef(act).get()).size, 0);

  // Lettura del ragazzo: query esatta del client (where ownerUid == uid).
  const own = await getDocsFromServer(
    query(collection(boyA.firestore, `${activityPath(act)}/recordEntries`), where("ownerUid", "==", boyA.uid)),
  );
  assert.equal(own.size, 1);
  assert.equal(own.docs[0].data().status, "rejected");
  assert.equal(own.docs[0].data().rejectionReason, reason);

  // Una proposta rifiutata non si modifica; ne nasce una nuova.
  await expectFail(P(boyA, act, "edit", { entryId: proposed.entry.id, ...proposal("Cambio idea") }), "failed-precondition");
  const next = await P(boyA, act, "propose", proposal("Salti sul posto con la corda"));
  assert.equal(next.entry.status, "pending");

  // Il motivo è obbligatorio e un tentativo non in attesa non si rifiuta.
  await expectFail(A(admin, act, "reject", { entryId: next.entry.id, reason: "   " }), "invalid-argument");
  await expectFail(A(admin, act, "reject", { entryId: proposed.entry.id, reason: "Di nuovo" }), "failed-precondition");
  await assertConsistent(act);
});

test("reopen da approved riporta pending e abbassa il contatore; da rejected riporta pending", async () => {
  const { boyA, boyB, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const proposed = await P(boyA, act, "propose", proposal("Equilibrio sulla sedia"));
  const approved = await A(admin, act, "approve", { entryId: proposed.entry.id, ...recordInput("Equilibrio su una sedia") });
  const recordId = approved.record.id;
  assert.equal((await recordData(act, recordId)).challengerCount, 1);

  const reopened = await A(admin, act, "reopen", { entryId: proposed.entry.id });
  assert.equal(reopened.action, "reopen");
  assert.equal(reopened.entry.status, "pending");
  assert.equal(reopened.entry.recordId, null);
  assert.equal(reopened.entry.decidedAt, null);
  assert.equal(reopened.entry.decidedBy, null);
  assert.equal(reopened.record.challengerCount, 0);
  const stored = await entryData(act, proposed.entry.id);
  assert.equal(stored.status, "pending");
  assert.equal(stored.recordId, null);
  assert.equal(stored.proposedText, "Equilibrio sulla sedia", "la proposta torna com'era, testo originale compreso");
  assert.equal(stored.proposedMeasure, "count_in_time");
  assert.equal(stored.proposedDurationSeconds, 60);
  assert.equal((await recordData(act, recordId)).challengerCount, 0);

  // Riporta in attesa ripetuto: no-op (nessun contatore negativo).
  await A(admin, act, "reopen", { entryId: proposed.entry.id });
  assert.equal((await recordData(act, recordId)).challengerCount, 0);

  // Rifiutata → in attesa: il motivo sparisce.
  await A(admin, act, "reject", { entryId: proposed.entry.id, reason: "Non adatta." });
  const back = await A(admin, act, "reopen", { entryId: proposed.entry.id });
  assert.equal(back.entry.status, "pending");
  assert.equal(back.entry.rejectionReason, "");
  assert.equal((await entryData(act, proposed.entry.id)).rejectionReason, "");

  // Si può approvare di nuovo dopo il ritorno in attesa.
  const second = await A(admin, act, "approve", { entryId: proposed.entry.id, ...recordInput("Equilibrio su una sedia (bis)") });
  assert.equal(second.record.challengerCount, 1);
  await assertConsistent(act);
});

test("reopen: una sfida e un tentativo ritirato non si riportano in attesa; il limite resta rispettato", async () => {
  const { boyA, boyB, boyC, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  const challenge = await P(boyB, act, "challenge", { recordId: r1.record.id });
  // Scostamento accettato: reopen solo per proposte.
  await expectFail(A(admin, act, "reopen", { entryId: challenge.entry.id }), "failed-precondition");
  assert.equal((await entryData(act, challenge.entry.id)).status, "approved");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);

  const proposed = await P(boyC, act, "propose", proposal("Idea ritirata"));
  await P(boyC, act, "withdraw", { entryId: proposed.entry.id });
  await expectFail(A(admin, act, "reopen", { entryId: proposed.entry.id }), "failed-precondition");
  assert.equal((await entryData(act, proposed.entry.id)).status, "withdrawn");

  // Una proposta rifiutata rientra nel limite quando si riapre: se è pieno, errore.
  const rejectedOne = await P(boyC, act, "propose", proposal("Idea rifiutata"));
  await A(admin, act, "reject", { entryId: rejectedOne.entry.id, reason: "No." });
  await P(boyC, act, "propose", proposal("Idea attiva uno"));
  await P(boyC, act, "propose", proposal("Idea attiva due"));
  await expectFail(A(admin, act, "reopen", { entryId: rejectedOne.entry.id }), "failed-precondition", ADMIN_LIMIT_MSG);
  assert.equal((await entryData(act, rejectedOne.entry.id)).status, "rejected");
  await assertConsistent(act);
});

test("un record a zero iscritti torna visibile solo se qualcuno si iscrive o ripristina", async () => {
  const { boyA, boyB, boyC, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  const challenge = await P(boyB, act, "challenge", { recordId: r1.record.id });
  const proposerEntry = r1.entry;
  await P(boyB, act, "withdraw", { entryId: challenge.entry.id });
  await P(boyA, act, "withdraw", { entryId: proposerEntry.id });
  const zero = await recordData(act, r1.record.id);
  assert.equal(zero.challengerCount, 0);
  assert.equal(zero.status, "open");
  // Ripristino: il record torna a contare.
  const restored = await P(boyA, act, "restore", { entryId: proposerEntry.id });
  assert.equal(restored.record.challengerCount, 1);
  await P(boyA, act, "withdraw", { entryId: proposerEntry.id });
  // Scostamento accettato: un record a zero non si sfida a mano, ma l'admin può iscrivere qualcuno.
  await expectFail(P(boyC, act, "challenge", { recordId: r1.record.id }), "failed-precondition");
  const added = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: `user_${boyC.uid}` });
  assert.equal(added.record.challengerCount, 1);
  await assertConsistent(act);
});

test("merge: unisce una proposta a un record esistente; errore se la persona c'è già", async () => {
  const { boyA, boyB, boyC, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  await P(boyB, act, "challenge", { recordId: r1.record.id }); // boyB è già nel record

  // La stessa persona ha una proposta in attesa: unirla al record dove c'è già è un errore.
  const dup = await P(boyB, act, "propose", proposal("Una variante della stessa prova"));
  await expectFail(
    A(admin, act, "merge", { entryId: dup.entry.id, recordId: r1.record.id }),
    "failed-precondition",
    ADMIN_ALREADY_MSG,
  );
  assert.equal((await entryData(act, dup.entry.id)).status, "pending");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);

  // Una terza persona viene unita senza problemi.
  const other = await P(boyC, act, "propose", proposal("Salti con la corda (variante di Carlo)"));
  const merged = await A(admin, act, "merge", { entryId: other.entry.id, recordId: r1.record.id });
  assert.equal(merged.action, "merge");
  assert.equal(merged.entry.status, "approved");
  assert.equal(merged.entry.recordId, r1.record.id);
  assert.equal(merged.record.challengerCount, 3);
  const stored = await entryData(act, other.entry.id);
  assert.equal(stored.proposedText, "Salti con la corda (variante di Carlo)", "il testo originale non si tocca");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 3);

  // "Riporta in attesa" annulla anche l'unione: contatore giù, proposta com'era.
  const unmerged = await A(admin, act, "reopen", { entryId: other.entry.id });
  assert.equal(unmerged.entry.status, "pending");
  assert.equal(unmerged.entry.recordId, null);
  assert.equal(unmerged.record.challengerCount, 2);
  const storedAfter = await entryData(act, other.entry.id);
  assert.equal(storedAfter.proposedText, "Salti con la corda (variante di Carlo)");
  assert.equal(storedAfter.proposedMeasure, "count_in_time");
  await A(admin, act, "merge", { entryId: other.entry.id, recordId: r1.record.id });
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 3);

  // Casi di errore: già approvata, record inesistente, record nascosto, sfida.
  await expectFail(A(admin, act, "merge", { entryId: other.entry.id, recordId: r1.record.id }), "failed-precondition");
  await expectFail(A(admin, act, "merge", { entryId: dup.entry.id, recordId: "non-esiste" }), "not-found");
  await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record di Anna"), status: "hidden" });
  await expectFail(A(admin, act, "merge", { entryId: dup.entry.id, recordId: r1.record.id }), "failed-precondition");
  await assertConsistent(act);
});

test("updateRecord: nascondere ritira gli iscritti e blocca sfide e ripristini, riaprire li rimette; le note restano se omesse", async () => {
  const { boyA, boyB, boyC, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC] });
  const proposed = await P(boyA, act, "propose", proposal("Prova"));
  const approved = await A(admin, act, "approve", { entryId: proposed.entry.id, ...recordInput("Titolo iniziale", { notes: "Materiale: una corda" }) });
  const recordId = approved.record.id;
  const challenge = await P(boyB, act, "challenge", { recordId });

  const hidden = await A(admin, act, "updateRecord", {
    recordId,
    title: "Titolo riscritto",
    category: "precisione",
    measure: "count_streak",
    status: "hidden",
  });
  assert.equal(hidden.ok, true);
  assert.equal(hidden.action, "updateRecord");
  assert.equal(hidden.record.status, "hidden");
  assert.equal(hidden.record.title, "Titolo riscritto");
  assert.equal(hidden.record.category, "precisione");
  assert.equal(hidden.record.measure, "count_streak");
  assert.equal(hidden.record.durationSeconds, null);
  assert.equal(hidden.record.notes, "Materiale: una corda", "note omesse = invariate");
  assert.equal(hidden.entry, null);
  // Spec: nascondere ritira i tentativi approved e azzera il contatore.
  assert.equal(hidden.record.challengerCount, 0);
  assert.equal(hidden.withdrawnCount, 2);
  assert.equal(hidden.restoredCount, 0);
  assert.equal(hidden.notRestoredCount, 0);
  assert.equal((await recordData(act, recordId)).challengerCount, 0);
  for (const entryId of [proposed.entry.id, challenge.entry.id]) {
    const stored = await entryData(act, entryId);
    assert.equal(stored.status, "withdrawn");
    assert.equal(stored.withdrawnBy, "staff");
    assert.equal(stored.withdrawnWithRecordHide, true);
    assert.equal(stored.statusBeforeWithdraw, null, "il ritiro per record nascosto non ha «Annulla»");
  }

  await expectFail(P(boyC, act, "challenge", { recordId }), "failed-precondition");
  // Il ragazzo non può rimettersi da solo: non c'è niente da ripristinare.
  await expectFail(P(boyB, act, "restore", { entryId: challenge.entry.id }), "failed-precondition", /niente da ripristinare/u);
  await expectFail(
    A(admin, act, "addParticipant", { recordId, registrationId: `user_${boyC.uid}` }),
    "failed-precondition",
  );

  const reopened = await A(admin, act, "updateRecord", { recordId, title: "Titolo riscritto", category: "precisione", measure: "count_streak", status: "open", notes: "" });
  assert.equal(reopened.record.status, "open");
  assert.equal(reopened.record.notes, "", "note esplicite vuote = svuotate");
  // Spec: mostrarlo rimette chi può e ricalcola il contatore.
  assert.equal(reopened.restoredCount, 2);
  assert.equal(reopened.notRestoredCount, 0);
  assert.equal(reopened.withdrawnCount, 0);
  assert.equal(reopened.record.challengerCount, 2);
  for (const entryId of [proposed.entry.id, challenge.entry.id]) {
    const stored = await entryData(act, entryId);
    assert.equal(stored.status, "approved");
    assert.equal(stored.withdrawnBy, null);
    assert.equal(stored.withdrawnWithRecordHide, false);
  }
  await expectFail(A(admin, act, "updateRecord", { recordId: "non-esiste", ...recordInput("X"), status: "open" }), "not-found");
  await expectFail(A(admin, act, "updateRecord", { recordId, ...recordInput("X", { category: "inventata" }), status: "open" }), "invalid-argument");
  await expectFail(A(admin, act, "updateRecord", { recordId, ...recordInput("X"), status: "cancellato" }), "invalid-argument");
  await assertConsistent(act);
});

test("edit: solo una proposta in attesa, solo del titolare, senza toccare stato e contatori", async () => {
  const { boyA, admin } = pool;
  const act = await newActivity({ members: [boyA] });
  const proposed = await P(boyA, act, "propose", proposal("Salti con la corda"));
  const edited = await P(boyA, act, "edit", {
    entryId: proposed.entry.id,
    text: "Salti con la corda incrociata",
    measure: "longest_time",
    durationSeconds: null,
    needs: "Una corda lunga",
  });
  assert.equal(edited.action, "edit");
  assert.equal(edited.entry.status, "pending");
  assert.equal(edited.entry.proposedText, "Salti con la corda incrociata");
  assert.equal(edited.entry.proposedMeasure, "longest_time");
  assert.equal(edited.entry.proposedDurationSeconds, null);
  assert.equal(edited.entry.proposedNeeds, "Una corda lunga");
  assert.equal((await entryData(act, proposed.entry.id)).proposedText, "Salti con la corda incrociata");

  // La durata ha senso solo per "Quante volte in un tempo dato".
  await expectFail(P(boyA, act, "edit", { entryId: proposed.entry.id, text: "x", measure: "longest_time", durationSeconds: 60, needs: "" }), "invalid-argument");

  const approved = await A(admin, act, "approve", { entryId: proposed.entry.id, ...recordInput("Salti con la corda incrociata") });
  await expectFail(P(boyA, act, "edit", { entryId: proposed.entry.id, ...proposal("Troppo tardi") }), "failed-precondition");
  assert.equal((await entryData(act, proposed.entry.id)).proposedText, "Salti con la corda incrociata");
  assert.equal((await recordData(act, approved.record.id)).challengerCount, 1);
  await assertConsistent(act);
});

test("proposta identica già attiva = errore; dopo il ritiro si può riproporre", async () => {
  const { boyA } = pool;
  const act = await newActivity({ members: [boyA] });
  const first = await P(boyA, act, "propose", proposal("Torre di bicchieri"));
  await expectFail(P(boyA, act, "propose", proposal("  torre   di BICCHIERI ")), "failed-precondition", DUPLICATE_MSG);
  assert.equal((await entriesOfRegistration(act, `user_${boyA.uid}`)).length, 1);
  await P(boyA, act, "withdraw", { entryId: first.entry.id });
  const again = await P(boyA, act, "propose", proposal("Torre di bicchieri"));
  assert.equal(again.entry.status, "pending");
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Chiusura e interruttore
// ---------------------------------------------------------------------------

test("dopo recordsCloseAt nel passato le azioni del ragazzo falliscono e quelle admin no", async () => {
  const { boyA, boyB, boyC, boyD, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyD] });
  const r1 = await makeRecord(act, boyB, "Equilibrio su un piede");
  const a1 = await P(boyA, act, "propose", proposal("Prima idea di Anna"));
  const a2 = await P(boyA, act, "propose", proposal("Seconda idea di Anna"));
  const c1 = await P(boyC, act, "propose", proposal("Idea ritirata di Carlo"));
  await P(boyC, act, "withdraw", { entryId: c1.entry.id });
  const c2 = await P(boyC, act, "propose", proposal("Idea attiva di Carlo"));

  await adminDb.doc(activityPath(act)).update({ recordsCloseAt: inPast(1) });

  // Ragazzo: tutto chiuso, e nulla cambia.
  await expectFail(P(boyD, act, "propose", proposal("Idea tardiva")), "failed-precondition", CLOSED_MSG);
  await expectFail(P(boyD, act, "challenge", { recordId: r1.record.id }), "failed-precondition", CLOSED_MSG);
  await expectFail(P(boyA, act, "edit", { entryId: a1.entry.id, ...proposal("Modifica tardiva") }), "failed-precondition", CLOSED_MSG);
  await expectFail(P(boyA, act, "withdraw", { entryId: a1.entry.id }), "failed-precondition", CLOSED_MSG);
  await expectFail(P(boyC, act, "restore", { entryId: c1.entry.id }), "failed-precondition", CLOSED_MSG);
  assert.equal((await entryData(act, a1.entry.id)).status, "pending");
  assert.equal((await entryData(act, a1.entry.id)).proposedText, "Prima idea di Anna");
  assert.equal((await entryData(act, c1.entry.id)).status, "withdrawn");
  assert.equal((await entriesOfRegistration(act, `user_${boyD.uid}`)).length, 0);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);

  // Admin: continua ad agire.
  const approved = await A(admin, act, "approve", { entryId: a1.entry.id, ...recordInput("Prima idea di Anna (ufficiale)") });
  assert.equal(approved.record.challengerCount, 1);
  const rejected = await A(admin, act, "reject", { entryId: a2.entry.id, reason: "Ripetitiva." });
  assert.equal(rejected.entry.status, "rejected");
  const reopened = await A(admin, act, "reopen", { entryId: a2.entry.id });
  assert.equal(reopened.entry.status, "pending");
  const merged = await A(admin, act, "merge", { entryId: c2.entry.id, recordId: r1.record.id });
  assert.equal(merged.record.challengerCount, 2);
  const added = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: `user_${boyD.uid}` });
  assert.equal(added.record.challengerCount, 3);
  const renamed = await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Equilibrio su un piede (rivisto)"), status: "open" });
  assert.equal(renamed.record.title, "Equilibrio su un piede (rivisto)");
  const removed = await A(admin, act, "withdrawEntry", { entryId: added.entry.id });
  assert.equal(removed.record.challengerCount, 2);
  const created = await A(admin, act, "createRecord", recordInput("Record creato dopo la chiusura"));
  assert.equal(created.record.challengerCount, 0);
  const joined = await A(admin, act, "addParticipant", { recordId: created.record.id, registrationId: `user_${boyD.uid}` });
  assert.equal(joined.record.challengerCount, 1);
  await assertConsistent(act);
});

test("scadenza: recordsCloseAt vince su startDate; senza recordsCloseAt chiude a startDate", async () => {
  const { boyA } = pool;
  const scenarios = [
    ["recordsCloseAt futuro, startDate passato", { closeAt: inFuture(), startDate: "2020-01-01" }, true],
    ["recordsCloseAt passato, startDate futuro", { closeAt: inPast(), startDate: "2099-01-01" }, false],
    ["recordsCloseAt null, startDate futuro", { closeAt: null, startDate: "2099-01-01" }, true],
    ["recordsCloseAt null, startDate passato", { closeAt: null, startDate: "2020-01-01" }, false],
    ["recordsCloseAt assente, startDate futuro", { closeAt: "absent", startDate: "2099-01-01" }, true],
    ["recordsCloseAt assente, startDate passato", { closeAt: "absent", startDate: "2020-01-01" }, false],
  ];
  for (const [label, options, shouldBeOpen] of scenarios) {
    const act = await newActivity({ members: [boyA], ...options });
    const attempt = P(boyA, act, "propose", proposal(`Prova: ${label}`));
    if (shouldBeOpen) {
      const result = await attempt;
      assert.equal(result.entry.status, "pending", label);
    } else {
      await expectFail(attempt, "failed-precondition", CLOSED_MSG);
    }
  }
});

test("modulo spento (recordsEnabled false o assente): il ragazzo non agisce", async () => {
  const { boyA } = pool;
  for (const enabled of [false, "absent"]) {
    const act = await newActivity({ members: [boyA], enabled });
    await expectFail(P(boyA, act, "propose", proposal("Idea")), "failed-precondition", /non è attiva/u);
    await expectFail(P(boyA, act, "challenge", { recordId: "qualsiasi" }), "failed-precondition", /non è attiva/u);
    assert.equal((await entriesRef(act).get()).size, 0);
  }
});

test("modulo spento: anche le azioni admin sono rifiutate (spec: l'admin agisce «con recordsEnabled»)", async () => {
  const { boyA, boyB, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const r1 = await makeRecord(act, boyB, "Record di Bruno");
  const proposed = await P(boyA, act, "propose", proposal("Idea prima dello spegnimento"));
  await adminDb.doc(activityPath(act)).update({ recordsEnabled: false });
  const attempts = {
    approve: { entryId: proposed.entry.id, ...recordInput("Titolo") },
    merge: { entryId: proposed.entry.id, recordId: r1.record.id },
    reject: { entryId: proposed.entry.id, reason: "No." },
    createRecord: recordInput("Nuovo record a modulo spento"),
    updateRecord: { recordId: r1.record.id, ...recordInput("Rinominato"), status: "hidden" },
    addParticipant: { recordId: r1.record.id, registrationId: `user_${boyA.uid}` },
    withdrawEntry: { entryId: r1.entry.id },
    reopen: { entryId: r1.entry.id },
  };
  for (const [action, payload] of Object.entries(attempts)) {
    await expectFail(A(admin, act, action, payload), "failed-precondition", /non è attiva/u).catch((error) => {
      throw new Error(`${action}: ${error.message}`);
    });
  }
  assert.equal((await entryData(act, proposed.entry.id)).status, "pending");
  assert.equal((await recordsRef(act).get()).size, 1);
  assert.equal((await recordData(act, r1.record.id)).title, "Record di Bruno");
  // Riacceso, l'admin riprende da dove era.
  await adminDb.doc(activityPath(act)).update({ recordsEnabled: true });
  assert.equal((await A(admin, act, "reject", attempts.reject)).entry.status, "rejected");
});

// ---------------------------------------------------------------------------
// Chi può chiamare
// ---------------------------------------------------------------------------

test("ragazzo senza iscrizione o con iscrizione annullata/respinta: rifiutato", async () => {
  const { noReg, cancelled, rejectedByParent, legacyCancelled, elsewhere, parent, boyA } = pool;
  const act = await newActivity({ members: [boyA] });
  await newActivity({ members: [elsewhere] }); // iscritto altrove, non qui
  await enroll(act, cancelled, { registrationStatus: "cancelled" });
  await enroll(act, rejectedByParent, { registrationStatus: "rejected_by_parent" });
  await enroll(act, legacyCancelled, { status: "cancelled" }); // campo legacy
  // Un genitore con il solo figlio iscritto non ha un'iscrizione user_<uid>.
  await adminDb.doc(`${activityPath(act)}/registrations/child_${parent.uid}_kid1`).set({
    parentUid: parent.uid,
    fullName: "Figlio Test",
    registrationStatus: "confirmed",
  });
  const r1 = await makeRecord(act, boyA, "Record per le sfide");

  for (const client of [noReg, cancelled, rejectedByParent, legacyCancelled, elsewhere, parent]) {
    await expectFail(P(client, act, "propose", proposal(`Idea di ${client.name}`)), "permission-denied", NOT_ENROLLED_MSG);
    await expectFail(P(client, act, "challenge", { recordId: r1.record.id }), "permission-denied", NOT_ENROLLED_MSG);
  }
  assert.equal((await entriesRef(act).get()).size, 1, "solo il tentativo di boyA esiste");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
  // Controprova: l'iscrizione attiva di un'altra attività non apre questa.
  assert.equal((await entriesOfRegistration(act, `user_${elsewhere.uid}`)).length, 0);
});

test("iscrizioni non annullate (confermata, inviata, attiva) possono agire", async () => {
  const { boyA, boyB, boyC } = pool;
  const act = await newActivity();
  await enroll(act, boyA, { registrationStatus: "confirmed" });
  await enroll(act, boyB, { registrationStatus: "submitted" });
  await enroll(act, boyC, { registrationStatus: "active" });
  for (const client of [boyA, boyB, boyC]) {
    const result = await P(client, act, "propose", proposal(`Idea di ${client.name}`));
    assert.equal(result.entry.status, "pending");
  }
  await assertConsistent(act);
});

test("attività inesistente o palo sbagliato: not-found", async () => {
  const { boyA } = pool;
  const act = await newActivity({ members: [boyA] });
  await expectFail(P(boyA, "attivita-che-non-esiste", "propose", proposal("Idea")), "not-found");
  await expectFail(P(boyA, act, "propose", { ...proposal("Idea"), stakeId: "un-altro-palo" }), "not-found");
});

test("anonimo = rifiutato, anche con un'iscrizione user_ e un profilo del palo", async () => {
  const { anon, signedOut, boyA } = pool;
  const act = await newActivity({ members: [boyA, anon] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  const pending = await P(boyA, act, "propose", proposal("Idea in attesa"));
  assert.ok(anon.uid);
  await expectFail(P(anon, act, "propose", proposal("Idea anonima")), "permission-denied");
  await expectFail(P(anon, act, "challenge", { recordId: r1.record.id }), "permission-denied");
  await expectFail(A(anon, act, "approve", { entryId: pending.entry.id, ...recordInput("Titolo") }), "permission-denied");
  await expectFail(A(anon, act, "addParticipant", { recordId: r1.record.id, registrationId: `user_${anon.uid}` }), "permission-denied");
  await expectFail(P(signedOut, act, "propose", proposal("Idea senza login")), "unauthenticated");
  await expectFail(A(signedOut, act, "approve", { entryId: pending.entry.id, ...recordInput("Titolo") }), "unauthenticated");
  await expectFail(A(anon, act, "createRecord", recordInput("Record anonimo")), "permission-denied");
  await expectFail(A(signedOut, act, "createRecord", recordInput("Record senza login")), "unauthenticated");
  assert.equal((await recordsRef(act).get()).size, 1);
  assert.equal((await entriesOfRegistration(act, `user_${anon.uid}`)).length, 0);
  assert.equal((await entryData(act, pending.entry.id)).status, "pending");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
});

// Staff = admin/super_admin del palo, unit_leader dello stesso palo, uid in
// management/recordNight.staffUids (messo da un admin). genderRoleCategory NON
// conta: la scrive chiunque nel proprio profilo.
const ADMIN_PAYLOADS = (ctx) => ({
  approve: { entryId: ctx.pending.entry.id, ...recordInput("Titolo") },
  merge: { entryId: ctx.pending.entry.id, recordId: ctx.r1.record.id },
  reject: { entryId: ctx.pending.entry.id, reason: "No." },
  reopen: { entryId: ctx.r1.entry.id },
  createRecord: recordInput("Record abusivo"),
  updateRecord: { recordId: ctx.r1.record.id, ...recordInput("Hack"), status: "hidden" },
  addParticipant: { recordId: ctx.r1.record.id, registrationId: `user_${pool.boyA.uid}` },
  withdrawEntry: { entryId: ctx.r1.entry.id },
  listParticipants: {},
  listStaff: {},
  setStaff: { uid: pool.boyE.uid, enabled: true },
});

const staffDocRef = (activityId) => adminDb.doc(`${activityPath(activityId)}/management/recordNight`);
const staffUidsOf = async (activityId) => {
  const snap = await staffDocRef(activityId).get();
  return snap.exists ? snap.data().staffUids : null;
};
const ADMIN_ONLY_MSG = "Solo gli amministratori del palo possono scegliere chi gestisce i record.";
// Letture "da staff" con il token vero del client: records e recordEntries intere (listAllRecords, listAllEntries).
async function canReadAsStaff(client, activityId) {
  const read = (name) => getDocsFromServer(collection(client.firestore, `${activityPath(activityId)}/${name}`)).then(() => true, (error) => {
    if (error?.code === "permission-denied") return false;
    throw error;
  });
  const [records, entries] = await Promise.all([read("records"), read("recordEntries")]);
  assert.equal(records, entries, "records e recordEntries devono avere lo stesso esito");
  return records;
}

test("chi non è staff non può chiamare recordNightAdmin (nessuna delle 11 azioni), neanche chi si dichiara accompagnatore", async () => {
  const { boyA, boyB, boyE, parent, leaderOther, otherAdmin, noProfile, anon, adultLeader, adultCompanion, adultCancelled, adultYouth, adultNoReg, adultOtherStake, legacyCancelled, elsewhere } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  // Un ragazzo che nel proprio profilo si dichiara accompagnatore o dirigente e si iscrive come tale.
  await enrollAdult(act, boyE, "accompagnatore");
  await enrollAdult(act, adultLeader, "dirigente");
  await enrollAdult(act, adultCompanion, "accompagnatore");
  await enrollAdult(act, adultCancelled, "dirigente", { registrationStatus: "cancelled" });
  await enrollAdult(act, legacyCancelled, "accompagnatore", { status: "cancelled" }); // campo legacy
  await enrollAdult(act, adultYouth, "giovane_uomo");
  await enrollAdult(act, adultOtherStake, "dirigente"); // iscritto qui, ma profilo di un altro palo
  await enrollChild(act, parent, "kid1", "Carlo");
  // Dirigente iscritto a un'altra attività: qui non gestisce niente.
  await newActivity({ members: [elsewhere] });
  await enrollAdult(await newActivity(), adultNoReg, "dirigente");
  const r1 = await makeRecord(act, boyB, "Record di Bruno");
  const pending = await P(boyA, act, "propose", proposal("Idea di Anna"));
  const payloads = ADMIN_PAYLOADS({ pending, r1 });

  const nonStaff = [boyA, boyE, parent, leaderOther, otherAdmin, noProfile, adultLeader, adultCompanion, adultCancelled, legacyCancelled, adultYouth, adultNoReg, adultOtherStake, elsewhere];
  const failures = [];
  for (const client of nonStaff) {
    for (const [action, payload] of Object.entries(payloads)) {
      try {
        await A(client, act, action, payload);
        failures.push(`${client.name} / ${action}: ACCETTATO`);
      } catch (error) {
        if (error?.code !== "functions/permission-denied" || error.message !== NOT_STAFF_MSG) {
          failures.push(`${client.name} / ${action}: ${error?.code} «${error?.message}»`);
        }
      }
    }
    // Nemmeno per il client: context dice che non è staff e non gestisce l'elenco.
    const context = await P(client, act, "context");
    if (context.isStaff !== false || context.canManageStaff !== false) failures.push(`${client.name} / context: isStaff=${context.isStaff} canManageStaff=${context.canManageStaff}`);
  }
  assert.deepEqual(failures, [], `Non staff non rifiutati con permission-denied + messaggio della spec:\n${failures.join("\n")}`);
  for (const [action, payload] of Object.entries(payloads)) {
    await expectFail(A(anon, act, action, payload), "permission-denied");
    await expectFail(A(pool.signedOut, act, action, payload), "unauthenticated");
  }
  // Nulla è cambiato: nessuno si è messo in elenco.
  assert.equal(await staffUidsOf(act), null, "management/recordNight non deve esistere");
  assert.equal((await entryData(act, pending.entry.id)).status, "pending");
  assert.equal((await entryData(act, r1.entry.id)).status, "approved");
  const record = await recordData(act, r1.record.id);
  assert.equal(record.status, "open");
  assert.equal(record.title, "Record di Bruno");
  assert.equal(record.challengerCount, 1);
  assert.equal((await recordsRef(act).get()).size, 1);
  await assertConsistent(act);
});

// Per ogni tipo di staff tutte le azioni di gestione funzionano (prima e dopo la chiusura delle iscrizioni);
// scegliere chi è in elenco (listStaff, setStaff) solo per admin e super_admin.
const STAFF_KINDS = [
  ["admin del palo", "admin", { manage: true }],
  ["super_admin di un altro palo", "superAdmin", { manage: true }],
  ["unit_leader dello stesso palo, non iscritto", "leader", { manage: false }],
  ["iscritto messo in elenco da un admin", "adultCompanion", { manage: false, category: "accompagnatore" }],
  ["ragazzo messo in elenco da un admin (la categoria non conta)", "adultYouth", { manage: false, category: "giovane_uomo" }],
];

for (const closed of [false, true]) {
  for (const [label, key, { manage, category }] of STAFF_KINDS) {
    test(`staff (${label}) esegue tutte le azioni di recordNightAdmin${closed ? " anche dopo la chiusura" : ""}`, async () => {
      const staff = pool[key];
      const { boyA, boyB, boyC, boyD, admin } = pool;
      const act = await newActivity({ members: [boyA, boyB, boyC, boyD] });
      if (category) {
        await enrollAdult(act, staff, category);
        await A(admin, act, "setStaff", { uid: staff.uid, enabled: true });
      }
      const a = await P(boyA, act, "propose", proposal("Idea di Anna"));
      const c = await P(boyC, act, "propose", proposal("Idea di Carlo"));
      const d = await P(boyD, act, "propose", proposal("Idea di Diana"));
      if (closed) await adminDb.doc(activityPath(act)).update({ recordsCloseAt: inPast(1) });

      const context = await P(staff, act, "context");
      assert.equal(context.isStaff, true);
      assert.equal(context.canManageStaff, manage);
      const approved = await A(staff, act, "approve", { entryId: a.entry.id, ...recordInput("Salti con la corda") });
      assert.equal(approved.record.createdBy, staff.uid);
      assert.equal(approved.entry.decidedBy, staff.uid);
      const merged = await A(staff, act, "merge", { entryId: c.entry.id, recordId: approved.record.id });
      assert.equal(merged.record.challengerCount, 2);
      assert.equal((await A(staff, act, "reject", { entryId: d.entry.id, reason: "Troppo rumorosa." })).entry.status, "rejected");
      assert.equal((await A(staff, act, "reopen", { entryId: d.entry.id })).entry.status, "pending");
      const created = await A(staff, act, "createRecord", recordInput("Record creato dallo staff"));
      assert.equal(created.record.challengerCount, 0);
      const added = await A(staff, act, "addParticipant", { recordId: created.record.id, registrationId: `user_${boyB.uid}` });
      assert.equal(added.record.challengerCount, 1);
      const hidden = await A(staff, act, "updateRecord", { recordId: created.record.id, ...recordInput("Record creato dallo staff"), status: "hidden" });
      assert.equal(hidden.withdrawnCount, 1);
      const shown = await A(staff, act, "updateRecord", { recordId: created.record.id, ...recordInput("Record creato dallo staff"), status: "open" });
      assert.equal(shown.restoredCount, 1);
      const removed = await A(staff, act, "withdrawEntry", { entryId: added.entry.id });
      assert.equal(removed.entry.withdrawnBy, "staff");
      const listed = await A(staff, act, "listParticipants");
      assert.deepEqual(
        listed.participants.map((item) => item.registrationId).filter((id) => id.startsWith("user_")).sort(),
        [boyA, boyB, boyC, boyD, ...(category ? [staff] : [])].map((client) => `user_${client.uid}`).sort(),
      );
      // Chi sceglie lo staff: solo admin e super_admin.
      if (manage) {
        assert.equal((await A(staff, act, "listStaff")).ok, true);
        assert.equal((await A(staff, act, "setStaff", { uid: boyA.uid, enabled: false })).ok, true);
      } else {
        await expectFail(A(staff, act, "listStaff"), "permission-denied", ADMIN_ONLY_MSG);
        await expectFail(A(staff, act, "setStaff", { uid: boyA.uid, enabled: true }), "permission-denied", ADMIN_ONLY_MSG);
        const list = await staffUidsOf(act);
        assert.ok(!(list ?? []).includes(boyA.uid), "uno staff non admin non può mettere altri in elenco");
      }
      await assertConsistent(act);
    });
  }
}

test("setStaff: elenco ordinato e senza doppioni, serve un'iscrizione user_ attiva, vale per callable e per chi interroga", async () => {
  const { boyA, boyB, boyE, parent, admin, superAdmin, leader, adultLeader, adultCompanion, adultCancelled, adultNoReg } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  await enrollAdult(act, adultCompanion, "accompagnatore");
  await enrollAdult(act, adultLeader, "dirigente");
  await enrollAdult(act, boyE, "accompagnatore");
  await enrollAdult(act, adultCancelled, "dirigente", { registrationStatus: "cancelled" });
  await enrollChild(act, parent, "kid1", "Carlo"); // il genitore ha solo l'iscrizione del figlio
  const pending = await P(boyA, act, "propose", proposal("Idea di Anna"));

  // Chi gestisce l'elenco.
  assert.equal(await staffUidsOf(act), null);
  assert.deepEqual(
    await Promise.all([admin, superAdmin, leader, adultCompanion].map(async (client) => (await P(client, act, "context")).canManageStaff)),
    [true, true, false, false],
  );

  // Prima di essere messo in elenco chi si dichiara accompagnatore non legge nomi e proposte (rules).
  assert.equal(await canReadAsStaff(adultCompanion, act), false);
  assert.equal(await canReadAsStaff(boyE, act), false);
  assert.equal(await canReadAsStaff(admin, act), true);
  assert.equal(await canReadAsStaff(leader, act), true);

  // Messa in elenco: risposta, documento, ordine, nessun doppione.
  const first = await A(admin, act, "setStaff", { uid: adultCompanion.uid, enabled: true });
  assert.deepEqual(Object.keys(first).sort(), ["action", "ok", "staffUids"]);
  assert.equal(first.ok, true);
  assert.equal(first.action, "setStaff");
  assert.deepEqual(first.staffUids, [adultCompanion.uid]);
  const doc1 = (await staffDocRef(act).get()).data();
  assert.deepEqual(doc1.staffUids, [adultCompanion.uid]);
  assert.equal(doc1.updatedBy, admin.uid);
  assert.ok(!Number.isNaN(new Date(doc1.updatedAt).getTime()));
  const again = await A(admin, act, "setStaff", { uid: adultCompanion.uid, enabled: true });
  assert.deepEqual(again.staffUids, [adultCompanion.uid], "nessun doppione");
  const two = await A(superAdmin, act, "setStaff", { uid: boyB.uid, enabled: true });
  assert.deepEqual(two.staffUids, [adultCompanion.uid, boyB.uid].sort());
  assert.equal((await staffDocRef(act).get()).data().updatedBy, superAdmin.uid);

  // Togliere chi non c'è non fa nulla (e non riscrive il documento).
  const before = (await staffDocRef(act).get()).data();
  const noop = await A(admin, act, "setStaff", { uid: adultLeader.uid, enabled: false });
  assert.deepEqual(noop.staffUids, before.staffUids);
  assert.deepEqual((await staffDocRef(act).get()).data(), before);

  // Serve un'iscrizione user_ attiva a questa attività.
  for (const [label, uid] of [["senza iscrizione", adultNoReg.uid], ["iscrizione annullata", adultCancelled.uid], ["solo l'iscrizione di un figlio", parent.uid], ["uid inesistente", "uid-che-non-esiste"]]) {
    await expectFail(A(admin, act, "setStaff", { uid, enabled: true }), "failed-precondition", /iscrizione attiva/u).catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    });
  }
  // Input non valido.
  await expectFail(A(admin, act, "setStaff", { uid: boyA.uid, enabled: "true" }), "invalid-argument");
  await expectFail(A(admin, act, "setStaff", { uid: boyA.uid }), "invalid-argument");
  await expectFail(A(admin, act, "setStaff", { enabled: true }), "invalid-argument");
  await expectFail(A(admin, act, "setStaff", { uid: "../x", enabled: true }), "invalid-argument");
  await expectFail(A(admin, act, "setStaff", { uid: boyA.uid, enabled: true, role: "admin" }), "invalid-argument");
  assert.deepEqual((await staffDocRef(act).get()).data(), before, "gli errori non toccano l'elenco");

  // Solo admin e super_admin: né l'unit_leader né chi è già in elenco scelgono lo staff.
  for (const client of [leader, adultCompanion, boyB]) {
    await expectFail(A(client, act, "setStaff", { uid: boyA.uid, enabled: true }), "permission-denied");
    await expectFail(A(client, act, "listStaff"), "permission-denied");
  }
  // Chi si dichiara accompagnatore ma non è in elenco: nessun permesso, neanche su setStaff.
  for (const client of [boyE, adultLeader]) {
    await expectFail(A(client, act, "setStaff", { uid: client.uid, enabled: true }), "permission-denied", NOT_STAFF_MSG);
    await expectFail(A(client, act, "reject", { entryId: pending.entry.id, reason: "No." }), "permission-denied", NOT_STAFF_MSG);
  }
  assert.deepEqual((await staffDocRef(act).get()).data(), before);

  // Effetto: chi è in elenco gestisce, gli altri no (anche con la stessa categoria dichiarata): callable e rules.
  assert.equal(await canReadAsStaff(adultCompanion, act), true);
  assert.equal(await canReadAsStaff(boyB, act), true);
  assert.equal(await canReadAsStaff(boyE, act), false);
  assert.equal(await canReadAsStaff(adultLeader, act), false);
  assert.equal((await P(adultCompanion, act, "context")).isStaff, true);
  assert.equal((await P(boyE, act, "context")).isStaff, false);
  assert.equal((await A(adultCompanion, act, "reject", { entryId: pending.entry.id, reason: "Rumorosa." })).entry.status, "rejected");
  assert.equal((await A(boyB, act, "reopen", { entryId: pending.entry.id })).entry.status, "pending");

  // Tolto dall'elenco non gestisce più.
  const removed = await A(admin, act, "setStaff", { uid: adultCompanion.uid, enabled: false });
  assert.deepEqual(removed.staffUids, [boyB.uid]);
  await expectFail(A(adultCompanion, act, "reject", { entryId: pending.entry.id, reason: "Ancora." }), "permission-denied", NOT_STAFF_MSG);
  assert.equal((await P(adultCompanion, act, "context")).isStaff, false);
  assert.equal(await canReadAsStaff(adultCompanion, act), false, "tolto dall'elenco, anche le rules lo negano");
  assert.equal(await canReadAsStaff(boyB, act), true);
  assert.equal((await entryData(act, pending.entry.id)).status, "pending");
  await assertConsistent(act);
});

test("listStaff: candidati = iscrizioni user_ attive, adulti prima, sei campi, isStaff dall'elenco", async () => {
  const { boyA, boyB, parent, admin, superAdmin, adultLeader, adultCompanion, adultCancelled, legacyCancelled } = pool;
  const sensitive = { phone: "3331112222", email: "segreto@example.invalid", medicalNotes: "allergia agli arachidi", parentEmail: "genitore-segreto@example.invalid" };
  const act = await newActivity();
  await enroll(act, boyA, { ...sensitive, unitName: "Rione Primo" });
  await enroll(act, boyB, { ...sensitive, unitNameSnapshot: "Rione Secondo (copia)" });
  await enrollAdult(act, adultLeader, "dirigente", { ...sensitive });
  await enrollAdult(act, adultCompanion, "accompagnatore");
  await enrollAdult(act, adultCancelled, "dirigente", { registrationStatus: "cancelled" });
  await enrollAdult(act, legacyCancelled, "accompagnatore", { status: "cancelled" });
  await enrollChild(act, parent, "kid1", "Carlo", sensitive);
  await adminDb.doc(`${activityPath(act)}/registrations/guest_ospite`).set({ fullName: "Ospite Esterno", registrationStatus: "submitted", ...sensitive });
  await A(admin, act, "setStaff", { uid: boyB.uid, enabled: true });

  const result = await A(admin, act, "listStaff");
  assert.deepEqual(Object.keys(result).sort(), ["action", "candidates", "ok"]);
  assert.equal(result.action, "listStaff");
  assert.deepEqual(
    result.candidates.map((item) => item.registrationId).sort(),
    [boyA, boyB, adultLeader, adultCompanion].map((client) => `user_${client.uid}`).sort(),
    "solo iscrizioni user_ attive: niente figli, ospiti, annullate",
  );
  for (const item of result.candidates) {
    assert.deepEqual(Object.keys(item).sort(), ["isAdult", "isStaff", "name", "registrationId", "uid", "unitName"], `campi di ${item.registrationId}`);
    assert.equal(item.registrationId, `user_${item.uid}`);
  }
  // Adulti prima (dirigente e accompagnatore), poi gli altri; dentro ogni gruppo per nome.
  const adults = result.candidates.map((item) => item.isAdult);
  assert.deepEqual(adults, [...adults].sort((left, right) => Number(right) - Number(left)));
  assert.deepEqual(result.candidates.slice(0, 2).map((item) => item.isAdult), [true, true]);
  const byUid = Object.fromEntries(result.candidates.map((item) => [item.uid, item]));
  assert.equal(byUid[adultLeader.uid].isAdult, true);
  assert.equal(byUid[boyA.uid].isAdult, false);
  assert.equal(byUid[boyA.uid].unitName, "Rione Primo");
  assert.equal(byUid[boyB.uid].unitName, "Rione Secondo (copia)");
  assert.equal(byUid[adultCompanion.uid].unitName, "");
  // isStaff = presenza nell'elenco, non la categoria.
  assert.equal(byUid[boyB.uid].isStaff, true);
  for (const client of [boyA, adultLeader, adultCompanion]) assert.equal(byUid[client.uid].isStaff, false, `${client.name} non è in elenco`);
  const serialized = JSON.stringify(result);
  for (const value of ["3331112222", "segreto@example.invalid", "arachidi", "Ospite Esterno", "parentUid", "medicalNotes"]) {
    assert.ok(!serialized.includes(value), `la risposta contiene «${value}»`);
  }
  assert.deepEqual((await A(superAdmin, act, "listStaff")).candidates, result.candidates);
  await expectFail(admin.adminFn({ stakeId, activityId: act, action: "listStaff", uid: boyA.uid }), "invalid-argument");
  assert.equal(await staffUidsOf(act) !== null, true);
  assert.deepEqual(await staffUidsOf(act), [boyB.uid], "listStaff non scrive");
  assert.deepEqual((await A(admin, await newActivity(), "listStaff")).candidates, []);
});

// Trigger: l'iscrizione user_<uid> annullata o eliminata toglie l'uid da staffUids.
const STAFF_TRIGGER_VARIANTS = [
  ["registrationStatus cancelled", (path) => adminDb.doc(path).update({ registrationStatus: "cancelled" })],
  ["registrationStatus rejected_by_parent", (path) => adminDb.doc(path).update({ registrationStatus: "rejected_by_parent" })],
  ["iscrizione eliminata", (path) => adminDb.doc(path).delete()],
];

for (const [label, apply] of STAFF_TRIGGER_VARIANTS) {
  test(`trigger: ${label} toglie l'uid da staffUids e ritira i suoi tentativi; gli altri restano in elenco`, async () => {
    const { boyA, boyB, adultCompanion, admin, parent } = pool;
    const act = await newActivity({ members: [boyA, boyB] });
    await enrollAdult(act, adultCompanion, "accompagnatore");
    const childId = await enrollChild(act, parent, "kid1", "Carlo");
    const r1 = await makeRecord(act, boyA, "Record di Anna");
    await P(adultCompanion, act, "challenge", { recordId: r1.record.id });
    await A(admin, act, "setStaff", { uid: adultCompanion.uid, enabled: true });
    await A(admin, act, "setStaff", { uid: boyB.uid, enabled: true });
    assert.equal((await A(adultCompanion, act, "listParticipants")).ok, true);

    // L'iscrizione di un figlio annullata non tocca l'elenco.
    await adminDb.doc(`${activityPath(act)}/registrations/${childId}`).update({ registrationStatus: "cancelled" });
    await pause(1200);
    assert.deepEqual(await staffUidsOf(act), [adultCompanion.uid, boyB.uid].sort());

    assert.equal(await canReadAsStaff(adultCompanion, act), true);
    const path = `${activityPath(act)}/registrations/user_${adultCompanion.uid}`;
    await apply(path);
    const list = await waitFor(() => staffUidsOf(act), (uids) => Array.isArray(uids) && !uids.includes(adultCompanion.uid), "la rimozione dall'elenco staff");
    assert.deepEqual(list, [boyB.uid], "gli altri restano in elenco");
    const doc = (await staffDocRef(act).get()).data();
    assert.equal(doc.updatedBy, "system");
    await waitFor(async () => (await recordData(act, r1.record.id)).challengerCount, (count) => count === 1, "il contatore a 1");
    const own = await entriesOfRegistration(act, `user_${adultCompanion.uid}`);
    assert.ok(own.length === 1 && own[0].status === "withdrawn" && own[0].withdrawnBy === "system");
    // Non gestisce più nulla: né callable né rules.
    await expectFail(A(adultCompanion, act, "listParticipants"), "permission-denied", NOT_STAFF_MSG);
    assert.equal((await P(adultCompanion, act, "context")).isStaff, false);
    assert.equal(await canReadAsStaff(adultCompanion, act), false);
    assert.equal(await canReadAsStaff(boyB, act), true);
    // L'altro in elenco continua a gestire.
    assert.equal((await A(boyB, act, "listParticipants")).ok, true);
    // Riattivare l'iscrizione non rimette in elenco: lo decide di nuovo un admin.
    if (label !== "iscrizione eliminata") {
      await adminDb.doc(path).update({ registrationStatus: "confirmed" });
      await pause(1200);
      assert.deepEqual(await staffUidsOf(act), [boyB.uid]);
      await expectFail(A(adultCompanion, act, "listParticipants"), "permission-denied", NOT_STAFF_MSG);
      await A(admin, act, "setStaff", { uid: adultCompanion.uid, enabled: true });
      assert.equal((await A(adultCompanion, act, "listParticipants")).ok, true);
    }
    await assertConsistent(act);
  });
}

test("retireEntriesForRegistration risponde { retired, staffRemoved } e non tocca chi ha l'iscrizione attiva", async () => {
  const { boyA, boyB, adultCompanion } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  // Stato costruito a mano, con l'iscrizione già annullata fin dalla creazione (nessun evento di trigger).
  const regId = `user_${adultCompanion.uid}`;
  await adminDb.doc(`${activityPath(act)}/registrations/${regId}`).set({ userId: adultCompanion.uid, fullName: "Ex Staff", registrationStatus: "cancelled" });
  await adminDb.doc(`${activityPath(act)}/management/recordNight`).set({ staffUids: [adultCompanion.uid, boyB.uid].sort(), updatedAt: new Date().toISOString(), updatedBy: "test" });
  await adminDb.doc(`${activityPath(act)}/recordEntries/manuale`).set({
    registrationId: regId, ownerUid: adultCompanion.uid, participantName: "Ex Staff", kind: "challenge", proposedText: null, proposedMeasure: null,
    proposedDurationSeconds: null, proposedNeeds: "", recordId: r1.record.id, status: "approved", statusBeforeWithdraw: null, rejectionReason: "",
    createdByAdmin: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), decidedAt: null, decidedBy: null,
  });
  await recordsRef(act).doc(r1.record.id).update({ challengerCount: 2 });
  assert.deepEqual(await night.retireEntriesForRegistration(adminDb, { stakeId, activityId: act, registrationId: regId }), { retired: 1, staffRemoved: true });
  assert.deepEqual(await staffUidsOf(act), [boyB.uid]);
  assert.equal((await entryData(act, "manuale")).status, "withdrawn");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
  // Idempotente.
  assert.deepEqual(await night.retireEntriesForRegistration(adminDb, { stakeId, activityId: act, registrationId: regId }), { retired: 0, staffRemoved: false });
  // Iscrizione attiva: niente.
  assert.deepEqual(await night.retireEntriesForRegistration(adminDb, { stakeId, activityId: act, registrationId: `user_${boyB.uid}` }), { retired: 0, staffRemoved: false });
  assert.deepEqual(await staffUidsOf(act), [boyB.uid]);
});

test("admin di un palo non agisce su un'attività di un altro palo", async () => {
  const { boyA, otherAdmin } = pool;
  const act = await newActivity({ members: [boyA] });
  const pending = await P(boyA, act, "propose", proposal("Idea di Anna"));
  // otherAdmin ha stakeId "other-stake": la callable lo confronta con lo stakeId richiesto.
  await expectFail(A(otherAdmin, act, "reject", { entryId: pending.entry.id, reason: "No." }), "permission-denied");
  assert.equal((await entryData(act, pending.entry.id)).status, "pending");
});

// ---------------------------------------------------------------------------
// Iscrivere qualcuno (addParticipant)
// ---------------------------------------------------------------------------

test("addParticipant su un child_ crea un tentativo con ownerUid = genitore", async () => {
  const { boyA, boyB, parent, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const childId = `child_${parent.uid}_kid1`;
  await adminDb.doc(`${activityPath(act)}/registrations/${childId}`).set({
    parentUid: parent.uid,
    firstName: "Elia",
    lastName: "Quinto",
    registrationStatus: "confirmed",
  });
  const r1 = await makeRecord(act, boyA, "Record di Anna");

  const added = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: childId });
  assert.equal(added.ok, true);
  assert.equal(added.action, "addParticipant");
  assert.equal(added.entry.ownerUid, parent.uid, "il titolare del tentativo di un figlio è il genitore");
  assert.equal(added.entry.registrationId, childId);
  assert.equal(added.entry.status, "approved");
  assert.equal(added.entry.kind, "challenge");
  assert.equal(added.entry.createdByAdmin, true);
  assert.equal(added.entry.decidedBy, admin.uid);
  assert.equal(added.entry.recordId, r1.record.id);
  assert.equal(added.entry.participantName, "Elia Quinto");
  assert.equal(added.record.challengerCount, 2);
  const stored = await entryData(act, added.entry.id);
  assert.equal(stored.ownerUid, parent.uid);
  assert.equal(stored.createdByAdmin, true);

  // Il genitore vede il tentativo del figlio con la sua query (where ownerUid == uid); l'admin li vede tutti.
  const entriesPath = `${activityPath(act)}/recordEntries`;
  const parentView = await getDocsFromServer(query(collection(parent.firestore, entriesPath), where("ownerUid", "==", parent.uid)));
  assert.deepEqual(parentView.docs.map((item) => item.id), [added.entry.id]);
  const adminView = await getDocsFromServer(collection(admin.firestore, entriesPath));
  assert.ok(adminView.docs.some((doc) => doc.id === added.entry.id));
  // Un altro genitore non lo vede.
  const parent2View = await getDocsFromServer(query(collection(pool.parent2.firestore, entriesPath), where("ownerUid", "==", pool.parent2.uid)));
  assert.equal(parent2View.size, 0);

  // Stessa persona due volte: errore. Persona con account: ownerUid valorizzato.
  await expectFail(A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: childId }), "failed-precondition", ADMIN_ALREADY_MSG);
  const user = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: `user_${boyB.uid}` });
  assert.equal(user.entry.ownerUid, boyB.uid);
  assert.equal(user.entry.createdByAdmin, true);
  assert.equal(user.record.challengerCount, 3);
  const boyBView = await getDocsFromServer(query(collection(boyB.firestore, entriesPath), where("ownerUid", "==", boyB.uid)));
  assert.equal(boyBView.size, 1);

  // Il ragazzo iscritto dall'admin può ritirarsi, e può farsi ripristinare (ritiro suo = annullabile).
  const own = await P(boyB, act, "withdraw", { entryId: user.entry.id });
  assert.equal(own.entry.statusBeforeWithdraw, "approved");
  assert.equal(own.record.challengerCount, 2);
  await P(boyB, act, "restore", { entryId: user.entry.id });

  // Il genitore può ritirare il tentativo del figlio (ritiro suo = annullabile) e ripristinarlo.
  const byParent = await P(parent, act, "withdraw", { entryId: added.entry.id });
  assert.equal(byParent.entry.status, "withdrawn");
  assert.equal(byParent.entry.statusBeforeWithdraw, "approved");
  assert.equal(byParent.entry.withdrawnBy, "self");
  assert.equal((await P(parent, act, "restore", { entryId: added.entry.id })).entry.status, "approved");

  // Il ritiro dello staff sul figlio: niente "Annulla".
  const removed = await A(admin, act, "withdrawEntry", { entryId: added.entry.id });
  assert.equal(removed.entry.status, "withdrawn");
  assert.equal(removed.entry.statusBeforeWithdraw, null);
  assert.equal(removed.entry.withdrawnBy, "staff");
  assert.equal(removed.record.challengerCount, 2);
  await expectFail(P(parent, act, "restore", { entryId: added.entry.id }), "failed-precondition", /niente da ripristinare/u);
  await assertConsistent(act);
});

test("addParticipant su un child_: il titolare è parentUid se c'è, altrimenti il genitore dall'id", async () => {
  const { boyA, parent, parent2, admin } = pool;
  const act = await newActivity({ members: [boyA] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  // Senza parentUid sull'iscrizione: il genitore si ricava dall'id child_<parentUid>_<childId>.
  const noField = `child_${parent.uid}_senzacampo`;
  await adminDb.doc(`${activityPath(act)}/registrations/${noField}`).set({ fullName: "Senza Campo", registrationStatus: "confirmed" });
  const first = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: noField });
  assert.equal(first.entry.ownerUid, parent.uid);
  // Con parentUid sull'iscrizione vince il campo.
  const withField = `child_${parent.uid}_concampo`;
  await adminDb.doc(`${activityPath(act)}/registrations/${withField}`).set({ parentUid: parent2.uid, fullName: "Con Campo", registrationStatus: "confirmed" });
  const second = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: withField });
  assert.equal(second.entry.ownerUid, parent2.uid);
  await assertConsistent(act);
});

test("addParticipant: registrazioni non ammesse e record non disponibili", async () => {
  const { boyA, boyB, parent, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  await adminDb.doc(`${activityPath(act)}/registrations/guest_ospite`).set({ anonymousUid: "ospite", registrationStatus: "submitted" });
  await adminDb.doc(`${activityPath(act)}/registrations/child_${parent.uid}_annullato`).set({ parentUid: parent.uid, fullName: "Figlio Annullato", registrationStatus: "cancelled" });
  await expectFail(A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: "guest_ospite" }), "invalid-argument");
  await expectFail(A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: "adulto_xyz" }), "invalid-argument");
  await expectFail(A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: "child_non_esiste" }), "not-found");
  await expectFail(A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: `child_${parent.uid}_annullato` }), "failed-precondition");
  await expectFail(A(admin, act, "addParticipant", { recordId: "non-esiste", registrationId: `user_${boyB.uid}` }), "not-found");
  const hidden = await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record di Anna"), status: "hidden" });
  assert.equal(hidden.withdrawnCount, 1);
  await expectFail(A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: `user_${boyB.uid}` }), "failed-precondition");
  // Nascondere ritira chi c'era (Anna) e porta il contatore a 0; nessun tentativo nuovo.
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 0);
  assert.equal((await entriesRef(act).get()).size, 1);
  assert.equal((await entryData(act, r1.entry.id)).status, "withdrawn");
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Validazione dell'input
// ---------------------------------------------------------------------------

test("input non valido: invalid-argument e nessun dato parziale", async () => {
  const { boyA, boyB, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const longText = "a".repeat(121);
  const bad = [
    ["testo vuoto", proposal("")],
    ["testo di soli spazi", proposal("   ")],
    ["testo oltre 120 caratteri", proposal(longText)],
    ["misura sconosciuta", proposal("Idea", { measure: "inventata" })],
    ["count_in_time senza durata", proposal("Idea", { durationSeconds: null })],
    ["durata sotto 10", proposal("Idea", { durationSeconds: 9 })],
    ["durata sopra 60", proposal("Idea", { durationSeconds: 61 })],
    ["durata non intera", proposal("Idea", { durationSeconds: 30.5 })],
    ["durata su una misura senza tempo", proposal("Idea", { measure: "distance", durationSeconds: 30 })],
    ["serve oltre 120 caratteri", proposal("Idea", { needs: longText })],
    ["campo non ammesso", proposal("Idea", { status: "approved" })],
    ["carattere di controllo", proposal("Idea\u0007")],
  ];
  for (const [label, payload] of bad) {
    await expectFail(P(boyA, act, "propose", payload), "invalid-argument", undefined).catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    });
  }
  await expectFail(P(boyA, act, "azione-sconosciuta", {}), "invalid-argument");
  await expectFail(P(boyA, act, "challenge", {}), "invalid-argument");
  await expectFail(P(boyA, act, "challenge", { recordId: "../altro" }), "invalid-argument");
  await expectFail(P(boyA, act, "withdraw", {}), "invalid-argument");
  await expectFail(boyA.participantFn({ activityId: act, action: "propose", ...proposal("Idea") }), "invalid-argument");
  await expectFail(P(boyA, "../altra", "propose", proposal("Idea")), "invalid-argument");
  assert.equal((await entriesRef(act).get()).size, 0, "nessuna proposta non valida lascia dati sul server");

  // Valori ai limiti: accettati.
  const edgeText = await P(boyA, act, "propose", proposal("b".repeat(120), { durationSeconds: 10 }));
  assert.equal(edgeText.entry.proposedDurationSeconds, 10);
  const edge60 = await P(boyB, act, "propose", proposal("Idea al limite", { durationSeconds: 60 }));
  assert.equal(edge60.entry.proposedDurationSeconds, 60);

  // Admin.
  const adminBad = [
    ["titolo di 81 caratteri", { ...recordInput("t".repeat(81)) }],
    ["titolo vuoto", { ...recordInput("") }],
    ["categoria sconosciuta", { ...recordInput("Titolo", { category: "inventata" }) }],
    ["note oltre 200 caratteri", { ...recordInput("Titolo", { notes: "n".repeat(201) }) }],
    ["durata fuori range", { ...recordInput("Titolo", { durationSeconds: 90 }) }],
  ];
  for (const [label, payload] of adminBad) {
    await expectFail(A(admin, act, "approve", { entryId: edgeText.entry.id, ...payload }), "invalid-argument").catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    });
  }
  await expectFail(A(admin, act, "reject", { entryId: edgeText.entry.id, reason: "r".repeat(201) }), "invalid-argument");
  assert.equal((await recordsRef(act).get()).size, 0);
  assert.equal((await entryData(act, edgeText.entry.id)).status, "pending");
  const okTitle = await A(admin, act, "approve", { entryId: edgeText.entry.id, ...recordInput("t".repeat(80), { notes: "n".repeat(200) }) });
  assert.equal(okTitle.record.title.length, 80);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Concorrenza (la spec: una sola transazione per azione)
// ---------------------------------------------------------------------------

test("doppio tocco e gare: nessuna sfida doppia, limite rispettato, nessun aggiornamento perso", async () => {
  const { boyA, boyB, boyC, boyD, boyE, boyF, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyD, boyE, boyF] });
  const r1 = await makeRecord(act, boyA, "Record conteso");

  // Stessa persona, stessa sfida, due chiamate insieme.
  const doubleTap = await Promise.allSettled([
    P(boyB, act, "challenge", { recordId: r1.record.id }),
    P(boyB, act, "challenge", { recordId: r1.record.id }),
  ]);
  assert.equal(doubleTap.filter((r) => r.status === "fulfilled").length, 1, `doppio tocco: ${JSON.stringify(doubleTap.map((r) => r.status === "fulfilled" ? "ok" : r.reason?.code))}`);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);

  // Stessa persona con il limite da rispettare e tre proposte diverse insieme: ne passano al massimo 2.
  const raceLimit = await Promise.allSettled([
    P(boyC, act, "propose", proposal("Prima corsa")),
    P(boyC, act, "propose", proposal("Seconda corsa")),
    P(boyC, act, "propose", proposal("Terza corsa")),
  ]);
  const accepted = raceLimit.filter((r) => r.status === "fulfilled").length;
  assert.ok(accepted <= 2, `limite superato: ${accepted} proposte accettate (${JSON.stringify(raceLimit.map((r) => r.status === "fulfilled" ? "ok" : r.reason?.code))})`);
  assert.equal((await entriesOfRegistration(act, `user_${boyC.uid}`)).length, accepted);

  // Persone diverse sullo stesso record insieme: nessun incremento perso.
  const before = (await recordData(act, r1.record.id)).challengerCount;
  const crowd = await Promise.allSettled([
    P(boyD, act, "challenge", { recordId: r1.record.id }),
    P(boyE, act, "challenge", { recordId: r1.record.id }),
    P(boyF, act, "challenge", { recordId: r1.record.id }),
  ]);
  const crowdOk = crowd.filter((r) => r.status === "fulfilled").length;
  assert.equal(crowdOk, 3, `sfide concorrenti di persone diverse: ${JSON.stringify(crowd.map((r) => r.status === "fulfilled" ? "ok" : `${r.reason?.code}: ${r.reason?.message}`))}`);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, before + crowdOk);

  // Ritiro del ragazzo e ritiro d'ufficio dell'admin sullo stesso tentativo insieme.
  const target = (await entriesOfRegistration(act, `user_${boyB.uid}`)).find((e) => e.status === "approved");
  await Promise.allSettled([
    P(boyB, act, "withdraw", { entryId: target.id }),
    A(admin, act, "withdrawEntry", { entryId: target.id }),
  ]);
  assert.equal((await entryData(act, target.id)).status, "withdrawn");
  await assertConsistent(act);
});

// L'emulatore Functions serve le chiamate quasi in serie, quindi la gara qui
// sopra non prova l'isolamento. Questa chiama gli stessi handler esportati in
// parallelo, in-process, contro il Firestore dell'emulatore: è lì che le
// transazioni decidono se il limite e il contatore reggono.
test("gare sulle transazioni: limite, doppio tocco e contatore senza aggiornamenti persi", async (t) => {
  const participantHandler = night.createRecordNightParticipantHandler();
  const callAs = (uid, activityId, action, payload = {}) =>
    participantHandler({ auth: { uid, token: { firebase: { sign_in_provider: "password" } } }, data: { stakeId, activityId, action, ...payload } });
  const act = await newActivity({ members: [pool.boyA] });
  const crowd = Array.from({ length: 7 }, (_, index) => `race-${runId}-${index}`);
  await Promise.all(
    crowd.map((uid) =>
      adminDb.doc(`${activityPath(act)}/registrations/user_${uid}`).set({
        userId: uid,
        fullName: `Gara ${uid.slice(-1)}`,
        registrationStatus: "confirmed",
      }),
    ),
  );
  const outcome = (settled) => settled.map((r) => (r.status === "fulfilled" ? "ok" : r.reason?.code ?? "errore"));

  // A. Una persona, molte proposte insieme: il limite di 2 regge.
  const [racer, doubleTapper, ...others] = crowd;
  const burst = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => callAs(racer, act, "propose", proposal(`Corsa numero ${index}`))));
  const accepted = burst.filter((r) => r.status === "fulfilled").length;
  t.diagnostic(`A. proposte simultanee: ${JSON.stringify(outcome(burst))}`);
  assert.ok(accepted >= 1 && accepted <= 2, `limite di 2 violato: ${accepted} proposte accettate`);
  assert.equal((await entriesOfRegistration(act, `user_${racer}`)).length, accepted);

  // B. Persone diverse sfidano insieme lo stesso record: nessun incremento perso.
  const r1 = await makeRecord(act, pool.boyA, "Record conteso in-process");
  const crowdRun = await Promise.allSettled(others.map((uid) => callAs(uid, act, "challenge", { recordId: r1.record.id })));
  const crowdOk = crowdRun.filter((r) => r.status === "fulfilled").length;
  t.diagnostic(`B. sfide simultanee di ${others.length} persone: ${JSON.stringify(outcome(crowdRun))}`);
  assert.ok(crowdOk >= 1);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1 + crowdOk, "il contatore ha perso aggiornamenti");

  // C. Doppio tocco: la stessa persona sfida insieme più volte lo stesso record, una sola passa.
  const taps = await Promise.allSettled(Array.from({ length: 5 }, () => callAs(doubleTapper, act, "challenge", { recordId: r1.record.id })));
  const tapsOk = taps.filter((r) => r.status === "fulfilled").length;
  t.diagnostic(`C. doppio tocco x5: ${JSON.stringify(outcome(taps))}`);
  assert.ok(tapsOk <= 1, `la stessa sfida è passata ${tapsOk} volte`);
  assert.equal((await entriesOfRegistration(act, `user_${doubleTapper}`)).length, tapsOk);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1 + crowdOk + tapsOk);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Trigger: iscrizione annullata o cancellata
// ---------------------------------------------------------------------------

async function seedTriggerScenario() {
  const { boyA, boyB } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const r1 = await makeRecord(act, boyB, "Record di Bruno");
  const challenge = await P(boyA, act, "challenge", { recordId: r1.record.id }); // approved
  const pending = await P(boyA, act, "propose", proposal("Proposta in attesa di Anna"));
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  return { act, r1, challenge, pending };
}

const TRIGGER_VARIANTS = [
  ["registrationStatus cancelled", (act, client) => adminDb.doc(`${activityPath(act)}/registrations/user_${client.uid}`).update({ registrationStatus: "cancelled" })],
  ["registrationStatus rejected_by_parent", (act, client) => adminDb.doc(`${activityPath(act)}/registrations/user_${client.uid}`).update({ registrationStatus: "rejected_by_parent" })],
  ["iscrizione cancellata (delete)", (act, client) => adminDb.doc(`${activityPath(act)}/registrations/user_${client.uid}`).delete()],
];

for (const [label, apply] of TRIGGER_VARIANTS) {
  test(`trigger: ${label} ritira i tentativi e abbassa i contatori`, async () => {
    const { boyA } = pool;
    const { act, r1, challenge, pending } = await seedTriggerScenario();
    // Un tentativo già rifiutato non va toccato.
    const withdrawnEarly = await P(boyA, act, "withdraw", { entryId: pending.entry.id });
    assert.equal(withdrawnEarly.entry.status, "withdrawn");
    const rejectedOne = await P(boyA, act, "propose", proposal("Proposta che verrà rifiutata"));
    await A(pool.admin, act, "reject", { entryId: rejectedOne.entry.id, reason: "No." });
    const stillPending = await P(boyA, act, "propose", proposal("Proposta ancora in attesa"));

    // Un aggiornamento che non annulla l'iscrizione non tocca nulla.
    if (label !== "iscrizione cancellata (delete)") {
      await adminDb.doc(`${activityPath(act)}/registrations/user_${boyA.uid}`).update({ note: "campo qualunque" });
      await pause(1200);
      assert.equal((await entryData(act, challenge.entry.id)).status, "approved");
      assert.equal((await entryData(act, stillPending.entry.id)).status, "pending");
    }

    await apply(act, boyA);
    await waitFor(
      () => entriesOfRegistration(act, `user_${boyA.uid}`),
      (list) => list.every((entry) => entry.status === "withdrawn" || entry.status === "rejected"),
      "il ritiro d'ufficio dei tentativi",
    );
    const after = Object.fromEntries((await entriesOfRegistration(act, `user_${boyA.uid}`)).map((entry) => [entry.id, entry]));
    assert.equal(after[challenge.entry.id].status, "withdrawn");
    assert.equal(after[challenge.entry.id].statusBeforeWithdraw, null, "il ritiro d'ufficio non si annulla");
    assert.equal(after[challenge.entry.id].withdrawnBy, "system");
    assert.equal(after[stillPending.entry.id].withdrawnBy, "system");
    assert.equal(after[pending.entry.id].withdrawnBy, "self", "un ritiro precedente del ragazzo resta suo");
    assert.equal(after[rejectedOne.entry.id].withdrawnBy ?? null, null);
    assert.equal(after[stillPending.entry.id].status, "withdrawn");
    assert.equal(after[stillPending.entry.id].statusBeforeWithdraw, null);
    assert.equal(after[rejectedOne.entry.id].status, "rejected", "un tentativo rifiutato resta rifiutato");
    assert.equal(after[rejectedOne.entry.id].rejectionReason, "No.");
    await waitFor(async () => (await recordData(act, r1.record.id)).challengerCount, (count) => count === 1, "il contatore del record a 1");
    assert.equal((await entryData(act, r1.entry.id)).status, "approved", "i tentativi degli altri non si toccano");

    // Idempotenza: un'altra scrittura sull'iscrizione già annullata non scala di nuovo il contatore.
    if (label !== "iscrizione cancellata (delete)") {
      await adminDb.doc(`${activityPath(act)}/registrations/user_${boyA.uid}`).update({ note: "ancora" });
      await pause(1200);
      assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
    }
    // Il ragazzo non può più ripristinare nulla (non è più iscritto).
    await expectFail(P(boyA, act, "restore", { entryId: challenge.entry.id }), "permission-denied");
    await assertConsistent(act);
  });
}

test("trigger: riattivare un'iscrizione annullata non resuscita i tentativi", async () => {
  const { boyA } = pool;
  const { act, r1, challenge } = await seedTriggerScenario();
  const registration = adminDb.doc(`${activityPath(act)}/registrations/user_${boyA.uid}`);
  await registration.update({ registrationStatus: "cancelled" });
  await waitFor(async () => (await entryData(act, challenge.entry.id)).status, (status) => status === "withdrawn", "il ritiro d'ufficio");
  await registration.update({ registrationStatus: "confirmed" });
  await pause(1200);
  assert.equal((await entryData(act, challenge.entry.id)).status, "withdrawn");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
  await expectFail(P(boyA, act, "restore", { entryId: challenge.entry.id }), "failed-precondition", /niente da ripristinare/u);
  // Ora che è di nuovo iscritto può sfidare di nuovo (nuovo tentativo).
  const again = await P(boyA, act, "challenge", { recordId: r1.record.id });
  assert.equal(again.record.challengerCount, 2);
  await assertConsistent(act);
});

test("trigger: iscrizione di un child_ annullata ritira il tentativo inserito dall'admin", async () => {
  const { boyA, parent, admin } = pool;
  const act = await newActivity({ members: [boyA] });
  const childId = `child_${parent.uid}_kid9`;
  const childRef = adminDb.doc(`${activityPath(act)}/registrations/${childId}`);
  await childRef.set({ parentUid: parent.uid, fullName: "Figlio Nove", registrationStatus: "confirmed" });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  const added = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: childId });
  assert.equal(added.record.challengerCount, 2);
  await childRef.update({ registrationStatus: "cancelled" });
  await waitFor(async () => (await entryData(act, added.entry.id)).status, (status) => status === "withdrawn", "il ritiro del figlio");
  assert.equal((await entryData(act, added.entry.id)).statusBeforeWithdraw, null);
  assert.equal((await entryData(act, added.entry.id)).withdrawnBy, "system");
  // Il genitore (titolare del tentativo) non può più ripristinarlo: l'iscrizione del figlio non è attiva.
  await expectFail(P(parent, act, "restore", { entryId: added.entry.id }), "permission-denied", NOT_ENROLLED_MSG);
  await waitFor(async () => (await recordData(act, r1.record.id)).challengerCount, (count) => count === 1, "il contatore a 1");
  await assertConsistent(act);
});

test("trigger: cancellare l'attività elimina record, tentativi (nomi dei ragazzi compresi) ed elenco staff", async () => {
  const { boyA, boyB, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  await P(boyB, act, "challenge", { recordId: r1.record.id });
  await A(admin, act, "setStaff", { uid: boyB.uid, enabled: true });
  assert.equal((await entriesRef(act).get()).size, 2);
  assert.deepEqual(await staffUidsOf(act), [boyB.uid]);
  await adminDb.doc(activityPath(act)).delete();
  await waitFor(
    async () => [(await entriesRef(act).get()).size, (await recordsRef(act).get()).size, (await staffDocRef(act).get()).exists],
    ([entryCount, recordCount, staffExists]) => entryCount === 0 && recordCount === 0 && staffExists === false,
    "la pulizia di record, tentativi ed elenco staff",
  );
});

// ---------------------------------------------------------------------------
// Tabelle stato x azione (spec, "Stati e ritorni" e "Chi può fare cosa")
// ---------------------------------------------------------------------------
// Esiti attesi: "<stato>" = riesce e il tentativo passa a quello stato;
// "=" = riesce senza cambiare nulla (ripetuto: no-op accettato); "x" = rifiutato
// con failed-precondition e il tentativo resta identico. In ogni caso i
// contatori restano coerenti con i tentativi approved.

const ENTRY_STATES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn-from-pending",
  "withdrawn-from-approved",
  "challenge",
];

async function entryInState(state) {
  const { boyA, boyB, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const target = await makeRecord(act, boyB, "Record bersaglio");
  if (state === "challenge") {
    const challenge = await P(boyA, act, "challenge", { recordId: target.record.id });
    return { act, target, entryId: challenge.entry.id };
  }
  const proposed = await P(boyA, act, "propose", proposal(`Idea di prova (${state})`));
  const entryId = proposed.entry.id;
  if (state === "approved" || state === "withdrawn-from-approved") {
    await A(admin, act, "approve", { entryId, ...recordInput("Titolo ufficiale") });
  }
  if (state === "rejected") await A(admin, act, "reject", { entryId, reason: "Non adatta." });
  if (state.startsWith("withdrawn")) await P(boyA, act, "withdraw", { entryId });
  return { act, target, entryId };
}

const ADMIN_MATRIX = {
  pending: { approve: "approved", merge: "approved", reject: "rejected", reopen: "=", withdrawEntry: "withdrawn" },
  approved: { approve: "x", merge: "x", reject: "x", reopen: "pending", withdrawEntry: "withdrawn" },
  rejected: { approve: "x", merge: "x", reject: "x", reopen: "pending", withdrawEntry: "x" },
  "withdrawn-from-pending": { approve: "x", merge: "x", reject: "x", reopen: "x", withdrawEntry: "=" },
  "withdrawn-from-approved": { approve: "x", merge: "x", reject: "x", reopen: "x", withdrawEntry: "=" },
  // Scostamento accettato: una sfida non si riporta in attesa.
  challenge: { approve: "x", merge: "x", reject: "x", reopen: "x", withdrawEntry: "withdrawn" },
};

const PARTICIPANT_MATRIX = {
  pending: { edit: "pending", withdraw: "withdrawn", restore: "=" },
  approved: { edit: "x", withdraw: "withdrawn", restore: "=" },
  rejected: { edit: "x", withdraw: "x", restore: "x" },
  "withdrawn-from-pending": { edit: "x", withdraw: "=", restore: "pending" },
  "withdrawn-from-approved": { edit: "x", withdraw: "=", restore: "approved" },
  challenge: { edit: "x", withdraw: "withdrawn", restore: "=" },
};

async function checkMatrixCell({ kind, state, action, expected }) {
  const { act, target, entryId } = await entryInState(state);
  const before = await entryData(act, entryId);
  const payloads = {
    approve: { entryId, ...recordInput("Titolo nuovo") },
    merge: { entryId, recordId: target.record.id },
    reject: { entryId, reason: "Motivo di prova." },
    reopen: { entryId },
    withdrawEntry: { entryId },
    edit: { entryId, ...proposal("Testo modificato") },
    withdraw: { entryId },
    restore: { entryId },
  };
  const call = kind === "admin"
    ? () => A(pool.admin, act, action, payloads[action])
    : () => P(pool.boyA, act, action, payloads[action]);
  const label = `${kind} ${action} su tentativo ${state}`;
  if (expected === "x") {
    await expectFail(call(), "failed-precondition").catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    });
    assert.deepEqual(await entryData(act, entryId), before, `${label}: il tentativo rifiutato è cambiato`);
  } else {
    const result = await call();
    assert.equal(result.ok, true, label);
    const after = await entryData(act, entryId);
    if (expected === "=") assert.deepEqual(after, before, `${label}: doveva essere un no-op`);
    else assert.equal(after.status, expected, `${label}: stato atteso ${expected}, trovato ${after.status}`);
  }
  await assertConsistent(act);
}

test("admin: ogni azione su ogni stato del tentativo fa ciò che dice la tabella della spec", async () => {
  const failures = [];
  for (const state of ENTRY_STATES) {
    for (const [action, expected] of Object.entries(ADMIN_MATRIX[state])) {
      try {
        await checkMatrixCell({ kind: "admin", state, action, expected });
      } catch (error) {
        failures.push(`${state} / ${action} (atteso ${expected}): ${error.message}`.split("\n")[0]);
      }
    }
  }
  assert.deepEqual(failures, [], `Celle della tabella non rispettate:\n${failures.join("\n")}`);
});

test("ragazzo: ogni azione su ogni stato del proprio tentativo fa ciò che dice la tabella della spec", async () => {
  const failures = [];
  for (const state of ENTRY_STATES) {
    for (const [action, expected] of Object.entries(PARTICIPANT_MATRIX[state])) {
      try {
        await checkMatrixCell({ kind: "participant", state, action, expected });
      } catch (error) {
        failures.push(`${state} / ${action} (atteso ${expected}): ${error.message}`.split("\n")[0]);
      }
    }
  }
  assert.deepEqual(failures, [], `Celle della tabella non rispettate:\n${failures.join("\n")}`);
});

// ---------------------------------------------------------------------------
// Sequenze casuali: le invarianti della spec reggono qualunque ordine di azioni
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Invarianti scritte nella spec, oltre a contatore/limite/unicità di assertConsistent.
async function assertSpecInvariants(activityId, originalText) {
  const snap = await entriesRef(activityId).get();
  for (const doc of snap.docs) {
    const entry = { id: doc.id, ...doc.data() };
    if (entry.kind === "proposal") {
      assert.equal(typeof entry.proposedText, "string", `proposta ${entry.id} senza testo`);
      if (!originalText.has(entry.id)) originalText.set(entry.id, entry.proposedText);
      assert.equal(entry.proposedText, originalText.get(entry.id), `il testo di ${entry.id} è cambiato senza un edit`);
      if (entry.status === "pending" || entry.status === "rejected") {
        assert.equal(entry.recordId, null, `proposta ${entry.id} ${entry.status} con recordId`);
      }
    } else {
      assert.equal(entry.kind, "challenge");
      assert.equal(entry.proposedText, null, `sfida ${entry.id} con proposedText`);
      assert.ok(["approved", "withdrawn"].includes(entry.status), `sfida ${entry.id} in stato ${entry.status}`);
    }
    if (entry.status === "approved") assert.equal(typeof entry.recordId, "string", `${entry.id} approved senza recordId`);
    if (entry.status === "rejected") assert.ok(entry.rejectionReason, `${entry.id} rifiutato senza motivo`);
    if (entry.registrationId.startsWith("user_")) {
      assert.equal(entry.ownerUid, entry.registrationId.slice("user_".length), `ownerUid di ${entry.id} non coincide con l'iscrizione`);
    }
    // Spec: per un figlio il titolare è il genitore (child_<parentUid>_<childId>), mai null.
    const child = /^child_([^_]+)_.+$/u.exec(entry.registrationId);
    if (child) assert.equal(entry.ownerUid, child[1], `ownerUid di ${entry.id} (figlio) non è il genitore`);
    // Spec: withdrawnBy dice chi ha ritirato; solo i tentativi ritirati lo portano.
    if (entry.status === "withdrawn") {
      assert.ok(["self", "staff", "system"].includes(entry.withdrawnBy), `${entry.id} ritirato con withdrawnBy ${entry.withdrawnBy}`);
      if (entry.withdrawnBy !== "self") assert.equal(entry.statusBeforeWithdraw, null, `${entry.id}: ritiro ${entry.withdrawnBy} con Annulla`);
      if (entry.withdrawnWithRecordHide === true) assert.equal(entry.withdrawnBy, "staff", `${entry.id}: ritiro per record nascosto non dello staff`);
    } else {
      assert.equal(entry.withdrawnBy ?? null, null, `${entry.id} (${entry.status}) con withdrawnBy ${entry.withdrawnBy}`);
      assert.ok(!entry.withdrawnWithRecordHide, `${entry.id} (${entry.status}) con withdrawnWithRecordHide`);
    }
  }
}

const FUZZ_SEEDS = (process.env.RECORD_NIGHT_FUZZ_SEEDS || "7,2026,1016").split(",").map(Number);
const FUZZ_STEPS = Number(process.env.RECORD_NIGHT_FUZZ_STEPS || 90);
const fuzzCoverage = {};

for (const seed of FUZZ_SEEDS) {
  test(`sequenze casuali (seed ${seed}): contatori, limite, unicità e testi originali restano coerenti`, async (t) => {
    const rand = mulberry32(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const boys = [pool.boyA, pool.boyB, pool.boyC, pool.boyD];
    const act = await newActivity({ members: boys });
    // Un genitore con due figli agisce per loro; lo staff alterna admin e unit_leader.
    const kids = [await enrollChild(act, pool.parent, "kid1", "Carlo"), await enrollChild(act, pool.parent, "kid2", "Dario")];
    const actors = [...boys, pool.parent];
    const registrationIds = [...boys.map((client) => `user_${client.uid}`), ...kids];
    const texts = ["Salti con la corda", "Torre di bicchieri", "Equilibrio su un piede", "Flessioni di fila", "Palleggi con un pallone"];
    const measures = [["count_in_time", 30], ["count_streak", null], ["longest_time", null], ["other", null]];
    const originalText = new Map();
    await makeRecord(act, boys[0], "Record uno");
    await makeRecord(act, boys[1], "Record due");
    await assertConsistent(act);
    await assertSpecInvariants(act, originalText);

    const log = [];
    const tally = {};
    for (let step = 0; step < FUZZ_STEPS; step++) {
      // Gli id Firestore sono casuali: si ordina per contenuto così la sequenza è riproducibile.
      const sortKey = (item) => [item.createdAt, item.title ?? item.proposedText ?? "", item.ownerUid ?? "", item.recordId ?? "", item.status].join("|");
      const byAge = (left, right) => sortKey(left).localeCompare(sortKey(right));
      const [entriesNow, recordsNow] = await Promise.all([
        entriesRef(act).get().then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byAge)),
        recordsRef(act).get().then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byAge)),
      ]);
      const boy = pick(actors);
      const forWhom = boy === pool.parent ? { registrationId: pick(kids) } : {};
      const staff = pick([pool.admin, pool.leader]);
      const own = entriesNow.filter((entry) => entry.ownerUid === boy.uid);
      const [measure, durationSeconds] = pick(measures);
      const candidates = [
        ["propose", () => P(boy, act, "propose", { text: pick(texts), measure, durationSeconds, needs: "", ...forWhom })],
        ["propose", () => P(boy, act, "propose", { text: pick(texts), measure, durationSeconds, needs: "", ...forWhom })],
      ];
      if (recordsNow.length) {
        const record = pick(recordsNow);
        candidates.push(
          ["challenge", () => P(boy, act, "challenge", { recordId: record.id, ...forWhom })],
          ["challenge", () => P(boy, act, "challenge", { recordId: record.id, ...forWhom })],
          ["updateRecord", () => A(staff, act, "updateRecord", {
            recordId: record.id, title: record.title, category: record.category, measure: record.measure,
            durationSeconds: record.durationSeconds, status: rand() < 0.3 ? "hidden" : "open",
          })],
          ["addParticipant", () => A(staff, act, "addParticipant", { recordId: record.id, registrationId: pick(registrationIds) })],
        );
      }
      candidates.push(["createRecord", () => A(staff, act, "createRecord", recordInput(`Creato al passo ${step}`))]);
      if (own.length) {
        const entry = pick(own);
        const editText = pick(texts);
        candidates.push(
          ["edit", () => P(boy, act, "edit", { entryId: entry.id, text: editText, measure, durationSeconds, needs: "" }).then((result) => {
            originalText.set(entry.id, editText);
            return result;
          })],
          ["withdraw", () => P(boy, act, "withdraw", { entryId: entry.id })],
          ["withdraw", () => P(boy, act, "withdraw", { entryId: entry.id })],
          ["restore", () => P(boy, act, "restore", { entryId: entry.id })],
          ["restore", () => P(boy, act, "restore", { entryId: entry.id })],
        );
      }
      const ownPending = own.filter((entry) => entry.status === "pending" && entry.kind === "proposal");
      if (ownPending.length) {
        const entry = pick(ownPending);
        const freshText = `Testo nuovo al passo ${step}`;
        candidates.push(["edit", () => P(boy, act, "edit", { entryId: entry.id, text: freshText, measure, durationSeconds, needs: "" }).then((result) => {
          originalText.set(entry.id, freshText);
          return result;
        })]);
      }
      const pendingNow = entriesNow.filter((entry) => entry.status === "pending");
      if (pendingNow.length) {
        const target = pick(pendingNow);
        candidates.push(
          ["approve", () => A(staff, act, "approve", { entryId: target.id, ...recordInput(`Titolo mirato ${step}`) })],
          ["reject", () => A(staff, act, "reject", { entryId: target.id, reason: "Motivo mirato." })],
        );
        if (recordsNow.length) {
          const record = pick(recordsNow);
          candidates.push(["merge", () => A(staff, act, "merge", { entryId: target.id, recordId: record.id })]);
        }
      }
      if (entriesNow.length) {
        const entry = pick(entriesNow);
        candidates.push(
          ["approve", () => A(staff, act, "approve", { entryId: entry.id, ...recordInput(`Titolo ${step}`) })],
          ["reject", () => A(staff, act, "reject", { entryId: entry.id, reason: "Motivo casuale." })],
          ["reopen", () => A(staff, act, "reopen", { entryId: entry.id })],
          ["reopen", () => A(staff, act, "reopen", { entryId: entry.id })],
          ["withdrawEntry", () => A(staff, act, "withdrawEntry", { entryId: entry.id })],
        );
        if (recordsNow.length) {
          const record = pick(recordsNow);
          candidates.push(["merge", () => A(staff, act, "merge", { entryId: entry.id, recordId: record.id })]);
          candidates.push(["merge", () => A(staff, act, "merge", { entryId: entry.id, recordId: record.id })]);
        }
      }
      const [name, run] = pick(candidates);
      let outcome = "ok";
      try {
        await run();
      } catch (error) {
        outcome = error?.code ?? `errore: ${error?.message}`;
      }
      log.push(`${step}: ${name} -> ${outcome}`);
      tally[name] = tally[name] ?? { ok: 0, rifiutate: 0 };
      if (outcome === "ok") tally[name].ok += 1;
      else tally[name].rifiutate += 1;
      const context = `seed ${seed}, passo ${step} (${name} -> ${outcome})\nUltimi passi:\n${log.slice(-8).join("\n")}`;
      assert.ok(outcome === "ok" || outcome === "functions/failed-precondition", `Esito imprevisto: ${context}`);
      try {
        await assertConsistent(act);
        await assertSpecInvariants(act, originalText);
      } catch (error) {
        error.message = `${error.message}\n${context}`;
        throw error;
      }
    }
    t.diagnostic(`seed ${seed}: ${JSON.stringify(tally)}`);
    const okTotal = Object.values(tally).reduce((sum, item) => sum + item.ok, 0);
    assert.ok(okTotal >= FUZZ_STEPS / 4, `la sequenza casuale è quasi tutta rifiutata (${okTotal}/${FUZZ_STEPS} riuscite): test poco significativo`);
    for (const [name, counts] of Object.entries(tally)) {
      fuzzCoverage[name] = (fuzzCoverage[name] ?? 0) + counts.ok;
    }
    for (const required of ["propose", "withdraw"]) {
      assert.ok((tally[required]?.ok ?? 0) >= 1, `nessuna azione "${required}" riuscita nella sequenza: copertura insufficiente`);
    }
  });
}

test("sequenze casuali: nell'insieme dei seed ogni tipo di azione è riuscito almeno una volta", () => {
  const missing = ["propose", "challenge", "edit", "withdraw", "restore", "approve", "merge", "reject", "reopen", "updateRecord", "addParticipant", "withdrawEntry", "createRecord"]
    .filter((name) => !(fuzzCoverage[name] > 0));
  assert.deepEqual(missing, [], `azioni mai riuscite nelle sequenze casuali: ${missing.join(", ")} (copertura: ${JSON.stringify(fuzzCoverage)})`);
});

// ---------------------------------------------------------------------------
// Contratto con il client: le chiamate di recordNightService.ts funzionano
// ---------------------------------------------------------------------------
// Le chiavi che il client manda per ogni azione si leggono dal sorgente del
// servizio (non sono copiate qui): se il client aggiunge o rinomina un campo,
// la callable lo rifiuta (campi non ammessi) e questo test diventa rosso.

const SERVICE_SOURCE = readFileSync(new URL("../../src/services/firestore/recordNightService.ts", import.meta.url), "utf8")
  .replace(/\/\/.*$/gmu, "");

function clientPayloadKeys(action) {
  // Azioni chiamate direttamente: participantCallable({ stakeId, activityId, action: "context" }),
  // adminCallable({ stakeId, activityId, action: "setStaff", uid, enabled }).
  const inline = new RegExp(`(?:participantCallable|adminCallable)\\(\\{\\s*stakeId,\\s*activityId,\\s*action:\\s*"${action}"\\s*(?:,([^}]*))?\\}\\)`, "u").exec(SERVICE_SOURCE);
  if (inline) return (inline[1] ?? "").split(",").map((part) => part.trim()).filter(Boolean).map((part) => /^(\w+)/u.exec(part)[1]);
  const marker = new RegExp(`call(?:Participant|Admin)\\(\\s*stakeId,\\s*activityId,\\s*"${action}"\\s*,\\s*\\{`, "u");
  const match = marker.exec(SERVICE_SOURCE);
  assert.ok(match, `chiamata "${action}" non trovata in recordNightService.ts`);
  const segments = [];
  let depth = 1;
  let segment = "";
  for (let index = match.index + match[0].length; index < SERVICE_SOURCE.length; index++) {
    const char = SERVICE_SOURCE[index];
    if ("{([".includes(char)) depth += 1;
    else if ("})]".includes(char)) {
      depth -= 1;
      if (depth === 0) break;
    }
    if (char === "," && depth === 1) {
      segments.push(segment);
      segment = "";
    } else segment += char;
  }
  segments.push(segment);
  const keys = [];
  for (const raw of segments) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith("...")) keys.push(...[...part.matchAll(/\{\s*(\w+)\s*[:},]/gu)].map((m) => m[1]));
    else keys.push(/^(\w+)/u.exec(part)[1]);
  }
  return keys;
}

test("contratto client: nomi delle callable e campi mandati da recordNightService.ts sono accettati dal server", async () => {
  const names = [...SERVICE_SOURCE.matchAll(/httpsCallable<[\s\S]*?>\(\s*functions,\s*"(\w+)"/gu)].map((m) => m[1]).sort();
  assert.deepEqual(names, ["recordNightAdmin", "recordNightParticipant"], "il client chiama callable diverse da quelle del backend");
  const expectedActions = [
    "addParticipant", "approve", "challenge", "context", "createRecord", "edit", "listParticipants", "listStaff", "merge",
    "propose", "reject", "reopen", "restore", "setStaff", "updateRecord", "withdraw", "withdrawEntry",
  ];
  const sourceActions = [
    ...SERVICE_SOURCE.matchAll(/call(?:Participant|Admin)\(\s*stakeId,\s*activityId,\s*"(\w+)"/gu),
    ...SERVICE_SOURCE.matchAll(/(?:participantCallable|adminCallable)\(\{\s*stakeId,\s*activityId,\s*action:\s*"(\w+)"/gu),
  ].map((m) => m[1]).sort();
  assert.deepEqual(sourceActions, expectedActions, "il client ha azioni diverse da quelle provate qui (17 attese): aggiornare test e backend");

  const { boyA, boyB, boyC, boyD, parent, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyD] });
  const childId = await enrollChild(act, parent, "kid1", "Carlo");
  const call = async (client, action, values) => {
    const keys = clientPayloadKeys(action);
    const payload = {};
    for (const key of keys) {
      assert.ok(Object.hasOwn(values, key), `il client manda "${key}" per ${action}, che il test non conosce: aggiornare il test e il backend`);
      payload[key] = values[key];
    }
    const fn = ["context", "propose", "challenge", "edit", "withdraw", "restore"].includes(action) ? P : A;
    const result = await fn(client, act, action, payload);
    assert.equal(result.ok, true, action);
    assert.equal(result.action, action);
    return result;
  };

  // measure "count_in_time" con durata, poi una misura senza durata (il client manda null).
  const p1 = await call(boyA, "propose", { text: "Salti con la corda", measure: "count_in_time", durationSeconds: 30, needs: "Una corda", registrationId: `user_${boyA.uid}` });
  assert.equal(p1.entry.proposedDurationSeconds, 30);
  const edited = await call(boyA, "edit", { entryId: p1.entry.id, text: "Salti con la corda lunga", measure: "other", durationSeconds: null, needs: "" });
  assert.equal(edited.entry.proposedDurationSeconds, null);
  const approved = await call(admin, "approve", { entryId: p1.entry.id, title: "Salti con la corda", category: "resistenza", measure: "other", durationSeconds: null, notes: "Corda fornita" });
  const recordId = approved.record.id;
  const challenged = await call(boyB, "challenge", { recordId, registrationId: `user_${boyB.uid}` });
  await call(boyB, "withdraw", { entryId: challenged.entry.id });
  const restored = await call(boyB, "restore", { entryId: challenged.entry.id });
  assert.equal(restored.record.challengerCount, 2);
  await call(admin, "updateRecord", { recordId, title: "Salti con la corda", category: "resistenza", measure: "count_in_time", durationSeconds: 45, notes: "Corda fornita", status: "open" });
  const p2 = await call(boyC, "propose", { text: "Torre di bicchieri", measure: "distance", durationSeconds: null, needs: "", registrationId: `user_${boyC.uid}` });
  await call(admin, "reject", { entryId: p2.entry.id, reason: "Troppo difficile." });
  await call(admin, "reopen", { entryId: p2.entry.id });
  const merged = await call(admin, "merge", { entryId: p2.entry.id, recordId });
  assert.equal(merged.record.challengerCount, 3);
  const added = await call(admin, "addParticipant", { recordId, registrationId: `user_${boyD.uid}` });
  assert.equal(added.record.challengerCount, 4);
  const removed = await call(admin, "withdrawEntry", { entryId: added.entry.id });
  assert.equal(removed.record.challengerCount, 3);
  const created = await call(admin, "createRecord", { title: "Record creato dall'admin", category: "mente", measure: "other", durationSeconds: null, notes: "" });
  assert.equal(created.entry, null);
  assert.equal(created.record.challengerCount, 0);
  assert.equal(created.record.status, "open");
  // Azioni nuove: context, e un genitore che propone e sfida per il figlio.
  const context = await call(parent, "context", {});
  assert.deepEqual(context.people.map((person) => person.registrationId), [childId]);
  const childProposal = await call(parent, "propose", { text: "Palleggi con il pallone", measure: "other", durationSeconds: null, needs: "", registrationId: childId });
  assert.equal(childProposal.entry.ownerUid, parent.uid);
  const childChallenge = await call(parent, "challenge", { recordId, registrationId: childId });
  assert.equal(childChallenge.entry.registrationId, childId);
  const listed = await call(admin, "listParticipants", {});
  assert.ok(listed.participants.some((item) => item.registrationId === childId));
  const staffSet = await call(admin, "setStaff", { uid: boyD.uid, enabled: true });
  assert.deepEqual(staffSet.staffUids, [boyD.uid]);
  const candidates = await call(admin, "listStaff", {});
  assert.equal(candidates.candidates.find((item) => item.uid === boyD.uid).isStaff, true);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Rules con token veri dell'Auth emulator (le rules sono provate a parte con
// token simulati: qui lo stesso schema con utenti veri e record veri)
// ---------------------------------------------------------------------------

test("letture e scritture dirette con utenti veri: chi vede cosa e nessuno scrive", async () => {
  const { boyA, boyB, noReg, leader, leaderOther, parent, parent2, admin, superAdmin, otherAdmin, noProfile, anon, signedOut } = pool;
  const { adultLeader, adultCompanion, adultCancelled, adultYouth, adultNoReg, adultOtherStake, boyE } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  // Iscritti che si dichiarano dirigente/accompagnatore: NON sono staff finché un admin non li mette in elenco.
  await enrollAdult(act, adultLeader, "dirigente");
  await enrollAdult(act, boyE, "accompagnatore");
  await enrollAdult(act, adultCancelled, "dirigente", { registrationStatus: "cancelled" });
  await enrollAdult(act, adultYouth, "giovane_uomo");
  await enrollAdult(act, adultOtherStake, "dirigente"); // iscritto, ma con il profilo di un altro palo
  await enrollAdult(act, adultCompanion, "accompagnatore"); // questo sì: lo mette in elenco un admin
  await A(admin, act, "setStaff", { uid: adultCompanion.uid, enabled: true });
  const childId = await enrollChild(act, parent, "kid1", "Carlo");
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  const challenge = await P(boyB, act, "challenge", { recordId: r1.record.id });
  const childEntry = await P(parent, act, "challenge", { recordId: r1.record.id, registrationId: childId });
  const recordsPath = `${activityPath(act)}/records`;
  const entriesPath = `${activityPath(act)}/recordEntries`;
  const denied = (promise) => assert.rejects(promise, (error) => error?.code === "permission-denied");
  const all = (client, path) => getDocsFromServer(collection(client.firestore, path));
  const ids = (snapshot) => snapshot.docs.map((item) => item.id).sort();

  // Un secondo record, poi nascosto dallo staff: i membri non lo leggono più.
  const r2 = await makeRecord(act, boyB, "Record di Bruno");
  await A(admin, act, "updateRecord", { recordId: r2.record.id, ...recordInput("Record di Bruno"), status: "hidden" });
  const openQuery = (client) => query(collection(client.firestore, recordsPath), where("status", "==", "open"));
  const entriesCount = (await entriesRef(act).get()).size;
  assert.equal(entriesCount, 4);

  // Non staff del palo (anche chi si dichiara dirigente/accompagnatore, o ha l'iscrizione annullata): solo where status == open.
  for (const client of [boyA, boyB, boyE, noReg, parent, parent2, adultLeader, adultCancelled, adultYouth, adultNoReg]) {
    const snap = await getDocsFromServer(openQuery(client));
    assert.deepEqual(ids(snap), [r1.record.id], `${client.name} deve leggere solo il record aperto`);
    await denied(all(client, recordsPath));
    await denied(getDocFromServer(doc(client.firestore, `${recordsPath}/${r2.record.id}`)));
    await denied(getDocsFromServer(query(collection(client.firestore, recordsPath), where("status", "==", "hidden"))));
    await denied(all(client, entriesPath));
    assert.equal((await getDocFromServer(doc(client.firestore, `${recordsPath}/${r1.record.id}`))).exists(), true);
  }
  // Staff (admin, super_admin, unit_leader dello stesso palo, uid in elenco):
  // records e recordEntries intere, nascosti compresi.
  for (const client of [admin, superAdmin, leader, adultCompanion]) {
    const snap = await all(client, recordsPath);
    assert.deepEqual(ids(snap), [r1.record.id, r2.record.id].sort(), `${client.name} deve leggere anche i nascosti`);
    assert.equal((await getDocFromServer(doc(client.firestore, `${recordsPath}/${r2.record.id}`))).data().status, "hidden");
    assert.equal((await all(client, entriesPath)).size, entriesCount, `${client.name} deve leggere tutti i tentativi`);
    assert.equal((await getDocFromServer(doc(client.firestore, `${entriesPath}/${challenge.entry.id}`))).data().participantName, PEOPLE.boyB);
    assert.deepEqual(ids(await getDocsFromServer(openQuery(client))), [r1.record.id]);
  }
  // Fuori dal palo, senza profilo, anonimi, non loggati: nessun record e nessun tentativo.
  for (const client of [anon, signedOut, noProfile, otherAdmin, leaderOther, adultOtherStake]) {
    await denied(all(client, recordsPath));
    await denied(getDocsFromServer(openQuery(client)));
    await denied(getDocFromServer(doc(client.firestore, `${recordsPath}/${r1.record.id}`)));
    await denied(all(client, entriesPath));
    await denied(getDocsFromServer(query(collection(client.firestore, entriesPath), where("ownerUid", "==", boyB.uid))));
  }

  // Titolare: where ownerUid == uid. Il genitore vede quello del figlio, l'altro genitore no.
  const own = (client) => getDocsFromServer(query(collection(client.firestore, entriesPath), where("ownerUid", "==", client.uid)));
  assert.equal((await own(boyB)).size, 2, "boyB ha la sfida e la proposta approvata di r2");
  assert.deepEqual((await own(parent)).docs.map((item) => item.id), [childEntry.entry.id]);
  assert.equal((await own(parent)).docs[0].data().registrationId, childId);
  assert.equal((await own(parent2)).size, 0);
  assert.equal((await own(noReg)).size, 0);
  await denied(getDocFromServer(doc(parent2.firestore, `${entriesPath}/${childEntry.entry.id}`)));
  await denied(getDocsFromServer(query(collection(parent2.firestore, entriesPath), where("ownerUid", "==", parent.uid))));
  await denied(getDocFromServer(doc(boyA.firestore, `${entriesPath}/${challenge.entry.id}`)));
  await denied(getDocsFromServer(query(collection(boyA.firestore, entriesPath), where("ownerUid", "==", boyB.uid))));
  // L'anonimo non legge nemmeno i propri; un utente vero di un altro palo legge i propri (nessuno).
  await denied(getDocsFromServer(query(collection(anon.firestore, entriesPath), where("ownerUid", "==", anon.uid))));
  assert.equal((await own(otherAdmin)).size, 0);

  // management/recordNight (l'elenco staff): lo legge solo un admin del palo, nessun client lo scrive.
  const staffPath = `${activityPath(act)}/management/recordNight`;
  for (const client of [admin, superAdmin]) {
    const snap = await getDocFromServer(doc(client.firestore, staffPath));
    assert.deepEqual(snap.data().staffUids, [adultCompanion.uid], `${client.name} legge l'elenco`);
  }
  for (const client of [leader, adultCompanion, adultLeader, boyE, boyA, parent, otherAdmin, leaderOther, noProfile, anon, signedOut]) {
    await denied(getDocFromServer(doc(client.firestore, staffPath)));
  }
  for (const client of [admin, superAdmin, leader, adultCompanion, adultLeader, boyE, boyA, anon, signedOut]) {
    await denied(setDoc(doc(client.firestore, staffPath), { staffUids: [client.uid ?? "x"] }));
    await denied(updateDoc(doc(client.firestore, staffPath), { staffUids: [client.uid ?? "x"] }));
    await denied(deleteDoc(doc(client.firestore, staffPath)));
  }
  assert.deepEqual(await staffUidsOf(act), [adultCompanion.uid], "nessuno si è messo in elenco da solo");

  // Nessuna scrittura diretta, neanche dello staff.
  for (const client of [admin, superAdmin, leader, adultLeader, adultCompanion, boyE, boyA, boyB, parent, anon, signedOut]) {
    await denied(setDoc(doc(client.firestore, `${recordsPath}/r-hack-${client.name}`), { title: "Hack", challengerCount: 99, status: "open" }));
    await denied(addDoc(collection(client.firestore, entriesPath), { registrationId: `user_${client.uid}`, ownerUid: client.uid, status: "approved" }));
    await denied(updateDoc(doc(client.firestore, `${recordsPath}/${r1.record.id}`), { challengerCount: 99 }));
    await denied(updateDoc(doc(client.firestore, `${entriesPath}/${challenge.entry.id}`), { status: "withdrawn" }));
    await denied(updateDoc(doc(client.firestore, `${entriesPath}/${childEntry.entry.id}`), { status: "withdrawn" }));
    await denied(deleteDoc(doc(client.firestore, `${entriesPath}/${challenge.entry.id}`)));
    await denied(deleteDoc(doc(client.firestore, `${recordsPath}/${r1.record.id}`)));
  }
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 3);
  assert.equal((await entryData(act, challenge.entry.id)).status, "approved");
  assert.equal((await recordsRef(act).get()).size, 2);
  assert.equal((await entriesRef(act).get()).size, entriesCount);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Spec: "Ogni azione legge e scrive in una transazione"
// ---------------------------------------------------------------------------
// L'emulatore serializza le transazioni più della produzione (blocca per
// collezione): una lettura fatta fuori dalla transazione passerebbe i test di
// concorrenza lo stesso, con aggiornamenti persi solo su Firestore vero. Per
// questo qui si prova la proprietà direttamente: gli handler girano contro
// un Firestore avvolto da un proxy che registra ogni get/set/update/create/
// delete fatto su riferimenti e query invece che dall'oggetto transazione.

const READ_ONLY_LISTS = new Set(["listParticipants", "listStaff"]);
const DIRECT_IO = new Set(["get", "set", "update", "create", "delete", "add", "listDocuments", "stream", "count"]);
const isRefLike = (value) => value && typeof value === "object" && ["DocumentReference", "CollectionReference", "Query"].includes(value.constructor?.name);

function spyOnDirectIo(realDb) {
  const violations = [];
  const counts = { transactions: 0 };
  const wrap = (ref) =>
    new Proxy(ref, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        return (...args) => {
          if (DIRECT_IO.has(prop)) violations.push(`${String(prop)} su ${target.path ?? "query"}`);
          const result = value.apply(target, args);
          return isRefLike(result) ? wrap(result) : result;
        };
      },
    });
  const db = new Proxy(realDb, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args) => {
        if (prop === "runTransaction") counts.transactions += 1;
        if (prop === "getAll") violations.push("getAll fuori dalla transazione");
        const result = value.apply(target, args);
        return isRefLike(result) ? wrap(result) : result;
      };
    },
  });
  return { db, violations, counts };
}

test("spec: ogni azione e il trigger leggono e scrivono solo dentro la transazione", async () => {
  const { boyA, boyB, boyC, boyD, parent, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyD] });
  const childId = await enrollChild(act, parent, "kid1", "Carlo");
  const violations = [];
  let transactions = 0;
  let calls = 0;
  const authFor = (client) => ({ uid: client.uid, token: { firebase: { sign_in_provider: "password" } } });
  const run = async (factory, client, action, payload) => {
    const spy = spyOnDirectIo(adminDb);
    calls += 1;
    try {
      const result = await factory({ db: spy.db })({ auth: authFor(client), data: { stakeId, activityId: act, action, ...payload } });
      assert.equal(result.ok, true, action);
      return result;
    } finally {
      // Spec: listParticipants e listStaff leggono le iscrizioni fuori dalla transazione (sola lettura,
      // dopo l'autorizzazione in una transazione breve). Le scritture dirette restano vietate ovunque.
      const found = READ_ONLY_LISTS.has(action) ? spy.violations.filter((item) => !item.startsWith("get ")) : spy.violations;
      violations.push(...found.map((item) => `${action}: ${item}`));
      transactions += spy.counts.transactions;
    }
  };
  const asBoy = (client, action, payload) => run(night.createRecordNightParticipantHandler, client, action, payload);
  const asAdmin = (action, payload) => run(night.createRecordNightAdminHandler, admin, action, payload);

  assert.equal((await asBoy(boyA, "context", {})).isStaff, false);
  assert.deepEqual((await asBoy(parent, "context", {})).people.map((person) => person.registrationId), [childId]);
  const a1 = await asBoy(boyA, "propose", proposal("Salti con la corda"));
  await asBoy(boyA, "edit", { entryId: a1.entry.id, ...proposal("Salti con la corda lunga") });
  const approved = await asAdmin("approve", { entryId: a1.entry.id, ...recordInput("Salti con la corda") });
  const recordId = approved.record.id;
  const challenge = await asBoy(boyB, "challenge", { recordId });
  await asBoy(boyB, "withdraw", { entryId: challenge.entry.id });
  await asBoy(boyB, "restore", { entryId: challenge.entry.id });
  const c1 = await asBoy(boyC, "propose", proposal("Torre di bicchieri"));
  await asAdmin("reject", { entryId: c1.entry.id, reason: "No." });
  await asAdmin("reopen", { entryId: c1.entry.id });
  await asAdmin("merge", { entryId: c1.entry.id, recordId });
  const kid = await asBoy(parent, "challenge", { recordId, registrationId: childId });
  await asBoy(parent, "propose", { ...proposal("Idea di Carlo"), registrationId: childId });
  assert.equal(kid.entry.ownerUid, parent.uid);
  assert.ok((await asAdmin("listParticipants", {})).participants.length >= 5);
  assert.ok((await asAdmin("listStaff", {})).candidates.length >= 4);
  assert.deepEqual((await asAdmin("setStaff", { uid: boyD.uid, enabled: true })).staffUids, [boyD.uid]);
  // Nascondere ritira gli iscritti, mostrare li rimette: tutto nella stessa transazione di ogni chiamata.
  const hidden = await asAdmin("updateRecord", { recordId, ...recordInput("Salti con la corda (rivisto)"), status: "hidden" });
  assert.equal(hidden.withdrawnCount, 4);
  const shown = await asAdmin("updateRecord", { recordId, ...recordInput("Salti con la corda (rivisto)"), status: "open" });
  assert.equal(shown.restoredCount, 4);
  await asAdmin("createRecord", recordInput("Record creato dall'admin"));
  const added = await asAdmin("addParticipant", { recordId, registrationId: `user_${boyD.uid}` });
  await asAdmin("withdrawEntry", { entryId: added.entry.id });

  // Trigger: iscrizione annullata. Si invoca la funzione dopo l'update; se il
  // trigger dell'emulatore ha già ritirato i tentativi, la chiamata è un no-op.
  await adminDb.doc(`${activityPath(act)}/registrations/user_${boyB.uid}`).update({ registrationStatus: "cancelled" });
  const spy = spyOnDirectIo(adminDb);
  await night.retireEntriesForRegistration(spy.db, { stakeId, activityId: act, registrationId: `user_${boyB.uid}` });
  violations.push(...spy.violations.map((item) => `retireEntriesForRegistration: ${item}`));
  transactions += spy.counts.transactions;

  assert.deepEqual(violations, [], `Letture o scritture fuori dalla transazione:\n${violations.join("\n")}`);
  assert.equal(transactions, calls + 1, "ogni azione e il trigger devono aprire esattamente una transazione");
  assert.ok(calls >= 22, `troppo poche azioni provate (${calls})`);
  await waitFor(async () => (await recordData(act, recordId)).challengerCount, (count) => count === 3, "il contatore dopo il ritiro d'ufficio di boyB");
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// createRecord (admin): record aperto a zero iscritti
// ---------------------------------------------------------------------------

test("createRecord: nasce a zero iscritti, il ragazzo non lo vede né lo sfida finché l'admin non iscrive qualcuno", async () => {
  const { boyA, boyB, parent, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const childId = `child_${parent.uid}_kid2`;
  await adminDb.doc(`${activityPath(act)}/registrations/${childId}`).set({
    parentUid: parent.uid,
    firstName: "Gabriele",
    lastName: "Settimo",
    registrationStatus: "confirmed",
  });
  const recordsPath = `${activityPath(act)}/records`;
  // listRecords del client (where status == open) + filtro lato client sul contatore.
  const openRecords = async (client) =>
    (await getDocsFromServer(query(collection(client.firestore, recordsPath), where("status", "==", "open")))).docs.map((item) => ({ id: item.id, ...item.data() }));
  const visibleToBoys = async (client) => (await openRecords(client)).filter((record) => record.challengerCount > 0);

  const created = await A(admin, act, "createRecord", {
    title: "Torre di 10 bicchieri",
    category: "precisione",
    measure: "fastest_time",
    durationSeconds: null,
    notes: "Servono dieci bicchieri di carta",
  });
  assert.equal(created.ok, true);
  assert.equal(created.action, "createRecord");
  assert.equal(created.entry, null, "createRecord non tocca nessun tentativo");
  const recordId = created.record.id;
  assert.equal(created.record.status, "open");
  assert.equal(created.record.challengerCount, 0);
  assert.equal(created.record.title, "Torre di 10 bicchieri");
  assert.equal(created.record.category, "precisione");
  assert.equal(created.record.measure, "fastest_time");
  assert.equal(created.record.durationSeconds, null);
  assert.equal(created.record.notes, "Servono dieci bicchieri di carta");
  assert.equal(created.record.createdBy, admin.uid);
  const stored = await recordData(act, recordId);
  assert.deepEqual(
    Object.keys(stored).sort(),
    ["category", "challengerCount", "createdAt", "createdBy", "createdFromEntryId", "durationSeconds", "measure", "notes", "status", "title", "updatedAt"],
  );
  assert.equal(stored.createdFromEntryId, null, "«Nuovo record» non nasce da un'approvazione");
  assert.equal(stored.challengerCount, 0);
  assert.ok(!Number.isNaN(new Date(stored.createdAt).getTime()) && !Number.isNaN(new Date(stored.updatedAt).getTime()));
  assert.equal((await entriesRef(act).get()).size, 0, "nessun tentativo creato");

  // La rule lo lascia leggere (è open), ma a zero iscritti il client non lo mostra.
  assert.deepEqual((await openRecords(boyA)).map((record) => record.id), [recordId]);
  assert.deepEqual(await visibleToBoys(boyA), []);
  assert.deepEqual(await visibleToBoys(boyB), []);
  // L'admin lo vede nella collection intera.
  const adminAll = await getDocsFromServer(collection(admin.firestore, recordsPath));
  assert.deepEqual(adminAll.docs.map((item) => item.id), [recordId]);
  // Il ragazzo non può sfidarlo (a zero non è sfidabile) e non resta nulla.
  await expectFail(P(boyA, act, "challenge", { recordId }), "failed-precondition");
  assert.equal((await entriesOfRegistration(act, `user_${boyA.uid}`)).length, 0);
  assert.equal((await recordData(act, recordId)).challengerCount, 0);

  // Chi non ha un account: l'admin lo iscrive al record nuovo e il record diventa visibile.
  const added = await A(admin, act, "addParticipant", { recordId, registrationId: childId });
  assert.equal(added.record.challengerCount, 1);
  assert.equal(added.entry.ownerUid, parent.uid, "il titolare del tentativo di un figlio è il genitore");
  assert.equal(added.entry.status, "approved");
  const seen = await visibleToBoys(boyA);
  assert.deepEqual(seen.map((record) => record.id), [recordId]);
  assert.equal(seen[0].challengerCount, 1);
  // Ora è sfidabile.
  const challenged = await P(boyA, act, "challenge", { recordId });
  assert.equal(challenged.record.challengerCount, 2);
  assert.equal((await visibleToBoys(boyB))[0].challengerCount, 2);

  // Se tutti si ritirano torna a zero: resta open ma sparisce dall'elenco dei ragazzi.
  await P(boyA, act, "withdraw", { entryId: challenged.entry.id });
  await A(admin, act, "withdrawEntry", { entryId: added.entry.id });
  assert.equal((await recordData(act, recordId)).challengerCount, 0);
  assert.equal((await recordData(act, recordId)).status, "open");
  assert.deepEqual(await visibleToBoys(boyA), []);
  // L'admin lo può iscrivere di nuovo.
  const again = await A(admin, act, "addParticipant", { recordId, registrationId: `user_${boyB.uid}` });
  assert.equal(again.record.challengerCount, 1);
  assert.equal((await visibleToBoys(boyA)).length, 1);
  await assertConsistent(act);
});

test("createRecord: valori di default e record nascosto subito dopo", async () => {
  const { boyA, admin } = pool;
  const act = await newActivity({ members: [boyA] });
  // notes assente = vuoto; durata assente con una misura senza tempo = null.
  const minimal = await A(admin, act, "createRecord", { title: "Minimo", category: "fantasia", measure: "other" });
  assert.equal(minimal.record.notes, "");
  assert.equal(minimal.record.durationSeconds, null);
  const timed = await A(admin, act, "createRecord", { title: "Salti in 30 secondi", category: "resistenza", measure: "count_in_time", durationSeconds: 30 });
  assert.equal(timed.record.durationSeconds, 30);
  // Due record con lo stesso titolo sono ammessi (nessun vincolo di unicità in spec).
  const twin = await A(admin, act, "createRecord", { title: "Minimo", category: "fantasia", measure: "other" });
  assert.notEqual(twin.record.id, minimal.record.id);
  assert.equal((await recordsRef(act).get()).size, 3);
  // Nascosto subito: addParticipant e sfide sono bloccati finché non lo si riapre.
  await A(admin, act, "updateRecord", { recordId: minimal.record.id, title: "Minimo", category: "fantasia", measure: "other", status: "hidden" });
  await expectFail(A(admin, act, "addParticipant", { recordId: minimal.record.id, registrationId: `user_${boyA.uid}` }), "failed-precondition");
  await assertConsistent(act);
});

test("createRecord: validazione (chiavi extra, durata solo per count_in_time, limiti di lunghezza)", async () => {
  const { admin } = pool;
  const act = await newActivity({ members: [] });
  const base = { title: "Titolo", category: "resistenza", measure: "other", durationSeconds: null, notes: "" };
  const bad = [
    ["chiave extra: challengerCount", { ...base, challengerCount: 5 }],
    ["chiave extra: status", { ...base, status: "hidden" }],
    ["chiave extra: entryId", { ...base, entryId: "x" }],
    ["chiave extra: createdBy", { ...base, createdBy: "chiunque" }],
    ["titolo vuoto", { ...base, title: "" }],
    ["titolo di soli spazi", { ...base, title: "   " }],
    ["titolo assente", { category: "resistenza", measure: "other" }],
    ["titolo di 81 caratteri", { ...base, title: "t".repeat(81) }],
    ["titolo non stringa", { ...base, title: 42 }],
    ["carattere di controllo nel titolo", { ...base, title: "Titolo\u0007" }],
    ["categoria sconosciuta", { ...base, category: "inventata" }],
    ["categoria assente", { title: "Titolo", measure: "other" }],
    ["misura sconosciuta", { ...base, measure: "inventata" }],
    ["misura assente", { title: "Titolo", category: "resistenza" }],
    ["note di 201 caratteri", { ...base, notes: "n".repeat(201) }],
    ["note non stringa", { ...base, notes: 7 }],
    ["durata su una misura senza tempo (distance)", { ...base, measure: "distance", durationSeconds: 30 }],
    ["durata su una misura senza tempo (other)", { ...base, durationSeconds: 30 }],
    ["durata su count_streak", { ...base, measure: "count_streak", durationSeconds: 20 }],
    ["count_in_time senza durata (null)", { ...base, measure: "count_in_time", durationSeconds: null }],
    ["count_in_time senza durata (assente)", { title: "Titolo", category: "resistenza", measure: "count_in_time" }],
    ["count_in_time con durata 9", { ...base, measure: "count_in_time", durationSeconds: 9 }],
    ["count_in_time con durata 61", { ...base, measure: "count_in_time", durationSeconds: 61 }],
    ["count_in_time con durata non intera", { ...base, measure: "count_in_time", durationSeconds: 30.5 }],
    ["count_in_time con durata stringa", { ...base, measure: "count_in_time", durationSeconds: "30" }],
  ];
  const failures = [];
  for (const [label, payload] of bad) {
    try {
      await A(admin, act, "createRecord", payload);
      failures.push(`${label}: ACCETTATO`);
    } catch (error) {
      if (error?.code !== "functions/invalid-argument") failures.push(`${label}: ${error?.code} ${error?.message}`);
    }
  }
  assert.deepEqual(failures, [], `createRecord non ha rifiutato come invalid-argument:\n${failures.join("\n")}`);
  assert.equal((await recordsRef(act).get()).size, 0, "nessun record parziale dopo gli input non validi");
  await expectFail(A(admin, act, "createRecord", {}), "invalid-argument");
  await expectFail(admin.adminFn({ activityId: act, action: "createRecord", ...base }), "invalid-argument");

  // Valori ai limiti: accettati.
  const okCases = [
    { ...base, title: "t".repeat(80), notes: "n".repeat(200) },
    { ...base, measure: "count_in_time", durationSeconds: 10 },
    { ...base, measure: "count_in_time", durationSeconds: 60 },
    { title: "Senza durata né note", category: "mente", measure: "longest_time" },
  ];
  for (const payload of okCases) {
    const result = await A(admin, act, "createRecord", payload);
    assert.equal(result.record.challengerCount, 0);
  }
  assert.equal((await recordsRef(act).get()).size, okCases.length);
  await assertConsistent(act);
});

test("createRecord: attività inesistente o di un altro palo", async () => {
  const { admin, otherAdmin } = pool;
  const act = await newActivity({ members: [] });
  await expectFail(A(admin, "attivita-che-non-esiste", "createRecord", recordInput("Titolo")), "not-found");
  await expectFail(A(otherAdmin, act, "createRecord", recordInput("Titolo")), "permission-denied");
  assert.equal((await recordsRef(act).get()).size, 0);
});

// ---------------------------------------------------------------------------
// edit: non rende la proposta identica a un'altra proposta attiva
// ---------------------------------------------------------------------------

test("edit: una modifica che rende la proposta identica a un'altra attiva della stessa persona è rifiutata", async () => {
  const { boyA, boyB, admin } = pool;
  const DUPLICATE = DUPLICATE_MSG;
  const act = await newActivity({ members: [boyA, boyB] });
  const p1 = await P(boyA, act, "propose", proposal("Torre di bicchieri"));
  const p2 = await P(boyA, act, "propose", proposal("Salto con la corda"));
  const edit = (entry, input) => P(boyA, act, "edit", { entryId: entry.entry.id, ...input });

  // Identica a p1 (maiuscole e spazi non contano): rifiutata, p2 resta com'era.
  const before = await entryData(act, p2.entry.id);
  await expectFail(edit(p2, proposal("  torre   di BICCHIERI ")), "failed-precondition", DUPLICATE);
  assert.deepEqual(await entryData(act, p2.entry.id), before, "una modifica rifiutata non cambia nulla");

  // Misura o durata diverse = proposta diversa: ammessa.
  assert.equal((await edit(p2, proposal("Torre di bicchieri", { measure: "other", durationSeconds: null }))).entry.proposedMeasure, "other");
  assert.equal((await edit(p2, proposal("Torre di bicchieri", { durationSeconds: 30 }))).entry.proposedDurationSeconds, 30);
  // Di nuovo identica a p1 (stessa misura, stessa durata): rifiutata.
  await expectFail(edit(p2, proposal("Torre di bicchieri", { durationSeconds: 60 })), "failed-precondition", DUPLICATE);
  assert.equal((await entryData(act, p2.entry.id)).proposedDurationSeconds, 30);

  // Modificare una proposta lasciandola uguale a se stessa non è un duplicato.
  const same = await edit(p1, proposal("Torre di bicchieri"));
  assert.equal(same.entry.proposedText, "Torre di bicchieri");
  assert.equal((await edit(p1, proposal("Torre di bicchieri", { needs: "Dieci bicchieri" }))).entry.proposedNeeds, "Dieci bicchieri");

  // Un'altra persona può avere la stessa proposta, e modificarsi fino a combaciare con quella di Anna.
  const b1 = await P(boyB, act, "propose", proposal("Torre di bicchieri"));
  const b2 = await P(boyB, act, "propose", proposal("Altro"));
  assert.equal((await P(boyB, act, "edit", { entryId: b2.entry.id, ...proposal("Torre di bicchieri", { durationSeconds: 30 }) })).entry.status, "pending");
  await expectFail(P(boyB, act, "edit", { entryId: b2.entry.id, ...proposal("Torre di bicchieri") }), "failed-precondition", DUPLICATE);
  assert.ok(b1.entry.id);

  // Una proposta ritirata o rifiutata non è attiva: non blocca la modifica.
  await P(boyA, act, "withdraw", { entryId: p1.entry.id });
  assert.equal((await edit(p2, proposal("Torre di bicchieri"))).entry.proposedText, "Torre di bicchieri");
  await A(admin, act, "reject", { entryId: b1.entry.id, reason: "No." });
  assert.equal((await P(boyB, act, "edit", { entryId: b2.entry.id, ...proposal("Torre di bicchieri") })).entry.status, "pending");

  // "Annulla" del ritiro di p1 con p2 ora identica: la spec lo vieta ("non si ripristina").
  await expectFail(P(boyA, act, "restore", { entryId: p1.entry.id }), "failed-precondition", DUPLICATE_MSG);
  assert.equal((await entryData(act, p1.entry.id)).status, "withdrawn");
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Genitori: propongono e sfidano per i figli (child_<parentUid>_<childId>)
// ---------------------------------------------------------------------------

test("genitore: propone, sfida, modifica, ritira e ripristina per i figli; il titolare è il genitore", async () => {
  const { parent, parent2, boyA, admin } = pool;
  const act = await newActivity({ members: [boyA] });
  const kid1 = await enrollChild(act, parent, "kid1", "Carlo");
  const kid2 = await enrollChild(act, parent, "kid2", "Dario");
  const otherKid = await enrollChild(act, parent2, "kid1", "Enrico");
  const r1 = await makeRecord(act, boyA, "Record di Anna");

  const p1 = await P(parent, act, "propose", { ...proposal("Salti con la corda"), registrationId: kid1 });
  assert.equal(p1.entry.ownerUid, parent.uid, "ownerUid = genitore, non il figlio");
  assert.equal(p1.entry.registrationId, kid1);
  assert.equal(p1.entry.participantName, "Carlo Rossi");
  assert.equal(p1.entry.status, "pending");
  assert.equal(p1.entry.kind, "proposal");
  // La stessa proposta per lo stesso figlio non si crea due volte (con un posto ancora libero).
  await expectFail(P(parent, act, "propose", { ...proposal("  SALTI con la corda "), registrationId: kid1 }), "failed-precondition", DUPLICATE_MSG);
  const c2 = await P(parent, act, "challenge", { recordId: r1.record.id, registrationId: kid2 });
  assert.equal(c2.entry.ownerUid, parent.uid);
  assert.equal(c2.entry.registrationId, kid2);
  assert.equal(c2.entry.participantName, "Dario Rossi");
  assert.equal(c2.record.challengerCount, 2);

  // Limite di 2 e unicità valgono per registrationId, non per genitore.
  const p1b = await P(parent, act, "propose", { ...proposal("Torre di bicchieri"), registrationId: kid1 });
  await expectFail(P(parent, act, "propose", { ...proposal("Terza idea"), registrationId: kid1 }), "failed-precondition", LIMIT_MSG);
  await expectFail(P(parent, act, "challenge", { recordId: r1.record.id, registrationId: kid1 }), "failed-precondition", LIMIT_MSG);
  const kid2Other = await P(parent, act, "propose", { ...proposal("Idea di Dario"), registrationId: kid2 });
  assert.equal(kid2Other.entry.status, "pending", "kid2 ha ancora un posto libero");
  await expectFail(P(parent, act, "challenge", { recordId: r1.record.id, registrationId: kid2 }), "failed-precondition", ALREADY_MSG);
  // Libero un posto di kid1 e kid1 sfida lo stesso record di kid2: persone diverse, nessun conflitto.
  await P(parent, act, "withdraw", { entryId: p1b.entry.id });
  const c1 = await P(parent, act, "challenge", { recordId: r1.record.id, registrationId: kid1 });
  assert.equal(c1.record.challengerCount, 3);
  assert.equal(c1.entry.ownerUid, parent.uid);

  // Modifica, ritiro e ripristino li fa il titolare del tentativo (il genitore).
  const edited = await P(parent, act, "edit", { entryId: p1.entry.id, ...proposal("Salti con la corda lunga") });
  assert.equal(edited.entry.proposedText, "Salti con la corda lunga");
  const withdrawn = await P(parent, act, "withdraw", { entryId: c2.entry.id });
  assert.equal(withdrawn.entry.status, "withdrawn");
  assert.equal(withdrawn.entry.withdrawnBy, "self");
  assert.equal(withdrawn.entry.statusBeforeWithdraw, "approved");
  assert.equal(withdrawn.record.challengerCount, 2);
  const restored = await P(parent, act, "restore", { entryId: c2.entry.id });
  assert.equal(restored.entry.status, "approved");
  assert.equal(restored.entry.withdrawnBy ?? null, null);
  assert.equal(restored.record.challengerCount, 3);

  // Un altro genitore (o chiunque non sia il titolare) non tocca i tentativi dei figli altrui.
  for (const action of ["withdraw", "restore"]) {
    await expectFail(P(parent2, act, action, { entryId: c2.entry.id }), "not-found");
    await expectFail(P(boyA, act, action, { entryId: c2.entry.id }), "not-found");
  }
  await expectFail(P(parent2, act, "edit", { entryId: p1.entry.id, ...proposal("Presa") }), "not-found");

  // Per conto di chi non è un proprio figlio: rifiutato.
  const ACT_MSG = "Non puoi agire per questa iscrizione.";
  await expectFail(P(parent, act, "propose", { ...proposal("Per il figlio altrui"), registrationId: otherKid }), "permission-denied", ACT_MSG);
  await expectFail(P(parent, act, "challenge", { recordId: r1.record.id, registrationId: otherKid }), "permission-denied", ACT_MSG);
  await expectFail(P(parent, act, "propose", { ...proposal("Per Anna"), registrationId: `user_${boyA.uid}` }), "permission-denied", ACT_MSG);
  await expectFail(P(parent2, act, "challenge", { recordId: r1.record.id, registrationId: kid1 }), "permission-denied", ACT_MSG);
  // Iscrizione con l'id del genitore ma parentUid di un altro: rifiutata.
  const odd = `child_${parent.uid}_strano`;
  await adminDb.doc(`${activityPath(act)}/registrations/${odd}`).set({ parentUid: parent2.uid, firstName: "Strano", lastName: "Rossi", registrationStatus: "confirmed" });
  await expectFail(P(parent, act, "propose", { ...proposal("Figlio strano"), registrationId: odd }), "permission-denied", ACT_MSG);
  // Iscrizione di un figlio altrui senza il campo parentUid: il prefisso dell'id dice di chi è.
  const foreignNoField = `child_${parent2.uid}_senzacampo`;
  await adminDb.doc(`${activityPath(act)}/registrations/${foreignNoField}`).set({ firstName: "Altrui", lastName: "Rossi", registrationStatus: "confirmed" });
  await expectFail(P(parent, act, "propose", { ...proposal("Figlio altrui senza campo"), registrationId: foreignNoField }), "permission-denied", ACT_MSG);
  await expectFail(P(parent, act, "challenge", { recordId: r1.record.id, registrationId: foreignNoField }), "permission-denied", ACT_MSG);
  // Figlio inesistente, annullato o respinto dal genitore: serve l'iscrizione.
  const gone = await enrollChild(act, parent, "annullato", "Anullato", { registrationStatus: "cancelled" });
  const refused = await enrollChild(act, parent, "respinto", "Respinto", { registrationStatus: "rejected_by_parent" });
  for (const registrationId of [`child_${parent.uid}_nonesiste`, gone, refused]) {
    await expectFail(P(parent, act, "propose", { ...proposal("Idea"), registrationId }), "permission-denied", NOT_ENROLLED_MSG);
    await expectFail(P(parent, act, "challenge", { recordId: r1.record.id, registrationId }), "permission-denied", NOT_ENROLLED_MSG);
  }
  // Formati non validi.
  await expectFail(P(parent, act, "propose", { ...proposal("Idea"), registrationId: "guest_ospite" }), "invalid-argument");
  await expectFail(P(parent, act, "propose", { ...proposal("Idea"), registrationId: "adulto_xyz" }), "invalid-argument");
  await expectFail(P(parent, act, "propose", { ...proposal("Idea"), registrationId: "../altro" }), "invalid-argument");
  // Senza registrationId il genitore agisce per sé: senza propria iscrizione è rifiutato.
  await expectFail(P(parent, act, "propose", proposal("Per me")), "permission-denied", NOT_ENROLLED_MSG);

  // Con una propria iscrizione il genitore ha anche il proprio limite, separato da quello dei figli.
  await enroll(act, parent, { fullName: "Genitore Prova" });
  const own = await P(parent, act, "propose", proposal("Idea del genitore"));
  assert.equal(own.entry.registrationId, `user_${parent.uid}`);
  assert.equal(own.entry.ownerUid, parent.uid);

  // I tentativi dei figli li vede lo staff con i nomi, il genitore con la sua query.
  const adminView = await getDocsFromServer(collection(admin.firestore, `${activityPath(act)}/recordEntries`));
  assert.ok(adminView.docs.some((item) => item.data().participantName === "Carlo Rossi"));
  await assertConsistent(act);

  // Dopo la chiusura il genitore, come il ragazzo, vede e basta.
  await adminDb.doc(activityPath(act)).update({ recordsCloseAt: inPast(1) });
  await expectFail(P(parent, act, "propose", { ...proposal("Tardiva"), registrationId: kid2 }), "failed-precondition", CLOSED_MSG);
  await expectFail(P(parent, act, "challenge", { recordId: r1.record.id, registrationId: kid2 }), "failed-precondition", CLOSED_MSG);
  await expectFail(P(parent, act, "edit", { entryId: p1.entry.id, ...proposal("Tardiva") }), "failed-precondition", CLOSED_MSG);
  await expectFail(P(parent, act, "withdraw", { entryId: c2.entry.id }), "failed-precondition", CLOSED_MSG);
  await expectFail(P(parent, act, "restore", { entryId: p1b.entry.id }), "failed-precondition", CLOSED_MSG);
  await assertConsistent(act);
});

test("genitore: figlio annullato dopo la proposta; il genitore non può più modificare né ripristinare", async () => {
  const { parent, boyA } = pool;
  const act = await newActivity({ members: [boyA] });
  const kid = await enrollChild(act, parent, "kid1", "Carlo");
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  const challenge = await P(parent, act, "challenge", { recordId: r1.record.id, registrationId: kid });
  const proposed = await P(parent, act, "propose", { ...proposal("Idea di Carlo"), registrationId: kid });
  await adminDb.doc(`${activityPath(act)}/registrations/${kid}`).update({ registrationStatus: "cancelled" });
  await waitFor(
    () => entriesOfRegistration(act, kid),
    (list) => list.every((entry) => entry.status === "withdrawn"),
    "il ritiro d'ufficio dei tentativi del figlio",
  );
  const stored = await entryData(act, challenge.entry.id);
  assert.equal(stored.withdrawnBy, "system");
  assert.equal(stored.ownerUid, parent.uid);
  await waitFor(async () => (await recordData(act, r1.record.id)).challengerCount, (count) => count === 1, "il contatore a 1");
  // Iscrizione non più attiva: nessuna azione del genitore su quei tentativi.
  await expectFail(P(parent, act, "edit", { entryId: proposed.entry.id, ...proposal("Cambio") }), "permission-denied", NOT_ENROLLED_MSG);
  await expectFail(P(parent, act, "withdraw", { entryId: proposed.entry.id }), "permission-denied", NOT_ENROLLED_MSG);
  await expectFail(P(parent, act, "restore", { entryId: challenge.entry.id }), "permission-denied", NOT_ENROLLED_MSG);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// context (partecipante): le persone per cui l'utente può agire e se è staff
// ---------------------------------------------------------------------------

test("context: ragazzo, genitore con due figli e staff senza iscrizione ricevono le persone giuste", async () => {
  const { boyA, parent, parent2, admin, superAdmin, leader, leaderOther, otherAdmin, adultLeader, adultCancelled, adultYouth, adultNoReg } = pool;
  const act = await newActivity({ members: [boyA] });
  const ctx = (client) => P(client, act, "context");
  const shape = (result) => result.people.map((person) => [person.registrationId, person.displayName, person.isSelf]);

  // Ragazzo: solo se stesso, nome di battesimo.
  const boy = await ctx(boyA);
  assert.deepEqual(Object.keys(boy).sort(), ["action", "canManageStaff", "isStaff", "ok", "people"]);
  assert.equal(boy.ok, true);
  assert.equal(boy.action, "context");
  assert.deepEqual(shape(boy), [[`user_${boyA.uid}`, "Anna", true]]);
  assert.deepEqual(Object.keys(boy.people[0]).sort(), ["displayName", "isSelf", "registrationId"]);
  assert.equal(boy.isStaff, false);
  assert.equal(boy.canManageStaff, false);

  // Genitore con due figli e nessuna propria iscrizione: i figli in ordine di nome, mai gli altrui.
  const zed = await enrollChild(act, parent, "kid1", "Zeno");
  const alberto = await enrollChild(act, parent, "kid2", "Alberto");
  await enrollChild(act, parent, "annullato", "Anullato", { registrationStatus: "cancelled" });
  await enrollChild(act, parent, "respinto", "Respinto", { registrationStatus: "rejected_by_parent" });
  await enrollChild(act, parent, "legacy", "Legacy", { status: "cancelled" });
  await enrollChild(act, parent2, "kid1", "Enrico");
  const two = await ctx(parent);
  assert.deepEqual(shape(two), [[alberto, "Alberto", false], [zed, "Zeno", false]]);
  assert.equal(two.isStaff, false);
  // L'altro genitore vede solo il suo.
  assert.deepEqual(shape(await ctx(parent2)), [[`child_${parent2.uid}_kid1`, "Enrico", false]]);

  // Con una propria iscrizione: prima la propria, poi i figli. Omonimi: nome e cognome.
  await enroll(act, parent, { fullName: "Zeno Verdi" });
  const withSelf = await ctx(parent);
  assert.deepEqual(shape(withSelf), [
    [`user_${parent.uid}`, "Zeno Verdi", true],
    [alberto, "Alberto", false],
    [zed, "Zeno Rossi", false],
  ]);

  // Iscrizione propria annullata: non compare.
  await enrollAdult(act, adultCancelled, "dirigente", { registrationStatus: "cancelled" });
  assert.deepEqual((await ctx(adultCancelled)).people, []);
  assert.equal((await ctx(adultCancelled)).isStaff, false);

  // Staff: admin, super_admin e unit_leader senza iscrizione hanno people vuoto e isStaff true;
  // canManageStaff solo per admin e super_admin.
  for (const [client, manage] of [[admin, true], [superAdmin, true], [leader, false]]) {
    const staff = await ctx(client);
    assert.deepEqual(staff.people, [], `${client.name} non è iscritto`);
    assert.equal(staff.isStaff, true, `${client.name} è staff`);
    assert.equal(staff.canManageStaff, manage, `${client.name}: canManageStaff`);
  }
  // Un dirigente iscritto NON è staff: la categoria è autodichiarata. Lo diventa solo se un admin lo mette in elenco.
  await enrollAdult(act, adultLeader, "dirigente");
  await enrollAdult(act, adultYouth, "giovane_uomo");
  const unlisted = await ctx(adultLeader);
  assert.equal(unlisted.isStaff, false);
  assert.equal(unlisted.canManageStaff, false);
  assert.deepEqual(shape(unlisted), [[`user_${adultLeader.uid}`, "Adulto", true]]);
  await A(admin, act, "setStaff", { uid: adultLeader.uid, enabled: true });
  const listed = await ctx(adultLeader);
  assert.equal(listed.isStaff, true);
  assert.equal(listed.canManageStaff, false, "chi è in elenco non sceglie lo staff");
  assert.deepEqual(shape(listed), [[`user_${adultLeader.uid}`, "Adulto", true]]);
  const youthCtx = await ctx(adultYouth);
  assert.equal(youthCtx.isStaff, false);
  assert.equal(youthCtx.people.length, 1);
  // Non staff: unit_leader/admin di un altro palo, adulto non iscritto, utente senza profilo.
  for (const client of [leaderOther, otherAdmin, adultNoReg, pool.noProfile]) {
    const result = await ctx(client);
    assert.equal(result.isStaff, false, `${client.name} non è staff`);
    assert.equal(result.canManageStaff, false);
    assert.deepEqual(result.people, []);
  }
});

test("context: sola lettura, funziona dopo la chiusura, richiede il modulo acceso e un account vero", async () => {
  const { boyA, parent, anon, signedOut } = pool;
  const act = await newActivity({ members: [boyA] });
  const kid = await enrollChild(act, parent, "kid1", "Carlo");
  const before = await adminDb.collection(`${activityPath(act)}/registrations`).get();
  await adminDb.doc(activityPath(act)).update({ recordsCloseAt: inPast(1) });
  assert.deepEqual((await P(boyA, act, "context")).people.map((person) => person.registrationId), [`user_${boyA.uid}`]);
  assert.deepEqual((await P(parent, act, "context")).people.map((person) => person.registrationId), [kid]);
  // Nessuna scrittura: né tentativi né record, né iscrizioni toccate.
  assert.equal((await entriesRef(act).get()).size, 0);
  assert.equal((await recordsRef(act).get()).size, 0);
  assert.equal((await adminDb.collection(`${activityPath(act)}/registrations`).get()).size, before.size);
  // Chiavi extra non ammesse.
  await expectFail(boyA.participantFn({ stakeId, activityId: act, action: "context", registrationId: kid }), "invalid-argument");
  await expectFail(P(boyA, act, "context", { entryId: "x" }), "invalid-argument");
  // Modulo spento o attività inesistente.
  await expectFail(P(anon, act, "context"), "permission-denied");
  await expectFail(P(signedOut, act, "context"), "unauthenticated");
  await expectFail(P(boyA, "attivita-che-non-esiste", "context"), "not-found");
  await adminDb.doc(activityPath(act)).update({ recordsEnabled: false });
  await expectFail(P(boyA, act, "context"), "failed-precondition", /non è attiva/u);
  const off = await newActivity({ members: [boyA], enabled: "absent" });
  await expectFail(P(boyA, off, "context"), "failed-precondition", /non è attiva/u);
});

// ---------------------------------------------------------------------------
// listParticipants (staff): solo quattro campi, solo iscrizioni attive user_/child_
// ---------------------------------------------------------------------------

test("listParticipants: solo registrationId, name, unitName, isAdult; niente guest_ né annullate; nessun dato personale", async () => {
  const { boyA, boyB, parent, admin, leader, adultLeader, adultCompanion, adultCancelled, legacyCancelled } = pool;
  const sensitive = {
    phone: "3331112222",
    email: "segreto@example.invalid",
    medicalNotes: "allergia agli arachidi",
    birthDate: "2010-04-05",
    parentEmail: "genitore-segreto@example.invalid",
    emergencyContacts: [{ name: "Zio Segreto", phone: "3339998888" }],
    fiscalCode: "RSSMRA10D05H501X",
  };
  const act = await newActivity();
  await enroll(act, boyA, { ...sensitive, unitName: "Rione Primo", userId: boyA.uid });
  await enroll(act, boyB, { ...sensitive, unitNameSnapshot: "Rione Secondo (copia)" });
  const kid = await enrollChild(act, parent, "kid1", "Carlo", { ...sensitive, unitName: "Rione Primo" });
  await enrollAdult(act, adultLeader, "dirigente", { ...sensitive });
  await enrollAdult(act, adultCompanion, "accompagnatore");
  // Esclusi: annullate (nuovo e vecchio campo), respinte, ospiti.
  await enrollAdult(act, adultCancelled, "dirigente", { registrationStatus: "cancelled" });
  await enrollAdult(act, legacyCancelled, "dirigente", { status: "cancelled" });
  await enrollChild(act, parent, "respinto", "Respinto", { registrationStatus: "rejected_by_parent" });
  await adminDb.doc(`${activityPath(act)}/registrations/guest_ospite`).set({ fullName: "Ospite Esterno", anonymousUid: "ospite", registrationStatus: "submitted", ...sensitive });
  await adminDb.doc(`${activityPath(act)}/registrations/altro_xyz`).set({ fullName: "Id Strano", registrationStatus: "confirmed" });

  const result = await A(admin, act, "listParticipants");
  assert.deepEqual(Object.keys(result).sort(), ["action", "ok", "participants"]);
  assert.equal(result.ok, true);
  assert.equal(result.action, "listParticipants");
  const ids = result.participants.map((item) => item.registrationId).sort();
  assert.deepEqual(ids, [`user_${boyA.uid}`, `user_${boyB.uid}`, kid, `user_${adultLeader.uid}`, `user_${adultCompanion.uid}`].sort());
  for (const item of result.participants) {
    assert.deepEqual(Object.keys(item).sort(), ["isAdult", "name", "registrationId", "unitName"], `campi di ${item.registrationId}`);
    assert.equal(typeof item.name, "string");
    assert.equal(typeof item.unitName, "string");
    assert.equal(typeof item.isAdult, "boolean");
  }
  const byId = Object.fromEntries(result.participants.map((item) => [item.registrationId, item]));
  assert.equal(byId[`user_${boyA.uid}`].name, PEOPLE.boyA);
  assert.equal(byId[`user_${boyA.uid}`].unitName, "Rione Primo");
  assert.equal(byId[`user_${boyB.uid}`].unitName, "Rione Secondo (copia)", "unitNameSnapshot se manca unitName");
  assert.equal(byId[kid].name, "Carlo Rossi");
  assert.equal(byId[kid].isAdult, false);
  assert.equal(byId[`user_${adultLeader.uid}`].isAdult, true);
  assert.equal(byId[`user_${adultCompanion.uid}`].isAdult, true);
  assert.equal(byId[`user_${adultCompanion.uid}`].unitName, "", "senza unità: stringa vuota");
  assert.equal(byId[`user_${boyA.uid}`].isAdult, false);
  // Ordinati per nome.
  const names = result.participants.map((item) => item.name);
  assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right, "it-IT")));
  // Nessun dato personale in nessun punto della risposta.
  const serialized = JSON.stringify(result);
  for (const value of ["3331112222", "segreto@example.invalid", "arachidi", "2010-04-05", "Zio Segreto", "RSSMRA10D05H501X", "Ospite Esterno", "Id Strano", "parentUid", "medicalNotes"]) {
    assert.ok(!serialized.includes(value), `la risposta contiene «${value}»`);
  }

  // Gli altri tipi di staff vedono la stessa lista; i parametri extra non sono ammessi.
  await A(admin, act, "setStaff", { uid: adultCompanion.uid, enabled: true });
  for (const client of [leader, adultCompanion]) {
    const same = await A(client, act, "listParticipants");
    assert.deepEqual(same.participants, result.participants, `${client.name} deve vedere la stessa lista`);
  }
  await expectFail(admin.adminFn({ stakeId, activityId: act, action: "listParticipants", registrationId: kid }), "invalid-argument");
  // Nessuna scrittura.
  assert.equal((await entriesRef(act).get()).size, 0);
  assert.equal((await recordsRef(act).get()).size, 0);
  // Attività vuota.
  const empty = await newActivity();
  assert.deepEqual((await A(admin, empty, "listParticipants")).participants, []);
});

// ---------------------------------------------------------------------------
// withdrawnBy: chi ha ritirato
// ---------------------------------------------------------------------------

test("withdrawnBy: self, staff, system; nessun valore sui tentativi non ritirati e dopo il ripristino", async () => {
  const { boyA, boyB, boyC, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC] });
  const r1 = await makeRecord(act, boyA, "Record di Anna");
  const b = await P(boyB, act, "challenge", { recordId: r1.record.id });
  const c = await P(boyC, act, "challenge", { recordId: r1.record.id });
  for (const entry of [r1.entry, b.entry, c.entry]) assert.equal((await entryData(act, entry.id)).withdrawnBy ?? null, null);

  const bySelf = await P(boyB, act, "withdraw", { entryId: b.entry.id });
  assert.equal(bySelf.entry.withdrawnBy, "self");
  assert.equal(bySelf.entry.statusBeforeWithdraw, "approved");
  const restored = await P(boyB, act, "restore", { entryId: b.entry.id });
  assert.equal(restored.entry.withdrawnBy ?? null, null, "dopo l'annulla non resta traccia del ritiro");
  assert.equal(restored.entry.statusBeforeWithdraw ?? null, null);

  const byStaff = await A(admin, act, "withdrawEntry", { entryId: c.entry.id });
  assert.equal(byStaff.entry.withdrawnBy, "staff");
  assert.equal(byStaff.entry.statusBeforeWithdraw, null);
  assert.equal(byStaff.entry.withdrawnWithRecordHide ?? false, false, "ritiro puntuale dello staff: non per record nascosto");

  const hidden = await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record di Anna"), status: "hidden" });
  assert.equal(hidden.withdrawnCount, 2);
  for (const entry of [r1.entry, b.entry]) {
    const stored = await entryData(act, entry.id);
    assert.equal(stored.withdrawnBy, "staff");
    assert.equal(stored.withdrawnWithRecordHide, true);
    assert.equal(stored.statusBeforeWithdraw, null);
  }
  // Il ritiro puntuale dello staff non porta il flag, quindi mostrando il record c non torna.
  const shown = await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record di Anna"), status: "open" });
  assert.equal(shown.restoredCount, 2);
  assert.equal((await entryData(act, c.entry.id)).status, "withdrawn");
  assert.equal((await entryData(act, c.entry.id)).withdrawnBy, "staff");

  // Ritiro d'ufficio: iscrizione annullata.
  await adminDb.doc(`${activityPath(act)}/registrations/user_${boyB.uid}`).update({ registrationStatus: "cancelled" });
  await waitFor(async () => (await entryData(act, b.entry.id)).status, (status) => status === "withdrawn", "il ritiro d'ufficio");
  assert.equal((await entryData(act, b.entry.id)).withdrawnBy, "system");
  assert.equal((await entryData(act, b.entry.id)).statusBeforeWithdraw, null);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Nascondere e mostrare un record con iscritti
// ---------------------------------------------------------------------------

test("nascondere ritira gli iscritti e azzera il contatore; mostrare rimette chi può e conta chi resta fuori", async () => {
  const { boyA, boyB, boyC, boyD, boyE, boyF, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyD, boyE, boyF] });
  const r1 = await makeRecord(act, boyA, "Record conteso");
  const r2 = await makeRecord(act, boyF, "Record altrove");
  const entries = {};
  for (const [name, client] of [["B", boyB], ["C", boyC], ["D", boyD], ["E", boyE]]) {
    entries[name] = (await P(client, act, "challenge", { recordId: r1.record.id })).entry;
  }
  entries.A = r1.entry;
  const bOnR2 = await P(boyB, act, "challenge", { recordId: r2.record.id });
  const fPending = await P(boyF, act, "propose", proposal("Idea in attesa di Fiora"));
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 5);

  const hide = (extra = {}) => A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record conteso"), status: "hidden", ...extra });
  const show = () => A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record conteso"), status: "open" });
  const hidden = await hide();
  assert.equal(hidden.withdrawnCount, 5);
  assert.equal(hidden.restoredCount, 0);
  assert.equal(hidden.notRestoredCount, 0);
  assert.equal(hidden.record.status, "hidden");
  assert.equal(hidden.record.challengerCount, 0);
  for (const entry of Object.values(entries)) {
    const stored = await entryData(act, entry.id);
    assert.equal(stored.status, "withdrawn", entry.id);
    assert.equal(stored.withdrawnBy, "staff");
    assert.equal(stored.withdrawnWithRecordHide, true);
    assert.equal(stored.statusBeforeWithdraw, null);
  }
  // Non toccati: la proposta in attesa e la sfida di B su un altro record, e il suo contatore.
  assert.equal((await entryData(act, fPending.entry.id)).status, "pending");
  assert.equal((await entryData(act, bOnR2.entry.id)).status, "approved");
  assert.equal((await recordData(act, r2.record.id)).challengerCount, 2);
  // Ripetuto: nessun altro ritiro.
  const again = await hide();
  assert.equal(again.withdrawnCount, 0);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 0);

  // Mentre è nascosto: B riempie il limite (sfida su r2 + una proposta), C annulla l'iscrizione.
  await P(boyB, act, "propose", proposal("Seconda idea di Bruno"));
  await adminDb.doc(`${activityPath(act)}/registrations/user_${boyC.uid}`).update({ registrationStatus: "cancelled" });

  const shown = await show();
  assert.equal(shown.restoredCount, 3, "tornano A, D ed E");
  assert.equal(shown.notRestoredCount, 2, "restano fuori B (limite di 2) e C (iscrizione annullata)");
  assert.equal(shown.withdrawnCount, 0);
  assert.equal(shown.record.status, "open");
  assert.equal(shown.record.challengerCount, 3);
  for (const name of ["A", "D", "E"]) {
    const stored = await entryData(act, entries[name].id);
    assert.equal(stored.status, "approved", name);
    assert.equal(stored.recordId, r1.record.id);
    assert.equal(stored.withdrawnBy ?? null, null);
    assert.equal(stored.withdrawnWithRecordHide, false);
  }
  for (const name of ["B", "C"]) {
    const stored = await entryData(act, entries[name].id);
    assert.equal(stored.status, "withdrawn", name);
    assert.equal(stored.statusBeforeWithdraw, null, `${name}: nessun «Annulla»`);
    assert.equal(stored.withdrawnWithRecordHide, false, `${name}: la decisione è presa, il flag si spegne`);
  }
  // Mostrare di nuovo un record già visibile non cambia nulla.
  const noop = await show();
  assert.equal(noop.restoredCount, 0);
  assert.equal(noop.notRestoredCount, 0);
  assert.equal(noop.record.challengerCount, 3);
  // Nascondi e mostra ancora: tornano solo i tre rimessi, non quelli rimasti fuori.
  assert.equal((await hide()).withdrawnCount, 3);
  const secondShow = await show();
  assert.equal(secondShow.restoredCount, 3);
  assert.equal(secondShow.notRestoredCount, 0);
  assert.equal(secondShow.record.challengerCount, 3);
  await assertConsistent(act);
});

test("mostrare un record non rimette chi nel frattempo ha riempito il proprio limite di 2", async () => {
  const { boyA, boyB, boyC, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC] });
  const r1 = await makeRecord(act, boyA, "Record uno");
  const bEntry = (await P(boyB, act, "challenge", { recordId: r1.record.id })).entry;
  await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record uno"), status: "hidden" });
  // B, ora libero, prende altri due posti su altri record: il suo ritiro d'ufficio non rientra più.
  const r2 = await makeRecord(act, boyC, "Record due");
  const r3 = await makeRecord(act, boyC, "Record tre");
  await P(boyB, act, "challenge", { recordId: r2.record.id });
  await P(boyB, act, "challenge", { recordId: r3.record.id });
  const shown = await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record uno"), status: "open" });
  assert.equal(shown.restoredCount, 1, "torna solo A");
  assert.equal(shown.notRestoredCount, 1);
  assert.equal((await entryData(act, bEntry.id)).status, "withdrawn");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Riportare in attesa l'approvazione che ha creato il record
// ---------------------------------------------------------------------------

test("reopen dell'approvazione che ha creato il record: se resta vuoto lo nasconde e una nuova approvazione ne crea uno nuovo", async () => {
  const { boyA, boyB, boyC, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC] });
  const recordsPath = `${activityPath(act)}/records`;
  const visibleToBoys = async (client) =>
    (await getDocsFromServer(query(collection(client.firestore, recordsPath), where("status", "==", "open")))).docs.map((item) => item.id);

  const proposed = await P(boyA, act, "propose", proposal("Equilibrio sulla sedia"));
  const approved = await A(admin, act, "approve", { entryId: proposed.entry.id, ...recordInput("Equilibrio su una sedia") });
  const first = approved.record.id;
  assert.equal(approved.record.createdFromEntryId, proposed.entry.id);
  assert.equal((await recordData(act, first)).createdFromEntryId, proposed.entry.id);
  assert.deepEqual(await visibleToBoys(boyB), [first]);

  const reopened = await A(admin, act, "reopen", { entryId: proposed.entry.id });
  assert.equal(reopened.entry.status, "pending");
  assert.equal(reopened.record.id, first);
  assert.equal(reopened.record.challengerCount, 0);
  assert.equal(reopened.record.status, "hidden", "resta vuoto: il titolo non deve restare leggibile al palo");
  assert.equal((await recordData(act, first)).status, "hidden");
  assert.deepEqual(await visibleToBoys(boyB), [], "i membri non leggono più il record vuoto");
  await expectFail(P(boyB, act, "challenge", { recordId: first }), "failed-precondition");
  await expectFail(A(admin, act, "addParticipant", { recordId: first, registrationId: `user_${boyB.uid}` }), "failed-precondition");

  // Una nuova approvazione crea un record nuovo: nessun doppione visibile.
  const second = await A(admin, act, "approve", { entryId: proposed.entry.id, ...recordInput("Equilibrio su una sedia (bis)") });
  assert.notEqual(second.record.id, first);
  assert.equal(second.record.createdFromEntryId, proposed.entry.id);
  assert.deepEqual(await visibleToBoys(boyB), [second.record.id]);
  assert.equal((await recordData(act, first)).status, "hidden");

  // Se qualcun altro c'è già, riportare in attesa non nasconde il record.
  const challenge = await P(boyB, act, "challenge", { recordId: second.record.id });
  const kept = await A(admin, act, "reopen", { entryId: proposed.entry.id });
  assert.equal(kept.record.challengerCount, 1);
  assert.equal(kept.record.status, "open");
  assert.deepEqual(await visibleToBoys(boyC), [second.record.id]);
  // Se poi anche l'ultimo si ritira, il record resta open a zero (si nasconde solo al «Riporta in attesa»).
  await P(boyB, act, "withdraw", { entryId: challenge.entry.id });
  assert.equal((await recordData(act, second.record.id)).status, "open");
  assert.equal((await recordData(act, second.record.id)).challengerCount, 0);

  // Unito a un record altrui: riportare in attesa non nasconde nulla (il record non nasce da quell'approvazione).
  const owner = await P(boyB, act, "propose", proposal("Altra idea di Bruno"));
  const base = await A(admin, act, "approve", { entryId: owner.entry.id, ...recordInput("Record di Bruno") });
  const joiner = await P(boyC, act, "propose", proposal("Idea simile di Carlo"));
  await A(admin, act, "merge", { entryId: joiner.entry.id, recordId: base.record.id });
  const unmerged = await A(admin, act, "reopen", { entryId: joiner.entry.id });
  assert.equal(unmerged.record.status, "open");
  assert.equal(unmerged.record.challengerCount, 1);
  // Ora riporta in attesa anche chi l'ha creato: vuoto, nascosto.
  const gone = await A(admin, act, "reopen", { entryId: owner.entry.id });
  assert.equal(gone.record.status, "hidden");
  assert.equal(gone.record.challengerCount, 0);
  await assertConsistent(act);
});

test("un record creato con «Nuovo record» non si nasconde mai da solo", async () => {
  const { boyA, admin } = pool;
  const act = await newActivity({ members: [boyA] });
  const created = await A(admin, act, "createRecord", recordInput("Record dello staff"));
  assert.equal((await recordData(act, created.record.id)).createdFromEntryId, null);
  const added = await A(admin, act, "addParticipant", { recordId: created.record.id, registrationId: `user_${boyA.uid}` });
  await A(admin, act, "withdrawEntry", { entryId: added.entry.id });
  const stored = await recordData(act, created.record.id);
  assert.equal(stored.status, "open");
  assert.equal(stored.challengerCount, 0);
});

// ---------------------------------------------------------------------------
// restore verso pending: niente proposte identiche attive
// ---------------------------------------------------------------------------

test("restore: una proposta ritirata non torna in attesa se ne esiste una identica già attiva", async () => {
  const { boyA, parent } = pool;
  const act = await newActivity({ members: [boyA] });
  const p1 = await P(boyA, act, "propose", proposal("Torre di bicchieri"));
  await P(boyA, act, "withdraw", { entryId: p1.entry.id });
  const p2 = await P(boyA, act, "propose", proposal("  torre di BICCHIERI "));
  await expectFail(P(boyA, act, "restore", { entryId: p1.entry.id }), "failed-precondition", DUPLICATE_MSG);
  const stuck = await entryData(act, p1.entry.id);
  assert.equal(stuck.status, "withdrawn");
  assert.equal(stuck.statusBeforeWithdraw, "pending", "il ritiro resta annullabile quando l'altra proposta sparisce");
  assert.equal(stuck.withdrawnBy, "self");
  // Liberato il posto, si ripristina.
  await P(boyA, act, "withdraw", { entryId: p2.entry.id });
  assert.equal((await P(boyA, act, "restore", { entryId: p1.entry.id })).entry.status, "pending");
  // Stessa frase ma durata diversa: è un'altra proposta, non blocca (se il limite lo consente).
  const q1 = await P(boyA, act, "propose", proposal("Altra idea"));
  await P(boyA, act, "withdraw", { entryId: q1.entry.id });
  const q2 = await P(boyA, act, "propose", proposal("Altra idea", { durationSeconds: 30 }));
  await expectFail(P(boyA, act, "restore", { entryId: q1.entry.id }), "failed-precondition", LIMIT_MSG);
  await P(boyA, act, "withdraw", { entryId: p1.entry.id });
  assert.equal((await P(boyA, act, "restore", { entryId: q1.entry.id })).entry.status, "pending");
  assert.ok(q2.entry.id);
  // Vale anche per i figli: la regola è per iscrizione.
  const kid = await enrollChild(act, parent, "kid1", "Carlo");
  const k1 = await P(parent, act, "propose", { ...proposal("Salti"), registrationId: kid });
  await P(parent, act, "withdraw", { entryId: k1.entry.id });
  await P(parent, act, "propose", { ...proposal("Salti"), registrationId: kid });
  await expectFail(P(parent, act, "restore", { entryId: k1.entry.id }), "failed-precondition", DUPLICATE_MSG);
  // La stessa proposta di un'altra iscrizione (il genitore stesso) non blocca.
  await enroll(act, parent, { fullName: "Genitore Prova" });
  await P(parent, act, "propose", proposal("Salti"));
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// Iscrizioni inserite da un admin, senza account: manual_<...>
// ---------------------------------------------------------------------------

async function enrollManual(activityId, id, firstName, lastName, extra = {}) {
  await adminDb.doc(`${activityPath(activityId)}/registrations/${id}`).set({
    firstName,
    lastName,
    registrationStatus: "confirmed",
    genderRoleCategory: "giovane_uomo",
    unitName: "Roma 5",
    ...extra,
  });
  return id;
}

test("manual_: listParticipants le include se attive (non le annullate); listStaff no", async () => {
  const { boyA, parent, admin, superAdmin, leader } = pool;
  const act = await newActivity({ members: [boyA] });
  const paolo = await enrollManual(act, "manual_paolo_celestini_roma5", "Paolo", "Celestini", { phone: "3331112222", medicalNotes: "allergia" });
  const anna = await enrollManual(act, "manual_anna_rossi_roma5", "Anna", "Rossi", { genderRoleCategory: "dirigente", unitNameSnapshot: "ignorato", unitName: "" });
  await enrollManual(act, "manual_ex_iscritto_roma5", "Ex", "Iscritto", { registrationStatus: "cancelled" });
  await enrollManual(act, "manual_vecchio_roma5", "Vecchio", "Campo", { status: "cancelled" });
  await enrollManual(act, "manual_respinto_roma5", "Respinto", "Dal Genitore", { registrationStatus: "rejected_by_parent" });
  await enrollChild(act, parent, "kid1", "Carlo");

  for (const client of [admin, superAdmin, leader]) {
    const { participants } = await A(client, act, "listParticipants");
    const ids = participants.map((item) => item.registrationId).sort();
    assert.deepEqual(ids, [`user_${boyA.uid}`, `child_${parent.uid}_kid1`, paolo, anna].sort(), `${client.name}: manual_ attive sì, annullate no`);
    for (const item of participants) assert.deepEqual(Object.keys(item).sort(), ["isAdult", "name", "registrationId", "unitName"]);
    const byId = Object.fromEntries(participants.map((item) => [item.registrationId, item]));
    assert.equal(byId[paolo].name, "Paolo Celestini");
    assert.equal(byId[paolo].unitName, "Roma 5");
    assert.equal(byId[paolo].isAdult, false);
    assert.equal(byId[anna].isAdult, true);
    assert.ok(!JSON.stringify(participants).includes("3331112222") && !JSON.stringify(participants).includes("allergia"), "nessun dato personale");
  }
  // listStaff: solo iscrizioni user_ (una manual_ non ha un account da mettere in staff).
  const { candidates } = await A(admin, act, "listStaff");
  assert.deepEqual(candidates.map((item) => item.registrationId), [`user_${boyA.uid}`]);
  assert.ok(!candidates.some((item) => item.registrationId.startsWith("manual_")));
  // setStaff non ha un uid a cui agganciarsi.
  await expectFail(A(admin, act, "setStaff", { uid: "manual_paolo_celestini_roma5", enabled: true }), "failed-precondition", /iscrizione attiva/u);
  // context: nessuno agisce per una manual_.
  assert.deepEqual((await P(boyA, act, "context")).people.map((person) => person.registrationId), [`user_${boyA.uid}`]);
});

test("manual_: staff addParticipant crea un tentativo approved senza titolare; limite di 2 e unicità valgono; ritiro staff", async () => {
  const { boyA, boyB, admin, leader } = pool;
  const act = await newActivity({ members: [boyA, boyB] });
  const paolo = await enrollManual(act, "manual_paolo_celestini_roma5", "Paolo", "Celestini");
  const r1 = await makeRecord(act, boyA, "Record uno");
  const r2 = await makeRecord(act, boyB, "Record due");
  const r3 = await makeRecord(act, boyA, "Record tre");
  const entriesPath = `${activityPath(act)}/recordEntries`;

  const added = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: paolo });
  assert.equal(added.ok, true);
  assert.equal(added.entry.status, "approved");
  assert.equal(added.entry.kind, "challenge");
  assert.equal(added.entry.ownerUid, null, "senza account: nessun titolare");
  assert.equal(added.entry.registrationId, paolo);
  assert.equal(added.entry.participantName, "Paolo Celestini");
  assert.equal(added.entry.createdByAdmin, true);
  assert.equal(added.entry.decidedBy, admin.uid);
  assert.equal(added.record.challengerCount, 2, "il contatore sale");
  const stored = await entryData(act, added.entry.id);
  assert.equal(stored.ownerUid, null);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  // Lo vede lo staff con il nome; nessun ragazzo (ownerUid null: nemmeno con la query where ownerUid == null).
  assert.ok((await getDocsFromServer(collection(admin.firestore, entriesPath))).docs.some((item) => item.id === added.entry.id));
  await assert.rejects(getDocsFromServer(query(collection(boyA.firestore, entriesPath), where("ownerUid", "==", null))), /permission|insufficient/iu);
  await assert.rejects(getDocFromServer(doc(boyA.firestore, `${entriesPath}/${added.entry.id}`)), /permission|insufficient/iu);

  // Unicità: la stessa manual_ non entra due volte nello stesso record.
  await expectFail(A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: paolo }), "failed-precondition", ADMIN_ALREADY_MSG);
  // Limite di 2: il secondo record passa, il terzo no; lo stesso vale per un altro staff.
  const second = await A(leader, act, "addParticipant", { recordId: r2.record.id, registrationId: paolo });
  assert.equal(second.record.challengerCount, 2);
  await expectFail(A(admin, act, "addParticipant", { recordId: r3.record.id, registrationId: paolo }), "failed-precondition", ADMIN_LIMIT_MSG);
  assert.equal((await recordData(act, r3.record.id)).challengerCount, 1);
  assert.equal((await entriesOfRegistration(act, paolo)).length, 2);

  // Nessun utente, nemmeno lo staff come partecipante, agisce per una manual_ con propose/challenge.
  for (const client of [boyA, boyB, pool.parent, admin, leader]) {
    await expectFail(P(client, act, "propose", { ...proposal("Idea per Paolo"), registrationId: paolo }), "permission-denied", "Non puoi agire per questa iscrizione.");
    await expectFail(P(client, act, "challenge", { recordId: r3.record.id, registrationId: paolo }), "permission-denied", "Non puoi agire per questa iscrizione.");
  }
  // Senza titolare, i tentativi della manual_ non si modificano né ritirano né ripristinano da un account.
  for (const client of [boyA, admin]) {
    for (const action of ["withdraw", "restore"]) await expectFail(P(client, act, action, { entryId: added.entry.id }), "not-found");
    await expectFail(P(client, act, "edit", { entryId: added.entry.id, ...proposal("Presa") }), "not-found");
  }
  assert.equal((await entriesOfRegistration(act, paolo)).length, 2, "nessun tentativo in più");
  assert.equal((await entryData(act, added.entry.id)).status, "approved");

  // Il ritiro dello staff funziona e non ha «Annulla».
  const removed = await A(admin, act, "withdrawEntry", { entryId: added.entry.id });
  assert.equal(removed.entry.status, "withdrawn");
  assert.equal(removed.entry.withdrawnBy, "staff");
  assert.equal(removed.entry.statusBeforeWithdraw, null);
  assert.equal(removed.record.challengerCount, 1);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
  const again = await A(admin, act, "withdrawEntry", { entryId: added.entry.id });
  assert.equal(again.entry.status, "withdrawn");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1, "ripetuto: nessun secondo decremento");
  // Liberato un posto, lo staff può iscriverla al terzo record (e di nuovo al primo).
  assert.equal((await A(admin, act, "addParticipant", { recordId: r3.record.id, registrationId: paolo })).record.challengerCount, 2);
  await assertConsistent(act);
});

test("manual_: annullata o eliminata, il trigger ritira i suoi tentativi e scala i contatori; non si iscrive più", async () => {
  const { boyA, admin } = pool;
  for (const [label, apply] of [
    ["registrationStatus cancelled", (ref) => ref.update({ registrationStatus: "cancelled" })],
    ["registrationStatus rejected_by_parent", (ref) => ref.update({ registrationStatus: "rejected_by_parent" })],
    ["iscrizione eliminata", (ref) => ref.delete()],
  ]) {
    const act = await newActivity({ members: [boyA] });
    const manual = await enrollManual(act, "manual_anna_rossi_roma5", "Anna", "Rossi");
    const other = await enrollManual(act, "manual_bruno_neri_roma5", "Bruno", "Neri");
    const r1 = await makeRecord(act, boyA, "Record uno");
    const r2 = await makeRecord(act, boyA, "Record due");
    const first = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: manual });
    const second = await A(admin, act, "addParticipant", { recordId: r2.record.id, registrationId: manual });
    const kept = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: other });
    assert.equal((await recordData(act, r1.record.id)).challengerCount, 3, label);

    await apply(adminDb.doc(`${activityPath(act)}/registrations/${manual}`));
    await waitFor(
      () => entriesOfRegistration(act, manual),
      (list) => list.length === 2 && list.every((entry) => entry.status === "withdrawn"),
      `il ritiro d'ufficio dei tentativi della manual_ (${label})`,
    );
    for (const entry of [first.entry, second.entry]) {
      const stored = await entryData(act, entry.id);
      assert.equal(stored.withdrawnBy, "system", label);
      assert.equal(stored.statusBeforeWithdraw, null, label);
    }
    await waitFor(async () => (await recordData(act, r1.record.id)).challengerCount, (count) => count === 2, `il contatore di r1 a 2 (${label})`);
    assert.equal((await recordData(act, r2.record.id)).challengerCount, 1, label);
    assert.equal((await entryData(act, kept.entry.id)).status, "approved", "gli altri non si toccano");
    // Non più iscrivibile e non più nell'elenco.
    const afterDelete = label === "iscrizione eliminata";
    await expectFail(
      A(admin, act, "addParticipant", { recordId: r2.record.id, registrationId: manual }),
      afterDelete ? "not-found" : "failed-precondition",
    );
    assert.ok(!(await A(admin, act, "listParticipants")).participants.some((item) => item.registrationId === manual), label);
    assert.ok((await A(admin, act, "listParticipants")).participants.some((item) => item.registrationId === other), label);
    await assertConsistent(act);
  }
});

test("manual_: nascondere un record ritira anche chi non ha account e mostrarlo lo rimette", async () => {
  const { boyA, admin } = pool;
  const act = await newActivity({ members: [boyA] });
  const paolo = await enrollManual(act, "manual_paolo_celestini_roma5", "Paolo", "Celestini");
  const r1 = await makeRecord(act, boyA, "Record uno");
  const added = await A(admin, act, "addParticipant", { recordId: r1.record.id, registrationId: paolo });
  const hidden = await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record uno"), status: "hidden" });
  assert.equal(hidden.withdrawnCount, 2);
  assert.equal((await entryData(act, added.entry.id)).withdrawnBy, "staff");
  const shown = await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record uno"), status: "open" });
  assert.equal(shown.restoredCount, 2);
  assert.equal(shown.record.challengerCount, 2);
  assert.equal((await entryData(act, added.entry.id)).status, "approved");
  assert.equal((await entryData(act, added.entry.id)).ownerUid, null);
  await assertConsistent(act);
});
