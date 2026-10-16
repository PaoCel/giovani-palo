// Galleria foto/video dell'attività: rules Firestore, rules Storage e callable
// `activityGallery` provate negli emulatori con utenti VERI dell'Auth emulator
// (l'Admin SDK serve solo per seminare e per ispezionare lo stato, perché ignora
// le rules). Riferimento: docs/GALLERIA_ATTIVITA.md, tabella "Chi vede, chi scrive".
//
// Rilancio (emulatori Auth 9199, Firestore 8180, Functions 5101, Storage 9299):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --config firebase.multistake-test.json --project demo-gallery-test \
//     'node --test --test-concurrency=1 functions/tests/activityGalleryEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse in un file temporaneo (questo test legge gli host dalle variabili
// d'ambiente che imposta emulators:exec) e rimuovilo a fine prova.
//
// Le operazioni client sono quelle ESATTE dell'app:
//   - galleriesService.createMediaDoc / deleteMedia (writeBatch con media + mediaCount)
//   - feedService.likeMedia / unlikeMedia (writeBatch con like + likeCount)
//   - galleryUploadService (path Storage e customMetadata.uploadedBy, deleteMediaFolder)
//   - UploadManagerProvider (payload del doc media: 22 campi + createdAt, updatedAt, likeCount)
//
// Attori: due pali (A e B). Palo A: admin, dirigente di unità, partecipante autore,
// altro partecipante, genitore. Palo B: admin e partecipante. In più: sessione
// anonima (con un profilo che punta al palo A: caso peggiore), utente autenticato
// senza documento users, visitatore non loggato.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  increment,
  query,
  setDoc,
  Timestamp as ClientTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import {
  connectStorageEmulator,
  deleteObject,
  getBytes,
  getDownloadURL,
  getStorage,
  listAll,
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp } = require("firebase-admin/app");
const { FieldValue, Timestamp, getFirestore: getAdminFirestore } = require("firebase-admin/firestore");
const { getStorage: getAdminStorage } = require("firebase-admin/storage");

// ---------------------------------------------------------------------------
// Guardie: mai fuori dagli emulatori locali
// ---------------------------------------------------------------------------
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
const hostOf = (value, label) => {
  assert.match(value || "", /^(127\.0\.0\.1|localhost):\d+$/u, `${label}: emulatore locale richiesto`);
  const [host, port] = value.split(":");
  return { host, port: Number(port), raw: value };
};
const FIRESTORE = hostOf(process.env.FIRESTORE_EMULATOR_HOST, "Firestore");
const AUTH = hostOf(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth");
const STORAGE = hostOf(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "Storage");
const FUNCTIONS = hostOf(process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5101", "Functions");

const BUCKET = `${PROJECT}.appspot.com`;
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// App Admin con nome: l'app di default resta libera per functions/index.js (test del trigger).
const adminApp = initializeAdminApp({ projectId: PROJECT, storageBucket: BUCKET }, `gallery-admin-${runId}`);
const adminDb = getAdminFirestore(adminApp);
const adminBucket = getAdminStorage(adminApp).bucket(BUCKET);
const STAKE_A = `gal-a-${runId}`;
const STAKE_B = `gal-b-${runId}`;
const PASSWORD = `Pw-${runId}-gal!`; // credenziale di test, vale solo nell'emulatore
// Giri dei test di concorrenza (GALLERY_STRESS_ROUNDS=30 per una prova di stabilità più lunga).
const ROUNDS = Number(process.env.GALLERY_STRESS_ROUNDS || 3);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (ms = Date.now()) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Attori
// ---------------------------------------------------------------------------
// [chiave, modalità di accesso, profilo users/{uid} | null]
const ACTORS = [
  ["admin", "password", { role: "admin", stakeId: STAKE_A }],
  ["leader", "password", { role: "unit_leader", stakeId: STAKE_A, unitId: "unit-1" }],
  ["author", "password", { role: "participant", stakeId: STAKE_A }],
  ["other", "password", { role: "participant", stakeId: STAKE_A }],
  ["parent", "password", { role: "parent", stakeId: STAKE_A }],
  ["adminB", "password", { role: "admin", stakeId: STAKE_B }],
  ["memberB", "password", { role: "participant", stakeId: STAKE_B }],
  // Anonimo con profilo che punta al palo giusto: deve fallire per l'anonimato.
  ["anon", "anonymous", { role: "participant", stakeId: STAKE_A }],
  // Autenticato ma senza documento users/{uid}.
  ["noDoc", "password", null],
  ["signedOut", "none", null],
];
const apps = [];
const U = {}; // attori per chiave
let MAIN; // galleria aperta usata dai test di lettura e creazione

async function makeActor(key, mode) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT, storageBucket: BUCKET }, `${key}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.raw}`, { disableWarnings: true });
  if (mode === "anonymous") await signInAnonymously(auth);
  else if (mode === "password") await createUserWithEmailAndPassword(auth, `${key}-${runId}@example.invalid`, PASSWORD);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE.host, FIRESTORE.port);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  const storage = getStorage(app);
  connectStorageEmulator(storage, STORAGE.host, STORAGE.port);
  return {
    key,
    db,
    storage,
    uid: auth.currentUser?.uid ?? null,
    call: (data) => httpsCallable(functions, "activityGallery")(data).then((result) => result.data),
  };
}

before(async () => {
  const made = await Promise.all(ACTORS.map(([key, mode]) => makeActor(key, mode)));
  for (const actor of made) U[actor.key] = actor;
  await Promise.all(
    ACTORS.filter(([, , profile]) => profile).map(([key, , profile]) =>
      adminDb.doc(`users/${U[key].uid}`).set(profile),
    ),
  );
  // Galleria aperta, creata da un admin (createdBy = uid dell'admin), con due media seminati.
  MAIN = await newGallery({ createdBy: U.admin.uid, mediaCount: 0 });
  await seedMedia(MAIN, "m-seed-1", U.author.uid);
  await seedMedia(MAIN, "m-seed-2", U.other.uid);
});

after(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE_A}`));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE_B}`));
  await adminBucket.deleteFiles({ prefix: `protected/stakes/${STAKE_A}/`, force: true }).catch(() => {});
  await adminBucket.deleteFiles({ prefix: `protected/stakes/${STAKE_B}/`, force: true }).catch(() => {});
  await Promise.all(
    ACTORS.filter(([, , profile]) => profile).map(([key]) => adminDb.doc(`users/${U[key].uid}`).delete()),
  );
  await adminDb.terminate();
});

// ---------------------------------------------------------------------------
// Helper di esito
// ---------------------------------------------------------------------------
async function expectDenied(attempt, label = "") {
  await assert.rejects(attempt, (error) => {
    assert.equal(error?.code, "permission-denied", `${label} atteso permission-denied, ricevuto ${error?.code}: ${error?.message}`);
    return true;
  });
}

async function expectCallableError(attempt, code, label = "") {
  await assert.rejects(attempt, (error) => {
    assert.equal(error?.code, `functions/${code}`, `${label} atteso ${code}, ricevuto ${error?.code}: ${error?.message}`);
    return true;
  });
}

async function storageOutcome(promise) {
  try {
    await promise;
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error?.code };
  }
}
const UNAUTHORIZED = { ok: false, code: "storage/unauthorized" };

// ---------------------------------------------------------------------------
// Dati: attività, gallerie, media
// ---------------------------------------------------------------------------
let seq = 0;
const nextId = (prefix) => `${prefix}${++seq}-${runId}`;

/** Attività con date ISO come in prod: running (in corso), concluded (da 10 giorni), future (fra 3 giorni). */
async function seedActivity(kind, extra = {}) {
  const now = Date.now();
  const dates = {
    running: [now - DAY, now + DAY],
    concluded: [now - 11 * DAY, now - 10 * DAY],
    future: [now + 3 * DAY, now + 4 * DAY],
  }[kind];
  const id = nextId(`${kind}-`);
  const data = { title: `Attività ${kind}`, activityType: "trip", isPublic: true };
  if (dates) {
    data.startDate = iso(dates[0]);
    data.endDate = iso(dates[1]);
  }
  Object.assign(data, extra);
  await adminDb.doc(`stakes/${STAKE_A}/activities/${id}`).set(data);
  return { id, ...data };
}

const galleryRef = (g) => adminDb.doc(`stakes/${g.stakeId}/galleries/${g.galleryId}`);
const mediaRef = (g, mediaId) => galleryRef(g).collection("media").doc(mediaId);
const hiddenRef = (g, mediaId) => galleryRef(g).collection("hiddenMedia").doc(mediaId);
const galleryCount = async (g) => (await galleryRef(g).get()).data().mediaCount;

/** Galleria con la forma che scrive la callable. `window`: open | expired | future | none. */
async function newGallery({ window = "open", closed = false, createdBy = U.admin.uid, mediaCount = 0, activityId } = {}) {
  const n = ++seq;
  const g = { stakeId: STAKE_A, galleryId: `g${n}-${runId}`, activityId: activityId ?? `act-g${n}-${runId}` };
  const now = Date.now();
  const data = {
    title: "Galleria di prova",
    description: "",
    activityId: g.activityId,
    createdBy,
    createdAt: iso(),
    updatedAt: iso(),
    published: false,
    publishedAt: null,
    coverMediaId: null,
    coverImageUrl: null,
    mediaCount,
    batchSize: 30,
    accessMode: "open",
    likeCount: 0,
    commentsEnabled: false,
    postsCreated: false,
    codeStatus: "missing",
    uploadsClosed: closed,
    uploadsWindowSource: "activity",
  };
  const windows = {
    open: [now - 3 * HOUR, now + 7 * DAY],
    expired: [now - 10 * DAY, now - HOUR],
    future: [now + HOUR, now + 2 * DAY],
  };
  if (windows[window]) {
    data.uploadsOpenFrom = Timestamp.fromMillis(windows[window][0]);
    data.uploadsOpenUntil = Timestamp.fromMillis(windows[window][1]);
  }
  await adminDb.doc(`stakes/${g.stakeId}/galleries/${g.galleryId}`).set(data);
  return g;
}

const folder = (g, mediaId) => `protected/stakes/${g.stakeId}/galleries/${g.galleryId}/media/${mediaId}`;
const filePath = (g, mediaId, kind = "optimized", name = "foto.jpg") =>
  `${folder(g, mediaId)}/${kind}-${Date.now()}-${name}`;
// Formato degli URL di download: emulatore e produzione.
const emulatorUrl = (path) => `http://${STORAGE.raw}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=tok-${runId}`;
const productionUrl = (path) => `https://firebasestorage.googleapis.com/v0/b/giovani-palo.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=tok-${runId}`;
const stagingUrl = (path) => `https://firebasestorage.googleapis.com/v0/b/giovani-palo-staging.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=tok-${runId}`;
const euProductionUrl = (path) => `https://firebasestorage.googleapis.com/v0/b/giovani-palo-eu/o/${encodeURIComponent(path)}?alt=media&token=tok-${runId}`;

/** Payload di UploadManagerProvider (immagine) + createdAt/updatedAt/likeCount di createMediaDoc: 25 campi. */
function imageData(g, mediaId, uid, mutate, urlOf = emulatorUrl) {
  const optimized = filePath(g, mediaId, "optimized");
  const thumb = filePath(g, mediaId, "thumb");
  const ts = iso();
  const data = {
    activityId: g.activityId,
    type: "image",
    storagePath: optimized,
    storageUrl: urlOf(optimized),
    originalPath: null,
    originalUrl: null,
    optimizedPath: optimized,
    optimizedUrl: urlOf(optimized),
    thumbnailPath: thumb,
    thumbnailUrl: urlOf(thumb),
    posterPath: null,
    posterUrl: null,
    width: 1600,
    height: 1200,
    duration: null,
    order: 1,
    caption: "",
    filename: "foto.jpg",
    contentType: "image/jpeg",
    sizeBytes: 345678,
    uploadedBy: uid,
    status: "uploaded",
    createdAt: ts,
    updatedAt: ts,
    likeCount: 0,
  };
  if (mutate) mutate(data);
  return data;
}

function videoData(g, mediaId, uid) {
  const video = filePath(g, mediaId, "original", "clip.mp4");
  const poster = filePath(g, mediaId, "poster", "clip.mp4");
  const ts = iso();
  return {
    activityId: g.activityId,
    type: "video",
    storagePath: video,
    storageUrl: emulatorUrl(video),
    originalPath: video,
    originalUrl: emulatorUrl(video),
    optimizedPath: null,
    optimizedUrl: null,
    thumbnailPath: poster,
    thumbnailUrl: emulatorUrl(poster),
    posterPath: poster,
    posterUrl: emulatorUrl(poster),
    width: 1080,
    height: 1920,
    duration: null,
    order: 2,
    caption: "",
    filename: "clip.mp4",
    contentType: "video/mp4",
    sizeBytes: 9_000_000,
    uploadedBy: uid,
    status: "uploaded",
    createdAt: ts,
    updatedAt: ts,
    likeCount: 0,
  };
}

/** galleriesService.createMediaDoc: writeBatch con set del media e update del contatore. */
function createMediaBatch(actor, g, mediaId, data, delta = 1) {
  const batch = writeBatch(actor.db);
  batch.set(doc(actor.db, `stakes/${g.stakeId}/galleries/${g.galleryId}/media/${mediaId}`), data);
  batch.update(doc(actor.db, `stakes/${g.stakeId}/galleries/${g.galleryId}`), {
    mediaCount: increment(delta),
    updatedAt: data.updatedAt,
  });
  return batch.commit();
}

/** Carica davvero ottimizzata e miniatura (Storage emulator) e costruisce il payload con gli URL di getDownloadURL. */
async function uploadFile(actor, g, mediaId, kind, bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 7])) {
  const path = filePath(g, mediaId, kind, `${kind}.jpg`);
  const reference = storageRef(actor.storage, path);
  await uploadBytesResumable(reference, bytes, {
    contentType: "image/jpeg",
    customMetadata: { uploadedBy: actor.uid, stakeId: g.stakeId, galleryId: g.galleryId, mediaId, kind },
  });
  return { path, url: await getDownloadURL(reference) };
}

async function realImageData(actor, g, mediaId, mutate) {
  const optimized = await uploadFile(actor, g, mediaId, "optimized");
  await new Promise((resolve) => setTimeout(resolve, 2)); // path distinti anche con Date.now()
  const thumb = await uploadFile(actor, g, mediaId, "thumb");
  const data = imageData(g, mediaId, actor.uid, (d) => {
    d.storagePath = optimized.path;
    d.storageUrl = optimized.url;
    d.optimizedPath = optimized.path;
    d.optimizedUrl = optimized.url;
    d.thumbnailPath = thumb.path;
    d.thumbnailUrl = thumb.url;
    if (mutate) mutate(d);
  });
  return { data, urls: [optimized.url, thumb.url], paths: [optimized.path, thumb.path] };
}

/** galleriesService.deleteMedia. */
function deleteMediaBatch(actor, g, mediaId) {
  const batch = writeBatch(actor.db);
  batch.delete(doc(actor.db, `stakes/${g.stakeId}/galleries/${g.galleryId}/media/${mediaId}`));
  batch.update(doc(actor.db, `stakes/${g.stakeId}/galleries/${g.galleryId}`), {
    mediaCount: increment(-1),
    updatedAt: iso(),
  });
  return batch.commit();
}

/** feedService.likeMedia: lettura del like, poi batch like + likeCount. */
async function likeMedia(actor, g, mediaId) {
  const likeRef = doc(actor.db, `stakes/${g.stakeId}/galleries/${g.galleryId}/media/${mediaId}/likes/${actor.uid}`);
  const existing = await getDocFromServer(likeRef);
  if (existing.exists()) return;
  const batch = writeBatch(actor.db);
  batch.set(likeRef, { uid: actor.uid, createdAt: iso() });
  batch.update(doc(actor.db, `stakes/${g.stakeId}/galleries/${g.galleryId}/media/${mediaId}`), { likeCount: increment(1) });
  await batch.commit();
}

/** feedService.unlikeMedia. */
async function unlikeMedia(actor, g, mediaId) {
  const likeRef = doc(actor.db, `stakes/${g.stakeId}/galleries/${g.galleryId}/media/${mediaId}/likes/${actor.uid}`);
  const existing = await getDocFromServer(likeRef);
  if (!existing.exists()) return;
  const batch = writeBatch(actor.db);
  batch.delete(likeRef);
  batch.update(doc(actor.db, `stakes/${g.stakeId}/galleries/${g.galleryId}/media/${mediaId}`), { likeCount: increment(-1) });
  await batch.commit();
}

/** Semina un media (Admin SDK) tenendo coerente il contatore della galleria. */
async function seedMedia(g, mediaId, uploadedBy, mutate) {
  const data = imageData(g, mediaId, uploadedBy, mutate);
  await mediaRef(g, mediaId).set(data);
  await galleryRef(g).update({ mediaCount: FieldValue.increment(1) });
  return data;
}

const clientDocs = (actor, path, ...constraints) => getDocsFromServer(query(collection(actor.db, path), ...constraints));
const galleryPath = (g) => `stakes/${g.stakeId}/galleries/${g.galleryId}`;
const mediaPathOf = (g) => `${galleryPath(g)}/media`;
const clientMediaDoc = (actor, g, mediaId) => doc(actor.db, `${mediaPathOf(g)}/${mediaId}`);

// Attori che appartengono al palo A (account vero) e quelli che non devono vedere niente.
const MEMBERS = ["author", "other", "parent", "leader", "admin"];
const OUTSIDERS = ["anon", "memberB", "adminB", "noDoc", "signedOut"];



// ---------------------------------------------------------------------------
// 0. File rules e contratto con il client
// ---------------------------------------------------------------------------
describe("contratto rules / client", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");

  test("l'allowlist del create nelle rules coincide con i campi che scrive il client", () => {
    const match = rules.match(/function validMemberMediaCreate[\s\S]*?data\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/u);
    assert.ok(match, "allowlist hasOnly non trovata in validMemberMediaCreate");
    const allowlist = [...match[1].matchAll(/'([A-Za-z]+)'/gu)].map((item) => item[1]).sort();
    const g = { stakeId: STAKE_A, galleryId: "x", activityId: "y" };
    const imageKeys = Object.keys(imageData(g, "m", "u")).sort();
    const videoKeys = Object.keys(videoData(g, "m", "u")).sort();
    assert.equal(imageKeys.length, 25, "il payload del client ha 25 campi");
    assert.deepEqual(imageKeys, allowlist, "immagine: campi del client diversi dall'allowlist");
    assert.deepEqual(videoKeys, allowlist, "video: campi del client diversi dall'allowlist");
  });

  test("firestore.rules compila nell'emulatore", async () => {
    const put = async (url, name) => {
      const content = readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: { files: [{ name, content }] } }),
      });
      const body = await response.text();
      assert.equal(response.status, 200, `${name} non compila: ${body}`);
    };
    await put(`http://${FIRESTORE.raw}/emulator/v1/projects/${PROJECT}:securityRules`, "firestore.rules");
  });
});

// ---------------------------------------------------------------------------
// 1. Callable: ensure
// ---------------------------------------------------------------------------
describe("callable ensure", () => {
  const ensure = (actor, activityId, stakeId = STAKE_A) => actor.call({ action: "ensure", stakeId, activityId });
  const galleriesOf = async (activityId) =>
    (await adminDb.collection(`stakes/${STAKE_A}/galleries`).where("activityId", "==", activityId).get()).docs;

  test("partecipante su attività in corso crea act_<id> con la finestra (start-2h, end+7g) come Timestamp", async () => {
    const act = await seedActivity("running");
    const result = await ensure(U.author, act.id);
    assert.deepEqual(result, { galleryId: `act_${act.id}`, created: true });
    const snap = await adminDb.doc(`stakes/${STAKE_A}/galleries/act_${act.id}`).get();
    assert.ok(snap.exists);
    const data = snap.data();
    assert.ok(data.uploadsOpenFrom instanceof Timestamp, "uploadsOpenFrom deve essere un Timestamp");
    assert.ok(data.uploadsOpenUntil instanceof Timestamp, "uploadsOpenUntil deve essere un Timestamp");
    assert.equal(data.uploadsOpenFrom.toMillis(), Date.parse(act.startDate) - 2 * HOUR);
    assert.equal(data.uploadsOpenUntil.toMillis(), Date.parse(act.endDate) + 7 * DAY);
    assert.equal(data.activityId, act.id);
    assert.equal(data.createdBy, U.author.uid);
    assert.equal(data.uploadsClosed, false);
    assert.equal(data.mediaCount, 0);
    assert.equal(data.uploadsWindowSource, "activity");
    assert.equal(data.title, act.title);
  });

  test("la seconda chiamata (anche di un altro utente) non crea doppioni", async () => {
    const act = await seedActivity("running");
    const first = await ensure(U.author, act.id);
    const second = await ensure(U.other, act.id);
    const third = await ensure(U.author, act.id);
    assert.equal(first.created, true);
    assert.deepEqual(second, { galleryId: first.galleryId, created: false });
    assert.deepEqual(third, { galleryId: first.galleryId, created: false });
    assert.equal((await galleriesOf(act.id)).length, 1);
  });

  test("cinque chiamate in parallelo di utenti diversi: una sola galleria, una sola 'created'", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const act = await seedActivity("running");
      const results = await Promise.all(
        [U.author, U.other, U.parent, U.leader, U.admin].map((actor) => ensure(actor, act.id)),
      );
      assert.deepEqual([...new Set(results.map((item) => item.galleryId))], [`act_${act.id}`], `round ${round}`);
      assert.equal(results.filter((item) => item.created).length, 1, `round ${round}: esattamente una creazione`);
      assert.equal((await galleriesOf(act.id)).length, 1, `round ${round}: un solo documento`);
    }
  });

  test("attività conclusa da 10 giorni: il partecipante non crea, l'admin sì", async () => {
    const act = await seedActivity("concluded");
    assert.deepEqual(await ensure(U.author, act.id), { galleryId: null, created: false });
    assert.equal((await galleriesOf(act.id)).length, 0, "nessuna galleria creata dal partecipante");
    const adminResult = await ensure(U.admin, act.id);
    assert.deepEqual(adminResult, { galleryId: `act_${act.id}`, created: true });
    const data = (await adminDb.doc(`stakes/${STAKE_A}/galleries/act_${act.id}`).get()).data();
    assert.equal(data.uploadsOpenUntil.toMillis(), Date.parse(act.endDate) + 7 * DAY);
    assert.ok(data.uploadsOpenUntil.toMillis() < Date.now(), "finestra già scaduta, ma la galleria esiste");
    // Ora esiste: il partecipante la ritrova (sola lettura), senza crearne altre.
    assert.deepEqual(await ensure(U.author, act.id), { galleryId: `act_${act.id}`, created: false });
  });

  test("attività futura fra 3 giorni: il partecipante non crea, il dirigente di unità sì", async () => {
    const act = await seedActivity("future");
    assert.deepEqual(await ensure(U.other, act.id), { galleryId: null, created: false });
    assert.equal((await galleriesOf(act.id)).length, 0);
    assert.deepEqual(await ensure(U.leader, act.id), { galleryId: `act_${act.id}`, created: true });
    const data = (await adminDb.doc(`stakes/${STAKE_A}/galleries/act_${act.id}`).get()).data();
    assert.equal(data.uploadsOpenFrom.toMillis(), Date.parse(act.startDate) - 2 * HOUR);
    assert.ok(data.uploadsOpenFrom.toMillis() > Date.now(), "non ancora aperta");
  });

  test("il genitore (membro) apre la galleria di un'attività in corso", async () => {
    const act = await seedActivity("running");
    assert.deepEqual(await ensure(U.parent, act.id), { galleryId: `act_${act.id}`, created: true });
  });

  test("galleria legacy con id casuale e activityId: trovata, riceve la finestra, nessun act_ nuovo", async () => {
    const act = await seedActivity("running");
    const legacy = await newGallery({ window: "none", activityId: act.id });
    const before = (await galleryRef(legacy).get()).data();
    assert.equal(before.uploadsOpenFrom, undefined);
    assert.deepEqual(await ensure(U.author, act.id), { galleryId: legacy.galleryId, created: false });
    const after = (await galleryRef(legacy).get()).data();
    assert.equal(after.uploadsOpenFrom.toMillis(), Date.parse(act.startDate) - 2 * HOUR);
    assert.equal(after.uploadsOpenUntil.toMillis(), Date.parse(act.endDate) + 7 * DAY);
    assert.equal(after.uploadsWindowSource, "activity");
    assert.equal((await adminDb.doc(`stakes/${STAKE_A}/galleries/act_${act.id}`).get()).exists, false);
    assert.equal((await galleriesOf(act.id)).length, 1);
  });

  test("finestra impostata a mano da un admin (uploadsWindowSource manual) non viene sovrascritta", async () => {
    const act = await seedActivity("running");
    const manual = await newGallery({ window: "open", activityId: act.id });
    const from = Timestamp.fromMillis(Date.now() - 5 * HOUR);
    const until = Timestamp.fromMillis(Date.now() + 90 * DAY);
    await galleryRef(manual).update({ uploadsWindowSource: "manual", uploadsOpenFrom: from, uploadsOpenUntil: until });
    await ensure(U.author, act.id);
    const data = (await galleryRef(manual).get()).data();
    assert.equal(data.uploadsOpenFrom.toMillis(), from.toMillis());
    assert.equal(data.uploadsOpenUntil.toMillis(), until.toMillis());
    assert.equal(data.uploadsWindowSource, "manual");
  });

  test("se le date dell'attività cambiano, ensure riallinea la finestra", async () => {
    const act = await seedActivity("running");
    const { galleryId } = await ensure(U.author, act.id);
    const newEnd = iso(Date.parse(act.endDate) + 3 * DAY);
    await adminDb.doc(`stakes/${STAKE_A}/activities/${act.id}`).update({ endDate: newEnd });
    assert.deepEqual(await ensure(U.other, act.id), { galleryId, created: false });
    const data = (await adminDb.doc(`stakes/${STAKE_A}/galleries/${galleryId}`).get()).data();
    assert.equal(data.uploadsOpenUntil.toMillis(), Date.parse(newEnd) + 7 * DAY);
  });

  test("attività senza startDate: nessuna finestra, nessuna galleria (anche per l'admin)", async () => {
    const act = await seedActivity("nodates");
    assert.deepEqual(await ensure(U.author, act.id), { galleryId: null, created: false });
    assert.deepEqual(await ensure(U.admin, act.id), { galleryId: null, created: false });
    assert.equal((await galleriesOf(act.id)).length, 0);
  });

  test("attività con endDate prima di startDate: finestra da start-2h a start+7g", async () => {
    const act = await seedActivity("running", { endDate: iso(Date.now() - 20 * DAY) });
    const { galleryId, created } = await ensure(U.author, act.id);
    assert.equal(created, true);
    const data = (await adminDb.doc(`stakes/${STAKE_A}/galleries/${galleryId}`).get()).data();
    assert.equal(data.uploadsOpenUntil.toMillis(), Date.parse(act.startDate) + 7 * DAY);
  });

  test("anonimo, palo B, admin di un altro palo, senza doc: permission-denied; non loggato: unauthenticated", async () => {
    const act = await seedActivity("running");
    for (const key of ["anon", "memberB", "adminB", "noDoc"]) {
      await expectCallableError(ensure(U[key], act.id), "permission-denied", key);
    }
    await expectCallableError(ensure(U.signedOut, act.id), "unauthenticated", "signedOut");
    assert.equal((await galleriesOf(act.id)).length, 0, "nessuna galleria creata dai rifiutati");
  });

  test("il partecipante del palo B non apre nel palo B un'attività del palo A: not-found", async () => {
    const act = await seedActivity("running");
    await expectCallableError(ensure(U.memberB, act.id, STAKE_B), "not-found");
    assert.equal((await adminDb.collection(`stakes/${STAKE_B}/galleries`).get()).size, 0);
  });

  test("argomenti non validi: invalid-argument; attività inesistente: not-found", async () => {
    await expectCallableError(U.author.call({ action: "ensure", stakeId: STAKE_A, activityId: "a/b" }), "invalid-argument");
    await expectCallableError(U.author.call({ action: "ensure", stakeId: STAKE_A }), "invalid-argument");
    await expectCallableError(U.author.call({ action: "ensure", stakeId: "", activityId: "x" }), "invalid-argument");
    // Azione sconosciuta: lo staff riceve invalid-argument; per un partecipante vale prima il controllo staff.
    await expectCallableError(U.admin.call({ action: "boh", stakeId: STAKE_A, galleryId: "g", mediaId: "m" }), "invalid-argument");
    await expectCallableError(U.author.call({ action: "boh", stakeId: STAKE_A, galleryId: "g", mediaId: "m" }), "permission-denied");
    await expectCallableError(ensure(U.author, `inesistente-${runId}`), "not-found");
  });
});

// ---------------------------------------------------------------------------
// 2. Rules: lettura
// ---------------------------------------------------------------------------
describe("rules: lettura", () => {
  for (const key of MEMBERS) {
    test(`${key} legge galleria, elenco gallerie, media e singolo media`, async () => {
      const actor = U[key];
      const gallery = await getDocFromServer(doc(actor.db, galleryPath(MAIN)));
      assert.equal(gallery.exists(), true);
      const all = await clientDocs(actor, `stakes/${STAKE_A}/galleries`);
      assert.ok(all.docs.some((item) => item.id === MAIN.galleryId));
      const published = await clientDocs(actor, `stakes/${STAKE_A}/galleries`, where("published", "==", true));
      assert.ok(Array.isArray(published.docs));
      const byActivity = await clientDocs(actor, `stakes/${STAKE_A}/galleries`, where("activityId", "==", MAIN.activityId));
      assert.deepEqual(byActivity.docs.map((item) => item.id), [MAIN.galleryId]);
      const media = await clientDocs(actor, mediaPathOf(MAIN));
      assert.ok(media.size >= 2);
      const single = await getDocFromServer(clientMediaDoc(actor, MAIN, "m-seed-1"));
      assert.equal(single.exists(), true);
    });
  }

  for (const key of OUTSIDERS) {
    test(`${key} non legge né galleria, né elenco gallerie, né media`, async () => {
      const actor = U[key];
      await expectDenied(getDocFromServer(doc(actor.db, galleryPath(MAIN))), "get galleria");
      await expectDenied(clientDocs(actor, `stakes/${STAKE_A}/galleries`), "list gallerie");
      await expectDenied(clientDocs(actor, `stakes/${STAKE_A}/galleries`, where("published", "==", true)), "list pubblicate");
      await expectDenied(clientDocs(actor, `stakes/${STAKE_A}/galleries`, where("activityId", "==", MAIN.activityId)), "list per attività");
      await expectDenied(clientDocs(actor, mediaPathOf(MAIN)), "list media");
      await expectDenied(getDocFromServer(clientMediaDoc(actor, MAIN, "m-seed-1")), "get media");
      await expectDenied(clientDocs(actor, `${mediaPathOf(MAIN)}/m-seed-1/likes`), "list likes");
      await expectDenied(clientDocs(actor, `${mediaPathOf(MAIN)}/m-seed-1/comments`), "list commenti");
    });
  }

  test("i commenti: solo i membri leggono e scrivono, ognuno col proprio uid", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    const commentsPath = `${mediaPathOf(g)}/m1/comments`;
    await setDoc(doc(collection(U.other.db, commentsPath)), { uid: U.other.uid, body: "Bella!", createdAt: iso() });
    const list = await clientDocs(U.author, commentsPath);
    assert.equal(list.size, 1);
    await expectDenied(setDoc(doc(collection(U.other.db, commentsPath)), { uid: U.author.uid, body: "falso", createdAt: iso() }), "commento a nome altrui");
    for (const key of ["anon", "memberB", "noDoc", "signedOut"]) {
      await expectDenied(setDoc(doc(collection(U[key].db, commentsPath)), { uid: U[key].uid ?? "x", body: "ciao", createdAt: iso() }), `commento di ${key}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Rules: creazione del media (batch esatto di createMediaDoc)
// ---------------------------------------------------------------------------
describe("rules: creazione media", () => {
  test("partecipante autore crea il media: ok, uploadedBy = proprio uid, mediaCount +1", async () => {
    const g = await newGallery({ createdBy: U.admin.uid });
    const mediaId = "m-ok";
    await createMediaBatch(U.author, g, mediaId, imageData(g, mediaId, U.author.uid));
    const data = (await mediaRef(g, mediaId).get()).data();
    assert.equal(data.uploadedBy, U.author.uid);
    assert.notEqual(data.uploadedBy, (await galleryRef(g).get()).data().createdBy, "uploadedBy non è l'admin che ha creato la galleria");
    assert.equal(await galleryCount(g), 1);
  });

  for (const key of ["other", "parent", "leader", "admin"]) {
    test(`${key} crea un proprio media: ok`, async () => {
      const g = await newGallery();
      await createMediaBatch(U[key], g, "m1", imageData(g, "m1", U[key].uid));
      assert.equal((await mediaRef(g, "m1").get()).data().uploadedBy, U[key].uid);
      assert.equal(await galleryCount(g), 1);
    });
  }

  test("un video con poster (payload del client) è accettato", async () => {
    const g = await newGallery();
    await createMediaBatch(U.author, g, "v1", videoData(g, "v1", U.author.uid));
    assert.equal((await mediaRef(g, "v1").get()).data().type, "video");
  });

  test("URL nel formato di produzione (firebasestorage.googleapis.com) accettati", async () => {
    const g = await newGallery();
    await createMediaBatch(U.author, g, "p1", imageData(g, "p1", U.author.uid, null, productionUrl));
    assert.equal((await mediaRef(g, "p1").get()).exists, true);
  });

  test("URL dell'emulatore con il bucket del progetto (produzione o staging, firebasestorage.app e appspot.com): accettati", async () => {
    const g = await newGallery();
    const buckets = ["giovani-palo.firebasestorage.app", "giovani-palo-staging.firebasestorage.app", "giovani-palo.appspot.com", "giovani-palo-staging.appspot.com", BUCKET];
    for (const [index, bucket] of buckets.entries()) {
      const mediaId = `eb${index}`;
      const urlOf = (path) => `http://${STORAGE.raw}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=tok-${runId}`;
      await createMediaBatch(U.author, g, mediaId, imageData(g, mediaId, U.author.uid, null, urlOf));
      assert.equal((await mediaRef(g, mediaId).get()).exists, true, bucket);
    }
  });

  test("URL nel formato di produzione del bucket UE (giovani-palo-eu) accettati", async () => {
    const g = await newGallery();
    await createMediaBatch(U.author, g, "eu1", imageData(g, "eu1", U.author.uid, null, euProductionUrl));
    assert.equal((await mediaRef(g, "eu1").get()).exists, true);
  });

  test("URL dell'emulatore con il bucket UE (giovani-palo-eu), host 127.0.0.1 e localhost: accettati", async () => {
    const g = await newGallery();
    const port = STORAGE.port;
    for (const host of ["127.0.0.1", "localhost"]) {
      const mediaId = `eu-${host === "localhost" ? "l" : "i"}`;
      const urlOf = (path) => `http://${host}:${port}/v0/b/giovani-palo-eu/o/${encodeURIComponent(path)}?alt=media&token=tok-${runId}`;
      await createMediaBatch(U.author, g, mediaId, imageData(g, mediaId, U.author.uid, null, urlOf));
      assert.equal((await mediaRef(g, mediaId).get()).exists, true, host);
    }
  });

  test("il vecchio bucket di produzione (giovani-palo.firebasestorage.app) resta accettato per le PWA non aggiornate, anche con il bucket UE nelle rules", async () => {
    const g = await newGallery();
    await createMediaBatch(U.author, g, "old1", imageData(g, "old1", U.author.uid, null, productionUrl));
    assert.equal((await mediaRef(g, "old1").get()).exists, true);
  });

  test("URL di staging (giovani-palo-staging.firebasestorage.app) accettati", async () => {
    const g = await newGallery();
    await createMediaBatch(U.author, g, "s1", imageData(g, "s1", U.author.uid, null, stagingUrl));
    assert.equal((await mediaRef(g, "s1").get()).exists, true);
  });

  test("payload di UploadManagerProvider con file e URL veri (getDownloadURL dell'emulatore): accettato", async () => {
    const g = await newGallery();
    const { data, urls } = await realImageData(U.author, g, "r1");
    assert.match(urls[0], new RegExp(`^http://(127\\.0\\.0\\.1|localhost):\\d+/v0/b/${BUCKET.replaceAll(".", "\\.")}/o/protected%2F`, "u"), "formato dell'URL dell'emulatore");
    await createMediaBatch(U.author, g, "r1", data);
    assert.equal((await mediaRef(g, "r1").get()).data().storageUrl, data.storageUrl);
    assert.equal(await galleryCount(g), 1);
  });

  test("il media può essere creato con caption di 500 caratteri e con campi opzionali null", async () => {
    const g = await newGallery();
    await createMediaBatch(U.author, g, "c1", imageData(g, "c1", U.author.uid, (d) => { d.caption = "x".repeat(500); }));
    assert.equal((await mediaRef(g, "c1").get()).exists, true);
  });

  // [descrizione, mutazione del payload ammesso]
  const SINGLE_DEFECTS = [
    ["uploadedBy = uid dell'admin che ha creato la galleria (invariante)", (d) => { d.uploadedBy = U.admin.uid; }],
    ["uploadedBy = uid di un altro partecipante", (d) => { d.uploadedBy = U.other.uid; }],
    ["uploadedBy assente", (d) => { delete d.uploadedBy; }],
    ["campo extra", (d) => { d.extra = "x"; }],
    ["campo hidden (il nascondimento è solo della callable)", (d) => { d.hidden = true; }],
    ["campo hiddenBy", (d) => { d.hiddenBy = "x"; }],
    ["likeCount 1", (d) => { d.likeCount = 1; }],
    ["likeCount negativo", (d) => { d.likeCount = -1; }],
    ["likeCount assente", (d) => { delete d.likeCount; }],
    ["type audio", (d) => { d.type = "audio"; }],
    ["type assente", (d) => { delete d.type; }],
    ["type documento", (d) => { d.type = "document"; }],
    ["storageUrl esterno (https://example.com/x.jpg)", (d) => { d.storageUrl = "https://example.com/x.jpg"; }],
    ["optimizedUrl esterno", (d) => { d.optimizedUrl = "https://example.com/y.jpg"; }],
    ["thumbnailUrl esterno", (d) => { d.thumbnailUrl = "https://evil.test/t.jpg"; }],
    ["URL di storage di un altro bucket path (palo B)", (d) => { d.storageUrl = d.storageUrl.replace(`%2Fstakes%2F${STAKE_A}%2F`, `%2Fstakes%2F${STAKE_B}%2F`); }],
    ["storagePath nel palo B", (d) => { d.storagePath = d.storagePath.replace(`/stakes/${STAKE_A}/`, `/stakes/${STAKE_B}/`); }],
    ["storagePath con cartella di un altro media", (d, id) => { d.storagePath = d.storagePath.replace(`/media/${id}/`, "/media/altro-media/"); }],
    ["optimizedPath con cartella di un altro media", (d, id) => { d.optimizedPath = d.optimizedPath.replace(`/media/${id}/`, "/media/altro-media/"); }],
    ["thumbnailPath con cartella di un'altra galleria", (d) => { d.thumbnailPath = d.thumbnailPath.replace(/galleries\/[^/]+\//u, "galleries/altra-galleria/"); }],
    ["storagePath fuori da protected/ (public/)", (d) => { d.storagePath = "public/stakes/x/foto.jpg"; }],
    ["storagePath annidato in una sottocartella", (d) => { d.storagePath += "/../x.jpg"; }],
    ["storagePath non stringa", (d) => { d.storagePath = 42; }],
    ["activityId di un'altra attività", (d) => { d.activityId = "altra-attivita"; }],
    ["activityId null su galleria con activityId", (d) => { d.activityId = null; }],
    ["caption oltre 500 caratteri", (d) => { d.caption = "x".repeat(501); }],
    ["caption non stringa", (d) => { d.caption = 12; }],
    ["createdAt nel futuro lontano (9999-12-31T23:59:59.999Z)", (d) => { d.createdAt = "9999-12-31T23:59:59.999Z"; }],
    ["createdAt senza ora (solo data)", (d) => { d.createdAt = "2026-10-15"; }],
    ["createdAt non stringa", (d) => { d.createdAt = Date.now(); }],
    ["createdAt senza millisecondi (lunghezza diversa da 24)", (d) => { d.createdAt = "2026-10-15T12:00:00Z"; }],
    ["order stringa", (d) => { d.order = "1"; }],
    ["order decimale", (d) => { d.order = 1.5; }],
    ["storageUrl verso un altro bucket Firebase con lo stesso path", (d) => {
      d.storageUrl = `https://firebasestorage.googleapis.com/v0/b/altro-progetto.firebasestorage.app/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["thumbnailUrl verso un altro bucket Firebase con lo stesso path", (d) => {
      d.thumbnailUrl = `https://firebasestorage.googleapis.com/v0/b/altro-progetto.appspot.com/o/${encodeURIComponent(d.thumbnailPath)}?alt=media&token=t`;
    }],
    ["URL dell'emulatore con bucket estraneo (altro-progetto.firebasestorage.app)", (d) => {
      d.storageUrl = `http://${STORAGE.raw}/v0/b/altro-progetto.firebasestorage.app/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL dell'emulatore con bucket estraneo (altro-progetto.appspot.com)", (d) => {
      d.thumbnailUrl = `http://localhost:9299/v0/b/altro-progetto.appspot.com/o/${encodeURIComponent(d.thumbnailPath)}?alt=media&token=t`;
    }],
    ["URL dell'emulatore con bucket che imita quello di produzione (giovani-palo-evil.firebasestorage.app)", (d) => {
      d.storageUrl = `http://${STORAGE.raw}/v0/b/giovani-palo-evil.firebasestorage.app/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL di produzione con bucket demo-*", (d) => {
      d.storageUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL di produzione in http (non https)", (d) => {
      d.storageUrl = `http://firebasestorage.googleapis.com/v0/b/giovani-palo.firebasestorage.app/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL con host che imita il bucket (giovani-palo.firebasestorage.app.evil.test)", (d) => {
      d.storageUrl = `https://firebasestorage.googleapis.com/v0/b/giovani-palo.firebasestorage.app.evil.test/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL con bucket che imita quello UE (giovani-palo-eu-evil)", (d) => {
      d.storageUrl = `https://firebasestorage.googleapis.com/v0/b/giovani-palo-eu-evil/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL con host che imita il bucket UE (giovani-palo-eu.evil.test)", (d) => {
      d.storageUrl = `https://firebasestorage.googleapis.com/v0/b/giovani-palo-eu.evil.test/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL con bucket che ha un prefisso davanti al bucket UE (xgiovani-palo-eu)", (d) => {
      d.storageUrl = `https://firebasestorage.googleapis.com/v0/b/xgiovani-palo-eu/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL con bucket UE nel suffisso del bucket di un altro progetto (altro-giovani-palo-eu)", (d) => {
      d.thumbnailUrl = `https://firebasestorage.googleapis.com/v0/b/altro-giovani-palo-eu/o/${encodeURIComponent(d.thumbnailPath)}?alt=media&token=t`;
    }],
    ["URL con il bucket UE come dominio .firebasestorage.app (giovani-palo-eu.firebasestorage.app)", (d) => {
      d.storageUrl = `https://firebasestorage.googleapis.com/v0/b/giovani-palo-eu.firebasestorage.app/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL del bucket UE in http (non https) su firebasestorage.googleapis.com", (d) => {
      d.storageUrl = `http://firebasestorage.googleapis.com/v0/b/giovani-palo-eu/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL del bucket UE in http su un host qualunque fuori da localhost (evil.test)", (d) => {
      d.optimizedUrl = `http://evil.test/v0/b/giovani-palo-eu/o/${encodeURIComponent(d.optimizedPath)}?alt=media&token=t`;
    }],
    ["URL del bucket UE in https su un host qualunque (evil.test)", (d) => {
      d.thumbnailUrl = `https://evil.test/v0/b/giovani-palo-eu/o/${encodeURIComponent(d.thumbnailPath)}?alt=media&token=t`;
    }],
    ["URL del bucket UE su un host che imita localhost (localhost.evil.test)", (d) => {
      d.storageUrl = `http://localhost.evil.test:9299/v0/b/giovani-palo-eu/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL dell'emulatore con bucket che imita quello UE (giovani-palo-eu-evil)", (d) => {
      d.storageUrl = `http://${STORAGE.raw}/v0/b/giovani-palo-eu-evil/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL dell'emulatore con host che imita il bucket UE (giovani-palo-eu.evil.test)", (d) => {
      d.storageUrl = `http://${STORAGE.raw}/v0/b/giovani-palo-eu.evil.test/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL dell'emulatore con prefisso davanti al bucket UE (xgiovani-palo-eu)", (d) => {
      d.storageUrl = `http://${STORAGE.raw}/v0/b/xgiovani-palo-eu/o/${encodeURIComponent(d.storagePath)}?alt=media&token=t`;
    }],
    ["URL del bucket UE con path di un altro palo (palo B)", (d) => {
      d.storageUrl = euProductionUrl(d.storagePath).replace(`%2Fstakes%2F${STAKE_A}%2F`, `%2Fstakes%2F${STAKE_B}%2F`);
    }],
  ];

  for (const [label, mutate] of SINGLE_DEFECTS) {
    test(`negato: ${label}`, async () => {
      const g = await newGallery({ createdBy: U.admin.uid });
      const mediaId = "m-bad";
      const valid = imageData(g, mediaId, U.author.uid);
      const mutated = structuredClone(valid);
      mutate(mutated, mediaId);
      assert.notDeepEqual(mutated, valid, "la mutazione deve cambiare il payload");
      await expectDenied(createMediaBatch(U.author, g, mediaId, mutated), label);
      assert.equal((await mediaRef(g, mediaId).get()).exists, false, "il media non deve esistere");
      assert.equal(await galleryCount(g), 0, "il contatore non deve muoversi (batch atomico)");
      // Controllo positivo: lo stesso payload senza il difetto passa, quindi il rifiuto è dovuto alla sola mutazione.
      await createMediaBatch(U.author, g, mediaId, valid);
      assert.equal((await mediaRef(g, mediaId).get()).exists, true);
    });
  }

  test("negato: galleria chiusa da un admin (uploadsClosed true); riaperta, passa", async () => {
    const g = await newGallery({ closed: true });
    const data = imageData(g, "m1", U.author.uid);
    await expectDenied(createMediaBatch(U.author, g, "m1", data));
    assert.equal((await mediaRef(g, "m1").get()).exists, false);
    await galleryRef(g).update({ uploadsClosed: false });
    await createMediaBatch(U.author, g, "m1", data);
    assert.equal((await mediaRef(g, "m1").get()).exists, true);
  });

  test("negato: finestra scaduta; prorogata, passa", async () => {
    const g = await newGallery({ window: "expired" });
    const data = imageData(g, "m1", U.author.uid);
    await expectDenied(createMediaBatch(U.author, g, "m1", data));
    await galleryRef(g).update({ uploadsOpenUntil: Timestamp.fromMillis(Date.now() + DAY) });
    await createMediaBatch(U.author, g, "m1", data);
    assert.equal((await mediaRef(g, "m1").get()).exists, true);
  });

  test("negato: finestra non ancora aperta; aperta, passa", async () => {
    const g = await newGallery({ window: "future" });
    const data = imageData(g, "m1", U.author.uid);
    await expectDenied(createMediaBatch(U.author, g, "m1", data));
    await galleryRef(g).update({ uploadsOpenFrom: Timestamp.fromMillis(Date.now() - HOUR) });
    await createMediaBatch(U.author, g, "m1", data);
    assert.equal((await mediaRef(g, "m1").get()).exists, true);
  });

  test("negato: galleria senza finestra (legacy); con la finestra, passa", async () => {
    const g = await newGallery({ window: "none" });
    const data = imageData(g, "m1", U.author.uid);
    await expectDenied(createMediaBatch(U.author, g, "m1", data));
    await galleryRef(g).update({
      uploadsOpenFrom: Timestamp.fromMillis(Date.now() - HOUR),
      uploadsOpenUntil: Timestamp.fromMillis(Date.now() + DAY),
    });
    await createMediaBatch(U.author, g, "m1", data);
    assert.equal((await mediaRef(g, "m1").get()).exists, true);
  });

  test("negato: finestra scritta come stringa invece che Timestamp", async () => {
    const g = await newGallery({ window: "none" });
    await galleryRef(g).update({ uploadsOpenFrom: iso(Date.now() - HOUR), uploadsOpenUntil: iso(Date.now() + DAY) });
    await expectDenied(createMediaBatch(U.author, g, "m1", imageData(g, "m1", U.author.uid)));
  });

  test("galleria chiusa o scaduta: l'admin può comunque creare", async () => {
    const g = await newGallery({ closed: true, window: "expired" });
    await createMediaBatch(U.admin, g, "m1", imageData(g, "m1", U.admin.uid));
    assert.equal((await mediaRef(g, "m1").get()).exists, true);
  });

  for (const key of OUTSIDERS) {
    test(`negato: ${key} non crea media`, async () => {
      const g = await newGallery();
      const actorUid = U[key].uid ?? "uid-finto";
      await expectDenied(createMediaBatch(U[key], g, "m1", imageData(g, "m1", actorUid)), key);
      assert.equal((await mediaRef(g, "m1").get()).exists, false);
      assert.equal(await galleryCount(g), 0);
    });
  }

  test("negato: crea media in una galleria che non esiste", async () => {
    const g = { stakeId: STAKE_A, galleryId: `inesistente-${runId}`, activityId: "x" };
    await expectDenied(createMediaBatch(U.author, g, "m1", imageData(g, "m1", U.author.uid)));
  });

  test("il create del media da solo (senza batch) è ammesso e non muove il contatore: lo muove solo il batch", async () => {
    const g = await newGallery();
    await setDoc(clientMediaDoc(U.author, g, "solo"), imageData(g, "solo", U.author.uid));
    assert.equal(await galleryCount(g), 0, "il contatore resta com'era: lo muove solo il batch");
  });
});

// ---------------------------------------------------------------------------
// 4. Rules: contatore della galleria
// ---------------------------------------------------------------------------
describe("rules: contatore mediaCount", () => {
  const update = (actor, g, patch) => updateDoc(doc(actor.db, galleryPath(g)), patch);

  for (const key of MEMBERS.filter((item) => item !== "admin")) {
    test(`${key}: +1 e -1 ok`, async () => {
      const g = await newGallery({ mediaCount: 3 });
      await update(U[key], g, { mediaCount: increment(1), updatedAt: iso() });
      assert.equal(await galleryCount(g), 4);
      await update(U[key], g, { mediaCount: increment(-1), updatedAt: iso() });
      assert.equal(await galleryCount(g), 3);
    });
  }

  test("+5 negato, -2 negato, azzeramento negato", async () => {
    const g = await newGallery({ mediaCount: 3 });
    await expectDenied(update(U.author, g, { mediaCount: increment(5), updatedAt: iso() }));
    await expectDenied(update(U.author, g, { mediaCount: increment(-2), updatedAt: iso() }));
    await expectDenied(update(U.author, g, { mediaCount: 0, updatedAt: iso() }));
    await expectDenied(update(U.author, g, { mediaCount: 999999, updatedAt: iso() }));
    assert.equal(await galleryCount(g), 3);
  });

  test("cambio di altri campi negato (titolo, chiusura, finestra, createdBy, pubblicazione)", async () => {
    const g = await newGallery({ mediaCount: 3, closed: true });
    const patches = [
      { title: "Cambiato" },
      { mediaCount: increment(1), title: "Cambiato" },
      { uploadsClosed: false },
      { mediaCount: increment(1), uploadsClosed: false },
      { uploadsOpenUntil: ClientTimestamp.fromMillis(Date.now() + 365 * DAY) },
      { createdBy: U.author.uid },
      { published: true },
      { activityId: "altra" },
    ];
    for (const patch of patches) {
      await expectDenied(update(U.author, g, patch), JSON.stringify(Object.keys(patch)));
      await expectDenied(update(U.leader, g, patch), `dirigente ${JSON.stringify(Object.keys(patch))}`);
    }
    const data = (await galleryRef(g).get()).data();
    assert.equal(data.title, "Galleria di prova");
    assert.equal(data.uploadsClosed, true);
    assert.equal(data.mediaCount, 3);
  });

  test("l'admin può cambiare qualunque campo (chiusura, finestra, titolo)", async () => {
    const g = await newGallery({ mediaCount: 3 });
    await update(U.admin, g, { uploadsClosed: true, title: "Rinominata", mediaCount: 10 });
    const data = (await galleryRef(g).get()).data();
    assert.equal(data.uploadsClosed, true);
    assert.equal(data.mediaCount, 10);
  });

  for (const key of OUTSIDERS) {
    test(`${key}: nemmeno il +1`, async () => {
      const g = await newGallery({ mediaCount: 3 });
      await expectDenied(update(U[key], g, { mediaCount: increment(1), updatedAt: iso() }), key);
      assert.equal(await galleryCount(g), 3);
    });
  }

  test("creare o cancellare una galleria: solo l'admin del palo", async () => {
    const id = `nuova-${runId}`;
    const data = { title: "Mia", activityId: "x", mediaCount: 0 };
    await expectDenied(setDoc(doc(U.author.db, `stakes/${STAKE_A}/galleries/${id}`), data), "autore crea");
    await expectDenied(setDoc(doc(U.leader.db, `stakes/${STAKE_A}/galleries/${id}`), data), "dirigente crea");
    await expectDenied(setDoc(doc(U.adminB.db, `stakes/${STAKE_A}/galleries/${id}`), data), "admin B crea");
    const g = await newGallery();
    await expectDenied(deleteDoc(doc(U.author.db, galleryPath(g))), "autore cancella");
    await expectDenied(deleteDoc(doc(U.leader.db, galleryPath(g))), "dirigente cancella");
    await setDoc(doc(U.admin.db, `stakes/${STAKE_A}/galleries/${id}`), data);
    await deleteDoc(doc(U.admin.db, galleryPath(g)));
  });
});

// ---------------------------------------------------------------------------
// 5. Rules: like
// ---------------------------------------------------------------------------
describe("rules: like", () => {
  const likeDocPath = (g, mediaId, uid) => `${mediaPathOf(g)}/${mediaId}/likes/${uid}`;
  const likeCount = async (g, mediaId) => (await mediaRef(g, mediaId).get()).data().likeCount;
  const likeDocs = async (g, mediaId) => (await mediaRef(g, mediaId).collection("likes").get()).size;

  test("likeMedia e unlikeMedia esatti: ok", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await likeMedia(U.other, g, "m1");
    assert.equal(await likeCount(g, "m1"), 1);
    assert.equal(await likeDocs(g, "m1"), 1);
    await likeMedia(U.parent, g, "m1");
    assert.equal(await likeCount(g, "m1"), 2);
    await unlikeMedia(U.other, g, "m1");
    assert.equal(await likeCount(g, "m1"), 1);
    assert.equal(await likeDocs(g, "m1"), 1);
  });

  test("anche l'autore, il dirigente e l'admin possono mettere like", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    for (const key of ["author", "leader", "admin"]) await likeMedia(U[key], g, "m1");
    assert.equal(await likeCount(g, "m1"), 3);
  });

  test("likeCount +1 senza il doc like: negato", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await expectDenied(updateDoc(clientMediaDoc(U.other, g, "m1"), { likeCount: increment(1) }));
    assert.equal(await likeCount(g, "m1"), 0);
  });

  test("likeCount +2 anche con il doc like: negato", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    const batch = writeBatch(U.other.db);
    batch.set(doc(U.other.db, likeDocPath(g, "m1", U.other.uid)), { uid: U.other.uid, createdAt: iso() });
    batch.update(clientMediaDoc(U.other, g, "m1"), { likeCount: increment(2) });
    await expectDenied(batch.commit());
    assert.equal(await likeCount(g, "m1"), 0);
    assert.equal(await likeDocs(g, "m1"), 0);
  });

  test("like su un doc di un altro uid: negato (batch e singola scrittura)", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    const batch = writeBatch(U.other.db);
    batch.set(doc(U.other.db, likeDocPath(g, "m1", U.author.uid)), { uid: U.author.uid, createdAt: iso() });
    batch.update(clientMediaDoc(U.other, g, "m1"), { likeCount: increment(1) });
    await expectDenied(batch.commit());
    await expectDenied(setDoc(doc(U.other.db, likeDocPath(g, "m1", U.author.uid)), { uid: U.author.uid, createdAt: iso() }));
    assert.equal(await likeCount(g, "m1"), 0);
    assert.equal(await likeDocs(g, "m1"), 0);
  });

  test("togliere il like di un altro uid: negato", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await likeMedia(U.author, g, "m1");
    await expectDenied(deleteDoc(doc(U.other.db, likeDocPath(g, "m1", U.author.uid))));
    assert.equal(await likeDocs(g, "m1"), 1);
  });

  test("decremento senza cancellare il like: negato", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await likeMedia(U.other, g, "m1");
    await expectDenied(updateDoc(clientMediaDoc(U.other, g, "m1"), { likeCount: increment(-1) }));
    assert.equal(await likeCount(g, "m1"), 1);
  });

  test("il like non permette di toccare altri campi del media (caption, uploadedBy, hidden)", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await expectDenied(updateDoc(clientMediaDoc(U.other, g, "m1"), { caption: "mia" }));
    await expectDenied(updateDoc(clientMediaDoc(U.author, g, "m1"), { caption: "mia" }), "nemmeno l'autore");
    await expectDenied(updateDoc(clientMediaDoc(U.author, g, "m1"), { uploadedBy: U.other.uid }));
    await expectDenied(updateDoc(clientMediaDoc(U.leader, g, "m1"), { caption: "mia" }), "nemmeno il dirigente");
    const batch = writeBatch(U.other.db);
    batch.set(doc(U.other.db, likeDocPath(g, "m1", U.other.uid)), { uid: U.other.uid, createdAt: iso() });
    batch.update(clientMediaDoc(U.other, g, "m1"), { likeCount: increment(1), caption: "mia" });
    await expectDenied(batch.commit());
    await updateDoc(doc(U.admin.db, `${mediaPathOf(g)}/m1`), { caption: "dell'admin" });
  });

  for (const key of OUTSIDERS) {
    test(`${key}: nessun like`, async () => {
      const g = await newGallery();
      await seedMedia(g, "m1", U.author.uid);
      const uid = U[key].uid ?? "uid-finto";
      const batch = writeBatch(U[key].db);
      batch.set(doc(U[key].db, likeDocPath(g, "m1", uid)), { uid, createdAt: iso() });
      batch.update(clientMediaDoc(U[key], g, "m1"), { likeCount: increment(1) });
      await expectDenied(batch.commit(), key);
      assert.equal(await likeCount(g, "m1"), 0);
    });
  }

  // Il doc like nasce e muore solo insieme al +1/-1 del contatore, nello stesso batch.
  test("like, poi doc like cancellato da solo, poi like di nuovo: la cancellazione da sola è negata, likeCount = doc like", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await likeMedia(U.other, g, "m1");
    await expectDenied(deleteDoc(doc(U.other.db, likeDocPath(g, "m1", U.other.uid))), "cancellazione del solo doc like");
    await likeMedia(U.other, g, "m1"); // il doc esiste ancora: no-op del client
    assert.equal(await likeCount(g, "m1"), 1);
    assert.equal(await likeDocs(g, "m1"), 1);
    await unlikeMedia(U.other, g, "m1");
    await likeMedia(U.other, g, "m1");
    assert.equal(await likeCount(g, "m1"), await likeDocs(g, "m1"));
  });

  test("doc like creato da solo (senza +1): negato; quindi nessun unlike porta il contatore sotto zero", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await expectDenied(setDoc(doc(U.other.db, likeDocPath(g, "m1", U.other.uid)), { uid: U.other.uid, createdAt: iso() }));
    assert.equal(await likeDocs(g, "m1"), 0);
    // unlike senza like: il client non scrive niente; scritto a mano, il batch è negato.
    const batch = writeBatch(U.other.db);
    batch.delete(doc(U.other.db, likeDocPath(g, "m1", U.other.uid)));
    batch.update(clientMediaDoc(U.other, g, "m1"), { likeCount: increment(-1) });
    await expectDenied(batch.commit());
    assert.equal(await likeCount(g, "m1"), 0);
  });

  test("doc like creato con +1 ma su un altro media dello stesso batch: negato", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await seedMedia(g, "m2", U.author.uid);
    const batch = writeBatch(U.other.db);
    batch.set(doc(U.other.db, likeDocPath(g, "m1", U.other.uid)), { uid: U.other.uid, createdAt: iso() });
    batch.update(clientMediaDoc(U.other, g, "m2"), { likeCount: increment(1) });
    await expectDenied(batch.commit());
    assert.equal(await likeDocs(g, "m1"), 0);
  });

  test("doc like cancellato con -1 coerente ma su likeCount già 0 (dato incoerente): niente contatore negativo per i flussi normali", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await likeMedia(U.other, g, "m1");
    await unlikeMedia(U.other, g, "m1");
    await unlikeMedia(U.other, g, "m1"); // secondo unlike: no-op del client
    assert.equal(await likeCount(g, "m1"), 0);
  });
});

// ---------------------------------------------------------------------------
// 6. Rules: cancellazione del media (batch di deleteMedia)
// ---------------------------------------------------------------------------
describe("rules: cancellazione media", () => {
  async function scenario() {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    return g;
  }

  for (const key of ["author", "leader", "admin"]) {
    test(`${key} cancella il media (batch con mediaCount -1): ok`, async () => {
      const g = await scenario();
      await deleteMediaBatch(U[key], g, "m1");
      assert.equal((await mediaRef(g, "m1").get()).exists, false);
      assert.equal(await galleryCount(g), 0);
    });
  }

  for (const key of ["other", "parent", "memberB", "adminB", "anon", "noDoc", "signedOut"]) {
    test(`${key} non cancella il media dell'autore`, async () => {
      const g = await scenario();
      await expectDenied(deleteMediaBatch(U[key], g, "m1"), key);
      assert.equal((await mediaRef(g, "m1").get()).exists, true);
      assert.equal(await galleryCount(g), 1, "batch atomico: contatore invariato");
    });
  }

  test("autore con profilo del palo B (uploadedBy suo, ma non è del palo A) non cancella", async () => {
    const g = await newGallery();
    await seedMedia(g, "m-b", U.memberB.uid); // finto: autore di un altro palo
    await expectDenied(deleteMediaBatch(U.memberB, g, "m-b"), "autore ma di un altro palo");
    assert.equal((await mediaRef(g, "m-b").get()).exists, true);
  });

  test("un doc con uploadedBy mancante non è cancellabile da un partecipante", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid, (d) => { delete d.uploadedBy; });
    await expectDenied(deleteMediaBatch(U.author, g, "m1"));
    await deleteMediaBatch(U.admin, g, "m1");
  });
});

// ---------------------------------------------------------------------------
// 7. Callable: report, restore, delete
// ---------------------------------------------------------------------------
const report = (actor, g, mediaId, reason = "inappropriate") =>
  actor.call({ action: "report", stakeId: g.stakeId, galleryId: g.galleryId, mediaId, reason });
const restore = (actor, g, mediaId) => actor.call({ action: "restore", stakeId: g.stakeId, galleryId: g.galleryId, mediaId });
const deleteHidden = (actor, g, mediaId) => actor.call({ action: "delete", stakeId: g.stakeId, galleryId: g.galleryId, mediaId });
const reportsOf = async (g, mediaId) =>
  (await galleryRef(g).collection("reports").where("mediaId", "==", mediaId).get()).docs;

describe("callable report", () => {
  test("il partecipante segnala il media di un altro: sparisce da media, compare in hiddenMedia, mediaCount -1, report creato", async () => {
    const g = await newGallery();
    const original = await seedMedia(g, "m1", U.author.uid);
    assert.equal(await galleryCount(g), 1);
    assert.deepEqual(await report(U.other, g, "m1", "inappropriate"), { status: "hidden" });
    assert.equal((await mediaRef(g, "m1").get()).exists, false, "tolto da media");
    const hidden = (await hiddenRef(g, "m1").get()).data();
    assert.equal(hidden.hiddenBy, U.other.uid);
    assert.equal(hidden.hiddenReason, "inappropriate");
    assert.equal(typeof hidden.hiddenAt, "string");
    assert.equal(hidden.uploadedBy, U.author.uid, "l'autore resta quello originale");
    for (const key of Object.keys(original)) assert.deepEqual(hidden[key], original[key], `campo ${key} conservato`);
    assert.equal(await galleryCount(g), 0, "mediaCount -1");
    const reports = await reportsOf(g, "m1");
    assert.equal(reports.length, 1);
    assert.match(reports[0].id, new RegExp(`^m1_${U.other.uid}_\\d+$`, "u"), "id del report: mediaId_uid_millisecondi");
    const data = reports[0].data();
    assert.equal(data.reporterUid, U.other.uid);
    assert.equal(data.reason, "inappropriate");
    assert.equal(data.status, "open");
    assert.equal(data.uploadedBy, U.author.uid);
    assert.equal(data.resolvedAt, null);
  });

  test("tutti i motivi ammessi funzionano", async () => {
    const g = await newGallery();
    for (const reason of ["mine", "inappropriate", "off_topic"]) {
      await seedMedia(g, `m-${reason}`, U.author.uid);
      assert.deepEqual(await report(U.other, g, `m-${reason}`, reason), { status: "hidden" }, reason);
      assert.equal((await hiddenRef(g, `m-${reason}`).get()).data().hiddenReason, reason);
    }
  });

  test("l'autore può nascondere il proprio media con il motivo 'mine'", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    assert.deepEqual(await report(U.author, g, "m1", "mine"), { status: "hidden" });
    assert.equal((await hiddenRef(g, "m1").get()).exists, true);
  });

  test("doppia segnalazione dello stesso utente non conta due volte", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await report(U.other, g, "m1");
    const second = await report(U.other, g, "m1");
    assert.equal(second.status, "already_hidden");
    assert.equal((await reportsOf(g, "m1")).length, 1);
    assert.equal(await galleryCount(g), 0, "mediaCount decrementato una volta sola");
  });

  test("segnalazione di un media già nascosto da un altro: already_hidden, nessun nuovo report, contatore invariato", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await report(U.other, g, "m1", "inappropriate");
    const result = await report(U.parent, g, "m1", "off_topic");
    assert.deepEqual(result, { status: "already_hidden" });
    assert.equal((await reportsOf(g, "m1")).length, 1);
    assert.equal((await hiddenRef(g, "m1").get()).data().hiddenBy, U.other.uid, "resta la prima segnalazione");
    assert.equal(await galleryCount(g), 0);
  });

  test("due segnalazioni in parallelo dello stesso media: lo stato finale resta coerente (integrità dei dati)", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const g = await newGallery();
      await seedMedia(g, "m1", U.author.uid);
      await seedMedia(g, "m2", U.author.uid);
      const outcomes = await Promise.allSettled([report(U.other, g, "m1"), report(U.parent, g, "m1")]);
      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") assert.ok(["hidden", "already_hidden"].includes(outcome.value.status), `round ${round}`);
      }
      assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled" && outcome.value.status === "hidden"), `round ${round}: almeno una nasconde`);
      assert.equal((await mediaRef(g, "m1").get()).exists, false, `round ${round}`);
      assert.equal((await hiddenRef(g, "m1").get()).exists, true, `round ${round}`);
      assert.equal(await galleryCount(g), 1, `round ${round}: mediaCount -1 una volta sola`);
      assert.equal((await reportsOf(g, "m1")).length, 1, `round ${round}: un solo report`);
    }
  });

  test("due segnalazioni in parallelo dello stesso media: nessuna delle due fallisce (una nasconde, l'altra already_hidden)", { timeout: 300_000 }, async () => {
    // Almeno 10 giri: con meno la collisione fra le due transazioni non è garantita.
    for (let round = 0; round < Math.max(ROUNDS, 10); round += 1) {
      const g = await newGallery();
      await seedMedia(g, "m1", U.author.uid);
      const results = await Promise.all([report(U.other, g, "m1"), report(U.parent, g, "m1")]);
      assert.deepEqual(results.map((item) => item.status).sort(), ["already_hidden", "hidden"], `round ${round}`);
    }
  });

  test("motivo non valido o mancante: invalid-argument, il media resta dov'è", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await expectCallableError(report(U.other, g, "m1", "spam"), "invalid-argument");
    await expectCallableError(report(U.other, g, "m1", ""), "invalid-argument");
    await expectCallableError(
      U.other.call({ action: "report", stakeId: g.stakeId, galleryId: g.galleryId, mediaId: "m1" }),
      "invalid-argument",
      "motivo assente",
    );
    await expectCallableError(report(U.other, g, "m1", "__proto__"), "invalid-argument");
    assert.equal((await mediaRef(g, "m1").get()).exists, true);
    assert.equal(await galleryCount(g), 1);
  });

  test("oltre 10 segnalazioni dello stesso utente nella galleria: resource-exhausted; un altro utente può ancora", async () => {
    const g = await newGallery();
    for (let index = 1; index <= 11; index += 1) await seedMedia(g, `m${index}`, U.author.uid);
    for (let index = 1; index <= 10; index += 1) {
      assert.deepEqual(await report(U.other, g, `m${index}`), { status: "hidden" }, `segnalazione ${index}`);
    }
    await expectCallableError(report(U.other, g, "m11"), "resource-exhausted");
    assert.equal((await mediaRef(g, "m11").get()).exists, true, "l'undicesimo resta visibile");
    assert.equal(await galleryCount(g), 1);
    assert.deepEqual(await report(U.parent, g, "m11"), { status: "hidden" });
  });

  test("il tetto conta le segnalazioni APERTE: dopo un restore dello staff l'utente ne può fare un'altra", async () => {
    const g = await newGallery();
    for (let index = 1; index <= 12; index += 1) await seedMedia(g, `m${index}`, U.author.uid);
    for (let index = 1; index <= 10; index += 1) await report(U.other, g, `m${index}`);
    await expectCallableError(report(U.other, g, "m11"), "resource-exhausted");
    await restore(U.admin, g, "m1");
    assert.deepEqual(await report(U.other, g, "m11"), { status: "hidden" }, "9 aperte + 1");
    await expectCallableError(report(U.other, g, "m12"), "resource-exhausted", "di nuovo a 10 aperte");
    // Una segnalazione già lavorata come 'deleted' non conta più.
    await deleteHidden(U.admin, g, "m2");
    assert.deepEqual(await report(U.other, g, "m12"), { status: "hidden" });
  });

  test("il tetto è per galleria: in un'altra galleria lo stesso utente segnala ancora", async () => {
    const g1 = await newGallery();
    const g2 = await newGallery();
    for (let index = 1; index <= 10; index += 1) {
      await seedMedia(g1, `m${index}`, U.author.uid);
      await report(U.other, g1, `m${index}`);
    }
    await seedMedia(g2, "x1", U.author.uid);
    assert.deepEqual(await report(U.other, g2, "x1"), { status: "hidden" });
  });

  test("media inesistente: not-found", async () => {
    const g = await newGallery();
    await expectCallableError(report(U.other, g, "non-esiste"), "not-found");
  });

  test("anonimo, palo B, admin di un altro palo, senza doc: permission-denied; non loggato: unauthenticated", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    for (const key of ["anon", "memberB", "adminB", "noDoc"]) {
      await expectCallableError(report(U[key], g, "m1"), "permission-denied", key);
    }
    await expectCallableError(report(U.signedOut, g, "m1"), "unauthenticated");
    assert.equal((await mediaRef(g, "m1").get()).exists, true);
  });

  test("un utente del palo B non tocca la galleria del palo A passando il proprio stakeId", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await expectCallableError(
      U.memberB.call({ action: "report", stakeId: STAKE_B, galleryId: g.galleryId, mediaId: "m1", reason: "mine" }),
      "not-found",
    );
    assert.equal((await mediaRef(g, "m1").get()).exists, true);
    assert.equal(await galleryCount(g), 1);
  });

  test("galleryId o mediaId non validi: invalid-argument", async () => {
    const g = await newGallery();
    await expectCallableError(U.other.call({ action: "report", stakeId: STAKE_A, galleryId: "a/b", mediaId: "m", reason: "mine" }), "invalid-argument");
    await expectCallableError(U.other.call({ action: "report", stakeId: STAKE_A, galleryId: g.galleryId, mediaId: "", reason: "mine" }), "invalid-argument");
  });
});

describe("rules: hiddenMedia e reports", () => {
  let g;
  let reportId;
  before(async () => {
    g = await newGallery();
    await seedMedia(g, "h1", U.author.uid);
    await seedMedia(g, "h2", U.other.uid);
    await report(U.parent, g, "h1");
    await report(U.parent, g, "h2");
    reportId = (await reportsOf(g, "h1"))[0].id;
  });

  const hiddenPath = () => `${galleryPath(g)}/hiddenMedia`;
  const reportsPath = () => `${galleryPath(g)}/reports`;

  for (const key of ["admin", "leader"]) {
    test(`${key} (staff) legge tutti i nascosti e tutte le segnalazioni`, async () => {
      assert.equal((await clientDocs(U[key], hiddenPath())).size, 2);
      assert.equal((await getDocFromServer(doc(U[key].db, `${hiddenPath()}/h1`))).exists(), true);
      assert.equal((await clientDocs(U[key], reportsPath())).size, 2);
      assert.equal((await getDocFromServer(doc(U[key].db, `${reportsPath()}/${reportId}`))).exists(), true);
    });
  }

  test("l'autore legge i propri nascosti con where('uploadedBy','==',uid) e il proprio doc", async () => {
    const own = await clientDocs(U.author, hiddenPath(), where("uploadedBy", "==", U.author.uid));
    assert.deepEqual(own.docs.map((item) => item.id), ["h1"]);
    assert.equal((await getDocFromServer(doc(U.author.db, `${hiddenPath()}/h1`))).exists(), true);
  });

  test("un altro partecipante: lista piena negata, filtro su uid altrui negato, doc altrui negato, filtro sul proprio uid ok", async () => {
    await expectDenied(clientDocs(U.other, hiddenPath()), "lista senza filtro");
    await expectDenied(clientDocs(U.other, hiddenPath(), where("uploadedBy", "==", U.author.uid)), "filtro su uid altrui");
    await expectDenied(getDocFromServer(doc(U.other.db, `${hiddenPath()}/h1`)), "get doc altrui");
    const own = await clientDocs(U.other, hiddenPath(), where("uploadedBy", "==", U.other.uid));
    assert.deepEqual(own.docs.map((item) => item.id), ["h2"]);
  });

  test("il genitore che ha segnalato non legge i nascosti (nemmeno quello che ha segnalato)", async () => {
    await expectDenied(clientDocs(U.parent, hiddenPath()));
    await expectDenied(getDocFromServer(doc(U.parent.db, `${hiddenPath()}/h1`)));
    await expectDenied(clientDocs(U.parent, hiddenPath(), where("uploadedBy", "==", U.author.uid)));
  });

  for (const key of OUTSIDERS) {
    test(`${key}: nessun accesso a hiddenMedia, nemmeno filtrando sul proprio uid`, async () => {
      await expectDenied(clientDocs(U[key], hiddenPath()), "lista");
      await expectDenied(clientDocs(U[key], hiddenPath(), where("uploadedBy", "==", U.author.uid)), "lista filtrata sull'autore");
      await expectDenied(getDocFromServer(doc(U[key].db, `${hiddenPath()}/h1`)), "get");
      await expectDenied(clientDocs(U[key], reportsPath()), "reports");
    });
  }

  test("reports: leggibili solo dallo staff (autore, segnalatore, altri membri negati)", async () => {
    for (const key of ["author", "other", "parent"]) {
      await expectDenied(clientDocs(U[key], reportsPath()), `lista ${key}`);
      await expectDenied(getDocFromServer(doc(U[key].db, `${reportsPath()}/${reportId}`)), `get ${key}`);
    }
  });

  test("nessuna scrittura client su hiddenMedia e reports, nemmeno dall'admin", async () => {
    for (const key of ["admin", "leader", "author", "other"]) {
      await expectDenied(setDoc(doc(U[key].db, `${hiddenPath()}/nuovo`), { uploadedBy: U[key].uid }), `crea hidden ${key}`);
      await expectDenied(updateDoc(doc(U[key].db, `${hiddenPath()}/h1`), { hiddenReason: "mine" }), `modifica hidden ${key}`);
      await expectDenied(deleteDoc(doc(U[key].db, `${hiddenPath()}/h1`)), `cancella hidden ${key}`);
      await expectDenied(setDoc(doc(U[key].db, `${reportsPath()}/finto`), { mediaId: "h1", reporterUid: U[key].uid }), `crea report ${key}`);
      await expectDenied(updateDoc(doc(U[key].db, `${reportsPath()}/${reportId}`), { status: "restored" }), `modifica report ${key}`);
      await expectDenied(deleteDoc(doc(U[key].db, `${reportsPath()}/${reportId}`)), `cancella report ${key}`);
    }
    assert.equal((await hiddenRef(g, "h1").get()).exists, true);
    assert.equal((await reportsOf(g, "h1")).length, 1);
  });

  test("un nascosto non rientra nell'elenco media dei membri (list media non lo contiene)", async () => {
    const media = await clientDocs(U.other, mediaPathOf(g));
    assert.equal(media.size, 0);
  });
});

describe("callable restore e delete", () => {
  async function hiddenScenario(reason = "inappropriate") {
    const g = await newGallery();
    const original = await seedMedia(g, "m1", U.author.uid);
    await report(U.other, g, "m1", reason);
    return { g, original };
  }

  test("restore: solo staff. Partecipante, genitore, autore, anonimo, palo B: permission-denied", async () => {
    const { g } = await hiddenScenario();
    for (const key of ["other", "author", "parent", "anon", "memberB", "adminB", "noDoc"]) {
      await expectCallableError(restore(U[key], g, "m1"), "permission-denied", `restore ${key}`);
      await expectCallableError(deleteHidden(U[key], g, "m1"), "permission-denied", `delete ${key}`);
    }
    await expectCallableError(restore(U.signedOut, g, "m1"), "unauthenticated");
    assert.equal((await hiddenRef(g, "m1").get()).exists, true, "ancora nascosto");
    assert.equal((await mediaRef(g, "m1").get()).exists, false);
    assert.equal((await reportsOf(g, "m1"))[0].data().status, "open");
  });

  for (const key of ["admin", "leader"]) {
    test(`restore da ${key}: doc in media senza campi hidden*, mediaCount +1, report 'restored'`, async () => {
      const { g, original } = await hiddenScenario();
      assert.equal(await galleryCount(g), 0);
      assert.deepEqual(await restore(U[key], g, "m1"), { status: "restored" });
      const restored = (await mediaRef(g, "m1").get()).data();
      for (const field of ["hiddenAt", "hiddenBy", "hiddenReason"]) assert.equal(field in restored, false, `${field} non deve tornare in media`);
      for (const field of Object.keys(original).filter((item) => item !== "updatedAt")) {
        assert.deepEqual(restored[field], original[field], `campo ${field} invariato`);
      }
      assert.equal((await hiddenRef(g, "m1").get()).exists, false);
      assert.equal(await galleryCount(g), 1);
      const reports = await reportsOf(g, "m1");
      assert.equal(reports.length, 1);
      assert.equal(reports[0].data().status, "restored");
      assert.equal(reports[0].data().resolvedBy, U[key].uid);
      assert.equal(typeof reports[0].data().resolvedAt, "string");
    });
  }

  test("dopo il restore il doc rispetta l'allowlist di creazione e riceve un like da un membro", async () => {
    const { g } = await hiddenScenario();
    await restore(U.admin, g, "m1");
    const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
    const match = rules.match(/function validMemberMediaCreate[\s\S]*?data\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/u);
    const allowlist = new Set([...match[1].matchAll(/'([A-Za-z]+)'/gu)].map((item) => item[1]));
    for (const key of Object.keys((await mediaRef(g, "m1").get()).data())) {
      assert.ok(allowlist.has(key), `campo ${key} fuori dall'allowlist: il doc ripristinato avvelenerebbe la galleria`);
    }
    await likeMedia(U.parent, g, "m1");
    assert.equal((await mediaRef(g, "m1").get()).data().likeCount, 1);
    await unlikeMedia(U.parent, g, "m1");
    assert.equal((await mediaRef(g, "m1").get()).data().likeCount, 0);
    // L'autore può di nuovo cancellare il proprio media ripristinato.
    await deleteMediaBatch(U.author, g, "m1");
    assert.equal((await mediaRef(g, "m1").get()).exists, false);
  });

  test("restore ripetuto o su media non nascosto: not-found, contatore invariato", async () => {
    const { g } = await hiddenScenario();
    await restore(U.admin, g, "m1");
    await expectCallableError(restore(U.admin, g, "m1"), "not-found");
    assert.equal(await galleryCount(g), 1);
    await expectCallableError(restore(U.admin, g, "mai-esistito"), "not-found");
    await expectCallableError(deleteHidden(U.admin, g, "m1"), "not-found", "il media visibile non si cancella con la callable");
    assert.equal((await mediaRef(g, "m1").get()).exists, true);
  });

  test("report, restore, report di nuovo: un SECONDO doc in reports (il trigger push scatta di nuovo)", async () => {
    const { g } = await hiddenScenario();
    await restore(U.admin, g, "m1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(await report(U.other, g, "m1"), { status: "hidden" });
    assert.equal(await galleryCount(g), 0);
    const reports = await reportsOf(g, "m1");
    assert.equal(reports.length, 2, "un doc per segnalazione");
    assert.equal(new Set(reports.map((item) => item.id)).size, 2);
    assert.deepEqual(reports.map((item) => item.data().status).sort(), ["open", "restored"]);
  });

  test("restore con più segnalazioni (la seconda è already_hidden): tutte le righe restano coerenti", async () => {
    const { g } = await hiddenScenario();
    await report(U.parent, g, "m1");
    await restore(U.leader, g, "m1");
    for (const item of await reportsOf(g, "m1")) assert.equal(item.data().status, "restored");
  });

  test("delete da staff: sparisce da hiddenMedia, report 'deleted', i file del media vengono tolti dallo Storage", async () => {
    const { g } = await hiddenScenario();
    const path = `${folder(g, "m1")}/optimized-1-foto.jpg`;
    const other = `${folder(g, "altro")}/optimized-1-foto.jpg`;
    await adminBucket.file(path).save(Buffer.from("x"), { contentType: "image/jpeg", metadata: { metadata: { uploadedBy: U.author.uid } } });
    await adminBucket.file(other).save(Buffer.from("x"), { contentType: "image/jpeg", metadata: { metadata: { uploadedBy: U.author.uid } } });
    assert.deepEqual(await deleteHidden(U.admin, g, "m1"), { status: "deleted" });
    assert.equal((await hiddenRef(g, "m1").get()).exists, false);
    assert.equal((await mediaRef(g, "m1").get()).exists, false);
    assert.equal(await galleryCount(g), 0, "il contatore era già sceso alla segnalazione");
    assert.equal((await reportsOf(g, "m1"))[0].data().status, "deleted");
    const [remaining] = await adminBucket.getFiles({ prefix: `${folder(g, "m1")}/` });
    assert.equal(remaining.length, 0, "file del media cancellati");
    const [others] = await adminBucket.getFiles({ prefix: `${folder(g, "altro")}/` });
    assert.equal(others.length, 1, "i file di un altro media restano");
  });

  test("delete dal dirigente di unità: ok", async () => {
    const { g } = await hiddenScenario();
    assert.deepEqual(await deleteHidden(U.leader, g, "m1"), { status: "deleted" });
  });
});

// ---------------------------------------------------------------------------
// 7b. File dei contenuti segnalati: token di download e lettura su Storage
// ---------------------------------------------------------------------------
describe("contenuti segnalati: token di download e file", () => {
  const tokenOf = (url) => new URL(url).searchParams.get("token");
  const status = async (url) => (await fetch(url)).status;
  const adminFile = (path) => adminBucket.file(path);
  const read = (actor, path) => storageOutcome(getBytes(storageRef(actor.storage, path)));
  const readUrl = (actor, path) => storageOutcome(getDownloadURL(storageRef(actor.storage, path)));
  let g;
  let paths;
  let oldUrls;
  let hidden;
  let control; // l'emulatore revoca davvero un token quando gli si cambia firebaseStorageDownloadTokens?

  before(async () => {
    // Controllo sull'emulatore: cambiare il token con setMetadata invalida il vecchio?
    const cg = await newGallery();
    const scratch = await uploadFile(U.author, cg, "ctrl");
    const oldToken = tokenOf(scratch.url);
    const newToken = `nuovo-${runId}`;
    const before200 = await status(scratch.url);
    await adminFile(scratch.path).setMetadata({ metadata: { firebaseStorageDownloadTokens: newToken } });
    const newUrl = scratch.url.replace(oldToken, newToken);
    control = {
      beforeStatus: before200,
      oldAfterStatus: await status(scratch.url),
      newAfterStatus: await status(newUrl),
      bogusStatus: await status(scratch.url.replace(oldToken, "token-inventato")),
    };

    g = await newGallery();
    const real = await realImageData(U.author, g, "t1");
    paths = real.paths;
    oldUrls = real.urls;
    await createMediaBatch(U.author, g, "t1", real.data);
    // Prima della segnalazione i link con il token funzionano.
    for (const url of oldUrls) assert.equal(await status(url), 200, "URL con token valido prima della segnalazione");
    await report(U.other, g, "t1", "inappropriate");
    hidden = (await hiddenRef(g, "t1").get()).data();
  });

  test("controllo sull'emulatore: il token di partenza funziona, uno inventato no", () => {
    assert.equal(control.beforeStatus, 200);
    assert.notEqual(control.bogusStatus, 200, "l'emulatore accetta token inventati: i test sui token non provano niente");
  });

  test("dopo la segnalazione i file hanno un token nuovo (metadata) e gli URL in hiddenMedia sono riscritti", async () => {
    for (const [index, path] of paths.entries()) {
      const [metadata] = await adminFile(path).getMetadata();
      const tokens = String(metadata.metadata?.firebaseStorageDownloadTokens ?? "").split(",").filter(Boolean);
      assert.ok(tokens.length > 0, `token presente su ${path}`);
      const field = index === 0 ? "storageUrl" : "thumbnailUrl";
      const fresh = tokenOf(hidden[field]);
      assert.notEqual(fresh, tokenOf(oldUrls[index]), "il token negli URL nascosti è cambiato rispetto a quello già distribuito");
      assert.ok(tokens.includes(fresh), `${field} nel doc nascosto usa un token del file`);
      // Su Storage vero setMetadata sostituisce la lista; l'emulatore la accoda (vedi il controllo sopra).
      if (control.oldAfterStatus !== 200) assert.deepEqual(tokens, [fresh], "il vecchio token deve essere uscito dalla lista");
      assert.equal(new URL(hidden[field]).pathname, new URL(oldUrls[index]).pathname, "stesso file");
    }
    assert.equal(tokenOf(hidden.optimizedUrl), tokenOf(hidden.storageUrl), "optimizedUrl riscritto come storageUrl");
    assert.equal(hidden.originalUrl, null);
    assert.equal(hidden.posterUrl, null);
  });

  test("l'URL nuovo (hiddenMedia) scarica il file dall'emulatore", async () => {
    assert.equal(await status(hidden.storageUrl), 200);
    assert.equal(await status(hidden.thumbnailUrl), 200);
  });

  test("l'URL vecchio (token vecchio) non scarica più il file", async (t) => {
    if (control.oldAfterStatus === 200) {
      t.skip(
        "l'emulatore Storage non revoca il vecchio token quando firebaseStorageDownloadTokens cambia " +
          "(controllo con setMetadata su un file di prova: il vecchio token risponde ancora 200): la revoca non è verificabile qui, solo in staging",
      );
      return;
    }
    for (const url of oldUrls) assert.notEqual(await status(url), 200, "il link già visto scarica ancora il contenuto nascosto");
  });

  test("file del nascosto: un ALTRO membro non lo legge (byte e getDownloadURL), lo staff e l'autore sì", async () => {
    for (const path of paths) {
      for (const key of ["other", "parent"]) {
        assert.deepEqual(await read(U[key], path), UNAUTHORIZED, `getBytes ${key}`);
        assert.deepEqual(await readUrl(U[key], path), UNAUTHORIZED, `getDownloadURL ${key}`);
      }
      for (const key of ["admin", "leader"]) {
        assert.deepEqual(await read(U[key], path), { ok: true }, `getBytes ${key}`);
        assert.deepEqual(await readUrl(U[key], path), { ok: true }, `getDownloadURL ${key}`);
      }
      assert.deepEqual(await read(U.author, path), { ok: true }, "l'autore legge ancora i propri file (resource.metadata.uploadedBy)");
      for (const key of OUTSIDERS) assert.deepEqual(await read(U[key], path), UNAUTHORIZED, `getBytes ${key}`);
    }
  });

  test("elenco della cartella: i membri vedono i nomi dei file, gli esterni no (anche per il nascosto)", async () => {
    for (const key of MEMBERS) {
      const listing = await listAll(storageRef(U[key].storage, folder(g, "t1")));
      assert.equal(listing.items.length, 2, key);
    }
    for (const key of OUTSIDERS) {
      assert.deepEqual(await storageOutcome(listAll(storageRef(U[key].storage, folder(g, "t1")))), UNAUTHORIZED, key);
    }
  });

  test("restore: il doc torna in media con gli URL nuovi e gli altri membri rileggono i file", async () => {
    await restore(U.admin, g, "t1");
    const restored = (await mediaRef(g, "t1").get()).data();
    assert.equal(restored.storageUrl, hidden.storageUrl);
    assert.equal(await status(restored.storageUrl), 200);
    for (const path of paths) assert.deepEqual(await read(U.other, path), { ok: true }, "ora il doc media esiste");
    // Gli URL vecchi, se l'emulatore revoca i token, restano revocati dopo il restore.
    if (control.oldAfterStatus !== 200) assert.notEqual(await status(oldUrls[0]), 200);
  });

  test("durante il caricamento (file presente, doc media non ancora creato) li legge solo l'autore e lo staff", async () => {
    const gg = await newGallery();
    const { paths: pending } = await realImageData(U.author, gg, "in-corso");
    assert.deepEqual(await read(U.author, pending[0]), { ok: true }, "autore");
    assert.deepEqual(await read(U.admin, pending[0]), { ok: true }, "admin");
    assert.deepEqual(await read(U.leader, pending[0]), { ok: true }, "dirigente");
    assert.deepEqual(await read(U.other, pending[0]), UNAUTHORIZED, "altro membro prima che il doc esista");
    await seedMedia(gg, "in-corso", U.author.uid);
    assert.deepEqual(await read(U.other, pending[0]), { ok: true }, "altro membro dopo la creazione del doc");
  });

  test("delete dello staff: tolti anche like e commenti sotto media/{id}, non quelli degli altri media", async () => {
    const gd = await newGallery();
    await seedMedia(gd, "d1", U.author.uid);
    await seedMedia(gd, "d2", U.author.uid);
    for (const mediaId of ["d1", "d2"]) {
      await likeMedia(U.parent, gd, mediaId);
      await setDoc(doc(collection(U.other.db, `${mediaPathOf(gd)}/${mediaId}/comments`)), { uid: U.other.uid, body: "ciao", createdAt: iso() });
    }
    await report(U.other, gd, "d1");
    const subs = async (mediaId) => ({
      likes: (await mediaRef(gd, mediaId).collection("likes").get()).size,
      comments: (await mediaRef(gd, mediaId).collection("comments").get()).size,
    });
    assert.deepEqual(await subs("d1"), { likes: 1, comments: 1 }, "dopo la segnalazione restano sotto il media");
    assert.deepEqual(await deleteHidden(U.admin, gd, "d1"), { status: "deleted" });
    assert.deepEqual(await subs("d1"), { likes: 0, comments: 0 }, "tolti con il contenuto");
    assert.deepEqual(await subs("d2"), { likes: 1, comments: 1 }, "l'altro media non è toccato");
    assert.equal((await hiddenRef(gd, "d1").get()).exists, false);
  });
});

// ---------------------------------------------------------------------------
// 8. Storage
// ---------------------------------------------------------------------------
describe("storage: rules della galleria", () => {
  let g;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const upload = (actor, path, bytes = JPEG, { contentType = "image/jpeg", uploadedBy = actor.uid, meta } = {}) =>
    storageOutcome(
      uploadBytesResumable(storageRef(actor.storage, path), bytes, {
        contentType,
        customMetadata: meta ?? { uploadedBy, stakeId: STAKE_A, galleryId: g.galleryId, mediaId: "x", kind: "optimized" },
      }),
    );
  const fileIn = (mediaId, name = `optimized-${Date.now()}-${++seq}.jpg`) => `${folder(g, mediaId)}/${name}`;
  const seedFile = async (path, uploadedBy) =>
    adminBucket.file(path).save(Buffer.from(JPEG), { contentType: "image/jpeg", metadata: { metadata: { uploadedBy } } });
  const exists = async (path) => (await adminBucket.file(path).exists())[0];

  before(async () => {
    g = await newGallery();
  });

  for (const key of ["author", "other", "parent", "leader", "admin"]) {
    test(`${key} carica un'immagine piccola con customMetadata.uploadedBy = proprio uid: ok`, async () => {
      const path = fileIn(`m-${key}`);
      assert.deepEqual(await upload(U[key], path), { ok: true });
      assert.equal(await exists(path), true);
    });
  }

  test("miniatura e ottimizzata dello stesso media (due file nella stessa cartella): ok", async () => {
    assert.deepEqual(await upload(U.author, fileIn("m-due", "optimized-1-foto.jpg")), { ok: true });
    assert.deepEqual(await upload(U.author, fileIn("m-due", "thumb-1-foto.jpg")), { ok: true });
  });

  test("un video piccolo (video/mp4) è accettato", async () => {
    assert.deepEqual(await upload(U.author, fileIn("m-video", "original-1-clip.mp4"), JPEG, { contentType: "video/mp4" }), { ok: true });
  });

  test("uploadedBy di un altro utente: negato", async () => {
    const path = fileIn("m-falso");
    assert.deepEqual(await upload(U.author, path, JPEG, { uploadedBy: U.other.uid }), UNAUTHORIZED);
    assert.equal(await exists(path), false);
  });

  test("uploadedBy dell'admin che ha creato la galleria: negato", async () => {
    assert.deepEqual(await upload(U.author, fileIn("m-falso-admin"), JPEG, { uploadedBy: U.admin.uid }), UNAUTHORIZED);
  });

  test("senza customMetadata o senza uploadedBy: negato", async () => {
    assert.deepEqual(
      await storageOutcome(uploadBytesResumable(storageRef(U.author.storage, fileIn("m-senza")), JPEG, { contentType: "image/jpeg" })),
      UNAUTHORIZED,
    );
    assert.deepEqual(await upload(U.author, fileIn("m-senza2"), JPEG, { meta: { stakeId: STAKE_A } }), UNAUTHORIZED);
  });

  test("tipo di file non immagine/video (text/html, application/pdf): negato", async () => {
    assert.deepEqual(await upload(U.author, fileIn("m-html", "pagina.html"), JPEG, { contentType: "text/html" }), UNAUTHORIZED);
    assert.deepEqual(await upload(U.author, fileIn("m-pdf", "doc.pdf"), JPEG, { contentType: "application/pdf" }), UNAUTHORIZED);
  });

  // Nota: l'emulatore Storage valuta ogni upload come `create` (con `resource` valorizzato se il
  // file esiste già) e non distingue `update`. Per questo la protezione dalle sovrascritture deve
  // stare dentro `allow create` come `resource == null`: solo così è verificabile qui, e coincide
  // con la spec ("solo file nuovi (`resource == null`)").
  test("sovrascrittura dello stesso path da un altro partecipante: negata, il contenuto resta quello dell'autore", async () => {
    const path = fileIn("m-over", "optimized-fisso.jpg");
    assert.deepEqual(await upload(U.author, path, new Uint8Array([1, 1, 1, 1])), { ok: true });
    const attempt = await upload(U.other, path, new Uint8Array([9, 9, 9, 9]));
    const [bytes] = await adminBucket.file(path).download();
    assert.deepEqual([...bytes], [1, 1, 1, 1], "il file dell'autore è stato sostituito da un altro partecipante");
    assert.deepEqual(attempt, UNAUTHORIZED);
  });

  test("sovrascrittura dello stesso path dall'autore stesso e dal dirigente: negata (solo file nuovi)", async () => {
    const path = fileIn("m-over2", "optimized-fisso.jpg");
    assert.deepEqual(await upload(U.author, path, new Uint8Array([1, 1, 1, 1])), { ok: true });
    assert.deepEqual(await upload(U.author, path, new Uint8Array([2, 2, 2, 2])), UNAUTHORIZED, "autore");
    assert.deepEqual(await upload(U.leader, path, new Uint8Array([3, 3, 3, 3])), UNAUTHORIZED, "dirigente");
  });

  test("sovrascrittura dello stesso path dall'admin: ok", async () => {
    const path = fileIn("m-over3", "optimized-fisso.jpg");
    assert.deepEqual(await upload(U.author, path, new Uint8Array([1, 1, 1, 1])), { ok: true });
    assert.deepEqual(await upload(U.admin, path, new Uint8Array([4, 4, 4, 4])), { ok: true });
  });

  for (const key of OUTSIDERS) {
    test(`${key}: non carica né legge né elenca né cancella`, async () => {
      const seeded = fileIn("m-fuori");
      await seedFile(seeded, U.author.uid);
      const actor = U[key];
      assert.deepEqual(await upload(actor, fileIn("m-fuori2"), JPEG, { uploadedBy: actor.uid ?? "uid-finto" }), UNAUTHORIZED, "upload");
      assert.deepEqual(await storageOutcome(getBytes(storageRef(actor.storage, seeded))), UNAUTHORIZED, "lettura");
      assert.deepEqual(await storageOutcome(listAll(storageRef(actor.storage, folder(g, "m-fuori")))), UNAUTHORIZED, "elenco");
      assert.deepEqual(await storageOutcome(deleteObject(storageRef(actor.storage, seeded))), UNAUTHORIZED, "cancellazione");
      assert.equal(await exists(seeded), true);
    });
  }

  test("i membri leggono i file di un media esistente ed elencano la cartella (deleteMediaFolder usa listAll)", async () => {
    const seeded = fileIn("m-lettura");
    await seedFile(seeded, U.author.uid);
    await seedMedia(g, "m-lettura", U.author.uid); // senza il doc media leggono solo autore e staff
    for (const key of MEMBERS) {
      assert.deepEqual(await storageOutcome(getBytes(storageRef(U[key].storage, seeded))), { ok: true }, `lettura ${key}`);
      const listing = await listAll(storageRef(U[key].storage, folder(g, "m-lettura")));
      assert.equal(listing.items.length, 1, `elenco ${key}`);
    }
  });

  test("delete: l'autore toglie il proprio file, un altro partecipante e il genitore no, dirigente e admin sì", async () => {
    const mine = fileIn("m-del", "a.jpg");
    await seedFile(mine, U.author.uid);
    assert.deepEqual(await storageOutcome(deleteObject(storageRef(U.other.storage, mine))), UNAUTHORIZED, "altro partecipante");
    assert.deepEqual(await storageOutcome(deleteObject(storageRef(U.parent.storage, mine))), UNAUTHORIZED, "genitore");
    assert.equal(await exists(mine), true);
    assert.deepEqual(await storageOutcome(deleteObject(storageRef(U.author.storage, mine))), { ok: true }, "autore");
    assert.equal(await exists(mine), false);

    const forLeader = fileIn("m-del", "b.jpg");
    await seedFile(forLeader, U.author.uid);
    assert.deepEqual(await storageOutcome(deleteObject(storageRef(U.leader.storage, forLeader))), { ok: true }, "dirigente");
    const forAdmin = fileIn("m-del", "c.jpg");
    await seedFile(forAdmin, U.author.uid);
    assert.deepEqual(await storageOutcome(deleteObject(storageRef(U.admin.storage, forAdmin))), { ok: true }, "admin");
  });

  test("delete: un file senza uploadedBy nei metadata non è cancellabile da un partecipante", async () => {
    const path = fileIn("m-del2", "orfano.jpg");
    await adminBucket.file(path).save(Buffer.from(JPEG), { contentType: "image/jpeg" });
    assert.deepEqual(await storageOutcome(deleteObject(storageRef(U.author.storage, path))), UNAUTHORIZED);
    assert.deepEqual(await storageOutcome(deleteObject(storageRef(U.admin.storage, path))), { ok: true });
  });

  test("deleteMediaFolder del client: l'autore toglie tutti i suoi file, un altro partecipante nessuno", async () => {
    const paths = [fileIn("m-folder", "optimized-1.jpg"), fileIn("m-folder", "thumb-1.jpg")];
    for (const path of paths) await seedFile(path, U.author.uid);
    const run = async (actor) => {
      const listing = await listAll(storageRef(actor.storage, folder(g, "m-folder")));
      await Promise.all(listing.items.map((item) => deleteObject(item).catch(() => undefined)));
    };
    await run(U.other);
    for (const path of paths) assert.equal(await exists(path), true, "i file dell'altro restano");
    await run(U.author);
    for (const path of paths) assert.equal(await exists(path), false, "i file propri spariscono");
  });

  test("un utente del palo B non scrive nella cartella del palo A nemmeno col proprio uid", async () => {
    assert.deepEqual(await upload(U.memberB, fileIn("m-b"), JPEG, { uploadedBy: U.memberB.uid }), UNAUTHORIZED);
    assert.deepEqual(await upload(U.adminB, fileIn("m-b2"), JPEG, { uploadedBy: U.adminB.uid }), UNAUTHORIZED);
  });

  test("foto di 30 MB esatti (limite escluso): negata; 30 MB - 1 byte: ok", { timeout: 120_000 }, async () => {
    const limit = 30 * 1024 * 1024;
    assert.deepEqual(await upload(U.author, fileIn("m-big", "big-30.jpg"), new Uint8Array(limit)), UNAUTHORIZED);
    assert.deepEqual(await upload(U.author, fileIn("m-big", "big-29.jpg"), new Uint8Array(limit - 1)), { ok: true });
  });

  test(
    "video da 300 MB esatti (limite escluso): negato",
    {
      timeout: 600_000,
      skip:
        process.env.GALLERY_BIG_UPLOAD === "1"
          ? false
          : "salta: serve caricare 300 MB veri (l'emulatore valuta la dimensione solo a upload finito); rilancia con GALLERY_BIG_UPLOAD=1",
    },
    async () => {
      const chunk = new Uint8Array(1024 * 1024);
      const blob = new Blob(Array.from({ length: 300 }, () => chunk), { type: "video/mp4" });
      assert.equal(blob.size, 300 * 1024 * 1024);
      assert.deepEqual(await upload(U.author, fileIn("m-video-big", "original-big.mp4"), blob, { contentType: "video/mp4" }), UNAUTHORIZED);
    },
  );
});

// ---------------------------------------------------------------------------
// 9. Trigger sendAdminPushForGalleryReport (richiamato in-process con webpush simulato)
// ---------------------------------------------------------------------------
describe("trigger sendAdminPushForGalleryReport", () => {
  const webpush = require("web-push");
  let index;
  let original;
  const sent = [];

  before(() => {
    const keys = webpush.generateVAPIDKeys();
    process.env.WEB_PUSH_PUBLIC_KEY = keys.publicKey;
    process.env.WEB_PUSH_PRIVATE_KEY = keys.privateKey;
    index = require("../index.js");
    original = webpush.sendNotification;
    webpush.sendNotification = async (subscription, payload) => {
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    };
  });
  after(() => {
    if (original) webpush.sendNotification = original;
  });

  const device = (stakeId, id, subscription) => adminDb.doc(`stakes/${stakeId}/adminPushDevices/${id}`).set({ subscription });
  const valid = (name) => ({ endpoint: `https://push.example.invalid/${name}`, keys: { auth: "a", p256dh: "b" } });

  test("avvisa gli admin del palo con titolo, link ai nascosti dell'attività e tag per galleria; ripulisce le iscrizioni rotte", async () => {
    sent.length = 0;
    const activity = await seedActivity("running");
    const g = await newGallery({ activityId: activity.id });
    await galleryRef(g).update({ title: "Viaggio al tempio" });
    await device(STAKE_A, `ok-${runId}`, valid(`a-${runId}`));
    await device(STAKE_A, `rotta-${runId}`, { endpoint: "https://push.example.invalid/senza-chiavi" });
    await device(STAKE_B, `altro-palo-${runId}`, valid(`b-${runId}`));
    await index.sendAdminPushForGalleryReport.run({ params: { stakeId: STAKE_A, galleryId: g.galleryId, reportId: "r1" } });
    assert.equal(sent.length, 1, "una sola notifica: solo il dispositivo valido del palo A");
    assert.equal(sent[0].endpoint, `https://push.example.invalid/a-${runId}`);
    assert.equal(sent[0].payload.title, "Contenuto segnalato");
    assert.match(sent[0].payload.body, /Viaggio al tempio/u);
    assert.equal(sent[0].payload.tag, `gallery-report-${g.galleryId}`);
    assert.equal(sent[0].payload.url, `/activities/${activity.id}/foto?vista=nascosti`);
    assert.equal(sent[0].payload.eventId, activity.id);
    assert.equal((await adminDb.doc(`stakes/${STAKE_A}/adminPushDevices/rotta-${runId}`).get()).exists, false, "iscrizione senza chiavi rimossa");
    assert.equal((await adminDb.doc(`stakes/${STAKE_B}/adminPushDevices/altro-palo-${runId}`).get()).exists, true, "il palo B non è toccato");
  });

  test("galleria senza activityId: il link porta a /admin, senza eventId", async () => {
    sent.length = 0;
    const g = await newGallery();
    await galleryRef(g).update({ activityId: FieldValue.delete() });
    await index.sendAdminPushForGalleryReport.run({ params: { stakeId: STAKE_A, galleryId: g.galleryId, reportId: "r2" } });
    assert.ok(sent.length >= 1);
    assert.equal(sent[0].payload.url, "/admin");
    assert.equal(sent[0].payload.eventId, null);
  });

  test("galleria inesistente: usa il titolo di ripiego e non va in errore", async () => {
    sent.length = 0;
    await index.sendAdminPushForGalleryReport.run({ params: { stakeId: STAKE_A, galleryId: `sparita-${runId}`, reportId: "r3" } });
    assert.ok(sent.length >= 1);
    assert.match(sent[0].payload.body, /^Galleria:/u);
  });

  test("una segnalazione vera (callable) fa partire il trigger nell'emulatore: il doc report esiste", async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", U.author.uid);
    await report(U.other, g, "m1");
    assert.equal((await reportsOf(g, "m1")).length, 1);
  });
});
