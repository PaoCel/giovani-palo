// Contenuto del seed demo (tools/lib/demoData.mjs) provato da utenti veri contro
// gli emulatori di firebase.multistake-test.json (Auth 9199, Firestore 8180,
// Functions 5101, Storage 9299, progetto demo-room-planner).
//
// Semina un palo isolato (id e prefisso con runId) con seedDemo + `media`, poi
// legge con le QUERY ESATTE dei service del client (galleriesService,
// feedService, surveysService, roomMatesService, campManagementService) e con
// le callable, da Sofia (partecipante), dall'admin e dal dirigente. L'Admin SDK
// serve solo per il seed e per ispezionare lo stato: le rules non le prova.
// Non tocca palo-demo né altri pali; ripulisce ciò che crea.
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
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
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

import { buildDemoDataset, DEMO_MEDIA, demoAccounts, PAST_CAMP_ID, seedDemo, TIMESTAMP } from "../../tools/lib/demoData.mjs";
import { initAdmin, resolveTarget } from "../../tools/lib/target.mjs";
import { validateRoomPlan } from "../lib/roomPlannerCore.mjs";

const require = createRequire(import.meta.url);
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");
const { getStorage: getAdminStorage } = require("firebase-admin/storage");
const { computeUploadWindow } = require("../lib/activityGallery.js");

// ---------------------------------------------------------------------------
// Guardie: mai fuori dagli emulatori locali
// ---------------------------------------------------------------------------
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "";
assert.equal(PROJECT, "demo-room-planner", "Usare esclusivamente il progetto demo-room-planner");
// Le porte arrivano dall'ambiente di emulators:exec (default: firebase.multistake-test.json),
// così il test gira anche con una config a porte diverse se le standard sono occupate.
const hostPort = (host, label) => {
  const match = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(host);
  assert.ok(match, `${label} deve essere un emulatore locale, trovato "${host}"`);
  return Number(match[2]);
};
const FIRESTORE_PORT = hostPort(FIRESTORE_HOST, "Firestore Emulator");
hostPort(AUTH_HOST, "Auth Emulator");
const STORAGE_PORT = hostPort(STORAGE_HOST, "Storage Emulator");
const FUNCTIONS_PORT = Number((process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5101").split(":").pop());

const target = resolveTarget({ kind: "stake" });
assert.equal(target.emulator, true);
initAdmin(target);
const adminDb = getAdminFirestore();
const adminAuth = getAdminAuth();

const BUCKET = `${PROJECT}.appspot.com`;
const STORAGE_BASE_URL = `http://127.0.0.1:${STORAGE_PORT}`;
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = `Pw-${runId}-iso!`; // credenziale di test, vale solo nell'emulatore
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const apps = [];

// ---------------------------------------------------------------------------
// Client SDK
// ---------------------------------------------------------------------------
async function signIn(email, password = PASSWORD) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT, storageBucket: BUCKET }, `user${apps.length}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", FIRESTORE_PORT);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", FUNCTIONS_PORT);
  return {
    app,
    db,
    uid: credential.user.uid,
    call: (name, data) => httpsCallable(functions, name)(data),
  };
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
  assert.equal(result.ok, false, `${label}: doveva essere negata ed è riuscita`);
  assert.equal(result.code, "permission-denied", `${label}: atteso permission-denied, ottenuto "${result.code}" (${result.message})`);
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
const ids = (snapshot) => snapshot.docs.map((item) => item.id).sort();
const millis = (value) => (value && typeof value.toMillis === "function" ? value.toMillis() : null);

// ---------------------------------------------------------------------------
// Palo isolato
// ---------------------------------------------------------------------------
const stakeId = `iso-ct-${runId}`;
const prefix = `isoct${runId}`;
const accounts = demoAccounts(prefix);
const today = new Date().toISOString().slice(0, 10);
const seedInput = { today, parentEmail: "", appUrl: "http://localhost:5173" };
const mediaRunId = `a${runId}`;
const bucket = () => getAdminStorage().bucket();
const seedMedia = (id) => ({ bucket: bucket(), baseUrl: STORAGE_BASE_URL, runId: id });
// Dataset puro (stessi input del seed) per le coerenze interne.
const dataset = buildDemoDataset({
  ...seedInput,
  stakeId,
  prefix,
  media: { bucketName: BUCKET, baseUrl: STORAGE_BASE_URL, runId: mediaRunId },
});
const stakePath = `stakes/${stakeId}`;
const campPath = `${stakePath}/activities/${PAST_CAMP_ID}`;
const tripPath = `${stakePath}/activities/viaggio-tempio`;
const galleryId = `act_${PAST_CAMP_ID}`;
const galleryPath = `${stakePath}/galleries/${galleryId}`;
const docOf = (path) => dataset.docs.find((entry) => entry.path === path)?.data;
const docsUnder = (path) =>
  dataset.docs.filter((entry) => entry.path.startsWith(`${path}/`) && !entry.path.slice(path.length + 1).includes("/"));

const clients = {};
const seededUids = Object.values(accounts).map((account) => account.uid);

before(async () => {
  // Guardia: il seed non deve poter toccare nulla fuori dal palo isolato.
  for (const { path } of dataset.docs) {
    const parts = path.split("/");
    const inside =
      (parts[0] === "stakes" && parts[1] === stakeId) ||
      (parts[0] === "users" && parts[1].startsWith(`${prefix}-`)) ||
      (parts[0] === "parentAuthorizationTokens");
    assert.ok(inside, `percorso fuori dal palo isolato: ${path}`);
  }
  const existing = await adminDb.getAll(...dataset.docs.map((entry) => adminDb.doc(entry.path)));
  assert.equal(existing.filter((snapshot) => snapshot.exists).length, 0, "il seed non deve sovrascrivere documenti esistenti");

  const seeded = await seedDemo(
    { db: adminDb, auth: adminAuth },
    { ...seedInput, password: PASSWORD, apply: true, settleAlertsMs: 0, keepAlerts: true, stakeId, prefix, media: seedMedia(mediaRunId) },
  );
  assert.equal(seeded.applied, true);
  for (const role of ["admin", "leader", "participant", "parent"]) clients[role] = await signIn(accounts[role].email);
  // Lascia finire i trigger di creazione (iscrizioni, media).
  await sleep(2500);
});

after(async () => {
  await Promise.allSettled(apps.map((app) => deleteApp(app)));
  const wipe = async () => {
    await adminDb.recursiveDelete(adminDb.doc(stakePath)).catch(() => {});
    const tokens = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", stakeId).get().catch(() => null);
    for (const token of tokens?.docs ?? []) await token.ref.delete().catch(() => {});
    const users = await adminDb.collection("users").where("stakeId", "==", stakeId).get().catch(() => null);
    for (const user of users?.docs ?? []) await adminDb.recursiveDelete(user.ref).catch(() => {});
    for (const userId of seededUids) await adminDb.recursiveDelete(adminDb.doc(`users/${userId}`)).catch(() => {});
  };
  await wipe();
  await sleep(2500); // i trigger possono scrivere dopo la prima passata
  await wipe();
  const toDelete = [...seededUids, ...dataset.docs.filter((e) => /^users\/[^/]+$/.test(e.path)).map((e) => e.path.split("/")[1])];
  for (let index = 0; index < toDelete.length; index += 500) await adminAuth.deleteUsers(toDelete.slice(index, index + 500)).catch(() => {});
  await bucket().deleteFiles({ prefix: `protected/stakes/${stakeId}/`, force: true }).catch(() => {});
  await adminDb.terminate().catch(() => {});
});

// ===========================================================================
describe("contenuto del seed demo: letture da utenti veri", () => {
  test("Sofia vede galleria e media del campeggio concluso, e i file esistono nello Storage", { timeout: 120_000 }, async () => {
    const { db } = clients.participant;
    // galleriesService.listGalleries / getGallery / activity gallery (where activityId)
    const all = await listAll(db, `${stakePath}/galleries`);
    assert.deepEqual(ids(all), [galleryId]);
    const byActivity = await getDocsFromServer(query(collection(db, `${stakePath}/galleries`), where("activityId", "==", PAST_CAMP_ID)));
    assert.deepEqual(ids(byActivity), [galleryId]);
    const gallery = (await getOne(db, galleryPath)).data();
    assert.equal(gallery.activityId, PAST_CAMP_ID);

    // galleriesService.listMedia: l'intera collection media
    const media = await listAll(db, `${galleryPath}/media`);
    assert.equal(media.size, DEMO_MEDIA.length);
    assert.equal(gallery.mediaCount, media.size, "mediaCount coincide con i media letti");
    assert.ok(media.docs.some((item) => item.id === gallery.coverMediaId), "la copertina è uno dei media");

    for (const item of media.docs) {
      const data = item.data();
      assert.equal(data.status, "uploaded");
      for (const field of ["optimizedUrl", "thumbnailUrl"]) {
        const url = data[field];
        assert.ok(url, `${item.id}.${field} assente`);
        const response = await fetch(url);
        assert.equal(response.status, 200, `${item.id}.${field}: ${url}`);
        assert.match(response.headers.get("content-type") || "", /image\/jpeg/);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.ok(bytes.length > 1000, `${item.id}.${field}: file troppo piccolo (${bytes.length})`);
        assert.equal(bytes[0], 0xff, "non è un JPEG");
      }
    }
  });

  test("la callable roomMates dà a Sofia stanza e compagni del viaggio", async () => {
    const { call, uid: sofiaUid } = clients.participant;
    const result = (await call("roomMates", { stakeId, activityId: "viaggio-tempio" })).data;
    const own = docOf(`${tripPath}/registrations/user_${sofiaUid}`);
    assert.ok(own.assignedRoomId, "Sofia ha una stanza assegnata nel seed");
    assert.ok(result.room?.name, `stanza vuota: ${JSON.stringify(result)}`);
    assert.equal(result.room.name, own.assignedRoomName);
    const expected = docsUnder(`${tripPath}/registrations`)
      .filter((entry) => entry.data.assignedRoomId === own.assignedRoomId && entry.path.split("/").pop() !== `user_${sofiaUid}`)
      .map((entry) => entry.data.fullName);
    assert.ok(expected.length > 0);
    assert.ok(Array.isArray(result.mates) && result.mates.length > 0, `compagni vuoti: ${JSON.stringify(result)}`);
    assert.equal(result.mates.length, expected.length);
    for (const mate of result.mates) assert.ok(mate.fullName, "compagno senza nome");
  });

  test("Sofia legge management/camp, i post del feed e le domande attive; non elenca le risposte", async () => {
    const { db } = clients.participant;
    const camp = (await getOne(db, `${campPath}/management/camp`)).data();
    assert.equal(camp.patrols.length, 3);
    assert.equal(camp.committees.length, 5);

    // feedService.listPublishedPosts
    const feed = await getDocsFromServer(
      query(collection(db, `${stakePath}/feedPosts`), where("published", "==", true), where("visibility", "in", ["all_authenticated", "gallery_members"])),
    );
    assert.deepEqual(ids(feed), [
      "post-campeggio-estivo",
      "post-galleria-campeggio",
      "post-sondaggio-campeggio",
      "post-viaggio-aperto",
    ]);

    // surveysService: domande attive
    const questions = await getDocsFromServer(query(collection(db, `${campPath}/surveyQuestions`), where("status", "==", "active")));
    assert.equal(questions.size, 4);

    // list delle risposte: solo admin
    await expectDenied(listAll(db, `${campPath}/surveyResponses`), "Sofia non elenca surveyResponses");
  });

  test("l'admin elenca le risposte (anonime), legge rooms e camp; campManagementStaff risponde", async () => {
    const { db, call } = clients.admin;
    const responses = await listAll(db, `${campPath}/surveyResponses`);
    assert.equal(responses.size, 11);
    for (const item of responses.docs) {
      const data = item.data();
      assert.ok(!("userId" in data) && !("anonymousUid" in data), `${item.id}: risposta non anonima`);
    }
    const rooms = (await getOne(db, `${tripPath}/management/rooms`)).data();
    assert.equal(rooms.published, true);
    assert.equal(rooms.rooms.length, 4);
    const camp = (await getOne(db, `${campPath}/management/camp`)).data();
    assert.equal(camp.patrols.length, 3);

    const context = (await call("campManagementStaff", { stakeId, activityId: PAST_CAMP_ID, action: "context" })).data;
    assert.equal(context.ok, true);
    assert.equal(context.canManageStaff, true);
    const roster = (await call("campManagementStaff", { stakeId, activityId: PAST_CAMP_ID, action: "roster" })).data;
    assert.equal(roster.ok, true);
    const campRegistrations = docsUnder(`${campPath}/registrations`);
    assert.equal(roster.registrations.length, campRegistrations.length);
  });

  test("il dirigente (in campStaff) legge management/camp e risulta staff", async () => {
    const { db, call } = clients.leader;
    const camp = (await getOne(db, `${campPath}/management/camp`)).data();
    assert.equal(camp.patrols.length, 3);
    const context = (await call("campManagementStaff", { stakeId, activityId: PAST_CAMP_ID, action: "context" })).data;
    assert.equal(context.ok, true);
    assert.equal(context.isStaff, true);
  });
});

// ===========================================================================
describe("contenuto del seed demo: coerenze del dataset", () => {
  const campRegs = () => new Map(docsUnder(`${campPath}/registrations`).map((entry) => [entry.path.split("/").pop(), entry.data]));

  test("gallery.mediaCount uguale ai media, sul dataset e su Firestore", async () => {
    const mediaDocs = dataset.docs.filter((entry) => entry.path.startsWith(`${galleryPath}/media/`));
    assert.equal(mediaDocs.length, DEMO_MEDIA.length);
    assert.equal(docOf(galleryPath).mediaCount, mediaDocs.length);
    const stored = (await adminDb.doc(galleryPath).get()).data();
    const storedMedia = await adminDb.collection(`${galleryPath}/media`).get();
    assert.equal(stored.mediaCount, storedMedia.size);
    assert.equal(storedMedia.size, DEMO_MEDIA.length);
  });

  test("pattuglie e comitati: ogni iscrizione citata esiste e ha l'assegnazione coerente", () => {
    const regs = campRegs();
    const plan = docOf(`${campPath}/management/camp`);
    for (const patrol of plan.patrols) {
      const people = [patrol.leaderRegistrationId, ...patrol.supervisorRegistrationIds, ...patrol.memberRegistrationIds];
      assert.equal(new Set(people).size, people.length, `${patrol.id}: persona ripetuta`);
      for (const id of people) {
        assert.ok(regs.has(id), `${patrol.id}: iscrizione assente ${id}`);
        assert.equal(regs.get(id).assignedPatrolId, patrol.id, `${id}: assignedPatrolId`);
        assert.equal(regs.get(id).assignedPatrolName, patrol.name, `${id}: assignedPatrolName`);
      }
      assert.equal(regs.get(patrol.leaderRegistrationId).assignedPatrolRole, "leader");
      assert.equal(patrol.publicMembers.length, people.length);
    }
    const inPatrols = plan.patrols.flatMap((patrol) => [patrol.leaderRegistrationId, ...patrol.supervisorRegistrationIds, ...patrol.memberRegistrationIds]);
    assert.equal(new Set(inPatrols).size, inPatrols.length, "una persona in due pattuglie");
    for (const [id, data] of regs) {
      if (data.assignedPatrolId) assert.ok(inPatrols.includes(id), `${id}: assignedPatrolId senza pattuglia`);
    }
    for (const committee of plan.committees) {
      for (const id of [...committee.leaderRegistrationIds, ...committee.memberRegistrationIds]) {
        assert.ok(regs.has(id), `${committee.id}: iscrizione assente ${id}`);
        assert.ok(
          regs.get(id).assignedCommittees.some((item) => item.id === committee.id),
          `${id}: assignedCommittees senza ${committee.id}`,
        );
      }
    }
    const staff = docOf(`${campPath}/management/campStaff`);
    for (const uid of staff.staffUids) assert.ok(regs.has(`user_${uid}`), `staff senza iscrizione: ${uid}`);
  });

  test("piano stanze: categoria e capienza rispettate, validazione del server senza errori", () => {
    const plan = docOf(`${tripPath}/management/rooms`);
    const regs = new Map(docsUnder(`${tripPath}/registrations`).map((entry) => [entry.path.split("/").pop(), entry.data]));
    const roomsById = new Map(plan.rooms.map((room) => [room.id, room]));
    const load = new Map();
    for (const [registrationId, roomId] of Object.entries(plan.assignments)) {
      const registration = regs.get(registrationId);
      const room = roomsById.get(roomId);
      assert.ok(registration, `assegnazione a iscrizione assente: ${registrationId}`);
      assert.ok(room, `assegnazione a stanza assente: ${roomId}`);
      const expectedCategory = { giovane_uomo: "boys", giovane_donna: "girls" }[registration.genderRoleCategory];
      assert.equal(room.category, expectedCategory, `${registrationId} in ${room.name}`);
      assert.equal(registration.assignedRoomId, roomId);
      assert.equal(registration.assignedRoomName, room.name);
      load.set(roomId, (load.get(roomId) ?? 0) + 1);
    }
    for (const [roomId, count] of load) assert.ok(count <= roomsById.get(roomId).capacity, `${roomId} oltre la capienza (${count})`);
    for (const [id, data] of regs) {
      if (data.assignedRoomId) assert.ok(plan.assignments[id] === data.assignedRoomId, `${id}: stanza non nel piano`);
    }

    const registrations = [...regs].map(([id, data]) => ({ id, ...data }));
    const errors = validateRoomPlan(plan, registrations, today);
    assert.deepEqual(errors, [], `validateRoomPlan: ${errors.join(" | ")}`);
  });

  test("la finestra della galleria coincide con computeUploadWindow (la callable ensure non la riscrive)", async () => {
    const activity = docOf(campPath);
    const expected = computeUploadWindow(activity);
    assert.ok(expected, "computeUploadWindow senza finestra");
    const seededGallery = docOf(galleryPath);
    assert.equal(seededGallery.uploadsWindowSource, "activity");
    assert.equal(Date.parse(seededGallery.uploadsOpenFrom[TIMESTAMP]), expected.fromMs);
    assert.equal(Date.parse(seededGallery.uploadsOpenUntil[TIMESTAMP]), expected.untilMs);

    const stored = (await adminDb.doc(galleryPath).get()).data();
    assert.equal(millis(stored.uploadsOpenFrom), expected.fromMs);
    assert.equal(millis(stored.uploadsOpenUntil), expected.untilMs);

    // Prova diretta: dopo ensure la finestra è identica e la galleria è la stessa.
    const before = stored.updatedAt;
    const result = (await clients.admin.call("activityGallery", { action: "ensure", stakeId, activityId: PAST_CAMP_ID })).data;
    assert.equal(result.galleryId, galleryId);
    assert.equal(result.created, false);
    const after = (await adminDb.doc(galleryPath).get()).data();
    assert.equal(millis(after.uploadsOpenFrom), expected.fromMs);
    assert.equal(millis(after.uploadsOpenUntil), expected.untilMs);
    assert.equal(after.updatedAt, before, "ensure ha riscritto la galleria");
  });
});

// ===========================================================================
describe("contenuto del seed demo: riseminare", () => {
  test("due semine di seguito con media (runId diversi) lasciano esattamente 8 media", { timeout: 120_000 }, async () => {
    const firstIds = (await adminDb.collection(`${galleryPath}/media`).get()).docs.map((item) => item.id).sort();
    assert.equal(firstIds.length, DEMO_MEDIA.length);

    for (const id of [`b${runId}`, `c${runId}`]) {
      const result = await seedDemo(
        { db: adminDb, auth: adminAuth },
        { ...seedInput, password: PASSWORD, apply: true, settleAlertsMs: 0, keepAlerts: true, stakeId, prefix, media: seedMedia(id) },
      );
      assert.equal(result.applied, true);
    }

    const media = await waitFor(
      async () => (await adminDb.collection(`${galleryPath}/media`).get()).docs.map((item) => item.id).sort(),
      (list) => list.length === DEMO_MEDIA.length && list.every((id) => id.startsWith(`mc${runId}`)),
      "8 media dell'ultimo giro",
    );
    assert.equal(media.length, DEMO_MEDIA.length);
    for (const id of firstIds) assert.ok(!media.includes(id), `media del primo giro rimasto: ${id}`);

    const gallery = (await adminDb.doc(galleryPath).get()).data();
    assert.equal(gallery.mediaCount, DEMO_MEDIA.length);
    assert.ok(media.includes(gallery.coverMediaId), "copertina fuori dai media");

    // Sofia, dopo la riseminatura, vede 8 media e i loro file esistono.
    const seen = await listAll(clients.participant.db, `${galleryPath}/media`);
    assert.equal(seen.size, DEMO_MEDIA.length);
    for (const item of seen.docs) {
      const response = await fetch(item.data().optimizedUrl);
      assert.equal(response.status, 200, `${item.id}: file mancante dopo la riseminatura`);
    }
  });
});
