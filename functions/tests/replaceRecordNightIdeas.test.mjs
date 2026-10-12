import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

// Solo memoria: nessuna connessione Firebase e nessun backup reale.
// node --test functions/tests/replaceRecordNightIdeas.test.mjs
const require = createRequire(import.meta.url);
const { IDEAS } = require("../lib/recordNightIdeas.js");
const { buildPlan, parseArgs } = require("../scripts/replaceRecordNightIdeas.js");
const source = readFileSync(new URL("../scripts/replaceRecordNightIdeas.js", import.meta.url), "utf8");
const NOW = "2026-10-12T12:00:00.000Z";
const cli = ["--project", "giovani-palo", "--stake", "roma-est", "--activity", "viaggio-tempio"];
const applyCli = [...cli, "--production", "--apply", "--backup", "/private/tmp/records-private-test.json"];

function withEnvironment(host, fn) {
  const previous = process.env.FIRESTORE_EMULATOR_HOST;
  if (host === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
  else process.env.FIRESTORE_EMULATOR_HOST = host;
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previous;
  }
}

function applyPlan(records, entries, plan) {
  const recordMap = new Map(records.map((record) => [record.id, { ...record }]));
  const entryMap = new Map(entries.map((entry) => [entry.id, { ...entry }]));
  for (const row of plan.hides) Object.assign(recordMap.get(row.id), row.patch);
  for (const row of plan.upserts) recordMap.set(row.id, { ...recordMap.get(row.id), ...row.data, id: row.id });
  for (const row of plan.withdrawals) Object.assign(entryMap.get(row.id), row.patch);
  return { records: [...recordMap.values()], entries: [...entryMap.values()] };
}

test("elenco dello staff: dieci id unici, payload valido e tutte le prove visibili", () => {
  assert.equal(IDEAS.length, 10);
  assert.equal(new Set(IDEAS.map(({ id }) => id)).size, 10);
  const plan = buildPlan([], [], [], NOW);
  assert.equal(plan.upserts.length, 10);
  assert.equal(plan.visible.length, 10);
  for (const row of plan.upserts) {
    assert.equal(row.create, true);
    assert.equal(row.data.status, "open");
    assert.equal(row.data.featured, true);
    assert.equal(row.data.challengerCount, 0);
    assert.equal(row.data.createdAt, NOW);
    assert.equal(row.data.createdFromEntryId, null);
    assert.equal(row.data.createdBy, "system");
    if (row.data.measure === "count_in_time") assert.equal(row.data.durationSeconds, 60);
    else assert.equal(row.data.durationSeconds, null);
  }
});

test("sostituzione dello stato misurato: conserva storico e ritira lo sfidante", () => {
  const retainedIds = new Set(["idea-plank", "idea-piegamenti", "idea-torre-montata-smontata", "idea-aereo-di-carta"]);
  const retained = IDEAS.filter(({ id }) => retainedIds.has(id)).map((idea) => ({ ...idea, status: "open", challengerCount: 0 }));
  const removed = Array.from({ length: 11 }, (_, i) => ({ id: `old-${i}`, title: `Vecchio ${i}`, status: "open", challengerCount: i === 0 ? 1 : 0 }));
  const records = [...retained, ...removed];
  const entries = [{ id: "entry-1", recordId: "old-0", status: "approved", participantName: "Nome di prova" }];
  const requests = [{ id: "request-1", status: "open", kind: "proposal", recordId: null }];
  const original = structuredClone({ records, entries, requests });
  const plan = buildPlan(records, entries, requests, NOW);
  assert.equal(plan.hides.length, 11);
  assert.equal(plan.withdrawals.length, 1);
  assert.equal(plan.upserts.filter(({ create }) => create).length, 6);
  assert.deepEqual(plan.withdrawals[0], {
    id: "entry-1", patch: { status: "withdrawn", statusBeforeWithdraw: null, withdrawnBy: "staff", withdrawnWithRecordHide: true, updatedAt: NOW },
  });
  const after = applyPlan(records, entries, plan);
  assert.equal(after.records.length, 21);
  assert.equal(after.records.filter(({ status }) => status === "open").length, 10);
  assert.equal(after.records.find(({ id }) => id === "old-0").title, "Vecchio 0");
  assert.equal(after.entries[0].participantName, "Nome di prova");
  assert.deepEqual({ records, entries, requests }, original);
});

test("secondo giro idempotente: zero scritture anche con un timestamp diverso", () => {
  const records = [{ id: "old", status: "open", challengerCount: 1 }];
  const entries = [{ id: "entry", recordId: "old", status: "approved" }];
  const first = applyPlan(records, entries, buildPlan(records, entries, [], NOW));
  const second = buildPlan(first.records, first.entries, [], "2026-10-12T13:00:00.000Z");
  assert.equal(second.hides.length, 0);
  assert.equal(second.withdrawals.length, 0);
  assert.equal(second.upserts.length, 0);
});

test("contatore ricalcolato dagli approved sui record mantenuti", () => {
  const id = IDEAS[0].id;
  const records = [{ ...IDEAS[0], id, status: "hidden", challengerCount: 99, createdBy: "original-owner", createdAt: "old" }];
  const entries = ["approved", "approved", "pending", "withdrawn", "rejected"].map((status, i) => ({ id: `entry-${i}`, recordId: id, status }));
  entries.push({ id: "another", recordId: "other", status: "approved" });
  const plan = buildPlan(records, entries, [], NOW);
  const row = plan.upserts.find((record) => record.id === id);
  assert.equal(row.create, false);
  assert.equal(row.data.challengerCount, 2);
  assert.equal(row.data.status, "open");
  assert.equal(Object.hasOwn(row.data, "createdAt"), false);
  assert.equal(Object.hasOwn(row.data, "createdBy"), false);
  assert.deepEqual(plan.withdrawals.map(({ id }) => id), []);
});

test("record già nascosto: contatore azzerato e approved residui ritirati", () => {
  const records = [{ id: "old", status: "hidden", challengerCount: 1, featured: true }];
  const entries = ["approved", "pending", "rejected", "withdrawn"].map((status, i) => ({ id: `entry-${i}`, recordId: "old", status }));
  const plan = buildPlan(records, entries, [], NOW);
  assert.equal(plan.hides.length, 1);
  assert.equal(plan.hides[0].patch.featured, false);
  assert.equal(plan.hides[0].patch.challengerCount, 0);
  assert.deepEqual(plan.withdrawals.map(({ id }) => id), ["entry-0"]);
});

test("record hidden senza sfidanti perde comunque il flag featured", () => {
  const plan = buildPlan([{ id: "old", status: "hidden", challengerCount: 0, featured: true }], [], [], NOW);
  assert.equal(plan.hides.length, 1);
  assert.equal(plan.hides[0].patch.featured, false);
});

test("richieste ospiti open/linked su record eliminati bloccano tutto", () => {
  for (const status of ["open", "linked"]) {
    assert.throws(() => buildPlan([{ id: "old", status: "open" }], [], [{ id: "request", recordId: "old", status }], NOW), /Richieste ospiti/);
  }
});

test("richieste autonome, chiuse e riferite ai nuovi record rimangono intatte", () => {
  const requests = [
    { id: "proposal", recordId: null, status: "open" },
    { id: "closed", recordId: "old", status: "rejected" },
    { id: "withdrawn", recordId: "old", status: "withdrawn" },
    { id: "retained", recordId: IDEAS[0].id, status: "linked" },
  ];
  const before = structuredClone(requests);
  assert.equal(buildPlan([{ id: "old", status: "open" }], [], requests, NOW).hides.length, 1);
  assert.deepEqual(requests, before);
});

test("tetto della transazione: 450 scritture ammesse, 451 bloccate", () => {
  const records = Array.from({ length: 440 }, (_, i) => ({ id: `old-${i}`, status: "open", challengerCount: 0 }));
  const accepted = buildPlan(records, [], [], NOW);
  assert.equal(accepted.hides.length + accepted.upserts.length, 450);
  assert.throws(() => buildPlan([...records, { id: "too-many", status: "open" }], [], [], NOW), /Troppi documenti/);
  assert.throws(() => buildPlan(records, [{ id: "entry", recordId: "old-0", status: "approved" }], [], NOW), /Troppi documenti/);
});

test("CLI produzione: dry-run implicito e progetto vincolato", () => withEnvironment(undefined, () => {
  const args = parseArgs(cli);
  assert.equal(args.apply, false);
  assert.equal(args.production, false);
  assert.throws(() => parseArgs([...cli, "--apply", "--backup", "/private/backup.json"]), /--production/);
  assert.throws(() => parseArgs(["--project", "altro-progetto", "--stake", "roma-est", "--activity", "event"]), /progetto giovani-palo/);
  assert.equal(parseArgs(applyCli).apply, true);
}));

test("CLI apply: backup obbligatorio e percorso assoluto", () => withEnvironment(undefined, () => {
  assert.throws(() => parseArgs([...cli, "--production", "--apply"]), /--backup/);
  assert.throws(() => parseArgs([...cli, "--production", "--apply", "--backup", "backup.json"]), /percorso assoluto/);
  const repoBackup = fileURLToPath(new URL("../../record-backup.json", import.meta.url));
  assert.throws(() => parseArgs([...cli, "--production", "--apply", "--backup", repoBackup]), /fuori dal repo/);
}));

test("CLI rifiuta argomenti sconosciuti, mancanti e path iniettati", () => withEnvironment(undefined, () => {
  assert.throws(() => parseArgs([...cli, "--yes"]), /sconosciuto/);
  assert.throws(() => parseArgs([...cli, "--backup"]), /Valore mancante/);
  assert.throws(() => parseArgs([...cli, "--backup", "--apply"]), /Valore mancante/);
  for (const key of ["--project", "--stake", "--activity"]) {
    const malformed = [...cli];
    malformed[malformed.indexOf(key) + 1] = "bad/path";
    assert.throws(() => parseArgs(malformed), /non valido/);
  }
  assert.throws(() => parseArgs([]), /obbligatorio/);
}));

test("CLI emulatore: solo demo-*, nessuna modalità produzione", () => withEnvironment("127.0.0.1:8080", () => {
  assert.throws(() => parseArgs(cli), /solo un progetto demo/);
  const demo = ["--project", "demo-record-night", "--stake", "roma-est", "--activity", "event"];
  assert.equal(parseArgs(demo).project, "demo-record-night");
  assert.throws(() => parseArgs([...demo, "--production"]), /Emulatore/);
  assert.equal(parseArgs([...demo, "--apply", "--backup", "/private/backup.json"]).apply, true);
}));

function stamp(version = 1) {
  return { nanoseconds: version, toDate: () => new Date(NOW), isEqual: (other) => other?.nanoseconds === version };
}

function snapshot(rows = []) {
  return { size: rows.length, docs: rows.map(({ id, version = 1, ...data }) => ({ id, data: () => data, updateTime: stamp(version) })) };
}

function harness({ beforeRecords = [], beforeEntries = [], currentRecords = beforeRecords, currentEntries = beforeEntries, activityEnabled = true, activityExists = true, currentActivityVersion = 1, backupFailure = false, finalRecords = IDEAS.map(({ id }) => ({ id })) } = {}) {
  const effects = [];
  const backups = [];
  const writes = [];
  let transactions = 0;
  const before = { records: snapshot(beforeRecords), entries: snapshot(beforeEntries), requests: snapshot([]) };
  const current = { records: snapshot(currentRecords), entries: snapshot(currentEntries), requests: snapshot([]) };
  const activity = (version) => ({ exists: activityExists, data: () => ({ recordsEnabled: activityEnabled }), updateTime: stamp(version) });
  const keyFor = (name) => ({ records: "records", recordEntries: "entries", recordRequests: "requests" })[name];
  const activityRef = {
    path: "stakes/roma-est/activities/viaggio-tempio",
    get: async () => activity(1),
    collection(name) { return {
      name, get: async () => before[keyFor(name)],
      doc: (id) => ({ path: `${name}/${id}` }),
      where: () => ({ get: async () => snapshot(finalRecords) }),
    }; },
  };
  const db = {
    doc: () => activityRef,
    async runTransaction(callback) {
      effects.push("transaction"); transactions++;
      const write = (type) => (ref, data) => { effects.push("write"); writes.push({ type, path: ref.path, data }); };
      await callback({ get: async (ref) => ref === activityRef ? activity(currentActivityVersion) : current[keyFor(ref.name)], update: write("update"), create: write("create") });
    },
  };
  const module = { exports: {} };
  const fakeRequire = (name) => {
    if (name === "firebase-admin/app") return { initializeApp: () => {}, applicationDefault: () => ({}) };
    if (name === "firebase-admin/firestore") return { getFirestore: () => db };
    if (name === "node:fs") return { realpathSync, writeFileSync: (path, data, options) => {
      effects.push("backup");
      if (backupFailure) throw new Error("backup denied");
      backups.push({ path, data: JSON.parse(data), options });
    } };
    if (name === "../lib/recordNightIdeas") return { IDEAS };
    if (name === "../lib/recordNight") return require("../lib/recordNight.js");
    return require(name);
  };
  runInNewContext(source, { require: fakeRequire, module, __dirname: fileURLToPath(new URL("../scripts/", import.meta.url)), console: { log() {}, error() {} }, process: { env: {} }, Date, Set, JSON });
  return { main: module.exports.main, effects, writes, backups, transactions: () => transactions };
}

test("main dry-run: nessun backup, nessuna transazione, nessuna scrittura", async () => {
  const fake = harness();
  await fake.main(cli);
  assert.equal(fake.transactions(), 0);
  assert.equal(fake.writes.length, 0);
  assert.equal(fake.backups.length, 0);
});

test("main apply: backup privato esclusivo prima della transazione", async () => {
  const fake = harness({ beforeRecords: [{ id: "old", status: "open", challengerCount: 1 }], beforeEntries: [{ id: "entry", recordId: "old", status: "approved" }] });
  await fake.main(applyCli);
  assert.equal(fake.effects[0], "backup");
  assert.equal(fake.effects[1], "transaction");
  assert.equal(fake.backups.length, 1);
  assert.equal(fake.backups[0].options.flag, "wx");
  assert.equal(fake.backups[0].options.mode, 0o600);
  assert.equal(fake.backups[0].data.records.length, 1);
  assert.equal(fake.backups[0].data.entries.length, 1);
  assert.equal(fake.writes.length, 12);
  assert.equal(fake.writes.filter(({ type }) => type === "create").length, 10);
  assert.equal(fake.writes.some(({ type }) => type === "delete"), false);
});

test("main blocca attività inesistente o record disabilitati prima del backup", async () => {
  for (const condition of [{ activityEnabled: false }, { activityExists: false }]) {
    const fake = harness(condition);
    await assert.rejects(fake.main(applyCli), /Attività inesistente o record disabilitati/);
    assert.equal(fake.backups.length, 0);
    assert.equal(fake.transactions(), 0);
  }
});

test("main backup fallito: nessuna transazione viene aperta", async () => {
  const fake = harness({ backupFailure: true });
  await assert.rejects(fake.main(applyCli), /backup denied/);
  assert.equal(fake.transactions(), 0);
  assert.equal(fake.writes.length, 0);
});

test("main guardia concorrenza: modifica attività, record, aggiunta/rimozione o entry", async () => {
  const original = [{ id: "old", status: "open", challengerCount: 0, version: 1 }];
  const cases = [
    { currentActivityVersion: 2 },
    { currentRecords: [{ ...original[0], version: 2 }] },
    { currentRecords: [...original, { id: "new-concurrent", status: "open" }] },
    { currentRecords: [] },
    { currentEntries: [{ id: "entry", recordId: "old", status: "approved" }] },
  ];
  for (const changed of cases) {
    const fake = harness({ beforeRecords: original, ...changed });
    await assert.rejects(fake.main(applyCli), /Dati cambiati dopo il backup/);
    assert.equal(fake.backups.length, 1);
    assert.equal(fake.writes.length, 0);
  }
});

test("main verifica finale rifiuta un elenco aperto diverso dai dieci previsti", async () => {
  const fake = harness({ finalRecords: [{ id: "unexpected" }] });
  await assert.rejects(fake.main(applyCli), /Verifica finale/);
  assert.equal(fake.writes.length, 10);
});
