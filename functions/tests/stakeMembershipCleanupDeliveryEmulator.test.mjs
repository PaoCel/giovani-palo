// Consegna reale del ramo DELETE di onUserStakeMembership (Functions gen2).
// Nessun import del codice dell'handler: il test modifica solo dati sintetici
// e attende l'esecuzione registrata dall'entry point functions/index.js.
// Avviare Auth, Firestore e Functions con firebase.membership-functions-test.json
// oppure con porte QA dedicate; impostare GCLOUD_PROJECT=demo-* e i tre host
// FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FUNCTIONS_EMULATOR_HOST.
// Nella copia QA predisporre functions/.secret.local con valori sintetici per
// WEB_PUSH_PRIVATE_KEY e BREVO_API_KEY: gli altri trigger delle iscrizioni
// vengono caricati dall'entry point reale e non devono interrogare Secret Manager.
// node --test functions/tests/stakeMembershipCleanupDeliveryEmulator.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(projectId, /^demo-[a-z0-9-]+$/u, "Serve un progetto demo-* esplicito");
for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FUNCTIONS_EMULATOR_HOST"]) {
  const host = process.env[key] || "";
  assert.match(host, /^(127\.0\.0\.1|localhost):[1-9]\d{0,4}$/u, `${key}: host locale obbligatorio`);
  assert.ok(Number(host.split(":")[1]) <= 65535);
}
// Mai inizializzare Admin prima delle guardie per tutti e tre gli emulatori.
const require = createRequire(import.meta.url);
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const app = initializeApp({ projectId }, `cleanup-delivery-${randomUUID()}`);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = randomUUID();
const uid = `qa-delivery-${runId}`;
const otherUid = `qa-retained-${runId}`;
const stakeIds = [`qa-delivery-a-${runId}`, `qa-delivery-b-${runId}`];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(read, predicate, description, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await pause(250);
  } while (Date.now() < deadline);
  assert.fail(`Timeout: ${description}`);
}

async function subtree(ref) {
  const found = [];
  const snapshot = await ref.get();
  if (snapshot.exists) found.push({ path: ref.path, data: snapshot.data(), updateTime: snapshot.updateTime.toMillis() });
  for (const collection of await ref.listCollections()) {
    for (const child of await collection.listDocuments()) found.push(...await subtree(child));
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function memberships() {
  return Promise.all(stakeIds.map(stakeId => subtree(db.doc(`stakes/${stakeId}/members/${uid}`))));
}

async function quiet(read, quietMs = 2000, timeoutMs = 20000) {
  let last = JSON.stringify(await read());
  let stableSince = Date.now();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await pause(250);
    const value = await read();
    const serialized = JSON.stringify(value);
    if (serialized !== last) { last = serialized; stableSince = Date.now(); }
    if (Date.now() - stableSince >= quietMs) return value;
  }
  assert.fail("I dati non raggiungono la quiete nel tempo previsto");
}

test("evento DELETE reale ripulisce due pali, history e staff; Auth delete da solo non avvia cleanup", { timeout: 120000 }, async () => {
  await auth.createUser({ uid, email: `${uid}@example.invalid`, emailVerified: true });
  const roots = stakeIds.map(id => `stakes/${id}/members/${uid}`);
  const retainedPaths = [];
  const batch = db.batch();
  for (const [index, stakeId] of stakeIds.entries()) {
    batch.set(db.doc(`stakes/${stakeId}`), { name: "Palo sintetico consegna", isActive: true });
    batch.set(db.doc(`stakes/${stakeId}/units/qa-unit`), { name: "Unità sintetica", isActive: true });
    batch.set(db.doc(roots[index]), {
      status: "active", staffRole: null, claimedUnitId: "qa-unit", claimedUnitName: "Unità sintetica",
      displayName: "Persona sintetica", birthYear: 1982, sources: [], previous: null,
      registrationHints: [], reviewNeeded: false, version: 1, declineCount: 0,
      requestedAt: Timestamp.now(), decidedAt: Timestamp.now(), decidedBy: "system",
    });
    for (const path of [`stakes/${stakeId}/members/${otherUid}`,
      `stakes/${stakeId}/members/${otherUid}/history/keep`, `stakes/${stakeId}/members/${otherUid}/staff/note`,
      `stakes/${stakeId}/activities/qa/registrations/user_${uid}`]) {
      retainedPaths.push(path);
      batch.set(db.doc(path), { marker: "sentinella sintetica", registrationStatus: "cancelled", userId: path.includes("/registrations/") ? uid : otherUid });
    }
  }
  await batch.commit();
  // Membership before profile, then a visible change proves real trigger delivery.
  await db.doc(`users/${uid}`).set({
    firstName: "Persona", lastName: "Sintetica", fullName: "Persona Sintetica", email: `${uid}@example.invalid`,
    role: "admin", stakeId: stakeIds[0], stakeSlug: stakeIds[0], birthDate: "1982-01-10",
    genderRoleCategory: "dirigente", unitId: "qa-unit", unitName: "Unità sintetica", mustChangePassword: false,
  });
  await waitFor(() => db.doc(roots[0]).get(), snap => snap.data()?.staffRole === "admin", "consegna CREATE al trigger gen2");
  await quiet(memberships);
  const notes = db.batch();
  for (const root of roots) {
    notes.set(db.doc(`${root}/history/qa-history`), { action: "request", by: uid });
    notes.set(db.doc(`${root}/staff/note`), { sameNameAndBirthYear: true });
    notes.set(db.doc(`${root}/staff/previous`), { action: "approve", by: uid });
    // Also verify recursive deletion beyond the currently used schema.
    notes.set(db.doc(`${root}/history/qa-history/details/qa-child`), { marker: "discendente sintetico" });
  }
  await notes.commit();
  const retained = async () => Promise.all(retainedPaths.map(async path => {
    const snapshot = await db.doc(path).get();
    return { path, exists: snapshot.exists, data: snapshot.data(), updateTime: snapshot.updateTime?.toMillis() };
  }));
  const beforeOthers = await quiet(retained);
  const beforeDelete = await quiet(memberships);
  assert.ok(beforeDelete.every(docs => docs.length >= 5), "Fixture completa in entrambi i pali");

  await auth.deleteUser(uid);
  // Bounded observation of the documented procedure: no Auth-delete hook.
  assert.deepEqual(await quiet(memberships, 2500), beforeDelete, "Auth delete da solo non rimuove le appartenenze");
  await db.doc(`users/${uid}`).delete();
  await waitFor(memberships, groups => groups.every(docs => docs.length === 0), "DELETE consegnato: subtree rimossi in entrambi i pali");
  assert.deepEqual(await quiet(memberships), [[], []], "Nessuna ricreazione da eventi in coda");
  assert.deepEqual(await retained(), beforeOthers, "Altro UID e iscrizioni restano identici");
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
});

after(async () => {
  try { await auth.deleteUser(uid); } catch (error) { if (error.code !== "auth/user-not-found") throw error; }
  await db.doc(`users/${uid}`).delete();
  for (const id of stakeIds) await db.recursiveDelete(db.doc(`stakes/${id}`));
  await deleteApp(app);
});
