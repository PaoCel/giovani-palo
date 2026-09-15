import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore as getClientFirestore,
  setDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
assert.equal(PROJECT, "demo-room-planner", "Usare esclusivamente il progetto demo-room-planner");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):8180$/, "Firestore Emulator richiesto sulla porta 8180");
assert.match(AUTH_HOST, /^(127\.0\.0\.1|localhost):9199$/, "Auth Emulator richiesto sulla porta 9199");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `room-test-${runId}`;
const activityId = "overnight";
const activityPath = `stakes/${stakeId}/activities/${activityId}`;

function roomPlan(revision = 0) {
  return {
    rooms: [
      { id: "staff", name: "Staff", capacity: 2, floor: "terra", category: "staff_male", accessible: false, notes: "", minAge: null, maxAge: null },
      { id: "boys", name: "Ragazzi", capacity: 2, floor: "primo", category: "boys", accessible: false, notes: "", minAge: 12, maxAge: 18 },
    ],
    assignments: { boy: "boys" },
    lockedIds: ["boy"],
    adultGenders: {},
    couples: [],
    revision,
    updatedAt: "",
  };
}

async function client(name, mode) {
  const app = initializeClientApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });
  if (mode === "anonymous") {
    await signInAnonymously(auth);
  } else if (mode === "password") {
    await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, "room-test-password");
  }
  const firestore = getClientFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8180);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5101);
  return { app, auth, firestore, save: httpsCallable(functions, "roomManagementSave") };
}

async function waitFor(read, predicate, description) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Timeout in attesa di ${description}`);
}

async function expectCode(promise, suffix) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${suffix}`);
    return true;
  });
}

test("callable, trigger e rules applicano auth, revisione e payload stretto", async () => {
  const [admin, outsider, anonymous, signedOut] = await Promise.all([
    client("admin", "password"),
    client("outsider", "password"),
    client("anonymous", "anonymous"),
    client("signed-out", "none"),
  ]);
  const adminUid = admin.auth.currentUser.uid;
  const outsiderUid = outsider.auth.currentUser.uid;

  await Promise.all([
    adminDb.doc(`users/${adminUid}`).set({ role: "admin", stakeId }),
    adminDb.doc(`users/${outsiderUid}`).set({ role: "admin", stakeId: "different-stake" }),
    adminDb.doc(activityPath).set({ title: "Test stanze", overnight: true, startDate: "2026-07-15" }),
    adminDb.doc(`${activityPath}/registrations/boy`).set({
      fullName: "Partecipante Test",
      birthDate: "2010-01-01",
      genderRoleCategory: "giovane_uomo",
      registrationStatus: "confirmed",
      userId: "test-boy",
      answers: {},
      roomPreferenceMatches: {},
    }),
  ]);

  const request = { stakeId, activityId, expectedRevision: 0, plan: roomPlan(0) };
  await expectCode(signedOut.save(request), "unauthenticated");
  await expectCode(outsider.save(request), "permission-denied");
  await expectCode(anonymous.save(request), "permission-denied");
  await expectCode(admin.save({ ...request, injected: true }), "invalid-argument");

  const response = await admin.save(request);
  assert.equal(response.data.plan.revision, 1);
  assert.equal(response.data.plan.assignments.boy, "boys");
  await expectCode(admin.save(request), "aborted");

  const savedForAdmin = await getDoc(doc(admin.firestore, `${activityPath}/management/rooms`));
  assert.equal(savedForAdmin.exists(), true);
  await assert.rejects(getDoc(doc(outsider.firestore, `${activityPath}/management/rooms`)), /permission|insufficient/i);
  await assert.rejects(
    setDoc(doc(admin.firestore, `${activityPath}/management/rooms`), roomPlan(1)),
    /permission|insufficient/i,
  );

  // Pubblicazione: la stanza arriva sull'iscrizione solo con published true,
  // nella stessa transazione del piano, e torna null quando il piano è bozza.
  const published = await admin.save({ ...request, expectedRevision: 1, plan: { ...roomPlan(1), published: true } });
  assert.equal(published.data.plan.published, true);
  assert.equal(published.data.plan.revision, 2);
  let boy = await adminDb.doc(`${activityPath}/registrations/boy`).get();
  assert.equal(boy.data().assignedRoomId, "boys");
  assert.equal(boy.data().assignedRoomName, "Ragazzi");
  assert.equal((await adminDb.doc(`${activityPath}/management/rooms`).get()).data().published, true);
  await expectCode(admin.save({ ...request, expectedRevision: 2, plan: { ...roomPlan(2), published: "yes" } }), "invalid-argument");
  const withdrawn = await admin.save({ ...request, expectedRevision: 2, plan: roomPlan(2) });
  assert.equal(withdrawn.data.plan.published, false);
  boy = await adminDb.doc(`${activityPath}/registrations/boy`).get();
  assert.equal(boy.data().assignedRoomId, null);
  assert.equal(boy.data().assignedRoomName, null);

  await adminDb.doc(`${activityPath}/registrations/boy`).delete();
  const cleaned = await waitFor(
    () => adminDb.doc(`${activityPath}/management/rooms`).get(),
    (snapshot) => snapshot.data()?.revision === 4,
    "pulizia riferimenti alla registrazione",
  );
  assert.deepEqual(cleaned.data().assignments, {});
  assert.deepEqual(cleaned.data().lockedIds, []);

  await adminDb.doc(activityPath).delete();
  await waitFor(
    () => adminDb.doc(`${activityPath}/management/rooms`).get(),
    (snapshot) => !snapshot.exists,
    "eliminazione del piano insieme all'attività",
  );
  await Promise.all([admin.app, outsider.app, anonymous.app, signedOut.app].map(deleteClientApp));
  await adminDb.doc(`users/${adminUid}`).delete();
  await adminDb.doc(`users/${outsiderUid}`).delete();
});
