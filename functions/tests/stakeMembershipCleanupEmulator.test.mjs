// Contratto cleanup S2: dati sintetici su Auth + Firestore emulator, mai produzione.
// Avviare emulatori QA dedicati e passare GCLOUD_PROJECT=demo-*,
// FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST su loopback.
// node --test --test-concurrency=1 functions/tests/stakeMembershipCleanupEmulator.test.mjs
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(projectId, /^demo-[a-z0-9-]+$/u, "Progetto demo-* obbligatorio");
for (const name of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
  assert.match(process.env[name] || "", /^(127\.0\.0\.1|localhost):[1-9]\d{0,4}$/u, `${name}: solo emulatore locale`);
  assert.ok(Number(process.env[name].split(":")[1]) <= 65535);
}
// Import e inizializzazione Admin avvengono soltanto dopo entrambe le guardie.
const require = createRequire(import.meta.url);
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const app = initializeApp({ projectId }, `cleanup-${randomUUID()}`);
const db = getFirestore(app);
const auth = getAuth(app);
const stakes = new Set();
const users = new Set();
let cleanup;
let reconcile;
let handlerFactory;
let handleEvent;

before(() => {
  ({ cleanupDeletedUserMemberships: cleanup } = require("../lib/stakeMembershipCleanup.js"));
  ({ reconcileUserMembership: reconcile, createStakeMembershipHandler: handlerFactory,
    handleUserStakeMembershipEvent: handleEvent } = require("../lib/stakeMembershipFunctions.js"));
  assert.equal(typeof cleanup, "function");
});

const profile = (uid, stakeId, role = "participant") => ({
  firstName: "Persona", lastName: "Sintetica", fullName: "Persona Sintetica",
  email: `${uid}@example.invalid`, role, stakeId, stakeSlug: stakeId,
  birthDate: "2008-01-10", genderRoleCategory: role === "admin" ? "dirigente" : "giovane_uomo",
  unitId: "unit-qa", unitName: "Unità QA", mustChangePassword: false,
});
const member = () => ({ status: "pending", staffRole: null, sources: [], previous: null,
  claimedUnitId: "unit-qa", claimedUnitName: "Unità QA", displayName: "Persona Sintetica",
  birthYear: 2008, registrationHints: [], reviewNeeded: false, requestedAt: Timestamp.now(),
  decidedAt: null, decidedBy: null, declineCount: 0, version: 1 });

async function fixture({ orphan = false } = {}) {
  const id = randomUUID();
  const uid = `qa-cleanup-${id}`;
  const other = `qa-other-${id}`;
  users.add(uid); users.add(other);
  const paths = [];
  const untouched = [];
  const ids = [`qa-cleanup-a-${id}`, `qa-cleanup-b-${id}`];
  const batch = db.batch();
  for (const stakeId of ids) {
    stakes.add(stakeId);
    batch.set(db.doc(`stakes/${stakeId}`), { name: "Palo sintetico", isActive: true });
    batch.set(db.doc(`stakes/${stakeId}/units/unit-qa`), { name: "Unità QA", isActive: true });
    const root = `stakes/${stakeId}/members/${uid}`;
    paths.push(root, `${root}/history/entry`, `${root}/staff/previous`, `${root}/staff/note`);
    if (!orphan) batch.set(db.doc(root), member());
    batch.set(db.doc(`${root}/history/entry`), { action: "request", by: uid, version: 1 });
    batch.set(db.doc(`${root}/staff/previous`), { action: "request", by: uid, status: "withdrawn" });
    batch.set(db.doc(`${root}/staff/note`), { sameNameAndBirthYear: true });
    const otherRoot = `stakes/${stakeId}/members/${other}`;
    for (const path of [otherRoot, `${otherRoot}/history/entry`, `${otherRoot}/staff/previous`,
      `stakes/${stakeId}/activities/qa/registrations/user_${uid}`,
      `stakes/${stakeId}/activities/qa/parentAuthorizations/${uid}`]) {
      untouched.push(path);
      batch.set(db.doc(path), { sentinel: "da conservare", userId: uid, pdfPath: "synthetic-only.pdf" });
    }
  }
  await batch.commit();
  return { uid, other, ids, paths, untouched };
}

async function snapshot(paths) {
  return Promise.all(paths.map(async path => {
    const snap = await db.doc(path).get();
    return { path, exists: snap.exists, data: snap.data(), updateTime: snap.updateTime?.toMillis() };
  }));
}

async function assertUntouched(f, action) {
  const before = await snapshot([...f.paths, ...f.untouched]);
  await action();
  assert.deepEqual(await snapshot([...f.paths, ...f.untouched]), before);
}

test("dry-run predefinito: due pali, zero scritture anche sulle sottocollection", async () => {
  const f = await fixture();
  await assertUntouched(f, () => cleanup({ db, auth, uid: f.uid }));
});

test("apply elimina solo appartenenze/history/staff del target in due pali; seconda esecuzione idempotente", async () => {
  const f = await fixture();
  const retained = await snapshot(f.untouched);
  await cleanup({ db, auth, uid: f.uid, dryRun: false, expectedMemberships: 2 });
  assert.ok((await snapshot(f.paths)).every(doc => !doc.exists));
  assert.deepEqual(await snapshot(f.untouched), retained);
  await cleanup({ db, auth, uid: f.uid, dryRun: false, expectedMemberships: 0 });
  assert.ok((await snapshot(f.paths)).every(doc => !doc.exists));
  assert.deepEqual(await snapshot(f.untouched), retained);
});

test("trova history e staff orfani anche quando il documento members non esiste", async () => {
  const f = await fixture({ orphan: true });
  const retained = await snapshot(f.untouched);
  await cleanup({ db, auth, uid: f.uid, dryRun: false, expectedMemberships: 2 });
  assert.ok((await snapshot(f.paths)).every(doc => !doc.exists));
  assert.deepEqual(await snapshot(f.untouched), retained);
});

for (const presence of ["auth", "profile", "both"]) {
  test(`apply rifiutato senza scritture se esiste ancora ${presence}`, async () => {
    const f = await fixture();
    if (presence !== "profile") await auth.createUser({ uid: f.uid, email: `${f.uid}@example.invalid` });
    if (presence !== "auth") await db.doc(`users/${f.uid}`).set(profile(f.uid, f.ids[0]));
    await assertUntouched(f, () => assert.rejects(cleanup({ db, auth, uid: f.uid, dryRun: false, expectedMemberships: 2 })));
  });
}

test("conteggio atteso cambiato: rifiuto prima della prima cancellazione", async () => {
  const f = await fixture();
  await assertUntouched(f, () => assert.rejects(cleanup({ db, auth, uid: f.uid, dryRun: false, expectedMemberships: 1 })));
});

test("errore Auth non è assenza: non cancella nulla", async () => {
  const f = await fixture();
  const failure = Object.assign(new Error("Auth temporaneamente non disponibile"), { code: "auth/internal-error" });
  const brokenAuth = { getUser: async () => { throw failure; } };
  await assertUntouched(f, () => assert.rejects(cleanup({ db, auth: brokenAuth, uid: f.uid, dryRun: false, expectedMemberships: 2 })));
});

test("delete del profilo fuori ordine non cancella un account ricreato", async () => {
  const f = await fixture();
  await auth.createUser({ uid: f.uid, email: `${f.uid}@example.invalid` });
  await db.doc(`users/${f.uid}`).set(profile(f.uid, f.ids[0]));
  const event = { params: { uid: f.uid }, data: { before: { exists: true }, after: { exists: false } } };
  await assertUntouched(f, () => handleEvent(event, { db, auth }));
  assert.equal((await db.doc(`users/${f.uid}`).get()).exists, true);
});

test("delete del profilo con Auth ancora vivo conserva tutto, retry dopo delete Auth ripulisce", async () => {
  const f = await fixture();
  await auth.createUser({ uid: f.uid, email: `${f.uid}@example.invalid` });
  const event = { params: { uid: f.uid }, data: { before: { exists: true }, after: { exists: false } } };
  await assertUntouched(f, () => handleEvent(event, { db, auth }));
  await auth.deleteUser(f.uid);
  await handleEvent(event, { db, auth });
  assert.ok((await snapshot(f.paths)).every(doc => !doc.exists));
});

test("reconcile non ricrea members quando Auth manca anche se resta il profilo", async () => {
  const f = await fixture();
  await db.doc(`users/${f.uid}`).set(profile(f.uid, f.ids[0]));
  await db.recursiveDelete(db.doc(`stakes/${f.ids[0]}/members/${f.uid}`));
  await assertUntouched(f, () => reconcile(db, f.uid, { auth }));
  assert.equal((await db.doc(`stakes/${f.ids[0]}/members/${f.uid}`).get()).exists, false);
});

test("reconcile ricontrolla Auth dentro la transazione dopo una prelettura valida", async () => {
  const f = await fixture();
  await auth.createUser({ uid: f.uid, email: `${f.uid}@example.invalid` });
  const identity = await auth.getUser(f.uid);
  await db.doc(`users/${f.uid}`).set(profile(f.uid, f.ids[0]));
  await db.recursiveDelete(db.doc(`stakes/${f.ids[0]}/members/${f.uid}`));
  let reads = 0;
  const disappearingAuth = { getUser: async () => {
    if (++reads === 1) return identity;
    throw Object.assign(new Error("Account eliminato dopo la prima lettura"), { code: "auth/user-not-found" });
  } };
  await assertUntouched(f, () => reconcile(db, f.uid, { auth: disappearingAuth }));
  assert.ok(reads >= 2, "La verifica Auth va ripetuta nella transazione");
  assert.equal((await db.doc(`stakes/${f.ids[0]}/members/${f.uid}`).get()).exists, false);
});

test("request con token precedente non ricrea appartenenza dopo cancellazione Auth", async () => {
  const f = await fixture();
  await db.doc(`users/${f.uid}`).set(profile(f.uid, f.ids[0]));
  await db.recursiveDelete(db.doc(`stakes/${f.ids[0]}/members/${f.uid}`));
  const handler = handlerFactory({ db, auth });
  await assertUntouched(f, () => assert.rejects(handler({
    auth: { uid: f.uid, token: { firebase: { sign_in_provider: "password" } } },
    data: { action: "request", stakeId: f.ids[0] },
  })));
});

for (const missing of ["auth", "profile"]) {
  test(`approve non attiva un utente cancellato con ${missing} assente`, async () => {
    const f = await fixture();
    const adminUid = `qa-admin-${randomUUID()}`;
    users.add(adminUid);
    await auth.createUser({ uid: adminUid, email: `${adminUid}@example.invalid` });
    await db.doc(`users/${adminUid}`).set(profile(adminUid, f.ids[0], "admin"));
    if (missing === "auth") await db.doc(`users/${f.uid}`).set(profile(f.uid, f.ids[0]));
    else await auth.createUser({ uid: f.uid, email: `${f.uid}@example.invalid` });
    const handler = handlerFactory({ db, auth });
    await assertUntouched(f, () => assert.rejects(handler({
      auth: { uid: adminUid, token: { firebase: { sign_in_provider: "password" } } },
      data: { action: "approve", stakeId: f.ids[0], uid: f.uid },
    })));
  });
}

test("controllo positivo: gli stessi request e approve funzionano con Auth e profili vivi", async () => {
  const f = await fixture();
  const adminUid = `qa-admin-${randomUUID()}`;
  users.add(adminUid);
  for (const [id, role] of [[f.uid, "participant"], [adminUid, "admin"]]) {
    await auth.createUser({ uid: id, email: `${id}@example.invalid` });
    await db.doc(`users/${id}`).set(profile(id, f.ids[0], role));
  }
  await db.recursiveDelete(db.doc(`stakes/${f.ids[0]}/members/${f.uid}`));
  const handler = handlerFactory({ db, auth });
  const request = id => ({ uid: id, token: { firebase: { sign_in_provider: "password" } } });
  await handler({ auth: request(f.uid), data: { action: "request", stakeId: f.ids[0] } });
  assert.equal((await db.doc(`stakes/${f.ids[0]}/members/${f.uid}`).get()).data().status, "pending");
  await handler({ auth: request(adminUid), data: { action: "approve", stakeId: f.ids[0], uid: f.uid } });
  assert.equal((await db.doc(`stakes/${f.ids[0]}/members/${f.uid}`).get()).data().status, "active");
});

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/cleanupDeletedUserMemberships.js", import.meta.url)), ...args], {
      env: { PATH: process.env.PATH, GCLOUD_PROJECT: projectId,
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
        FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, output }));
  });
}

test("CLI: apply richiede progetto, uid e conteggio espliciti; dry-run non scrive; niente PII nei log", async () => {
  const f = await fixture();
  for (const args of [
    ["--apply", "--uid", f.uid, "--expect-memberships", "2"],
    ["--apply", "--project", projectId, "--expect-memberships", "2"],
    ["--apply", "--project", projectId, "--uid", f.uid],
    ["--apply", "--project", projectId, "--uid", f.uid, "--expect-memberships", "1"],
  ]) {
    await assertUntouched(f, async () => {
      const result = await runCli(args);
      assert.notEqual(result.code, 0);
      assert.equal(result.output.includes(f.uid), false, "Nessun UID nei log di errore");
    });
  }
  await assertUntouched(f, async () => {
    const result = await runCli(["--project", projectId, "--uid", f.uid]);
    assert.equal(result.code, 0, result.output);
    assert.equal(result.output.includes(f.uid), false);
  });
  const result = await runCli(["--apply", "--project", projectId, "--uid", f.uid, "--expect-memberships", "2"]);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.output.includes(f.uid), false);
  assert.ok((await snapshot(f.paths)).every(doc => !doc.exists));
});

after(async () => {
  for (const stakeId of stakes) await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  for (const uid of users) {
    await db.doc(`users/${uid}`).delete();
    try { await auth.deleteUser(uid); } catch (error) { if (error.code !== "auth/user-not-found") throw error; }
  }
  await deleteApp(app);
});
