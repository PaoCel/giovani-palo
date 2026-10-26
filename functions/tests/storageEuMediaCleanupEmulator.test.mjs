// Independent transition acceptance: real Auth/Firestore/Storage emulators.
// Lifecycle handlers receive two isolated demo buckets; .run checks exercise
// the callable handler with its own runtime bucket, without Eventarc racing
// intentionally seeded pending states. HTTP regression is a separate suite.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInAnonymously } from "firebase/auth";
import { getFirestore as clientFirestore, connectFirestoreEmulator, doc, collection, getDocFromServer, getDocsFromServer, setDoc, deleteDoc, terminate } from "firebase/firestore";
import { getStorage as clientStorage, connectStorageEmulator, ref, uploadBytes, getBytes, deleteObject, updateMetadata } from "firebase/storage";
const projectId = process.env.GCLOUD_PROJECT || "";
assert.match(projectId, /^demo-[a-z0-9-]+$/u);
const hosts = {};
for (const key of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) {
  const host = process.env[key] || "";
  assert.match(host, /^(127\.0\.0\.1|localhost):[1-9]\d{0,4}$/u, `${key}: local emulator required`);
  assert.ok(Number(host.split(":")[1]) <= 65535); hosts[key] = host;
}
const require = createRequire(import.meta.url);
const { initializeApp: adminInitializeApp, deleteApp: adminDeleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth: adminAuth } = require("firebase-admin/auth");
const runId = randomUUID().slice(0, 10);
// Exercise a configured EU-like bucket, not the emulator's historical default.
const PRIMARY = `${projectId}-${runId}-eu`, SECONDARY = `${projectId}-${runId}-legacy`;
const app = adminInitializeApp({ projectId, storageBucket: PRIMARY });
const db = getFirestore(app), storage = getStorage(app), auth = adminAuth(app);
const { createGalleryMediaStorage } = require("../lib/galleryMediaStorage.js");
const { activityGallery, processMediaLifecycle, handleVisibleMediaDeleted } = require("../lib/activityGallery.js");
const { cleanupDeletedUserMemberships } = require("../lib/stakeMembershipCleanup.js");
const mediaStorage = createGalleryMediaStorage({ storage, bucketNames: [PRIMARY, SECONDARY] });
const stakeId = `eu-transition-${runId}`, otherStake = `${stakeId}-other`;
const clients = {};
let sequence = 0;
async function actor(name, { role = "participant", anonymous = false, stake = stakeId, status = "active" } = {}) {
  const clientApp = initializeApp({ apiKey: "demo-key", projectId }, `${name}-${runId}`);
  const clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${hosts.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  if (anonymous) await signInAnonymously(clientAuth);
  else await createUserWithEmailAndPassword(clientAuth, `${name}-${runId}@example.invalid`, "only-emulator-password123");
  const uid = clientAuth.currentUser.uid;
  const fs = clientFirestore(clientApp);
  const [host, port] = hosts.FIRESTORE_EMULATOR_HOST.split(":"); connectFirestoreEmulator(fs, host, Number(port));
  const files = clientStorage(clientApp, `gs://${PRIMARY}`);
  const [storageHost, storagePort] = hosts.FIREBASE_STORAGE_EMULATOR_HOST.split(":"); connectStorageEmulator(files, storageHost, Number(storagePort));
  await db.doc(`users/${uid}`).set({ role, stakeId: stake });
  await db.doc(`stakes/${stake}/members/${uid}`).set({ status, staffRole: role === "admin" ? role : null });
  return { app: clientApp, uid, fs, files, provider: anonymous ? "anonymous" : "password" };
}
const invoke = (actor, action, fixture, extra = {}) => activityGallery.run({ auth: actor ? { uid: actor.uid, token: { firebase: { sign_in_provider: actor.provider } } } : undefined,
  data: { action, stakeId, galleryId: fixture.galleryId, mediaId: fixture.mediaId, ...extra } });
async function fixture({ hidden = true, operation = "hide", status = "pending", marker = true } = {}) {
  const galleryId = `gallery-${++sequence}-${runId}`, mediaId = "photo";
  const gallery = db.doc(`stakes/${stakeId}/galleries/${galleryId}`);
  const prefix = `protected/stakes/${stakeId}/galleries/${galleryId}/media/${mediaId}/`;
  const paths = [`${prefix}image.jpg`, `${prefix}thumbnail.jpg`, `${prefix}original.jpg`, `${prefix}poster.jpg`, `${prefix}clip.mp4`];
  const sibling = `${prefix.slice(0, -1)}-sibling/image.jpg`;
  const pdf = `protected/stakes/${stakeId}/activities/a/parent-authorization-pdfs/r/retained-${sequence}.pdf`;
  const oldToken = `old-${randomUUID()}`;
  const url = (bucket, path) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${oldToken}`;
  const media = { uploadedBy: clients.member.uid, storagePath: paths[0], storageUrl: url(PRIMARY, paths[0]), optimizedPath: paths[0], optimizedUrl: url(PRIMARY, paths[0]),
    thumbnailPath: paths[1], thumbnailUrl: url(SECONDARY, paths[1]), originalPath: paths[2], originalUrl: url(PRIMARY, paths[2]), posterPath: paths[3], posterUrl: url(SECONDARY, paths[3]), createdAt: new Date().toISOString() };
  await gallery.set({ mediaCount: hidden ? 0 : 1, createdBy: clients.admin.uid, activityId: "a", title: "Synthetic gallery" });
  const mediaRef = gallery.collection("media").doc(mediaId), hiddenRef = gallery.collection("hiddenMedia").doc(mediaId), lifecycle = gallery.collection("mediaLifecycle").doc(mediaId);
  await (hidden ? hiddenRef : mediaRef).set(hidden ? { ...media, hiddenAt: new Date().toISOString(), hiddenBy: clients.admin.uid, hiddenReason: "inappropriate" } : media);
  if (marker) await lifecycle.set({ operation, status, ...(operation === "hide" ? { rotationSeed: `generation-${galleryId}` } : {}), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  for (const name of [PRIMARY, SECONDARY]) for (const path of [...paths, sibling, pdf]) await storage.bucket(name).file(path).save(Buffer.from("synthetic-file"), {
    contentType: "image/jpeg", metadata: { metadata: { firebaseStorageDownloadTokens: oldToken, uploadedBy: clients.member.uid, sentinel: "preserve" } },
  });
  return { galleryId, mediaId, gallery, mediaRef, hiddenRef, lifecycle, paths, prefix, sibling, pdf, oldToken, media, ids: { stakeId, galleryId, mediaId } };
}
const exists = async (bucket, path) => (await storage.bucket(bucket).file(path).exists())[0];
const token = value => new URL(value).searchParams.get("token");
const metadata = async (bucket, path) => (await storage.bucket(bucket).file(path).getMetadata())[0].metadata;
const assertDenied = promise => assert.rejects(promise, error => { assert.equal(error.code, "permission-denied"); return true; });

before(async () => {
  await db.doc(`stakes/${stakeId}`).set({ name: "Synthetic EU transition" }); await db.doc(`stakes/${otherStake}`).set({ name: "Synthetic other stake" });
  clients.admin = await actor("admin", { role: "admin" }); clients.member = await actor("member");
  clients.outside = await actor("outside", { role: "admin", stake: otherStake }); clients.anonymous = await actor("anonymous", { anonymous: true });
  clients.revoked = await actor("revoked", { status: "removed" });
  for (const role of ["admin", "super_admin", "unit_leader"]) clients[`legacy-${role}`] = await actor(`legacy-${role}`, { role, status: "removed" });
});
after(async () => {
  await db.recursiveDelete(db.doc(`stakes/${stakeId}`)); await db.recursiveDelete(db.doc(`stakes/${otherStake}`));
  for (const bucket of [PRIMARY, SECONDARY]) await storage.bucket(bucket).deleteFiles({ prefix: `protected/stakes/${stakeId}/` });
  for (const c of Object.values(clients)) { await auth.deleteUser(c.uid); await db.doc(`users/${c.uid}`).delete(); await terminate(c.fs); await deleteApp(c.app); }
  await adminDeleteApp(app);
});

test("hide pending ruota entrambe le copie e aggiorna gli URL del rispettivo bucket", async () => {
  const f = await fixture(); await processMediaLifecycle(db, f.ids, mediaStorage);
  assert.equal((await f.lifecycle.get()).get("status"), "complete");
  const hidden = (await f.hiddenRef.get()).data();
  for (const [field, bucket, path] of [["storageUrl", PRIMARY, f.paths[0]], ["thumbnailUrl", SECONDARY, f.paths[1]], ["originalUrl", PRIMARY, f.paths[2]], ["posterUrl", SECONDARY, f.paths[3]]]) {
    const fresh = token(hidden[field]); assert.notEqual(fresh, f.oldToken);
    assert.ok((await metadata(bucket, path)).firebaseStorageDownloadTokens.split(",").includes(fresh));
    assert.equal(new URL(hidden[field]).pathname.includes(`/b/${bucket}/`), true);
  }
  for (const path of f.paths) {
    const a = (await metadata(PRIMARY, path)).firebaseStorageDownloadTokens.split(",").at(-1);
    const b = (await metadata(SECONDARY, path)).firebaseStorageDownloadTokens.split(",").at(-1);
    assert.equal(a, b); assert.notEqual(a, f.oldToken);
  }
  assert.equal((await metadata(PRIMARY, f.sibling)).firebaseStorageDownloadTokens, f.oldToken);
  assert.equal((await metadata(SECONDARY, f.pdf)).sentinel, "preserve");
});
test("eventi complete e retry non ruotano nuovamente né modificano il media", async () => {
  const f = await fixture(); await processMediaLifecycle(db, f.ids, mediaStorage);
  const before = (await f.hiddenRef.get()).data();
  await processMediaLifecycle(db, f.ids, { revokeMedia() { throw new Error("must-not-run"); }, deleteMedia() { throw new Error("must-not-run"); } });
  assert.deepEqual((await f.hiddenRef.get()).data(), before);
});
test("fallimento parziale resta pending e retry completa senza ripubblicare", async () => {
  const f = await fixture();
  const firstOnly = createGalleryMediaStorage({ storage, bucketNames: [PRIMARY] });
  await assert.rejects(processMediaLifecycle(db, f.ids, { async revokeMedia(ids) { await firstOnly.revokeMedia(ids); throw Object.assign(new Error("synthetic-secondary-failure"), { code: "storage-cleanup-incomplete", retryable: true }); } }));
  assert.equal((await f.lifecycle.get()).get("status"), "pending"); assert.equal((await f.mediaRef.get()).exists, false);
  await processMediaLifecycle(db, f.ids, mediaStorage);
  assert.equal((await f.lifecycle.get()).get("status"), "complete");
  const hidden = (await f.hiddenRef.get()).data(); assert.notEqual(token(hidden.storageUrl), f.oldToken);
});
test("delete pending cancella varianti e orfani di sottocollection in entrambi i bucket", async () => {
  const f = await fixture({ operation: "delete" });
  await f.mediaRef.collection("comments").doc("orphan").set({ body: "synthetic" }); await f.mediaRef.collection("likes").doc("orphan").set({ uid: clients.member.uid });
  await processMediaLifecycle(db, f.ids, mediaStorage);
  assert.equal((await f.hiddenRef.get()).exists, false); assert.equal((await f.lifecycle.get()).get("status"), "complete");
  assert.equal((await f.mediaRef.collection("comments").get()).empty, true); assert.equal((await f.mediaRef.collection("likes").get()).empty, true);
  for (const bucket of [PRIMARY, SECONDARY]) {
    for (const path of f.paths) assert.equal(await exists(bucket, path), false);
    assert.equal(await exists(bucket, f.sibling), true); assert.equal(await exists(bucket, f.pdf), true);
  }
  await processMediaLifecycle(db, f.ids, mediaStorage);
});
test("delete parziale mantiene hidden e pending; retry completa la replica residua", async () => {
  const f = await fixture({ operation: "delete" });
  await assert.rejects(processMediaLifecycle(db, f.ids, { async deleteMedia(ids) { await createGalleryMediaStorage({ storage, bucketNames: [PRIMARY] }).deleteMedia(ids); throw new Error("synthetic-secondary-failure"); } }));
  assert.equal((await f.hiddenRef.get()).exists, true); assert.equal((await f.lifecycle.get()).get("status"), "pending");
  assert.equal(await exists(PRIMARY, f.paths[0]), false); assert.equal(await exists(SECONDARY, f.paths[0]), true);
  await processMediaLifecycle(db, f.ids, mediaStorage);
  assert.equal((await f.hiddenRef.get()).exists, false); assert.equal(await exists(SECONDARY, f.paths[0]), false);
});
test("delete visibile reale crea tombstone e ripulisce entrambe le copie", async () => {
  const f = await fixture({ hidden: false, marker: false }); await f.mediaRef.delete();
  await handleVisibleMediaDeleted(db, f.ids, mediaStorage);
  assert.equal((await f.lifecycle.get()).get("operation"), "delete"); assert.equal((await f.lifecycle.get()).get("status"), "complete");
  for (const bucket of [PRIMARY, SECONDARY]) assert.equal(await exists(bucket, f.paths[0]), false);
  await handleVisibleMediaDeleted(db, f.ids, mediaStorage);
});
test("evento delete da report non cancella il contenuto hidden", async () => {
  const f = await fixture(); await handleVisibleMediaDeleted(db, f.ids, mediaStorage);
  assert.equal((await f.lifecycle.get()).get("operation"), "hide");
  assert.equal((await f.hiddenRef.get()).exists, true); assert.equal(await exists(PRIMARY, f.paths[0]), true);
});
test("evento delete tardivo dopo restore non cancella il media ricreato", async () => {
  const f = await fixture({ hidden: false, status: "complete" });
  await handleVisibleMediaDeleted(db, f.ids, mediaStorage);
  assert.equal((await f.mediaRef.get()).exists, true); assert.equal((await f.lifecycle.get()).get("operation"), "hide");
  assert.equal(await exists(SECONDARY, f.paths[0]), true);
});
test("restore completato conserva token nuovi; una nuova segnalazione cambia seed", async () => {
  const f = await fixture(); await processMediaLifecycle(db, f.ids, mediaStorage);
  const seed = (await f.lifecycle.get()).get("rotationSeed"), fresh = (await f.hiddenRef.get()).get("storageUrl");
  assert.equal((await invoke(clients.admin, "restore", f)).status, "restored");
  assert.equal((await f.mediaRef.get()).get("storageUrl"), fresh);
  await invoke(clients.member, "report", f, { reason: "inappropriate" });
  assert.notEqual((await f.lifecycle.get()).get("rotationSeed"), seed);
});
test("legacy hidden senza marker viene revocato prima del restore", async () => {
  const f = await fixture({ marker: false });
  await invoke(clients.admin, "restore", f);
  assert.notEqual(token((await f.mediaRef.get()).get("storageUrl")), f.oldToken);
  assert.equal((await f.lifecycle.get()).get("operation"), "hide"); assert.equal((await f.lifecycle.get()).get("status"), "complete");
});
test("delete irreversibile pending impedisce il restore", async () => {
  const f = await fixture({ operation: "delete" });
  await assert.rejects(invoke(clients.admin, "restore", f), error => { assert.equal(error.code, "failed-precondition"); return true; });
  assert.equal((await f.mediaRef.get()).exists, false); assert.equal((await f.lifecycle.get()).get("operation"), "delete");
});
test("restore concorrente non pubblica il media finché la revoca ha il lock", { timeout: 30000 }, async () => {
  const f = await fixture(); let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const processing = processMediaLifecycle(db, f.ids, { async revokeMedia(ids) { entered(); await barrier; return mediaStorage.revokeMedia(ids); } });
  await started;
  let restored = false;
  const restoring = invoke(clients.admin, "restore", f).then(result => { restored = true; return result; });
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(restored, false, "restore must wait for the in-flight revocation");
  } finally { release(); }
  await processing; await restoring;
  assert.equal((await f.mediaRef.get()).exists, true);
  assert.notEqual(token((await f.mediaRef.get()).get("storageUrl")), f.oldToken);
});
test("due processori concorrenti completano lo stesso pending in modo idempotente", async () => {
  const f = await fixture();
  await Promise.all([processMediaLifecycle(db, f.ids, mediaStorage), processMediaLifecycle(db, f.ids, mediaStorage)]);
  assert.equal((await f.lifecycle.get()).get("status"), "complete");
  const fresh = token((await f.hiddenRef.get()).get("storageUrl"));
  for (const bucket of [PRIMARY, SECONDARY]) assert.ok((await metadata(bucket, f.paths[0])).firebaseStorageDownloadTokens.split(",").includes(fresh));
});
test("worker hide ritardato: protocollo CAS reale e fencing quando l'emulatore lo applica", async () => {
  const f = await fixture(); let entered, release, delayed = false;
  const control = storage.bucket(PRIMARY).file(f.paths[4]);
  const [controlMeta] = await control.getMetadata(); let casEnforced = false;
  try {
    await control.setMetadata({ metadata: { casControl: "must-not-write-with-invalid-precondition" } }, {
      ifGenerationMatch: controlMeta.generation, ifMetagenerationMatch: String(Number(controlMeta.metageneration) + 99999),
    });
  } catch (error) { assert.equal(Number(error.code), 412); casEnforced = true; }
  console.log(`STORAGE_EMULATOR_METADATA_CAS_ENFORCED=${casEnforced}`);
  let delayedOptions;
  const started = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const delayedStorage = { bucket(name) {
    const bucket = storage.bucket(name);
    return { name, async getFiles(options) {
      const [files] = await bucket.getFiles(options);
      return [files.map(file => ({ name: file.name, getMetadata: () => file.getMetadata(), async setMetadata(...args) {
        if (name === PRIMARY && file.name === f.paths[0] && !delayed) { delayed = true; delayedOptions = args[1]; entered(); await barrier; }
        return file.setMetadata(...args);
      } }))];
    } };
  } };
  const old = createGalleryMediaStorage({ storage: delayedStorage, bucketNames: [PRIMARY, SECONDARY] });
  const oldSeed = (await f.lifecycle.get()).get("rotationSeed");
  const stale = old.revokeMedia({ ...f.ids, rotationSeed: oldSeed, isCurrent: async () => (await f.lifecycle.get()).get("rotationSeed") === oldSeed });
  const rejected = assert.rejects(stale, error => { assert.equal(error.code, "storage-cleanup-incomplete"); return true; });
  await started;
  try {
    await f.lifecycle.update({ rotationSeed: "newer-generation" });
    await processMediaLifecycle(db, f.ids, mediaStorage);
  } finally { release(); }
  const fresh = token((await f.hiddenRef.get()).get("storageUrl"));
  await rejected;
  assert.ok(delayedOptions?.ifGenerationMatch != null, "worker sends the object generation precondition");
  assert.ok(delayedOptions?.ifMetagenerationMatch != null, "worker sends the metadata generation precondition");
  if (casEnforced) for (const bucket of [PRIMARY, SECONDARY]) assert.equal((await metadata(bucket, f.paths[0])).firebaseStorageDownloadTokens.split(",").at(-1), fresh);
  // The independent pure test always verifies the delayed race using exact
  // GCS CAS semantics. An emulator that accepts an intentionally impossible
  // precondition cannot prove server-side CAS; report that capability above.
});
for (const name of ["outside", "anonymous", "revoked"]) test(`${name}: report/restore/delete negati senza cambiare marker o copie`, async () => {
  const f = await fixture();
  for (const action of ["report", "restore", "delete"]) await assertDenied(invoke(clients[name], action, f, { reason: "inappropriate" }));
  assert.equal((await f.lifecycle.get()).get("status"), "pending"); assert.equal(await exists(PRIMARY, f.paths[0]), true); assert.equal(await exists(SECONDARY, f.paths[0]), true);
});
test("partecipante non può ripristinare né cancellare definitivamente", async () => {
  const f = await fixture(); for (const action of ["restore", "delete"]) await assertDenied(invoke(clients.member, action, f));
});
test("lifecycle non leggibile, elencabile o scrivibile via SDK nemmeno da admin", async () => {
  const f = await fixture(); const base = `stakes/${stakeId}/galleries/${f.galleryId}/mediaLifecycle`;
  for (const name of ["admin", "member", "outside", "anonymous"]) {
    const clientRef = doc(clients[name].fs, `${base}/${f.mediaId}`);
    await assertDenied(getDocFromServer(clientRef)); await assertDenied(getDocsFromServer(collection(clients[name].fs, base)));
    await assertDenied(setDoc(clientRef, { operation: "delete", status: "complete" })); await assertDenied(deleteDoc(clientRef));
  }
});
test("SDK non ricrea un ID con lifecycle hide o delete; controllo positivo senza marker", async () => {
  const f = await fixture();
  const payload = { ...f.media };
  const clientPath = id => doc(clients.admin.fs, `stakes/${stakeId}/galleries/${f.galleryId}/media/${id}`);
  await setDoc(clientPath("fresh-without-marker"), payload);
  assert.equal((await getDocFromServer(clientPath("fresh-without-marker"))).exists(), true);
  for (const operation of ["hide", "delete"]) for (const status of ["pending", "complete"]) {
    await f.lifecycle.set({ operation, status });
    await assertDenied(setDoc(clientPath(f.mediaId), payload));
    assert.equal((await f.mediaRef.get()).exists, false);
  }
});
test("cleanup account membership-only preserva lifecycle, file e PDF trattenuti", async () => {
  const f = await fixture(); const uid = `deleted-${runId}`;
  await db.doc(`stakes/${stakeId}/members/${uid}`).set({ status: "active" });
  await cleanupDeletedUserMemberships({ db, auth, uid, dryRun: false, expectedMemberships: 1 });
  assert.equal((await db.doc(`stakes/${stakeId}/members/${uid}`).get()).exists, false);
  assert.equal((await f.lifecycle.get()).get("status"), "pending");
  for (const bucket of [PRIMARY, SECONDARY]) { assert.equal(await exists(bucket, f.pdf), true); assert.equal(await exists(bucket, f.paths[0]), true); }
});
const upload = (who, path) => uploadBytes(ref(who.files, path), new Uint8Array([255, 216, 255, 224]), { contentType: "image/jpeg", customMetadata: { uploadedBy: who.uid } });
const storageDenied = promise => assert.rejects(promise, error => { assert.equal(error.code, "storage/unauthorized"); return true; });
test("Storage SDK: membro attivo carica sul nuovo ID senza marker (controllo positivo)", async () => {
  const f = await fixture({ hidden: false, marker: false });
  await upload(clients.member, `${f.prefix}fresh-upload.jpg`);
  assert.equal(await exists(PRIMARY, `${f.prefix}fresh-upload.jpg`), true);
});
test("Storage SDK: admin attivo conserva update metadata senza marker", async () => {
  const f = await fixture({ hidden: false, marker: false });
  await updateMetadata(ref(clients.admin.files, f.paths[0]), { customMetadata: { sentinel: "updated-by-admin" } });
  assert.equal((await metadata(PRIMARY, f.paths[0])).sentinel, "updated-by-admin");
});
test("Storage SDK: admin attivo conserva overwrite esistente, gli altri utenti no", async () => {
  const f = await fixture({ hidden: false, marker: false });
  await storageDenied(upload(clients.member, f.paths[0]));
  await upload(clients.admin, f.paths[0]);
  assert.deepEqual([...new Uint8Array(await getBytes(ref(clients.admin.files, f.paths[0])))], [255, 216, 255, 224]);
});
for (const role of ["admin", "super_admin", "unit_leader"]) test(`Storage SDK: ${role} legacy legge e modera ma non carica senza membership attiva`, async () => {
  const f = await fixture({ hidden: false, marker: false }); const who = clients[`legacy-${role}`];
  assert.ok((await getBytes(ref(who.files, f.paths[0]))).byteLength > 0);
  await storageDenied(upload(who, `${f.prefix}legacy-new.jpg`));
  await deleteObject(ref(who.files, f.paths[1])); assert.equal(await exists(PRIMARY, f.paths[1]), false);
});
test("Storage SDK: marker hide/delete pending/complete impedisce nuove varianti anche ad admin attivo", async () => {
  const f = await fixture();
  for (const operation of ["hide", "delete"]) for (const status of ["pending", "complete"]) {
    await f.lifecycle.set({ operation, status });
    await storageDenied(upload(clients.admin, `${f.prefix}${operation}-${status}.jpg`));
    await storageDenied(updateMetadata(ref(clients.admin.files, f.paths[0]), { customMetadata: { sentinel: "must-not-overwrite" } }));
  }
  assert.equal((await metadata(PRIMARY, f.paths[0])).sentinel, "preserve");
});
test("parent authorization: legge PDF copiato e genera nuovi PDF nel bucket configurato EU", async () => {
  const f = await fixture();
  const copiedPdf = `${f.pdf}-copied.pdf`, copiedBytes = Buffer.from("%PDF-1.4 synthetic copied consent");
  await storage.bucket(SECONDARY).file(copiedPdf).save(copiedBytes, { contentType: "application/pdf" });
  await storage.bucket(SECONDARY).file(copiedPdf).copy(storage.bucket(PRIMARY).file(copiedPdf));
  assert.deepEqual(Buffer.from(await getBytes(ref(clients.admin.files, copiedPdf))), copiedBytes);
  await storageDenied(getBytes(ref(clients.member.files, copiedPdf)));
  const { parentAuthorizationConfirm } = require("../lib/parentAuthorization.js");
  const { PARENT_CONSENT_CHECKBOXES } = require("../lib/legalDocs.js");
  const { PNG } = require("pngjs");
  const png = new PNG({ width: 160, height: 60 });
  for (let x = 10; x < 150; x++) for (const y of [20 + Math.round(10 * Math.sin(x / 9)), 21 + Math.round(10 * Math.sin(x / 9))]) {
    const offset = (png.width * y + x) << 2; png.data[offset] = 10; png.data[offset + 1] = 10; png.data[offset + 2] = 40; png.data[offset + 3] = 255;
  }
  const activity = db.doc(`stakes/${stakeId}/activities/pdf-flow`), registration = activity.collection("registrations").doc("signed");
  const rawToken = `${randomUUID()}-${randomUUID()}`, tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenRef = db.doc(`parentAuthorizationTokens/${tokenHash}`);
  await activity.set({ title: "Synthetic parent PDF", startDate: "2027-11-16T14:00:00.000Z", status: "registrations_open", requiresParentAuthorization: true });
  await registration.set({ fullName: "Synthetic minor", birthDate: "2012-02-26", genderRoleCategory: "giovane_donna", registrationStatus: "submitted",
    parentAuthorization: { status: "email_sent", tokenId: tokenHash, parentFirstName: "Synthetic", parentLastName: "Parent", parentEmail: `pdf-${runId}@example.invalid`, parentPhone: "3330000000" } });
  await tokenRef.set({ id: tokenHash, tokenHash, stakeId, activityId: activity.id, registrationId: registration.id, parentEmail: `pdf-${runId}@example.invalid`,
    participantName: "Synthetic minor", activityTitle: "Synthetic parent PDF", status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() });
  try {
    const result = await parentAuthorizationConfirm.run({ data: { token: rawToken, consents: Object.fromEntries(PARENT_CONSENT_CHECKBOXES.map(item => [item.key, true])),
      signatureDataUrl: `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`, photoConsent: "accepted", socialPublicationConsent: "refused" }, rawRequest: { headers: {} } });
    assert.equal(result.ok, true);
    const state = (await registration.get()).get("parentAuthorization");
    assert.equal(state.status, "authorized");
    assert.equal(storage.bucket().name, PRIMARY); assert.notEqual(PRIMARY, `${projectId}.appspot.com`);
    for (const field of ["pdfPath", "conductPdfPath", "auditPdfPath"]) {
      assert.ok(state[field], `new ${field} must exist, rather than a swallowed PDF error`);
      const bytes = await getBytes(ref(clients.admin.files, state[field]));
      assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF");
      assert.equal(await exists(SECONDARY, state[field]), false);
    }
    assert.equal(await exists(PRIMARY, state.signaturePath), true);
  } finally {
    await tokenRef.delete();
    await db.doc(`parentAuthorizationSignatureCache/${createHash("sha256").update(`pdf-${runId}@example.invalid`).digest("hex")}`).delete();
  }
});
test("CLI sync: dest-only tombstone, dry-run read-only, budget, verify e retry idempotente", { timeout: 60000 }, async () => {
  const from = `${projectId}-${runId}-sync-from`, to = `${projectId}-${runId}-sync-to`;
  const object = `protected/stakes/${stakeId}/galleries/migration/media/dest-only/photo.jpg`;
  const both = `protected/stakes/${stakeId}/galleries/migration/media/both/photo.jpg`;
  const retained = `protected/stakes/${stakeId}/activities/a/parent-authorization-pdfs/r/sentinel.pdf`;
  const directory = mkdtempSync(join(tmpdir(), "eu-tombstone-")), checkpoint = join(directory, "not-created", "checkpoint.jsonl");
  const cli = fileURLToPath(new URL("../../tools/migrate-storage-bucket.mjs", import.meta.url));
  const run = args => {
    const result = spawnSync(process.execPath, [cli, "--project", projectId, "--from", from, "--to", to, "--checkpoint", checkpoint, ...args], { env: process.env, encoding: "utf8", timeout: 20000 });
    assert.equal(result.error, undefined); return { code: result.status, output: `${result.stdout}${result.stderr}` };
  };
  try {
    for (const bucket of [from, to]) await storage.bucket(bucket).file(retained).save(Buffer.from("%PDF-1.4 retained"));
    await storage.bucket(to).file(object).save(Buffer.from("deleted-dest-only"));
    await db.doc(`stakes/${stakeId}/galleries/migration/mediaLifecycle/dest-only`).set({ operation: "delete", status: "pending" });
    const dry = run(["--phase", "sync"]);
    assert.equal(dry.code, 0, dry.output); assert.match(dry.output, /"mediaDeleted":1/u); assert.match(dry.output, /"tombstoneDestDeletes":1/u);
    assert.equal(existsSync(checkpoint), false); assert.equal(await exists(to, object), true);
    const budget = run(["--phase", "sync", "--apply", "--max-deletes", "0"]);
    assert.notEqual(budget.code, 0); assert.equal(await exists(to, object), true);
    const applied = run(["--phase", "sync", "--apply", "--max-deletes", "1"]);
    assert.equal(applied.code, 0, applied.output); assert.equal(await exists(to, object), false);
    for (const bucket of [from, to]) await storage.bucket(bucket).file(both).save(Buffer.from("deleted-both"));
    await db.doc(`stakes/${stakeId}/galleries/migration/mediaLifecycle/both`).set({ operation: "delete", status: "complete" });
    const verify = run(["--phase", "verify"]);
    assert.notEqual(verify.code, 0); assert.doesNotMatch(verify.output, /VERIFY_OK/u); assert.match(verify.output, /deletedMediaObjects/u);
    const removed = run(["--phase", "sync", "--apply", "--max-deletes", "1"]);
    assert.equal(removed.code, 0, removed.output);
    for (const bucket of [from, to]) { assert.equal(await exists(bucket, both), false); assert.equal(await exists(bucket, retained), true); }
    const retry = run(["--phase", "sync", "--apply", "--max-deletes", "0"]);
    assert.equal(retry.code, 0, retry.output);
  } finally {
    for (const bucket of [from, to]) await storage.bucket(bucket).deleteFiles({ prefix: `protected/stakes/${stakeId}/` });
    rmSync(directory, { recursive: true, force: true });
  }
});
test("CLI protocollo: rewrite applicata ma risposta 503 non viene ritentata dopo delete", { timeout: 30000 }, async () => {
  const from = `${projectId}-${runId}-lost-from`, to = `${projectId}-${runId}-lost-to`;
  const object = `protected/stakes/${stakeId}/galleries/lost-response/media/deleted/photo.jpg`;
  const lifecycle = db.doc(`stakes/${stakeId}/galleries/lost-response/mediaLifecycle/deleted`);
  const directory = mkdtempSync(join(tmpdir(), "eu-response-lost-"));
  await storage.bucket(from).file(object).save(Buffer.from("synthetic-copy-response-lost"));
  let mutations = 0, injected = false; const proxyErrors = [];
  const proxy = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const headers = { ...request.headers }; delete headers.host; delete headers["content-length"];
      const body = Buffer.concat(chunks);
      const upstream = await fetch(`http://${hosts.FIREBASE_STORAGE_EMULATOR_HOST}${request.url}`, { method: request.method, headers,
        ...(body.length ? { body } : {}) });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (request.method === "POST" && request.url.includes("/rewriteTo/")) {
        mutations++;
        if (!injected && upstream.ok) {
          injected = true;
          assert.equal(await exists(to, object), true, "first rewrite really applied before the response was lost");
          await lifecycle.set({ operation: "delete", status: "pending" });
          response.writeHead(503, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "synthetic-response-lost" } })); return;
        }
      }
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" }); response.end(bytes);
    } catch (error) { proxyErrors.push(error); response.writeHead(500); response.end("synthetic-proxy-error"); }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  try {
    const cli = fileURLToPath(new URL("../../tools/migrate-storage-bucket.mjs", import.meta.url));
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "--project", projectId, "--from", from, "--to", to, "--phase", "sync", "--apply", "--checkpoint", join(directory, "checkpoint.jsonl")], {
        env: { ...process.env, FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${proxy.address().port}` }, stdio: ["ignore", "pipe", "pipe"],
      });
      const deadline = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("synthetic CLI protocol deadline")); }, 20000);
      let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
      child.once("error", error => { clearTimeout(deadline); reject(error); }); child.once("close", code => { clearTimeout(deadline); resolve({ code, output }); });
    });
    assert.deepEqual(proxyErrors, []); assert.equal(injected, true); assert.equal(result.code, 0, result.output);
    assert.equal(mutations, 1, "no second POST after the tombstone, even though the transport received 503");
    assert.equal(await exists(from, object), false); assert.equal(await exists(to, object), false);
  } finally {
    await new Promise(resolve => proxy.close(resolve));
    for (const bucket of [from, to]) await storage.bucket(bucket).deleteFiles({ prefix: `protected/stakes/${stakeId}/` });
    rmSync(directory, { recursive: true, force: true });
  }
});
