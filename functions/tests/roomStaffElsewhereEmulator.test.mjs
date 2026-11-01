import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore as getClientFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

import { MISSING_STAFF_ROOM } from "../lib/roomPlannerCore.mjs";

// Contratto: docs/ATTIVITA_MODULARI.md, «Quinto incremento: finitura alloggi».
// Esecuzione (solo emulatori, progetto demo-room-planner):
//   firebase emulators:exec --config firebase.room-test.json --project demo-room-planner \
//     'node --test functions/tests/roomStaffElsewhereEmulator.test.mjs'

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
const stakeId = `alloggi-test-${runId}`;
const activityId = "notte-altrove";
const activityPath = `stakes/${stakeId}/activities/${activityId}`;
const planPath = `${activityPath}/management/rooms`;

const boysRoom = { id: "boys", name: "Ragazzi", capacity: 3, floor: "primo", category: "boys", accessible: false, notes: "", minAge: null, maxAge: null };
const girlsRoom = { id: "girls", name: "Ragazze", capacity: 3, floor: "secondo", category: "girls", accessible: false, notes: "", minAge: null, maxAge: null };
const staffRoom = { id: "staff", name: "Accompagnatori", capacity: 2, floor: "terra", category: "staff_male", accessible: false, notes: "", minAge: null, maxAge: null };

const people = {
  boy: { fullName: "Marco Bianchi", birthDate: "2010-01-01", genderRoleCategory: "giovane_uomo" },
  friend: { fullName: "Luca Verdi", birthDate: "2011-03-03", genderRoleCategory: "giovane_uomo" },
  girl: { fullName: "Sara Rossi", birthDate: "2010-05-05", genderRoleCategory: "giovane_donna" },
  leader: { fullName: "Paolo Neri", birthDate: "1985-01-01", genderRoleCategory: "dirigente" },
};

// Piano senza stanza staff: accompagnatori alloggiati altrove, nessuno assegnato.
function planWithoutStaff(revision, extra = {}) {
  return {
    rooms: [boysRoom, girlsRoom],
    assignments: { boy: "boys", friend: "boys", girl: "girls" },
    lockedIds: ["boy"],
    adultGenders: { leader: "male" },
    couples: [],
    published: true,
    revision,
    updatedAt: "",
    ...extra,
  };
}

// Il client precedente rilegge il piano e lo rimanda con i soli campi che conosce.
function legacyPayload(data) {
  const { rooms, assignments, lockedIds, adultGenders, couples, published, revision, updatedAt } = data;
  return { rooms, assignments, lockedIds, adultGenders, couples, published, revision, updatedAt };
}

async function client(name) {
  const app = initializeClientApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });
  await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, "room-test-password");
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
    assert.equal(error?.code, `functions/${suffix}`, error?.message);
    return true;
  });
}

async function expectMissingStaffRoom(promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, "functions/invalid-argument", error?.message);
    assert.ok(error.details?.errors?.includes(MISSING_STAFF_ROOM), JSON.stringify(error.details));
    return true;
  });
}

const readPlan = async () => (await adminDb.doc(planPath).get()).data();

test("accompagnatori alloggiati altrove: flag salvato, conservato dai client precedenti e dalla pulizia", async () => {
  const [admin, outsider, member] = await Promise.all([client("admin-altrove"), client("outsider-altrove"), client("member-altrove")]);
  const adminUid = admin.auth.currentUser.uid;
  const outsiderUid = outsider.auth.currentUser.uid;
  const memberUid = member.auth.currentUser.uid;
  const request = (plan) => ({ stakeId, activityId, expectedRevision: plan.revision, plan });

  try {
    await Promise.all([
      adminDb.doc(`users/${adminUid}`).set({ role: "admin", stakeId }),
      adminDb.doc(`users/${outsiderUid}`).set({ role: "admin", stakeId: `${stakeId}-altro` }),
      adminDb.doc(`users/${memberUid}`).set({ role: "user", stakeId }),
      adminDb.doc(activityPath).set({ title: "Notte con staff altrove", overnight: true, startDate: "2026-07-15" }),
      ...Object.entries(people).map(([id, person]) => adminDb.doc(`${activityPath}/registrations/${id}`).set({
        ...person,
        registrationStatus: "confirmed",
        userId: `test-${id}`,
        answers: {},
        roomPreferenceMatches: {},
      })),
    ]);

    // Mai salvato: il campo assente vale false e il piano senza stanza staff non passa.
    await expectMissingStaffRoom(admin.save(request(planWithoutStaff(0))));
    await expectMissingStaffRoom(admin.save(request(planWithoutStaff(0, { staffElsewhere: false }))));
    // Tipi non booleani rifiutati prima di toccare il database.
    for (const value of ["true", 1, null, { hotel: "Hotel Roma" }]) {
      await expectCode(admin.save(request(planWithoutStaff(0, { staffElsewhere: value }))), "invalid-argument");
    }
    // Chi non è admin del palo non salva, nemmeno con il flag.
    await expectCode(member.save(request(planWithoutStaff(0, { staffElsewhere: true }))), "permission-denied");
    await expectCode(outsider.save(request(planWithoutStaff(0, { staffElsewhere: true }))), "permission-denied");
    assert.equal((await adminDb.doc(planPath).get()).exists, false, "nessun rifiuto ha scritto il piano");

    // Con true il piano senza stanza staff si salva e torna con il campo.
    const first = await admin.save(request(planWithoutStaff(0, { staffElsewhere: true })));
    assert.equal(first.data.plan.staffElsewhere, true);
    assert.equal(first.data.plan.revision, 1);
    let stored = await readPlan();
    assert.equal(stored.staffElsewhere, true);
    assert.equal(stored.revision, 1);
    assert.equal(Object.hasOwn(stored.assignments, "leader"), false, "l'accompagnatore resta senza stanza");
    assert.equal((await adminDb.doc(`${activityPath}/registrations/boy`).get()).data().assignedRoomName, "Ragazzi");
    // L'admin rilegge il piano con le stesse letture del client.
    const readByAdmin = (await getDoc(doc(admin.firestore, planPath))).data();
    assert.equal(readByAdmin.staffElsewhere, true);

    // Client precedente: rimanda il piano senza il campo, il server conserva true.
    const legacy = await admin.save(request(legacyPayload(readByAdmin)));
    assert.equal(legacy.data.plan.staffElsewhere, true);
    assert.equal(legacy.data.plan.revision, 2);
    stored = await readPlan();
    assert.equal(stored.staffElsewhere, true);
    assert.equal(stored.revision, 2);

    // La pulizia di un'iscrizione annullata tocca solo i riferimenti: il flag resta.
    await adminDb.doc(`${activityPath}/registrations/girl`).update({ registrationStatus: "cancelled" });
    const cleaned = await waitFor(readPlan, (data) => data?.revision === 3, "pulizia del piano dopo l'annullamento").then((data) => data);
    assert.equal(cleaned.staffElsewhere, true);
    assert.deepEqual(cleaned.assignments, { boy: "boys", friend: "boys" });
    assert.equal(cleaned.published, true);
    const girl = (await adminDb.doc(`${activityPath}/registrations/girl`).get()).data();
    assert.equal(girl.assignedRoomName, null);

    // Il piano ripulito, riletto da un client precedente, si salva ancora senza stanza staff.
    const resaved = await admin.save(request(legacyPayload((await getDoc(doc(admin.firestore, planPath))).data())));
    assert.equal(resaved.data.plan.staffElsewhere, true);
    assert.equal(resaved.data.plan.revision, 4);

    // false esplicito sovrascrive: senza stanza staff è rifiutato e il piano non cambia.
    const before = await readPlan();
    await expectMissingStaffRoom(admin.save(request({ ...legacyPayload(before), staffElsewhere: false })));
    assert.deepEqual(await readPlan(), before, "il rifiuto non scrive nulla");
    const withStaff = await admin.save(request({
      ...legacyPayload(before),
      rooms: [staffRoom, ...before.rooms],
      assignments: { ...before.assignments, leader: "staff" },
      staffElsewhere: false,
    }));
    assert.equal(withStaff.data.plan.staffElsewhere, false);
    assert.equal(withStaff.data.plan.revision, 5);
    stored = await readPlan();
    assert.equal(stored.staffElsewhere, false);
    assert.equal(stored.assignments.leader, "staff");

    // Ora vale false anche per il client precedente: togliere la stanza staff non passa.
    await expectMissingStaffRoom(admin.save(request({
      ...legacyPayload(stored),
      rooms: stored.rooms.filter((item) => item.id !== "staff"),
      assignments: Object.fromEntries(Object.entries(stored.assignments).filter(([id]) => id !== "leader")),
    })));
    assert.equal((await readPlan()).revision, 5);
  } finally {
    await adminDb.doc(planPath).delete();
    await Promise.all(Object.keys(people).map((id) => adminDb.doc(`${activityPath}/registrations/${id}`).delete()));
    await adminDb.doc(activityPath).delete();
    await Promise.all([admin.app, outsider.app, member.app].map(deleteClientApp));
    await Promise.all([adminUid, outsiderUid, memberUid].map((uid) => adminDb.doc(`users/${uid}`).delete()));
  }
});
