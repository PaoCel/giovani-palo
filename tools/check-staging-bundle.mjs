#!/usr/bin/env node
// Predeploy di firebase.staging.json: rifiuta di pubblicare `dist-staging/` se
// non e' un bundle di staging pulito. Unico controllo fra la build e
// `firebase deploy` (la CLI deploya qualunque cartella).
//
// Il progetto atteso arriva da GCLOUD_PROJECT (impostato dalla CLI nei hook di
// predeploy, cioe' dal --project del deploy).
import fs from "node:fs";
import path from "node:path";

import { PRODUCTION_SETTINGS } from "../src/services/firebase/productionSettings.ts";

const root = new URL("..", import.meta.url).pathname;
const distDir = path.join(root, "dist-staging");
const project = process.env.GCLOUD_PROJECT || "";
const prod = PRODUCTION_SETTINGS.firebaseConfig;
const problems = [];

if (!project) problems.push("GCLOUD_PROJECT assente: lancia il deploy con --project.");
if (project === prod.projectId) problems.push("Il progetto del deploy e' quello di produzione.");
if (!fs.existsSync(distDir)) problems.push("dist-staging/ non esiste.");

if (!problems.length) {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    );
  const files = walk(distDir);
  const text = (name) => fs.readFileSync(path.join(distDir, name), "utf8");
  const bundles = files.filter((file) => /\.(js|html|webmanifest)$/.test(file)).map((file) => fs.readFileSync(file, "utf8"));
  const everything = bundles.join("\n");

  // authDomain di produzione escluso: compare legittimamente nell'elenco degli
  // host vietati (assertHostMatchesEnvironment). La collisione la blocca la build.
  const forbidden = {
    "apiKey di produzione": prod.apiKey,
    "appId di produzione": prod.appId,
    "messagingSenderId di produzione": prod.messagingSenderId,
    "measurementId di produzione": prod.measurementId,
    "storageBucket di produzione": prod.storageBucket,
    "chiave VAPID di produzione": PRODUCTION_SETTINGS.webPushPublicKey,
  };
  for (const [label, value] of Object.entries(forbidden)) {
    if (value && everything.includes(value)) problems.push(`Il bundle contiene ${label}.`);
  }
  if (!everything.includes(`${project}.firebaseapp.com`)) {
    problems.push(`Il bundle non contiene ${project}.firebaseapp.com: build non fatta per questo progetto?`);
  }

  if (!fs.existsSync(path.join(distDir, "robots.txt")) || !/Disallow:\s*\//.test(text("robots.txt"))) {
    problems.push("robots.txt mancante o non blocca l'indicizzazione.");
  }
  if (!/name="robots"\s+content="noindex/.test(text("index.html"))) problems.push("index.html senza meta robots noindex.");
  if (!/Demo/.test(text("manifest.webmanifest"))) problems.push("manifest.webmanifest senza il nome Demo.");
}

if (problems.length) {
  console.error("Bundle di staging NON pubblicabile:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Bundle di staging ok per ${project}.`);
