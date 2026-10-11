#!/usr/bin/env node
/*
 * Crea le "idee dello staff" della Notte dei Record (lib/recordNightIdeas.js).
 * Ogni idea è un record `open` con `featured: true` e zero iscritti, id fisso.
 * Idempotente: se un record con quell'id esiste già non lo tocca (le modifiche
 * dello staff restano). Di default è un dry-run.
 *
 * Uso:
 *   node scripts/seedRecordNightIdeas.js --stake roma-est --activity <activityId>
 *   node scripts/seedRecordNightIdeas.js --stake roma-est --activity <activityId> --apply
 *
 * Emulatore: FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 GCLOUD_PROJECT=demo-room-planner
 * Produzione: GOOGLE_APPLICATION_CREDENTIALS o `gcloud auth application-default login`.
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const { IDEAS } = require("../lib/recordNightIdeas");
const { parseRecordFields } = require("../lib/recordNight");

function parseArgs(argv) {
  const out = { stake: null, activity: null, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--stake") out.stake = argv[++i];
    else if (a === "--activity") out.activity = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.stake || !args.activity) {
    console.error("Servono --stake <stakeId> e --activity <activityId>: nessun default.");
    process.exit(1);
  }

  // Stessa validazione della callable: titolo, note, misura, secondi.
  const rows = IDEAS.map((idea) => {
    const fields = parseRecordFields(
      { ...idea, durationSeconds: idea.durationSeconds ?? null, featured: true },
      { keepNotesWhenMissing: false },
    );
    return { id: idea.id, fields };
  });

  initializeApp(
    process.env.FIRESTORE_EMULATOR_HOST
      ? { projectId: process.env.GCLOUD_PROJECT || "demo-room-planner" }
      : { credential: applicationDefault() },
  );
  const db = getFirestore();
  const activityRef = db.doc(`stakes/${args.stake}/activities/${args.activity}`);
  const activity = await activityRef.get();
  if (!activity.exists) {
    console.error(`Attività non trovata: stakes/${args.stake}/activities/${args.activity}`);
    process.exit(1);
  }
  console.log(`Attività: ${activity.data().title || args.activity} (recordsEnabled=${activity.data().recordsEnabled === true})`);

  const recordsRef = activityRef.collection("records");
  const nowIso = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  for (const { id, fields } of rows) {
    const ref = recordsRef.doc(id);
    const data = {
      title: fields.title,
      category: fields.category,
      measure: fields.measure,
      durationSeconds: fields.durationSeconds,
      notes: fields.notes,
      challengerCount: 0,
      featured: true,
      status: "open",
      createdFromEntryId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: "system",
    };
    if (!args.apply) {
      const exists = (await ref.get()).exists;
      console.log(`${exists ? "ESISTE " : "NUOVO  "} ${id}  [${data.category}] ${data.title}`);
      if (exists) skipped++;
      else created++;
      continue;
    }
    try {
      await ref.create(data);
      created++;
      console.log(`creato  ${id}`);
    } catch (error) {
      if (error && (error.code === 6 || /already exists/i.test(String(error.message)))) {
        skipped++;
        console.log(`esiste  ${id} (non toccato)`);
      } else {
        throw error;
      }
    }
  }
  console.log(`\n${args.apply ? "Creati" : "Da creare"}: ${created} · già presenti: ${skipped}${args.apply ? "" : " · dry-run, niente scritto (--apply per scrivere)"}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
