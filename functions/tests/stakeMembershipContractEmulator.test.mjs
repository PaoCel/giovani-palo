// Appartenenza al palo (S2): il "Contratto di autorizzazione" di
// docs/APPARTENENZA_AL_PALO.md provato cella per cella negli emulatori, con
// utenti VERI dell'Auth emulator, l'SDK client e le query ESATTE dell'app di
// oggi (la "PWA vecchia" del contratto). L'Admin SDK serve solo per seminare e
// per ispezionare lo stato, perché ignora le rules.
//
// Questo file asserisce il CONTRATTO, non il codice delle rules: se una cella
// diventa rossa, la rule e il contratto non dicono la stessa cosa e uno dei due
// è un bug (così lo dice anche la spec).
//
// Rilancio (solo emulatori Auth 9419, Firestore 8419, Storage 9519, progetto
// demo-*; senza Functions emulator di proposito: un trigger su `users` che
// scrivesse `members` falserebbe il seed):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --config firebase.membership-test.json --project demo-s2-contract \
//     'node --test --test-concurrency=1 functions/tests/stakeMembershipContractEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse in un file temporaneo (gli host si leggono dalle variabili che
// imposta emulators:exec) e rimuovila a fine prova.
//
// Celle Storage: valgono dopo la fase B di `gugd-storage-eu` (rules Storage che
// leggono `members/{uid}`). Per ora sono scritte e saltate; per provarle contro
// le rules Storage nuove:
//   S2_STORAGE_CONTRACT=1 firebase emulators:exec ... 'node --test ... <questo file>'
// (con S2_STORAGE_CONTRACT=1 anche i caricamenti da 300 MB solo con
// GALLERY_BIG_UPLOAD=1, come negli altri test della galleria).
//
// Persone (sigle del contratto):
//   V visitatore, O sessione anonima, N account del palo senza members,
//   P in attesa, M membro attivo, F fuori (declined/withdrawn/removed/blocked),
//   X membro attivo di un altro palo, D dirigente di unità, A admin / super admin.
// Ogni persona è un'app client a sé con il proprio uid; ogni riga della matrice
// ha la sua operazione (client SDK, stessa forma di src/services/firestore/*)
// e l'elenco delle sigle a cui è permessa. Permesso = la promessa si risolve,
// negato = si rifiuta con `permission-denied`.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
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
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  deleteObject,
  getBytes,
  getStorage,
  listAll,
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";

import { buildUserDocument } from "../../tools/lib/stakes.mjs";

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
const STORAGE = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ? hostOf(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "Storage")
  : null;
const STORAGE_ENABLED = process.env.S2_STORAGE_CONTRACT === "1";
if (STORAGE_ENABLED) assert.ok(STORAGE, "S2_STORAGE_CONTRACT=1 richiede lo Storage emulator");
const STORAGE_SKIP = STORAGE_ENABLED ? false : "rules Storage dopo la fase B di gugd-storage-eu";

const BUCKET = `${PROJECT}.appspot.com`;
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// App Admin con nome: l'app di default resta libera per altri moduli.
const adminApp = initializeAdminApp({ projectId: PROJECT, storageBucket: BUCKET }, `s2-contract-admin-${runId}`);
const adminDb = getAdminFirestore(adminApp);
const adminBucket = STORAGE ? getAdminStorage(adminApp).bucket(BUCKET) : null;

const STAKE_A = `s2a-${runId}`;
const STAKE_B = `s2b-${runId}`;
const STAKES = {
  [STAKE_A]: { id: STAKE_A, slug: STAKE_A, name: "Palo A" },
  [STAKE_B]: { id: STAKE_B, slug: STAKE_B, name: "Palo B" },
};
const UNIT1 = { id: "unit-1", name: "Rione Uno" };
const UNIT2 = { id: "unit-2", name: "Rione Due" };
const PASSWORD = `Pw-${runId}-s2!`; // credenziale di test, vale solo nell'emulatore
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const ACT = "notte-1";
const SEED_UID = "seed-uploader"; // autore dei contenuti seminati: non è nessuna delle persone
const ALL = "VONPMFXDA";

// ---------------------------------------------------------------------------
// Persone
// ---------------------------------------------------------------------------
// def: key (nome nei test), cls (sigla del contratto che decide l'esito atteso),
// mode (password | anonymous | none), role + profileStake (+ unit) = profilo
// users/{uid} (assente senza role), member = documento members da seminare.
const memberOf = (status, extra = {}, stake = STAKE_A) => ({ stake, status, ...extra });
const MATRIX_PERSONS = [
  { key: "V", cls: "V", mode: "none" },
  // Anonima con profilo che punta al palo A E con un members attivo scritto per errore.
  { key: "O", cls: "O", mode: "anonymous", role: "participant", profileStake: STAKE_A, member: memberOf("active") },
  { key: "N", cls: "N", role: "participant", profileStake: STAKE_A },
  { key: "P", cls: "P", role: "participant", profileStake: STAKE_A, member: memberOf("pending", { claimedUnitId: UNIT1.id }) },
  { key: "M", cls: "M", role: "participant", profileStake: STAKE_A, member: memberOf("active") },
  {
    key: "M (reviewNeeded)",
    cls: "M",
    role: "participant",
    profileStake: STAKE_A,
    member: memberOf("active", { reviewNeeded: true }),
  },
  ...["declined", "withdrawn", "removed", "blocked"].map((status) => ({
    key: `F (${status})`,
    cls: "F",
    role: "participant",
    profileStake: STAKE_A,
    member: memberOf(status),
  })),
  // Membro attivo del palo B con profilo sul palo B: chiede sul palo A.
  { key: "X", cls: "X", role: "participant", profileStake: STAKE_B, member: memberOf("active", {}, STAKE_B) },
  {
    key: "D",
    cls: "D",
    role: "unit_leader",
    profileStake: STAKE_A,
    unit: UNIT1,
    member: memberOf("active", { staffRole: "unit_leader", claimedUnitId: UNIT1.id }),
  },
  { key: "A", cls: "A", role: "admin", profileStake: STAKE_A, member: memberOf("active", { staffRole: "admin" }) },
  // Super admin: nessun members, decide il ruolo (profilo su un altro palo).
  { key: "A (super_admin)", cls: "A", role: "super_admin", profileStake: STAKE_B },
];
const INCOHERENT_PERSONS = [
  // Codici galleria vecchi: galleries/{g}/members/{uid} e unlockedGalleries, nessun members.
  { key: "N con codici galleria vecchi", cls: "N", role: "participant", profileStake: STAKE_A, legacy: true },
  { key: "D senza members", cls: "D", role: "unit_leader", profileStake: STAKE_A, unit: UNIT1 },
  {
    key: "D con members removed",
    cls: "D",
    role: "unit_leader",
    profileStake: STAKE_A,
    unit: UNIT1,
    member: memberOf("removed", { staffRole: "unit_leader", claimedUnitId: UNIT1.id }),
  },
  { key: "A senza members", cls: "A", role: "admin", profileStake: STAKE_A },
  {
    key: "A con members removed",
    cls: "A",
    role: "admin",
    profileStake: STAKE_A,
    member: memberOf("removed", { staffRole: "admin" }),
  },
  // Attivo in A, ma il profilo ha già cambiato palo verso B.
  { key: "M con profilo su B", cls: "M", role: "participant", profileStake: STAKE_B, member: memberOf("active") },
];
// Aggiunte dopo la review del 2026-10-20: sessione anonima con un profilo da
// staff del palo A scritto via Admin SDK. Resta "O": nessun permesso da membro.
const ANON_STAFF_PERSONS = [
  { key: "O con profilo unit_leader", cls: "O", mode: "anonymous", role: "unit_leader", profileStake: STAKE_A, unit: UNIT1, anonStaff: true },
  { key: "O con profilo admin", cls: "O", mode: "anonymous", role: "admin", profileStake: STAKE_A, anonStaff: true },
];
const ALL_DEFS = [...MATRIX_PERSONS, ...INCOHERENT_PERSONS, ...ANON_STAFF_PERSONS];
for (const def of ALL_DEFS) {
  def.mode ??= "password";
  def.ownMemberInA = Boolean(def.member) && def.member.stake === STAKE_A;
}

const apps = [];
const P = {}; // persone a runtime, per chiave

async function makeActor(def, index) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT, storageBucket: BUCKET }, `p${index}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.raw}`, { disableWarnings: true });
  if (def.mode === "anonymous") await signInAnonymously(auth);
  else if (def.mode === "password") await createUserWithEmailAndPassword(auth, `p${index}-${runId}@example.invalid`, PASSWORD);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE.host, FIRESTORE.port);
  let storage = null;
  if (STORAGE) {
    storage = getStorage(app);
    connectStorageEmulator(storage, STORAGE.host, STORAGE.port);
  }
  const uid = auth.currentUser?.uid ?? null;
  return { ...def, index, db, storage, uid, who: uid ?? "visitatore-senza-uid" };
}

// ---------------------------------------------------------------------------
// Documenti seminati (Admin SDK)
// ---------------------------------------------------------------------------
let seq = 0;
const nextId = (prefix) => `${prefix}${++seq}-${runId}`;
const MEMBERS = `stakes/${STAKE_A}/members`;
const memberData = (extra = {}) => ({
  status: "active",
  sources: [{ kind: "migration", ref: "a3-2026-10", at: Timestamp.now() }],
  previous: null,
  staffRole: null,
  claimedUnitId: "",
  claimedUnitName: "",
  displayName: "Persona Prova",
  birthYear: 2009,
  registrationHints: [],
  reviewNeeded: false,
  requestedAt: Timestamp.now(),
  decidedAt: Timestamp.now(),
  decidedBy: "system",
  declineCount: 0,
  version: 1,
  ...extra,
});
const profileData = (role, stakeId, unit, label) =>
  buildUserDocument({
    firstName: "Prova",
    lastName: label,
    email: `${label.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}@example.invalid`,
    role,
    stake: STAKES[stakeId],
    unit: unit ?? null,
    now: iso(),
  });

const adminData = async (path) => {
  const snap = await adminDb.doc(path).get();
  return snap.exists ? snap.data() : null;
};

// Percorsi
const galleryPath = (g) => `stakes/${g.stakeId}/galleries/${g.galleryId}`;
const mediaPathOf = (g) => `${galleryPath(g)}/media`;
const mediaDocPath = (g, mediaId) => `${mediaPathOf(g)}/${mediaId}`;
const likeDocPath = (g, mediaId, uid) => `${mediaDocPath(g, mediaId)}/likes/${uid}`;
const commentsPathOf = (g, mediaId) => `${mediaDocPath(g, mediaId)}/comments`;
const hiddenPathOf = (g) => `${galleryPath(g)}/hiddenMedia`;
const reportsPathOf = (g) => `${galleryPath(g)}/reports`;
const activityPath = `stakes/${STAKE_A}/activities/${ACT}`;
const recordsPath = `${activityPath}/records`;
const entriesPath = `${activityPath}/recordEntries`;
const questionsPath = `${activityPath}/surveyQuestions`;
const responsesPath = `${activityPath}/surveyResponses`;
const feedPath = `stakes/${STAKE_A}/feedPosts`;

/** Galleria con la forma che scrive la callable. `window`: open | expired | future | none. */
async function newGallery({ stake = STAKE_A, window = "open", mediaCount = 0, activityId } = {}) {
  const n = ++seq;
  const g = { stakeId: stake, galleryId: `g${n}-${runId}`, activityId: activityId ?? `act-g${n}-${runId}` };
  const now = Date.now();
  const data = {
    title: "Galleria di prova",
    description: "",
    activityId: g.activityId,
    createdBy: SEED_UID,
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
    uploadsClosed: false,
    uploadsWindowSource: "activity",
  };
  const windows = { open: [now - 3 * HOUR, now + 7 * DAY], expired: [now - 10 * DAY, now - HOUR] };
  if (windows[window]) {
    data.uploadsOpenFrom = Timestamp.fromMillis(windows[window][0]);
    data.uploadsOpenUntil = Timestamp.fromMillis(windows[window][1]);
  }
  await adminDb.doc(galleryPath(g)).set(data);
  return g;
}

const folderOf = (g, mediaId) => `protected/stakes/${g.stakeId}/galleries/${g.galleryId}/media/${mediaId}`;
const filePathOf = (g, mediaId, kind = "optimized", name = "foto.jpg") =>
  `${folderOf(g, mediaId)}/${kind}-${Date.now()}-${++seq}-${name}`;
// Formato degli URL di download accettato da isOwnMediaUrl (emulatore).
const URL_HOST = STORAGE ? STORAGE.raw : "127.0.0.1:9519";
const emulatorUrl = (path) => `http://${URL_HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=tok-${runId}`;

/** Payload di UploadManagerProvider (immagine) + createdAt/updatedAt/likeCount di createMediaDoc: 25 campi. */
function imageData(g, mediaId, uid) {
  const optimized = filePathOf(g, mediaId, "optimized");
  const thumb = filePathOf(g, mediaId, "thumb");
  const ts = iso();
  return {
    activityId: g.activityId,
    type: "image",
    storagePath: optimized,
    storageUrl: emulatorUrl(optimized),
    originalPath: null,
    originalUrl: null,
    optimizedPath: optimized,
    optimizedUrl: emulatorUrl(optimized),
    thumbnailPath: thumb,
    thumbnailUrl: emulatorUrl(thumb),
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
}

/** Semina un media (Admin SDK) tenendo coerente il contatore della galleria. */
async function seedMedia(g, mediaId, uploadedBy) {
  const data = imageData(g, mediaId, uploadedBy);
  await adminDb.doc(mediaDocPath(g, mediaId)).set(data);
  await adminDb.doc(galleryPath(g)).update({ mediaCount: FieldValue.increment(1) });
  return data;
}

// Operazioni esatte del client ------------------------------------------------
/** galleriesService.createMediaDoc: writeBatch con set del media e update del contatore. */
function createMediaBatch(p, g, mediaId, data, delta = 1) {
  const batch = writeBatch(p.db);
  batch.set(doc(p.db, mediaDocPath(g, mediaId)), data);
  batch.update(doc(p.db, galleryPath(g)), { mediaCount: increment(delta), updatedAt: data.updatedAt });
  return batch.commit();
}

/** galleriesService.deleteMedia. */
function deleteMediaBatch(p, g, mediaId, delta = -1) {
  const batch = writeBatch(p.db);
  batch.delete(doc(p.db, mediaDocPath(g, mediaId)));
  batch.update(doc(p.db, galleryPath(g)), { mediaCount: increment(delta), updatedAt: iso() });
  return batch.commit();
}

/** feedService.likeMedia: lettura del like, poi batch like + likeCount (senza updatedAt). */
async function likeMedia(p, g, mediaId) {
  const likeRef = doc(p.db, likeDocPath(g, mediaId, p.who));
  const existing = await getDocFromServer(likeRef);
  if (existing.exists()) return;
  const batch = writeBatch(p.db);
  batch.set(likeRef, { uid: p.who, createdAt: iso() });
  batch.update(doc(p.db, mediaDocPath(g, mediaId)), { likeCount: increment(1) });
  await batch.commit();
}

/** feedService.unlikeMedia. */
async function unlikeMedia(p, g, mediaId) {
  const likeRef = doc(p.db, likeDocPath(g, mediaId, p.who));
  const existing = await getDocFromServer(likeRef);
  if (!existing.exists()) return;
  const batch = writeBatch(p.db);
  batch.delete(likeRef);
  batch.update(doc(p.db, mediaDocPath(g, mediaId)), { likeCount: increment(-1) });
  await batch.commit();
}

/** feedService.likePost / unlikePost. */
async function likePost(p, postId) {
  const likeRef = doc(p.db, `${feedPath}/${postId}/likes/${p.who}`);
  const existing = await getDocFromServer(likeRef);
  if (existing.exists()) return;
  const batch = writeBatch(p.db);
  batch.set(likeRef, { uid: p.who, createdAt: iso() });
  batch.update(doc(p.db, `${feedPath}/${postId}`), { likeCount: increment(1) });
  await batch.commit();
}
async function unlikePost(p, postId) {
  const likeRef = doc(p.db, `${feedPath}/${postId}/likes/${p.who}`);
  const existing = await getDocFromServer(likeRef);
  if (!existing.exists()) return;
  const batch = writeBatch(p.db);
  batch.delete(likeRef);
  batch.update(doc(p.db, `${feedPath}/${postId}`), { likeCount: increment(-1) });
  await batch.commit();
}

const readDocs = (p, path, ...constraints) => getDocsFromServer(query(collection(p.db, path), ...constraints));
/** Primo snapshot di un listener (galleriesService.subscribeMedia): rifiuta con l'errore del listener. */
function firstSnapshot(p, path) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onSnapshot(
      collection(p.db, path),
      (snapshot) => {
        unsubscribe();
        resolve(snapshot);
      },
      (error) => reject(error),
    );
  });
}

// Fixture condivise ------------------------------------------------------------
let MAIN; // galleria aperta usata dalle righe di sola lettura
let PUBLISHED; // galleria con published true (galleriesService.listPublishedGalleries)
const MAIN_MEDIA = "m-main";
const MAIN_COMMENT = "c-main";
const FEED_MAIN = "post-main";
const SURVEY_SEED = "resp-seed";
const SHARED_STORAGE = {}; // galleria per le righe Storage
const SHARED_B = {}; // galleria del palo B, per le righe di isolamento

before(async () => {
  const made = await Promise.all(ALL_DEFS.map((def, index) => makeActor(def, index)));
  for (const actor of made) P[actor.key] = actor;

  await Promise.all(Object.values(STAKES).map((stake) =>
    adminDb.doc(`stakes/${stake.id}`).set({ name: stake.name, slug: stake.slug, isActive: true }),
  ));

  // Profili, members, note dello staff, codici galleria vecchi.
  MAIN = await newGallery();
  PUBLISHED = await newGallery();
  await adminDb.doc(galleryPath(PUBLISHED)).update({ published: true, publishedAt: iso() });
  await Promise.all(made.filter((p) => p.uid).map(async (p) => {
    if (p.role) {
      await adminDb.doc(`users/${p.uid}`).set(profileData(p.role, p.profileStake, p.unit, p.key));
    }
    if (p.member) {
      const { stake, ...fields } = p.member;
      await adminDb.doc(`stakes/${stake}/members/${p.uid}`).set(memberData(fields));
      await adminDb.doc(`stakes/${stake}/members/${p.uid}/staff/note`).set({ note: "nota dello staff", at: Timestamp.now() });
    }
    if (p.legacy) {
      await adminDb.doc(`${galleryPath(MAIN)}/members/${p.uid}`).set({ unlockedAt: iso() });
      await adminDb.doc(`users/${p.uid}/unlockedGalleries/${MAIN.galleryId}`).set({ galleryId: MAIN.galleryId, unlockedAt: iso() });
    }
  }));
  await adminDb.doc(`stakes/${STAKE_A}/gallerySecrets/${MAIN.galleryId}`).set({ code: "SEGRETO", createdAt: iso() });

  // Bersagli per le righe su members: due richieste in attesa su due unità diverse.
  for (const [id, unit] of [["target-u1", UNIT1], ["target-u2", UNIT2]]) {
    await adminDb.doc(`${MEMBERS}/${id}`).set(memberData({ status: "pending", claimedUnitId: unit.id, claimedUnitName: unit.name }));
    await adminDb.doc(`${MEMBERS}/${id}/staff/note`).set({ note: "stesso nome e data di un membro attivo", at: Timestamp.now() });
  }

  // Galleria: un media altrui, un commento, un contenuto nascosto per persona, una segnalazione.
  await seedMedia(MAIN, MAIN_MEDIA, SEED_UID);
  await adminDb.doc(`${commentsPathOf(MAIN, MAIN_MEDIA)}/${MAIN_COMMENT}`).set({ uid: SEED_UID, displayName: "Seed", body: "Bella!", createdAt: iso() });
  await adminDb.doc(`${hiddenPathOf(MAIN)}/h-seed`).set({ uploadedBy: SEED_UID, type: "image", hiddenAt: iso() });
  await adminDb.doc(`${reportsPathOf(MAIN)}/r1`).set({ mediaId: MAIN_MEDIA, reportedBy: SEED_UID, createdAt: iso() });
  await Promise.all(made.filter((p) => p.uid).map((p) =>
    adminDb.doc(`${hiddenPathOf(MAIN)}/h-${p.index}`).set({ uploadedBy: p.uid, type: "image", hiddenAt: iso() }),
  ));

  // Notte dei Record: un record aperto, uno nascosto, un tentativo per persona.
  await adminDb.doc(activityPath).set({ title: "Notte dei Record", activityType: "trip", isPublic: true, startDate: iso(), endDate: iso(Date.now() + DAY) });
  const recordBase = { title: "Salti a piedi uniti in 60 secondi", category: "resistenza", measure: "count_in_time", durationSeconds: 60, notes: "", challengerCount: 2, createdFromEntryId: null, createdAt: iso(), updatedAt: iso(), createdBy: SEED_UID };
  await adminDb.doc(`${recordsPath}/r-open`).set({ ...recordBase, status: "open" });
  await adminDb.doc(`${recordsPath}/r-hidden`).set({ ...recordBase, status: "hidden" });
  await Promise.all(made.filter((p) => p.uid).map((p) =>
    adminDb.doc(`${entriesPath}/e-${p.index}`).set({
      registrationId: `user_${p.uid}`, ownerUid: p.uid, participantName: "Nome Cognome", kind: "challenge", recordId: "r-open",
      status: "approved", createdAt: iso(), updatedAt: iso(),
    }),
  ));

  // Sondaggio: una domanda, una bozza da riprendere.
  await adminDb.doc(`${questionsPath}/q1`).set({ eventId: ACT, stakeId: STAKE_A, text: "Com'è andata?", type: "open", fieldCount: 0, order: 1, status: "active", createdAt: iso(), updatedAt: iso() });
  await adminDb.doc(`${responsesPath}/${SURVEY_SEED}`).set(surveyPayload(true));

  // Feed: un post pubblicato, un suo commento.
  await seedPost(FEED_MAIN, 0);
  await adminDb.doc(`${feedPath}/${FEED_MAIN}/comments/fc-seed`).set({ uid: SEED_UID, body: "Che bello", createdAt: iso() });

  // Palo B: una galleria, per le righe di isolamento fra pali.
  SHARED_B.gallery = await newGallery({ stake: STAKE_B });
  await seedMedia(SHARED_B.gallery, "m-b", SEED_UID);

  if (STORAGE) SHARED_STORAGE.gallery = await newGallery();
});

after(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE_A}`));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE_B}`));
  await Promise.all(Object.values(P).filter((p) => p.uid && p.role).map((p) => adminDb.recursiveDelete(adminDb.doc(`users/${p.uid}`))));
  if (adminBucket) {
    await adminBucket.deleteFiles({ prefix: `protected/stakes/${STAKE_A}/`, force: true }).catch(() => {});
    await adminBucket.deleteFiles({ prefix: `protected/stakes/${STAKE_B}/`, force: true }).catch(() => {});
  }
  await adminDb.terminate();
});

function surveyPayload(isDraft, extra = {}) {
  const ts = iso();
  return {
    eventId: ACT,
    stakeId: STAKE_A,
    isDraft,
    category: "giovane_uomo",
    answers: { q1: { type: "open", value: "Tutto bene" } },
    submittedAt: isDraft ? null : ts,
    createdAt: ts,
    updatedAt: ts,
    ...extra,
  };
}

async function seedPost(postId, likeCount) {
  await adminDb.doc(`${feedPath}/${postId}`).set({
    title: "Avviso", body: "Testo dell'avviso", type: "announcement", published: true, pinned: false,
    publishedAt: iso(), createdAt: iso(), updatedAt: iso(), likeCount, visibility: "all_authenticated",
  });
}

// ---------------------------------------------------------------------------
// Esito: permesso = si risolve, negato = permission-denied
// ---------------------------------------------------------------------------
async function expectDenied(attempt, label = "") {
  await assert.rejects(attempt, (error) => {
    assert.equal(error?.code, "permission-denied", `${label} atteso permission-denied, ricevuto ${error?.code}: ${error?.message}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Righe della matrice Firestore
// ---------------------------------------------------------------------------
// name, allow = sigle permesse, classes = sigle a cui si applica (default tutte),
// applies(def) = filtro per persona, setup(p) -> ctx, run(p, ctx) -> promessa,
// check(p, ctx, risultato) dopo un esito permesso, untouched(p, ctx) dopo un
// esito negato (lo stato non deve essere cambiato).
const ROWS = [];
const row = (definition) => ROWS.push(definition);

const memberPayload = (extra = {}) => ({
  status: "active", sources: [], previous: null, staffRole: null, claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name,
  displayName: "Persona Prova", birthYear: null, registrationHints: [], reviewNeeded: false,
  requestedAt: iso(), decidedAt: iso(), decidedBy: "system", declineCount: 0, version: 1, ...extra,
});

// --- members -----------------------------------------------------------------
row({
  name: "members/{sé} get, anche se non esiste",
  allow: "ONPMFXDA",
  run: (p) => getDocFromServer(doc(p.db, `${MEMBERS}/${p.who}`)),
  check: (p, _ctx, snap) => assert.equal(snap.exists(), p.ownMemberInA, "il documento esiste solo per chi ce l'ha nel palo A"),
});
row({
  name: "members/{altro} get (richiesta della sua unità)",
  allow: "DA",
  run: (p) => getDocFromServer(doc(p.db, `${MEMBERS}/target-u1`)),
  check: (_p, _ctx, snap) => assert.equal(snap.exists(), true),
});
row({
  name: "members/{altro} get (richiesta di un'altra unità)",
  allow: "A",
  run: (p) => getDocFromServer(doc(p.db, `${MEMBERS}/target-u2`)),
});
row({
  name: "members list where claimedUnitId == unità del dirigente",
  allow: "DA",
  run: (p) => readDocs(p, MEMBERS, where("claimedUnitId", "==", UNIT1.id)),
  check: (_p, _ctx, snap) => {
    const ids = snap.docs.map((item) => item.id);
    assert.ok(ids.includes("target-u1"), "la richiesta della unità 1 c'è");
    assert.ok(!ids.includes("target-u2"), "quella della unità 2 no");
  },
});
row({
  name: "members list senza filtro",
  allow: "A",
  run: (p) => readDocs(p, MEMBERS),
  check: (_p, _ctx, snap) => assert.ok(snap.size >= 2),
});
row({
  name: "members list where claimedUnitId == unità altrui",
  allow: "A",
  run: (p) => readDocs(p, MEMBERS, where("claimedUnitId", "==", UNIT2.id)),
});
row({
  name: "members/{altro}/staff/note get (unità del dirigente)",
  allow: "DA",
  run: (p) => getDocFromServer(doc(p.db, `${MEMBERS}/target-u1/staff/note`)),
  check: (_p, _ctx, snap) => assert.equal(snap.exists(), true),
});
row({
  name: "members/{altro}/staff/note get (altra unità)",
  allow: "A",
  run: (p) => getDocFromServer(doc(p.db, `${MEMBERS}/target-u2/staff/note`)),
});
row({
  name: "members/{sé}/staff/note get (il titolare non legge la nota su di sé)",
  allow: "",
  classes: "ONPMFX",
  applies: (def) => def.ownMemberInA,
  run: (p) => getDocFromServer(doc(p.db, `${MEMBERS}/${p.who}/staff/note`)),
});
// Scrittura da client: mai, nemmeno l'admin. Il documento esiste o meno, la rule vale lo stesso.
const writeRow = (name, run, pathOf) =>
  row({
    name: `members scrittura da client: ${name}`,
    allow: "",
    setup: async (p) => ({ path: pathOf(p), before: await adminData(pathOf(p)) }),
    run,
    untouched: async (_p, ctx) => assert.deepEqual(await adminData(ctx.path), ctx.before, "il documento non deve cambiare"),
  });
writeRow("create sé (status active)", (p) => setDoc(doc(p.db, `${MEMBERS}/${p.who}`), memberPayload()), (p) => `${MEMBERS}/${p.who}`);
writeRow("update sé (status active, version)", (p) => updateDoc(doc(p.db, `${MEMBERS}/${p.who}`), { status: "active", version: 99 }), (p) => `${MEMBERS}/${p.who}`);
writeRow("delete sé", (p) => deleteDoc(doc(p.db, `${MEMBERS}/${p.who}`)), (p) => `${MEMBERS}/${p.who}`);
writeRow("create di un altro uid", (p) => setDoc(doc(p.db, `${MEMBERS}/nuovo-${p.index}`), memberPayload()), (p) => `${MEMBERS}/nuovo-${p.index}`);
writeRow("update di un altro (status active)", (p) => updateDoc(doc(p.db, `${MEMBERS}/target-u1`), { status: "active" }), () => `${MEMBERS}/target-u1`);
writeRow("delete di un altro", (p) => deleteDoc(doc(p.db, `${MEMBERS}/target-u1`)), () => `${MEMBERS}/target-u1`);
writeRow("nota dello staff: create", (p) => setDoc(doc(p.db, `${MEMBERS}/target-u1/staff/nota-${p.index}`), { note: "x" }), (p) => `${MEMBERS}/target-u1/staff/nota-${p.index}`);
writeRow("nota dello staff: update", (p) => updateDoc(doc(p.db, `${MEMBERS}/target-u1/staff/note`), { note: "cambiata" }), () => `${MEMBERS}/target-u1/staff/note`);
writeRow("nota dello staff: delete", (p) => deleteDoc(doc(p.db, `${MEMBERS}/target-u1/staff/note`)), () => `${MEMBERS}/target-u1/staff/note`);

// --- galleries ---------------------------------------------------------------
row({
  name: "galleries where activityId",
  allow: "MDA",
  run: (p) => readDocs(p, `stakes/${STAKE_A}/galleries`, where("activityId", "==", MAIN.activityId)),
  check: (_p, _ctx, snap) => assert.deepEqual(snap.docs.map((item) => item.id), [MAIN.galleryId]),
});
row({
  name: "galleries where published == true",
  allow: "MDA",
  run: (p) => readDocs(p, `stakes/${STAKE_A}/galleries`, where("published", "==", true)),
  check: (_p, _ctx, snap) => assert.ok(snap.docs.some((item) => item.id === PUBLISHED.galleryId), "la galleria pubblicata c'è"),
});
row({
  name: "galleries get",
  allow: "MDA",
  run: (p) => getDocFromServer(doc(p.db, galleryPath(MAIN))),
  check: (_p, _ctx, snap) => assert.equal(snap.exists(), true),
});

// --- media -------------------------------------------------------------------
row({
  name: "media getDocs (intera collezione)",
  allow: "MDA",
  run: (p) => readDocs(p, mediaPathOf(MAIN)),
  check: (_p, _ctx, snap) => assert.ok(snap.size >= 1),
});
row({
  name: "media onSnapshot",
  allow: "MDA",
  run: (p) => firstSnapshot(p, mediaPathOf(MAIN)),
  check: (_p, _ctx, snap) => assert.ok(snap.size >= 1),
});
row({
  name: "media orderBy createdAt desc + limit 3",
  allow: "MDA",
  run: (p) => readDocs(p, mediaPathOf(MAIN), orderBy("createdAt", "desc"), limit(3)),
  check: (_p, _ctx, snap) => assert.ok(snap.size >= 1),
});
row({
  name: "media create in batch con mediaCount +1 (finestra aperta, uploadedBy = sé)",
  allow: "MDA",
  setup: async () => ({ g: await newGallery() }),
  run: (p, { g }) => createMediaBatch(p, g, "m-new", imageData(g, "m-new", p.who)),
  check: async (p, { g }) => {
    assert.equal((await adminData(mediaDocPath(g, "m-new"))).uploadedBy, p.uid);
    assert.equal((await adminData(galleryPath(g))).mediaCount, 1);
  },
  untouched: async (_p, { g }) => {
    assert.equal(await adminData(mediaDocPath(g, "m-new")), null);
    assert.equal((await adminData(galleryPath(g))).mediaCount, 0);
  },
});
row({
  name: "media delete proprio in batch con mediaCount -1",
  allow: "MDA",
  setup: async (p) => {
    const g = await newGallery();
    await seedMedia(g, "m-own", p.who);
    return { g };
  },
  run: (p, { g }) => deleteMediaBatch(p, g, "m-own"),
  check: async (_p, { g }) => {
    assert.equal(await adminData(mediaDocPath(g, "m-own")), null);
    assert.equal((await adminData(galleryPath(g))).mediaCount, 0);
  },
  untouched: async (_p, { g }) => {
    assert.notEqual(await adminData(mediaDocPath(g, "m-own")), null);
    assert.equal((await adminData(galleryPath(g))).mediaCount, 1);
  },
});
row({
  name: "media delete di un altro in batch con mediaCount -1",
  allow: "DA",
  setup: async () => {
    const g = await newGallery();
    await seedMedia(g, "m-altrui", SEED_UID);
    return { g };
  },
  run: (p, { g }) => deleteMediaBatch(p, g, "m-altrui"),
  check: async (_p, { g }) => assert.equal(await adminData(mediaDocPath(g, "m-altrui")), null),
  untouched: async (_p, { g }) => {
    assert.notEqual(await adminData(mediaDocPath(g, "m-altrui")), null);
    assert.equal((await adminData(galleryPath(g))).mediaCount, 1);
  },
});

// --- like di un media --------------------------------------------------------
row({
  name: "like di un media: get del proprio like",
  allow: "MDA",
  run: (p) => getDocFromServer(doc(p.db, likeDocPath(MAIN, MAIN_MEDIA, p.who))),
  check: (_p, _ctx, snap) => assert.equal(snap.exists(), false),
});
row({
  name: "like di un media: batch con likeCount +1",
  allow: "MDA",
  setup: async () => {
    const g = await newGallery();
    await seedMedia(g, "m1", SEED_UID);
    return { g };
  },
  run: (p, { g }) => likeMedia(p, g, "m1"),
  check: async (p, { g }) => {
    assert.equal((await adminData(mediaDocPath(g, "m1"))).likeCount, 1);
    assert.notEqual(await adminData(likeDocPath(g, "m1", p.uid)), null);
  },
  untouched: async (_p, { g }) => assert.equal((await adminData(mediaDocPath(g, "m1"))).likeCount, 0),
});
row({
  name: "like di un media: unlike con batch e likeCount -1",
  allow: "MDA",
  setup: async (p) => {
    const g = await newGallery();
    await seedMedia(g, "m1", SEED_UID);
    await adminDb.doc(mediaDocPath(g, "m1")).update({ likeCount: 1 });
    await adminDb.doc(likeDocPath(g, "m1", p.who)).set({ uid: p.who, createdAt: iso() });
    return { g };
  },
  run: (p, { g }) => unlikeMedia(p, g, "m1"),
  check: async (p, { g }) => {
    assert.equal((await adminData(mediaDocPath(g, "m1"))).likeCount, 0);
    assert.equal(await adminData(likeDocPath(g, "m1", p.uid)), null);
  },
  untouched: async (_p, { g }) => assert.equal((await adminData(mediaDocPath(g, "m1"))).likeCount, 1),
});

// --- commenti di un media ----------------------------------------------------
row({
  name: "commenti di un media: list",
  allow: "MDA",
  run: (p) => readDocs(p, commentsPathOf(MAIN, MAIN_MEDIA)),
  check: (_p, _ctx, snap) => assert.ok(snap.size >= 1),
});
row({
  name: "commenti di un media: create",
  allow: "MDA",
  run: (p) => setDoc(doc(collection(p.db, commentsPathOf(MAIN, MAIN_MEDIA))), { uid: p.who, displayName: "Prova", body: "Bella!", createdAt: iso() }),
  check: async (p) => {
    const mine = await adminDb.collection(commentsPathOf(MAIN, MAIN_MEDIA)).where("uid", "==", p.uid).get();
    assert.equal(mine.size, 1);
  },
});
row({
  name: "commenti di un media: delete proprio",
  allow: "MDA",
  setup: async (p) => {
    const id = nextId("c-own-");
    await adminDb.doc(`${commentsPathOf(MAIN, MAIN_MEDIA)}/${id}`).set({ uid: p.who, displayName: "Prova", body: "mio", createdAt: iso() });
    return { id };
  },
  run: (p, { id }) => deleteDoc(doc(p.db, `${commentsPathOf(MAIN, MAIN_MEDIA)}/${id}`)),
  check: async (_p, { id }) => assert.equal(await adminData(`${commentsPathOf(MAIN, MAIN_MEDIA)}/${id}`), null),
  untouched: async (_p, { id }) => assert.notEqual(await adminData(`${commentsPathOf(MAIN, MAIN_MEDIA)}/${id}`), null),
});
row({
  name: "commenti di un media: delete di un altro",
  allow: "DA",
  setup: async () => {
    const id = nextId("c-altrui-");
    await adminDb.doc(`${commentsPathOf(MAIN, MAIN_MEDIA)}/${id}`).set({ uid: SEED_UID, displayName: "Seed", body: "altrui", createdAt: iso() });
    return { id };
  },
  run: (p, { id }) => deleteDoc(doc(p.db, `${commentsPathOf(MAIN, MAIN_MEDIA)}/${id}`)),
  check: async (_p, { id }) => assert.equal(await adminData(`${commentsPathOf(MAIN, MAIN_MEDIA)}/${id}`), null),
  untouched: async (_p, { id }) => assert.notEqual(await adminData(`${commentsPathOf(MAIN, MAIN_MEDIA)}/${id}`), null),
});

// --- contenuti nascosti e segnalazioni ---------------------------------------
row({
  name: "hiddenMedia where uploadedBy == sé",
  allow: "MDA",
  run: (p) => readDocs(p, hiddenPathOf(MAIN), where("uploadedBy", "==", p.who)),
  check: (p, _ctx, snap) => assert.deepEqual(snap.docs.map((item) => item.id), [`h-${p.index}`]),
});
row({
  name: "hiddenMedia tutti (senza filtro)",
  allow: "DA",
  run: (p) => readDocs(p, hiddenPathOf(MAIN)),
  check: (_p, _ctx, snap) => assert.ok(snap.size >= 2),
});
row({
  name: "reports list",
  allow: "DA",
  run: (p) => readDocs(p, reportsPathOf(MAIN)),
  check: (_p, _ctx, snap) => assert.equal(snap.size, 1),
});
row({
  name: "reports get",
  allow: "DA",
  run: (p) => getDocFromServer(doc(p.db, `${reportsPathOf(MAIN)}/r1`)),
  check: (_p, _ctx, snap) => assert.equal(snap.exists(), true),
});

// --- Notte dei Record --------------------------------------------------------
row({
  name: "records where status == open",
  allow: "MDA",
  run: (p) => readDocs(p, recordsPath, where("status", "==", "open")),
  check: (_p, _ctx, snap) => assert.deepEqual(snap.docs.map((item) => item.id), ["r-open"]),
});
row({
  name: "records senza filtro (gestione)",
  allow: "DA",
  run: (p) => readDocs(p, recordsPath),
  check: (_p, _ctx, snap) => assert.equal(snap.size, 2),
});
row({
  name: "recordEntries where ownerUid == sé",
  allow: "NPMFXDA",
  run: (p) => readDocs(p, entriesPath, where("ownerUid", "==", p.who)),
  check: (p, _ctx, snap) => assert.deepEqual(snap.docs.map((item) => item.id), [`e-${p.index}`]),
});

// --- sondaggi ----------------------------------------------------------------
row({
  name: "surveyQuestions orderBy order",
  allow: "MDA",
  run: (p) => readDocs(p, questionsPath, orderBy("order", "asc")),
  check: (_p, _ctx, snap) => assert.equal(snap.size, 1),
});
row({
  name: "surveyResponses get per id",
  allow: "MDA",
  run: (p) => getDocFromServer(doc(p.db, `${responsesPath}/${SURVEY_SEED}`)),
  check: (_p, _ctx, snap) => assert.equal(snap.exists(), true),
});
row({
  name: "surveyResponses set della bozza (nuova)",
  allow: "MDA",
  setup: () => ({ id: nextId("resp-new-") }),
  run: (p, { id }) => setDoc(doc(p.db, `${responsesPath}/${id}`), surveyPayload(true)),
  check: async (_p, { id }) => assert.equal((await adminData(`${responsesPath}/${id}`)).isDraft, true),
  untouched: async (_p, { id }) => assert.equal(await adminData(`${responsesPath}/${id}`), null),
});
row({
  name: "surveyResponses getDoc + set della bozza ripresa",
  allow: "MDA",
  setup: async () => {
    const id = nextId("resp-draft-");
    await adminDb.doc(`${responsesPath}/${id}`).set(surveyPayload(true));
    return { id };
  },
  run: async (p, { id }) => {
    const reference = doc(p.db, `${responsesPath}/${id}`);
    const existing = await getDocFromServer(reference);
    await setDoc(reference, surveyPayload(true, { createdAt: existing.data().createdAt, answers: { q1: { type: "open", value: "Cambiato" } } }));
  },
  check: async (_p, { id }) => assert.equal((await adminData(`${responsesPath}/${id}`)).answers.q1.value, "Cambiato"),
  untouched: async (_p, { id }) => assert.equal((await adminData(`${responsesPath}/${id}`)).answers.q1.value, "Tutto bene"),
});
row({
  name: "surveyResponses getDoc + set dell'invio (update della bozza, isDraft false)",
  allow: "MDA",
  setup: async () => {
    const id = nextId("resp-submit-");
    await adminDb.doc(`${responsesPath}/${id}`).set(surveyPayload(true));
    return { id };
  },
  run: async (p, { id }) => {
    const reference = doc(p.db, `${responsesPath}/${id}`);
    const existing = await getDocFromServer(reference);
    await setDoc(reference, surveyPayload(false, { createdAt: existing.data().createdAt }));
  },
  check: async (_p, { id }) => assert.equal((await adminData(`${responsesPath}/${id}`)).isDraft, false),
  untouched: async (_p, { id }) => assert.equal((await adminData(`${responsesPath}/${id}`)).isDraft, true),
});
row({
  name: "surveyResponses list (risultati)",
  allow: "A",
  run: (p) => readDocs(p, responsesPath),
  check: (_p, _ctx, snap) => assert.ok(snap.size >= 1),
});

// --- feed --------------------------------------------------------------------
row({
  name: "feedPosts where published == true",
  allow: ALL,
  run: (p) => readDocs(p, feedPath, where("published", "==", true)),
  check: (_p, _ctx, snap) => assert.ok(snap.size >= 1),
});
row({
  name: "like di un post: get del proprio",
  allow: "ONPMFXDA",
  run: (p) => getDocFromServer(doc(p.db, `${feedPath}/${FEED_MAIN}/likes/${p.who}`)),
  check: (_p, _ctx, snap) => assert.equal(snap.exists(), false),
});
row({
  name: "like di un post: batch con likeCount +1",
  allow: "MDA",
  setup: async () => {
    const id = nextId("post-");
    await seedPost(id, 0);
    return { id };
  },
  run: (p, { id }) => likePost(p, id),
  check: async (p, { id }) => {
    assert.equal((await adminData(`${feedPath}/${id}`)).likeCount, 1);
    assert.notEqual(await adminData(`${feedPath}/${id}/likes/${p.uid}`), null);
  },
  untouched: async (_p, { id }) => assert.equal((await adminData(`${feedPath}/${id}`)).likeCount, 0),
});
row({
  name: "like di un post: unlike con batch e likeCount -1",
  allow: "MDA",
  setup: async (p) => {
    const id = nextId("post-");
    await seedPost(id, 1);
    await adminDb.doc(`${feedPath}/${id}/likes/${p.who}`).set({ uid: p.who, createdAt: iso() });
    return { id };
  },
  run: (p, { id }) => unlikePost(p, id),
  check: async (p, { id }) => {
    assert.equal((await adminData(`${feedPath}/${id}`)).likeCount, 0);
    assert.equal(await adminData(`${feedPath}/${id}/likes/${p.uid}`), null);
  },
  untouched: async (_p, { id }) => assert.equal((await adminData(`${feedPath}/${id}`)).likeCount, 1),
});
row({
  name: "commenti di un post: list",
  allow: "MDA",
  run: (p) => readDocs(p, `${feedPath}/${FEED_MAIN}/comments`),
  check: (_p, _ctx, snap) => assert.ok(snap.size >= 1),
});
row({
  name: "commenti di un post: create",
  allow: "MDA",
  run: (p) => setDoc(doc(collection(p.db, `${feedPath}/${FEED_MAIN}/comments`)), { uid: p.who, body: "Che bello", createdAt: iso() }),
  check: async (p) => {
    const mine = await adminDb.collection(`${feedPath}/${FEED_MAIN}/comments`).where("uid", "==", p.uid).get();
    assert.equal(mine.size, 1);
  },
});

// --- righe "incoerenti": contatori mossi male --------------------------------
// Contratto (2026-10-20): like mosso di 2, o senza il proprio documento like nello
// stesso batch, e mediaCount mosso di 2 sono negati. Un mediaCount di +1/-1 da
// solo NON è nel contratto (resta ammesso, come in "rules: contatore mediaCount"
// di activityGalleryEmulator). L'admin può scrivere qualunque campo della
// galleria e del media (rules: isStakeAdmin), quindi dove il contatore è del solo
// admin la riga vale per M e D.
const freshGalleryWithMedia = async () => {
  const g = await newGallery();
  await seedMedia(g, "m1", SEED_UID);
  return { g };
};
row({
  name: "like moltiplicato: doc like + likeCount +2 nello stesso batch",
  allow: "",
  classes: "MDA",
  setup: freshGalleryWithMedia,
  run: (p, { g }) => {
    const batch = writeBatch(p.db);
    batch.set(doc(p.db, likeDocPath(g, "m1", p.who)), { uid: p.who, createdAt: iso() });
    batch.update(doc(p.db, mediaDocPath(g, "m1")), { likeCount: increment(2) });
    return batch.commit();
  },
  untouched: async (_p, { g }) => assert.equal((await adminData(mediaDocPath(g, "m1"))).likeCount, 0),
});
row({
  name: "like senza likeCount: solo il doc like nel batch",
  allow: "",
  classes: "MDA",
  setup: freshGalleryWithMedia,
  run: (p, { g }) => {
    const batch = writeBatch(p.db);
    batch.set(doc(p.db, likeDocPath(g, "m1", p.who)), { uid: p.who, createdAt: iso() });
    return batch.commit();
  },
  untouched: async (p, { g }) => assert.equal(await adminData(likeDocPath(g, "m1", p.uid)), null),
});
row({
  name: "likeCount +1 senza il proprio doc like nel batch",
  allow: "",
  classes: "MD",
  setup: freshGalleryWithMedia,
  run: (p, { g }) => updateDoc(doc(p.db, mediaDocPath(g, "m1")), { likeCount: increment(1) }),
  untouched: async (_p, { g }) => assert.equal((await adminData(mediaDocPath(g, "m1"))).likeCount, 0),
});
row({
  name: "unlike senza cancellare il like: likeCount -1 da solo",
  allow: "",
  classes: "MD",
  setup: async (p) => {
    const ctx = await freshGalleryWithMedia();
    await adminDb.doc(mediaDocPath(ctx.g, "m1")).update({ likeCount: 1 });
    await adminDb.doc(likeDocPath(ctx.g, "m1", p.who)).set({ uid: p.who, createdAt: iso() });
    return ctx;
  },
  run: (p, { g }) => updateDoc(doc(p.db, mediaDocPath(g, "m1")), { likeCount: increment(-1) }),
  untouched: async (_p, { g }) => assert.equal((await adminData(mediaDocPath(g, "m1"))).likeCount, 1),
});
row({
  name: "mediaCount +2 con il media nuovo nello stesso batch",
  allow: "",
  classes: "MD",
  setup: async () => ({ g: await newGallery() }),
  run: (p, { g }) => createMediaBatch(p, g, "m-doppio", imageData(g, "m-doppio", p.who), 2),
  untouched: async (_p, { g }) => {
    assert.equal(await adminData(mediaDocPath(g, "m-doppio")), null);
    assert.equal((await adminData(galleryPath(g))).mediaCount, 0);
  },
});
row({
  name: "mediaCount -2 con il proprio media cancellato nello stesso batch",
  allow: "",
  classes: "MD",
  setup: async (p) => {
    const g = await newGallery();
    await seedMedia(g, "m-own", p.who);
    await adminDb.doc(galleryPath(g)).update({ mediaCount: 5 });
    return { g };
  },
  run: (p, { g }) => deleteMediaBatch(p, g, "m-own", -2),
  untouched: async (_p, { g }) => assert.equal((await adminData(galleryPath(g))).mediaCount, 5),
});
row({
  name: "like di un post moltiplicato: doc like + likeCount +2",
  allow: "",
  classes: "MDA",
  setup: async () => {
    const id = nextId("post-");
    await seedPost(id, 0);
    return { id };
  },
  run: (p, { id }) => {
    const batch = writeBatch(p.db);
    batch.set(doc(p.db, `${feedPath}/${id}/likes/${p.who}`), { uid: p.who, createdAt: iso() });
    batch.update(doc(p.db, `${feedPath}/${id}`), { likeCount: increment(2) });
    return batch.commit();
  },
  untouched: async (_p, { id }) => assert.equal((await adminData(`${feedPath}/${id}`)).likeCount, 0),
});
row({
  name: "likeCount di un post +1 senza il proprio doc like",
  allow: "",
  classes: "MD",
  setup: async () => {
    const id = nextId("post-");
    await seedPost(id, 0);
    return { id };
  },
  run: (p, { id }) => updateDoc(doc(p.db, `${feedPath}/${id}`), { likeCount: increment(1) }),
  untouched: async (_p, { id }) => assert.equal((await adminData(`${feedPath}/${id}`)).likeCount, 0),
});

// ---------------------------------------------------------------------------
// Righe aggiunte dopo la review del 2026-10-20
// ---------------------------------------------------------------------------
const EXTRA_ROWS = [];
const extra = (definition) => EXTRA_ROWS.push(definition);

// Forme di query su members: solo `where('claimedUnitId','==',<propria unità>)`
// dimostra la rule al dirigente; ogni altra forma è dell'admin.
extra({
  name: "members list where claimedUnitId in [sua, altra]",
  allow: "A",
  run: (p) => readDocs(p, MEMBERS, where("claimedUnitId", "in", [UNIT1.id, UNIT2.id])),
});
extra({
  name: "members list where claimedUnitId != altra",
  allow: "A",
  run: (p) => readDocs(p, MEMBERS, where("claimedUnitId", "!=", "unit-inesistente")),
});
extra({
  name: "members list where claimedUnitId not-in [altra]",
  allow: "A",
  run: (p) => readDocs(p, MEMBERS, where("claimedUnitId", "not-in", ["unit-inesistente"])),
});
extra({
  name: "members count() con where claimedUnitId == unità del dirigente",
  allow: "DA",
  run: (p) => getCountFromServer(query(collection(p.db, MEMBERS), where("claimedUnitId", "==", UNIT1.id))),
  check: (_p, _ctx, snap) => assert.ok(snap.data().count >= 1),
});
extra({
  name: "members count() senza filtro",
  allow: "A",
  run: (p) => getCountFromServer(collection(p.db, MEMBERS)),
});
extra({
  name: "members list orderBy requestedAt senza filtro",
  allow: "A",
  run: (p) => readDocs(p, MEMBERS, orderBy("requestedAt", "desc")),
});
extra({
  name: "members collectionGroup('members')",
  allow: "",
  classes: "DM",
  run: (p) => getDocsFromServer(collectionGroup(p.db, "members")),
});
extra({
  name: "members/{uid}/staff list (solo get per il dirigente)",
  allow: "A",
  run: (p) => readDocs(p, `${MEMBERS}/target-u1/staff`),
});
extra({
  name: "records count() con where status == open",
  allow: "MDA",
  run: (p) => getCountFromServer(query(collection(p.db, recordsPath), where("status", "==", "open"))),
  check: (_p, _ctx, snap) => assert.equal(snap.data().count, 1),
});
extra({
  name: "records count() senza filtro",
  allow: "DA",
  run: (p) => getCountFromServer(collection(p.db, recordsPath)),
});

// Assegnazione del ruolo da client: un admin del palo riscrive `users/{uid}`
// cambiando solo `role` e `updatedAt`. Un ruolo staff dà anche l'appartenenza,
// quindi non si assegna a chi è uscito, rifiutato, rimosso o bloccato.
// `stakeless`: il profilo bersaglio non ha un palo (`stakeId: ''`): i poteri staff
// valgono per un palo, quindi nessun ruolo staff, nemmeno dal super admin.
const stakelessProfile = (role, label) =>
  buildUserDocument({
    firstName: "Prova",
    lastName: label,
    email: `${label}@example.invalid`,
    role,
    stake: { id: "", slug: "", name: "" },
    unit: null,
    now: iso(),
  });
const roleRow = ({ name, current = "participant", next, status, allow, stakeless = false }) =>
  extra({
    name,
    allow,
    setup: async () => {
      const uid = nextId("target-ruolo-");
      await adminDb.doc(`users/${uid}`).set(stakeless ? stakelessProfile(current, uid) : profileData(current, STAKE_A, UNIT1, uid));
      if (status) await adminDb.doc(`${MEMBERS}/${uid}`).set(memberData({ status, staffRole: current === "participant" ? null : current }));
      return { uid };
    },
    run: (p, { uid }) => updateDoc(doc(p.db, `users/${uid}`), { role: next, updatedAt: iso() }),
    check: async (_p, { uid }) => assert.equal((await adminData(`users/${uid}`)).role, next),
    untouched: async (_p, { uid }) => assert.equal((await adminData(`users/${uid}`)).role, current),
  });
roleRow({ name: "assegna unit_leader a un utente senza members", next: "unit_leader", allow: "A" });
roleRow({ name: "assegna unit_leader a un utente con members pending", next: "unit_leader", status: "pending", allow: "A" });
roleRow({ name: "assegna unit_leader a un utente con members active", next: "unit_leader", status: "active", allow: "A" });
roleRow({ name: "assegna admin a un utente con members active", next: "admin", status: "active", allow: "A" });
for (const status of ["declined", "withdrawn", "removed", "blocked"]) {
  roleRow({ name: `assegna unit_leader a un utente con members ${status}`, next: "unit_leader", status, allow: "" });
}
roleRow({ name: "assegna admin a un utente con members blocked", next: "admin", status: "blocked", allow: "" });
roleRow({ name: "retrocede a participant un unit_leader con members blocked", current: "unit_leader", next: "participant", status: "blocked", allow: "A" });
roleRow({ name: "retrocede a participant un admin con members removed", current: "admin", next: "participant", status: "removed", allow: "A" });
// Profilo senza palo: nessun ruolo staff per nessuno, super admin compreso.
roleRow({ name: "assegna unit_leader a un profilo senza palo (stakeId vuoto)", next: "unit_leader", stakeless: true, allow: "" });
roleRow({ name: "assegna admin a un profilo senza palo (stakeId vuoto)", next: "admin", stakeless: true, allow: "" });

// ---------------------------------------------------------------------------
// Generazione dei test: una cella = una riga x una persona
// ---------------------------------------------------------------------------
function defineCells(rows, persons) {
  for (const r of rows) {
    for (const def of persons) {
      if (r.classes && !r.classes.includes(def.cls)) continue;
      if (r.applies && !r.applies(def)) continue;
      const allowed = r.allow.includes(def.cls);
      test(`${r.name} — ${def.key}: ${allowed ? "permesso" : "negato"}`, async () => {
        const p = P[def.key];
        const ctx = r.setup ? await r.setup(p) : undefined;
        if (allowed) {
          const result = await r.run(p, ctx);
          if (r.check) await r.check(p, ctx, result);
        } else {
          await expectDenied(async () => r.run(p, ctx), r.name);
          if (r.untouched) await r.untouched(p, ctx);
        }
      });
    }
  }
}

describe("matrice Firestore: V O N P M F X D A", () => {
  defineCells(ROWS, MATRIX_PERSONS);
});

describe("righe incoerenti Firestore", () => {
  defineCells(ROWS, INCOHERENT_PERSONS);
});

describe("isolamento fra pali", () => {
  test("X legge la galleria del proprio palo B: permesso", async () => {
    const snap = await readDocs(P.X, `stakes/${STAKE_B}/galleries`, where("activityId", "==", SHARED_B.gallery.activityId));
    assert.equal(snap.size, 1);
  });
  test("M del palo A non legge la galleria del palo B: negato", async () => {
    await expectDenied(readDocs(P.M, `stakes/${STAKE_B}/galleries`, where("activityId", "==", SHARED_B.gallery.activityId)));
    await expectDenied(readDocs(P.M, mediaPathOf(SHARED_B.gallery)));
  });
  test("A (admin del palo A) non legge la galleria del palo B: negato", async () => {
    await expectDenied(readDocs(P.A, `stakes/${STAKE_B}/galleries`, where("activityId", "==", SHARED_B.gallery.activityId)));
    await expectDenied(readDocs(P.A, `stakes/${STAKE_B}/members`));
  });
  test("A (super_admin) legge la galleria del palo B: permesso", async () => {
    const snap = await readDocs(P["A (super_admin)"], `stakes/${STAKE_B}/galleries`, where("activityId", "==", SHARED_B.gallery.activityId));
    assert.equal(snap.size, 1);
  });
  test("D (dirigente del palo A) non legge la galleria del palo B: negato", async () => {
    await expectDenied(readDocs(P.D, mediaPathOf(SHARED_B.gallery)));
  });
});

describe("Firestore: celle aggiunte dopo la review (forme di query su members, count, assegnazione ruolo)", () => {
  defineCells(EXTRA_ROWS, MATRIX_PERSONS);
  defineCells(EXTRA_ROWS, INCOHERENT_PERSONS);
});

// Lo staff "in elenco" (management/recordNight.staffUids, scelto da un admin) vale
// solo per la Notte dei Record e non dà appartenenza: gestisce i record di
// quell'attività, ma galleria, media e sondaggi restano dei membri.
describe("Firestore: staff in elenco della Notte dei Record (non dà appartenenza)", () => {
  const LISTED = [
    { key: "elenco (account senza members)", mode: "password", staff: true },
    { key: "elenco (anonimo)", mode: "anonymous", staff: false },
  ];
  const listed = {};
  before(async () => {
    const created = await Promise.all(LISTED.map((def, index) => makeActor({ ...def, cls: "L", role: "participant", profileStake: STAKE_A }, 100 + index)));
    for (const actor of created) {
      listed[actor.key] = actor;
      await adminDb.doc(`users/${actor.uid}`).set(profileData("participant", STAKE_A, null, actor.key));
    }
    await adminDb.doc(`${activityPath}/management/recordNight`).set({
      staffUids: created.map((actor) => actor.uid), updatedAt: iso(), updatedBy: SEED_UID,
    });
  });
  after(async () => {
    await Promise.all(Object.values(listed).map((actor) => adminDb.recursiveDelete(adminDb.doc(`users/${actor.uid}`))));
  });
  const cells = [
    ["records senza filtro (gestione)", (p) => readDocs(p, recordsPath), true],
    ["records where status == open", (p) => readDocs(p, recordsPath, where("status", "==", "open")), true],
    ["recordEntries senza filtro (gestione)", (p) => readDocs(p, entriesPath), true],
    ["galleries where activityId", (p) => readDocs(p, `stakes/${STAKE_A}/galleries`, where("activityId", "==", MAIN.activityId)), false],
    ["media getDocs", (p) => readDocs(p, mediaPathOf(MAIN)), false],
    ["surveyQuestions orderBy order", (p) => readDocs(p, questionsPath, orderBy("order", "asc")), false],
    ["like di un post: batch con likeCount +1", async (p) => {
      const id = nextId("post-");
      await seedPost(id, 0);
      await likePost(p, id);
    }, false],
    ["members/{sé} get (non esiste: nessuna appartenenza)", async (p) => {
      const snap = await getDocFromServer(doc(p.db, `${MEMBERS}/${p.who}`));
      assert.equal(snap.exists(), false);
    }, "sempre"],
  ];
  for (const def of LISTED) {
    for (const [name, run, staffOnly] of cells) {
      const allowed = staffOnly === "sempre" || (staffOnly === true && def.staff);
      test(`${name} — ${def.key}: ${allowed ? "permesso" : "negato"}`, async () => {
        if (allowed) await run(listed[def.key]);
        else await expectDenied(async () => run(listed[def.key]), name);
      });
    }
  }
});

describe("Firestore: sessione anonima con un profilo da staff del palo A", () => {
  // Tutte le righe della matrice e della sezione precedente: la persona è "O",
  // quindi il contratto nega tutto tranne le tre letture aperte a ogni account.
  defineCells(ROWS, ANON_STAFF_PERSONS);
  defineCells(EXTRA_ROWS, ANON_STAFF_PERSONS);
});

// ---------------------------------------------------------------------------
// Storage (dopo la fase B di gugd-storage-eu)
// ---------------------------------------------------------------------------
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const UNAUTHORIZED = { ok: false, code: "storage/unauthorized" };
async function storageOutcome(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, code: error?.code };
  }
}
const seedFile = (path, uploadedBy) =>
  adminBucket.file(path).save(Buffer.from(JPEG), { contentType: "image/jpeg", metadata: { metadata: { uploadedBy } } });
const fileExists = async (path) => (await adminBucket.file(path).exists())[0];
const freshMedia = () => {
  const g = SHARED_STORAGE.gallery;
  const mediaId = nextId("sm-");
  return { g, mediaId, path: `${folderOf(g, mediaId)}/optimized-${++seq}.jpg` };
};
const upload = (p, path, bytes = JPEG, { contentType = "image/jpeg", uploadedBy = p.who, meta } = {}) =>
  uploadBytesResumable(storageRef(p.storage, path), bytes, {
    contentType,
    customMetadata: meta ?? { uploadedBy, stakeId: STAKE_A, kind: "optimized" },
  });

const STORAGE_ROWS = [
  {
    name: "storage get del proprio file prima che esista il doc media",
    allow: "MDA",
    setup: async (p) => {
      const ctx = freshMedia();
      await seedFile(ctx.path, p.who);
      return ctx;
    },
    run: (p, { path }) => getBytes(storageRef(p.storage, path)),
  },
  {
    name: "storage get di un file con il doc media",
    allow: "MDA",
    setup: async () => {
      const ctx = freshMedia();
      await seedFile(ctx.path, SEED_UID);
      await seedMedia(ctx.g, ctx.mediaId, SEED_UID);
      return ctx;
    },
    run: (p, { path }) => getBytes(storageRef(p.storage, path)),
  },
  {
    // Contenuto nascosto da una segnalazione: il doc media non c'è più, i file li legge solo lo staff.
    name: "storage get di un file altrui senza doc media",
    allow: "DA",
    setup: async () => {
      const ctx = freshMedia();
      await seedFile(ctx.path, SEED_UID);
      return ctx;
    },
    run: (p, { path }) => getBytes(storageRef(p.storage, path)),
  },
  {
    name: "storage list della cartella del media",
    allow: "MDA",
    setup: async (p) => {
      const ctx = freshMedia();
      await seedFile(ctx.path, p.who);
      return ctx;
    },
    run: (p, { g, mediaId }) => listAll(storageRef(p.storage, folderOf(g, mediaId))),
    check: (_p, _ctx, listing) => assert.equal(listing.items.length, 1),
  },
  {
    name: "storage create di un file nuovo con uploadedBy = sé",
    allow: "MDA",
    setup: () => freshMedia(),
    run: (p, { path }) => upload(p, path),
    check: async (_p, { path }) => assert.equal(await fileExists(path), true),
    untouched: async (_p, { path }) => assert.equal(await fileExists(path), false),
  },
  {
    // L'admin scrive qualunque file: il vincolo su uploadedBy vale per M e D.
    name: "storage create con uploadedBy di un altro",
    allow: "",
    classes: "MD",
    setup: () => freshMedia(),
    run: (p, { path }) => upload(p, path, JPEG, { uploadedBy: SEED_UID }),
    untouched: async (_p, { path }) => assert.equal(await fileExists(path), false),
  },
  {
    name: "storage create senza customMetadata",
    allow: "",
    classes: "MD",
    setup: () => freshMedia(),
    run: (p, { path }) => uploadBytesResumable(storageRef(p.storage, path), JPEG, { contentType: "image/jpeg" }),
    untouched: async (_p, { path }) => assert.equal(await fileExists(path), false),
  },
  {
    name: "storage create sopra un file esistente (solo file nuovi)",
    allow: "",
    classes: "MD",
    setup: async () => {
      const ctx = freshMedia();
      await seedFile(ctx.path, SEED_UID);
      return ctx;
    },
    run: (p, { path }) => upload(p, path, new Uint8Array([9, 9, 9, 9])),
    untouched: async (_p, { path }) => assert.deepEqual([...(await adminBucket.file(path).download())[0]], [...JPEG]),
  },
  {
    name: "storage create di un'immagine da 30 MB - 1 byte",
    allow: "MD",
    classes: "MD",
    only: ["M", "D"],
    setup: () => freshMedia(),
    run: (p, { path }) => upload(p, path, new Uint8Array(30 * 1024 * 1024 - 1)),
    check: async (_p, { path }) => assert.equal(await fileExists(path), true),
  },
  {
    name: "storage create di un'immagine da 30 MB esatti (limite escluso)",
    allow: "",
    classes: "MD",
    only: ["M", "D"],
    setup: () => freshMedia(),
    run: (p, { path }) => upload(p, path, new Uint8Array(30 * 1024 * 1024)),
    untouched: async (_p, { path }) => assert.equal(await fileExists(path), false),
  },
  {
    name: "storage delete di un proprio file",
    allow: "MDA",
    setup: async (p) => {
      const ctx = freshMedia();
      await seedFile(ctx.path, p.who);
      return ctx;
    },
    run: (p, { path }) => deleteObject(storageRef(p.storage, path)),
    check: async (_p, { path }) => assert.equal(await fileExists(path), false),
    untouched: async (_p, { path }) => assert.equal(await fileExists(path), true),
  },
  {
    name: "storage delete di un file altrui",
    allow: "DA",
    setup: async () => {
      const ctx = freshMedia();
      await seedFile(ctx.path, SEED_UID);
      return ctx;
    },
    run: (p, { path }) => deleteObject(storageRef(p.storage, path)),
    check: async (_p, { path }) => assert.equal(await fileExists(path), false),
    untouched: async (_p, { path }) => assert.equal(await fileExists(path), true),
  },
  {
    name: "storage create di un video da 300 MB esatti (limite escluso)",
    allow: "",
    classes: "MD",
    only: ["M", "D"],
    bigUpload: true,
    setup: () => freshMedia(),
    run: (p, { path }) => {
      const chunk = new Uint8Array(1024 * 1024);
      const blob = new Blob(Array.from({ length: 300 }, () => chunk), { type: "video/mp4" });
      return uploadBytesResumable(storageRef(p.storage, path.replace(/\.jpg$/u, ".mp4")), blob, {
        contentType: "video/mp4",
        customMetadata: { uploadedBy: p.who, stakeId: STAKE_A, kind: "original" },
      });
    },
  },
];

describe("Storage: stesse persone, stessa regola", () => {
  for (const r of STORAGE_ROWS) {
    for (const def of [...MATRIX_PERSONS, ...INCOHERENT_PERSONS, ...ANON_STAFF_PERSONS]) {
      if (r.classes && !r.classes.includes(def.cls)) continue;
      if (r.only && !r.only.includes(def.key)) continue;
      const allowed = r.allow.includes(def.cls);
      const skip = r.bigUpload && process.env.GALLERY_BIG_UPLOAD !== "1"
        ? "salta: serve caricare 300 MB veri; rilancia con GALLERY_BIG_UPLOAD=1"
        : STORAGE_SKIP;
      test(`${r.name} — ${def.key}: ${allowed ? "permesso" : "negato"}`, { skip, timeout: 600_000 }, async () => {
        const p = P[def.key];
        const ctx = r.setup ? await r.setup(p) : undefined;
        const outcome = await storageOutcome(Promise.resolve().then(() => r.run(p, ctx)));
        if (allowed) {
          assert.equal(outcome.ok, true, `${r.name}: atteso permesso, ricevuto ${outcome.code}`);
          if (r.check) await r.check(p, ctx, outcome.value);
        } else {
          assert.deepEqual({ ok: outcome.ok, code: outcome.code }, UNAUTHORIZED, `${r.name}: atteso negato`);
          if (r.untouched) await r.untouched(p, ctx);
        }
      });
    }
  }
});
