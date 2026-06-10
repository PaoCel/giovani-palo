#!/usr/bin/env node
/**
 * Backfill unitId su utenti e iscrizioni a partire dal nome unità.
 *
 * I dirigenti di unità ora leggono solo documenti filtrati per unitId:
 * i documenti storici che hanno solo il nome dell'unità (unitName /
 * unitNameSnapshot) ma unitId vuoto resterebbero invisibili. Questo script
 * risolve il nome contro stakes/{stakeId}/units e scrive l'id mancante.
 *
 * Uso (da functions/, con credenziali admin attive):
 *   node scripts/backfillUnitIds.mjs                 # dry-run, nessuna scrittura
 *   node scripts/backfillUnitIds.mjs --apply         # applica le modifiche
 *   node scripts/backfillUnitIds.mjs --stake roma-est
 *
 * Credenziali: GOOGLE_APPLICATION_CREDENTIALS oppure
 *   gcloud auth application-default login
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const stakeArgIndex = process.argv.indexOf("--stake");
const ONLY_STAKE = stakeArgIndex >= 0 ? process.argv[stakeArgIndex + 1] : null;

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const normalize = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

const stats = {
  usersScanned: 0,
  usersToFix: 0,
  usersUnmatched: 0,
  registrationsScanned: 0,
  registrationsToFix: 0,
  registrationsUnmatched: 0,
  written: 0,
};

async function loadUnitsByName(stakeId) {
  const snapshot = await db.collection(`stakes/${stakeId}/units`).get();
  const byName = new Map();
  for (const doc of snapshot.docs) {
    const name = normalize(doc.data().name);
    if (name) byName.set(name, doc.id);
  }
  return byName;
}

async function backfillUsers(stakeId, unitsByName) {
  const snapshot = await db.collection("users").where("stakeId", "==", stakeId).get();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    stats.usersScanned++;
    if (typeof data.unitId === "string" && data.unitId) continue;
    const name = normalize(data.unitName);
    if (!name) continue;
    const unitId = unitsByName.get(name);
    if (!unitId) {
      stats.usersUnmatched++;
      console.log(`  [users] NESSUN MATCH ${doc.id} unitName="${data.unitName}"`);
      continue;
    }
    stats.usersToFix++;
    console.log(`  [users] ${APPLY ? "FIX" : "dry-run"} ${doc.id} unitName="${data.unitName}" -> unitId=${unitId}`);
    if (APPLY) {
      await doc.ref.update({ unitId, updatedAt: new Date().toISOString() });
      stats.written++;
    }
  }
}

async function backfillRegistrations(stakeId, unitsByName) {
  const activities = await db.collection(`stakes/${stakeId}/activities`).get();
  for (const activity of activities.docs) {
    const registrations = await activity.ref.collection("registrations").get();
    for (const doc of registrations.docs) {
      const data = doc.data();
      stats.registrationsScanned++;
      if (typeof data.unitId === "string" && data.unitId) continue;
      const name = normalize(data.unitNameSnapshot);
      if (!name) continue;
      const unitId = unitsByName.get(name);
      if (!unitId) {
        stats.registrationsUnmatched++;
        console.log(`  [regs] NESSUN MATCH ${activity.id}/${doc.id} unitNameSnapshot="${data.unitNameSnapshot}"`);
        continue;
      }
      stats.registrationsToFix++;
      console.log(`  [regs] ${APPLY ? "FIX" : "dry-run"} ${activity.id}/${doc.id} -> unitId=${unitId}`);
      if (APPLY) {
        await doc.ref.update({ unitId, updatedAt: new Date().toISOString() });
        stats.written++;
      }
    }
  }
}

async function main() {
  console.log(`Backfill unitId — modalità: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const stakesSnapshot = ONLY_STAKE
    ? { docs: [await db.doc(`stakes/${ONLY_STAKE}`).get()] }
    : await db.collection("stakes").get();

  for (const stakeDoc of stakesSnapshot.docs) {
    if (!stakeDoc.exists) {
      console.error(`Stake non trovato: ${ONLY_STAKE}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nStake: ${stakeDoc.id}`);
    const unitsByName = await loadUnitsByName(stakeDoc.id);
    if (unitsByName.size === 0) {
      console.log("  Nessuna unità definita, salto.");
      continue;
    }
    await backfillUsers(stakeDoc.id, unitsByName);
    await backfillRegistrations(stakeDoc.id, unitsByName);
  }

  console.log("\nRiepilogo:");
  console.log(`  utenti analizzati:        ${stats.usersScanned}`);
  console.log(`  utenti da correggere:     ${stats.usersToFix}`);
  console.log(`  utenti senza match:       ${stats.usersUnmatched}`);
  console.log(`  iscrizioni analizzate:    ${stats.registrationsScanned}`);
  console.log(`  iscrizioni da correggere: ${stats.registrationsToFix}`);
  console.log(`  iscrizioni senza match:   ${stats.registrationsUnmatched}`);
  console.log(`  scritture eseguite:       ${stats.written}${APPLY ? "" : " (dry-run)"}`);
}

main().catch((error) => {
  console.error("Backfill fallito:", error);
  process.exitCode = 1;
});
