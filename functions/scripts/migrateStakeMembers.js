#!/usr/bin/env node
/*
 * Migrazione A3 dell'appartenenza al palo (docs/APPARTENENZA_AL_PALO.md,
 * "Migrazione"): crea `stakes/{stakeId}/members/{uid}` per ogni profilo con
 * `users.stakeId == stakeId` che non ce l'ha ancora.
 *   - admin e dirigenti di unità: `active` con `staffRole`;
 *   - participant/parent con un'iscrizione non annullata nel palo (propria, di
 *     un figlio, o da ospite poi collegato): `active` con `reviewNeeded: true`;
 *   - gli altri: `pending`.
 * Idempotente: un documento members esistente non si tocca mai, e la scrittura
 * usa `create()`, che fallisce se nel frattempo il documento è nato.
 * Di default è un dry-run che stampa solo conteggi. Va eseguita PRIMA delle
 * rules che leggono members, altrimenti nessuno vede la galleria.
 *
 * Uso:
 *   node scripts/migrateStakeMembers.js --stake roma-est
 *   node scripts/migrateStakeMembers.js --stake roma-est --report /percorso/privato/piano.json
 *   node scripts/migrateStakeMembers.js --stake roma-est --apply
 *
 * Emulatore: FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 GCLOUD_PROJECT=demo-room-planner
 * Produzione: GOOGLE_APPLICATION_CREDENTIALS o ADC, e conferma esplicita di Paolo.
 */

const fs = require("node:fs");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const { planStakeMemberMigration } = require("../lib/stakeMembership");

const MIGRATION_REF = "a3-2026-10";
const BATCH_SIZE = 400;

function parseArgs(argv) {
  const out = { stake: null, apply: false, report: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--stake") out.stake = argv[++i];
    else if (a === "--report") out.report = argv[++i];
    else {
      console.error(`Argomento sconosciuto: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

async function readState(db, stakeId) {
  const stakeRef = db.doc(`stakes/${stakeId}`);
  const [stake, usersSnap, activitiesSnap, membersSnap] = await Promise.all([
    stakeRef.get(),
    db.collection("users").where("stakeId", "==", stakeId).get(),
    stakeRef.collection("activities").select("title").get(),
    stakeRef.collection("members").select().get(),
  ]);
  if (!stake.exists) throw new Error(`Palo non trovato: stakes/${stakeId}`);
  const users = usersSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: doc.id,
      role: data.role,
      stakeId: data.stakeId,
      unitId: data.unitId,
      unitName: data.unitName,
      fullName: data.fullName,
      firstName: data.firstName,
      lastName: data.lastName,
      birthDate: data.birthDate,
    };
  });
  const activityTitles = new Map(activitiesSnap.docs.map((doc) => [doc.id, doc.get("title")]));
  const registrations = [];
  for (const activity of activitiesSnap.docs) {
    const snap = await activity.ref
      .collection("registrations")
      .select("userId", "parentUid", "anonymousUid", "registrationStatus")
      .get();
    for (const doc of snap.docs) registrations.push({ activityId: activity.id, ...doc.data() });
  }
  const existingMemberUids = new Set(membersSnap.docs.map((doc) => doc.id));
  return { users, registrations, activityTitles, existingMemberUids };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.stake || args.stake.includes("/")) {
    console.error("Serve --stake <stakeId>: nessun default.");
    process.exit(1);
  }

  initializeApp(
    process.env.FIRESTORE_EMULATOR_HOST
      ? { projectId: process.env.GCLOUD_PROJECT || "demo-room-planner" }
      : { credential: applicationDefault() },
  );
  const db = getFirestore();
  const state = await readState(db, args.stake);
  const plan = planStakeMemberMigration({
    stakeId: args.stake,
    ...state,
    at: FieldValue.serverTimestamp(),
    migrationRef: MIGRATION_REF,
  });

  console.log(
    JSON.stringify({
      mode: args.apply ? "apply" : "dry-run",
      project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "(adc)",
      stake: args.stake,
      users: state.users.length,
      registrations: state.registrations.length,
      ...plan.counts,
      toCreate: plan.toCreate.length,
    }),
  );

  if (args.report) {
    // Il piano con gli uid resta fuori dal repo e fuori dal terminale.
    const rows = plan.toCreate.map(({ uid, doc }) => ({
      uid,
      status: doc.status,
      staffRole: doc.staffRole,
      reviewNeeded: doc.reviewNeeded,
      claimedUnitId: doc.claimedUnitId,
      hints: doc.registrationHints.length,
    }));
    fs.writeFileSync(args.report, JSON.stringify({ stake: args.stake, counts: plan.counts, rows }, null, 2), {
      mode: 0o600,
    });
    console.log(`Piano scritto in ${args.report}`);
  }

  if (!args.apply) return;

  let created = 0;
  let raced = 0;
  for (let i = 0; i < plan.toCreate.length; i += BATCH_SIZE) {
    const chunk = plan.toCreate.slice(i, i + BATCH_SIZE);
    // Una create per documento, non un batch: se una fallisce perché il
    // documento è nato nel frattempo (callable, trigger), le altre vanno.
    const results = await Promise.allSettled(
      chunk.map(({ uid, doc }) => db.doc(`stakes/${args.stake}/members/${uid}`).create(doc)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") created += 1;
      else if (result.reason && result.reason.code === 6) raced += 1; // ALREADY_EXISTS
      else throw result.reason;
    }
  }
  console.log(JSON.stringify({ created, alreadyExisting: raced }));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
