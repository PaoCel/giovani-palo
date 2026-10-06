#!/usr/bin/env node
// Dati demo sintetici con i 4 ruoli (admin, dirigente di unita', partecipante,
// genitore). Dry-run di default. Mai su produzione: accetta solo emulatori
// demo-* o progetti *-staging / *-demo (guardie in tools/lib/target.mjs).
//
//   Emulatori (firebase.multistake-test.json, progetto demo-room-planner):
//     GCLOUD_PROJECT=demo-room-planner FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 \
//     FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 node tools/seed-demo.mjs --apply
//   Staging (ADC attive, DEMO_PASSWORD obbligatoria):
//     DEMO_PASSWORD=... DEMO_PARENT_EMAIL=tuo+genitore@... \
//       node tools/seed-demo.mjs --project giovani-palo-staging --apply
//
// Opzioni: --reset (cancella prima tutto il palo demo, Storage compreso),
// --today YYYY-MM-DD (le date sono relative: stessa data, stessi documenti),
// --keep-alerts (non toglie gli avvisi "Nuovo iscritto" generati dal trigger).
// Variabili: DEMO_PASSWORD (min 12 caratteri, obbligatoria fuori dagli
// emulatori), DEMO_PARENT_EMAIL (casella vera per le copie firmate),
// DEMO_APP_URL (per il link di firma stampato).
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

import { initAdmin, resolveTarget } from "./lib/target.mjs";
import { DEMO_ACCOUNTS, DEMO_STAKE_ID, resetDemo, seedDemo } from "./lib/demoData.mjs";

const require = createRequire(new URL("../functions/package.json", import.meta.url));

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    apply: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    today: { type: "string" },
    "keep-alerts": { type: "boolean", default: false },
  },
});

try {
  const target = resolveTarget({ kind: "seed", project: values.project, needsStorage: values.reset });

  const password = process.env.DEMO_PASSWORD || (target.emulator ? "Demo-2026!" : "");
  if (values.apply && password.length < 12 && !target.emulator) {
    throw new Error("DEMO_PASSWORD obbligatoria (min 12 caratteri) fuori dagli emulatori.");
  }
  const parentEmail = (process.env.DEMO_PARENT_EMAIL || "").trim();
  const appUrl = process.env.DEMO_APP_URL || (target.emulator ? "http://localhost:5173" : "https://demo.gugditalia.it");
  const today = values.today || new Date().toISOString().slice(0, 10);

  initAdmin(target);
  const { getFirestore } = require("firebase-admin/firestore");
  const { getAuth } = require("firebase-admin/auth");
  const { getStorage } = require("firebase-admin/storage");
  const ctx = { db: getFirestore(), auth: getAuth() };

  console.log(`Progetto: ${target.projectId}${target.emulator ? " (emulatore)" : ""} · palo ${DEMO_STAKE_ID}`);

  if (values.reset) {
    const resetResult = await resetDemo({ ...ctx, bucket: getStorage().bucket() }, { parentEmail, apply: values.apply });
    console.log(`${resetResult.applied ? "Reset eseguito" : "Reset (dry-run)"}:`, JSON.stringify(resetResult.plan, null, 2));
  }

  const result = await seedDemo(ctx, {
    today,
    parentEmail,
    appUrl,
    password,
    apply: values.apply,
    keepAlerts: values["keep-alerts"],
  });
  console.log(JSON.stringify(result.summary, null, 2));
  if (!result.applied) {
    console.log("\nDry-run: nessuna scrittura. Aggiungi --apply.");
  } else {
    console.log(`\nSeed completato. Avvisi "Nuovo iscritto" tolti: ${result.clearedAlerts}.`);
    console.log("Login: " + Object.entries(DEMO_ACCOUNTS).map(([role, account]) => `${role}=${account.email}`).join(" · "));
    console.log(`Password: ${target.emulator && !process.env.DEMO_PASSWORD ? password : "(DEMO_PASSWORD)"}`);
    console.log(`Link di firma genitore (Matteo): ${result.magicLink}`);
    if (!parentEmail) console.log("DEMO_PARENT_EMAIL non impostata: le copie firmate vanno a un indirizzo .invalid (nessuna mail reale).");
  }
} catch (error) {
  console.error(`ERRORE: ${error.message}`);
  process.exit(1);
}
