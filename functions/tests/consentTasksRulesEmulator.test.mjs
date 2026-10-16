// Rules di stakes/{s}/activities/{a}/consentTasks (compiti "controlla album e social"
// dopo la revoca di un consenso). Li crea solo la callable parentConsentUpdate
// (Admin SDK); l'admin del palo li legge e cambia soltanto status/doneAt/doneByUid.
// Provate con l'SDK client e utenti veri (token mock dell'emulatore), con le stesse
// operazioni del client: getDoc/getDocs per leggere, updateDoc per spuntare e
// riaprire un compito. L'Admin SDK serve solo per seminare perché ignora le rules.
//
// Rilancio dalla radice del repository (solo Firestore, porta 8180):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-consent-tasks-rules \
//     'node --test --test-concurrency=1 functions/tests/consentTasksRulesEmulator.test.mjs'
// Con la porta occupata da un'altra sessione non fermarla: copia la config su una
// porta diversa in un file temporaneo (il test legge l'host da FIRESTORE_EMULATOR_HOST)
// e rimuovilo a fine prova.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):\d+$/u, "Firestore Emulator locale richiesto");
const [emulatorHost, emulatorPort] = FIRESTORE_HOST.split(":");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `consent-tasks-${runId}`;
const activityPath = `stakes/${stakeId}/activities/gita`;
const uid = (name) => `${name}-${runId}`;
const SEEDED_USERS = ["admin", "super", "other-admin", "leader", "parent", "youth"];

const ACTORS = [
  ["admin", "admin", "password"],
  ["superAdmin", "super", "password"],
  ["otherAdmin", "other-admin", "password"],
  ["unitLeader", "leader", "password"],
  ["parent", "parent", "password"],
  ["participant", "youth", "password"],
  ["anonymous", "anon", "anonymous"],
  ["signedOut", null, null],
];
const clients = {};

const taskRef = (firestore, id) => doc(firestore, `${activityPath}/consentTasks/${id}`);
const tasks = (firestore) => collection(firestore, `${activityPath}/consentTasks`);
const DONE_AT = "2026-10-16T12:00:00.000Z";
const todoTask = (id) => ({
  id,
  stakeId,
  activityId: "gita",
  registrationId: "iscrizione-1",
  participantName: "Figlio Test",
  kind: "photo_consent_revoked",
  title: "Consenso foto revocato per Figlio Test: controlla album e social",
  status: "todo",
  createdAt: "2026-10-16T10:00:00.000Z",
  doneAt: null,
  doneByUid: null,
});

/** Prepara un compito `todo` (o `done` di chi lo ha spuntato) e restituisce il suo id. */
let counter = 0;
async function seedTask(status = "todo") {
  counter += 1;
  const id = `compito-${counter}`;
  const base = todoTask(id);
  await adminDb.doc(`${activityPath}/consentTasks/${id}`).set(
    status === "done" ? { ...base, status: "done", doneAt: DONE_AT, doneByUid: uid("admin") } : base,
  );
  return id;
}

// [descrizione, attore, consentito, stato iniziale del compito, operazione con la stessa forma del client]
const CASES = [
  // Lettura: getDoc di un compito e getDocs dell'elenco dell'attività.
  ["admin del palo legge un compito", "admin", true, "todo", (db, id) => getDocFromServer(taskRef(db, id))],
  ["admin del palo elenca i compiti", "admin", true, "todo", (db) => getDocsFromServer(tasks(db))],
  ["super_admin legge un compito", "superAdmin", true, "todo", (db, id) => getDocFromServer(taskRef(db, id))],
  ["super_admin elenca i compiti", "superAdmin", true, "todo", (db) => getDocsFromServer(tasks(db))],
  ["admin di un altro palo non legge un compito", "otherAdmin", false, "todo", (db, id) => getDocFromServer(taskRef(db, id))],
  ["admin di un altro palo non elenca i compiti", "otherAdmin", false, "todo", (db) => getDocsFromServer(tasks(db))],
  ["dirigente di unità non legge un compito", "unitLeader", false, "todo", (db, id) => getDocFromServer(taskRef(db, id))],
  ["dirigente di unità non elenca i compiti", "unitLeader", false, "todo", (db) => getDocsFromServer(tasks(db))],
  ["genitore non legge un compito", "parent", false, "todo", (db, id) => getDocFromServer(taskRef(db, id))],
  ["genitore non elenca i compiti", "parent", false, "todo", (db) => getDocsFromServer(tasks(db))],
  ["partecipante non legge un compito", "participant", false, "todo", (db, id) => getDocFromServer(taskRef(db, id))],
  ["partecipante non elenca i compiti", "participant", false, "todo", (db) => getDocsFromServer(tasks(db))],
  ["anonimo non legge un compito", "anonymous", false, "todo", (db, id) => getDocFromServer(taskRef(db, id))],
  ["anonimo non elenca i compiti", "anonymous", false, "todo", (db) => getDocsFromServer(tasks(db))],
  ["utente non autenticato non legge un compito", "signedOut", false, "todo", (db, id) => getDocFromServer(taskRef(db, id))],
  ["utente non autenticato non elenca i compiti", "signedOut", false, "todo", (db) => getDocsFromServer(tasks(db))],

  // Aggiornamento: spuntare e riaprire.
  ["admin segna fatto (doneAt stringa, doneByUid proprio)", "admin", true, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: uid("admin") })],
  ["admin con doneAt = new Date().toISOString() segna fatto", "admin", true, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: new Date().toISOString(), doneByUid: uid("admin") })],
  ["super_admin segna fatto con il proprio uid", "superAdmin", true, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: uid("super") })],
  ["admin riapre un compito fatto (doneAt e doneByUid null)", "admin", true, "done", (db, id) =>
    updateDoc(taskRef(db, id), { status: "todo", doneAt: null, doneByUid: null })],
  ["admin non segna fatto con doneByUid di un altro", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: uid("other-admin") })],
  ["admin non segna fatto con doneByUid null", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: null })],
  ["admin non segna fatto senza doneAt", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneByUid: uid("admin") })],
  ["admin non segna fatto con doneAt null", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: null, doneByUid: uid("admin") })],
  ["admin non segna fatto con doneAt numerico", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: Date.now(), doneByUid: uid("admin") })],
  ["admin non segna fatto con doneAt Timestamp", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: Timestamp.now(), doneByUid: uid("admin") })],
  ["admin non segna fatto con doneAt serverTimestamp", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: serverTimestamp(), doneByUid: uid("admin") })],
  ["admin non riapre lasciando doneAt valorizzato", "admin", false, "done", (db, id) =>
    updateDoc(taskRef(db, id), { status: "todo", doneAt: DONE_AT, doneByUid: null })],
  ["admin non riapre lasciando doneByUid valorizzato", "admin", false, "done", (db, id) =>
    updateDoc(taskRef(db, id), { status: "todo", doneAt: null, doneByUid: uid("admin") })],
  ["admin non riapre senza azzerare doneAt e doneByUid", "admin", false, "done", (db, id) =>
    updateDoc(taskRef(db, id), { status: "todo" })],
  ["admin non usa uno stato fuori elenco (archived)", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "archived" })],
  ["admin non usa uno stato fuori elenco (cancelled)", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "cancelled", doneAt: null, doneByUid: null })],
  ["admin non cambia il titolo", "admin", false, "todo", (db, id) => updateDoc(taskRef(db, id), { title: "Altro titolo" })],
  ["admin non cambia il titolo insieme a uno stato valido", "admin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { title: "Altro", status: "done", doneAt: DONE_AT, doneByUid: uid("admin") })],
  ["admin non cambia il tipo di compito", "admin", false, "todo", (db, id) => updateDoc(taskRef(db, id), { kind: "social_consent_revoked" })],
  ["admin non cambia l'iscrizione collegata", "admin", false, "todo", (db, id) => updateDoc(taskRef(db, id), { registrationId: "altra" })],
  ["admin non cambia il nome del partecipante", "admin", false, "todo", (db, id) => updateDoc(taskRef(db, id), { participantName: "Altro" })],
  ["admin non cambia createdAt", "admin", false, "todo", (db, id) => updateDoc(taskRef(db, id), { createdAt: "2020-01-01T00:00:00.000Z" })],
  ["admin non cambia stakeId", "admin", false, "todo", (db, id) => updateDoc(taskRef(db, id), { stakeId: "altro" })],
  ["admin non aggiunge campi fuori elenco", "admin", false, "todo", (db, id) => updateDoc(taskRef(db, id), { note: "boh" })],
  ["admin di un altro palo non segna fatto", "otherAdmin", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: uid("other-admin") })],
  ["admin di un altro palo non riapre", "otherAdmin", false, "done", (db, id) =>
    updateDoc(taskRef(db, id), { status: "todo", doneAt: null, doneByUid: null })],
  ["dirigente di unità non segna fatto", "unitLeader", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: uid("leader") })],
  ["genitore non segna fatto", "parent", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: uid("parent") })],
  ["partecipante non segna fatto", "participant", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: uid("youth") })],
  ["anonimo non segna fatto", "anonymous", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: uid("anon") })],
  ["utente non autenticato non segna fatto", "signedOut", false, "todo", (db, id) =>
    updateDoc(taskRef(db, id), { status: "done", doneAt: DONE_AT, doneByUid: "x" })],

  // Creazione e cancellazione: mai dal client, nemmeno per l'admin.
  ["admin non crea un compito dal client", "admin", false, "todo", (db) => setDoc(taskRef(db, "nuovo"), todoTask("nuovo"))],
  ["admin non crea nemmeno un compito già fatto", "admin", false, "todo", (db) =>
    setDoc(taskRef(db, "nuovo-fatto"), { ...todoTask("nuovo-fatto"), status: "done", doneAt: DONE_AT, doneByUid: uid("admin") })],
  ["super_admin non crea un compito", "superAdmin", false, "todo", (db) => setDoc(taskRef(db, "nuovo-super"), todoTask("nuovo-super"))],
  ["admin non cancella un compito", "admin", false, "todo", (db, id) => deleteDoc(taskRef(db, id))],
  ["admin non cancella un compito fatto", "admin", false, "done", (db, id) => deleteDoc(taskRef(db, id))],
  ["super_admin non cancella un compito", "superAdmin", false, "todo", (db, id) => deleteDoc(taskRef(db, id))],
  ["admin di un altro palo non crea un compito", "otherAdmin", false, "todo", (db) => setDoc(taskRef(db, "nuovo-altro"), todoTask("nuovo-altro"))],
  ["admin di un altro palo non cancella un compito", "otherAdmin", false, "todo", (db, id) => deleteDoc(taskRef(db, id))],
  ["dirigente di unità non crea un compito", "unitLeader", false, "todo", (db) => setDoc(taskRef(db, "nuovo-dir"), todoTask("nuovo-dir"))],
  ["dirigente di unità non cancella un compito", "unitLeader", false, "todo", (db, id) => deleteDoc(taskRef(db, id))],
  ["genitore non crea un compito", "parent", false, "todo", (db) => setDoc(taskRef(db, "nuovo-gen"), todoTask("nuovo-gen"))],
  ["genitore non cancella un compito", "parent", false, "todo", (db, id) => deleteDoc(taskRef(db, id))],
  ["partecipante non crea un compito", "participant", false, "todo", (db) => setDoc(taskRef(db, "nuovo-part"), todoTask("nuovo-part"))],
  ["anonimo non crea un compito", "anonymous", false, "todo", (db) => setDoc(taskRef(db, "nuovo-anon"), todoTask("nuovo-anon"))],
  ["utente non autenticato non crea un compito", "signedOut", false, "todo", (db) => setDoc(taskRef(db, "nuovo-out"), todoTask("nuovo-out"))],
  ["utente non autenticato non cancella un compito", "signedOut", false, "todo", (db, id) => deleteDoc(taskRef(db, id))],
];

before(async () => {
  await Promise.all([
    adminDb.doc(`users/${uid("admin")}`).set({ role: "admin", stakeId }),
    adminDb.doc(`users/${uid("super")}`).set({ role: "super_admin", stakeId: "other-stake" }),
    adminDb.doc(`users/${uid("other-admin")}`).set({ role: "admin", stakeId: "other-stake" }),
    adminDb.doc(`users/${uid("leader")}`).set({ role: "unit_leader", stakeId, unitId: "unit-1" }),
    adminDb.doc(`users/${uid("parent")}`).set({ role: "participant", stakeId }),
    adminDb.doc(`users/${uid("youth")}`).set({ role: "participant", stakeId }),
    adminDb.doc(activityPath).set({ title: "Gita di test", status: "registrations_open", startDate: "2026-10-16" }),
    // Il genitore del compito: l'iscrizione punta a lui, ma questo non gli dà accesso ai compiti.
    adminDb.doc(`${activityPath}/registrations/iscrizione-1`).set({
      fullName: "Figlio Test",
      parentUid: uid("parent"),
      registrationStatus: "confirmed",
      unitId: "unit-1",
    }),
  ]);

  for (const [actor, name, provider] of ACTORS) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actor}-${runId}`);
    const firestore = getFirestore(app);
    const options = name ? { mockUserToken: { sub: uid(name), firebase: { sign_in_provider: provider } } } : {};
    connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), options);
    clients[actor] = { app, firestore };
  }
});

for (const [description, actor, allowed, initial, operation] of CASES) {
  test(description, async () => {
    const id = await seedTask(initial);
    const prima = (await adminDb.doc(`${activityPath}/consentTasks/${id}`).get()).data();
    const attempt = operation(clients[actor].firestore, id);
    if (allowed) {
      await attempt;
      return;
    }
    await assert.rejects(attempt, (error) => {
      assert.equal(error?.code, "permission-denied");
      return true;
    });
    // Un'operazione negata non lascia traccia: il compito è identico a prima.
    const dopo = (await adminDb.doc(`${activityPath}/consentTasks/${id}`).get()).data();
    assert.deepEqual(dopo, prima);
  });
}

test("dopo il via libera, lo stato scritto dall'admin è quello atteso", async () => {
  const id = await seedTask("todo");
  const firestore = clients.admin.firestore;

  await updateDoc(taskRef(firestore, id), { status: "done", doneAt: DONE_AT, doneByUid: uid("admin") });
  let stored = (await adminDb.doc(`${activityPath}/consentTasks/${id}`).get()).data();
  assert.equal(stored.status, "done");
  assert.equal(stored.doneAt, DONE_AT);
  assert.equal(stored.doneByUid, uid("admin"));
  assert.equal(stored.title, todoTask(id).title, "il titolo non cambia");
  assert.equal(stored.kind, "photo_consent_revoked");

  await updateDoc(taskRef(firestore, id), { status: "todo", doneAt: null, doneByUid: null });
  stored = (await adminDb.doc(`${activityPath}/consentTasks/${id}`).get()).data();
  assert.deepEqual(
    { status: stored.status, doneAt: stored.doneAt, doneByUid: stored.doneByUid },
    { status: "todo", doneAt: null, doneByUid: null },
  );
});

after(async () => {
  await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
  await Promise.all(SEEDED_USERS.map((name) => adminDb.doc(`users/${uid(name)}`).delete()));
  await adminDb.terminate();
});
