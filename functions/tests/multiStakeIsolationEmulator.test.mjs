// Isolamento fra pali (multi-stake) contro gli emulatori di
// firebase.multistake-test.json: Auth 9199, Firestore 8180, Functions 5101,
// Storage 9299, progetto demo-room-planner.
//
// Due pali veri (A e B) creati con gli strumenti del repo (tools/lib/stakes.mjs),
// ciascuno con admin, dirigente di unita', partecipante e genitore con figli.
// Le RULES si provano con il client SDK e utenti reali di Auth (l'Admin SDK le
// ignora: qui serve solo per il seed e per ispezionare lo stato). Le callable e i
// trigger girano nell'emulatore delle Functions.
//
// Ogni esecuzione usa id univoci (runId) e ripulisce cio' che ha creato. Non
// legge ne' modifica i pali gia' presenti nell'emulatore (palo-demo, ...): fa
// eccezione un blocco di SOLA LETTURA su palo-demo e il dry-run di resetDemo.
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { connectStorageEmulator, getBytes, getStorage, ref as storageRef, uploadString } from "firebase/storage";

import {
  buildDemoDataset,
  DEMO_ACCOUNTS,
  DEMO_STAKE_ID,
  demoAccounts,
  hashEmail,
  MATTEO_MAGIC_TOKEN,
  resetDemo,
  seedDemo,
} from "../../tools/lib/demoData.mjs";
import { buildUserDocument, createStake } from "../../tools/lib/stakes.mjs";
import { initAdmin, resolveTarget, TargetError } from "../../tools/lib/target.mjs";

const require = createRequire(import.meta.url);
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");
const { getStorage: getAdminStorage } = require("firebase-admin/storage");

// ---------------------------------------------------------------------------
// Guardie: mai fuori dagli emulatori locali
// ---------------------------------------------------------------------------
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "";
assert.equal(PROJECT, "demo-room-planner", "Usare esclusivamente il progetto demo-room-planner");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):8180$/, "Firestore Emulator sulla 8180");
assert.match(AUTH_HOST, /^(127\.0\.0\.1|localhost):9199$/, "Auth Emulator sulla 9199");
if (STORAGE_HOST) assert.match(STORAGE_HOST, /^(127\.0\.0\.1|localhost):9299$/, "Storage Emulator sulla 9299");

// Stessa guardia degli strumenti `tools/*.mjs`: se rifiuta questo ambiente, il
// test non parte (e la guardia stessa e' coperta dal blocco "guardie" sotto).
const target = resolveTarget({ kind: "stake" });
assert.equal(target.emulator, true);
initAdmin(target);
const adminDb = getAdminFirestore();
const adminAuth = getAdminAuth();

const BUCKET = `${PROJECT}.appspot.com`;
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = `Pw-${runId}-iso!`; // credenziale di test, vale solo nell'emulatore
const STAKE = { A: `iso-a-${runId}`, B: `iso-b-${runId}` };
const uid = (name) => `${name}-${runId}`;
const emailOf = (name) => `${name}-${runId}@example.invalid`;
const iso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

// Tutto cio' che creo, per la pulizia finale.
const track = { stakes: new Set(), uids: new Set(), storagePrefixes: new Set(), docs: new Set() };
const apps = [];

// ---------------------------------------------------------------------------
// Client SDK
// ---------------------------------------------------------------------------
function baseApp(prefix) {
  const app = initializeApp(
    { apiKey: "demo-key", projectId: PROJECT, storageBucket: BUCKET },
    `${prefix}${apps.length}-${runId}`,
  );
  apps.push(app);
  return app;
}

/** Utente reale dell'Auth Emulator: token vero, valido anche per le callable. */
async function signIn(email, password = PASSWORD) {
  const app = baseApp("user");
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8180);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5101);
  let storage = null;
  return {
    app,
    auth,
    db,
    uid: credential.user.uid,
    call: (name, data) => httpsCallable(functions, name)(data),
    storage: () => {
      if (!storage) {
        storage = getStorage(app);
        connectStorageEmulator(storage, "127.0.0.1", 9299);
      }
      return storage;
    },
  };
}

/** Solo Firestore, nessun utente: il visitatore non autenticato. */
function signedOutClient() {
  const app = baseApp("anon");
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8180);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5101);
  let storage = null;
  return {
    app,
    db,
    call: (name, data) => httpsCallable(functions, name)(data),
    storage: () => {
      if (!storage) {
        storage = getStorage(app);
        connectStorageEmulator(storage, "127.0.0.1", 9299);
      }
      return storage;
    },
  };
}

/** Solo rules: l'emulatore Firestore accetta un token finto, senza passare da Auth. */
function mockClient(sub) {
  const app = baseApp("mock");
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8180, {
    mockUserToken: { sub, firebase: { sign_in_provider: "password" } },
  });
  return { app, db };
}

async function outcome(promise) {
  try {
    await promise;
    return { ok: true, code: "", message: "" };
  } catch (error) {
    return { ok: false, code: error?.code ?? "", message: String(error?.message ?? error) };
  }
}

async function expectDenied(promise, label) {
  const result = await outcome(promise);
  assert.equal(result.ok, false, `${label}: doveva essere negata ed e' riuscita`);
  assert.equal(
    result.code,
    "permission-denied",
    `${label}: atteso permission-denied, ottenuto "${result.code}" (${result.message})`,
  );
}

async function expectAllowed(promise, label) {
  const result = await outcome(promise);
  assert.equal(result.ok, true, `${label}: doveva riuscire, errore "${result.code}" (${result.message})`);
}

async function expectCallableCode(promise, code, label) {
  const result = await outcome(promise);
  assert.equal(result.ok, false, `${label}: la callable doveva fallire con ${code} ed e' riuscita`);
  assert.equal(
    result.code,
    `functions/${code}`,
    `${label}: atteso functions/${code}, ottenuto "${result.code}" (${result.message})`,
  );
}

async function waitFor(read, predicate, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await sleep(250);
  }
  assert.fail(`Timeout (${timeoutMs} ms) in attesa di ${description}. Ultimo valore: ${JSON.stringify(last)?.slice(0, 800)}`);
}

const getOne = (db, path) => getDocFromServer(doc(db, path));
const listAll = (db, path) => getDocsFromServer(collection(db, path));
const listWhere = (db, path, ...constraints) => getDocsFromServer(query(collection(db, path), ...constraints));
const ids = (snapshot) => snapshot.docs.map((item) => item.id).sort();
const paths = (snapshot) => snapshot.docs.map((item) => item.ref.path).sort();

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const registrationFields = {
  email: "",
  phone: "",
  answers: {},
  roomPreferenceMatches: {},
  participatingDays: [],
  accessCode: null,
  recoveryCode: null,
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
  anonymousUid: null,
  anonymousTokenId: null,
  assignedRoomId: null,
  assignedTempleShiftId: null,
  assignedServiceTeamIds: [],
  assignedPatrolId: null,
  assignedPatrolName: null,
  assignedPatrolRole: null,
  assignedCommittees: [],
};

const PARENT_REQUEST = {
  parentFirstName: "Genitore",
  parentLastName: "Test",
  parentEmail: "genitore@example.invalid",
  parentPhone: "3330000000",
};

/** Iscrizione valida per validRegistrationPayload (nessuna chiave in piu'). */
function registrationDoc({
  firstName,
  lastName,
  unit,
  category = "giovane_donna",
  status = "confirmed",
  userId = null,
  parentUid = null,
  childId = null,
  parentAuthorization = null,
  withRequest = false,
}) {
  const now = iso();
  return {
    ...registrationFields,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    birthDate: "2010-03-04",
    genderRoleCategory: category,
    unitId: unit.id,
    unitNameSnapshot: unit.name,
    answers: withRequest ? { parentAuthorizationRequest: { ...PARENT_REQUEST } } : {},
    registrationStatus: status,
    submittedByMode: parentUid ? "parent" : "authenticated",
    userId,
    ...(parentUid ? { parentUid, childId } : {}),
    ...(parentAuthorization ? { parentAuthorization } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function pendingAuthorization(tokenId) {
  const now = iso();
  return {
    status: "pending_parent_authorization",
    tokenId,
    parentFirstName: "Genitore",
    parentLastName: "Test",
    parentEmail: "genitore@example.invalid",
    parentPhone: "3330000000",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    allergies: "",
    medications: "",
    medicalNotes: "",
    dietaryNotes: "",
    createdAt: now,
    updatedAt: now,
  };
}

function tokenDoc({ id = crypto.randomBytes(32).toString("hex"), stakeId, activityId, registrationId, status = "pending" }) {
  const now = iso();
  return {
    id,
    tokenHash: id,
    stakeId,
    activityId,
    registrationId,
    parentEmail: "genitore@example.invalid",
    participantName: "Figlio Test",
    activityTitle: "Attivita test",
    activityStartDate: "2026-12-18T14:00:00.000Z",
    activityEndDate: "2026-12-19T16:00:00.000Z",
    status,
    createdAt: now,
    expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    usedAt: null,
    invalidatedAt: null,
    createdByUserId: null,
    createdByMode: "system",
  };
}

function activityDoc(title, extra = {}) {
  const now = iso();
  return {
    title,
    description: "Attivita di test",
    audience: "congiunta",
    isPublic: true,
    isVisible: true,
    status: "registrations_open",
    requiresAccount: true,
    requiresParentAuthorization: true,
    activityType: "trip",
    overnight: false,
    startDate: "2026-12-18T14:00:00.000Z",
    endDate: "2026-12-19T16:00:00.000Z",
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

async function createUser({ key, role, firstName, lastName, stake, unit, category = "", birthDate = "" }) {
  const userId = uid(key);
  await adminAuth.createUser({
    uid: userId,
    email: emailOf(key),
    emailVerified: true,
    password: PASSWORD,
    displayName: `${firstName} ${lastName}`,
  });
  track.uids.add(userId);
  await adminDb.doc(`users/${userId}`).set(
    buildUserDocument({
      firstName,
      lastName,
      email: emailOf(key),
      role,
      stake,
      unit,
      genderRoleCategory: category,
      birthDate,
      now: iso(),
    }),
  );
  return { uid: userId, email: emailOf(key), fullName: `${firstName} ${lastName}` };
}

/** Un palo completo, creato con createStake e poi popolato con l'Admin SDK. */
async function seedStake(key) {
  const lower = key.toLowerCase();
  const stakeId = STAKE[key];
  track.stakes.add(stakeId);

  const created = await createStake(
    { db: adminDb, auth: adminAuth },
    {
      stakeId,
      name: `Palo Isolamento ${key} ${runId}`,
      supportContact: `supporto-${lower}@example.invalid`,
      units: [{ name: "Rione Uno" }, { name: "Rione Due" }],
      // Niente `uid`: con un uid esplicito createStake presume un account Auth gia' esistente.
      admin: {
        email: emailOf(`admin-${lower}`),
        firstName: `Admin${key}`,
        lastName: "Test",
        password: PASSWORD,
      },
      apply: true,
    },
  );
  assert.equal(created.applied, true);
  track.uids.add(created.adminUid);
  const { stake } = created;
  const [unit1, unit2] = created.units;
  const now = iso();

  const inactiveUnit = { id: `${stakeId}-ramo-spento`, name: "Ramo Spento" };
  await adminDb.doc(`stakes/${stakeId}/units/${inactiveUnit.id}`).set({
    name: inactiveUnit.name,
    type: "ramo",
    isActive: false,
    createdAt: now,
    updatedAt: now,
  });

  const leader = await createUser({
    key: `leader-${lower}`, role: "unit_leader", firstName: "Luca", lastName: `Dirigente${key}`,
    stake, unit: unit1, category: "dirigente", birthDate: "1985-02-02",
  });
  const participant = await createUser({
    key: `part-${lower}`, role: "participant",
    firstName: key === "A" ? "Ginevra" : "Ottavia", lastName: key === "A" ? "Alderighi" : "Zanzibar",
    stake, unit: unit1, category: "giovane_donna", birthDate: "2010-03-04",
  });
  const parent = await createUser({
    key: `parent-${lower}`, role: "parent", firstName: "Paola", lastName: `Genitore${key}`, stake, unit: unit1,
  });
  const otherUid = uid(`other-${lower}`);

  for (const childId of ["figlio-1", "figlio-2"]) {
    await adminDb.doc(`users/${parent.uid}/children/${childId}`).set({
      firstName: childId === "figlio-1" ? "Marco" : "Anna",
      lastName: `Genitore${key}`,
      fullName: `Figlio ${childId}`,
      birthDate: "2011-05-20",
      genderRoleCategory: childId === "figlio-1" ? "giovane_uomo" : "giovane_donna",
      unitId: unit1.id,
      unitName: unit1.name,
      stakeId,
      createdAt: now,
      updatedAt: now,
    });
  }

  const base = `stakes/${stakeId}/activities`;
  await adminDb.doc(`${base}/pub`).set(activityDoc("Viaggio test", { activityType: "trip" }));
  await adminDb.doc(`${base}/priv`).set(
    activityDoc("Bozza privata", { isPublic: false, isVisible: false, status: "draft" }),
  );
  await adminDb.doc(`${base}/camp`).set(activityDoc("Campeggio test", { activityType: "camp", overnight: true }));
  // Attivita' aperta senza iscrizioni: serve alle prove di creazione da parte dei proprietari.
  await adminDb.doc(`${base}/open`).set(activityDoc("Attivita aperta", { activityType: "trip" }));
  for (const activityId of ["pub", "priv"]) {
    await adminDb.doc(`${base}/${activityId}/config/form`).set({ allowGuestRegistration: false, requireLoginForEdit: true });
  }

  const pendingToken = crypto.randomBytes(32).toString("hex");
  const childPending = `child_${parent.uid}_figlio-1`;
  const childDone = `child_${parent.uid}_figlio-2`;
  const partReg = `user_${participant.uid}`;
  const otherReg = `user_${otherUid}`;
  await Promise.all([
    adminDb.doc(`${base}/pub/registrations/${partReg}`).set(
      registrationDoc({ firstName: participant.fullName.split(" ")[0], lastName: participant.fullName.split(" ")[1], unit: unit1, userId: participant.uid }),
    ),
    adminDb.doc(`${base}/pub/registrations/${otherReg}`).set(
      registrationDoc({ firstName: "Altro", lastName: `Rione${key}`, unit: unit2, userId: otherUid }),
    ),
    adminDb.doc(`${base}/pub/registrations/${childPending}`).set(
      registrationDoc({
        firstName: "Marco", lastName: `Genitore${key}`, unit: unit1, category: "giovane_uomo",
        status: "pending_parent_authorization", parentUid: parent.uid, childId: "figlio-1",
        parentAuthorization: pendingAuthorization(pendingToken), withRequest: true,
      }),
    ),
    adminDb.doc(`${base}/pub/registrations/${childDone}`).set(
      registrationDoc({
        firstName: "Anna", lastName: `Genitore${key}`, unit: unit1,
        parentUid: parent.uid, childId: "figlio-2", withRequest: true,
      }),
    ),
    adminDb.doc(`${base}/camp/registrations/${partReg}`).set(
      registrationDoc({ firstName: participant.fullName.split(" ")[0], lastName: participant.fullName.split(" ")[1], unit: unit1, userId: participant.uid }),
    ),
    adminDb.doc(`parentAuthorizationTokens/${pendingToken}`).set(
      tokenDoc({ id: pendingToken, stakeId, activityId: "pub", registrationId: childPending }),
    ),
    adminDb.doc(`${base}/camp/management/camp`).set({ committees: [], patrols: [], manualLeaders: [], updatedAt: "seed" }),
    adminDb.doc(`${base}/pub/registrations/${partReg}/questions/q1`).set({
      eventId: "pub", stakeId, registrationId: partReg, authorUserId: participant.uid,
      authorAnonymousUid: null, authorName: participant.fullName, text: "Domanda di prova",
      isAnonymous: false, status: "active", createdAt: now, updatedAt: now,
    }),
    adminDb.doc(`stakes/${stakeId}/adminAlerts/seed-alert`).set({
      type: "registration_created", stakeId, eventId: "pub", registrationId: partReg, eventTitle: "Viaggio test",
      participantName: participant.fullName, submittedByMode: "authenticated", title: "Nuovo iscritto",
      message: "Seed", severity: "info", active: true, readBy: [], createdAt: now, updatedAt: now,
    }),
    adminDb.doc(`stakes/${stakeId}/registrationAttempts/seed-attempt`).set({ stakeId, eventId: "pub", note: "seed" }),
    adminDb.doc(`${base}/pub/consentAuditLogs/seed-log`).set({ stakeId, activityId: "pub", event: "seed" }),
    adminDb.doc(`stakes/${stakeId}/roomLayouts/foresteria`).set({
      version: 1, name: "Foresteria test", updatedAt: new Date(),
      floors: [{ id: "piano-terra", name: "Piano terra", width: 900, height: 600, outline: null, rooms: [], spaces: [], markers: [] }],
    }),
  ]);

  return {
    id: stakeId, stake, unit1, unit2, inactiveUnit,
    admin: { uid: created.adminUid, email: emailOf(`admin-${lower}`) },
    leader, participant, parent, otherUid, pendingToken,
    childPending, childDone, partReg, otherReg,
  };
}

// ---------------------------------------------------------------------------
// Stato condiviso dai blocchi
// ---------------------------------------------------------------------------
const x = { A: null, B: null, actors: {} };

before(async () => {
  [x.A, x.B] = await Promise.all([seedStake("A"), seedStake("B")]);
  const signed = await Promise.all([
    signIn(x.A.admin.email), signIn(x.B.admin.email),
    signIn(x.A.leader.email), signIn(x.B.leader.email),
    signIn(x.A.participant.email), signIn(x.B.participant.email),
    signIn(x.A.parent.email), signIn(x.B.parent.email),
  ]);
  [
    x.actors.adminA, x.actors.adminB, x.actors.leaderA, x.actors.leaderB,
    x.actors.participantA, x.actors.participantB, x.actors.parentA, x.actors.parentB,
  ] = signed;
  x.actors.signedOut = signedOutClient();
});

after(async () => {
  await Promise.allSettled(apps.map((app) => deleteApp(app)));
  const wipe = async () => {
    for (const stakeId of track.stakes) {
      await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`)).catch(() => {});
      const tokens = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", stakeId).get().catch(() => null);
      for (const token of tokens?.docs ?? []) await token.ref.delete().catch(() => {});
    }
    for (const userId of track.uids) {
      await adminDb.recursiveDelete(adminDb.doc(`users/${userId}`)).catch(() => {});
    }
    for (const path of track.docs) await adminDb.doc(path).delete().catch(() => {});
  };
  await wipe();
  // I trigger (avvisi "Nuovo iscritto", ...) possono scrivere dopo la prima passata.
  await sleep(2500);
  await wipe();
  const uidList = [...track.uids];
  for (let index = 0; index < uidList.length; index += 500) {
    await adminAuth.deleteUsers(uidList.slice(index, index + 500)).catch(() => {});
  }
  if (STORAGE_HOST) {
    const bucket = getAdminStorage().bucket();
    for (const prefix of track.storagePrefixes) await bucket.deleteFiles({ prefix, force: true }).catch(() => {});
  }
  await adminDb.terminate().catch(() => {});
});

// ===========================================================================
// 0. Guardie degli strumenti (tools/lib/target.mjs), funzioni pure
// ===========================================================================
describe("guardie degli strumenti (target.mjs)", () => {
  const local = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199" };

  test("accetta solo emulatori locali con progetto demo-*", () => {
    assert.deepEqual(resolveTarget({ kind: "seed", env: { ...local, GCLOUD_PROJECT: "demo-room-planner" } }), {
      projectId: "demo-room-planner",
      emulator: true,
    });
    assert.throws(
      () => resolveTarget({ kind: "stake", env: { ...local, GCLOUD_PROJECT: "giovani-palo" } }),
      (error) => error instanceof TargetError && /demo-/.test(error.message),
      "emulatore con progetto di produzione",
    );
    assert.throws(
      () => resolveTarget({ kind: "stake", env: { ...local, FIRESTORE_EMULATOR_HOST: "10.0.0.5:8180", GCLOUD_PROJECT: "demo-x" } }),
      /non locale/,
    );
    assert.throws(
      () => resolveTarget({ kind: "stake", env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180", GCLOUD_PROJECT: "demo-x" } }),
      /parziale/,
    );
    assert.throws(
      () => resolveTarget({ kind: "stake", env: { GCLOUD_PROJECT: "demo-x" } }),
      /progetto emulatore/,
    );
  });

  test("senza emulatori: produzione solo con --production e CONFIRM_PROJECT, seed mai su produzione", () => {
    assert.throws(() => resolveTarget({ kind: "stake", env: { GCLOUD_PROJECT: "giovani-palo" } }), /--production/);
    assert.throws(
      () => resolveTarget({ kind: "stake", allowProduction: true, env: { GCLOUD_PROJECT: "giovani-palo" } }),
      /CONFIRM_PROJECT/,
    );
    assert.throws(
      () => resolveTarget({ kind: "stake", allowProduction: true, env: { GCLOUD_PROJECT: "giovani-palo", CONFIRM_PROJECT: "altro" } }),
      /CONFIRM_PROJECT/,
    );
    assert.throws(() => resolveTarget({ kind: "seed", env: { GCLOUD_PROJECT: "giovani-palo" } }), /produzione/);
    assert.throws(() => resolveTarget({ kind: "seed", env: { GCLOUD_PROJECT: "altro-progetto" } }), /staging/);
    assert.throws(() => resolveTarget({ kind: "stake", project: "a", env: { GCLOUD_PROJECT: "b" } }), /contraddice/);
    assert.equal(resolveTarget({ kind: "seed", env: { GCLOUD_PROJECT: "giovani-palo-staging" } }).emulator, false);
  });
});

// ===========================================================================
// 1. RULES: isolamento fra pali (client SDK, utenti reali)
// ===========================================================================
// [descrizione, attore, consentito, operazione con la stessa forma usata dal client]
const RULE_CASES = [
  // --- controlli positivi: ogni admin opera nel proprio palo -----------------
  ["admin A legge attivita', iscrizioni, unita' e utenti del proprio palo", "adminA", true, async (db, c) => {
    await listAll(db, `stakes/${c.A.id}/activities`);
    await listAll(db, `stakes/${c.A.id}/activities/pub/registrations`);
    await getOne(db, `stakes/${c.A.id}/activities/pub/registrations/${c.A.partReg}`);
    await listAll(db, `stakes/${c.A.id}/units`);
    await getOne(db, `stakes/${c.A.id}/units/${c.A.inactiveUnit.id}`);
    await getOne(db, `stakes/${c.A.id}/activities/priv`);
    await getOne(db, `users/${c.A.participant.uid}`);
    await listWhere(db, "users", where("stakeId", "==", c.A.id));
    await getOne(db, `users/${c.A.parent.uid}/children/figlio-1`);
    // La list dei figli e' dimostrabile alle rules solo con il filtro sul palo.
    await listWhere(db, `users/${c.A.parent.uid}/children`, where("stakeId", "==", c.A.id));
  }],
  ["admin A scrive iscrizioni, unita', attivita' e documento del proprio palo", "adminA", true, async (db, c) => {
    const registration = doc(db, `stakes/${c.A.id}/activities/pub/registrations/scritta-da-admin`);
    await setDoc(registration, { fullName: "Scritta da admin" });
    await updateDoc(registration, { fullName: "Aggiornata da admin" });
    await deleteDoc(registration);
    const unit = doc(db, `stakes/${c.A.id}/units/extra`);
    await setDoc(unit, { name: "Extra", type: "rione", isActive: true, createdAt: iso(), updatedAt: iso() });
    await updateDoc(unit, { name: "Extra 2" });
    await deleteDoc(unit);
    const activity = doc(db, `stakes/${c.A.id}/activities/temporanea`);
    await setDoc(activity, { title: "Temporanea", isPublic: false });
    await updateDoc(activity, { title: "Temporanea 2" });
    await deleteDoc(activity);
    await updateDoc(doc(db, `stakes/${c.A.id}`), { updatedAt: iso() });
    await setDoc(doc(db, `stakes/${c.A.id}/activities/camp/management/camp`), {
      committees: [], patrols: [], manualLeaders: [], updatedAt: "controllo-rules",
    });
    await setDoc(doc(db, `stakes/${c.A.id}/roomLayouts/foresteria`), {
      version: 1, name: "Foresteria", updatedAt: serverTimestamp(),
      floors: [{ id: "piano-terra", name: "Piano terra", width: 900, height: 600, outline: null, rooms: [], spaces: [], markers: [] }],
    });
  }],
  ["admin B legge tutto nel proprio palo (controllo positivo)", "adminB", true, async (db, c) => {
    await listAll(db, `stakes/${c.B.id}/activities`);
    await listAll(db, `stakes/${c.B.id}/activities/pub/registrations`);
    await listAll(db, `stakes/${c.B.id}/roomLayouts`);
    await listAll(db, `stakes/${c.B.id}/adminAlerts`);
    await listAll(db, `stakes/${c.B.id}/registrationAttempts`);
    await listAll(db, `stakes/${c.B.id}/activities/pub/consentAuditLogs`);
    await getOne(db, `stakes/${c.B.id}/activities/camp/management/camp`);
    await setDoc(doc(db, `stakes/${c.B.id}/activities/camp/management/camp`), {
      committees: [], patrols: [], manualLeaders: [], updatedAt: "controllo-rules",
    });
    await listAll(db, `stakes/${c.B.id}/adminPushDevices`);
    await listAll(db, `stakes/${c.B.id}/activities/pub/transportNotes`);
    await getOne(db, `stakes/${c.B.id}/activities/priv/config/form`);
    await listAll(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}/questions`);
    await getOne(db, `stakes/${c.B.id}/units/${c.B.inactiveUnit.id}`);
    await getOne(db, `users/${c.B.participant.uid}`);
    await getOne(db, `users/${c.B.admin.uid}`);
    await getOne(db, `users/${c.B.parent.uid}/children/figlio-1`);
    await listWhere(db, "users", where("stakeId", "==", c.B.id));
    await getDocsFromServer(
      query(collectionGroup(db, "questions"), where("stakeId", "==", c.B.id), where("eventId", "==", "pub")),
    );
  }],

  // --- admin A NON entra in B -------------------------------------------------
  ["admin A non elenca le attivita' di B senza filtro", "adminA", false, (db, c) => listAll(db, `stakes/${c.B.id}/activities`)],
  ["admin A non legge un'attivita' privata di B", "adminA", false, (db, c) => getOne(db, `stakes/${c.B.id}/activities/priv`)],
  ["admin A non elenca le iscrizioni di B", "adminA", false, (db, c) => listAll(db, `stakes/${c.B.id}/activities/pub/registrations`)],
  ["admin A non legge un'iscrizione di B", "adminA", false, (db, c) => getOne(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}`)],
  ["admin A non crea iscrizioni in B", "adminA", false, (db, c) =>
    setDoc(doc(db, `stakes/${c.B.id}/activities/pub/registrations/intruso`), { fullName: "Intruso" })],
  ["admin A non aggiorna iscrizioni di B", "adminA", false, (db, c) =>
    updateDoc(doc(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}`), { fullName: "Manomessa" })],
  ["admin A non cancella iscrizioni di B", "adminA", false, (db, c) =>
    deleteDoc(doc(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}`))],
  ["admin A non assegna pattuglie nel campeggio di B", "adminA", false, (db, c) =>
    updateDoc(doc(db, `stakes/${c.B.id}/activities/camp/registrations/${c.B.partReg}`), {
      assignedPatrolId: "p1", assignedPatrolName: "Pattuglia", assignedPatrolRole: "member", assignedCommittees: [], updatedAt: iso(),
    })],
  ["admin A non legge un'unita' non attiva di B", "adminA", false, (db, c) => getOne(db, `stakes/${c.B.id}/units/${c.B.inactiveUnit.id}`)],
  ["admin A non elenca tutte le unita' di B (anche inattive)", "adminA", false, (db, c) => listAll(db, `stakes/${c.B.id}/units`)],
  ["admin A non crea unita' in B", "adminA", false, (db, c) =>
    setDoc(doc(db, `stakes/${c.B.id}/units/intrusa`), { name: "Intrusa", type: "rione", isActive: true, createdAt: iso(), updatedAt: iso() })],
  ["admin A non aggiorna unita' di B", "adminA", false, (db, c) =>
    updateDoc(doc(db, `stakes/${c.B.id}/units/${c.B.unit1.id}`), { name: "Manomessa" })],
  ["admin A non cancella unita' di B", "adminA", false, (db, c) => deleteDoc(doc(db, `stakes/${c.B.id}/units/${c.B.unit1.id}`))],
  ["admin A non crea attivita' in B", "adminA", false, (db, c) =>
    setDoc(doc(db, `stakes/${c.B.id}/activities/intrusa`), { title: "Intrusa" })],
  ["admin A non aggiorna attivita' di B", "adminA", false, (db, c) =>
    updateDoc(doc(db, `stakes/${c.B.id}/activities/pub`), { title: "Manomessa" })],
  ["admin A non cancella attivita' di B", "adminA", false, (db, c) => deleteDoc(doc(db, `stakes/${c.B.id}/activities/pub`))],
  ["admin A non aggiorna il documento stakes/B", "adminA", false, (db, c) => updateDoc(doc(db, `stakes/${c.B.id}`), { name: "Palo rubato" })],
  ["admin A non cancella il documento stakes/B", "adminA", false, (db, c) => deleteDoc(doc(db, `stakes/${c.B.id}`))],
  ["admin A non legge un utente di B (get)", "adminA", false, (db, c) => getOne(db, `users/${c.B.participant.uid}`)],
  ["admin A non legge l'admin di B (get)", "adminA", false, (db, c) => getOne(db, `users/${c.B.admin.uid}`)],
  ["admin A non elenca gli utenti di B (where stakeId == B)", "adminA", false, (db, c) =>
    listWhere(db, "users", where("stakeId", "==", c.B.id))],
  ["admin A non promuove un utente di B", "adminA", false, (db, c) =>
    updateDoc(doc(db, `users/${c.B.participant.uid}`), { role: "admin", updatedAt: iso() })],
  ["admin A non legge i figli di un genitore di B", "adminA", false, (db, c) =>
    getOne(db, `users/${c.B.parent.uid}/children/figlio-1`)],
  ["admin A non elenca i figli di un genitore di B (nemmeno filtrando per stakeId == B)", "adminA", false, (db, c) =>
    listWhere(db, `users/${c.B.parent.uid}/children`, where("stakeId", "==", c.B.id))],
  ["admin A non legge le piante di B", "adminA", false, (db, c) => listAll(db, `stakes/${c.B.id}/roomLayouts`)],
  ["admin A non salva piante in B", "adminA", false, (db, c) =>
    setDoc(doc(db, `stakes/${c.B.id}/roomLayouts/intrusa`), {
      version: 1, name: "Intrusa", updatedAt: serverTimestamp(),
      floors: [{ id: "piano-terra", name: "Piano terra", width: 900, height: 600, outline: null, rooms: [], spaces: [], markers: [] }],
    })],
  ["admin A non legge gli avvisi di B", "adminA", false, (db, c) => listAll(db, `stakes/${c.B.id}/adminAlerts`)],
  ["admin A non legge i tentativi di iscrizione di B", "adminA", false, (db, c) => listAll(db, `stakes/${c.B.id}/registrationAttempts`)],
  ["admin A non legge i log di consenso di B", "adminA", false, (db, c) => listAll(db, `stakes/${c.B.id}/activities/pub/consentAuditLogs`)],
  ["admin A non legge i dispositivi push di B", "adminA", false, (db, c) => listAll(db, `stakes/${c.B.id}/adminPushDevices`)],
  ["admin A non legge le note di trasporto di B", "adminA", false, (db, c) => listAll(db, `stakes/${c.B.id}/activities/pub/transportNotes`)],
  ["admin A non legge la configurazione del modulo di un'attivita' privata di B", "adminA", false, (db, c) =>
    getOne(db, `stakes/${c.B.id}/activities/priv/config/form`)],
  ["admin A non legge il piano campo di B", "adminA", false, (db, c) => getOne(db, `stakes/${c.B.id}/activities/camp/management/camp`)],
  ["admin A non scrive il piano campo di B", "adminA", false, (db, c) =>
    setDoc(doc(db, `stakes/${c.B.id}/activities/camp/management/camp`), { committees: [], patrols: [], manualLeaders: [], updatedAt: iso() })],
  ["admin A non legge le domande di B (collectionGroup stakeId + eventId)", "adminA", false, (db, c) =>
    getDocsFromServer(query(collectionGroup(db, "questions"), where("stakeId", "==", c.B.id), where("eventId", "==", "pub")))],
  ["admin A non legge le domande di una iscrizione di B", "adminA", false, (db, c) =>
    listAll(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}/questions`)],

  ["i token di autorizzazione non sono leggibili dal client, nemmeno dall'admin del proprio palo", "adminA", false, (db, c) =>
    getOne(db, `parentAuthorizationTokens/${c.A.pendingToken}`)],
  ["i token di autorizzazione non sono elencabili dal client", "adminB", false, (db, c) =>
    listWhere(db, "parentAuthorizationTokens", where("stakeId", "==", c.B.id))],

  // --- letture volutamente aperte (nessuna restrizione da inventare) ------------
  ["il documento stakes/B e' pubblico anche per l'admin di A (get e list)", "adminA", true, async (db, c) => {
    await getOne(db, `stakes/${c.B.id}`);
    const listed = await listWhere(db, "stakes", where("slug", "==", c.B.stake.slug));
    assert.deepEqual(ids(listed), [c.B.id]);
  }],
  ["le attivita' pubbliche di B sono leggibili da chiunque (get, list filtrata, modulo)", "adminA", true, async (db, c) => {
    await getOne(db, `stakes/${c.B.id}/activities/pub`);
    const listed = await listWhere(db, `stakes/${c.B.id}/activities`, where("isPublic", "==", true), where("isVisible", "==", true));
    assert.deepEqual(ids(listed), ["camp", "open", "pub"], "la lista pubblica non include la bozza privata");
    await getOne(db, `stakes/${c.B.id}/activities/pub/config/form`);
  }],
  ["le unita' attive di B sono pubbliche (servono al modulo di iscrizione)", "adminA", true, async (db, c) => {
    const listed = await listWhere(db, `stakes/${c.B.id}/units`, where("isActive", "==", true));
    assert.deepEqual(ids(listed), [c.B.unit1.id, c.B.unit2.id].sort());
    await getOne(db, `stakes/${c.B.id}/units/${c.B.unit1.id}`);
  }],
  ["un visitatore non autenticato vede solo stake, attivita' pubbliche e unita' attive", "signedOut", true, async (db, c) => {
    await getOne(db, `stakes/${c.A.id}`);
    await listWhere(db, "stakes", where("slug", "==", c.A.stake.slug));
    await getOne(db, `stakes/${c.A.id}/activities/pub`);
    await listWhere(db, `stakes/${c.A.id}/units`, where("isActive", "==", true));
  }],
  ["un visitatore non autenticato non legge un utente", "signedOut", false, (db, c) => getOne(db, `users/${c.A.participant.uid}`)],
  ["un visitatore non autenticato non elenca le iscrizioni", "signedOut", false, (db, c) =>
    listAll(db, `stakes/${c.A.id}/activities/pub/registrations`)],
  ["un visitatore non autenticato non legge una bozza", "signedOut", false, (db, c) => getOne(db, `stakes/${c.A.id}/activities/priv`)],

  // --- dirigente di unita' A ------------------------------------------------------
  ["dirigente A legge i giovani e le iscrizioni della propria unita' (query esatte del client)", "leaderA", true, async (db, c) => {
    const youth = await listWhere(db, "users", where("stakeId", "==", c.A.id), where("unitId", "==", c.A.unit1.id));
    assert.ok(ids(youth).includes(c.A.participant.uid));
    assert.ok(!ids(youth).includes(c.B.participant.uid));
    const regs = await listWhere(db, `stakes/${c.A.id}/activities/pub/registrations`, where("unitId", "==", c.A.unit1.id));
    assert.ok(ids(regs).includes(c.A.partReg));
    assert.ok(!ids(regs).includes(c.A.otherReg), "l'iscrizione dell'altra unita' non rientra");
    await getOne(db, `stakes/${c.A.id}/activities/priv`);
    await listAll(db, `stakes/${c.A.id}/activities/pub/transportNotes`);
    await getOne(db, `users/${c.A.participant.uid}`);
  }],
  ["dirigente A segna e rimuove una nota di trasporto nel proprio palo", "leaderA", true, async (db, c) => {
    const note = doc(db, `stakes/${c.A.id}/activities/pub/transportNotes/${c.A.partReg}`);
    await setDoc(note, { registrationId: c.A.partReg, resolvedByUid: c.actors.leaderA.uid, resolvedAt: iso() });
    await deleteDoc(note);
  }],
  ["dirigente A non elenca i giovani dell'altra unita' del proprio palo", "leaderA", false, (db, c) =>
    listWhere(db, "users", where("stakeId", "==", c.A.id), where("unitId", "==", c.A.unit2.id))],
  ["dirigente A non elenca tutto il proprio palo senza filtro unita'", "leaderA", false, (db, c) =>
    listWhere(db, "users", where("stakeId", "==", c.A.id))],
  ["dirigente A non elenca i giovani di B", "leaderA", false, (db, c) =>
    listWhere(db, "users", where("stakeId", "==", c.B.id), where("unitId", "==", c.B.unit1.id))],
  ["dirigente A non legge un utente di B", "leaderA", false, (db, c) => getOne(db, `users/${c.B.participant.uid}`)],
  ["dirigente A non elenca le iscrizioni di un'unita' di B", "leaderA", false, (db, c) =>
    listWhere(db, `stakes/${c.B.id}/activities/pub/registrations`, where("unitId", "==", c.B.unit1.id))],
  ["dirigente A non elenca le iscrizioni di B nemmeno con l'id della propria unita'", "leaderA", false, (db, c) =>
    listWhere(db, `stakes/${c.B.id}/activities/pub/registrations`, where("unitId", "==", c.A.unit1.id))],
  ["dirigente A non legge un'iscrizione di B", "leaderA", false, (db, c) =>
    getOne(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}`)],
  ["dirigente A non elenca le iscrizioni dell'altra unita' del proprio palo", "leaderA", false, (db, c) =>
    listWhere(db, `stakes/${c.A.id}/activities/pub/registrations`, where("unitId", "==", c.A.unit2.id))],
  ["dirigente A non elenca le attivita' di B senza filtro", "leaderA", false, (db, c) => listAll(db, `stakes/${c.B.id}/activities`)],
  ["dirigente A non legge un'attivita' privata di B", "leaderA", false, (db, c) => getOne(db, `stakes/${c.B.id}/activities/priv`)],
  ["dirigente A non legge le note di trasporto di B", "leaderA", false, (db, c) => listAll(db, `stakes/${c.B.id}/activities/pub/transportNotes`)],
  ["dirigente A non scrive note di trasporto in B", "leaderA", false, (db, c) =>
    setDoc(doc(db, `stakes/${c.B.id}/activities/pub/transportNotes/${c.B.partReg}`), {
      registrationId: c.B.partReg, resolvedByUid: c.actors.leaderA.uid, resolvedAt: iso(),
    })],
  ["dirigente A non legge il piano campo di B", "leaderA", false, (db, c) => getOne(db, `stakes/${c.B.id}/activities/camp/management/camp`)],
  ["dirigente A non assegna pattuglie nel campeggio di B", "leaderA", false, (db, c) =>
    updateDoc(doc(db, `stakes/${c.B.id}/activities/camp/registrations/${c.B.partReg}`), {
      assignedPatrolId: "p1", assignedPatrolName: "Pattuglia", assignedPatrolRole: "member", assignedCommittees: [], updatedAt: iso(),
    })],
  ["dirigente B assegna pattuglie nel campeggio del proprio palo (controllo positivo)", "leaderB", true, (db, c) =>
    updateDoc(doc(db, `stakes/${c.B.id}/activities/camp/registrations/${c.B.partReg}`), {
      assignedPatrolId: "p1", assignedPatrolName: "Pattuglia", assignedPatrolRole: "member", assignedCommittees: [], updatedAt: iso(),
    })],

  // --- partecipante A -----------------------------------------------------------------
  ["partecipante A legge e salva la propria iscrizione e il proprio profilo", "participantA", true, async (db, c) => {
    await getOne(db, `users/${c.A.participant.uid}`);
    await getOne(db, `stakes/${c.A.id}/activities/pub/registrations/${c.A.partReg}`);
    await updateDoc(doc(db, `stakes/${c.A.id}/activities/pub/registrations/${c.A.partReg}`), { updatedAt: iso() });
  }],
  ["partecipante A non legge un'iscrizione di B", "participantA", false, (db, c) =>
    getOne(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}`)],
  ["partecipante A non elenca le iscrizioni di B", "participantA", false, (db, c) =>
    listAll(db, `stakes/${c.B.id}/activities/pub/registrations`)],
  ["partecipante A non elenca le iscrizioni del proprio palo", "participantA", false, (db, c) =>
    listAll(db, `stakes/${c.A.id}/activities/pub/registrations`)],
  ["partecipante A non aggiorna un'iscrizione di B", "participantA", false, (db, c) =>
    updateDoc(doc(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}`), { updatedAt: iso() })],
  ["partecipante A non cancella un'iscrizione di B", "participantA", false, (db, c) =>
    deleteDoc(doc(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}`))],
  ["partecipante A non legge un utente di B", "participantA", false, (db, c) => getOne(db, `users/${c.B.participant.uid}`)],
  ["partecipante A non elenca gli utenti di B", "participantA", false, (db, c) =>
    listWhere(db, "users", where("stakeId", "==", c.B.id))],
  ["partecipante A non elenca gli utenti del proprio palo", "participantA", false, (db, c) =>
    listWhere(db, "users", where("stakeId", "==", c.A.id))],
  ["partecipante A non legge un'attivita' privata di B", "participantA", false, (db, c) => getOne(db, `stakes/${c.B.id}/activities/priv`)],
  ["partecipante A non legge le domande di una iscrizione di B", "participantA", false, (db, c) =>
    listAll(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.partReg}/questions`)],
  ["partecipante A non legge il piano campo di B", "participantA", false, (db, c) => getOne(db, `stakes/${c.B.id}/activities/camp/management/camp`)],
  ["partecipante B legge il piano campo del proprio campeggio (controllo positivo)", "participantB", true, (db, c) =>
    getOne(db, `stakes/${c.B.id}/activities/camp/management/camp`)],

  ["partecipante A crea la propria iscrizione in un'attivita' aperta (controllo positivo, payload completo)", "participantA", true, (db, c) =>
    setDoc(
      doc(db, `stakes/${c.A.id}/activities/open/registrations/user_${c.actors.participantA.uid}`),
      registrationDoc({ firstName: "Ginevra", lastName: "Alderighi", unit: c.A.unit1, userId: c.actors.participantA.uid }),
    )],
  ["partecipante A non crea un'iscrizione a nome di un altro utente (payload valido)", "participantA", false, (db, c) =>
    setDoc(
      doc(db, `stakes/${c.A.id}/activities/open/registrations/user_${c.B.participant.uid}`),
      registrationDoc({ firstName: "Ottavia", lastName: "Zanzibar", unit: c.A.unit1, userId: c.B.participant.uid }),
    )],
  ["partecipante A non crea iscrizioni in un'attivita' non pubblica di B (payload valido)", "participantA", false, (db, c) =>
    setDoc(
      doc(db, `stakes/${c.B.id}/activities/priv/registrations/user_${c.actors.participantA.uid}`),
      registrationDoc({ firstName: "Ginevra", lastName: "Alderighi", unit: c.B.unit1, userId: c.actors.participantA.uid }),
    )],

  // --- genitore A -------------------------------------------------------------------------
  ["genitore A legge i propri figli e le loro iscrizioni", "parentA", true, async (db, c) => {
    await listAll(db, `users/${c.A.parent.uid}/children`);
    await getOne(db, `stakes/${c.A.id}/activities/pub/registrations/${c.A.childPending}`);
    const family = await getDocsFromServer(query(collectionGroup(db, "registrations"), where("parentUid", "==", c.actors.parentA.uid)));
    assert.deepEqual(
      paths(family),
      [
        `stakes/${c.A.id}/activities/pub/registrations/${c.A.childDone}`,
        `stakes/${c.A.id}/activities/pub/registrations/${c.A.childPending}`,
      ].sort(),
      "la query famiglia di A restituisce solo i figli di A",
    );
  }],
  ["genitore A crea l'iscrizione di un proprio figlio in un'attivita' aperta (controllo positivo, payload completo)", "parentA", true, (db, c) =>
    setDoc(
      doc(db, `stakes/${c.A.id}/activities/open/registrations/child_${c.actors.parentA.uid}_figlio-1`),
      registrationDoc({
        firstName: "Marco", lastName: "GenitoreA", unit: c.A.unit1, category: "giovane_uomo", status: "active",
        parentUid: c.actors.parentA.uid, childId: "figlio-1", withRequest: true,
      }),
    )],
  ["genitore A non crea un'iscrizione a nome di un figlio di un altro genitore (payload valido)", "parentA", false, (db, c) =>
    setDoc(
      doc(db, `stakes/${c.A.id}/activities/open/registrations/child_${c.B.parent.uid}_figlio-1`),
      registrationDoc({
        firstName: "Marco", lastName: "GenitoreB", unit: c.A.unit1, category: "giovane_uomo", status: "active",
        parentUid: c.B.parent.uid, childId: "figlio-1", withRequest: true,
      }),
    )],
  ["genitore B vede solo le iscrizioni dei propri figli (controllo positivo)", "parentB", true, async (db, c) => {
    const family = await getDocsFromServer(query(collectionGroup(db, "registrations"), where("parentUid", "==", c.actors.parentB.uid)));
    assert.deepEqual(
      paths(family),
      [
        `stakes/${c.B.id}/activities/pub/registrations/${c.B.childDone}`,
        `stakes/${c.B.id}/activities/pub/registrations/${c.B.childPending}`,
      ].sort(),
    );
  }],
  ["genitore A non legge tutte le iscrizioni con una collectionGroup senza filtro", "parentA", false, (db) =>
    getDocsFromServer(collectionGroup(db, "registrations"))],
  ["genitore A non usa la collectionGroup con il parentUid di un altro genitore", "parentA", false, (db, c) =>
    getDocsFromServer(query(collectionGroup(db, "registrations"), where("parentUid", "==", c.B.parent.uid)))],
  ["genitore A non legge l'iscrizione di un figlio di B", "parentA", false, (db, c) =>
    getOne(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.childPending}`)],
  ["genitore A non legge i figli di un genitore di B", "parentA", false, (db, c) => getOne(db, `users/${c.B.parent.uid}/children/figlio-1`)],
  ["genitore A non modifica i figli di un genitore di B", "parentA", false, (db, c) =>
    updateDoc(doc(db, `users/${c.B.parent.uid}/children/figlio-1`), { updatedAt: iso() })],
  ["genitore A non modifica l'iscrizione di un figlio di B", "parentA", false, (db, c) =>
    updateDoc(doc(db, `stakes/${c.B.id}/activities/pub/registrations/${c.B.childPending}`), { updatedAt: iso() })],
];

describe("RULES: isolamento fra pali", () => {
  for (const [description, actor, allowed, operation] of RULE_CASES) {
    test(description, { timeout: 60_000 }, async () => {
      const db = x.actors[actor].db;
      const attempt = operation(db, x);
      if (allowed) await expectAllowed(attempt, description);
      else await expectDenied(attempt, description);
    });
  }

  test("palo B non e' stato toccato da nessuna delle scritture negate", async () => {
    const stake = (await adminDb.doc(`stakes/${x.B.id}`).get()).data();
    assert.equal(stake.name, x.B.stake.name);
    for (const path of [
      `stakes/${x.B.id}/activities/pub`,
      `stakes/${x.B.id}/activities/pub/registrations/${x.B.partReg}`,
      `stakes/${x.B.id}/units/${x.B.unit1.id}`,
      `users/${x.B.participant.uid}`,
    ]) {
      assert.equal((await adminDb.doc(path).get()).exists, true, `${path} esiste ancora`);
    }
    assert.equal((await adminDb.doc(`users/${x.B.participant.uid}`).get()).data().role, "participant");
    assert.equal((await adminDb.doc(`stakes/${x.B.id}/units/${x.B.unit1.id}`).get()).data().name, "Rione Uno");
    assert.equal((await adminDb.doc(`stakes/${x.B.id}/activities/pub`).get()).data().title, "Viaggio test");
    for (const path of [
      `stakes/${x.B.id}/activities/pub/registrations/intruso`,
      `stakes/${x.B.id}/units/intrusa`,
      `stakes/${x.B.id}/activities/intrusa`,
      `stakes/${x.B.id}/roomLayouts/intrusa`,
    ]) {
      assert.equal((await adminDb.doc(path).get()).exists, false, `${path} non deve esistere`);
    }
  });

  // Lacuna nota, volutamente non asserita: canCreateOwnUser accetta qualunque
  // stakeId, anche di un palo che non esiste. Correzione pianificata: richiedere
  // exists(/databases/$(database)/documents/stakes/$(request.resource.data.stakeId)).
  test.todo("canCreateOwnUser rifiuta uno stakeId che non esiste (richiede exists(/stakes/$(stakeId)))");
});

// ===========================================================================
// 2. CALLABLE
// ===========================================================================
describe("CALLABLE: isolamento fra pali", () => {
  const issue = "parentAuthorizationIssueOwnToken";

  before(async () => {
    // Avvio a freddo del processo Functions: la prima chiamata puo' durare 10-20 s.
    const warmup = await x.actors.parentA.call("parentAuthorizationGetContext", { token: "avvio" });
    assert.equal(warmup.data.status, "not_found");
  });

  test("issueOwnToken: il genitore firma per i propri figli e non per quelli di un altro", { timeout: 120_000 }, async () => {
    const { A, B, actors } = x;
    const tokensOf = async (stakeId, registrationId) =>
      (await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", stakeId).where("registrationId", "==", registrationId).get()).docs;

    await expectCallableCode(
      actors.parentB.call(issue, { stakeId: A.id, activityId: "pub", registrationId: A.childPending }),
      "permission-denied", "genitore B sul figlio di A",
    );
    await expectCallableCode(
      actors.parentA.call(issue, { stakeId: B.id, activityId: "pub", registrationId: B.childPending }),
      "permission-denied", "genitore A sul figlio di B",
    );
    await expectCallableCode(
      actors.participantA.call(issue, { stakeId: A.id, activityId: "pub", registrationId: A.childPending }),
      "permission-denied", "partecipante A sul figlio di A",
    );
    await expectCallableCode(
      actors.signedOut.call(issue, { stakeId: A.id, activityId: "pub", registrationId: A.childPending }),
      "unauthenticated", "visitatore",
    );

    // Nessun effetto collaterale dei rifiuti.
    const before = await tokensOf(A.id, A.childPending);
    assert.deepEqual(before.map((d) => [d.id, d.data().status]), [[A.pendingToken, "pending"]]);
    assert.equal((await tokensOf(B.id, B.childPending)).length, 1);

    const response = await actors.parentA.call(issue, { stakeId: A.id, activityId: "pub", registrationId: A.childPending });
    assert.equal(response.data.ok, true);
    assert.match(response.data.token, /^[0-9a-f]{64}$/u);

    const issued = (await adminDb.doc(`parentAuthorizationTokens/${sha256(response.data.token)}`).get()).data();
    assert.equal(issued.stakeId, A.id);
    assert.equal(issued.activityId, "pub");
    assert.equal(issued.registrationId, A.childPending);
    assert.equal(issued.createdByMode, "self");
    assert.equal(issued.createdByUserId, actors.parentA.uid);
    assert.equal((await adminDb.doc(`parentAuthorizationTokens/${A.pendingToken}`).get()).data().status, "invalidated");
    // Il token di B non e' stato toccato.
    assert.equal((await adminDb.doc(`parentAuthorizationTokens/${B.pendingToken}`).get()).data().status, "pending");
  });

  test("issueOwnToken: l'invalidazione e' limitata a palo e attivita' (stesso id iscrizione in tre posti)", { timeout: 120_000 }, async () => {
    const { A, B } = x;
    const parentT = await createUser({
      key: "parent-t", role: "parent", firstName: "Teresa", lastName: "Token", stake: A.stake, unit: A.unit1,
    });
    const client = await signIn(parentT.email);
    const registrationId = `child_${parentT.uid}_figlio-t`;
    const seeds = [
      { stakeId: A.id, activityId: "tok-x", unit: A.unit1 },
      { stakeId: A.id, activityId: "tok-y", unit: A.unit1 },
      { stakeId: B.id, activityId: "tok-x2", unit: B.unit1 },
    ];
    const tokenIds = {};
    for (const { stakeId, activityId, unit } of seeds) {
      const tokenId = crypto.randomBytes(32).toString("hex");
      tokenIds[`${stakeId}/${activityId}`] = tokenId;
      await adminDb.doc(`stakes/${stakeId}/activities/${activityId}`).set(activityDoc(`Attivita ${activityId}`));
      await adminDb.doc(`stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`).set(
        registrationDoc({
          firstName: "Figlio", lastName: "Test", unit, status: "pending_parent_authorization",
          parentUid: parentT.uid, childId: "figlio-t", parentAuthorization: pendingAuthorization(tokenId), withRequest: true,
        }),
      );
      await adminDb.doc(`parentAuthorizationTokens/${tokenId}`).set(tokenDoc({ id: tokenId, stakeId, activityId, registrationId }));
    }
    const status = async (stakeId, activityId) =>
      (await adminDb.doc(`parentAuthorizationTokens/${tokenIds[`${stakeId}/${activityId}`]}`).get()).data().status;
    const registrationToken = async (stakeId, activityId) =>
      (await adminDb.doc(`stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`).get()).data().parentAuthorization.tokenId;

    // Il trigger onRegistrationPendingParentAuth sui seed non deve creare altri token (tokenId gia' presente).
    await sleep(1500);

    const first = await client.call(issue, { stakeId: A.id, activityId: "tok-x", registrationId });
    assert.equal(first.data.ok, true);
    assert.equal(await status(A.id, "tok-x"), "invalidated", "il token di A/X e' invalidato");
    assert.equal(await status(A.id, "tok-y"), "pending", "A/Y resta valido");
    assert.equal(await status(B.id, "tok-x2"), "pending", "B/X2 resta valido");
    assert.equal(await registrationToken(A.id, "tok-y"), tokenIds[`${A.id}/tok-y`]);
    assert.equal(await registrationToken(B.id, "tok-x2"), tokenIds[`${B.id}/tok-x2`]);
    assert.equal((await adminDb.collection(`stakes/${A.id}/activities/tok-y/consentAuditLogs`).get()).size, 0, "nessun log su A/Y");
    assert.equal((await adminDb.collection(`stakes/${B.id}/activities/tok-x2/consentAuditLogs`).get()).size, 0, "nessun log su B/X2");
    const invalidations = (await adminDb.collection(`stakes/${A.id}/activities/tok-x/consentAuditLogs`).get()).docs
      .map((d) => d.data()).filter((d) => d.event === "token_invalidated");
    assert.deepEqual(invalidations.map((d) => d.tokenId), [tokenIds[`${A.id}/tok-x`]]);

    // Specchio: emettere per B/X2 non tocca ne' A/X (token nuovo compreso) ne' A/Y.
    const newTokenOfAX = sha256(first.data.token);
    const second = await client.call(issue, { stakeId: B.id, activityId: "tok-x2", registrationId });
    assert.equal(second.data.ok, true);
    assert.equal(await status(B.id, "tok-x2"), "invalidated");
    assert.equal(await status(A.id, "tok-y"), "pending");
    assert.equal((await adminDb.doc(`parentAuthorizationTokens/${newTokenOfAX}`).get()).data().status, "pending", "il token nuovo di A/X resta pending");
  });

  test("roomManagementSave: l'admin di A non scrive nel palo B", { timeout: 120_000 }, async () => {
    const { A, B, actors } = x;
    const plan = { rooms: [], assignments: {}, lockedIds: [], adultGenders: {}, couples: [], revision: 0, updatedAt: "" };
    const request = (stakeId, activityId) => ({ stakeId, activityId, expectedRevision: 0, plan });
    const roomsOf = async (stakeId) => (await adminDb.doc(`stakes/${stakeId}/activities/camp/management/rooms`).get()).exists;

    await expectCallableCode(actors.adminA.call("roomManagementSave", request(B.id, "camp")), "permission-denied", "admin A su B/camp");
    await expectCallableCode(
      actors.adminA.call("roomManagementSave", request(B.id, "attivita-inesistente")),
      "permission-denied", "admin A su attivita' inesistente di B (nessun oracolo di esistenza)",
    );
    await expectCallableCode(actors.leaderA.call("roomManagementSave", request(B.id, "camp")), "permission-denied", "dirigente A su B");
    await expectCallableCode(actors.participantA.call("roomManagementSave", request(B.id, "camp")), "permission-denied", "partecipante A su B");
    await expectCallableCode(actors.leaderB.call("roomManagementSave", request(B.id, "camp")), "permission-denied", "dirigente B (non admin)");
    assert.equal(await roomsOf(B.id), false, "nessun piano stanze scritto in B dai rifiuti");

    const saved = await actors.adminB.call("roomManagementSave", request(B.id, "camp"));
    assert.equal(saved.data.plan.revision, 1, "l'admin di B salva nel proprio palo");
    assert.equal(await roomsOf(B.id), true);
    assert.equal(await roomsOf(A.id), false, "il salvataggio di B non scrive in A");
    const own = await actors.adminA.call("roomManagementSave", request(A.id, "camp"));
    assert.equal(own.data.plan.revision, 1, "l'admin di A salva nel proprio palo (controllo positivo)");
  });

  test("campManagementSave: l'admin di A non scrive nel palo B", { timeout: 120_000 }, async () => {
    const { A, B, actors } = x;
    const request = (stakeId, activityId) => ({ stakeId, activityId, plan: { committees: [], patrols: [], manualLeaders: [] } });
    const campPlan = async (stakeId) => (await adminDb.doc(`stakes/${stakeId}/activities/camp/management/camp`).get()).data();
    const registrationStamp = async (stakeId) =>
      (await adminDb.doc(`stakes/${stakeId}/activities/camp/registrations/${stakeId === B.id ? B.partReg : A.partReg}`).get()).data().updatedAt;
    const planBefore = await campPlan(B.id);
    const planABefore = await campPlan(A.id);
    const stampBefore = await registrationStamp(B.id);

    await expectCallableCode(actors.adminA.call("campManagementSave", request(B.id, "camp")), "permission-denied", "admin A su B/camp");
    await expectCallableCode(
      actors.adminA.call("campManagementSave", request(B.id, "attivita-inesistente")),
      "permission-denied", "admin A su attivita' inesistente di B (nessun oracolo di esistenza)",
    );
    await expectCallableCode(actors.leaderA.call("campManagementSave", request(B.id, "camp")), "permission-denied", "dirigente A su B");
    await expectCallableCode(actors.participantA.call("campManagementSave", request(B.id, "camp")), "permission-denied", "partecipante A su B");
    assert.deepEqual(await campPlan(B.id), planBefore, "il piano campo di B e' intatto");
    assert.equal(await registrationStamp(B.id), stampBefore, "le iscrizioni di B non sono state sincronizzate");

    const saved = await actors.adminB.call("campManagementSave", request(B.id, "camp"));
    assert.equal(saved.data.ok, true, "l'admin di B salva nel proprio palo");
    assert.notEqual((await campPlan(B.id)).updatedAt, planBefore.updatedAt, "il piano campo di B e' stato salvato");
    const savedByLeader = await actors.leaderB.call("campManagementSave", request(B.id, "camp"));
    assert.equal(savedByLeader.data.ok, true, "il dirigente di B salva nel proprio palo");
    assert.deepEqual(await campPlan(A.id), planABefore, "il palo A non e' stato scritto dai salvataggi di B");
  });

  test("roomMateSuggestions: il partecipante di A non interroga il palo B", { timeout: 120_000 }, async () => {
    const { actors } = x;
    await expectCallableCode(
      actors.participantA.call("roomMateSuggestions", { stakeId: x.B.id, query: "Zanzibar" }),
      "permission-denied", "partecipante A con stakeId B",
    );
    await expectCallableCode(
      actors.participantB.call("roomMateSuggestions", { stakeId: x.A.id, query: "Alderighi" }),
      "permission-denied", "partecipante B con stakeId A",
    );

    const own = await actors.participantA.call("roomMateSuggestions", { stakeId: x.A.id, query: "Alderighi" });
    assert.ok(own.data.suggestions.some((s) => s.name === "Ginevra Alderighi"), "A trova i propri giovani");
    const leak = await actors.participantA.call("roomMateSuggestions", { stakeId: x.A.id, query: "Zanzibar" });
    assert.deepEqual(leak.data.suggestions, [], "i nomi di B non compaiono nel bacino di A");
    const ownB = await actors.participantB.call("roomMateSuggestions", { stakeId: x.B.id, query: "Zanzibar" });
    assert.ok(ownB.data.suggestions.some((s) => s.name === "Ottavia Zanzibar"));
  });
});

// ===========================================================================
// 3. TRIGGER propagateUnitNameChange
// ===========================================================================
describe("TRIGGER: propagateUnitNameChange", () => {
  test("rinominare un'unita' di A non riscrive gli utenti di B con lo stesso id unita'", { timeout: 90_000 }, async () => {
    const stakes = { A: `iso-ua-${runId}`, B: `iso-ub-${runId}` };
    for (const stakeId of Object.values(stakes)) track.stakes.add(stakeId);
    const sharedUnitId = `rione-aurora-${runId}`; // lo slug del nome: identico fra due pali
    const OLD = "Rione Aurora";
    const NEW = "Rione Aurora Rinnovato";
    const oldStamp = "2026-01-01T00:00:00.000Z";
    const now = iso();
    const userIds = {};

    for (const [key, stakeId] of Object.entries(stakes)) {
      await adminDb.doc(`stakes/${stakeId}/units/${sharedUnitId}`).set({ name: OLD, type: "rione", isActive: true, createdAt: now, updatedAt: now });
      await adminDb.doc(`stakes/${stakeId}/units/altra-unita`).set({ name: "Altra", type: "rione", isActive: true, createdAt: now, updatedAt: now });
      await adminDb.doc(`stakes/${stakeId}/activities/pub`).set(activityDoc("Attivita trigger"));
      userIds[key] = [];
      for (const [index, unitId] of [sharedUnitId, sharedUnitId, "altra-unita"].entries()) {
        const userId = uid(`trg-${key.toLowerCase()}-${index}`);
        track.uids.add(userId);
        userIds[key].push({ userId, unitId });
        await adminDb.doc(`users/${userId}`).set({
          ...buildUserDocument({
            firstName: "Utente", lastName: `${key}${index}`, role: "participant",
            stake: { id: stakeId, slug: stakeId, name: `Palo ${key}` },
            unit: { id: unitId, name: unitId === sharedUnitId ? OLD : "Altra" }, now: oldStamp,
          }),
        });
      }
      await adminDb.doc(`stakes/${stakeId}/activities/pub/registrations/reg-${key.toLowerCase()}`).set({
        ...registrationDoc({ firstName: "Iscritto", lastName: key, unit: { id: sharedUnitId, name: OLD } }),
        updatedAt: oldStamp,
      });
    }
    // Il trigger onCreate delle iscrizioni scrive avvisi: non interessano a questo test.

    await adminDb.doc(`stakes/${stakes.A}/units/${sharedUnitId}`).update({ name: NEW, updatedAt: iso() });

    const read = async (key) => Promise.all(userIds[key].map(async ({ userId }) => (await adminDb.doc(`users/${userId}`).get()).data()));
    const usersA = await waitFor(
      () => read("A"),
      (docs) => docs[0].unitName === NEW && docs[1].unitName === NEW,
      "la propagazione del nome sugli utenti di A",
      30_000,
    );
    assert.equal(usersA[2].unitName, "Altra", "un'altra unita' dello stesso palo non cambia");
    const regA = await waitFor(
      async () => (await adminDb.doc(`stakes/${stakes.A}/activities/pub/registrations/reg-a`).get()).data(),
      (data) => data.unitNameSnapshot === NEW,
      "la propagazione sulle iscrizioni di A",
    );
    assert.equal(regA.unitNameSnapshot, NEW);

    await sleep(1500); // eventuali scritture in ritardo verso B
    const usersB = await read("B");
    for (const user of usersB) {
      assert.notEqual(user.unitName, NEW, "gli utenti di B non devono ricevere il nome nuovo di A");
    }
    assert.equal(usersB[0].unitName, OLD);
    assert.equal(usersB[1].unitName, OLD);
    assert.equal(usersB[0].updatedAt, oldStamp, "gli utenti di B non sono stati riscritti");
    assert.equal(usersB[1].updatedAt, oldStamp);
    const regB = (await adminDb.doc(`stakes/${stakes.B}/activities/pub/registrations/reg-b`).get()).data();
    assert.equal(regB.unitNameSnapshot, OLD);
    assert.equal(regB.updatedAt, oldStamp);
  });
});

// ===========================================================================
// 4. EMAIL: fuori da produzione la mail iniziale e' simulata
// ===========================================================================
describe("EMAIL: simulazione fuori da produzione", () => {
  test("la mail iniziale di autorizzazione e' simulata, non fallisce e non crea token fuori dal palo", { timeout: 90_000 }, async () => {
    const { B } = x;
    const parentUid = uid("parent-mail");
    const childId = "figlio-m";
    const registrationId = `child_${parentUid}_${childId}`;
    const activityId = "mail";
    const registrationPath = `stakes/${B.id}/activities/${activityId}/registrations/${registrationId}`;
    await adminDb.doc(`stakes/${B.id}/activities/${activityId}`).set(activityDoc("Attivita mail test", { location: "Roma" }));

    // Nessun parentAuthorization.tokenId: il trigger deve mandare la mail iniziale.
    await adminDb.doc(registrationPath).set(
      registrationDoc({
        firstName: "Figlio", lastName: "Mail", unit: B.unit1, status: "pending_parent_authorization",
        parentUid, childId, withRequest: true,
      }),
    );

    const read = async () => {
      const data = (await adminDb.doc(registrationPath).get()).data();
      const logs = await adminDb.collection(`stakes/${B.id}/activities/${activityId}/consentAuditLogs`).get();
      return {
        state: data?.parentAuthorization ?? null,
        events: logs.docs.map((d) => d.data().event).sort(),
        logs: logs.docs.map((d) => d.data()),
      };
    };
    const settled = await waitFor(
      read,
      ({ state, events }) => state?.status === "email_sent" && events.includes("email_sent"),
      "la mail iniziale (stato email_sent e log email_sent)",
      60_000,
    );
    assert.equal(settled.state.brevoMessageId, null, "simulata: nessun messageId di Brevo");
    assert.equal(settled.state.emailLastError, null);
    assert.ok(!settled.events.includes("email_failed"), `nessun invio fallito (eventi: ${settled.events})`);
    assert.ok(settled.events.includes("authorization_requested"));
    const sentLog = settled.logs.find((entry) => entry.event === "email_sent");
    assert.equal(sentLog.emailProvider, "simulated", "l'audit dice che la mail e' simulata, non inviata da Brevo");
    assert.equal(sentLog.brevoMessageId, null);

    const tokens = await adminDb.collection("parentAuthorizationTokens").where("registrationId", "==", registrationId).get();
    assert.equal(tokens.size, 1, "un solo token per l'iscrizione, in tutta la base dati");
    const token = tokens.docs[0].data();
    assert.equal(token.stakeId, B.id);
    assert.equal(token.activityId, activityId);
    assert.equal(token.status, "pending");
    assert.equal(token.parentEmail, "genitore@example.invalid");
    assert.equal(settled.state.tokenId, tokens.docs[0].id);

    // Nessuna rincorsa del trigger su se stesso e nessun email_error piu' tardi.
    await sleep(4000);
    const later = await read();
    assert.equal(later.state.status, "email_sent", "lo stato non finisce mai in email_error");
    assert.ok(!later.events.includes("email_failed"));
    const tokensLater = await adminDb.collection("parentAuthorizationTokens").where("registrationId", "==", registrationId).get();
    assert.equal(tokensLater.size, 1, "nessun token in piu' dopo qualche secondo");
  });
});

// ===========================================================================
// 5. create-stake (tools/lib/stakes.mjs)
// ===========================================================================
describe("create-stake", () => {
  const ctx = () => ({ db: adminDb, auth: adminAuth });
  const authUserExists = async (email) => {
    try {
      await adminAuth.getUserByEmail(email);
      return true;
    } catch (error) {
      if (error.code === "auth/user-not-found") return false;
      throw error;
    }
  };

  test("rifiuta un id palo gia' esistente senza sovrascriverlo", async () => {
    const before = (await adminDb.doc(`stakes/${x.A.id}`).get()).data();
    await assert.rejects(
      createStake(ctx(), { stakeId: x.A.id, name: "Sovrascrittura", units: [{ name: "Rione Nuovo" }], apply: true }),
      /esiste gia/,
    );
    assert.deepEqual((await adminDb.doc(`stakes/${x.A.id}`).get()).data(), before, "il palo esistente e' intatto");
    assert.equal((await adminDb.doc(`stakes/${x.A.id}/units/${x.A.id}-rione-nuovo`).get()).exists, false);
  });

  test("rifiuta id non validi, nome mancante e unita' duplicate", async () => {
    await assert.rejects(createStake(ctx(), { stakeId: "AB", name: "Corto" }), /Id palo non valido/);
    await assert.rejects(createStake(ctx(), { stakeId: "con spazi", name: "Spazi" }), /Id palo non valido/);
    await assert.rejects(createStake(ctx(), { stakeId: `iso-noname-${runId}`, name: "  " }), /Nome del palo mancante/);
    track.stakes.add(`iso-dup-${runId}`);
    await assert.rejects(
      createStake(ctx(), { stakeId: `iso-dup-${runId}`, name: "Doppioni", units: [{ name: "Rione Uno" }, { name: "rione uno" }], apply: true }),
      /stesso nome/,
    );
    assert.equal((await adminDb.doc(`stakes/iso-dup-${runId}`).get()).exists, false);
  });

  test("con un admin e senza unita' lancia e non scrive niente", async () => {
    const stakeId = `iso-nounit-${runId}`;
    track.stakes.add(stakeId);
    const email = emailOf("admin-nounit");
    await assert.rejects(
      createStake(ctx(), { stakeId, name: "Senza unita", admin: { email, firstName: "Mario", lastName: "Rossi", password: PASSWORD }, apply: true }),
      /almeno un'unita/,
    );
    assert.equal((await adminDb.doc(`stakes/${stakeId}`).get()).exists, false);
    assert.equal(await authUserExists(email), false, "nessun account Auth creato");
  });

  test("rifiuta un admin la cui unita' non e' fra quelle del palo, o con un account di un altro palo", async () => {
    const stakeId = `iso-badadmin-${runId}`;
    track.stakes.add(stakeId);
    await assert.rejects(
      createStake(ctx(), {
        stakeId, name: "Admin sbagliato", units: [{ name: "Rione Uno" }],
        admin: { email: emailOf("admin-badunit"), firstName: "Mario", lastName: "Rossi", unit: "Rione Inesistente", password: PASSWORD },
        apply: true,
      }),
      /non e' fra quelle del palo/,
    );
    // L'admin di A ha gia' un profilo nel palo A: non si sposta in un palo nuovo.
    await assert.rejects(
      createStake(ctx(), {
        stakeId, name: "Admin rubato", units: [{ name: "Rione Uno" }],
        admin: { email: x.A.admin.email, firstName: "Admin", lastName: "Rubato", password: PASSWORD },
        apply: true,
      }),
      /ha gia' un profilo nel palo/,
    );
    assert.equal((await adminDb.doc(`stakes/${stakeId}`).get()).exists, false);
    assert.equal((await adminDb.doc(`users/${x.A.admin.uid}`).get()).data().stakeId, x.A.id, "il profilo dell'admin di A non e' stato spostato");
    assert.equal(await authUserExists(emailOf("admin-badunit")), false);
  });

  test("dry-run (apply: false) non scrive niente", async () => {
    const stakeId = `iso-dry-${runId}`;
    track.stakes.add(stakeId);
    const email = emailOf("admin-dry");
    const result = await createStake(ctx(), {
      stakeId, name: "Palo dry-run", units: [{ name: "Rione Uno" }, { name: "Ramo Due", type: "ramo" }],
      admin: { email, firstName: "Dry", lastName: "Run", password: PASSWORD }, apply: false,
    });
    assert.equal(result.applied, false);
    assert.equal(result.plan.stake, `stakes/${stakeId}`);
    assert.deepEqual(result.plan.units, [`stakes/${stakeId}/units/${stakeId}-rione-uno`, `stakes/${stakeId}/units/${stakeId}-ramo-due`]);
    assert.equal((await adminDb.doc(`stakes/${stakeId}`).get()).exists, false);
    assert.equal((await adminDb.collection(`stakes/${stakeId}/units`).get()).size, 0);
    assert.equal((await adminDb.collection("users").where("email", "==", email).get()).size, 0);
    assert.equal(await authUserExists(email), false);
  });

  test("con admin e unita' crea un admin che supera la scrittura di login dell'app", { timeout: 60_000 }, async () => {
    const stakeId = `iso-new-${runId}`;
    track.stakes.add(stakeId);
    const email = emailOf("admin-new");
    const result = await createStake(ctx(), {
      stakeId, name: "Palo Nuovo", units: [{ name: "Rione Uno" }, { name: "Ramo Due", type: "ramo" }],
      admin: { email, firstName: "Nuovo", lastName: "Admin", password: PASSWORD }, apply: true,
    });
    assert.equal(result.applied, true);
    const adminUid = result.adminUid;
    assert.ok(adminUid, "createStake restituisce l'uid dell'admin");
    track.uids.add(adminUid);
    assert.deepEqual(result.units.map((u) => u.id), [`${stakeId}-rione-uno`, `${stakeId}-ramo-due`]);
    assert.deepEqual(result.units.map((u) => u.type), ["rione", "ramo"]);

    // Un secondo giro sullo stesso id e' rifiutato: niente duplicati.
    await assert.rejects(createStake(ctx(), { stakeId, name: "Palo Nuovo", units: [{ name: "Rione Uno" }], apply: true }), /esiste gia/);

    const stored = (await adminDb.doc(`users/${adminUid}`).get()).data();
    assert.equal(stored.role, "admin");
    assert.equal(stored.stakeId, stakeId);
    assert.equal(stored.unitId, `${stakeId}-rione-uno`);
    assert.equal(stored.unitName, "Rione Uno");
    assert.equal(stored.mustChangePassword, false);

    const admin = await signIn(email);
    const own = (await getOne(admin.db, `users/${adminUid}`)).data();
    const stamp = iso();
    // Come l'app al login (usersService.ensureUserProfile): payload con lastLoginAt/updatedAt nuovi, merge.
    await expectAllowed(
      setDoc(doc(admin.db, `users/${adminUid}`), { ...own, lastLoginAt: stamp, updatedAt: stamp }, { merge: true }),
      "login write con il profilo letto",
    );
    await expectAllowed(
      setDoc(
        doc(admin.db, `users/${adminUid}`),
        {
          firstName: own.firstName, lastName: own.lastName, fullName: own.fullName, email: own.email,
          phone: "", role: own.role, city: "", birthDate: own.birthDate, genderRoleCategory: own.genderRoleCategory,
          unitId: own.unitId, unitName: own.unitName, stakeId: own.stakeId, stakeSlug: own.stakeSlug, stakeName: own.stakeName,
          mustChangePassword: own.mustChangePassword, createdAt: own.createdAt, updatedAt: iso(), lastLoginAt: iso(),
        },
        { merge: true },
      ),
      "login write nella forma esatta dell'app",
    );

    // Il nuovo admin governa il proprio palo, non quello degli altri.
    await expectAllowed(listWhere(admin.db, "users", where("stakeId", "==", stakeId)), "elenco utenti del nuovo palo");
    await expectAllowed(listAll(admin.db, `stakes/${stakeId}/units`), "unita' del nuovo palo");
    await expectAllowed(
      setDoc(doc(admin.db, `stakes/${stakeId}/activities/prima`), { title: "Prima attivita", isPublic: false }),
      "prima attivita' del nuovo palo",
    );
    await expectDenied(getOne(admin.db, `users/${x.A.participant.uid}`), "utente del palo A");
    await expectDenied(listAll(admin.db, `stakes/${x.A.id}/activities/pub/registrations`), "iscrizioni del palo A");
    await expectDenied(setDoc(doc(admin.db, `stakes/${x.A.id}/units/intrusa`), { name: "x", type: "rione", isActive: true, createdAt: stamp, updatedAt: stamp }), "unita' del palo A");
    // E viceversa: l'admin di A non entra nel palo nuovo.
    await expectDenied(listAll(x.actors.adminA.db, `stakes/${stakeId}/activities`), "admin A sul palo nuovo");
    await expectDenied(getOne(x.actors.adminA.db, `users/${adminUid}`), "admin A sul profilo del nuovo admin");
  });

  test("CLI tools/create-stake.mjs: dry-run senza scritture, poi creazione con admin e login", { timeout: 120_000 }, async () => {
    const repoRoot = new URL("../..", import.meta.url).pathname;
    const cli = (...args) =>
      spawnSync(process.execPath, ["tools/create-stake.mjs", "--project", PROJECT, ...args], {
        cwd: repoRoot, env: process.env, encoding: "utf8", timeout: 60_000,
      });
    const stakeId = `iso-cli-${runId}`;
    track.stakes.add(stakeId);
    const email = emailOf("admin-cli");
    const common = [
      "--id", stakeId, "--name", "Palo CLI", "--unit", "Rione Uno", "--unit", "Ramo Due:ramo",
      "--admin-email", email, "--admin-first", "Carla", "--admin-last", "Cli", "--admin-unit", "Ramo Due",
      "--admin-birth-date", "1975-06-15",
    ];

    const dry = cli(...common);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Dry-run: nessuna scrittura/);
    assert.equal((await adminDb.doc(`stakes/${stakeId}`).get()).exists, false);
    assert.equal(await authUserExists(email), false);

    const applied = cli(...common, "--apply", "--admin-password", PASSWORD);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /creato/);
    const units = await adminDb.collection(`stakes/${stakeId}/units`).get();
    assert.deepEqual(units.docs.map((d) => [d.id, d.data().type]).sort(), [
      [`${stakeId}-ramo-due`, "ramo"], [`${stakeId}-rione-uno`, "rione"],
    ]);
    const adminUid = (await adminAuth.getUserByEmail(email)).uid;
    track.uids.add(adminUid);
    const profile = (await adminDb.doc(`users/${adminUid}`).get()).data();
    assert.equal(profile.role, "admin");
    assert.equal(profile.unitId, `${stakeId}-ramo-due`, "--admin-unit rispettato");
    assert.equal(profile.birthDate, "1975-06-15", "--admin-birth-date rispettato");
    const admin = await signIn(email);
    const stamp = iso();
    await expectAllowed(
      setDoc(doc(admin.db, `users/${adminUid}`), { ...profile, lastLoginAt: stamp, updatedAt: stamp }, { merge: true }),
      "login write dell'admin creato dalla CLI",
    );

    const again = cli(...common, "--apply", "--admin-password", PASSWORD);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /esiste gia/);
    const wrongProject = spawnSync(process.execPath, ["tools/create-stake.mjs", "--project", "giovani-palo", "--id", `iso-cli2-${runId}`, "--name", "x"], {
      cwd: repoRoot, env: process.env, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(wrongProject.status, 1);
    assert.match(wrongProject.stderr, /contraddice/);
    assert.equal((await adminDb.doc(`stakes/iso-cli2-${runId}`).get()).exists, false);
  });

  test("admin.uid e' l'uid desiderato per un account nuovo (creato con quell'uid)", { timeout: 60_000 }, async () => {
    const stakeId = `iso-uid-${runId}`;
    track.stakes.add(stakeId);
    const adminUid = uid("admin-uid");
    track.uids.add(adminUid);
    const email = emailOf("admin-uid");
    const input = {
      stakeId, name: "Palo uid", units: [{ name: "Rione Uno" }],
      admin: { uid: adminUid, email, firstName: "Uid", lastName: "Esplicito", password: PASSWORD },
    };
    const plan = await createStake(ctx(), { ...input, apply: false });
    assert.equal(plan.plan.admin.authUser, "da creare");
    assert.equal(await authUserExists(email), false, "il dry-run non crea l'account");

    const result = await createStake(ctx(), { ...input, apply: true });
    assert.equal(result.adminUid, adminUid);
    const authUser = await adminAuth.getUser(adminUid);
    assert.equal(authUser.email, email);
    const profile = (await adminDb.doc(`users/${adminUid}`).get()).data();
    assert.equal(profile.stakeId, stakeId);
    assert.equal(profile.role, "admin");
    const client = await signIn(email);
    assert.equal(client.uid, adminUid, "l'accesso restituisce l'uid richiesto");
    const stamp = iso();
    await expectAllowed(
      setDoc(doc(client.db, `users/${adminUid}`), { ...profile, lastLoginAt: stamp, updatedAt: stamp }, { merge: true }),
      "login write con uid esplicito",
    );
  });

  test("admin.uid di un account Auth gia' esistente: viene riusato, senza toccarne la password", { timeout: 60_000 }, async () => {
    const stakeId = `iso-reuse-${runId}`;
    track.stakes.add(stakeId);
    const adminUid = uid("admin-reuse");
    track.uids.add(adminUid);
    const email = emailOf("admin-reuse");
    await adminAuth.createUser({ uid: adminUid, email, password: PASSWORD, emailVerified: true });
    const input = {
      stakeId, name: "Palo riuso", units: [{ name: "Rione Uno" }],
      admin: { uid: adminUid, email, firstName: "Riuso", lastName: "Esistente", password: "Altra-password-1!" },
    };
    const plan = await createStake(ctx(), { ...input, apply: false });
    assert.equal(plan.plan.admin.authUser, "esistente");

    const result = await createStake(ctx(), { ...input, apply: true });
    assert.equal(result.adminUid, adminUid);
    assert.equal((await adminAuth.getUserByEmail(email)).uid, adminUid, "un solo account per quell'email");
    assert.equal((await adminDb.doc(`users/${adminUid}`).get()).data().stakeId, stakeId);
    const client = await signIn(email, PASSWORD); // la password originale vale ancora
    assert.equal(client.uid, adminUid);
    await expectAllowed(listWhere(client.db, "users", where("stakeId", "==", stakeId)), "elenco utenti del palo riusato");
  });

  // Con admin.uid di un account esistente, l'email passata non viene confrontata con
  // quella dell'account: il profilo users/{uid} nasce con un'email diversa da quella
  // con cui l'admin accede (senza password lo script fallisce piu' tardi su
  // generatePasswordResetLink, con password no). Meglio rifiutare subito.
  test(
    "admin.uid di un account esistente con un'email diversa da quella indicata: rifiutato, niente scritto",
    async () => {
      const stakeId = `iso-mismatch-${runId}`;
      track.stakes.add(stakeId);
      const adminUid = uid("admin-mismatch");
      track.uids.add(adminUid);
      await adminAuth.createUser({ uid: adminUid, email: emailOf("admin-mismatch-auth"), password: PASSWORD, emailVerified: true });
      await assert.rejects(
        createStake(ctx(), {
          stakeId, name: "Email diversa", units: [{ name: "Rione Uno" }],
          admin: { uid: adminUid, email: emailOf("admin-mismatch-other"), firstName: "Email", lastName: "Diversa", password: PASSWORD },
          apply: true,
        }),
      );
      assert.equal((await adminDb.doc(`stakes/${stakeId}`).get()).exists, false);
    },
  );

  test("admin.uid di un account con profilo in un altro palo: rifiutato, niente scritto", async () => {
    const stakeId = `iso-uidother-${runId}`;
    track.stakes.add(stakeId);
    await assert.rejects(
      createStake(ctx(), {
        stakeId, name: "Palo rubato", units: [{ name: "Rione Uno" }],
        admin: { uid: x.A.admin.uid, email: x.A.admin.email, firstName: "Admin", lastName: "Rubato", password: PASSWORD },
        apply: true,
      }),
      /ha gia' un profilo nel palo/,
    );
    assert.equal((await adminDb.doc(`stakes/${stakeId}`).get()).exists, false);
    assert.equal((await adminDb.doc(`users/${x.A.admin.uid}`).get()).data().stakeId, x.A.id);
  });

  test("admin.uid nuovo ma email gia' di un altro account: l'apply fallisce e non scrive il palo", async () => {
    const stakeId = `iso-mailtaken-${runId}`;
    track.stakes.add(stakeId);
    const adminUid = uid("admin-mailtaken");
    track.uids.add(adminUid);
    await assert.rejects(
      createStake(ctx(), {
        stakeId, name: "Email occupata", units: [{ name: "Rione Uno" }],
        admin: { uid: adminUid, email: x.A.admin.email, firstName: "Doppio", lastName: "Account", password: PASSWORD },
        apply: true,
      }),
      (error) => error?.code === "auth/email-already-exists",
    );
    assert.equal((await adminDb.doc(`stakes/${stakeId}`).get()).exists, false, "nessun palo a meta'");
    assert.equal((await adminDb.doc(`users/${adminUid}`).get()).exists, false);
    await assert.rejects(adminAuth.getUser(adminUid), (error) => error?.code === "auth/user-not-found");
  });
});

// ===========================================================================
// 6. DATI DEMO (tools/lib/demoData.mjs)
// ===========================================================================
const RULES_TEXT = fs.readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");

function ruleAllowlist(functionName) {
  const match = RULES_TEXT.match(
    new RegExp(`function ${functionName}\\(data\\) \\{\\s*return data\\.keys\\(\\)\\.hasOnly\\(\\[([\\s\\S]*?)\\]\\)`),
  );
  assert.ok(match, `allowlist hasOnly di ${functionName} non trovata in firestore.rules`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

describe("dati demo: forma dei documenti", () => {
  const input = { today: "2026-10-06", parentEmail: "", appUrl: "http://localhost:5173" };
  const dataset = buildDemoDataset({ ...input, stakeId: DEMO_STAKE_ID });

  test("senza stakeId ne' prefix il dataset e' quello di palo-demo (default)", () => {
    assert.deepEqual(buildDemoDataset(input).docs, dataset.docs);
  });

  test("il dataset e' deterministico, senza indirizzi veri e senza percorsi duplicati", () => {
    const again = buildDemoDataset({ ...input, stakeId: DEMO_STAKE_ID });
    assert.deepEqual(again.docs, dataset.docs);
    const pathList = dataset.docs.map((entry) => entry.path);
    assert.equal(new Set(pathList).size, pathList.length, "percorsi unici");
    const emails = JSON.stringify(dataset.docs).match(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+/g) ?? [];
    assert.ok(emails.length > 0);
    for (const email of emails) assert.match(email, /\.invalid$/, `indirizzo non sintetico nel seed: ${email}`);
  });

  test("ogni documento usa solo le chiavi ammesse dalle rules (hasOnly)", () => {
    const allowed = {
      user: ruleAllowlist("validUserPayload"),
      registration: ruleAllowlist("validRegistrationPayload"),
      child: ruleAllowlist("validChildPayload"),
    };
    for (const data of [dataset, buildDemoDataset({ ...input, stakeId: `iso-x-${runId}`, prefix: `isox${runId}` })]) {
      let checked = 0;
      for (const { path, data: body } of data.docs) {
        const kind = /^users\/[^/]+$/.test(path)
          ? "user"
          : /^users\/[^/]+\/children\/[^/]+$/.test(path)
            ? "child"
            : /^stakes\/[^/]+\/activities\/[^/]+\/registrations\/[^/]+$/.test(path)
              ? "registration"
              : null;
        if (!kind) continue;
        const extra = Object.keys(body).filter((key) => !allowed[kind].includes(key));
        assert.deepEqual(extra, [], `${path}: chiavi fuori dalla allowlist delle rules`);
        checked += 1;
      }
      assert.ok(checked > 40, `controllati ${checked} documenti`);
    }
  });

  test("stakeId e prefix separano ogni id: nessun percorso, uid, token o palo in comune con palo-demo", () => {
    const otherStake = `iso-x-${runId}`;
    const otherPrefix = `isox${runId}`;
    const other = buildDemoDataset({ ...input, stakeId: otherStake, prefix: otherPrefix });
    const defaults = new Set(dataset.docs.map((entry) => entry.path));
    assert.deepEqual(other.docs.map((entry) => entry.path).filter((path) => defaults.has(path)), [], "percorsi in comune");
    assert.equal(other.docs.length, dataset.docs.length, "stessa forma");
    const text = JSON.stringify(other.docs);
    assert.ok(!text.includes(DEMO_STAKE_ID), "nessun riferimento al palo demo");
    assert.ok(!/(?<![a-z0-9])demo-(admin|leader|participant|parent|youth|child|magic)/.test(text), "nessun uid o id figlio di default");
    assert.ok(!text.includes(sha256(MATTEO_MAGIC_TOKEN)), "il token magic-link e' diverso");
    assert.notEqual(other.magicLink, dataset.magicLink);
    const accounts = demoAccounts(otherPrefix);
    assert.deepEqual(
      Object.values(accounts).map((account) => account.uid),
      [`${otherPrefix}-admin`, `${otherPrefix}-leader`, `${otherPrefix}-participant`, `${otherPrefix}-parent`],
    );
    assert.deepEqual(other.summary.logins, Object.values(accounts).map((account) => account.email));
    assert.deepEqual(demoAccounts(), DEMO_ACCOUNTS);
    for (const entry of other.docs) {
      const parts = entry.path.split("/");
      const inside =
        (parts[0] === "stakes" && parts[1] === otherStake) ||
        (parts[0] === "users" && parts[1].startsWith(`${otherPrefix}-`)) ||
        (parts[0] === "parentAuthorizationTokens" && parts[1] === sha256(other.magicLink.split("/").pop()));
      assert.ok(inside, `percorso fuori dal palo e dal prefisso richiesti: ${entry.path}`);
    }
  });

  test("seedDemo in dry-run non scrive e rifiuta date non valide", async () => {
    const result = await seedDemo(
      { db: null, auth: null },
      { ...input, password: "x", apply: false, stakeId: `iso-x-${runId}`, prefix: `isox${runId}` },
    );
    assert.equal(result.applied, false);
    assert.equal(result.docs.length, dataset.docs.length);
    assert.throws(() => buildDemoDataset({ today: "non-una-data", parentEmail: "", appUrl: "http://localhost", stakeId: DEMO_STAKE_ID }), /--today non valido/);
  });
});

describe("dati demo: palo seminato con seedDemo contro rules e callable", () => {
  const copyStakeId = `iso-dm-${runId}`;
  const prefix = `isoc${runId}`;
  const accounts = demoAccounts(prefix);
  const today = new Date().toISOString().slice(0, 10); // date relative: il token non scade mai fra un giro e l'altro
  const seedInput = { today, parentEmail: "", appUrl: "http://localhost:5173" };
  const dataset = buildDemoDataset({ ...seedInput, stakeId: copyStakeId, prefix });
  const rawToken = dataset.magicLink.split("/").pop();
  const tokenHash = sha256(rawToken);
  const docs = dataset.docs;
  const aurora = `${copyStakeId}-rione-aurora`;
  const brezza = `${copyStakeId}-rione-brezza`;
  const viaggio = `stakes/${copyStakeId}/activities/viaggio-tempio`;
  const registrationDocs = docs.filter((entry) => /\/registrations\/[^/]+$/.test(entry.path));
  const userDocs = docs.filter((entry) => /^users\/[^/]+$/.test(entry.path));
  const clients = {};
  const realTokenPath = `parentAuthorizationTokens/${sha256(MATTEO_MAGIC_TOKEN)}`;
  let realTokenBefore;

  before(async () => {
    realTokenBefore = (await adminDb.doc(realTokenPath).get()).data();
    // Guardia: il seed non deve poter toccare nulla di esistente (palo-demo compreso).
    for (const { path } of docs) {
      const parts = path.split("/");
      const inside =
        (parts[0] === "stakes" && parts[1] === copyStakeId) ||
        (parts[0] === "users" && parts[1].startsWith(`${prefix}-`)) ||
        (parts[0] === "parentAuthorizationTokens" && parts[1] === tokenHash);
      assert.ok(inside, `percorso fuori dal palo isolato: ${path}`);
    }
    assert.ok(docs.some((entry) => entry.path === `parentAuthorizationTokens/${tokenHash}`), "il link seed punta al token seminato");
    const existing = await adminDb.getAll(...docs.map((entry) => adminDb.doc(entry.path)));
    assert.equal(existing.filter((snapshot) => snapshot.exists).length, 0, "il seed non deve sovrascrivere documenti esistenti");
    const lookup = await adminAuth.getUsers(Object.values(accounts).map((account) => ({ uid: account.uid })));
    assert.equal(lookup.users.length, 0, "gli account demo isolati non esistono ancora");

    track.stakes.add(copyStakeId);
    for (const { path } of userDocs) track.uids.add(path.split("/")[1]);
    for (const account of Object.values(accounts)) track.uids.add(account.uid);
    const seeded = await seedDemo(
      { db: adminDb, auth: adminAuth },
      { ...seedInput, password: PASSWORD, apply: true, settleAlertsMs: 0, keepAlerts: true, stakeId: copyStakeId, prefix },
    );
    assert.equal(seeded.applied, true);
    for (const role of ["admin", "leader", "participant", "parent"]) clients[role] = await signIn(accounts[role].email);
    // Lascia finire i trigger di creazione (avvisi "Nuovo iscritto", invio iniziale).
    await sleep(2500);
  });

  test("ogni utente seed passa la scrittura di login dell'app (tutti i ruoli)", { timeout: 120_000 }, async () => {
    assert.ok(userDocs.length >= 22);
    for (const { path, data } of userDocs) {
      const userId = path.split("/")[1];
      const { db } = mockClient(userId);
      const stamp = iso();
      await expectAllowed(
        setDoc(doc(db, path), { ...data, lastLoginAt: stamp, updatedAt: stamp }, { merge: true }),
        `login write di ${userId} (${data.role})`,
      );
    }
  });

  test("ogni iscrizione seed accetta il salvataggio del proprietario (payload completo)", { timeout: 120_000 }, async () => {
    assert.ok(registrationDocs.length >= 25);
    for (const { path, data } of registrationDocs) {
      const owner = data.userId || data.parentUid;
      assert.ok(owner, `${path}: manca il proprietario`);
      const { db } = mockClient(owner);
      await expectAllowed(updateDoc(doc(db, path), { updatedAt: iso() }), `salvataggio proprietario su ${path}`);
    }
  });

  test("il partecipante aggiorna answers/updatedAt della propria iscrizione, ma non parentAuthorization", async () => {
    const path = `${viaggio}/registrations/user_${accounts.participant.uid}`;
    const { db } = clients.participant;
    const current = (await getOne(db, path)).data();
    await expectAllowed(
      updateDoc(doc(db, path), { answers: { ...current.answers, note: "Aggiornata dal partecipante" }, updatedAt: iso() }),
      "answers + updatedAt",
    );
    assert.equal((await getOne(db, path)).data().answers.note, "Aggiornata dal partecipante");
    await expectDenied(
      updateDoc(doc(db, path), { parentAuthorization: { ...current.parentAuthorization, photoConsent: "granted" }, updatedAt: iso() }),
      "il partecipante non scrive parentAuthorization",
    );
    await expectDenied(
      updateDoc(doc(db, `${viaggio}/registrations/user_${prefix}-youth-01`), { updatedAt: iso() }),
      "il partecipante non scrive l'iscrizione di un altro",
    );
  });

  test("il genitore aggiorna i profili figli e vede le iscrizioni dei suoi due figli", async () => {
    const { db, uid: parentUid } = clients.parent;
    assert.equal(parentUid, accounts.parent.uid);
    const children = await listAll(db, `users/${parentUid}/children`);
    assert.equal(children.size, 2);
    for (const child of children.docs) {
      await expectAllowed(updateDoc(child.ref, { updatedAt: iso() }), `aggiornamento figlio ${child.id}`);
    }
    const family = await getDocsFromServer(query(collectionGroup(db, "registrations"), where("parentUid", "==", parentUid)));
    assert.deepEqual(
      paths(family),
      [
        `${viaggio}/registrations/child_${parentUid}_${prefix}-child-matteo`,
        `${viaggio}/registrations/child_${parentUid}_${prefix}-child-chiara`,
      ].sort(),
    );
  });

  test("il dirigente legge giovani e iscrizioni della propria unita' e non quelle delle altre", async () => {
    const { db } = clients.leader;
    const expectedYouth = userDocs.filter((entry) => entry.data.unitId === aurora).length;
    const youth = await listWhere(db, "users", where("stakeId", "==", copyStakeId), where("unitId", "==", aurora));
    assert.equal(youth.size, expectedYouth);
    const expectedRegs = registrationDocs.filter((entry) => entry.path.startsWith(`${viaggio}/`) && entry.data.unitId === aurora).length;
    const regs = await listWhere(db, `${viaggio}/registrations`, where("unitId", "==", aurora));
    assert.equal(regs.size, expectedRegs);
    await expectDenied(listWhere(db, `${viaggio}/registrations`, where("unitId", "==", brezza)), "iscrizioni dell'unita' Brezza");
    await expectDenied(listWhere(db, "users", where("stakeId", "==", copyStakeId), where("unitId", "==", brezza)), "giovani dell'unita' Brezza");
    await expectDenied(listAll(db, `${viaggio}/registrations`), "tutte le iscrizioni senza filtro");
    const brezzaReg = registrationDocs.find((entry) => entry.data.unitId === brezza && entry.path.startsWith(`${viaggio}/`));
    assert.ok(brezzaReg, "esiste un'iscrizione di un'altra unita' nel seed");
    await expectDenied(getOne(db, brezzaReg.path), "iscrizione dell'unita' Brezza");
  });

  test("l'admin demo elenca attivita' e iscrizioni del proprio palo ma non del palo A", async () => {
    const { db } = clients.admin;
    assert.equal((await listAll(db, `stakes/${copyStakeId}/activities`)).size, 2);
    const expected = registrationDocs.filter((entry) => entry.path.startsWith(`${viaggio}/`)).length;
    assert.equal((await listAll(db, `${viaggio}/registrations`)).size, expected);
    await expectDenied(listAll(db, `stakes/${x.A.id}/activities/pub/registrations`), "iscrizioni del palo A");
    await expectDenied(getOne(db, `users/${x.A.participant.uid}`), "utente del palo A");
    // E il contrario: l'admin di A non vede il palo seminato.
    await expectDenied(listAll(x.actors.adminA.db, `${viaggio}/registrations`), "admin A sul palo seminato");
  });

  test("il link magic-link seed e' valido e la firma dall'app funziona sui dati demo", { timeout: 120_000 }, async () => {
    const { parent } = clients;
    const anonymous = x.actors.signedOut;
    const context = await anonymous.call("parentAuthorizationGetContext", { token: rawToken });
    assert.equal(context.data.status, "valid", "il token del seed e' valido (non scaduto)");
    assert.equal(context.data.participantName, "Matteo Conti");
    assert.equal(context.data.activityTitle, "Viaggio al Tempio");

    const parentUid = accounts.parent.uid;
    const matteo = `child_${parentUid}_${prefix}-child-matteo`;
    const chiara = `child_${parentUid}_${prefix}-child-chiara`;
    await expectCallableCode(
      parent.call("parentAuthorizationIssueOwnToken", { stakeId: copyStakeId, activityId: "viaggio-tempio", registrationId: chiara }),
      "failed-precondition", "figlia gia' autorizzata",
    );
    const issued = await parent.call("parentAuthorizationIssueOwnToken", { stakeId: copyStakeId, activityId: "viaggio-tempio", registrationId: matteo });
    assert.equal(issued.data.ok, true);
    assert.equal((await adminDb.doc(`parentAuthorizationTokens/${tokenHash}`).get()).data().status, "invalidated", "il link seed e' sostituito dal nuovo");
    // Il vero palo-demo non e' stato toccato dalla firma sul palo isolato.
    assert.deepEqual((await adminDb.doc(realTokenPath).get()).data(), realTokenBefore, "il token del vero palo-demo resta intatto");
  });
});

// Sola lettura sul vero palo-demo (account seed del progetto emulatore).
describe("palo-demo reale (sola lettura)", () => {
  const state = { ready: false, reason: "", actors: {} };
  const demoAurora = `${DEMO_STAKE_ID}-rione-aurora`;
  const demoBrezza = `${DEMO_STAKE_ID}-rione-brezza`;

  before(async () => {
    const stake = await adminDb.doc(`stakes/${DEMO_STAKE_ID}`).get();
    if (!stake.exists) {
      state.reason = `stakes/${DEMO_STAKE_ID} non c'e' nell'emulatore: eseguire tools/seed-demo.mjs --apply`;
      return;
    }
    try {
      for (const role of ["admin", "leader", "participant", "parent"]) {
        state.actors[role] = await signIn(DEMO_ACCOUNTS[role].email, "Demo-2026!");
      }
      state.ready = true;
    } catch (error) {
      state.reason = `login con gli account seed non riuscito (${error?.code ?? error}): password diversa da quella dello script di seed`;
    }
  });

  const guarded = (name, fn) =>
    test(name, { timeout: 60_000 }, async (t) => {
      if (!state.ready) return t.skip(state.reason);
      return fn();
    });

  guarded("il partecipante legge la propria iscrizione, il dirigente le query di unita', l'admin le liste", async () => {
    const reg = await getOne(state.actors.participant.db, `stakes/${DEMO_STAKE_ID}/activities/viaggio-tempio/registrations/user_demo-participant`);
    assert.equal(reg.exists(), true);
    const leaderDb = state.actors.leader.db;
    const youth = await listWhere(leaderDb, "users", where("stakeId", "==", DEMO_STAKE_ID), where("unitId", "==", demoAurora));
    assert.ok(youth.size > 0);
    const regs = await listWhere(leaderDb, `stakes/${DEMO_STAKE_ID}/activities/viaggio-tempio/registrations`, where("unitId", "==", demoAurora));
    assert.ok(regs.size > 0);
    await expectDenied(
      listWhere(leaderDb, `stakes/${DEMO_STAKE_ID}/activities/viaggio-tempio/registrations`, where("unitId", "==", demoBrezza)),
      "dirigente demo sull'unita' Brezza",
    );
    const adminDb2 = state.actors.admin.db;
    assert.ok((await listAll(adminDb2, `stakes/${DEMO_STAKE_ID}/activities`)).size >= 2);
    assert.ok((await listAll(adminDb2, `stakes/${DEMO_STAKE_ID}/activities/viaggio-tempio/registrations`)).size > 0);
    const family = await getDocsFromServer(
      query(collectionGroup(state.actors.parent.db, "registrations"), where("parentUid", "==", state.actors.parent.uid)),
    );
    assert.ok(family.size >= 2);
  });

  guarded("gli account di palo-demo non entrano nei pali A e B", async () => {
    await expectDenied(listAll(state.actors.admin.db, `stakes/${x.A.id}/activities/pub/registrations`), "admin demo su A");
    await expectDenied(getOne(state.actors.admin.db, `users/${x.B.participant.uid}`), "admin demo su un utente di B");
    await expectDenied(
      listWhere(state.actors.leader.db, `stakes/${x.A.id}/activities/pub/registrations`, where("unitId", "==", x.A.unit1.id)),
      "dirigente demo su A",
    );
    await expectDenied(getOne(state.actors.participant.db, `stakes/${x.B.id}/activities/pub/registrations/${x.B.partReg}`), "partecipante demo su B");
  });
});

// ===========================================================================
// 7. STORAGE
// ===========================================================================
describe("STORAGE: isolamento fra pali", { skip: STORAGE_HOST ? false : "FIREBASE_STORAGE_EMULATOR_HOST non impostato" }, () => {
  const bucket = () => getAdminStorage().bucket();
  const privatePath = () => `protected/stakes/${x.B.id}/activities/pub/parent-consents/${x.B.partReg}/consenso.txt`;
  const pdfPath = () => `protected/stakes/${x.B.id}/activities/pub/parent-authorization-pdfs/${x.B.partReg}/audit.pdf`;
  const publicPath = () => `public/stakes/${x.B.id}/activities/pub/locandina.txt`;

  const storageOutcome = async (promise) => {
    try {
      await promise;
      return { ok: true, code: "" };
    } catch (error) {
      return { ok: false, code: error?.code ?? String(error?.message ?? error) };
    }
  };

  before(async () => {
    track.storagePrefixes.add(`protected/stakes/${x.B.id}/`);
    track.storagePrefixes.add(`public/stakes/${x.B.id}/`);
    for (const path of [privatePath(), pdfPath(), publicPath()]) {
      await bucket().file(path).save(Buffer.from("contenuto di prova"), { contentType: "text/plain" });
    }
  });

  test("i file riservati di B sono letti solo da admin di B e dal proprietario dell'iscrizione", { timeout: 60_000 }, async () => {
    const read = (actor, path) => storageOutcome(getBytes(storageRef(x.actors[actor].storage(), path)));
    assert.equal((await read("adminB", privatePath())).ok, true, "admin B legge il consenso");
    assert.equal((await read("participantB", privatePath())).ok, true, "il proprietario legge il proprio consenso");
    assert.deepEqual(await read("adminA", privatePath()), { ok: false, code: "storage/unauthorized" }, "admin A");
    assert.deepEqual(await read("participantA", privatePath()), { ok: false, code: "storage/unauthorized" }, "partecipante A");
    assert.deepEqual(await read("leaderA", privatePath()), { ok: false, code: "storage/unauthorized" }, "dirigente A");
    assert.deepEqual(await read("signedOut", privatePath()), { ok: false, code: "storage/unauthorized" }, "visitatore");
    assert.equal((await read("adminB", pdfPath())).ok, true, "admin B legge il PDF di audit");
    assert.deepEqual(await read("adminA", pdfPath()), { ok: false, code: "storage/unauthorized" }, "admin A sul PDF di audit");
    assert.deepEqual(await read("participantB", pdfPath()), { ok: false, code: "storage/unauthorized" }, "il proprietario non legge il PDF di audit");
  });

  test("i file pubblici di B si leggono liberamente ma si scrivono solo da admin di B", { timeout: 60_000 }, async () => {
    const read = await storageOutcome(getBytes(storageRef(x.actors.signedOut.storage(), publicPath())));
    assert.equal(read.ok, true, "lettura pubblica deliberata");
    const upload = (actor, name) =>
      storageOutcome(uploadString(storageRef(x.actors[actor].storage(), `public/stakes/${x.B.id}/activities/pub/${name}`), "x"));
    assert.deepEqual(await upload("adminA", "intruso-a.txt"), { ok: false, code: "storage/unauthorized" }, "admin A");
    assert.deepEqual(await upload("participantB", "intruso-p.txt"), { ok: false, code: "storage/unauthorized" }, "partecipante B");
    assert.equal((await upload("adminB", "mio.txt")).ok, true, "admin B scrive nel proprio palo");
    assert.equal((await bucket().file(`public/stakes/${x.B.id}/activities/pub/intruso-a.txt`).exists())[0], false);
  });
});

// ===========================================================================
// 8. resetDemo: isolamento (stakeId e prefix parametrizzati)
// ===========================================================================
describe("resetDemo: isolamento fra pali", () => {
  const isoStake = `iso-demo-${runId}`;
  const isoPrefix = `isod${runId}`;
  const keepStake = `iso-keep-${runId}`;
  const parentEmail = `x-${runId}@example.invalid`;
  const strangerEmail = `stranger-${runId}@example.invalid`;
  const strangerUid = `stranger-${runId}`;
  const keepCacheEmail = `estraneo-${runId}@example.invalid`;
  const today = new Date().toISOString().slice(0, 10);
  const bucket = () => getAdminStorage().bucket();
  const cachePrefix = (email) => `protected/parent-authorization-signature-cache/${hashEmail(email)}/`;
  const cacheDoc = (email) => `parentAuthorizationSignatureCache/${hashEmail(email)}`;
  const resetInput = (apply) => ({ parentEmail, apply, stakeId: isoStake, prefix: isoPrefix });
  const fx = {};

  async function treePaths(ref) {
    const out = [ref.path];
    for (const collectionRef of await ref.listCollections()) {
      for (const child of await collectionRef.listDocuments()) out.push(...(await treePaths(child)));
    }
    return out.sort();
  }
  const filesUnder = async (prefix) => (await bucket().getFiles({ prefix }))[0].map((file) => file.name).sort();
  const putFile = (path) => bucket().file(path).save(Buffer.from("contenuto di prova"), { contentType: "text/plain" });
  const idsWhere = async (collectionName, stakeId) =>
    (await adminDb.collection(collectionName).where("stakeId", "==", stakeId).get()).docs.map((entry) => entry.id).sort();

  /** Tutto cio' che non deve cambiare: palo-demo reale, altri pali, i miei pali di test. Solo letture. */
  async function sharedSnapshot() {
    const demoAuth = (await adminAuth.listUsers(1000)).users.map((user) => user.uid).filter((id) => id.startsWith("demo-")).sort();
    return {
      stakes: (await adminDb.collection("stakes").listDocuments()).map((ref) => ref.id).filter((id) => id !== isoStake).sort(),
      demoTree: await treePaths(adminDb.doc(`stakes/${DEMO_STAKE_ID}`)),
      secondo: await treePaths(adminDb.doc("stakes/palo-secondo")),
      terzo: await treePaths(adminDb.doc("stakes/palo-terzo")),
      demoUsers: await idsWhere("users", DEMO_STAKE_ID),
      demoTokens: await idsWhere("parentAuthorizationTokens", DEMO_STAKE_ID),
      demoAnonymousTokens: await idsWhere("anonymousRegistrationTokens", DEMO_STAKE_ID),
      demoAuth,
      demoFiles: [...(await filesUnder(`public/stakes/${DEMO_STAKE_ID}/`)), ...(await filesUnder(`protected/stakes/${DEMO_STAKE_ID}/`))],
    };
  }
  async function keepSnapshot() {
    return {
      tree: await treePaths(adminDb.doc(`stakes/${keepStake}`)),
      users: await idsWhere("users", keepStake),
      tokens: await idsWhere("parentAuthorizationTokens", keepStake),
      anonymousTokens: await idsWhere("anonymousRegistrationTokens", keepStake),
      files: [...(await filesUnder(`public/stakes/${keepStake}/`)), ...(await filesUnder(`protected/stakes/${keepStake}/`)), ...(await filesUnder(cachePrefix(keepCacheEmail)))],
      cache: (await adminDb.doc(cacheDoc(keepCacheEmail)).get()).exists,
      auth: (await adminAuth.getUsers(fx.keepUids.map((id) => ({ uid: id })))).users.map((user) => user.uid).sort(),
    };
  }

  before(async () => {
    assert.ok(STORAGE_HOST, "questo blocco richiede lo Storage Emulator (FIREBASE_STORAGE_EMULATOR_HOST)");
    track.stakes.add(isoStake);
    track.stakes.add(keepStake);
    track.storagePrefixes.add(`public/stakes/${isoStake}/`);
    track.storagePrefixes.add(`protected/stakes/${isoStake}/`);
    track.storagePrefixes.add(`public/stakes/${keepStake}/`);
    track.storagePrefixes.add(`protected/stakes/${keepStake}/`);
    for (const email of [parentEmail, keepCacheEmail]) {
      track.storagePrefixes.add(cachePrefix(email));
      track.docs.add(cacheDoc(email));
    }

    // --- palo da resettare: seed del repo, un estraneo, token, file, cache firma
    const seeded = await seedDemo(
      { db: adminDb, auth: adminAuth },
      { today, parentEmail, appUrl: "http://localhost:5173", password: PASSWORD, apply: true, settleAlertsMs: 0, keepAlerts: true, stakeId: isoStake, prefix: isoPrefix },
    );
    assert.equal(seeded.applied, true);
    fx.isoUserIds = seeded.docs.filter((entry) => /^users\/[^/]+$/.test(entry.path)).map((entry) => entry.path.split("/")[1]);
    const isoAccounts = Object.values(demoAccounts(isoPrefix)).map((account) => account.uid);
    for (const id of [...fx.isoUserIds, ...isoAccounts, strangerUid]) track.uids.add(id);
    fx.isoAuthIds = [...isoAccounts, strangerUid];
    const isoStakeInfo = { id: isoStake, slug: isoStake, name: `Palo ${isoStake}` };
    await adminAuth.createUser({ uid: strangerUid, email: strangerEmail, password: PASSWORD });
    await adminDb.doc(`users/${strangerUid}`).set(
      buildUserDocument({ firstName: "Estraneo", lastName: "Registrato", email: strangerEmail, role: "participant", stake: isoStakeInfo, now: iso() }),
    );
    await adminDb.doc(`anonymousRegistrationTokens/anon-iso-${runId}`).set({
      registrationId: "guest_x", activityId: "viaggio-tempio", stakeId: isoStake, anonymousUid: "anon-x", recoveryCode: "ABC", pdfDataSummary: {}, createdAt: iso(),
    });
    track.docs.add(`anonymousRegistrationTokens/anon-iso-${runId}`);
    await putFile(`public/stakes/${isoStake}/activities/viaggio-tempio/locandina.txt`);
    await putFile(`protected/stakes/${isoStake}/activities/viaggio-tempio/parent-consents/r/consenso.txt`);
    await adminDb.doc(cacheDoc(parentEmail)).set({ status: "active", signaturePath: `${cachePrefix(parentEmail)}firma.png`, createdAt: iso() });
    await putFile(`${cachePrefix(parentEmail)}firma.png`);

    // --- secondo palo, creato con createStake, con utenti, token, file, cache di un'altra email
    const keep = await createStake(
      { db: adminDb, auth: adminAuth },
      {
        stakeId: keepStake, name: `Palo da conservare ${runId}`, units: [{ name: "Rione Uno" }],
        admin: { email: emailOf("admin-keep"), firstName: "Admin", lastName: "Keep", password: PASSWORD }, apply: true,
      },
    );
    track.uids.add(keep.adminUid);
    const keepMember = await createUser({
      key: "member-keep", role: "participant", firstName: "Membro", lastName: "Conservato", stake: keep.stake, unit: keep.units[0],
      category: "giovane_uomo", birthDate: "2010-01-01",
    });
    fx.keepUids = [keep.adminUid, keepMember.uid];
    await adminDb.doc(`stakes/${keepStake}/activities/a1`).set(activityDoc("Attivita da conservare"));
    await adminDb.doc(`stakes/${keepStake}/activities/a1/registrations/user_${keepMember.uid}`).set(
      registrationDoc({ firstName: "Membro", lastName: "Conservato", unit: keep.units[0], userId: keepMember.uid }),
    );
    await adminDb.doc(`parentAuthorizationTokens/keep-token-${runId}`).set(
      tokenDoc({ id: `keep-token-${runId}`, stakeId: keepStake, activityId: "a1", registrationId: `user_${keepMember.uid}` }),
    );
    await adminDb.doc(`anonymousRegistrationTokens/anon-keep-${runId}`).set({
      registrationId: "guest_k", activityId: "a1", stakeId: keepStake, anonymousUid: "anon-k", recoveryCode: "XYZ", pdfDataSummary: {}, createdAt: iso(),
    });
    track.docs.add(`anonymousRegistrationTokens/anon-keep-${runId}`);
    await putFile(`public/stakes/${keepStake}/activities/a1/locandina.txt`);
    await putFile(`protected/stakes/${keepStake}/activities/a1/parent-consents/r/consenso.txt`);
    await adminDb.doc(cacheDoc(keepCacheEmail)).set({ status: "active", signaturePath: `${cachePrefix(keepCacheEmail)}firma.png`, createdAt: iso() });
    await putFile(`${cachePrefix(keepCacheEmail)}firma.png`);

    // I trigger di creazione (avvisi "Nuovo iscritto") devono finire prima del reset,
    // altrimenti riscrivono dentro il palo appena cancellato.
    await sleep(3000);
    fx.sharedBefore = await sharedSnapshot();
    fx.keepBefore = await keepSnapshot();
  });

  const sorted = (values) => [...values].sort();

  test("dry-run: non cancella niente e elenca gli utenti non seed del palo", { timeout: 120_000 }, async () => {
    const isoTreeBefore = await treePaths(adminDb.doc(`stakes/${isoStake}`));
    const result = await resetDemo({ db: adminDb, auth: adminAuth, bucket: bucket() }, resetInput(false));
    assert.equal(result.applied, false);
    assert.equal(result.plan.stake, `stakes/${isoStake} (ricorsivo)`);
    assert.deepEqual(result.plan.nonSeedUsers, [{ uid: strangerUid, email: strangerEmail }], "solo l'estraneo, non gli account seed ne' i giovani sintetici");
    assert.equal(result.plan.users, fx.isoUserIds.length + 1, "utenti seed + l'estraneo");
    assert.equal(result.plan.tokens, 2, "un token magic-link e uno anonimo del palo");
    assert.ok(Array.isArray(result.plan.storagePrefixes));
    assert.ok(result.plan.storagePrefixes.includes(`public/stakes/${isoStake}/`));
    assert.ok(result.plan.storagePrefixes.includes(`protected/stakes/${isoStake}/`));
    assert.ok(result.plan.storagePrefixes.includes(cachePrefix(parentEmail)));
    for (const prefix of result.plan.storagePrefixes) {
      assert.ok(!prefix.includes(keepStake) && !prefix.includes(DEMO_STAKE_ID), `il piano non tocca altri pali: ${prefix}`);
    }

    // Nulla e' sparito.
    assert.deepEqual(await treePaths(adminDb.doc(`stakes/${isoStake}`)), isoTreeBefore);
    assert.equal((await adminDb.doc(`users/${strangerUid}`).get()).exists, true);
    assert.equal((await adminAuth.getUsers(fx.isoAuthIds.map((id) => ({ uid: id })))).users.length, fx.isoAuthIds.length);
    assert.equal((await idsWhere("parentAuthorizationTokens", isoStake)).length, 1);
    assert.equal((await filesUnder(`public/stakes/${isoStake}/`)).length, 1);
    assert.equal((await adminDb.doc(cacheDoc(parentEmail)).get()).exists, true);
    assert.deepEqual(await sharedSnapshot(), fx.sharedBefore);
    assert.deepEqual(await keepSnapshot(), fx.keepBefore);
  });

  test("apply: cancella tutto del palo indicato e nient'altro (secondo palo, palo-demo, altri pali intatti)", { timeout: 180_000 }, async () => {
    const result = await resetDemo({ db: adminDb, auth: adminAuth, bucket: bucket() }, resetInput(true));
    assert.equal(result.applied, true);
    await sleep(2500); // eventuali trigger sulle cancellazioni

    // Il palo reset e' sparito: documenti, profili, account, token, file, cache firma.
    assert.equal((await adminDb.doc(`stakes/${isoStake}`).get()).exists, false);
    assert.deepEqual(await adminDb.doc(`stakes/${isoStake}`).listCollections(), [], "nessuna sottocollezione rimasta");
    for (const id of [...fx.isoUserIds, strangerUid]) {
      assert.equal((await adminDb.doc(`users/${id}`).get()).exists, false, `users/${id} cancellato`);
    }
    assert.deepEqual(await idsWhere("users", isoStake), []);
    assert.equal((await adminAuth.getUsers(fx.isoAuthIds.map((id) => ({ uid: id })))).users.length, 0, "account Auth cancellati");
    assert.deepEqual(await idsWhere("parentAuthorizationTokens", isoStake), []);
    assert.deepEqual(await idsWhere("anonymousRegistrationTokens", isoStake), []);
    assert.deepEqual(await filesUnder(`public/stakes/${isoStake}/`), []);
    assert.deepEqual(await filesUnder(`protected/stakes/${isoStake}/`), []);
    assert.equal((await adminDb.doc(cacheDoc(parentEmail)).get()).exists, false, "cache firma del genitore del palo cancellata");
    assert.deepEqual(await filesUnder(cachePrefix(parentEmail)), []);

    // Tutto il resto e' identico a prima.
    assert.deepEqual(await keepSnapshot(), fx.keepBefore, "il secondo palo e' intatto (documenti, utenti, Auth, token, file, cache di un'altra email)");
    assert.deepEqual(await sharedSnapshot(), fx.sharedBefore, "palo-demo reale e gli altri pali sono intatti");
    for (const key of ["A", "B"]) {
      assert.equal((await adminDb.doc(`stakes/${x[key].id}`).get()).exists, true);
      assert.equal((await adminDb.doc(`users/${x[key].participant.uid}`).get()).exists, true);
    }
  });

  test("e' idempotente: un secondo reset sullo stesso palo non fallisce e non tocca gli altri", { timeout: 120_000 }, async () => {
    const again = await resetDemo({ db: adminDb, auth: adminAuth, bucket: bucket() }, resetInput(true));
    assert.equal(again.applied, true);
    assert.deepEqual(again.plan.nonSeedUsers, []);
    assert.deepEqual(await keepSnapshot(), fx.keepBefore);
    assert.deepEqual(await sharedSnapshot(), fx.sharedBefore);
  });

  // Le email sintetiche "genitore.esempio@..." e "genitore.registrazione@..." sono le
  // STESSE in ogni palo demo (qualunque prefix): la cache firma e i file sotto
  // protected/parent-authorization-signature-cache/<hash> sono globali per
  // indirizzo, quindi un reset del palo di prova cancellerebbe anche quelle del
  // palo-demo vero. Il piano lo mostra senza scrivere niente.
  test(
    "il reset di un palo con prefix non tocca la cache firma degli indirizzi sintetici condivisi",
    async () => {
      const result = await resetDemo({ db: adminDb, auth: adminAuth, bucket: bucket() }, resetInput(false));
      for (const shared of ["genitore.esempio@example.invalid", "genitore.registrazione@example.invalid"]) {
        assert.ok(!result.plan.storagePrefixes.includes(cachePrefix(shared)), `il piano cancellerebbe la cache firma condivisa di ${shared}`);
      }
    },
  );
});
