import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  EnvironmentConfigError,
  getAppPublicUrl,
  getEmailPolicy,
  isEmulatorRuntime,
  isProduction,
  parseAllowlist,
  resolveProjectId,
} = require("../lib/config.js");
const {
  ENVIRONMENT_NOTICE,
  decorateMessage,
  isAllowed,
  maskAddress,
  planDelivery,
} = require("../lib/emailPolicy.js");

// Tutte le funzioni sotto ricevono `env` esplicito: process.env non si tocca.
const PROD = { GCLOUD_PROJECT: "giovani-palo" };
const STAGING = { GCLOUD_PROJECT: "giovani-palo-staging" };

const isEnvError = (error) => error instanceof EnvironmentConfigError;

// ---------------------------------------------------------------------------
// 1. Risoluzione del progetto e fallimento rumoroso
// ---------------------------------------------------------------------------

test("resolveProjectId legge GCLOUD_PROJECT, poi GOOGLE_CLOUD_PROJECT, poi FIREBASE_CONFIG", () => {
  const firebaseConfig = JSON.stringify({ projectId: "da-firebase-config" });

  assert.equal(
    resolveProjectId({
      GCLOUD_PROJECT: "da-gcloud",
      GOOGLE_CLOUD_PROJECT: "da-google-cloud",
      FIREBASE_CONFIG: firebaseConfig,
    }),
    "da-gcloud",
  );
  assert.equal(
    resolveProjectId({ GOOGLE_CLOUD_PROJECT: "da-google-cloud", FIREBASE_CONFIG: firebaseConfig }),
    "da-google-cloud",
  );
  assert.equal(resolveProjectId({ FIREBASE_CONFIG: firebaseConfig }), "da-firebase-config");
});

test("resolveProjectId toglie gli spazi dal valore letto", () => {
  assert.equal(resolveProjectId({ GCLOUD_PROJECT: "  giovani-palo-staging \n" }), "giovani-palo-staging");
});

test("resolveProjectId ritorna stringa vuota se non determinabile", () => {
  assert.equal(resolveProjectId({}), "");
  assert.equal(resolveProjectId({ GCLOUD_PROJECT: "", GOOGLE_CLOUD_PROJECT: "", FIREBASE_CONFIG: "" }), "");
  assert.equal(resolveProjectId({ FIREBASE_CONFIG: "{non e' json" }), "");
  assert.equal(resolveProjectId({ FIREBASE_CONFIG: "null" }), "");
  assert.equal(resolveProjectId({ FIREBASE_CONFIG: "[]" }), "");
  assert.equal(resolveProjectId({ FIREBASE_CONFIG: "{}" }), "");
  assert.equal(resolveProjectId({ FIREBASE_CONFIG: JSON.stringify({ projectId: 42 }) }), "");
});

test("senza progetto determinabile policy, URL e isProduction lanciano EnvironmentConfigError", () => {
  const unknown = [
    {},
    { FIREBASE_CONFIG: "{non e' json" },
    { FIREBASE_CONFIG: "{}" },
    // Anche con tutta la configurazione email presente: niente ripiego a caso.
    { EMAIL_ALLOWLIST: "paolo@gmail.com", APP_PUBLIC_URL: "https://staging.example.com" },
  ];
  for (const env of unknown) {
    assert.throws(() => getEmailPolicy(env), isEnvError, `getEmailPolicy ${JSON.stringify(env)}`);
    assert.throws(() => getAppPublicUrl(env), isEnvError, `getAppPublicUrl ${JSON.stringify(env)}`);
    assert.throws(() => isProduction(env), isEnvError, `isProduction ${JSON.stringify(env)}`);
  }
});

test("EnvironmentConfigError e' un Error con il nome giusto", () => {
  const error = new EnvironmentConfigError("prova");
  assert.ok(error instanceof Error);
  assert.equal(error.name, "EnvironmentConfigError");
  assert.equal(error.message, "prova");
});

test("il progetto di produzione e' esattamente giovani-palo", () => {
  assert.equal(isProduction({ GCLOUD_PROJECT: "giovani-palo" }), true);
  assert.equal(isProduction({ GOOGLE_CLOUD_PROJECT: "giovani-palo" }), true);
  assert.equal(isProduction({ FIREBASE_CONFIG: JSON.stringify({ projectId: "giovani-palo" }) }), true);
  assert.equal(isProduction({ GCLOUD_PROJECT: " giovani-palo " }), true);
});

test("un progetto che inizia con l'id di produzione NON e' produzione", () => {
  for (const projectId of [
    "giovani-palo-staging",
    "giovani-palo-2",
    "demo-giovani-palo",
    "xgiovani-palo",
    "Giovani-Palo",
  ]) {
    assert.equal(isProduction({ GCLOUD_PROJECT: projectId }), false, projectId);
  }
  assert.equal(isProduction(STAGING), false);
  assert.equal(isProduction({ GCLOUD_PROJECT: "demo-giovani-palo" }), false);
  assert.equal(isProduction({ GCLOUD_PROJECT: "Giovani-Palo" }), false);
});

// ---------------------------------------------------------------------------
// 2. Produzione
// ---------------------------------------------------------------------------

test("produzione: nessun filtro, nessun prefisso, mittente e reply-to di sempre", () => {
  const policy = getEmailPolicy(PROD);
  assert.equal(policy.isProduction, true);
  assert.equal(policy.allowlist, null);
  assert.equal(policy.subjectPrefix, "");
  assert.equal(policy.senderEmail, "noreply@gugditalia.it");
  assert.equal(policy.replyToEmail, "supporto@gugditalia.it");
});

test("produzione: EMAIL_ALLOWLIST, EMAIL_SUBJECT_PREFIX e APP_PUBLIC_URL dell'env sono ignorati", () => {
  const env = {
    ...PROD,
    EMAIL_ALLOWLIST: "solo-questo@example.invalid",
    EMAIL_SUBJECT_PREFIX: "[DEMO]",
    APP_PUBLIC_URL: "https://staging.example.com",
  };
  const policy = getEmailPolicy(env);
  assert.equal(policy.isProduction, true);
  assert.equal(policy.allowlist, null);
  assert.equal(policy.subjectPrefix, "");
  assert.equal(getAppPublicUrl(env), "https://gugditalia.it");
});

test("produzione: un'allowlist non valida nell'env non rompe nulla perche' non si legge", () => {
  const policy = getEmailPolicy({ ...PROD, EMAIL_ALLOWLIST: "*" });
  assert.equal(policy.allowlist, null);
});

test("produzione: gli override di mittente e reply-to dell'env sono ignorati", () => {
  const policy = getEmailPolicy({
    ...PROD,
    EMAIL_SENDER_ADDRESS: "altro@example.invalid",
    EMAIL_REPLY_TO_ADDRESS: "altro-supporto@example.invalid",
  });
  assert.equal(policy.senderEmail, "noreply@gugditalia.it");
  assert.equal(policy.replyToEmail, "supporto@gugditalia.it");
});

test("produzione: getAppPublicUrl e' https://gugditalia.it", () => {
  assert.equal(getAppPublicUrl(PROD), "https://gugditalia.it");
  assert.equal(getAppPublicUrl({ GOOGLE_CLOUD_PROJECT: "giovani-palo" }), "https://gugditalia.it");
  assert.equal(
    getAppPublicUrl({ FIREBASE_CONFIG: JSON.stringify({ projectId: "giovani-palo" }) }),
    "https://gugditalia.it",
  );
});

// ---------------------------------------------------------------------------
// 3. Non produzione: policy
// ---------------------------------------------------------------------------

test("non produzione: allowlist sempre un array, vuota se EMAIL_ALLOWLIST manca o e' vuota", () => {
  for (const env of [
    STAGING,
    { ...STAGING, EMAIL_ALLOWLIST: "" },
    { ...STAGING, EMAIL_ALLOWLIST: "   " },
    { ...STAGING, EMAIL_ALLOWLIST: " , ; " },
  ]) {
    const policy = getEmailPolicy(env);
    assert.equal(policy.isProduction, false);
    assert.ok(Array.isArray(policy.allowlist), JSON.stringify(env));
    assert.deepEqual(policy.allowlist, [], JSON.stringify(env));
  }
});

test("non produzione: l'allowlist viene letta e normalizzata dall'env", () => {
  const policy = getEmailPolicy({
    ...STAGING,
    EMAIL_ALLOWLIST: "Paolo@Gmail.com, @gugditalia.it",
  });
  assert.deepEqual(policy.allowlist, ["paolo@gmail.com", "@gugditalia.it"]);
});

test("non produzione: un'allowlist con voci non valide fa fallire la policy", () => {
  assert.throws(() => getEmailPolicy({ ...STAGING, EMAIL_ALLOWLIST: "*" }), isEnvError);
  assert.throws(() => getEmailPolicy({ ...STAGING, EMAIL_ALLOWLIST: "paolo@gmail.com, *@x.it" }), isEnvError);
});

test("non produzione: il prefisso oggetto di default e' '[TEST] '", () => {
  assert.equal(getEmailPolicy(STAGING).subjectPrefix, "[TEST] ");
});

test("non produzione: EMAIL_SUBJECT_PREFIX porta uno spazio finale solo", () => {
  assert.equal(getEmailPolicy({ ...STAGING, EMAIL_SUBJECT_PREFIX: "[DEMO]" }).subjectPrefix, "[DEMO] ");
  assert.equal(getEmailPolicy({ ...STAGING, EMAIL_SUBJECT_PREFIX: "[DEMO] " }).subjectPrefix, "[DEMO] ");
  assert.equal(getEmailPolicy({ ...STAGING, EMAIL_SUBJECT_PREFIX: "  [DEMO]  " }).subjectPrefix, "[DEMO] ");
});

test("non produzione: EMAIL_SUBJECT_PREFIX vuoto spegne il prefisso", () => {
  assert.equal(getEmailPolicy({ ...STAGING, EMAIL_SUBJECT_PREFIX: "" }).subjectPrefix, "");
});

test("non produzione: EMAIL_SENDER_ADDRESS ed EMAIL_REPLY_TO_ADDRESS sovrascrivono mittente e reply-to", () => {
  const policy = getEmailPolicy({
    ...STAGING,
    EMAIL_SENDER_ADDRESS: "invio@staging.example.invalid",
    EMAIL_REPLY_TO_ADDRESS: "risposte@staging.example.invalid",
  });
  assert.equal(policy.senderEmail, "invio@staging.example.invalid");
  assert.equal(policy.replyToEmail, "risposte@staging.example.invalid");
});

// ---------------------------------------------------------------------------
// 4. getAppPublicUrl fuori produzione
// ---------------------------------------------------------------------------

test("getAppPublicUrl: un progetto reale non di produzione richiede APP_PUBLIC_URL", () => {
  assert.throws(() => getAppPublicUrl(STAGING), isEnvError);
  assert.throws(() => getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: "" }), isEnvError);
  assert.throws(() => getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: "   " }), isEnvError);
});

test("getAppPublicUrl: i progetti demo-* dell'emulatore ripiegano su localhost:5173", () => {
  assert.equal(getAppPublicUrl({ GCLOUD_PROJECT: "demo-giovani-palo" }), "http://localhost:5173");
  assert.equal(getAppPublicUrl({ GCLOUD_PROJECT: "demo-qualunque", APP_PUBLIC_URL: "" }), "http://localhost:5173");
});

test("getAppPublicUrl: restituisce l'URL configurato", () => {
  assert.equal(
    getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: "https://staging.example.com" }),
    "https://staging.example.com",
  );
  assert.equal(
    getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: "https://staging.example.com/app" }),
    "https://staging.example.com/app",
  );
  assert.equal(
    getAppPublicUrl({ GCLOUD_PROJECT: "demo-giovani-palo", APP_PUBLIC_URL: "http://localhost:4000" }),
    "http://localhost:4000",
  );
});

test("getAppPublicUrl: un host di produzione e' vietato fuori da produzione", () => {
  const productionUrls = [
    "https://gugditalia.it",
    "https://gugditalia.it/",
    "https://www.gugditalia.it",
    "https://giovani-palo.web.app",
    "https://giovani-palo.firebaseapp.com",
    "http://gugditalia.it",
    "https://GUGDITALIA.IT",
    "https://www.gugditalia.it:8443/app?x=1",
    "https://staging.example.com@gugditalia.it",
  ];
  for (const url of productionUrls) {
    assert.throws(() => getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: url }), isEnvError, url);
  }
});

test("getAppPublicUrl: il divieto vale anche per i progetti demo-*", () => {
  assert.throws(
    () => getAppPublicUrl({ GCLOUD_PROJECT: "demo-giovani-palo", APP_PUBLIC_URL: "https://gugditalia.it" }),
    isEnvError,
  );
});

test("getAppPublicUrl: il punto finale del nome host non aggira il divieto (regressione)", () => {
  const trailingDotUrls = [
    "https://gugditalia.it./",
    "https://gugditalia.it.",
    "https://www.gugditalia.it../",
    "https://www.gugditalia.it...",
    "https://giovani-palo.web.app./",
    "https://giovani-palo.firebaseapp.com../app",
    "https://GUGDITALIA.IT./",
    "https://gugditalia.it.:8443/app?x=1",
    "https://staging.example.com@gugditalia.it./",
  ];
  for (const url of trailingDotUrls) {
    assert.throws(() => getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: url }), isEnvError, url);
    assert.throws(
      () => getAppPublicUrl({ GCLOUD_PROJECT: "demo-giovani-palo", APP_PUBLIC_URL: url }),
      isEnvError,
      `demo-* ${url}`,
    );
  }
});

test("getAppPublicUrl: il punto finale non rende vietato un host che non lo era", () => {
  for (const url of [
    "https://demo.gugditalia.it./",
    "https://evilgugditalia.it.",
    "https://gugditalia.it.example.com./",
    "https://staging.example.com./",
  ]) {
    assert.equal(getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: url }), url, url);
  }
});

test("getAppPublicUrl: gli host si confrontano esattamente, 'demo.gugditalia.it' e' ammesso", () => {
  for (const url of [
    "https://demo.gugditalia.it",
    "https://staging.gugditalia.it/",
    "https://evilgugditalia.it",
    "https://gugditalia.it.example.com",
    "https://giovani-palo-staging.web.app",
  ]) {
    assert.equal(getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: url }), url, url);
  }
});

test("getAppPublicUrl: un valore che non e' un URL lancia", () => {
  for (const value of ["non un url", "staging.example.com", "://rotto", "https://"]) {
    assert.throws(() => getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: value }), isEnvError, value);
  }
});

// ---------------------------------------------------------------------------
// 5. parseAllowlist
// ---------------------------------------------------------------------------

test("parseAllowlist separa su virgole, punti e virgola e spazi, e normalizza", () => {
  assert.deepEqual(
    parseAllowlist("Paolo@Gmail.com, a@b.it;c@d.it  e@f.it\n@Gugditalia.IT\t g@h.it"),
    ["paolo@gmail.com", "a@b.it", "c@d.it", "e@f.it", "@gugditalia.it", "g@h.it"],
  );
});

test("parseAllowlist scarta le voci vuote", () => {
  assert.deepEqual(parseAllowlist(",, ;; ,"), []);
  assert.deepEqual(parseAllowlist(" a@b.it ,, ; c@d.it , "), ["a@b.it", "c@d.it"]);
});

test("parseAllowlist di niente e' una lista vuota", () => {
  assert.deepEqual(parseAllowlist(undefined), []);
  assert.deepEqual(parseAllowlist(null), []);
  assert.deepEqual(parseAllowlist(""), []);
  assert.deepEqual(parseAllowlist("   "), []);
});

test("parseAllowlist accetta indirizzi esatti e @dominio.tld", () => {
  assert.deepEqual(parseAllowlist("paolo@gmail.com"), ["paolo@gmail.com"]);
  assert.deepEqual(parseAllowlist("paolo+genitore@gmail.com"), ["paolo+genitore@gmail.com"]);
  assert.deepEqual(parseAllowlist("@gugditalia.it"), ["@gugditalia.it"]);
  assert.deepEqual(parseAllowlist("@sub.gugditalia.it"), ["@sub.gugditalia.it"]);
});

test("parseAllowlist rifiuta wildcard e voci malformate", () => {
  for (const raw of [
    "*",
    "*@x.it",
    "foo",
    "a@b",
    "@b",
    "a@*.it",
    "@*.it",
    "foo*@x.it",
    "*.it",
    "a@b.*",
    "x@y.it, *",
    "paolo@gmail.com, foo",
  ]) {
    assert.throws(() => parseAllowlist(raw), isEnvError, raw);
  }
});

// ---------------------------------------------------------------------------
// 6. isAllowed
// ---------------------------------------------------------------------------

test("isAllowed: indirizzo esatto, senza distinguere maiuscole", () => {
  const allowlist = parseAllowlist("paolo@gmail.com");
  assert.equal(isAllowed(allowlist, "paolo@gmail.com"), true);
  assert.equal(isAllowed(allowlist, "PAOLO@GMAIL.COM"), true);
  assert.equal(isAllowed(allowlist, "  Paolo@Gmail.com  "), true);
  assert.equal(isAllowed(allowlist, "altro@gmail.com"), false);
  assert.equal(isAllowed(allowlist, "paolo@gmail.it"), false);
});

test("isAllowed: la voce @dominio ammette tutto quel dominio e solo quello", () => {
  const allowlist = parseAllowlist("@gugditalia.it");
  assert.equal(isAllowed(allowlist, "mario@gugditalia.it"), true);
  assert.equal(isAllowed(allowlist, "Mario.Rossi@GugdItalia.IT"), true);
  assert.equal(isAllowed(allowlist, "a+tag@gugditalia.it"), true);
  // sottodomini e domini simili
  assert.equal(isAllowed(allowlist, "mario@sub.gugditalia.it"), false);
  assert.equal(isAllowed(allowlist, "mario@evilgugditalia.it"), false);
  assert.equal(isAllowed(allowlist, "mario@gugditalia.it.evil.com"), false);
  assert.equal(isAllowed(allowlist, "mario@gugditalia.com"), false);
  assert.equal(isAllowed(allowlist, "mario@ugditalia.it"), false);
});

test("isAllowed: un indirizzo con +tag e' distinto da quello senza", () => {
  assert.equal(isAllowed(parseAllowlist("paolo@gmail.com"), "paolo+genitore@gmail.com"), false);
  assert.equal(isAllowed(parseAllowlist("paolo+genitore@gmail.com"), "paolo@gmail.com"), false);
  assert.equal(isAllowed(parseAllowlist("paolo+genitore@gmail.com"), "paolo+genitore@gmail.com"), true);
  // il dominio intero invece li ammette entrambi
  assert.equal(isAllowed(parseAllowlist("@gmail.com"), "paolo+genitore@gmail.com"), true);
});

test("isAllowed: input spazzatura e' sempre falso", () => {
  const allowlist = parseAllowlist("paolo@gmail.com, @gugditalia.it");
  for (const garbage of [
    undefined,
    null,
    "",
    "   ",
    "senza-chiocciola",
    "gugditalia.it",
    "@gugditalia.it",
    "paolo@",
    "@",
    42,
    {},
  ]) {
    assert.equal(isAllowed(allowlist, garbage), false, String(garbage));
  }
});

test("isAllowed: allowlist vuota non ammette nessuno", () => {
  assert.equal(isAllowed([], "paolo@gmail.com"), false);
  assert.equal(isAllowed([], "x@gugditalia.it"), false);
});

test("isAllowed: una voce scritta a mano con maiuscole e spazi viene normalizzata (regressione)", () => {
  // Liste non passate da parseAllowlist: la normalizzazione sta anche in isAllowed.
  assert.equal(isAllowed([" Paolo@Example.IT "], "paolo@example.it"), true);
  assert.equal(isAllowed([" Paolo@Example.IT "], "PAOLO@EXAMPLE.IT"), true);
  assert.equal(isAllowed(["\tPAOLO@EXAMPLE.IT\n"], " paolo@example.it "), true);
  assert.equal(isAllowed(["altro@example.it", " Paolo@Example.IT "], "paolo@example.it"), true);
});

test("isAllowed: una voce @dominio scritta a mano con maiuscole e spazi ammette il dominio", () => {
  assert.equal(isAllowed([" @Example.IT "], "mario@example.it"), true);
  assert.equal(isAllowed(["@EXAMPLE.IT"], "Mario@Example.It"), true);
  // La normalizzazione non allarga la voce: sottodomini e domini simili restano fuori.
  assert.equal(isAllowed([" @Example.IT "], "mario@sub.example.it"), false);
  assert.equal(isAllowed([" @Example.IT "], "mario@evilexample.it"), false);
});

test("isAllowed: normalizzare la voce non cancella la distinzione dei +tag", () => {
  assert.equal(isAllowed([" Paolo@Example.IT "], "paolo+genitore@example.it"), false);
  assert.equal(isAllowed([" Paolo@Example.IT "], "altro@example.it"), false);
});

// Il `parentEmail` arriva dal client senza validazione: una stringa con piu'
// indirizzi che finisce con "@dominio-ammesso" non deve superare l'allowlist.
const MULTI_ADDRESS_ATTACKS = [
  "victim@gmail.com,x@gugditalia.it",
  "victim@gmail.com x@gugditalia.it",
  "victim@gmail.com<x@gugditalia.it",
  '"victim@gmail.com"@gugditalia.it',
  "a@gugditalia.it;b@gmail.com",
  "Name <x@gugditalia.it>",
  "victim@gmail.com;x@gugditalia.it",
  "victim@gmail.com\tx@gugditalia.it",
  "victim@gmail.com\nx@gugditalia.it",
  "victim@gmail.com\r\nBcc: x@gugditalia.it",
  "x@gugditalia.it,victim@gmail.com",
  "x@gugditalia.it victim@gmail.com",
  "victim@gmail.com@gugditalia.it",
  "victim@gmail.com>x@gugditalia.it",
  "<victim@gmail.com>x@gugditalia.it",
  "victim@gmail.com(x)@gugditalia.it",
  "victim@gmail.com:x@gugditalia.it",
  "victim@gmail.com\\x@gugditalia.it",
  "victim[x]@gmail.com@gugditalia.it",
];

test("isAllowed: una stringa con piu' indirizzi non passa con una voce @dominio (regressione)", () => {
  const allowlist = parseAllowlist("@gugditalia.it");
  for (const attack of MULTI_ADDRESS_ATTACKS) {
    assert.equal(isAllowed(allowlist, attack), false, JSON.stringify(attack));
    // anche con spazi e maiuscole attorno
    assert.equal(isAllowed(allowlist, `  ${attack.toUpperCase()} `), false, JSON.stringify(attack));
  }
});

test("isAllowed: una stringa con piu' indirizzi non passa nemmeno con una voce esatta (regressione)", () => {
  const allowlist = parseAllowlist("x@gugditalia.it, victim@gmail.com");
  for (const attack of MULTI_ADDRESS_ATTACKS) {
    assert.equal(isAllowed(allowlist, attack), false, JSON.stringify(attack));
  }
  // Controprova: i due indirizzi singoli passano.
  assert.equal(isAllowed(allowlist, "x@gugditalia.it"), true);
  assert.equal(isAllowed(allowlist, "victim@gmail.com"), true);
});

test("isAllowed: una stringa con piu' indirizzi non passa nemmeno se e' identica a una voce della lista", () => {
  // Lista scritta a mano (parseAllowlist non la produrrebbe): il controllo
  // sull'indirizzo singolo viene prima del confronto.
  for (const attack of MULTI_ADDRESS_ATTACKS) {
    assert.equal(isAllowed([attack], attack), false, JSON.stringify(attack));
  }
});

test("isAllowed: indirizzi semplici validi continuano a passare", () => {
  const allowlist = parseAllowlist("@example.it, @sub.example.it, @a-b.example.it");
  for (const address of [
    "paolo@example.it",
    "paolo.rossi+tag@example.it",
    "o'brien@example.it",
    "a_b-c@sub.example.it",
    "x@a-b.example.it",
    "1234@example.it",
    "  Paolo.Rossi@EXAMPLE.it \n",
  ]) {
    assert.equal(isAllowed(allowlist, address), true, address);
  }
});

test("isAllowed: dominio senza punti o malformato non passa", () => {
  for (const address of [
    "x@localhost",
    "x@gugditalia",
    "x@gugditalia.it.",
    "x@.gugditalia.it",
    "x@gugditalia..it",
    "x@gugdi_talia.it",
    "x@[127.0.0.1]",
    "x@gugdítalia.it",
    "x@gugditalia.it/",
  ]) {
    // hand-built: ogni voce possibile, comprese quelle che parseAllowlist rifiuterebbe
    const allowlist = [address, `@${address.split("@")[1]}`];
    assert.equal(isAllowed(allowlist, address), false, address);
  }
});

test("isAllowed: ogni carattere vietato nel nome utente basta da solo a rifiutare l'indirizzo (regressione)", () => {
  const allowlist = parseAllowlist("@gugditalia.it");
  assert.equal(isAllowed(allowlist, "ab@gugditalia.it"), true, "controprova senza carattere vietato");

  for (const char of [",", ";", "<", ">", '"', "(", ")", "[", "]", "\\", ":", " ", "\t", "\n", "\r", "@"]) {
    const address = `a${char}b@gugditalia.it`;
    assert.equal(isAllowed(allowlist, address), false, JSON.stringify(address));
  }
});

// ---------------------------------------------------------------------------
// 7. planDelivery
// ---------------------------------------------------------------------------

const person = (email, name) => (name ? { email, name } : { email });

test("planDelivery: allowlist null lascia passare tutto invariato", () => {
  const to = [person("a@qualunque.it", "A"), person("b@altro.it")];
  const bcc = [person("supporto@gugditalia.it", "Supporto")];
  const plan = planDelivery({ allowlist: null }, { to, bcc });
  assert.equal(plan.simulated, false);
  assert.deepEqual(plan.to, to);
  assert.deepEqual(plan.bcc, bcc);
  assert.equal(plan.suppressed, 0);
});

test("planDelivery: allowlist null senza bcc non inventa destinatari", () => {
  const plan = planDelivery({ allowlist: null }, { to: [person("a@qualunque.it")] });
  assert.equal(plan.simulated, false);
  assert.deepEqual(plan.to, [person("a@qualunque.it")]);
  assert.deepEqual(plan.bcc, []);
});

test("planDelivery: To e BCC si filtrano uno per uno", () => {
  const policy = { allowlist: parseAllowlist("@ok.it, extra@fuori.it") };
  const plan = planDelivery(policy, {
    to: [person("uno@ok.it", "Uno"), person("due@no.it", "Due"), person("extra@fuori.it")],
    bcc: [person("bcc-si@ok.it"), person("bcc-no@no.it")],
  });
  assert.equal(plan.simulated, false);
  assert.deepEqual(plan.to, [person("uno@ok.it", "Uno"), person("extra@fuori.it")]);
  assert.deepEqual(plan.bcc, [person("bcc-si@ok.it")]);
  assert.equal(plan.suppressed, 2);
});

test("planDelivery: se resta un To ma cadono tutti i BCC, la mail parte senza BCC", () => {
  const policy = { allowlist: parseAllowlist("genitore@ok.it") };
  const plan = planDelivery(policy, {
    to: [person("genitore@ok.it")],
    bcc: [person("supporto@gugditalia.it")],
  });
  assert.equal(plan.simulated, false);
  assert.deepEqual(plan.to, [person("genitore@ok.it")]);
  assert.deepEqual(plan.bcc, []);
  assert.equal(plan.suppressed, 1);
});

test("planDelivery: se nessun To passa la mail e' simulata, anche con un BCC ammesso", () => {
  const policy = { allowlist: parseAllowlist("supporto@gugditalia.it") };
  const plan = planDelivery(policy, {
    to: [person("genitore@no.it")],
    bcc: [person("supporto@gugditalia.it")],
  });
  assert.equal(plan.simulated, true);
  assert.deepEqual(plan.to, []);
  assert.deepEqual(plan.bcc, []);
  // spec ambigua: "suppressed" quando la mail e' simulata. Si assume che tutto sia scartato.
  assert.equal(plan.suppressed, 2);
});

test("planDelivery: senza To la mail e' simulata", () => {
  const policy = { allowlist: parseAllowlist("a@ok.it") };
  const plan = planDelivery(policy, { to: [], bcc: [person("a@ok.it")] });
  assert.equal(plan.simulated, true);
  assert.deepEqual(plan.to, []);
  assert.deepEqual(plan.bcc, []);
});

test("planDelivery: allowlist vuota simula sempre", () => {
  const plan = planDelivery(
    { allowlist: [] },
    { to: [person("a@gugditalia.it")], bcc: [person("supporto@gugditalia.it")] },
  );
  assert.equal(plan.simulated, true);
  assert.deepEqual(plan.to, []);
  assert.deepEqual(plan.bcc, []);
});

test("planDelivery: usa le stesse regole di isAllowed (maiuscole, +tag, domini simili)", () => {
  const policy = { allowlist: parseAllowlist("paolo@gmail.com, @gugditalia.it") };
  const plan = planDelivery(policy, {
    to: [
      person("PAOLO@Gmail.com"),
      person("paolo+genitore@gmail.com"),
      person("x@evilgugditalia.it"),
      person("y@gugditalia.it"),
    ],
  });
  // Passano le stesse due di isAllowed, e a Brevo va l'indirizzo normalizzato.
  assert.deepEqual(plan.to, [person("paolo@gmail.com"), person("y@gugditalia.it")]);
  assert.equal(plan.suppressed, 2);
});

test("planDelivery: solo allowlist === null lascia passare tutto, ogni altro valore non valido simula (regressione)", () => {
  const recipients = () => ({
    to: [person("genitore@example.invalid")],
    bcc: [person("supporto@gugditalia.it")],
  });
  const malformed = [
    ["undefined", { allowlist: undefined }],
    ["chiave assente", {}],
    ["stringa con l'indirizzo dentro", { allowlist: "genitore@example.invalid" }],
    ["stringa con il dominio dentro", { allowlist: "@example.invalid" }],
    ["stringa vuota", { allowlist: "" }],
    ["oggetto vuoto", { allowlist: {} }],
    ["oggetto con chiavi", { allowlist: { "genitore@example.invalid": true } }],
    ["zero", { allowlist: 0 }],
    ["false", { allowlist: false }],
    ["true", { allowlist: true }],
  ];
  for (const [label, policy] of malformed) {
    const plan = planDelivery(policy, recipients());
    assert.equal(plan.simulated, true, label);
    assert.deepEqual(plan.to, [], label);
    assert.deepEqual(plan.bcc, [], label);
  }

  // Controprova: solo null passa, e lascia le liste invariate.
  const passthrough = planDelivery({ allowlist: null }, recipients());
  assert.equal(passthrough.simulated, false);
  assert.deepEqual(passthrough.to, recipients().to);
  assert.deepEqual(passthrough.bcc, recipients().bcc);
});

test("planDelivery: una policy non di produzione senza allowlist valida non spedisce nemmeno senza BCC", () => {
  const plan = planDelivery({ isProduction: false, allowlist: undefined }, { to: [person("a@example.invalid")] });
  assert.equal(plan.simulated, true);
  assert.deepEqual(plan.to, []);
  assert.deepEqual(plan.bcc, []);
});

test("planDelivery: le voci dell'allowlist scritte a mano con maiuscole e spazi funzionano (regressione)", () => {
  const plan = planDelivery(
    { allowlist: [" Paolo@Example.IT ", " @Gugditalia.IT "] },
    {
      to: [person("paolo@example.it"), person("altro@example.it")],
      bcc: [person("supporto@gugditalia.it")],
    },
  );
  assert.equal(plan.simulated, false);
  assert.deepEqual(plan.to, [person("paolo@example.it")]);
  assert.deepEqual(plan.bcc, [person("supporto@gugditalia.it")]);
  assert.equal(plan.suppressed, 1);
});

test("planDelivery non modifica le liste ricevute", () => {
  const to = [person("a@ok.it"), person("b@no.it")];
  const bcc = [person("c@no.it")];
  planDelivery({ allowlist: parseAllowlist("@ok.it") }, { to, bcc });
  assert.deepEqual(to, [person("a@ok.it"), person("b@no.it")]);
  assert.deepEqual(bcc, [person("c@no.it")]);
});

test("planDelivery con la policy reale: produzione passa tutto, staging vuoto simula", () => {
  const recipients = {
    to: [person("genitore@example.invalid")],
    bcc: [person("supporto@gugditalia.it")],
  };
  const prod = planDelivery(getEmailPolicy(PROD), recipients);
  assert.equal(prod.simulated, false);
  assert.deepEqual(prod.to, recipients.to);
  assert.deepEqual(prod.bcc, recipients.bcc);

  const staging = planDelivery(getEmailPolicy(STAGING), recipients);
  assert.equal(staging.simulated, true);
  assert.deepEqual(staging.to, []);
  assert.deepEqual(staging.bcc, []);
});

test("planDelivery: a Brevo va l'indirizzo normalizzato, il resto del destinatario resta (regressione)", () => {
  const policy = { allowlist: parseAllowlist("paolo@example.it, @gugditalia.it") };
  const to = [person("  Paolo@Example.IT\t", "Paolo Rossi")];
  const bcc = [person(" SUPPORTO@GugdItalia.IT ", "Supporto")];

  const plan = planDelivery(policy, { to, bcc });

  assert.equal(plan.simulated, false);
  assert.deepEqual(plan.to, [{ email: "paolo@example.it", name: "Paolo Rossi" }]);
  assert.deepEqual(plan.bcc, [{ email: "supporto@gugditalia.it", name: "Supporto" }]);
  // Gli oggetti ricevuti non vengono modificati.
  assert.deepEqual(to, [person("  Paolo@Example.IT\t", "Paolo Rossi")]);
  assert.deepEqual(bcc, [person(" SUPPORTO@GugdItalia.IT ", "Supporto")]);
});

test("planDelivery: in produzione (allowlist null) gli indirizzi restano come arrivano (regressione)", () => {
  const to = [person("  Paolo@Example.IT ", "Paolo"), person("victim@gmail.com,x@gugditalia.it")];
  const bcc = [person("SUPPORTO@gugditalia.it")];
  const plan = planDelivery({ allowlist: null }, { to, bcc });

  assert.equal(plan.simulated, false);
  assert.deepEqual(plan.to, [person("  Paolo@Example.IT ", "Paolo"), person("victim@gmail.com,x@gugditalia.it")]);
  assert.deepEqual(plan.bcc, [person("SUPPORTO@gugditalia.it")]);
  assert.equal(plan.suppressed, 0);
});

test("planDelivery: un destinatario con piu' indirizzi viene scartato, quello pulito resta (regressione)", () => {
  const policy = { allowlist: parseAllowlist("@gugditalia.it") };
  for (const attack of MULTI_ADDRESS_ATTACKS) {
    const alone = planDelivery(policy, { to: [person(attack)], bcc: [person("supporto@gugditalia.it")] });
    assert.equal(alone.simulated, true, JSON.stringify(attack));
    assert.deepEqual(alone.to, []);
    assert.deepEqual(alone.bcc, []);

    const mixed = planDelivery(policy, {
      to: [person("mario@gugditalia.it"), person(attack)],
      bcc: [person(attack), person("supporto@gugditalia.it")],
    });
    assert.equal(mixed.simulated, false, JSON.stringify(attack));
    assert.deepEqual(mixed.to, [person("mario@gugditalia.it")]);
    assert.deepEqual(mixed.bcc, [person("supporto@gugditalia.it")]);
    assert.equal(mixed.suppressed, 2);
  }
});

// ---------------------------------------------------------------------------
// 8. decorateMessage
// ---------------------------------------------------------------------------

const HTML_WITH_BODY =
  '<!DOCTYPE html>\n<html lang="it">\n<head><title>Titolo</title></head>\n' +
  '<body style="margin:0;padding:0;">\n  <p>Ciao Mario</p>\n</body>\n</html>';
const TEXT = "Gentile genitore,\nci serve la tua firma.";
const SUBJECT = "Autorizzazione richiesta per Campo estivo";

const message = (overrides = {}) => ({
  subject: SUBJECT,
  htmlContent: HTML_WITH_BODY,
  textContent: TEXT,
  ...overrides,
});

test("decorateMessage: in produzione il messaggio resta identico", () => {
  const policy = getEmailPolicy(PROD);
  const out = decorateMessage(policy, message());
  assert.equal(out.subject, SUBJECT);
  assert.equal(out.htmlContent, HTML_WITH_BODY);
  assert.equal(out.textContent, TEXT);
  assert.ok(!out.htmlContent.includes(ENVIRONMENT_NOTICE));
  assert.ok(!out.textContent.includes(ENVIRONMENT_NOTICE));
});

test("decorateMessage: fuori da produzione l'oggetto riceve il prefisso", () => {
  const out = decorateMessage(getEmailPolicy(STAGING), message());
  assert.equal(out.subject, `[TEST] ${SUBJECT}`);

  const custom = decorateMessage(getEmailPolicy({ ...STAGING, EMAIL_SUBJECT_PREFIX: "[DEMO]" }), message());
  assert.equal(custom.subject, `[DEMO] ${SUBJECT}`);
});

test("decorateMessage: prefisso vuoto lascia l'oggetto com'e'", () => {
  const out = decorateMessage(getEmailPolicy({ ...STAGING, EMAIL_SUBJECT_PREFIX: "" }), message());
  assert.equal(out.subject, SUBJECT);
});

test("decorateMessage: il testo riceve l'avviso in testa e conserva l'originale", () => {
  const out = decorateMessage(getEmailPolicy(STAGING), message());
  assert.ok(out.textContent.startsWith(ENVIRONMENT_NOTICE));
  assert.ok(out.textContent.endsWith(TEXT));
  assert.notEqual(out.textContent, TEXT);
});

test("decorateMessage: il banner HTML sta subito dopo il tag <body>", () => {
  const out = decorateMessage(getEmailPolicy(STAGING), message()).htmlContent;
  const bodyTag = '<body style="margin:0;padding:0;">';
  const insertAt = HTML_WITH_BODY.indexOf(bodyTag) + bodyTag.length;

  // Tutto cio' che precede il banner e tutto cio' che segue e' l'originale, intatto.
  assert.ok(out.startsWith(HTML_WITH_BODY.slice(0, insertAt)));
  assert.ok(out.endsWith(HTML_WITH_BODY.slice(insertAt)));

  const banner = out.slice(insertAt, out.length - (HTML_WITH_BODY.length - insertAt));
  assert.ok(banner.length > 0);
  assert.ok(banner.includes(ENVIRONMENT_NOTICE));
  assert.equal(out.split(ENVIRONMENT_NOTICE).length - 1, 1, "il banner compare una volta sola");
});

test("decorateMessage: <body> senza attributi o scritto in maiuscolo funziona uguale", () => {
  for (const tag of ["<body>", "<BODY>", '<BODY class="x">']) {
    const html = `<html><head></head>${tag}<p>Ciao</p></body></html>`;
    const out = decorateMessage(getEmailPolicy(STAGING), message({ htmlContent: html })).htmlContent;
    const insertAt = html.indexOf(tag) + tag.length;
    assert.ok(out.startsWith(html.slice(0, insertAt)), tag);
    assert.ok(out.endsWith(html.slice(insertAt)), tag);
    assert.ok(out.slice(insertAt).startsWith("<"), tag);
    assert.ok(out.includes(ENVIRONMENT_NOTICE), tag);
  }
});

test("decorateMessage: senza tag <body> il banner va in testa", () => {
  const html = "<p>Solo un frammento</p>";
  const out = decorateMessage(getEmailPolicy(STAGING), message({ htmlContent: html })).htmlContent;
  assert.ok(out.endsWith(html));
  assert.ok(out.includes(ENVIRONMENT_NOTICE));
  const banner = out.slice(0, out.length - html.length);
  assert.ok(banner.includes(ENVIRONMENT_NOTICE));
  assert.ok(banner.trimStart().startsWith("<"));
});

test("decorateMessage: un contenuto con '$&' o '$1' non viene alterato dall'inserimento", () => {
  const html = '<html><body class="a">Prezzo $& $1 $$ fine</body></html>';
  const out = decorateMessage(getEmailPolicy(STAGING), message({ htmlContent: html })).htmlContent;
  const bodyTag = '<body class="a">';
  const insertAt = html.indexOf(bodyTag) + bodyTag.length;
  assert.ok(out.startsWith(html.slice(0, insertAt)));
  assert.ok(out.endsWith(html.slice(insertAt)));
});

test("decorateMessage non modifica l'oggetto ricevuto", () => {
  const input = message();
  const snapshot = { ...input };
  decorateMessage(getEmailPolicy(STAGING), input);
  assert.deepEqual(input, snapshot);
});

// ---------------------------------------------------------------------------
// 9. maskAddress
// ---------------------------------------------------------------------------

test("maskAddress mostra al massimo il primo carattere del nome utente", () => {
  assert.equal(maskAddress("zxqwv@example.invalid"), "z***@example.invalid");

  const masked = maskAddress("zxqwv@example.invalid");
  const [local] = masked.split("@");
  for (const leaked of ["zx", "xq", "qw", "wv", "xqwv"]) {
    assert.ok(!local.includes(leaked), `${masked} contiene ${leaked}`);
  }
});

test("maskAddress con nome utente di un carattere non lo ripete ne' lo allunga", () => {
  assert.equal(maskAddress("a@example.invalid"), "a***@example.invalid");
});

test("maskAddress con +tag non lascia uscire il tag", () => {
  const masked = maskAddress("zxqwv+genitore@example.invalid");
  assert.ok(!masked.includes("genitore"));
  assert.ok(!masked.includes("+"));
});

test("maskAddress non lancia mai e non restituisce l'input su spazzatura", () => {
  for (const garbage of [
    undefined,
    null,
    "",
    "   ",
    "senza-chiocciola",
    "@",
    "@example.invalid",
    "paolo@",
    42,
    {},
    [],
    true,
  ]) {
    let out;
    assert.doesNotThrow(() => {
      out = maskAddress(garbage);
    }, String(garbage));
    assert.equal(typeof out, "string");
    if (typeof garbage === "string" && garbage.trim()) {
      assert.notEqual(out, garbage, `${garbage} restituito in chiaro`);
    }
  }
  assert.equal(maskAddress("senza-chiocciola"), "***");
});

// ---------------------------------------------------------------------------
// 10. Emulatore delle functions e URL pubblico (env sempre iniettato)
// ---------------------------------------------------------------------------

const EMULATOR = { FUNCTIONS_EMULATOR: "true" };
const DEMO = { GCLOUD_PROJECT: "demo-giovani-palo" };

test("isEmulatorRuntime: vale solo FUNCTIONS_EMULATOR=true, senza distinguere maiuscole", () => {
  for (const value of ["true", "TRUE", "True", "tRuE"]) {
    assert.equal(isEmulatorRuntime({ FUNCTIONS_EMULATOR: value }), true, value);
  }
  for (const value of [undefined, "", "false", "FALSE", "0", "1", "yes", "tru", "truee"]) {
    assert.equal(isEmulatorRuntime({ FUNCTIONS_EMULATOR: value }), false, String(value));
  }
  assert.equal(isEmulatorRuntime({}), false);
});

test("emulatore: il progetto di produzione sotto l'emulatore NON e' produzione (regressione)", () => {
  for (const projectEnv of [
    { GCLOUD_PROJECT: "giovani-palo" },
    { GOOGLE_CLOUD_PROJECT: "giovani-palo" },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: "giovani-palo" }) },
  ]) {
    for (const flag of ["true", "TRUE"]) {
      const env = { ...projectEnv, FUNCTIONS_EMULATOR: flag };
      assert.equal(isProduction(env), false, JSON.stringify(env));

      const policy = getEmailPolicy(env);
      assert.equal(policy.isProduction, false, JSON.stringify(env));
      assert.equal(policy.projectId, "giovani-palo");
      assert.ok(Array.isArray(policy.allowlist), "allowlist attiva");
      assert.deepEqual(policy.allowlist, []);
      assert.equal(policy.subjectPrefix, "[TEST] ");
    }
  }
});

test("emulatore: sul progetto di produzione EMAIL_ALLOWLIST ed EMAIL_SUBJECT_PREFIX tornano ad avere effetto", () => {
  const policy = getEmailPolicy({
    ...PROD,
    ...EMULATOR,
    EMAIL_ALLOWLIST: "Dev@Example.invalid",
    EMAIL_SUBJECT_PREFIX: "[DEMO]",
  });
  assert.deepEqual(policy.allowlist, ["dev@example.invalid"]);
  assert.equal(policy.subjectPrefix, "[DEMO] ");
  // e una voce non valida non e' piu' ignorata
  assert.throws(() => getEmailPolicy({ ...PROD, ...EMULATOR, EMAIL_ALLOWLIST: "*" }), isEnvError);
});

test("emulatore sul progetto di produzione: niente esce verso genitori e supporto, il messaggio e' marcato", () => {
  const policy = getEmailPolicy({ ...PROD, ...EMULATOR });
  const plan = planDelivery(policy, {
    to: [person("genitore@example.invalid")],
    bcc: [person("supporto@gugditalia.it")],
  });
  assert.equal(plan.simulated, true);
  assert.deepEqual(plan.to, []);
  assert.deepEqual(plan.bcc, []);

  const out = decorateMessage(policy, message());
  assert.equal(out.subject, `[TEST] ${SUBJECT}`);
  assert.ok(out.htmlContent.includes(ENVIRONMENT_NOTICE));
  assert.ok(out.textContent.startsWith(ENVIRONMENT_NOTICE));
});

test("emulatore sul progetto di produzione: l'URL pubblico e' localhost, mai quello di produzione (regressione)", () => {
  assert.equal(getAppPublicUrl({ ...PROD, ...EMULATOR }), "http://localhost:5173");
  assert.equal(getAppPublicUrl({ ...PROD, ...EMULATOR, APP_PUBLIC_URL: "" }), "http://localhost:5173");
  assert.equal(getAppPublicUrl({ ...PROD, FUNCTIONS_EMULATOR: "TRUE" }), "http://localhost:5173");
  assert.equal(
    getAppPublicUrl({ ...PROD, ...EMULATOR, APP_PUBLIC_URL: "http://localhost:4000" }),
    "http://localhost:4000",
  );
  assert.equal(
    getAppPublicUrl({ ...PROD, ...EMULATOR, APP_PUBLIC_URL: "https://staging.example.com" }),
    "https://staging.example.com",
  );
  for (const url of ["https://gugditalia.it", "https://www.gugditalia.it/", "https://giovani-palo.web.app"]) {
    assert.throws(() => getAppPublicUrl({ ...PROD, ...EMULATOR, APP_PUBLIC_URL: url }), isEnvError, url);
  }
});

test("emulatore: un progetto sconosciuto resta un errore, anche con FUNCTIONS_EMULATOR", () => {
  assert.throws(() => getEmailPolicy(EMULATOR), isEnvError);
  assert.throws(() => getAppPublicUrl(EMULATOR), isEnvError);
  assert.throws(() => isProduction(EMULATOR), isEnvError);
});

test("emulatore su un progetto di staging: policy da env e URL di default localhost", () => {
  // Il default localhost per un progetto non demo e' dedotto dal codice, la descrizione parla del progetto di produzione.
  const env = { ...STAGING, ...EMULATOR };
  assert.equal(isProduction(env), false);
  assert.deepEqual(getEmailPolicy({ ...env, EMAIL_ALLOWLIST: "a@example.invalid" }).allowlist, ["a@example.invalid"]);
  assert.equal(getAppPublicUrl(env), "http://localhost:5173");
});

test("produzione reale (senza FUNCTIONS_EMULATOR o con valore diverso da true) resta invariata", () => {
  for (const extra of [{}, { FUNCTIONS_EMULATOR: "false" }, { FUNCTIONS_EMULATOR: "" }, { FUNCTIONS_EMULATOR: "0" }]) {
    const env = {
      ...PROD,
      ...extra,
      EMAIL_ALLOWLIST: "solo-questo@example.invalid",
      EMAIL_SUBJECT_PREFIX: "[DEMO]",
      APP_PUBLIC_URL: "javascript:alert(1)",
    };
    assert.equal(isProduction(env), true, JSON.stringify(extra));
    const policy = getEmailPolicy(env);
    assert.equal(policy.isProduction, true);
    assert.equal(policy.allowlist, null);
    assert.equal(policy.subjectPrefix, "");
    assert.equal(getAppPublicUrl(env), "https://gugditalia.it");
  }
});

test("getAppPublicUrl: gli schemi diversi da https sono vietati (regressione)", () => {
  const badSchemes = [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "ftp://staging.example.com",
    "data:text/html,ciao",
    "file:///etc/passwd",
    "http://staging.example.com",
    "HTTP://STAGING.EXAMPLE.COM/app",
    "ws://staging.example.com",
  ];
  for (const url of badSchemes) {
    for (const [label, env] of [
      ["staging", STAGING],
      ["demo-*", DEMO],
      ["emulatore su produzione", { ...PROD, ...EMULATOR }],
      ["emulatore su staging", { ...STAGING, ...EMULATOR }],
    ]) {
      assert.throws(() => getAppPublicUrl({ ...env, APP_PUBLIC_URL: url }), isEnvError, `${label}: ${url}`);
    }
  }
});

test("getAppPublicUrl: https resta ammesso ovunque non sia un host di produzione", () => {
  for (const env of [STAGING, DEMO, { ...PROD, ...EMULATOR }]) {
    assert.equal(
      getAppPublicUrl({ ...env, APP_PUBLIC_URL: "https://staging.example.com/app" }),
      "https://staging.example.com/app",
    );
  }
});

test("getAppPublicUrl: http su localhost solo in un progetto demo-* o sotto l'emulatore (regressione)", () => {
  const localUrls = [
    "http://localhost:5173",
    "http://localhost",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
    "http://LOCALHOST:5173/app",
  ];
  for (const url of localUrls) {
    for (const [label, env] of [
      ["demo-*", DEMO],
      ["emulatore su produzione", { ...PROD, ...EMULATOR }],
      ["emulatore su staging", { ...STAGING, ...EMULATOR }],
    ]) {
      assert.equal(getAppPublicUrl({ ...env, APP_PUBLIC_URL: url }), url, `${label}: ${url}`);
    }
    // Un progetto reale non demo e fuori dall'emulatore non puo' mandare link a localhost.
    assert.throws(() => getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: url }), isEnvError, `staging: ${url}`);
  }
});

test("getAppPublicUrl: http su host che somigliano a localhost resta vietato anche in locale", () => {
  for (const url of [
    "http://localhost.evil.com",
    "http://127.0.0.1.evil.com",
    "http://localhost@evil.com",
    "http://evil.com/localhost",
    "http://192.168.1.10:5173",
    "http://0.0.0.0:5173",
    "http://10.0.0.1",
  ]) {
    for (const env of [DEMO, { ...PROD, ...EMULATOR }]) {
      assert.throws(() => getAppPublicUrl({ ...env, APP_PUBLIC_URL: url }), isEnvError, url);
    }
  }
});

test("getAppPublicUrl: le anteprime del sito di produzione (giovani-palo--canale) sono vietate (regressione)", () => {
  const previews = [
    "https://giovani-palo--pr1-abc.web.app",
    "https://giovani-palo--pr1-abc.firebaseapp.com",
    "https://giovani-palo--pr1-abc.web.app/",
    "https://giovani-palo--pr1-abc.web.app./",
    "https://GIOVANI-PALO--PR1-ABC.WEB.APP",
    "https://giovani-palo--pr1-abc.firebaseapp.com:8443/app?x=1",
    "https://giovani-palo--live.web.app",
  ];
  for (const url of previews) {
    for (const [label, env] of [
      ["staging", STAGING],
      ["demo-*", DEMO],
      ["emulatore su produzione", { ...PROD, ...EMULATOR }],
    ]) {
      assert.throws(() => getAppPublicUrl({ ...env, APP_PUBLIC_URL: url }), isEnvError, `${label}: ${url}`);
    }
  }
});

test("getAppPublicUrl: le anteprime del sito di staging non sono vietate", () => {
  for (const url of [
    "https://giovani-palo-staging--pr1-abc.web.app",
    "https://giovani-palo-staging.web.app",
    "https://giovani-palo-staging.firebaseapp.com/",
  ]) {
    assert.equal(getAppPublicUrl({ ...STAGING, APP_PUBLIC_URL: url }), url, url);
  }
});
