import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

// Scenario 2026-10-10: `genderRoleCategory` lo scrive chiunque nel proprio
// profilo e nella propria iscrizione. Le rules lo usavano per lo staff del
// campeggio (hasOwnAdultCampRegistration in isCampStaffOfActivity): un
// minorenne che si dichiarava "accompagnatore" e si iscriveva leggeva le
// iscrizioni altrui e scriveva management/camp.
// Le operazioni sono quelle esatte del client (campManagementService,
// registrationsService, usersService). Chi gestisce il campeggio sono admin,
// dirigenti di unità (ruolo dell'admin) e gli uid in management/campStaff con
// iscrizione non annullata.
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):\d+$/u, "Firestore Emulator locale richiesto");
const [emulatorHost, emulatorPort] = FIRESTORE_HOST.split(":");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `camp-staff-${runId}`;
const uid = (name) => `${name}-${runId}`;
const campPath = `stakes/${stakeId}/activities/camp`;
const clients = {};
const now = "2026-10-10T10:00:00.000Z";

const registrationPayload = (name, category, extra = {}) => ({
  userId: uid(name),
  anonymousUid: null,
  anonymousTokenId: null,
  accessCode: null,
  recoveryCode: null,
  firstName: name,
  lastName: "Test",
  fullName: `${name} Test`,
  email: `${name}@example.invalid`,
  phone: "",
  birthDate: category === "dirigente" || category === "accompagnatore" ? "1980-01-01" : "2012-05-05",
  genderRoleCategory: category,
  unitId: "unit-1",
  unitNameSnapshot: "Unità 1",
  answers: {},
  recoveryPdfGenerated: false,
  parentConsentDocumentName: null,
  parentConsentDocumentUrl: null,
  parentConsentDocumentPath: null,
  parentConsentUploadedAt: null,
  consentSignatureUrl: null,
  consentSignaturePath: null,
  consentSignatureSetAt: null,
  parentIdDocumentName: null,
  parentIdDocumentUrl: null,
  parentIdDocumentPath: null,
  parentIdUploadedAt: null,
  linkedLaterToUserId: null,
  registrationStatus: "active",
  submittedByMode: "authenticated",
  assignedRoomId: null,
  assignedTempleShiftId: null,
  assignedServiceTeamIds: [],
  assignedPatrolId: null,
  assignedPatrolName: null,
  assignedPatrolRole: null,
  createdAt: now,
  updatedAt: now,
  ...extra,
});

const userProfile = (name, category) => ({
  firstName: name,
  lastName: "Test",
  fullName: `${name} Test`,
  email: `${name}@example.invalid`,
  role: "participant",
  birthDate: "2012-05-05",
  genderRoleCategory: category,
  unitId: "unit-1",
  unitName: "Unità 1",
  stakeId,
  stakeSlug: "test",
  stakeName: "Palo test",
  mustChangePassword: false,
  createdAt: now,
  updatedAt: now,
  lastLoginAt: now,
});

const campPlan = { committees: [], patrols: [], manualLeaders: [], updatedAt: now, savedAt: now };

const attemptDenied = async (attempt) =>
  assert.rejects(attempt, (error) => {
    assert.equal(error?.code, "permission-denied");
    return true;
  });

before(async () => {
  await Promise.all([
    adminDb.doc(`users/${uid("kid")}`).set(userProfile("kid", "giovane_uomo")),
    adminDb.doc(`users/${uid("victim")}`).set(userProfile("victim", "giovane_donna")),
    adminDb.doc(`users/${uid("leader")}`).set({ ...userProfile("leader", "dirigente"), role: "unit_leader", birthDate: "1980-01-01" }),
    adminDb.doc(`users/${uid("listed")}`).set({ ...userProfile("listed", "accompagnatore"), birthDate: "1980-01-01" }),
    adminDb.doc(`users/${uid("listedCancelled")}`).set({ ...userProfile("listedCancelled", "dirigente"), birthDate: "1980-01-01" }),
    adminDb.doc(`users/${uid("listedUnregistered")}`).set({ ...userProfile("listedUnregistered", "dirigente"), birthDate: "1980-01-01" }),
    adminDb.doc(`users/${uid("admin")}`).set({ ...userProfile("admin", "dirigente"), role: "admin", birthDate: "1980-01-01" }),
    adminDb.doc(`stakes/${stakeId}`).set({ name: "Palo test" }),
    adminDb.doc(campPath).set({
      title: "Campo test",
      activityType: "camp",
      isPublic: true,
      isVisible: true,
      status: "registrations_open",
      startDate: "2026-12-16",
    }),
    adminDb.doc(`${campPath}/management/camp`).set(campPlan),
    adminDb.doc(`${campPath}/management/campStaff`).set({
      staffUids: [uid("listed"), uid("listedCancelled"), uid("listedUnregistered")],
      updatedAt: now,
      updatedBy: uid("admin"),
    }),
    adminDb.doc(`${campPath}/registrations/user_${uid("victim")}`).set(registrationPayload("victim", "giovane_donna")),
    adminDb.doc(`${campPath}/registrations/user_${uid("listed")}`).set(registrationPayload("listed", "accompagnatore")),
    adminDb.doc(`${campPath}/registrations/user_${uid("listedCancelled")}`).set(
      registrationPayload("listedCancelled", "dirigente", { registrationStatus: "cancelled" }),
    ),
  ]);

  for (const name of ["kid", "leader", "listed", "listedCancelled", "listedUnregistered", "admin"]) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), {
      mockUserToken: { sub: uid(name), firebase: { sign_in_provider: "password" } },
    });
    clients[name] = { app, firestore };
  }
});

test("catena completa dal client: dichiararsi accompagnatore e iscriversi non dà alcun accesso", async () => {
  const db = clients.kid.firestore;
  await updateDoc(doc(db, `users/${uid("kid")}`), { genderRoleCategory: "accompagnatore", updatedAt: now });
  await setDoc(doc(db, `${campPath}/registrations/user_${uid("kid")}`), registrationPayload("kid", "accompagnatore"));
  try {
    await attemptDenied(getDocs(collection(db, `${campPath}/registrations`)));
    await attemptDenied(getDoc(doc(db, `${campPath}/registrations/user_${uid("victim")}`)));
    await attemptDenied(setDoc(doc(db, `${campPath}/management/camp`), campPlan));
  } finally {
    await adminDb.doc(`users/${uid("kid")}`).set(userProfile("kid", "giovane_uomo"));
    await adminDb.doc(`${campPath}/registrations/user_${uid("kid")}`).delete();
  }
});

// Stato "sfruttato": profilo e iscrizione già con categoria adulta, scritti con
// Admin SDK per isolare il controllo di lettura da quello di scrittura.
const asSelfDeclaredAdult = (description, operation) =>
  test(`categoria adulta autodichiarata: ${description}`, async () => {
    await adminDb.doc(`users/${uid("kid")}`).set(userProfile("kid", "accompagnatore"));
    await adminDb.doc(`${campPath}/registrations/user_${uid("kid")}`).set(registrationPayload("kid", "accompagnatore"));
    try {
      await attemptDenied(operation(clients.kid.firestore));
    } finally {
      await adminDb.doc(`users/${uid("kid")}`).set(userProfile("kid", "giovane_uomo"));
      await adminDb.doc(`${campPath}/registrations/user_${uid("kid")}`).delete();
    }
  });

asSelfDeclaredAdult("non elenca le iscrizioni del campeggio", (db) =>
  getDocs(collection(db, `${campPath}/registrations`)));
asSelfDeclaredAdult("non legge l'iscrizione di un altro", (db) =>
  getDoc(doc(db, `${campPath}/registrations/user_${uid("victim")}`)));
asSelfDeclaredAdult("non scrive management/camp", (db) =>
  setDoc(doc(db, `${campPath}/management/camp`), campPlan));
asSelfDeclaredAdult("non cancella management/camp", (db) =>
  deleteDoc(doc(db, `${campPath}/management/camp`)));
asSelfDeclaredAdult("non assegna pattuglie a un altro iscritto", (db) =>
  updateDoc(doc(db, `${campPath}/registrations/user_${uid("victim")}`), {
    assignedPatrolId: "p1",
    assignedPatrolName: "Pattuglia",
    assignedPatrolRole: "member",
    assignedCommittees: [],
    updatedAt: now,
  }));

const patrolAssignment = {
  assignedPatrolId: "p1",
  assignedPatrolName: "Pattuglia",
  assignedPatrolRole: "member",
  assignedCommittees: [],
  updatedAt: now,
};
const victimRegistration = (db) => doc(db, `${campPath}/registrations/user_${uid("victim")}`);

test("dirigente di unità (ruolo assegnato dall'admin) resta staff del campeggio", async () => {
  await getDocs(collection(clients.leader.firestore, `${campPath}/registrations`));
  await getDoc(doc(clients.leader.firestore, `${campPath}/management/camp`));
  await setDoc(doc(clients.leader.firestore, `${campPath}/management/camp`), campPlan);
});

test("admin del palo gestisce il campeggio e legge l'elenco staff", async () => {
  await getDocs(collection(clients.admin.firestore, `${campPath}/registrations`));
  await setDoc(doc(clients.admin.firestore, `${campPath}/management/camp`), campPlan);
  await getDoc(doc(clients.admin.firestore, `${campPath}/management/campStaff`));
});

test("uid in elenco con iscrizione attiva è staff: legge, scrive il piano, assegna pattuglie", async () => {
  const db = clients.listed.firestore;
  await getDocs(collection(db, `${campPath}/registrations`));
  await getDoc(victimRegistration(db));
  await setDoc(doc(db, `${campPath}/management/camp`), campPlan);
  await updateDoc(victimRegistration(db), patrolAssignment);
});

test("uid in elenco ma con iscrizione annullata non è staff", async () => {
  const db = clients.listedCancelled.firestore;
  await attemptDenied(getDocs(collection(db, `${campPath}/registrations`)));
  await attemptDenied(setDoc(doc(db, `${campPath}/management/camp`), campPlan));
  await attemptDenied(updateDoc(victimRegistration(db), patrolAssignment));
});

test("uid in elenco senza iscrizione non è staff", async () => {
  const db = clients.listedUnregistered.firestore;
  await attemptDenied(getDocs(collection(db, `${campPath}/registrations`)));
  await attemptDenied(setDoc(doc(db, `${campPath}/management/camp`), campPlan));
});

test("uid in elenco con iscrizione senza registrationStatus non è staff (come il server)", async () => {
  const { registrationStatus, ...withoutStatus } = registrationPayload("listedUnregistered", "dirigente");
  const ref = adminDb.doc(`${campPath}/registrations/user_${uid("listedUnregistered")}`);
  await ref.set(withoutStatus);
  try {
    await attemptDenied(getDocs(collection(clients.listedUnregistered.firestore, `${campPath}/registrations`)));
  } finally {
    await ref.delete();
  }
});

test("l'elenco staff lo scrive solo il server: nessun client, nemmeno staff o admin", async () => {
  for (const actor of ["admin", "listed", "leader", "kid"]) {
    const ref = doc(clients[actor].firestore, `${campPath}/management/campStaff`);
    await attemptDenied(setDoc(ref, { staffUids: [uid("kid")], updatedAt: now, updatedBy: uid(actor) }));
    await attemptDenied(deleteDoc(ref));
  }
});

test("l'elenco staff lo legge solo l'admin", async () => {
  for (const actor of ["listed", "leader", "kid"]) {
    await attemptDenied(getDoc(doc(clients[actor].firestore, `${campPath}/management/campStaff`)));
  }
});

test("l'elenco staff vale solo per i campeggi", async () => {
  const tripPath = `stakes/${stakeId}/activities/trip`;
  await adminDb.doc(tripPath).set({
    title: "Viaggio test",
    activityType: "trip",
    isPublic: true,
    isVisible: true,
    status: "registrations_open",
    startDate: "2026-12-16",
  });
  await adminDb.doc(`${tripPath}/management/campStaff`).set({ staffUids: [uid("listed")], updatedAt: now, updatedBy: uid("admin") });
  await adminDb.doc(`${tripPath}/registrations/user_${uid("listed")}`).set(registrationPayload("listed", "accompagnatore"));
  await attemptDenied(getDocs(collection(clients.listed.firestore, `${tripPath}/registrations`)));
});

after(async () => {
  await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
  await Promise.all(["kid", "victim", "leader", "listed", "listedCancelled", "listedUnregistered", "admin"].map((name) => adminDb.doc(`users/${uid(name)}`).delete()));
  await adminDb.terminate();
});
