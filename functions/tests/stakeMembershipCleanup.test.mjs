// Attesi dal contratto cleanup S2, scritti separatamente dall'implementazione.
// Fake Firestore con commit atomici: nessuna rete o credenziale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { cleanupDeletedUserMemberships: cleanup } = require("../lib/stakeMembershipCleanup.js");
const { parseArgs, validateEnvironment } = require("../scripts/cleanupDeletedUserMemberships.js");

function memoryDb(entries = {}) {
  const records = new Map(Object.entries(entries));
  let writes = 0;
  let commits = 0;
  const children = path => [...new Set([...records.keys()].filter(key => key.startsWith(`${path}/`)).map(key => key.slice(path.length + 1).split("/")[0]))].sort();
  const snapshot = ref => ({ id: ref.id, ref, exists: records.has(ref.path), data: () => records.get(ref.path) });
  function doc(path) {
    return { path, id: path.split("/").at(-1), get: async () => snapshot(doc(path)),
      collection: name => collection(`${path}/${name}`),
      listCollections: async () => children(path).map(name => collection(`${path}/${name}`)) };
  }
  function collection(path) {
    return { path, id: path.split("/").at(-1), doc: id => doc(`${path}/${id}`),
      select() { return this; },
      listDocuments: async () => children(path).map(id => doc(`${path}/${id}`)),
      get: async () => {
        const docs = children(path).map(id => snapshot(doc(`${path}/${id}`))).filter(item => item.exists);
        return { docs, size: docs.length, empty: docs.length === 0 };
      } };
  }
  const db = { doc, collection, getAll: async (...refs) => refs.map(snapshot),
    runTransaction: async callback => {
      const deletions = [];
      const tx = { get: async ref => snapshot(ref), getAll: async (...refs) => refs.map(snapshot),
        delete: ref => { deletions.push(ref.path); return tx; } };
      const result = await callback(tx);
      for (const path of deletions) records.delete(path);
      writes += deletions.length; commits += 1;
      return result;
    } };
  return { db, records, get writes() { return writes; }, get commits() { return commits; } };
}
const absentAuth = { getUser: async () => { throw Object.assign(new Error("Assente"), { code: "auth/user-not-found" }); } };
const uid = "qa-synthetic-user";
const tree = () => ({
  "stakes/a": {}, "stakes/b": {},
  [`stakes/a/members/${uid}`]: { status: "active" },
  [`stakes/a/members/${uid}/history/1`]: { action: "request" },
  [`stakes/a/members/${uid}/staff/note`]: { private: true },
  // Root b absent: must still discover both nested collections.
  [`stakes/b/members/${uid}/history/2`]: { action: "approve" },
  [`stakes/b/members/${uid}/staff/previous`]: { status: "pending" },
  "stakes/a/members/other": { status: "active" },
  [`stakes/a/activities/event/registrations/user_${uid}`]: { sentinel: "retain" },
});

test("dry-run predefinito conta due pali e cinque documenti senza scrivere", async () => {
  const fake = memoryDb(tree());
  const before = [...fake.records];
  assert.deepEqual(await cleanup({ db: fake.db, auth: absentAuth, uid }), {
    dryRun: true, memberships: 2, documents: 5, deletedMemberships: 0, deletedDocuments: 0,
  });
  assert.equal(fake.writes, 0);
  assert.deepEqual([...fake.records], before);
});

for (const invalid of [undefined, null, "", " ", "bad/path", "a".repeat(129)]) {
  test(`uid invalido (${String(invalid).slice(0, 12)}): rifiuto senza scritture`, async () => {
    const fake = memoryDb(tree());
    await assert.rejects(cleanup({ db: fake.db, auth: absentAuth, uid: invalid, dryRun: false, expectedMemberships: 2 }), { code: "invalid_uid" });
    assert.equal(fake.writes, 0);
  });
}

for (const expectedMemberships of [undefined, -1, 1.5, "2", NaN]) {
  test(`apply richiede conteggio intero esplicito: ${String(expectedMemberships)}`, async () => {
    const fake = memoryDb(tree());
    await assert.rejects(cleanup({ db: fake.db, auth: absentAuth, uid, dryRun: false, expectedMemberships }), { code: "expected_memberships_required" });
    assert.equal(fake.writes, 0);
  });
}

test("apply con conteggio diverso non cancella il primo documento", async () => {
  const fake = memoryDb(tree());
  await assert.rejects(cleanup({ db: fake.db, auth: absentAuth, uid, dryRun: false, expectedMemberships: 1 }), { code: "membership_count_changed" });
  assert.equal(fake.writes, 0);
});

test("Auth errore infrastrutturale propagato senza trattarlo come assenza", async () => {
  const fake = memoryDb(tree());
  const failure = Object.assign(new Error("Errore sintetico"), { code: "auth/internal-error" });
  await assert.rejects(cleanup({ db: fake.db, auth: { getUser: async () => { throw failure; } }, uid, dryRun: false, expectedMemberships: 2 }), error => error === failure);
  assert.equal(fake.writes, 0);
});

test("report contiene soltanto conteggi e modalità, nessun uid o contenuto privato", async () => {
  const fake = memoryDb(tree());
  const result = await cleanup({ db: fake.db, auth: absentAuth, uid, dryRun: false, expectedMemberships: 2 });
  assert.deepEqual(result, { dryRun: false, memberships: 2, documents: 5, deletedMemberships: 2, deletedDocuments: 5 });
  assert.equal(JSON.stringify(result).includes(uid), false);
  assert.ok(fake.records.has("stakes/a/members/other"));
  assert.ok(fake.records.has(`stakes/a/activities/event/registrations/user_${uid}`));
  assert.deepEqual(await cleanup({ db: fake.db, auth: absentAuth, uid, dryRun: false, expectedMemberships: 0 }), {
    dryRun: false, memberships: 0, documents: 0, deletedMemberships: 0, deletedDocuments: 0,
  });
});

test("account ricomparso al controllo transazionale: nessuna cancellazione", async () => {
  const fake = memoryDb(tree());
  let inTransaction = false;
  const original = fake.db.runTransaction;
  fake.db.runTransaction = callback => { inTransaction = true; return original(callback); };
  const auth = { getUser: async () => {
    if (inTransaction) return { uid, email: "synthetic@example.invalid" };
    return absentAuth.getUser(uid);
  } };
  await assert.rejects(cleanup({ db: fake.db, auth, uid, dryRun: false, expectedMemberships: 2 }), { code: "account_exists" });
  assert.equal(fake.writes, 0);
});

test("profilo ricomparso al controllo transazionale: nessuna cancellazione", async () => {
  const fake = memoryDb(tree());
  const original = fake.db.runTransaction;
  fake.db.runTransaction = callback => { fake.records.set(`users/${uid}`, { role: "participant" }); return original(callback); };
  await assert.rejects(cleanup({ db: fake.db, auth: absentAuth, uid, dryRun: false, expectedMemberships: 2 }), { code: "profile_exists" });
  assert.equal(fake.writes, 0);
});

test("fallimento dopo un lotto: nessuna perdita esterna e retry dal nuovo piano", async () => {
  const entries = tree();
  for (let i = 0; i < 405; i++) entries[`stakes/a/members/${uid}/history/extra-${i}`] = { sequence: i };
  const fake = memoryDb(entries);
  const original = fake.db.runTransaction;
  let attempts = 0;
  const failure = new Error("Guasto sintetico dopo il primo lotto");
  fake.db.runTransaction = callback => ++attempts === 2 ? Promise.reject(failure) : original(callback);
  await assert.rejects(cleanup({ db: fake.db, auth: absentAuth, uid, dryRun: false, expectedMemberships: 2 }), error => error === failure);
  assert.ok(fake.writes > 0 && fake.writes <= 400, "Un solo lotto, massimo 400 cancellazioni");
  fake.db.runTransaction = original;
  const plan = await cleanup({ db: fake.db, auth: absentAuth, uid });
  await cleanup({ db: fake.db, auth: absentAuth, uid, dryRun: false, expectedMemberships: plan.memberships });
  assert.equal([...fake.records.keys()].filter(path => path.includes(`/members/${uid}`)).length, 0);
  assert.ok(fake.records.has("stakes/a/members/other"));
  assert.ok(fake.records.has(`stakes/a/activities/event/registrations/user_${uid}`));
});

test("CLI parser: opzioni ignote, duplicate o incomplete falliscono prima dell'SDK", () => {
  const base = ["--project", "demo-cleanup", "--uid", uid];
  for (const args of [[...base, "--unknown"], [...base, "--uid", "other"], [...base, "--project"],
    [...base, "--apply", "--apply"], [...base, "--expect-memberships", "-1"], [...base, "--expect-memberships", "1.5"]]) {
    assert.throws(() => parseArgs(args), { code: "invalid_arguments" });
  }
  assert.equal(parseArgs(base).apply, false);
  assert.equal(parseArgs([...base, "--apply", "--expect-memberships", "0"]).apply, true);
});

test("CLI ambiente: demo richiede entrambi gli host locali; nessun misto demo/produzione", () => {
  const safe = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8487", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9487" };
  assert.equal(validateEnvironment("demo-cleanup", safe), true);
  for (const env of [{}, { FIRESTORE_EMULATOR_HOST: safe.FIRESTORE_EMULATOR_HOST },
    { FIREBASE_AUTH_EMULATOR_HOST: safe.FIREBASE_AUTH_EMULATOR_HOST },
    { ...safe, FIRESTORE_EMULATOR_HOST: "example.invalid:8487" },
    { ...safe, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:70000" }]) {
    assert.throws(() => validateEnvironment("demo-cleanup", env), { code: "invalid_environment" });
  }
  assert.throws(() => validateEnvironment("synthetic-production-name", safe), { code: "invalid_environment" });
});
