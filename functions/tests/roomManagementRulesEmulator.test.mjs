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
const stakeId = `room-rules-${runId}`;
const activityPath = `stakes/${stakeId}/activities/camp`;
const uid = (name) => `${name}-${runId}`;
const SEEDED_USERS = ["admin", "super", "other-admin", "leader", "staff", "youth"];

// Overnight camp: the `camp` branches of the management rule apply to these
// actors, so the matrix proves they never extend to the room plan.
const ACTORS = [
  ["admin", "admin", "password"],
  ["superAdmin", "super", "password"],
  ["otherAdmin", "other-admin", "password"],
  ["unitLeader", "leader", "password"],
  ["adultStaff", "staff", "password"],
  ["youth", "youth", "password"],
  ["anonymous", "anon", "anonymous"],
  ["signedOut", null, null],
];
const clients = {};

const plan = { rooms: [], assignments: {}, lockedIds: [], adultGenders: {}, couples: [], revision: 9, updatedAt: "" };
const campPayload = { committees: [], patrols: [], manualLeaders: [], updatedAt: "2026-09-10T00:00:00.000Z" };
const rooms = (firestore) => doc(firestore, `${activityPath}/management/rooms`);
const camp = (firestore) => doc(firestore, `${activityPath}/management/camp`);
const registrations = (firestore) => collection(firestore, `${activityPath}/registrations`);
const layoutFloor = { id: "piano-terra", name: "Piano terra", width: 900, height: 600, outline: null, rooms: [{ number: "104", x: 10, y: 10, w: 60, h: 140 }], spaces: [], markers: [] };
const layoutDoc = (extra = {}) => ({ version: 1, name: "Foresteria test", floors: [layoutFloor], updatedAt: serverTimestamp(), ...extra });
const layout = (firestore, id = "foresteria") => doc(firestore, `stakes/${stakeId}/roomLayouts/${id}`);
const layouts = (firestore) => collection(firestore, `stakes/${stakeId}/roomLayouts`);

// [description, actor, allowed, operation with the same shape used by the client]
const CASES = [
  // roomManagementService.load
  ["admin del palo legge il piano", "admin", true, (db) => getDocFromServer(rooms(db))],
  ["super_admin di altro palo legge il piano", "superAdmin", true, (db) => getDocFromServer(rooms(db))],
  ["admin di altro palo non legge il piano", "otherAdmin", false, (db) => getDocFromServer(rooms(db))],
  ["dirigente di unità non legge il piano", "unitLeader", false, (db) => getDocFromServer(rooms(db))],
  ["adulto iscritto come dirigente non legge il piano", "adultStaff", false, (db) => getDocFromServer(rooms(db))],
  ["giovane iscritto non legge il piano", "youth", false, (db) => getDocFromServer(rooms(db))],
  ["anonimo con iscrizione guest non legge il piano", "anonymous", false, (db) => getDocFromServer(rooms(db))],
  ["utente non autenticato non legge il piano", "signedOut", false, (db) => getDocFromServer(rooms(db))],
  // registrationsService.listRegistrationsByEvent(stakeId, activityId, true)
  ["admin del palo elenca le iscrizioni", "admin", true, (db) => getDocsFromServer(registrations(db))],
  ["super_admin elenca le iscrizioni", "superAdmin", true, (db) => getDocsFromServer(registrations(db))],
  ["admin di altro palo non elenca le iscrizioni", "otherAdmin", false, (db) => getDocsFromServer(registrations(db))],
  ["giovane iscritto non elenca le iscrizioni", "youth", false, (db) => getDocsFromServer(registrations(db))],
  // The plan is written only by the roomManagementSave callable.
  ["admin non crea il piano dal client", "admin", false, (db) => setDoc(rooms(db), plan)],
  ["admin non aggiorna il piano dal client", "admin", false, (db) => updateDoc(rooms(db), { revision: 99 })],
  ["admin non cancella il piano dal client", "admin", false, (db) => deleteDoc(rooms(db))],
  ["super_admin non scrive il piano dal client", "superAdmin", false, (db) => setDoc(rooms(db), plan)],
  ["dirigente di unità non scrive il piano con il payload del campo", "unitLeader", false, (db) => setDoc(rooms(db), campPayload)],
  ["adulto staff non scrive il piano con il payload del campo", "adultStaff", false, (db) => setDoc(rooms(db), campPayload)],
  ["dirigente di unità non cancella il piano", "unitLeader", false, (db) => deleteDoc(rooms(db))],
  // management/camp keeps its existing permissions.
  ["dirigente di unità legge il documento campo", "unitLeader", true, (db) => getDocFromServer(camp(db))],
  ["giovane iscritto legge il documento campo", "youth", true, (db) => getDocFromServer(camp(db))],
  ["adulto staff salva il documento campo", "adultStaff", true, (db) => setDoc(camp(db), campPayload)],
  // Stake floor plans: roomLayoutService.list and roomLayoutService.save
  ["admin del palo elenca le piante", "admin", true, (db) => getDocsFromServer(layouts(db))],
  ["super_admin di altro palo legge la pianta", "superAdmin", true, (db) => getDocFromServer(layout(db))],
  ["admin di altro palo non elenca le piante", "otherAdmin", false, (db) => getDocsFromServer(layouts(db))],
  ["dirigente di unità non legge la pianta", "unitLeader", false, (db) => getDocFromServer(layout(db))],
  ["giovane iscritto non legge la pianta", "youth", false, (db) => getDocFromServer(layout(db))],
  ["utente non autenticato non legge la pianta", "signedOut", false, (db) => getDocFromServer(layout(db))],
  ["admin del palo salva una pianta valida", "admin", true, (db) => setDoc(layout(db), layoutDoc())],
  ["admin non aggiunge campi fuori elenco alla pianta", "admin", false, (db) => setDoc(layout(db), layoutDoc({ updatedBy: "admin" }))],
  ["admin non salva la pianta con l'ora del client", "admin", false, (db) => setDoc(layout(db), layoutDoc({ updatedAt: new Date() }))],
  ["admin non salva la pianta con un id non valido", "admin", false, (db) => setDoc(layout(db, "Foresteria Roma"), layoutDoc())],
  ["admin non salva una pianta senza piani", "admin", false, (db) => setDoc(layout(db), layoutDoc({ floors: [] }))],
  ["admin non cancella la pianta", "admin", false, (db) => deleteDoc(layout(db))],
  ["admin di altro palo non salva la pianta", "otherAdmin", false, (db) => setDoc(layout(db), layoutDoc())],
  ["dirigente di unità non salva la pianta", "unitLeader", false, (db) => setDoc(layout(db), layoutDoc())],
];

before(async () => {
  await Promise.all([
    adminDb.doc(`users/${uid("admin")}`).set({ role: "admin", stakeId }),
    adminDb.doc(`users/${uid("super")}`).set({ role: "super_admin", stakeId: "other-stake" }),
    adminDb.doc(`users/${uid("other-admin")}`).set({ role: "admin", stakeId: "other-stake" }),
    adminDb.doc(`users/${uid("leader")}`).set({ role: "unit_leader", stakeId, unitId: "unit-1" }),
    adminDb.doc(`users/${uid("staff")}`).set({ role: "participant", stakeId }),
    adminDb.doc(`users/${uid("youth")}`).set({ role: "participant", stakeId }),
    adminDb.doc(activityPath).set({
      title: "Campo test",
      activityType: "camp",
      overnight: true,
      isPublic: true,
      isVisible: true,
      status: "registrations_open",
      startDate: "2026-07-15",
    }),
    adminDb.doc(`${activityPath}/registrations/user_${uid("staff")}`).set({
      userId: uid("staff"),
      genderRoleCategory: "dirigente",
      registrationStatus: "confirmed",
      unitId: "unit-1",
    }),
    adminDb.doc(`${activityPath}/registrations/user_${uid("youth")}`).set({
      userId: uid("youth"),
      genderRoleCategory: "giovane_uomo",
      registrationStatus: "confirmed",
      unitId: "unit-1",
    }),
    adminDb.doc(`${activityPath}/registrations/guest_${uid("anon")}`).set({
      anonymousUid: uid("anon"),
      genderRoleCategory: "giovane_donna",
      registrationStatus: "submitted",
      unitId: "unit-1",
    }),
    adminDb.doc(`${activityPath}/management/rooms`).set({
      rooms: [],
      assignments: { [`user_${uid("youth")}`]: "room-1" },
      lockedIds: [],
      adultGenders: { [`user_${uid("staff")}`]: "male" },
      couples: [],
      revision: 1,
      updatedAt: "",
    }),
    adminDb.doc(`${activityPath}/management/camp`).set({ committees: [], patrols: [], manualLeaders: [], updatedAt: "" }),
    adminDb.doc(`stakes/${stakeId}/roomLayouts/foresteria`).set({ version: 1, name: "Foresteria test", floors: [layoutFloor], updatedAt: new Date() }),
  ]);

  for (const [actor, name, provider] of ACTORS) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actor}-${runId}`);
    const firestore = getFirestore(app);
    const options = name ? { mockUserToken: { sub: uid(name), firebase: { sign_in_provider: provider } } } : {};
    connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), options);
    clients[actor] = { app, firestore };
  }
});

for (const [description, actor, allowed, operation] of CASES) {
  test(description, async () => {
    const attempt = operation(clients[actor].firestore);
    if (allowed) {
      await attempt;
      return;
    }
    await assert.rejects(attempt, (error) => {
      assert.equal(error?.code, "permission-denied");
      return true;
    });
  });
}

after(async () => {
  await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
  await Promise.all(SEEDED_USERS.map((name) => adminDb.doc(`users/${uid(name)}`).delete()));
  await adminDb.terminate();
});
