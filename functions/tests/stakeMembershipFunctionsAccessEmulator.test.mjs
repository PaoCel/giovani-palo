// Appartenenza al palo (S2), fase 2: le callable già in produzione lette
// contro `members/{uid}` invece del profilo, provate nell'emulatore Functions
// DAL CONTRATTO di docs/APPARTENENZA_AL_PALO.md («Callable» del contratto di
// autorizzazione e «activityGallery» / «recordNightParticipant» dell'interfaccia
// di fase 2; S2-2 approvata: chi è uscito dal palo ritira ancora i propri
// tentativi). Utenti VERI dell'Auth emulator e SDK client; l'Admin SDK semina e
// ispeziona. Scritto prima del codice, da chi non lo ha letto.
//
// Rilancio (Auth 9429, Firestore 8429, Functions 5429, Storage 9529, hub 4429;
// progetto demo-*):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --config firebase.membership-functions-test.json --project demo-s2-functions \
//     'node --test --test-concurrency=1 functions/tests/stakeMembershipFunctionsAccessEmulator.test.mjs'
// Sul Mac mini, da un worktree: `npm ci && (cd functions && npm ci)` nello
// stesso comando (ogni sync cancella i node_modules ignorati).
//
// Persone (sigle del contratto): V visitatore, O sessione anonima (con profilo
// E members attivo scritti per errore), N senza members (profilo completo: il
// pending creato dal trigger si toglie con l'Admin SDK), P in attesa, M attivo,
// F fuori (removed; e `declined` per la Notte dei Record), X attivo in un altro
// palo, D dirigente di unità, A admin del palo.
//
// Contratto provato:
//   activityGallery: `ensure` e `report` → M, D, A; `restore` e `delete` → D, A.
//   recordNightParticipant: `propose` e `challenge` → iscrizione attiva E
//   (membro attivo oppure staff dal profilo); `context`, `edit`, `withdraw`,
//   `restore` come prima (anche per chi è uscito dal palo dopo aver proposto).
//   Tutti gli altri: `permission-denied` e nessuna scrittura; V: `unauthenticated`.
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
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp } = require("firebase-admin/app");
const { FieldValue, Timestamp, getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

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
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9529";

async function functionsHost() {
  if (process.env.FUNCTIONS_EMULATOR_HOST) return hostOf(process.env.FUNCTIONS_EMULATOR_HOST, "Functions");
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (hub) {
    const { host, port } = hostOf(hub, "Hub");
    const list = await (await fetch(`http://${host}:${port}/emulators`)).json();
    if (list.functions) return hostOf(`${list.functions.host}:${list.functions.port}`, "Functions");
  }
  return { host: "127.0.0.1", port: 5429, raw: "127.0.0.1:5429" };
}
const FUNCTIONS = await functionsHost();

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const BUCKET = `${PROJECT}.appspot.com`;
const adminApp = initializeAdminApp({ projectId: PROJECT, storageBucket: BUCKET }, `s2-access-admin-${runId}`);
const adminDb = getAdminFirestore(adminApp);

const PASSWORD = `Pw-${runId}-s2x!`; // credenziale di test, vale solo nell'emulatore
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UNIT1 = { id: "unit-1", name: "Rione Uno" };
const STAKE_A = `s2x-a-${runId}`;
const STAKE_B = `s2x-b-${runId}`;
const STAKES = {
  [STAKE_A]: { id: STAKE_A, slug: STAKE_A, name: "Palo A" },
  [STAKE_B]: { id: STAKE_B, slug: STAKE_B, name: "Palo B" },
};

// ---------------------------------------------------------------------------
// Documenti seminati (Admin SDK)
// ---------------------------------------------------------------------------
const memberPath = (stake, uid) => `stakes/${stake}/members/${uid}`;
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

function profileData({ role = "participant", stakeId = STAKE_A, unit = UNIT1, label, email = null }) {
  const stake = STAKES[stakeId];
  const now = iso();
  const staff = role === "admin" || role === "unit_leader";
  return {
    firstName: "Prova",
    lastName: label,
    fullName: `Prova ${label}`,
    email,
    phone: "",
    role,
    city: "",
    birthDate: staff ? "1985-01-30" : "2009-04-21",
    genderRoleCategory: staff ? "dirigente" : "giovane_uomo",
    unitId: unit?.id ?? "",
    unitName: unit?.name ?? "",
    stakeId,
    stakeSlug: stake.slug,
    stakeName: stake.name,
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
}

const adminData = async (path) => {
  const snap = await adminDb.doc(path).get();
  return snap.exists ? snap.data() : null;
};
const memberOf = (stake, uid) => adminData(memberPath(stake, uid));

// ---------------------------------------------------------------------------
// Persone (SDK client)
// ---------------------------------------------------------------------------
const apps = [];
const seededUids = [];
let personSeq = 0;

async function newPerson({ mode = "password", role = "participant", stake = STAKE_A, unit = UNIT1, member = null, profile = true, label } = {}) {
  const index = ++personSeq;
  const name = label ?? `p${index}`;
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT, storageBucket: BUCKET }, `${name}-${index}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.raw}`, { disableWarnings: true });
  const email = `${name}-${index}-${runId}@example.invalid`.toLowerCase();
  if (mode === "anonymous") await signInAnonymously(auth);
  else if (mode === "password") await createUserWithEmailAndPassword(auth, email, PASSWORD);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE.host, FIRESTORE.port);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  const uid = auth.currentUser?.uid ?? null;
  const person = {
    name,
    uid,
    db,
    gallery: (data) => httpsCallable(functions, "activityGallery")(data).then((result) => result.data),
    night: (data) => httpsCallable(functions, "recordNightParticipant")(data).then((result) => result.data),
  };
  if (!uid) return person;
  seededUids.push(uid);
  if (member) await adminDb.doc(memberPath(stake, uid)).set(memberData(member));
  if (profile) await adminDb.doc(`users/${uid}`).set(profileData({ role, stakeId: stake, unit, label: name, email: mode === "password" ? email : null }));
  return person;
}

async function snapshotMembers() {
  const rows = [];
  for (const stakeId of Object.keys(STAKES)) {
    const snap = await adminDb.collection(`stakes/${stakeId}/members`).get();
    for (const item of snap.docs) rows.push(`${stakeId}/${item.id}:${item.data().version}:${item.updateTime.toMillis()}`);
  }
  return rows.sort().join("|");
}

/** Quiete del trigger su users: nessun members dei due pali cambia per `quietMs` di fila. */
async function settleAll({ quietMs = 1500, timeoutMs = 45_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let ultima = await snapshotMembers();
  let fermaDa = Date.now();
  while (Date.now() < deadline) {
    await pausa(200);
    const attuale = await snapshotMembers();
    if (attuale !== ultima) {
      ultima = attuale;
      fermaDa = Date.now();
    } else if (Date.now() - fermaDa >= quietMs) {
      return;
    }
  }
  assert.fail(`members ancora in movimento dopo ${timeoutMs} ms`);
}

async function waitFor(read, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await pausa(250);
  }
  assert.fail(`${label}: condizione non raggiunta in ${timeoutMs} ms. Ultimo stato: ${JSON.stringify(last)}`);
}

async function expectError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${code}`, `atteso functions/${code}, ricevuto ${error?.code}: ${error?.message}`);
    return true;
  });
}
const expectDenied = (promise) => expectError(promise, "permission-denied");

// ---------------------------------------------------------------------------
// Dati: attività, gallerie, media, record
// ---------------------------------------------------------------------------
let seq = 0;
const nextId = (prefix) => `${prefix}${++seq}-${runId}`;

/** Attività in corso (startDate ieri, endDate domani), come la legge `ensure`. */
async function runningActivity() {
  const id = nextId("act-");
  await adminDb.doc(`stakes/${STAKE_A}/activities/${id}`).set({
    title: `Attività ${id}`,
    activityType: "trip",
    isPublic: true,
    startDate: iso(Date.now() - DAY),
    endDate: iso(Date.now() + DAY),
  });
  return id;
}

const galleryPath = (g) => `stakes/${g.stakeId}/galleries/${g.galleryId}`;
const mediaDocPath = (g, mediaId) => `${galleryPath(g)}/media/${mediaId}`;
const hiddenDocPath = (g, mediaId) => `${galleryPath(g)}/hiddenMedia/${mediaId}`;
const galleriesOf = async (activityId) =>
  (await adminDb.collection(`stakes/${STAKE_A}/galleries`).where("activityId", "==", activityId).get()).size;

/** Galleria aperta con la forma che scrive la callable. */
async function newGallery(stake = STAKE_A) {
  const n = ++seq;
  const g = { stakeId: stake, galleryId: `g${n}-${runId}`, activityId: `act-g${n}-${runId}` };
  const now = Date.now();
  await adminDb.doc(galleryPath(g)).set({
    title: "Galleria di prova",
    description: "",
    activityId: g.activityId,
    createdBy: "seed-uploader",
    createdAt: iso(),
    updatedAt: iso(),
    published: false,
    publishedAt: null,
    coverMediaId: null,
    coverImageUrl: null,
    mediaCount: 0,
    batchSize: 30,
    accessMode: "open",
    likeCount: 0,
    commentsEnabled: false,
    postsCreated: false,
    codeStatus: "missing",
    uploadsClosed: false,
    uploadsWindowSource: "activity",
    uploadsOpenFrom: Timestamp.fromMillis(now - 3 * HOUR),
    uploadsOpenUntil: Timestamp.fromMillis(now + 7 * DAY),
  });
  return g;
}

const folderOf = (g, mediaId) => `protected/stakes/${g.stakeId}/galleries/${g.galleryId}/media/${mediaId}`;
const emulatorUrl = (path) => `http://${STORAGE_HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=tok-${runId}`;

/** Media immagine (25 campi di UploadManagerProvider + createMediaDoc), con il contatore della galleria coerente. */
async function seedMedia(g, mediaId, uploadedBy) {
  const optimized = `${folderOf(g, mediaId)}/optimized-${++seq}-foto.jpg`;
  const thumb = `${folderOf(g, mediaId)}/thumb-${++seq}-foto.jpg`;
  const ts = iso();
  await adminDb.doc(mediaDocPath(g, mediaId)).set({
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
    uploadedBy,
    status: "uploaded",
    createdAt: ts,
    updatedAt: ts,
    likeCount: 0,
  });
  await adminDb.doc(galleryPath(g)).update({ mediaCount: FieldValue.increment(1) });
}

const ensure = (p, activityId, stakeId = STAKE_A) => p.gallery({ action: "ensure", stakeId, activityId });
const report = (p, g, mediaId, reason = "inappropriate") => p.gallery({ action: "report", stakeId: g.stakeId, galleryId: g.galleryId, mediaId, reason });
const restore = (p, g, mediaId) => p.gallery({ action: "restore", stakeId: g.stakeId, galleryId: g.galleryId, mediaId });
const deleteHidden = (p, g, mediaId) => p.gallery({ action: "delete", stakeId: g.stakeId, galleryId: g.galleryId, mediaId });

// Notte dei Record ----------------------------------------------------------
const activityPath = (activityId) => `stakes/${STAKE_A}/activities/${activityId}`;
const entriesRef = (activityId) => adminDb.collection(`${activityPath(activityId)}/recordEntries`);

/** Attività con la Notte dei Record accesa e chiusura fra 48 ore; iscrive (confirmed) le persone date. */
async function nightActivity(people) {
  const activityId = nextId("notte-");
  await adminDb.doc(activityPath(activityId)).set({
    title: "Viaggio al tempio (test)",
    activityType: "trip",
    isPublic: true,
    startDate: iso(Date.now() + 10 * DAY),
    endDate: iso(Date.now() + 12 * DAY),
    recordsEnabled: true,
    recordsCloseAt: iso(Date.now() + 48 * HOUR),
  });
  await Promise.all(people.filter((p) => p.uid).map((p) =>
    adminDb.doc(`${activityPath(activityId)}/registrations/user_${p.uid}`).set({
      userId: p.uid,
      fullName: `Prova ${p.name}`,
      genderRoleCategory: "giovane_uomo",
      registrationStatus: "confirmed",
      unitId: UNIT1.id,
    }),
  ));
  return activityId;
}

/** Record aperto già in elenco (challengerCount 1), con la forma di recordNightAdmin. */
async function seedRecord(activityId, title) {
  const id = nextId("rec-");
  await adminDb.doc(`${activityPath(activityId)}/records/${id}`).set({
    title,
    category: "resistenza",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "",
    challengerCount: 1,
    createdFromEntryId: null,
    status: "open",
    createdAt: iso(),
    updatedAt: iso(),
    createdBy: "seed-staff",
  });
  return id;
}

const N = (p, activityId, action, payload = {}) => p.night({ stakeId: STAKE_A, activityId, action, ...payload });
const proposal = (text, extra = {}) => ({ text, measure: "count_in_time", durationSeconds: 60, needs: "", ...extra });

// ---------------------------------------------------------------------------
// Avvio e chiusura
// ---------------------------------------------------------------------------
const P = {};

before(async () => {
  await Promise.all(Object.values(STAKES).map((stake) =>
    adminDb.doc(`stakes/${stake.id}`).set({ name: stake.name, slug: stake.slug, isActive: true }),
  ));
  await adminDb.doc(`stakes/${STAKE_A}/units/${UNIT1.id}`).set({ name: UNIT1.name, type: "rione", isActive: true, stakeId: STAKE_A });

  // Scaldamento del runtime e del trigger su users: se il trigger esiste, N riceve un pending da togliere.
  const warm = await newPerson({ label: "scaldamento" });
  try {
    await waitFor(() => memberOf(STAKE_A, warm.uid), (data) => data?.status === "pending", "trigger (scaldamento)", 60_000);
  } catch {
    // Trigger assente: N resta senza members da solo.
  }

  const [V, O, Nn, Pp, M, F, FD, X, D, A] = await Promise.all([
    newPerson({ mode: "none", label: "v" }),
    newPerson({ mode: "anonymous", label: "o", member: { status: "active" } }),
    newPerson({ label: "n" }),
    newPerson({ label: "p", member: { status: "pending", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name, sources: [], decidedAt: null, decidedBy: null } }),
    newPerson({ label: "m", member: { status: "active" } }),
    newPerson({ label: "f-removed", member: { status: "removed" } }),
    newPerson({ label: "f-declined", member: { status: "declined", declineCount: 1 } }),
    newPerson({ label: "x", stake: STAKE_B, member: { status: "active" } }),
    newPerson({ label: "d", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id, claimedUnitName: UNIT1.name } }),
    newPerson({ label: "a", role: "admin", unit: null, member: { status: "active", staffRole: "admin" } }),
  ]);
  Object.assign(P, { V, O, N: Nn, P: Pp, M, F, FD, X, D, A });
  await settleAll();
  // Con la history: un `delete()` del solo documento lascerebbe le righe del pending appena tolto.
  await adminDb.recursiveDelete(adminDb.doc(memberPath(STAKE_A, Nn.uid)));
});

after(async () => {
  try {
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE_A}`));
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE_B}`));
    await Promise.all(seededUids.map((uid) => adminDb.doc(`users/${uid}`).delete()));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await adminDb.terminate();
  }
});

const DENIED = () => [P.O, P.N, P.P, P.F, P.FD, P.X];
const MEMBERS = () => [P.M, P.D, P.A];

// ===========================================================================
// Controllo
// ===========================================================================
describe("controllo", () => {
  test("le persone sono seminate come dice il contratto", async () => {
    assert.equal(await memberOf(STAKE_A, P.N.uid), null, "N non ha members");
    assert.equal((await memberOf(STAKE_A, P.P.uid)).status, "pending");
    assert.equal((await memberOf(STAKE_A, P.M.uid)).status, "active");
    assert.equal((await memberOf(STAKE_A, P.F.uid)).status, "removed");
    assert.equal((await memberOf(STAKE_A, P.FD.uid)).status, "declined");
    assert.equal((await memberOf(STAKE_B, P.X.uid)).status, "active");
    assert.equal(await memberOf(STAKE_A, P.X.uid), null);
    assert.equal((await adminData(`users/${P.N.uid}`)).stakeId, STAKE_A, "N ha scelto il palo nel profilo");
  });
});

// ===========================================================================
// activityGallery
// ===========================================================================
describe("activityGallery", () => {
  test("ensure: V unauthenticated; O, N, P, F, X permission-denied e nessuna galleria creata", async () => {
    await expectError(ensure(P.V, await runningActivity()), "unauthenticated");
    for (const person of DENIED()) {
      const activityId = await runningActivity();
      await expectDenied(ensure(person, activityId));
      assert.equal(await galleriesOf(activityId), 0, `${person.name}: galleria creata lo stesso`);
    }
  });

  test("ensure: M, D, A creano la galleria dell'attività in corso", async () => {
    for (const person of MEMBERS()) {
      const activityId = await runningActivity();
      const result = await ensure(person, activityId);
      assert.deepEqual(result, { galleryId: `act_${activityId}`, created: true }, person.name);
      assert.equal(await galleriesOf(activityId), 1);
    }
  });

  test("report: O, N, P, F, X permission-denied e il media resta visibile", async () => {
    const g = await newGallery();
    for (const person of DENIED()) {
      const mediaId = nextId("m-");
      await seedMedia(g, mediaId, P.M.uid);
      await expectDenied(report(person, g, mediaId));
      assert.notEqual(await adminData(mediaDocPath(g, mediaId)), null, `${person.name}: media sparito`);
      assert.equal(await adminData(hiddenDocPath(g, mediaId)), null, `${person.name}: media nascosto`);
    }
    await expectError(report(P.V, g, "m-x"), "unauthenticated");
  });

  test("report: M, D, A nascondono il media (status hidden)", async () => {
    const g = await newGallery();
    for (const person of MEMBERS()) {
      const mediaId = nextId("m-");
      await seedMedia(g, mediaId, "seed-uploader");
      assert.deepEqual(await report(person, g, mediaId), { status: "hidden" }, person.name);
      assert.equal(await adminData(mediaDocPath(g, mediaId)), null);
      assert.equal((await adminData(hiddenDocPath(g, mediaId)))?.hiddenBy, person.uid);
    }
  });

  test("restore e delete restano allo staff: M e gli altri permission-denied, il contenuto nascosto resta", async () => {
    const g = await newGallery();
    const mediaId = nextId("m-");
    await seedMedia(g, mediaId, "seed-uploader");
    await report(P.M, g, mediaId);
    for (const person of [P.M, ...DENIED()]) {
      await expectDenied(restore(person, g, mediaId));
      await expectDenied(deleteHidden(person, g, mediaId));
      assert.notEqual(await adminData(hiddenDocPath(g, mediaId)), null, `${person.name}: contenuto nascosto toccato`);
      assert.equal(await adminData(mediaDocPath(g, mediaId)), null, `${person.name}: media ripristinato`);
    }
    await expectError(restore(P.V, g, mediaId), "unauthenticated");
  });

  test("restore: D e A rimettono il media in galleria", async () => {
    const g = await newGallery();
    for (const person of [P.D, P.A]) {
      const mediaId = nextId("m-");
      await seedMedia(g, mediaId, "seed-uploader");
      await report(P.M, g, mediaId);
      await restore(person, g, mediaId);
      assert.notEqual(await adminData(mediaDocPath(g, mediaId)), null, `${person.name}: media non ripristinato`);
      assert.equal(await adminData(hiddenDocPath(g, mediaId)), null);
    }
  });

  test("delete: D e A cancellano il contenuto nascosto", async () => {
    const g = await newGallery();
    for (const person of [P.D, P.A]) {
      const mediaId = nextId("m-");
      await seedMedia(g, mediaId, "seed-uploader");
      await report(P.M, g, mediaId);
      await deleteHidden(person, g, mediaId);
      assert.equal(await adminData(hiddenDocPath(g, mediaId)), null, `${person.name}: contenuto nascosto ancora lì`);
      assert.equal(await adminData(mediaDocPath(g, mediaId)), null);
    }
  });
});

// ===========================================================================
// recordNightParticipant
// ===========================================================================
describe("recordNightParticipant", () => {
  test("propose: iscritti all'attività ma non membri (O, N, P, F, X) permission-denied, nessun tentativo; V unauthenticated", async () => {
    const act = await nightActivity([...DENIED(), ...MEMBERS()]);
    await expectError(N(P.V, act, "propose", proposal("Visitatore")), "unauthenticated");
    for (const person of DENIED()) {
      await expectDenied(N(person, act, "propose", proposal(`Proposta di ${person.name}`)));
    }
    assert.equal((await entriesRef(act).get()).size, 0, "nessun tentativo scritto");
  });

  test("propose: M, D, A iscritti propongono", async () => {
    const act = await nightActivity(MEMBERS());
    for (const person of MEMBERS()) {
      const result = await N(person, act, "propose", proposal(`Proposta di ${person.name}`));
      assert.equal(result.action, "propose", person.name);
      assert.equal(result.entry.status, "pending");
      assert.equal(result.entry.ownerUid, person.uid);
    }
    assert.equal((await entriesRef(act).get()).size, 3);
  });

  test("challenge: O, N, P, F, X permission-denied; M, D, A sfidano", async () => {
    const act = await nightActivity([...DENIED(), ...MEMBERS()]);
    const recordId = await seedRecord(act, "Salti a piedi uniti in 60 secondi");
    for (const person of DENIED()) await expectDenied(N(person, act, "challenge", { recordId }));
    assert.equal((await entriesRef(act).get()).size, 0);
    for (const person of MEMBERS()) {
      const result = await N(person, act, "challenge", { recordId });
      assert.equal(result.entry.kind, "challenge", person.name);
      assert.equal(result.entry.recordId, recordId);
    }
  });

  test("context resta com'è: le proprie iscrizioni, anche per chi non è membro", async () => {
    const act = await nightActivity([P.N, P.P, P.F, P.X, P.M]);
    for (const person of [P.N, P.P, P.F, P.X, P.M]) {
      const result = await N(person, act, "context");
      assert.ok(result && typeof result === "object", `${person.name}: context non risponde`);
    }
  });

  test("S2-2: chi ha proposto da membro e poi è uscito dal palo (withdrawn, removed) ritira, modifica e ripristina i propri tentativi, ma non propone né sfida", async () => {
    for (const exitStatus of ["withdrawn", "removed"]) {
      const [who] = [await newPerson({ label: `uscito-${exitStatus}`, member: { status: "active" } })];
      await settleAll();
      const act = await nightActivity([who]);
      const recordId = await seedRecord(act, `Record ${exitStatus}`);
      const proposed = await N(who, act, "propose", proposal("Prima dell'uscita"));
      const entryId = proposed.entry.id;

      // Esce dal palo (stato scritto dal server; qui con l'Admin SDK, che non fa partire il trigger).
      await adminDb.doc(memberPath(STAKE_A, who.uid)).update({ status: exitStatus, version: FieldValue.increment(1) });

      const edited = await N(who, act, "edit", { entryId, ...proposal("Testo corretto dopo l'uscita") });
      assert.equal(edited.entry.proposedText, "Testo corretto dopo l'uscita", exitStatus);
      const withdrawn = await N(who, act, "withdraw", { entryId });
      assert.equal(withdrawn.entry.status, "withdrawn", exitStatus);
      const restored = await N(who, act, "restore", { entryId });
      assert.equal(restored.entry.status, "pending", exitStatus);

      await expectDenied(N(who, act, "propose", proposal("Dopo l'uscita")));
      await expectDenied(N(who, act, "challenge", { recordId }));
      assert.equal((await entriesRef(act).get()).size, 1, `${exitStatus}: un solo tentativo, quello di prima`);
    }
  });
});
