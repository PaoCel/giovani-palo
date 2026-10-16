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
// Scenario "assegnato → annullato": due attività dello stesso palo, separate da
// quella del test precedente (che elimina la sua) per non influenzarsi.
const cancelActivityId = "overnight-cancel";
const otherActivityId = "overnight-other";
const cancelPath = `stakes/${stakeId}/activities/${cancelActivityId}`;
const otherPath = `stakes/${stakeId}/activities/${otherActivityId}`;

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

const staffRoom = { id: "staff", name: "Staff", capacity: 2, floor: "terra", category: "staff_male", accessible: false, notes: "", minAge: null, maxAge: null };
const boysRoom = { id: "boys", name: "Ragazzi", capacity: 3, floor: "primo", category: "boys", accessible: false, notes: "", minAge: 12, maxAge: 18 };
const coupleRoom = { id: "couple", name: "Matrimoniale", capacity: 2, floor: "primo", category: "couple", accessible: false, notes: "", minAge: null, maxAge: null };

const cancelPeople = {
  boy: { fullName: "Marco Bianchi", birthDate: "2010-01-01", genderRoleCategory: "giovane_uomo" },
  friend: { fullName: "Luca Verdi", birthDate: "2011-03-03", genderRoleCategory: "giovane_uomo" },
  husband: { fullName: "Paolo Neri", birthDate: "1985-01-01", genderRoleCategory: "dirigente" },
  wife: { fullName: "Anna Neri", birthDate: "1986-02-02", genderRoleCategory: "accompagnatore" },
};

function cancelRegistration(id) {
  return {
    ...cancelPeople[id],
    registrationStatus: "confirmed",
    userId: `test-${id}`,
    answers: {},
    roomPreferenceMatches: {},
  };
}

// Piano pubblicato: un ragazzo e un amico nella stanza ragazzi, una coppia
// confermata nella matrimoniale e una stanza staff riservata.
function cancelPlan(revision = 0) {
  return {
    rooms: [staffRoom, boysRoom, coupleRoom],
    assignments: { boy: "boys", friend: "boys", husband: "couple", wife: "couple" },
    lockedIds: ["boy", "husband", "wife"],
    adultGenders: { husband: "male", wife: "female" },
    couples: [{ firstId: "husband", secondId: "wife", confirmed: true }],
    published: true,
    revision,
    updatedAt: "",
  };
}

// Il client rimanda il piano come l'ha letto, senza i campi solo server (savedAt).
function savablePlan(data) {
  const { rooms, assignments, lockedIds, adultGenders, couples, published, revision, updatedAt } = data;
  return { rooms, assignments, lockedIds, adultGenders, couples, published, revision, updatedAt };
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

test("un'iscrizione assegnata e poi annullata esce dal piano, che resta salvabile", async () => {
  const admin = await client("admin-annullo", "password");
  const adminUid = admin.auth.currentUser.uid;
  const planPath = `${cancelPath}/management/rooms`;
  const otherPlanPath = `${otherPath}/management/rooms`;
  const registrationRef = (id, base = cancelPath) => adminDb.doc(`${base}/registrations/${id}`);
  const readRegistration = async (id, base = cancelPath) => (await registrationRef(id, base).get()).data();
  const readPlan = async () => (await adminDb.doc(planPath).get()).data();
  const waitForRevision = (revision, description) => waitFor(
    () => adminDb.doc(planPath).get(),
    (snapshot) => snapshot.data()?.revision === revision,
    description,
  ).then((snapshot) => snapshot.data());
  // Il client admin rilegge il piano e lo rimanda alla callable così com'è.
  const resaveReadPlan = async () => {
    const read = (await getDoc(doc(admin.firestore, planPath))).data();
    return admin.save({
      stakeId,
      activityId: cancelActivityId,
      expectedRevision: read.revision,
      plan: savablePlan(read),
    });
  };
  const otherPlan = {
    rooms: [staffRoom, boysRoom],
    assignments: { boy: "boys" },
    lockedIds: ["boy"],
    adultGenders: {},
    couples: [],
    published: true,
    revision: 7,
    updatedAt: "2026-07-01T10:00:00.000Z",
  };

  try {
    await Promise.all([
      adminDb.doc(`users/${adminUid}`).set({ role: "admin", stakeId }),
      adminDb.doc(cancelPath).set({ title: "Test annullamento", overnight: true, startDate: "2026-07-15" }),
      adminDb.doc(otherPath).set({ title: "Altra attività", overnight: true, startDate: "2026-07-15" }),
      ...Object.keys(cancelPeople).map((id) => registrationRef(id).set(cancelRegistration(id))),
      // Stesso id del ragazzo, ma in un'altra attività e lì ancora confermato.
      registrationRef("boy", otherPath).set({
        ...cancelRegistration("boy"),
        assignedRoomId: "boys",
        assignedRoomName: "Ragazzi",
      }),
      adminDb.doc(otherPlanPath).set(otherPlan),
    ]);

    // Piano pubblicato con la callable: ognuno riceve il nome della sua stanza.
    const first = await admin.save({ stakeId, activityId: cancelActivityId, expectedRevision: 0, plan: cancelPlan(0) });
    assert.equal(first.data.plan.revision, 1);
    assert.equal(first.data.plan.published, true);
    const expectedRooms = { boy: "Ragazzi", friend: "Ragazzi", husband: "Matrimoniale", wife: "Matrimoniale" };
    for (const [id, name] of Object.entries(expectedRooms)) {
      assert.equal((await readRegistration(id)).assignedRoomName, name, `stanza di ${id}`);
    }

    // Il ragazzo annulla: l'iscrizione resta, il trigger lo toglie dal piano.
    await registrationRef("boy").update({ registrationStatus: "cancelled" });
    const afterBoy = await waitForRevision(2, "pulizia del piano dopo l'annullamento del ragazzo");
    assert.deepEqual(afterBoy.assignments, { friend: "boys", husband: "couple", wife: "couple" });
    assert.deepEqual(afterBoy.lockedIds, ["husband", "wife"]);
    assert.deepEqual(afterBoy.adultGenders, { husband: "male", wife: "female" });
    assert.deepEqual(afterBoy.couples, [{ firstId: "husband", secondId: "wife", confirmed: true }]);
    assert.equal(afterBoy.published, true);
    const boy = await readRegistration("boy");
    assert.equal(boy.registrationStatus, "cancelled");
    assert.equal(boy.assignedRoomId, null);
    assert.equal(boy.assignedRoomName, null);
    // Chi resta in piano conserva la sua stanza.
    for (const id of ["friend", "husband", "wife"]) {
      assert.equal((await readRegistration(id)).assignedRoomName, expectedRooms[id], `stanza di ${id}`);
    }

    // Il vecchio piano, con l'annullato ancora assegnato, resta rifiutato per nome;
    // quello ripulito dal trigger, riletto dal client, passa.
    await assert.rejects(
      admin.save({ stakeId, activityId: cancelActivityId, expectedRevision: 2, plan: cancelPlan(2) }),
      (error) => {
        assert.equal(error?.code, "functions/invalid-argument");
        assert.match(error.message, /Marco Bianchi: L'iscrizione non è idonea al piano stanze\./);
        return true;
      },
    );
    const resaved = await resaveReadPlan();
    assert.equal(resaved.data.plan.revision, 3);
    assert.deepEqual(resaved.data.plan.assignments, { friend: "boys", husband: "couple", wife: "couple" });

    // Annulla uno dei coniugi: l'altro non può restare solo nella matrimoniale.
    await registrationRef("wife").update({ registrationStatus: "cancelled" });
    const afterWife = await waitForRevision(4, "pulizia del piano dopo l'annullamento della moglie");
    assert.deepEqual(afterWife.assignments, { friend: "boys" });
    assert.deepEqual(afterWife.lockedIds, []);
    assert.deepEqual(afterWife.couples, []);
    assert.deepEqual(afterWife.adultGenders, { husband: "male" });
    assert.equal(afterWife.published, true);
    for (const id of ["husband", "wife"]) {
      const registration = await readRegistration(id);
      assert.equal(registration.assignedRoomId, null, `stanza di ${id}`);
      assert.equal(registration.assignedRoomName, null, `stanza di ${id}`);
    }
    assert.equal((await readRegistration("wife")).registrationStatus, "cancelled");
    assert.equal((await readRegistration("husband")).registrationStatus, "confirmed");
    assert.equal((await readRegistration("friend")).assignedRoomName, "Ragazzi");
    const resavedAgain = await resaveReadPlan();
    assert.equal(resavedAgain.data.plan.revision, 5);
    assert.deepEqual(resavedAgain.data.plan.assignments, { friend: "boys" });

    // Isolamento: l'altra attività ha un piano con lo stesso id del ragazzo,
    // lì confermato, e non deve essere toccata né nel piano né nell'iscrizione.
    const otherAfter = (await adminDb.doc(otherPlanPath).get()).data();
    assert.deepEqual(otherAfter, otherPlan);
    const otherBoy = await readRegistration("boy", otherPath);
    assert.equal(otherBoy.registrationStatus, "confirmed");
    assert.equal(otherBoy.assignedRoomId, "boys");
    assert.equal(otherBoy.assignedRoomName, "Ragazzi");

    // Nessun rincorrersi: la pulizia scrive sull'iscrizione già annullata, e
    // né un aggiornamento qualunque né la riattivazione toccano più il piano.
    const settled = await readPlan();
    assert.equal(settled.revision, 5);
    await registrationRef("boy").update({ fullName: "Marco Bianchi Modificato" });
    await sleep(2000);
    assert.deepEqual(await readPlan(), settled, "aggiornamento di un'iscrizione già annullata");
    await registrationRef("boy").update({ registrationStatus: "confirmed" });
    await sleep(2000);
    assert.deepEqual(await readPlan(), settled, "riattivazione dell'iscrizione");
    // Riattivata, torna idonea ma non si riassegna da sola.
    const reactivated = await readRegistration("boy");
    assert.equal(reactivated.registrationStatus, "confirmed");
    assert.equal(reactivated.assignedRoomName, null);
    assert.equal(Object.hasOwn((await readPlan()).assignments, "boy"), false);
  } finally {
    // Piani per primi: i trigger di cancellazione delle iscrizioni non trovano più nulla da ripulire.
    await Promise.all([adminDb.doc(planPath).delete(), adminDb.doc(otherPlanPath).delete()]);
    await Promise.all([
      ...Object.keys(cancelPeople).map((id) => registrationRef(id).delete()),
      registrationRef("boy", otherPath).delete(),
    ]);
    await Promise.all([adminDb.doc(cancelPath).delete(), adminDb.doc(otherPath).delete()]);
    await deleteClientApp(admin.app);
    await adminDb.doc(`users/${adminUid}`).delete();
  }
});
