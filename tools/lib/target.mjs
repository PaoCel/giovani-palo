// Guardie condivise dagli script `tools/*.mjs` che scrivono dati (create-stake,
// seed-demo). Decide DOVE scrivono e rifiuta tutto ciò che non è chiaramente
// il bersaglio voluto: un Admin SDK ignora le rules, quindi qui non c'è una
// seconda difesa.
import { createRequire } from "node:module";

const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const { getApps, initializeApp } = require("firebase-admin/app");

export const PRODUCTION_PROJECT_ID = "giovani-palo";

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

export class TargetError extends Error {}

/**
 * @param {object} options
 * @param {"seed"|"stake"} options.kind
 *   seed  = dati sintetici: mai produzione, solo emulatore demo-* o progetti `*-staging`/`*-demo`.
 *   stake = dati veri di un palo: qualunque progetto, ma produzione solo con
 *           `allowProduction` e CONFIRM_PROJECT uguale all'id progetto.
 * @param {string|undefined} options.project valore di --project
 * @param {boolean} options.allowProduction
 * @param {boolean} options.needsStorage lo script tocca anche Storage
 */
export function resolveTarget({ kind, project, allowProduction = false, needsStorage = false, env = process.env }) {
  const firestoreHost = env.FIRESTORE_EMULATOR_HOST || "";
  const authHost = env.FIREBASE_AUTH_EMULATOR_HOST || "";
  const storageHost = env.FIREBASE_STORAGE_EMULATOR_HOST || "";
  const envProject = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || "";
  const projectId = project || envProject;

  if (!projectId) {
    throw new TargetError("Progetto non indicato: usa --project <id> (o GCLOUD_PROJECT).");
  }
  if (project && envProject && project !== envProject) {
    throw new TargetError(`--project ${project} contraddice GCLOUD_PROJECT=${envProject}.`);
  }

  const anyEmulator = firestoreHost || authHost || storageHost;
  if (anyEmulator) {
    // Emulatore: tutti i servizi usati devono essere locali, altrimenti una
    // parte delle scritture finirebbe sul progetto vero.
    const missing = [
      ["FIRESTORE_EMULATOR_HOST", firestoreHost],
      ["FIREBASE_AUTH_EMULATOR_HOST", authHost],
      ...(needsStorage ? [["FIREBASE_STORAGE_EMULATOR_HOST", storageHost]] : []),
    ].filter(([, value]) => !value);
    if (missing.length) {
      throw new TargetError(`Emulatore parziale: mancano ${missing.map(([name]) => name).join(", ")}.`);
    }
    for (const host of [firestoreHost, authHost, storageHost].filter(Boolean)) {
      if (!LOOPBACK.test(host)) throw new TargetError(`Host emulatore non locale: ${host}`);
    }
    if (!projectId.startsWith("demo-")) {
      throw new TargetError(`Con gli emulatori il progetto deve essere demo-*, trovato ${projectId}.`);
    }
    return { projectId, emulator: true };
  }

  if (projectId.startsWith("demo-")) {
    throw new TargetError(`${projectId} è un progetto emulatore: avvia gli emulatori e imposta gli host.`);
  }

  if (kind === "seed") {
    if (projectId === PRODUCTION_PROJECT_ID) {
      throw new TargetError("seed-demo non scrive mai sul progetto di produzione.");
    }
    if (!/-(staging|demo)$/.test(projectId)) {
      throw new TargetError(`seed-demo accetta solo progetti *-staging o *-demo, trovato ${projectId}.`);
    }
    return { projectId, emulator: false };
  }

  if (projectId === PRODUCTION_PROJECT_ID) {
    if (!allowProduction) {
      throw new TargetError("Progetto di produzione: serve --production.");
    }
    if (env.CONFIRM_PROJECT !== projectId) {
      throw new TargetError(`Produzione: imposta CONFIRM_PROJECT=${projectId} per confermare.`);
    }
  }
  return { projectId, emulator: false };
}

/** Inizializza l'Admin SDK sul bersaglio già validato (una sola volta). */
export function initAdmin({ projectId, emulator }) {
  if (getApps().length === 0) {
    initializeApp({
      projectId,
      // Emulatore: qualunque nome va bene, coerente con quello delle functions.
      storageBucket: emulator ? `${projectId}.appspot.com` : `${projectId}.firebasestorage.app`,
    });
  }
}
