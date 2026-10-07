// Risoluzione della configurazione Firebase per ambiente. Modulo PURO (nessun
// `import.meta`): lo usano sia `config.ts` a runtime sia `vite.config.ts` per
// far fallire la build prima di produrre un bundle sbagliato.
//
// Regola anti-prod: un ambiente diverso da "production" non può mai
// puntare al backend di produzione, né per un valore dimenticato (nessun
// ripiego sui valori di produzione) né per un valore copiato per errore.
//
// I valori di produzione completi stanno in `productionSettings.ts` e
// arrivano qui come parametro: `config.ts` li passa solo nelle build di
// produzione, così un bundle di staging non contiene la chiave di prod.

// Unico valore di produzione che vive qui: l'id progetto non è un segreto e
// serve come guardia anche quando i valori completi non sono nel bundle.
export const PRODUCTION_PROJECT_ID = "giovani-palo";

export type AppEnvironment = "production" | "staging";

// Host di produzione (e canali di anteprima del sito di produzione): un bundle
// di staging non deve mai girare qui.
const PRODUCTION_HOSTS = ["gugditalia.it", "www.gugditalia.it", "giovani-palo.web.app", "giovani-palo.firebaseapp.com"];
const PRODUCTION_PREVIEW_HOST = /^giovani-palo--.+\.(web\.app|firebaseapp\.com)$/;
// Host di staging/demo: un bundle di produzione non deve mai girare qui (farebbe
// scrivere la demo sul backend vero). Aggiornare se nasce un nuovo host di staging.
const STAGING_HOST_PATTERNS = [
  /^(.+\.)?demo\.gugditalia\.it$/,
  /-staging(--.+)?\.(web\.app|firebaseapp\.com)$/,
];

/**
 * Lega il bundle all'host che lo serve. Non c'è altro controllo fra `dist/` e
 * `firebase deploy`: senza questo, `npm run build` seguito da un deploy sul
 * sito di staging pubblicherebbe una build che scrive sul backend di produzione.
 * localhost è sempre ammesso (sviluppo, emulatori).
 */
export function assertHostMatchesEnvironment(appEnvironment: AppEnvironment, rawHostname: string) {
  const hostname = rawHostname.toLowerCase().replace(/\.+$/, "");
  const forbidden =
    appEnvironment === "production"
      ? STAGING_HOST_PATTERNS.some((pattern) => pattern.test(hostname))
      : PRODUCTION_HOSTS.includes(hostname) || PRODUCTION_PREVIEW_HOST.test(hostname);
  if (forbidden) {
    throw new Error(`Bundle "${appEnvironment}" servito da ${hostname}: avvio bloccato.`);
  }
}

export interface EnvironmentInput {
  MODE?: string;
  VITE_APP_ENV?: string;
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_STORAGE_BUCKET?: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_FIREBASE_MEASUREMENT_ID?: string;
  VITE_WEB_PUSH_PUBLIC_KEY?: string;
  VITE_DEFAULT_STAKE_ID?: string;
  VITE_DEFAULT_STAKE_NAME?: string;
  VITE_DEFAULT_STAKE_SLUG?: string;
}

export interface FirebaseSettings {
  appEnvironment: AppEnvironment;
  firebaseConfig: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
  };
  webPushPublicKey: string;
}

const REQUIRED_STAGING_KEYS = [
  ["VITE_FIREBASE_API_KEY", "apiKey"],
  ["VITE_FIREBASE_AUTH_DOMAIN", "authDomain"],
  ["VITE_FIREBASE_PROJECT_ID", "projectId"],
  ["VITE_FIREBASE_STORAGE_BUCKET", "storageBucket"],
  ["VITE_FIREBASE_MESSAGING_SENDER_ID", "messagingSenderId"],
  ["VITE_FIREBASE_APP_ID", "appId"],
] as const;

function clean(value: string | undefined) {
  return (value ?? "").trim();
}

export function resolveAppEnvironment(env: EnvironmentInput): AppEnvironment {
  const declared = clean(env.VITE_APP_ENV) || "production";
  if (declared !== "production" && declared !== "staging") {
    throw new Error(`VITE_APP_ENV non valido: "${declared}" (ammessi: production, staging).`);
  }
  // `--mode staging` senza VITE_APP_ENV ricadrebbe sui valori di produzione
  // e pubblicherebbe un bundle di staging che scrive su prod.
  if (clean(env.MODE) === "staging" && declared !== "staging") {
    throw new Error('Build in --mode staging ma VITE_APP_ENV non e\' "staging": controlla .env.staging.');
  }
  // Il contrario: una variabile rimasta nella shell o in `.env.local` non deve
  // trasformare `npm run build` in un bundle di staging da deployare su prod.
  if (clean(env.MODE) === "production" && declared !== "production") {
    throw new Error(`Build di produzione con VITE_APP_ENV=${declared}: usa --mode staging.`);
  }
  return declared;
}

/**
 * @param production valori di produzione completi. Obbligatori per risolvere
 *   "production"; per "staging" abilitano il controllo di collisione campo
 *   per campo (a build time in vite.config.ts). Senza, resta la guardia
 *   sull'id progetto.
 */
export function resolveFirebaseSettings(
  env: EnvironmentInput,
  production: FirebaseSettings | null,
): FirebaseSettings {
  const appEnvironment = resolveAppEnvironment(env);

  if (appEnvironment === "production") {
    if (!production) throw new Error("Valori di produzione non disponibili per una build di produzione.");
    if (clean(env.MODE) === "production") {
      const leaked = (Object.keys(env) as Array<keyof EnvironmentInput>).filter(
        (key) =>
          (key.startsWith("VITE_FIREBASE_") || key === "VITE_WEB_PUSH_PUBLIC_KEY" || key.startsWith("VITE_DEFAULT_STAKE_")) &&
          clean(env[key]),
      );
      if (leaked.length) {
        throw new Error(
          `Build di produzione con variabili di un altro ambiente (${leaked.join(", ")}): rimuovile da .env.local o dalla shell.`,
        );
      }
    }
    const projectOverride = clean(env.VITE_FIREBASE_PROJECT_ID);
    if (projectOverride && projectOverride !== production.firebaseConfig.projectId) {
      throw new Error(
        `Build di produzione con VITE_FIREBASE_PROJECT_ID=${projectOverride}: usa VITE_APP_ENV=staging.`,
      );
    }
    return production;
  }

  const missing: string[] = REQUIRED_STAGING_KEYS.filter(([envKey]) => !clean(env[envKey])).map(([envKey]) => envKey);
  if (!clean(env.VITE_WEB_PUSH_PUBLIC_KEY)) missing.push("VITE_WEB_PUSH_PUBLIC_KEY");
  if (missing.length) {
    throw new Error(`Configurazione staging incompleta, mancano: ${missing.join(", ")}.`);
  }

  const firebaseConfig = {
    apiKey: clean(env.VITE_FIREBASE_API_KEY),
    authDomain: clean(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: clean(env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: clean(env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: clean(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: clean(env.VITE_FIREBASE_APP_ID),
    ...(clean(env.VITE_FIREBASE_MEASUREMENT_ID)
      ? { measurementId: clean(env.VITE_FIREBASE_MEASUREMENT_ID) }
      : {}),
  };
  const webPushPublicKey = clean(env.VITE_WEB_PUSH_PUBLIC_KEY);

  const collisions: string[] = [];
  if (firebaseConfig.projectId === PRODUCTION_PROJECT_ID) collisions.push("projectId");
  // Forme storiche dei nomi derivati dall'id progetto (`<id>.appspot.com`,
  // `<id>.firebaseapp.com`): il confronto esatto con i valori completi non le vede.
  if (firebaseConfig.authDomain.toLowerCase().startsWith(`${PRODUCTION_PROJECT_ID}.`)) collisions.push("authDomain");
  if (firebaseConfig.storageBucket.toLowerCase().startsWith(`${PRODUCTION_PROJECT_ID}.`)) collisions.push("storageBucket");
  if (production) {
    for (const key of Object.keys(production.firebaseConfig) as Array<keyof FirebaseSettings["firebaseConfig"]>) {
      if (key !== "projectId" && firebaseConfig[key] === production.firebaseConfig[key]) collisions.push(key);
    }
    if (webPushPublicKey === production.webPushPublicKey) collisions.push("webPushPublicKey");
  }
  const uniqueCollisions = [...new Set(collisions)];
  if (uniqueCollisions.length) {
    throw new Error(
      `Configurazione staging con valori di PRODUZIONE (${uniqueCollisions.join(", ")}): build bloccata.`,
    );
  }

  return { appEnvironment, firebaseConfig, webPushPublicKey };
}
