#!/usr/bin/env node
"use strict";

// Sostituisce l'elenco visibile senza perdere lo storico. Dry-run di default.
// Produzione: --project giovani-palo --production --stake roma-est
// --activity <id> --apply --backup <percorso-assoluto-privato.json>
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { writeFileSync, realpathSync } = require("node:fs");
const { isAbsolute, dirname, resolve, relative, sep } = require("node:path");
const { IDEAS } = require("../lib/recordNightIdeas");
const { parseRecordFields, planHideRecord } = require("../lib/recordNight");

function parseArgs(argv) {
  const args = { apply: false, production: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--apply" || key === "--production") args[key.slice(2)] = true;
    else if (["--project", "--stake", "--activity", "--backup"].includes(key)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`Valore mancante: ${key}`);
      args[key.slice(2)] = value;
    } else throw new Error(`Argomento sconosciuto: ${key}`);
  }
  for (const key of ["project", "stake", "activity"]) {
    if (!/^[A-Za-z0-9_-]+$/.test(args[key] || "")) throw new Error(`Parametro obbligatorio o non valido: --${key}`);
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    if (!args.project.startsWith("demo-") || args.production) throw new Error("Emulatore: usare solo un progetto demo-*.");
  } else if (args.project !== "giovani-palo" || (args.apply && !args.production)) {
    throw new Error("Produzione: progetto giovani-palo e --production per applicare.");
  }
  if (args.apply && (!args.backup || !isAbsolute(args.backup))) throw new Error("--apply richiede --backup con percorso assoluto.");
  if (args.apply) {
    const repoRoot = realpathSync(resolve(__dirname, "../.."));
    const directory = realpathSync(dirname(args.backup));
    const inside = relative(repoRoot, directory);
    if (!inside || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) throw new Error("Il backup contiene dati personali: salvarlo fuori dal repository.");
  }
  return args;
}

function buildPlan(records, entries, requests, nowIso) {
  const wanted = new Set(IDEAS.map((idea) => idea.id));
  if (wanted.size !== IDEAS.length) throw new Error("Id duplicati nell'elenco dello staff.");
  const removed = records.filter((record) => !wanted.has(record.id));
  const removedIds = new Set(removed.map((record) => record.id));
  // Una richiesta ospite collegata va gestita con Scollega dalla UI: non
  // alteriamo la macchina a stati né sveliamo identità con questo script.
  if (requests.some((request) => removedIds.has(request.recordId) && ["open", "linked"].includes(request.status))) {
    throw new Error("Richieste ospiti su record da togliere: gestirle prima dalla coda staff.");
  }
  const hides = removed.filter((record) => record.status !== "hidden" || record.challengerCount !== 0 || record.featured === true)
    .map((record) => ({ id: record.id, patch: { status: "hidden", featured: false, challengerCount: 0, updatedAt: nowIso } }));
  const withdrawals = planHideRecord(entries.filter((entry) => removedIds.has(entry.recordId)), nowIso).patches;
  const upserts = IDEAS.map((idea) => {
    const fields = parseRecordFields({ ...idea, durationSeconds: idea.durationSeconds ?? null, featured: true }, { keepNotesWhenMissing: false });
    const existing = records.find((record) => record.id === idea.id);
    const challengerCount = entries.filter((entry) => entry.recordId === idea.id && entry.status === "approved").length;
    const data = { ...fields, status: "open", challengerCount, updatedAt: nowIso };
    if (!existing) Object.assign(data, { createdFromEntryId: null, createdAt: nowIso, createdBy: "system" });
    const changed = !existing || Object.entries(data).some(([key, value]) => key !== "updatedAt" && existing[key] !== value);
    return { id: idea.id, data, create: !existing, changed };
  }).filter((row) => row.changed);
  if (hides.length + withdrawals.length + upserts.length > 450) throw new Error("Troppi documenti: nessuna scrittura eseguita.");
  return { hides, withdrawals, upserts, visible: IDEAS.map(({ id, title }) => ({ id, title })) };
}

function rows(snapshot) {
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
}

function fingerprint(snapshot) {
  return snapshot.docs.map((doc) => `${doc.id}:${doc.updateTime.toDate().toISOString()}:${doc.updateTime.nanoseconds}`).sort().join("\n");
}

async function readState(reader, activityRef) {
  const activity = await reader.get(activityRef);
  if (!activity.exists || activity.data().recordsEnabled !== true) throw new Error("Attività inesistente o record disabilitati.");
  const records = await reader.get(activityRef.collection("records"));
  const entries = await reader.get(activityRef.collection("recordEntries"));
  const requests = await reader.get(activityRef.collection("recordRequests"));
  return { activity, records, entries, requests };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  initializeApp({ projectId: args.project, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
  const db = getFirestore();
  const activityRef = db.doc(`stakes/${args.stake}/activities/${args.activity}`);
  const reader = { get: (ref) => ref.get() };
  const before = await readState(reader, activityRef);
  const nowIso = new Date().toISOString();
  const plan = buildPlan(rows(before.records), rows(before.entries), rows(before.requests), nowIso);
  console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry-run", project: args.project, path: activityRef.path, hidden: plan.hides.length, withdrawn: plan.withdrawals.length, written: plan.upserts.length, visible: plan.visible }, null, 2));
  if (!args.apply) return;
  // Backup privato prima di qualunque scrittura. Non sovrascrive un backup.
  writeFileSync(args.backup, JSON.stringify({ project: args.project, path: activityRef.path, savedAt: nowIso, records: rows(before.records), entries: rows(before.entries), requests: rows(before.requests) }, null, 2), { flag: "wx", mode: 0o600 });
  await db.runTransaction(async (tx) => {
    const current = await readState(tx, activityRef);
    if (!current.activity.updateTime.isEqual(before.activity.updateTime) || ["records", "entries", "requests"].some((key) => fingerprint(current[key]) !== fingerprint(before[key]))) {
      throw new Error("Dati cambiati dopo il backup: nessuna scrittura. Ripetere il dry-run.");
    }
    for (const row of plan.hides) tx.update(activityRef.collection("records").doc(row.id), row.patch);
    for (const row of plan.withdrawals) tx.update(activityRef.collection("recordEntries").doc(row.id), row.patch);
    for (const row of plan.upserts) {
      const ref = activityRef.collection("records").doc(row.id);
      if (row.create) tx.create(ref, row.data);
      else tx.update(ref, row.data);
    }
  });
  const after = await activityRef.collection("records").where("status", "==", "open").get();
  const actual = rows(after).map((record) => record.id).sort();
  const expected = IDEAS.map((idea) => idea.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Verifica finale: l'elenco aperto è diverso dai 10 record previsti.");
  console.log(`Verificati ${after.size} record aperti. Backup: ${args.backup}`);
}

module.exports = { buildPlan, parseArgs, main };
if (require.main === module) main().then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); });
