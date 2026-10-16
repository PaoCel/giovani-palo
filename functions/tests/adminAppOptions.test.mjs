// adminAppOptions(env): le opzioni che functions/index.js passa a initializeApp().
// In produzione (progetto `giovani-palo`, fuori dall'emulatore) i file stanno nel
// bucket UE `giovani-palo-eu`; ovunque altrove (staging, demo-*, emulatore,
// progetto non determinabile) deve restare undefined, cioè il bucket di default.
//
// Rilancio: node --test functions/tests/adminAppOptions.test.mjs
// Tutte le funzioni ricevono `env` esplicito: process.env non si tocca.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PRODUCTION_STORAGE_BUCKET, adminAppOptions } = require("../lib/config.js");

const BUCKET_UE = "giovani-palo-eu";

// Quello che la piattaforma Firebase mette in FIREBASE_CONFIG in produzione:
// il bucket di default (us-central1) è proprio quello che l'override sostituisce.
const firebaseConfigProd = (extra = {}) =>
  JSON.stringify({
    projectId: "giovani-palo",
    storageBucket: "giovani-palo.firebasestorage.app",
    databaseURL: "https://giovani-palo-default-rtdb.firebaseio.com",
    ...extra,
  });

test("la costante del bucket di produzione è il bucket UE", () => {
  assert.equal(PRODUCTION_STORAGE_BUCKET, BUCKET_UE);
});

test("produzione: storageBucket UE e projectId conservato da FIREBASE_CONFIG", () => {
  const options = adminAppOptions({
    GCLOUD_PROJECT: "giovani-palo",
    FIREBASE_CONFIG: firebaseConfigProd(),
  });
  assert.equal(options.storageBucket, BUCKET_UE);
  assert.equal(options.projectId, "giovani-palo");
});

test("produzione: le altre opzioni della piattaforma restano, il vecchio bucket è sostituito", () => {
  const options = adminAppOptions({
    GCLOUD_PROJECT: "giovani-palo",
    FIREBASE_CONFIG: firebaseConfigProd(),
  });
  assert.deepEqual(options, {
    projectId: "giovani-palo",
    storageBucket: BUCKET_UE,
    databaseURL: "https://giovani-palo-default-rtdb.firebaseio.com",
  });
  assert.notEqual(options.storageBucket, "giovani-palo.firebasestorage.app");
});

test("produzione riconosciuta anche solo da FIREBASE_CONFIG (senza GCLOUD_PROJECT)", () => {
  const options = adminAppOptions({ FIREBASE_CONFIG: firebaseConfigProd() });
  assert.equal(options.storageBucket, BUCKET_UE);
  assert.equal(options.projectId, "giovani-palo");
});

test("produzione riconosciuta anche da GOOGLE_CLOUD_PROJECT e con spazi attorno al nome", () => {
  assert.equal(adminAppOptions({ GOOGLE_CLOUD_PROJECT: "giovani-palo" }).storageBucket, BUCKET_UE);
  assert.equal(adminAppOptions({ GCLOUD_PROJECT: "  giovani-palo " }).storageBucket, BUCKET_UE);
});

test("produzione senza FIREBASE_CONFIG: solo il bucket UE", () => {
  assert.deepEqual(adminAppOptions({ GCLOUD_PROJECT: "giovani-palo" }), { storageBucket: BUCKET_UE });
});

test("FIREBASE_CONFIG malformato in produzione: comunque storageBucket UE", () => {
  for (const broken of ["{non json", "", "{", "undefined", "{\"projectId\": "]) {
    const options = adminAppOptions({ GCLOUD_PROJECT: "giovani-palo", FIREBASE_CONFIG: broken });
    assert.deepEqual(options, { storageBucket: BUCKET_UE }, `FIREBASE_CONFIG = ${JSON.stringify(broken)}`);
  }
});

test("FIREBASE_CONFIG valido ma non oggetto in produzione: comunque storageBucket UE", () => {
  for (const odd of ["null", "[]", "42", "true"]) {
    const options = adminAppOptions({ GCLOUD_PROJECT: "giovani-palo", FIREBASE_CONFIG: odd });
    assert.deepEqual(options, { storageBucket: BUCKET_UE }, `FIREBASE_CONFIG = ${odd}`);
  }
});

test("un storageBucket diverso in FIREBASE_CONFIG viene sempre sovrascritto con quello UE", () => {
  const options = adminAppOptions({
    GCLOUD_PROJECT: "giovani-palo",
    FIREBASE_CONFIG: firebaseConfigProd({ storageBucket: "un-altro-bucket" }),
  });
  assert.equal(options.storageBucket, BUCKET_UE);
});

test("emulatore delle functions con progetto giovani-palo: undefined (bucket di default dell'emulatore)", () => {
  for (const flag of ["true", "TRUE", "True"]) {
    const env = { GCLOUD_PROJECT: "giovani-palo", FUNCTIONS_EMULATOR: flag, FIREBASE_CONFIG: firebaseConfigProd() };
    assert.equal(adminAppOptions(env), undefined, `FUNCTIONS_EMULATOR=${flag}`);
  }
});

test("FUNCTIONS_EMULATOR diverso da true non basta a spegnere il bucket UE", () => {
  for (const flag of ["false", "", "0", "1"]) {
    const env = { GCLOUD_PROJECT: "giovani-palo", FUNCTIONS_EMULATOR: flag };
    assert.equal(adminAppOptions(env)?.storageBucket, BUCKET_UE, `FUNCTIONS_EMULATOR=${JSON.stringify(flag)}`);
  }
});

test("staging (giovani-palo-staging): undefined, con o senza FIREBASE_CONFIG", () => {
  assert.equal(adminAppOptions({ GCLOUD_PROJECT: "giovani-palo-staging" }), undefined);
  assert.equal(
    adminAppOptions({
      GCLOUD_PROJECT: "giovani-palo-staging",
      FIREBASE_CONFIG: JSON.stringify({
        projectId: "giovani-palo-staging",
        storageBucket: "giovani-palo-staging.firebasestorage.app",
      }),
    }),
    undefined,
  );
  assert.equal(
    adminAppOptions({ FIREBASE_CONFIG: JSON.stringify({ projectId: "giovani-palo-staging" }) }),
    undefined,
  );
});

test("GCLOUD_PROJECT di staging vince su un FIREBASE_CONFIG di produzione: undefined", () => {
  const env = { GCLOUD_PROJECT: "giovani-palo-staging", FIREBASE_CONFIG: firebaseConfigProd() };
  assert.equal(adminAppOptions(env), undefined);
});

test("progetti che somigliano alla produzione non prendono il bucket UE", () => {
  for (const project of ["demo-gallery-test", "demo-giovani-palo", "giovani-palo2", "giovani-palo-eu", "Giovani-Palo", "giovani-palo-staging"]) {
    assert.equal(adminAppOptions({ GCLOUD_PROJECT: project }), undefined, project);
  }
});

test("progetto non determinabile: undefined", () => {
  assert.equal(adminAppOptions({}), undefined);
  assert.equal(adminAppOptions({ GCLOUD_PROJECT: "", GOOGLE_CLOUD_PROJECT: "  " }), undefined);
  assert.equal(adminAppOptions({ FIREBASE_CONFIG: "{}" }), undefined);
  assert.equal(adminAppOptions({ FIREBASE_CONFIG: JSON.stringify({ storageBucket: "giovani-palo.firebasestorage.app" }) }), undefined);
  assert.equal(adminAppOptions({ FIREBASE_CONFIG: JSON.stringify({ projectId: 42 }) }), undefined);
});

test("progetto non determinabile con FIREBASE_CONFIG malformato: undefined (mai il bucket UE a caso)", () => {
  assert.equal(adminAppOptions({ FIREBASE_CONFIG: "{non json" }), undefined);
  assert.equal(adminAppOptions({ FUNCTIONS_EMULATOR: "true", FIREBASE_CONFIG: "{" }), undefined);
});

test("non muta l'env ricevuto e restituisce un oggetto nuovo a ogni chiamata", () => {
  const env = Object.freeze({
    GCLOUD_PROJECT: "giovani-palo",
    FIREBASE_CONFIG: firebaseConfigProd(),
  });
  const first = adminAppOptions(env);
  const second = adminAppOptions(env);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  first.storageBucket = "modificato";
  assert.equal(adminAppOptions(env).storageBucket, BUCKET_UE);
  assert.equal(env.FIREBASE_CONFIG, firebaseConfigProd());
});

test("functions/index.js passa adminAppOptions() a initializeApp (collegamento non perso)", () => {
  const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(source, /require\("\.\/lib\/config"\)/u);
  assert.match(source, /\binitializeApp\(adminAppOptions\(\)\)/u);
  assert.doesNotMatch(source, /\binitializeApp\(\s*\)/u, "initializeApp() senza opzioni lascerebbe il bucket di default");
});
