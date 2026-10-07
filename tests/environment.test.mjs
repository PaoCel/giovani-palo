import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_PROJECT_ID,
  assertHostMatchesEnvironment,
  resolveAppEnvironment,
  resolveFirebaseSettings,
} from "../src/services/firebase/environment.ts";
import { PRODUCTION_SETTINGS } from "../src/services/firebase/productionSettings.ts";

// Valori di staging inventati e tutti diversi da quelli di produzione.
const STAGING_ENV = {
  MODE: "staging",
  VITE_APP_ENV: "staging",
  VITE_FIREBASE_API_KEY: "AIzaSyStagingChiaveDiProva",
  VITE_FIREBASE_AUTH_DOMAIN: "giovani-palo-staging.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "giovani-palo-staging",
  VITE_FIREBASE_STORAGE_BUCKET: "giovani-palo-staging.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "111111111111",
  VITE_FIREBASE_APP_ID: "1:111111111111:web:0123456789abcdef",
  VITE_FIREBASE_MEASUREMENT_ID: "G-STAGING000",
  VITE_WEB_PUSH_PUBLIC_KEY: "BStagingChiavePushDiProva",
};

const REQUIRED_STAGING_VARS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_WEB_PUSH_PUBLIC_KEY",
];

const staging = (overrides = {}) => ({ ...STAGING_ENV, ...overrides });
const without = (env, ...keys) => {
  const copy = { ...env };
  for (const key of keys) delete copy[key];
  return copy;
};

// Campo dell'env di staging che corrisponde a ogni valore di produzione.
const PRODUCTION_VALUE_BY_ENV_VAR = {
  VITE_FIREBASE_API_KEY: PRODUCTION_SETTINGS.firebaseConfig.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: PRODUCTION_SETTINGS.firebaseConfig.authDomain,
  VITE_FIREBASE_PROJECT_ID: PRODUCTION_SETTINGS.firebaseConfig.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: PRODUCTION_SETTINGS.firebaseConfig.storageBucket,
  VITE_FIREBASE_MESSAGING_SENDER_ID: PRODUCTION_SETTINGS.firebaseConfig.messagingSenderId,
  VITE_FIREBASE_APP_ID: PRODUCTION_SETTINGS.firebaseConfig.appId,
  VITE_FIREBASE_MEASUREMENT_ID: PRODUCTION_SETTINGS.firebaseConfig.measurementId,
  VITE_WEB_PUSH_PUBLIC_KEY: PRODUCTION_SETTINGS.webPushPublicKey,
};

// ---------------------------------------------------------------------------
// I valori di produzione, come riferimento
// ---------------------------------------------------------------------------

test("i valori di produzione sono coerenti: progetto giovani-palo, ambiente production", () => {
  assert.equal(PRODUCTION_PROJECT_ID, "giovani-palo");
  assert.equal(PRODUCTION_SETTINGS.appEnvironment, "production");
  assert.equal(PRODUCTION_SETTINGS.firebaseConfig.projectId, "giovani-palo");
});

test("la tabella dei valori di produzione copre ogni campo (se ne aggiungi uno, aggiorna i test)", () => {
  assert.deepEqual(Object.keys(PRODUCTION_SETTINGS.firebaseConfig).sort(), [
    "apiKey",
    "appId",
    "authDomain",
    "measurementId",
    "messagingSenderId",
    "projectId",
    "storageBucket",
  ]);
  for (const [name, value] of Object.entries(PRODUCTION_VALUE_BY_ENV_VAR)) {
    assert.equal(typeof value, "string", name);
    assert.ok(value.length > 0, name);
  }
});

// ---------------------------------------------------------------------------
// resolveAppEnvironment
// ---------------------------------------------------------------------------

test("senza VITE_APP_ENV l'ambiente è production", () => {
  assert.equal(resolveAppEnvironment({}), "production");
  assert.equal(resolveAppEnvironment({ MODE: "production" }), "production");
  assert.equal(resolveAppEnvironment({ MODE: "development" }), "production");
  assert.equal(resolveAppEnvironment({ VITE_APP_ENV: "" }), "production");
  assert.equal(resolveAppEnvironment({ VITE_APP_ENV: "   " }), "production");
});

test("VITE_APP_ENV ammette solo production e staging", () => {
  assert.equal(resolveAppEnvironment({ VITE_APP_ENV: "production" }), "production");
  assert.equal(resolveAppEnvironment({ VITE_APP_ENV: "staging" }), "staging");
  assert.equal(resolveAppEnvironment({ VITE_APP_ENV: " staging " }), "staging");
  for (const invalid of ["prod", "dev", "development", "test", "demo", "stage", "true", "1"]) {
    assert.throws(() => resolveAppEnvironment({ VITE_APP_ENV: invalid }), invalid);
  }
});

test("--mode staging senza VITE_APP_ENV=staging è un errore", () => {
  assert.throws(() => resolveAppEnvironment({ MODE: "staging" }));
  assert.throws(() => resolveAppEnvironment({ MODE: "staging", VITE_APP_ENV: "" }));
  assert.throws(() => resolveAppEnvironment({ MODE: "staging", VITE_APP_ENV: "production" }));
  assert.equal(resolveAppEnvironment({ MODE: "staging", VITE_APP_ENV: "staging" }), "staging");
});

// ---------------------------------------------------------------------------
// resolveFirebaseSettings: produzione
// ---------------------------------------------------------------------------

test("di default si risolve la produzione e si restituisce esattamente l'oggetto di produzione", () => {
  for (const env of [
    {},
    { MODE: "production" },
    { MODE: "development" },
    { VITE_APP_ENV: "production" },
    { VITE_APP_ENV: "" },
  ]) {
    const settings = resolveFirebaseSettings(env, PRODUCTION_SETTINGS);
    assert.equal(settings, PRODUCTION_SETTINGS, JSON.stringify(env));
    assert.equal(settings.appEnvironment, "production");
  }
});

test("VITE_APP_ENV non valido fa fallire anche la risoluzione dei valori", () => {
  assert.throws(() => resolveFirebaseSettings({ VITE_APP_ENV: "prod" }, PRODUCTION_SETTINGS));
  assert.throws(() => resolveFirebaseSettings({ VITE_APP_ENV: "dev" }, null));
});

test("--mode staging senza VITE_APP_ENV=staging non ricade sui valori di produzione", () => {
  assert.throws(() => resolveFirebaseSettings({ MODE: "staging" }, PRODUCTION_SETTINGS));
  assert.throws(() => resolveFirebaseSettings({ MODE: "staging", VITE_APP_ENV: "production" }, PRODUCTION_SETTINGS));
  // Anche con tutti i valori di staging presenti: l'incoerenza di MODE è un errore.
  assert.throws(() => resolveFirebaseSettings(staging({ VITE_APP_ENV: "production" }), PRODUCTION_SETTINGS));
  assert.throws(() => resolveFirebaseSettings(without(staging(), "VITE_APP_ENV"), PRODUCTION_SETTINGS));
});

test("produzione con VITE_FIREBASE_PROJECT_ID di un altro progetto è un errore", () => {
  assert.throws(() =>
    resolveFirebaseSettings({ VITE_FIREBASE_PROJECT_ID: "giovani-palo-staging" }, PRODUCTION_SETTINGS),
  );
  assert.throws(() =>
    resolveFirebaseSettings(
      { VITE_APP_ENV: "production", VITE_FIREBASE_PROJECT_ID: "altro-progetto" },
      PRODUCTION_SETTINGS,
    ),
  );
});

test("produzione senza i valori di produzione disponibili è un errore", () => {
  // Non è nella spec scritta, ma l'alternativa sarebbe inventare una config.
  assert.throws(() => resolveFirebaseSettings({}, null));
});

// ---------------------------------------------------------------------------
// resolveFirebaseSettings: staging, valori obbligatori
// ---------------------------------------------------------------------------

test("staging: un env completo restituisce ambiente staging e i valori dati", () => {
  const settings = resolveFirebaseSettings(staging(), PRODUCTION_SETTINGS);
  assert.deepEqual(settings, {
    appEnvironment: "staging",
    firebaseConfig: {
      apiKey: "AIzaSyStagingChiaveDiProva",
      authDomain: "giovani-palo-staging.firebaseapp.com",
      projectId: "giovani-palo-staging",
      storageBucket: "giovani-palo-staging.firebasestorage.app",
      messagingSenderId: "111111111111",
      appId: "1:111111111111:web:0123456789abcdef",
      measurementId: "G-STAGING000",
    },
    webPushPublicKey: "BStagingChiavePushDiProva",
  });
});

test("staging: i valori vengono ripuliti dagli spazi", () => {
  const padded = {};
  for (const [key, value] of Object.entries(STAGING_ENV)) padded[key] = `  ${value}\t`;
  padded.MODE = "staging";
  padded.VITE_APP_ENV = " staging ";

  const settings = resolveFirebaseSettings(padded, PRODUCTION_SETTINGS);
  assert.equal(settings.appEnvironment, "staging");
  assert.equal(settings.firebaseConfig.apiKey, STAGING_ENV.VITE_FIREBASE_API_KEY);
  assert.equal(settings.firebaseConfig.authDomain, STAGING_ENV.VITE_FIREBASE_AUTH_DOMAIN);
  assert.equal(settings.firebaseConfig.projectId, STAGING_ENV.VITE_FIREBASE_PROJECT_ID);
  assert.equal(settings.firebaseConfig.storageBucket, STAGING_ENV.VITE_FIREBASE_STORAGE_BUCKET);
  assert.equal(settings.firebaseConfig.messagingSenderId, STAGING_ENV.VITE_FIREBASE_MESSAGING_SENDER_ID);
  assert.equal(settings.firebaseConfig.appId, STAGING_ENV.VITE_FIREBASE_APP_ID);
  assert.equal(settings.firebaseConfig.measurementId, STAGING_ENV.VITE_FIREBASE_MEASUREMENT_ID);
  assert.equal(settings.webPushPublicKey, STAGING_ENV.VITE_WEB_PUSH_PUBLIC_KEY);
});

test("staging: serve ognuno dei valori obbligatori e l'errore dice quale manca", () => {
  for (const missing of REQUIRED_STAGING_VARS) {
    for (const [label, env] of [
      ["assente", without(staging(), missing)],
      ["vuoto", staging({ [missing]: "" })],
      ["di soli spazi", staging({ [missing]: "   " })],
    ]) {
      assert.throws(
        () => resolveFirebaseSettings(env, PRODUCTION_SETTINGS),
        (error) => {
          assert.ok(error.message.includes(missing), `${missing} ${label}: "${error.message}"`);
          for (const other of REQUIRED_STAGING_VARS.filter((name) => name !== missing)) {
            assert.ok(!error.message.includes(other), `${other} elencato senza essere mancante`);
          }
          return true;
        },
        `${missing} ${label}`,
      );
    }
  }
});

test("staging: l'errore elenca tutti i valori mancanti in una volta", () => {
  const env = { MODE: "staging", VITE_APP_ENV: "staging" };
  assert.throws(
    () => resolveFirebaseSettings(env, PRODUCTION_SETTINGS),
    (error) => {
      for (const name of REQUIRED_STAGING_VARS) {
        assert.ok(error.message.includes(name), `manca ${name} nel messaggio: "${error.message}"`);
      }
      assert.ok(!error.message.includes("VITE_FIREBASE_MEASUREMENT_ID"));
      return true;
    },
  );
});

test("staging: due valori mancanti compaiono entrambi nel messaggio", () => {
  const env = without(staging(), "VITE_FIREBASE_APP_ID", "VITE_WEB_PUSH_PUBLIC_KEY");
  assert.throws(
    () => resolveFirebaseSettings(env, PRODUCTION_SETTINGS),
    (error) =>
      error.message.includes("VITE_FIREBASE_APP_ID") && error.message.includes("VITE_WEB_PUSH_PUBLIC_KEY"),
  );
});

test("staging: il measurement id è facoltativo", () => {
  for (const env of [
    without(staging(), "VITE_FIREBASE_MEASUREMENT_ID"),
    staging({ VITE_FIREBASE_MEASUREMENT_ID: "" }),
    staging({ VITE_FIREBASE_MEASUREMENT_ID: "  " }),
  ]) {
    const settings = resolveFirebaseSettings(env, PRODUCTION_SETTINGS);
    assert.equal(settings.appEnvironment, "staging");
    assert.equal(settings.firebaseConfig.measurementId, undefined);
    assert.equal(settings.firebaseConfig.projectId, "giovani-palo-staging");
  }
});

test("staging senza --mode staging (solo VITE_APP_ENV=staging) funziona", () => {
  const settings = resolveFirebaseSettings(without(staging(), "MODE"), PRODUCTION_SETTINGS);
  assert.equal(settings.appEnvironment, "staging");
});

// ---------------------------------------------------------------------------
// resolveFirebaseSettings: staging non può puntare alla produzione
// ---------------------------------------------------------------------------

test("staging: qualunque valore uguale a quello di produzione blocca la build", () => {
  for (const [envVar, productionValue] of Object.entries(PRODUCTION_VALUE_BY_ENV_VAR)) {
    assert.throws(
      () => resolveFirebaseSettings(staging({ [envVar]: productionValue }), PRODUCTION_SETTINGS),
      `${envVar} uguale alla produzione`,
    );
  }
});

test("staging: il valore di produzione con spazi attorno è comunque riconosciuto", () => {
  for (const [envVar, productionValue] of Object.entries(PRODUCTION_VALUE_BY_ENV_VAR)) {
    assert.throws(
      () => resolveFirebaseSettings(staging({ [envVar]: `  ${productionValue} ` }), PRODUCTION_SETTINGS),
      `${envVar} con spazi`,
    );
  }
});

test("staging: tutti i valori copiati dalla produzione bloccano la build", () => {
  assert.throws(() => resolveFirebaseSettings(staging(PRODUCTION_VALUE_BY_ENV_VAR), PRODUCTION_SETTINGS));
});

test("staging senza valori di produzione a disposizione blocca ancora il progetto giovani-palo", () => {
  assert.throws(() => resolveFirebaseSettings(staging({ VITE_FIREBASE_PROJECT_ID: "giovani-palo" }), null));
  assert.throws(() => resolveFirebaseSettings(staging({ VITE_FIREBASE_PROJECT_ID: " giovani-palo " }), null));
});

test("staging senza valori di produzione a disposizione accetta un env valido", () => {
  const settings = resolveFirebaseSettings(staging(), null);
  assert.equal(settings.appEnvironment, "staging");
  assert.equal(settings.firebaseConfig.projectId, "giovani-palo-staging");
  assert.equal(settings.webPushPublicKey, STAGING_ENV.VITE_WEB_PUSH_PUBLIC_KEY);
});

test("staging: un progetto che inizia con giovani-palo ma è un altro progetto non è una collisione", () => {
  const settings = resolveFirebaseSettings(
    staging({ VITE_FIREBASE_PROJECT_ID: "giovani-palo-staging" }),
    PRODUCTION_SETTINGS,
  );
  assert.equal(settings.firebaseConfig.projectId, "giovani-palo-staging");
});

test("staging: il risultato non è l'oggetto di produzione né ne condivide pezzi", () => {
  const settings = resolveFirebaseSettings(staging(), PRODUCTION_SETTINGS);
  assert.notEqual(settings, PRODUCTION_SETTINGS);
  assert.notEqual(settings.firebaseConfig, PRODUCTION_SETTINGS.firebaseConfig);
  for (const key of Object.keys(PRODUCTION_SETTINGS.firebaseConfig)) {
    assert.notEqual(settings.firebaseConfig[key], PRODUCTION_SETTINGS.firebaseConfig[key], key);
  }
  assert.notEqual(settings.webPushPublicKey, PRODUCTION_SETTINGS.webPushPublicKey);
});

// ---------------------------------------------------------------------------
// Un bundle non può girare sull'host dell'altro ambiente
// ---------------------------------------------------------------------------

// Le varianti con punto finale e maiuscole valgono per ogni host di questi elenchi.
const withVariants = (hosts) =>
  hosts.flatMap((host) => [host, `${host}.`, `${host}..`, host.toUpperCase(), `${host.toUpperCase()}.`]);

const STAGING_HOSTS = [
  "demo.gugditalia.it",
  "x.demo.gugditalia.it",
  "giovani-palo-staging.web.app",
  "giovani-palo-staging.firebaseapp.com",
  "giovani-palo-staging--pr1.web.app",
];

const PRODUCTION_HOSTS = [
  "gugditalia.it",
  "www.gugditalia.it",
  "giovani-palo.web.app",
  "giovani-palo.firebaseapp.com",
  "giovani-palo--pr1.web.app",
];

test("bundle di produzione: rifiuta gli host di staging e demo, anche con punto finale e maiuscole", () => {
  for (const host of withVariants(STAGING_HOSTS)) {
    assert.throws(() => assertHostMatchesEnvironment("production", host), host);
  }
  assert.throws(() => assertHostMatchesEnvironment("production", "Giovani-Palo-Staging.Web.App"));
  assert.throws(() => assertHostMatchesEnvironment("production", "a.b.demo.gugditalia.it"));
  assert.throws(() => assertHostMatchesEnvironment("production", "giovani-palo-staging--pr12-abc.firebaseapp.com"));
});

test("bundle di produzione: ammette i suoi host e localhost", () => {
  for (const host of [
    "gugditalia.it",
    "www.gugditalia.it",
    "giovani-palo.web.app",
    "giovani-palo.firebaseapp.com",
    "localhost",
    "127.0.0.1",
    "GUGDITALIA.IT",
    "gugditalia.it.",
  ]) {
    assert.doesNotThrow(() => assertHostMatchesEnvironment("production", host), host);
  }
});

test("bundle di produzione: un host che somiglia a quello di staging ma non lo è resta ammesso", () => {
  for (const host of ["demo.gugditalia.it.example.com", "evildemo.gugditalia.it", "giovani-palo.web.app.example.com"]) {
    assert.doesNotThrow(() => assertHostMatchesEnvironment("production", host), host);
  }
});

test("bundle di staging: rifiuta gli host di produzione, anche con punto finale e maiuscole", () => {
  for (const host of withVariants(PRODUCTION_HOSTS)) {
    assert.throws(() => assertHostMatchesEnvironment("staging", host), host);
  }
  assert.throws(() => assertHostMatchesEnvironment("staging", "Giovani-Palo--PR1-ABC.Firebaseapp.com"));
});

test("bundle di staging: ammette i suoi host e localhost", () => {
  for (const host of [
    "demo.gugditalia.it",
    "x.demo.gugditalia.it",
    "giovani-palo-staging.web.app",
    "giovani-palo-staging.firebaseapp.com",
    "giovani-palo-staging--pr1.web.app",
    "localhost",
    "127.0.0.1",
    "DEMO.GUGDITALIA.IT",
    "demo.gugditalia.it.",
  ]) {
    assert.doesNotThrow(() => assertHostMatchesEnvironment("staging", host), host);
  }
});

test("bundle di staging: un host che somiglia a quello di produzione ma non lo è resta ammesso", () => {
  for (const host of ["gugditalia.it.example.com", "evilgugditalia.it", "giovani-palo-2.web.app"]) {
    assert.doesNotThrow(() => assertHostMatchesEnvironment("staging", host), host);
  }
});

// ---------------------------------------------------------------------------
// MODE di produzione e variabili di un altro ambiente
// ---------------------------------------------------------------------------

test("MODE production con VITE_APP_ENV=staging è un errore (regressione)", () => {
  assert.throws(() => resolveAppEnvironment({ MODE: "production", VITE_APP_ENV: "staging" }));
  assert.throws(() => resolveFirebaseSettings(staging({ MODE: "production" }), PRODUCTION_SETTINGS));
  assert.throws(() => resolveFirebaseSettings(staging({ MODE: "production" }), null));
});

test("MODE production con VITE_APP_ENV production o assente resta production", () => {
  assert.equal(resolveAppEnvironment({ MODE: "production", VITE_APP_ENV: "production" }), "production");
  assert.equal(resolveAppEnvironment({ MODE: "production" }), "production");
  assert.equal(resolveAppEnvironment({ MODE: "production", VITE_APP_ENV: "" }), "production");
  assert.equal(resolveFirebaseSettings({ MODE: "production" }, PRODUCTION_SETTINGS), PRODUCTION_SETTINGS);
  assert.equal(
    resolveFirebaseSettings({ MODE: "production", VITE_APP_ENV: "production" }, PRODUCTION_SETTINGS),
    PRODUCTION_SETTINGS,
  );
});

const LEAKABLE_VARS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_MEASUREMENT_ID",
  "VITE_FIREBASE_QUALCOSA_DI_NUOVO",
  "VITE_WEB_PUSH_PUBLIC_KEY",
  "VITE_DEFAULT_STAKE_ID",
  "VITE_DEFAULT_STAKE_NAME",
  "VITE_DEFAULT_STAKE_SLUG",
];

test("MODE production: una qualunque variabile VITE_FIREBASE_*, VITE_WEB_PUSH_PUBLIC_KEY o VITE_DEFAULT_STAKE_* blocca la build (regressione)", () => {
  for (const name of LEAKABLE_VARS) {
    assert.throws(
      () => resolveFirebaseSettings({ MODE: "production", [name]: "valore-rimasto-nella-shell" }, PRODUCTION_SETTINGS),
      name,
    );
    assert.throws(
      () =>
        resolveFirebaseSettings(
          { MODE: "production", VITE_APP_ENV: "production", [name]: "valore-rimasto-nella-shell" },
          PRODUCTION_SETTINGS,
        ),
      `${name} con VITE_APP_ENV=production`,
    );
  }
});

test("MODE production: anche un valore uguale a quello di produzione è una variabile di troppo", () => {
  assert.throws(() =>
    resolveFirebaseSettings(
      { MODE: "production", VITE_FIREBASE_PROJECT_ID: PRODUCTION_SETTINGS.firebaseConfig.projectId },
      PRODUCTION_SETTINGS,
    ),
  );
  assert.throws(() =>
    resolveFirebaseSettings(
      { MODE: "production", VITE_FIREBASE_API_KEY: PRODUCTION_SETTINGS.firebaseConfig.apiKey },
      PRODUCTION_SETTINGS,
    ),
  );
});

test("MODE production: valori vuoti o di soli spazi non contano come variabili impostate", () => {
  const env = { MODE: "production" };
  for (const name of LEAKABLE_VARS) env[name] = name.length % 2 ? "" : "   ";
  assert.equal(resolveFirebaseSettings(env, PRODUCTION_SETTINGS), PRODUCTION_SETTINGS);
});

test("MODE production: altre variabili VITE_ non legate ad ambiente e Firebase non danno fastidio", () => {
  assert.equal(
    resolveFirebaseSettings({ MODE: "production", VITE_ALTRA_COSA: "x", BASE_URL: "/" }, PRODUCTION_SETTINGS),
    PRODUCTION_SETTINGS,
  );
});

test("senza MODE (o con MODE development) la produzione si risolve come prima, anche con variabili VITE_*", () => {
  for (const mode of [undefined, "development", ""]) {
    for (const name of LEAKABLE_VARS.filter((key) => key !== "VITE_FIREBASE_PROJECT_ID")) {
      const env = { [name]: "valore-di-sviluppo" };
      if (mode !== undefined) env.MODE = mode;
      assert.equal(resolveFirebaseSettings(env, PRODUCTION_SETTINGS), PRODUCTION_SETTINGS, `${mode} ${name}`);
    }
  }
  // La guardia sul progetto di un altro ambiente resta valida anche senza MODE.
  assert.throws(() => resolveFirebaseSettings({ VITE_FIREBASE_PROJECT_ID: "altro-progetto" }, PRODUCTION_SETTINGS));
  assert.throws(() =>
    resolveFirebaseSettings({ MODE: "development", VITE_FIREBASE_PROJECT_ID: "altro-progetto" }, PRODUCTION_SETTINGS),
  );
});

test("MODE staging non è toccato dal controllo sulle variabili di produzione", () => {
  const settings = resolveFirebaseSettings(staging({ VITE_DEFAULT_STAKE_ID: "demo-stake" }), PRODUCTION_SETTINGS);
  assert.equal(settings.appEnvironment, "staging");
});

// ---------------------------------------------------------------------------
// Staging: nomi derivati dall'id progetto di produzione
// ---------------------------------------------------------------------------

test("staging: authDomain o storageBucket che iniziano con 'giovani-palo.' sono collisioni anche senza valori di produzione (regressione)", () => {
  for (const [envVar, value] of [
    ["VITE_FIREBASE_STORAGE_BUCKET", "giovani-palo.appspot.com"],
    ["VITE_FIREBASE_STORAGE_BUCKET", "giovani-palo.firebasestorage.app"],
    ["VITE_FIREBASE_STORAGE_BUCKET", "Giovani-Palo.AppSpot.com"],
    ["VITE_FIREBASE_AUTH_DOMAIN", "giovani-palo.firebaseapp.com"],
    ["VITE_FIREBASE_AUTH_DOMAIN", "giovani-palo.web.app"],
    ["VITE_FIREBASE_AUTH_DOMAIN", "GIOVANI-PALO.FIREBASEAPP.COM"],
    ["VITE_FIREBASE_AUTH_DOMAIN", "  giovani-palo.appspot.com "],
    ["VITE_FIREBASE_AUTH_DOMAIN", "giovani-palo.example.com"],
  ]) {
    assert.throws(() => resolveFirebaseSettings(staging({ [envVar]: value }), null), `${envVar}=${value} senza produzione`);
    assert.throws(
      () => resolveFirebaseSettings(staging({ [envVar]: value }), PRODUCTION_SETTINGS),
      `${envVar}=${value} con produzione`,
    );
  }
});

test("staging: nomi derivati da un progetto di staging non sono collisioni", () => {
  const settings = resolveFirebaseSettings(
    staging({
      VITE_FIREBASE_AUTH_DOMAIN: "giovani-palo-staging.firebaseapp.com",
      VITE_FIREBASE_STORAGE_BUCKET: "giovani-palo-staging.appspot.com",
    }),
    null,
  );
  assert.equal(settings.firebaseConfig.authDomain, "giovani-palo-staging.firebaseapp.com");
  assert.equal(settings.firebaseConfig.storageBucket, "giovani-palo-staging.appspot.com");
});
