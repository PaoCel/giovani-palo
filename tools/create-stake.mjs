#!/usr/bin/env node
// Crea un palo (doc stake + unita' + primo admin). Dry-run di default.
//
//   node tools/create-stake.mjs --project giovani-palo-staging --id palo-napoli \
//     --name "Palo di Napoli" --unit "Rione Vomero" --unit "Ramo Posillipo:ramo" \
//     --admin-email presidente@example.org --admin-first Mario --admin-last Rossi \
//     --admin-unit "Rione Vomero" --admin-birth-date 1975-06-15
//
// Aggiungere --apply per scrivere. Credenziali: GOOGLE_APPLICATION_CREDENTIALS
// o `gcloud auth application-default login` (ADC). Produzione: --production e
// CONFIRM_PROJECT=giovani-palo. Emulatori: FIRESTORE_EMULATOR_HOST e
// FIREBASE_AUTH_EMULATOR_HOST locali, progetto demo-*.
//
// L'admin va assegnato a un'unita' (default la prima): non puo' cambiarla da
// solo e il completamento profilo la richiede. Senza --admin-birth-date mette
// 1980-01-01 come segnaposto (da correggere in /me).
// Il primo admin non riceve una password: in remoto lo script stampa il link
// per sceglierla. Con gli emulatori --admin-password la imposta (solo test).
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

import { initAdmin, resolveTarget, TargetError } from "./lib/target.mjs";
import { createStake } from "./lib/stakes.mjs";

const require = createRequire(new URL("../functions/package.json", import.meta.url));

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    id: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
    "support-contact": { type: "string" },
    unit: { type: "string", multiple: true },
    "admin-email": { type: "string" },
    "admin-first": { type: "string" },
    "admin-last": { type: "string" },
    "admin-unit": { type: "string" },
    "admin-birth-date": { type: "string" },
    "admin-password": { type: "string" },
    apply: { type: "boolean", default: false },
    production: { type: "boolean", default: false },
  },
});

try {
  const target = resolveTarget({
    kind: "stake",
    project: values.project,
    allowProduction: values.production,
  });
  if (values["admin-password"] && !target.emulator) {
    throw new TargetError("--admin-password e' ammesso solo con gli emulatori.");
  }

  initAdmin(target);
  const { getFirestore } = require("firebase-admin/firestore");
  const { getAuth } = require("firebase-admin/auth");

  const units = (values.unit || []).map((entry) => {
    const [unitName, type] = entry.split(":");
    return { name: unitName, type };
  });

  const result = await createStake(
    { db: getFirestore(), auth: getAuth() },
    {
      stakeId: values.id,
      name: values.name,
      slug: values.slug,
      supportContact: values["support-contact"],
      units,
      admin: values["admin-email"]
        ? {
            email: values["admin-email"],
            firstName: values["admin-first"],
            lastName: values["admin-last"],
            unit: values["admin-unit"],
            birthDate: values["admin-birth-date"],
            password: values["admin-password"],
          }
        : undefined,
      apply: values.apply,
    },
  );

  console.log(`Progetto: ${target.projectId}${target.emulator ? " (emulatore)" : ""}`);
  console.log(JSON.stringify(result.plan, null, 2));
  if (!result.applied) {
    console.log("\nDry-run: nessuna scrittura. Aggiungi --apply.");
  } else {
    console.log(`\nPalo "${values.id}" creato.`);
    if (result.passwordResetLink) {
      console.log(`Link per scegliere la password (da girare all'admin):\n${result.passwordResetLink}`);
    }
  }
} catch (error) {
  console.error(`ERRORE: ${error.message}`);
  process.exit(1);
}
