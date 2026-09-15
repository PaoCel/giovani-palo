import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  query,
  where,
} from "firebase/firestore";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

// Regressione 2026-09-15: il dirigente di unità apriva un viaggio (activityType
// trip, overnight true) e la pagina falliva con permission-denied perché il
// client leggeva management/camp, concesso al dirigente solo sui campeggi.
// Queste sono le letture ESATTE di unitLeaderService.getUnitActivityDetail.
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):\d+$/u, "Firestore Emulator locale richiesto");
const [emulatorHost, emulatorPort] = FIRESTORE_HOST.split(":");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `unit-trip-${runId}`;
const uid = (name) => `${name}-${runId}`;
const tripPath = `stakes/${stakeId}/activities/trip`;
const campPath = `stakes/${stakeId}/activities/camp`;
const clients = {};

const registrations = (db, activityPath) => collection(db, `${activityPath}/registrations`);
const ownUnit = (db, activityPath) => query(registrations(db, activityPath), where("unitId", "==", "unit-1"));
const otherUnit = (db, activityPath) => query(registrations(db, activityPath), where("unitId", "==", "unit-2"));
const unitYouth = (db) => query(collection(db, "users"), where("stakeId", "==", stakeId), where("unitId", "==", "unit-1"));

// [description, actor, allowed, operation]
const CASES = [
  // unitLeaderService.getUnitActivityDetail su un viaggio al tempio
  ["dirigente legge l'attività viaggio", "leader", true, (db) => getDocFromServer(doc(db, tripPath))],
  ["dirigente elenca gli iscritti della propria unità al viaggio", "leader", true, (db) => getDocsFromServer(ownUnit(db, tripPath))],
  ["dirigente elenca i giovani della propria unità", "leader", true, (db) => getDocsFromServer(unitYouth(db))],
  ["dirigente NON legge management/camp del viaggio (causa del bug)", "leader", false, (db) => getDocFromServer(doc(db, `${tripPath}/management/camp`))],
  // Confine per unità
  ["dirigente non elenca gli iscritti di un'altra unità", "leader", false, (db) => getDocsFromServer(otherUnit(db, tripPath))],
  ["dirigente non elenca tutti gli iscritti senza filtro unità", "leader", false, (db) => getDocsFromServer(registrations(db, tripPath))],
  ["dirigente di altro palo non elenca gli iscritti", "otherLeader", false, (db) => getDocsFromServer(ownUnit(db, tripPath))],
  // Sul campeggio il piano campo resta leggibile
  ["dirigente elenca gli iscritti della propria unità al campeggio", "leader", true, (db) => getDocsFromServer(ownUnit(db, campPath))],
  ["dirigente legge management/camp del campeggio", "leader", true, (db) => getDocFromServer(doc(db, `${campPath}/management/camp`))],
];

before(async () => {
  const activity = (title, activityType) => ({
    title,
    activityType,
    overnight: true,
    isPublic: true,
    isVisible: true,
    status: "registrations_open",
    startDate: "2026-10-16",
  });
  const registration = (name, unitId) => ({
    userId: uid(name),
    fullName: name,
    genderRoleCategory: "giovane_uomo",
    registrationStatus: "confirmed",
    unitId,
  });
  await Promise.all([
    adminDb.doc(`users/${uid("leader")}`).set({ role: "unit_leader", stakeId, unitId: "unit-1" }),
    adminDb.doc(`users/${uid("other-leader")}`).set({ role: "unit_leader", stakeId: "other-stake", unitId: "unit-1" }),
    adminDb.doc(`users/${uid("youth")}`).set({ role: "participant", stakeId, unitId: "unit-1", genderRoleCategory: "giovane_uomo" }),
    adminDb.doc(tripPath).set(activity("Viaggio al tempio test", "trip")),
    adminDb.doc(campPath).set(activity("Campo test", "camp")),
    adminDb.doc(`${tripPath}/registrations/user_${uid("youth")}`).set(registration("youth", "unit-1")),
    adminDb.doc(`${tripPath}/registrations/user_${uid("other")}`).set(registration("other", "unit-2")),
    adminDb.doc(`${campPath}/registrations/user_${uid("youth")}`).set(registration("youth", "unit-1")),
    adminDb.doc(`${tripPath}/management/camp`).set({ committees: [], patrols: [], manualLeaders: [], updatedAt: "" }),
    adminDb.doc(`${campPath}/management/camp`).set({ committees: [], patrols: [], manualLeaders: [], updatedAt: "" }),
  ]);

  for (const [actor, name] of [["leader", "leader"], ["otherLeader", "other-leader"]]) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actor}-${runId}`);
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), {
      mockUserToken: { sub: uid(name), firebase: { sign_in_provider: "password" } },
    });
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
  await Promise.all(["leader", "other-leader", "youth"].map((name) => adminDb.doc(`users/${uid(name)}`).delete()));
  await adminDb.terminate();
});
