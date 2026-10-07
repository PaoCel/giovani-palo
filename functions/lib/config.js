/**
 * Configurazione lato server per il flusso di autorizzazione genitoriale.
 *
 * Niente segreti qui dentro: la BREVO_API_KEY vive in Secret Manager
 * (defineSecret in lib/parentAuthorization.js).
 *
 * I valori sotto sono quelli di PRODUZIONE. Ogni altro progetto Firebase
 * (staging, demo, emulatore) è "non produzione": URL, mittente e allowlist
 * email arrivano dal file `functions/.env.<projectId>` (vedi
 * `functions/.env.staging.example`) e non possono mai ricadere sui valori di
 * produzione senza un errore esplicito.
 */

const REGION = "europe-west1";

// Progetto Firebase di produzione: l'unico in cui le email partono senza filtri.
const PRODUCTION_PROJECT_ID = "giovani-palo";

// Host di produzione: un ambiente non di produzione non può costruire link
// verso questi host.
const PRODUCTION_HOSTS = [
  "gugditalia.it",
  "www.gugditalia.it",
  "giovani-palo.web.app",
  "giovani-palo.firebaseapp.com",
];

// URL pubblico dell'app frontend in produzione, usato per costruire i magic
// link. Fuori da produzione si usa getAppPublicUrl().
const APP_PUBLIC_URL = "https://gugditalia.it";

// Sender email transazionale Brevo (deve corrispondere a un sender verificato).
const BREVO_SENDER_EMAIL = "noreply@gugditalia.it";
const BREVO_SENDER_NAME =
  "Piattaforma attività per Giovani Uomini e Giovani Donne in Italia";

// Reply-to: dove vanno le risposte del genitore se preme "rispondi".
const BREVO_REPLY_TO_EMAIL = "supporto@gugditalia.it";
const BREVO_REPLY_TO_NAME =
  "Supporto Piattaforma attività per Giovani Uomini e Giovani Donne in Italia";

// Testo di supporto mostrato in email + pagina genitore.
const SUPPORT_CONTACT_TEXT =
  "Per assistenza contatta il dirigente della tua unità.";

// Scadenza token magic-link in giorni.
const PARENT_AUTHORIZATION_TOKEN_TTL_DAYS = 14;

// Endpoint Brevo Transactional Email.
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

// Storage path per PDF audit + firme genitore.
const STORAGE_PATH_PARENT_AUTH_PDF = (stakeId, activityId, registrationId) =>
  `protected/stakes/${stakeId}/activities/${activityId}/parent-authorization-pdfs/${registrationId}`;

const STORAGE_PATH_PARENT_AUTH_SIGNATURE = (
  stakeId,
  activityId,
  registrationId,
) =>
  `protected/stakes/${stakeId}/activities/${activityId}/parent-authorization-signatures/${registrationId}`;

const STORAGE_PATH_PARENT_AUTH_SIGNATURE_CACHE = (emailHash) =>
  `protected/parent-authorization-signature-cache/${emailHash}`;

class EnvironmentConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "EnvironmentConfigError";
  }
}

/**
 * Progetto Firebase su cui gira il codice. Stessa fonte che usa
 * firebase-functions (GCLOUD_PROJECT, poi FIREBASE_CONFIG). Stringa vuota se
 * non determinabile: chi decide qualcosa di rischioso deve lanciare, mai
 * ripiegare su "produzione" o su "non produzione" a caso.
 */
function resolveProjectId(env = process.env) {
  const direct = String(env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || "").trim();
  if (direct) return direct;
  try {
    const parsed = JSON.parse(env.FIREBASE_CONFIG || "{}");
    return typeof parsed.projectId === "string" ? parsed.projectId.trim() : "";
  } catch {
    return "";
  }
}

/** Risolve il progetto o lancia: usare prima di ogni azione verso l'esterno. */
function requireProjectId(env = process.env) {
  const projectId = resolveProjectId(env);
  if (!projectId) {
    throw new EnvironmentConfigError(
      "Progetto Firebase non determinabile (GCLOUD_PROJECT/FIREBASE_CONFIG assenti): operazione bloccata.",
    );
  }
  return projectId;
}

/**
 * Un emulatore delle functions non è mai produzione, nemmeno se parte con il
 * progetto di default (`.firebaserc` punta a giovani-palo): altrimenti userebbe
 * link e allowlist di produzione e, senza `.secret.local`, la chiave Brevo vera.
 */
function isEmulatorRuntime(env = process.env) {
  return String(env.FUNCTIONS_EMULATOR || "").toLowerCase() === "true";
}

function isProduction(env = process.env) {
  return requireProjectId(env) === PRODUCTION_PROJECT_ID && !isEmulatorRuntime(env);
}

function isEmulatorDemoProject(projectId) {
  return projectId.startsWith("demo-");
}

// Anteprime del sito di produzione (`giovani-palo--<canale>.web.app`).
const PRODUCTION_PREVIEW_HOST = /^giovani-palo--.+\.(web\.app|firebaseapp\.com)$/;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * URL pubblico dell'app per questo ambiente.
 * - produzione: APP_PUBLIC_URL (invariato);
 * - emulatore (progetto demo-*): APP_PUBLIC_URL da env, altrimenti localhost;
 * - altri progetti: APP_PUBLIC_URL da env, obbligatorio e mai un host di produzione.
 */
function getAppPublicUrl(env = process.env) {
  const projectId = requireProjectId(env);
  if (isProduction(env)) return APP_PUBLIC_URL;

  const localDev = isEmulatorDemoProject(projectId) || isEmulatorRuntime(env);
  const configured = String(env.APP_PUBLIC_URL || "").trim();
  if (!configured) {
    if (localDev) return "http://localhost:5173";
    throw new EnvironmentConfigError(
      `APP_PUBLIC_URL mancante per il progetto ${projectId}: impostala in functions/.env.${projectId}.`,
    );
  }

  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new EnvironmentConfigError(`APP_PUBLIC_URL non è un URL valido: ${configured}`);
  }
  // Il punto finale ("gugditalia.it.") è lo stesso host: va tolto prima del confronto.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (PRODUCTION_HOSTS.includes(host) || PRODUCTION_PREVIEW_HOST.test(host)) {
    throw new EnvironmentConfigError(
      `APP_PUBLIC_URL punta a un host di produzione (${host}) da un progetto non di produzione.`,
    );
  }
  // Solo https; http solo su localhost in sviluppo locale (finisce in link mandati ai genitori).
  const httpsOk = url.protocol === "https:";
  const localHttpOk = url.protocol === "http:" && localDev && LOCAL_HOSTS.includes(url.hostname.toLowerCase());
  if (!httpsOk && !localHttpOk) {
    throw new EnvironmentConfigError(`APP_PUBLIC_URL deve essere https: ${configured}`);
  }
  return configured;
}

function parseAllowlist(raw) {
  const entries = String(raw || "")
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  for (const entry of entries) {
    const valid = /^[^@\s*]+@[^@\s*]+\.[^@\s*]+$/.test(entry) || /^@[^@\s*]+\.[^@\s*]+$/.test(entry);
    if (!valid) {
      throw new EnvironmentConfigError(
        `EMAIL_ALLOWLIST: voce non valida "${entry}" (ammessi indirizzi esatti o @dominio, niente wildcard).`,
      );
    }
  }
  return entries;
}

function normalizeSubjectPrefix(raw) {
  const trimmed = String(raw).trim();
  return trimmed ? `${trimmed} ` : "";
}

/**
 * Politica email dell'ambiente corrente.
 * In produzione `allowlist` è null (nessun filtro, nessun prefisso: stesso
 * comportamento di sempre). Fuori da produzione l'allowlist è sempre
 * attiva: se EMAIL_ALLOWLIST manca o è vuota non esce niente (tutto
 * "simulato").
 */
function getEmailPolicy(env = process.env) {
  const projectId = requireProjectId(env);

  if (isProduction(env)) {
    return {
      projectId,
      isProduction: true,
      senderEmail: BREVO_SENDER_EMAIL,
      replyToEmail: BREVO_REPLY_TO_EMAIL,
      replyToName: BREVO_REPLY_TO_NAME,
      subjectPrefix: "",
      allowlist: null,
    };
  }

  return {
    projectId,
    isProduction: false,
    senderEmail: String(env.EMAIL_SENDER_ADDRESS || "").trim() || BREVO_SENDER_EMAIL,
    replyToEmail: String(env.EMAIL_REPLY_TO_ADDRESS || "").trim() || BREVO_REPLY_TO_EMAIL,
    replyToName: BREVO_REPLY_TO_NAME,
    subjectPrefix: normalizeSubjectPrefix(env.EMAIL_SUBJECT_PREFIX ?? "[TEST]"),
    allowlist: parseAllowlist(env.EMAIL_ALLOWLIST),
  };
}

module.exports = {
  REGION,
  PRODUCTION_PROJECT_ID,
  PRODUCTION_HOSTS,
  EnvironmentConfigError,
  resolveProjectId,
  isProduction,
  isEmulatorRuntime,
  getAppPublicUrl,
  getEmailPolicy,
  parseAllowlist,
  APP_PUBLIC_URL,
  BREVO_SENDER_EMAIL,
  BREVO_SENDER_NAME,
  BREVO_REPLY_TO_EMAIL,
  BREVO_REPLY_TO_NAME,
  SUPPORT_CONTACT_TEXT,
  PARENT_AUTHORIZATION_TOKEN_TTL_DAYS,
  BREVO_API_URL,
  STORAGE_PATH_PARENT_AUTH_PDF,
  STORAGE_PATH_PARENT_AUTH_SIGNATURE,
  STORAGE_PATH_PARENT_AUTH_SIGNATURE_CACHE,
};
