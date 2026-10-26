// Guardie delle callable del genitore su iscrizioni annullate o cancellate e
// ciclo di vita di parentAuthorization.selfTokenIssuedAt (fase 2 del flusso
// genitore). Callable vere (SDK client -> Functions emulator) con utenti veri
// dell'Auth emulator e trigger onRegistrationPendingParentAuth attivo; l'Admin
// SDK serve solo per seminare e ispezionare.
//   - parentAuthorizationGetContext: link valido ma iscrizione annullata o
//     cancellata -> { status: "invalidated", reason: "registration_cancelled" };
//     link valido e iscrizione attiva -> createdByMode del token.
//   - canSignInApp: true solo per il genitore titolare (child_<uid>_), in tutti i
//     rami di GetContext, compresi i token non validi.
//   - parentAuthorizationConfirm / Reject su iscrizione annullata ->
//     failed-precondition "L'iscrizione è annullata.", documento e token intatti;
//     Reject su iscrizione cancellata -> not-found, il documento non rinasce.
//   - Reject con un link valido mentre ne esiste un altro pendente della stessa
//     iscrizione: il link usato diventa used, l'altro invalidated (con
//     token_invalidated), quello dello stesso figlio in un'altra attività resta.
//     La conferma, che salva la firma su Storage, sta in parentConsentEmulator.
//   - parentAuthorizationResend su iscrizione annullata -> failed-precondition;
//     su autorizzazione già firmata o rifiutata dal genitore, o senza i dati del
//     genitore nel modulo -> failed-precondition, iscrizione e token intatti,
//     nessun link nuovo.
//   - Dati sanitari del modulo copiati su un'autorizzazione aperta senza link
//     né mail nuovi; mai su una già firmata.
//   - selfTokenIssuedAt: scritto da parentAuthorizationIssueOwnToken, azzerato
//     da ogni mail (prima mail del trigger, reinvio del trigger dopo il cambio
//     di email, callable di reinvio).
//   - Un solo link vivo per iscrizione: dopo ogni invio o reinvio (trigger dopo
//     il cambio di email, callable dell'admin, due scritture ravvicinate del
//     modulo) resta UN token pending per (palo, attività, iscrizione), quello
//     annotato in parentAuthorization.tokenId, e parte UNA mail (eventi
//     `email_sent` dell'audit). Gli altri pending della stessa iscrizione nella
//     stessa attività, anche orfani non annotati, diventano invalidated; quelli
//     dello stesso figlio in un'altra attività restano intatti.
//   - Tetto ai riprovi del trigger (MAX_EMAIL_RETRIES = 3, emailRetryCount):
//     sotto il tetto il trigger riprova e lascia vivo solo il link nuovo; oltre
//     il tetto una scrittura innocua non lo fa ripartire, mentre il reinvio
//     dell'admin funziona e azzera il contatore, e una mail corretta nel modulo
//     vale un tentativo verso il nuovo indirizzo.
//   - Errore vero del provider (solo con EMAIL_ALLOWLIST=@fallisce.invalid, vedi
//     sotto): il trigger riprova fino al tetto e si ferma con un solo link vivo;
//     il reinvio dell'admin fallisce una volta, conserva e incrementa il
//     contatore, e il trigger non riparte; la mail corretta verso un indirizzo
//     che fallisce vale un solo tentativo.
//
// Rilancio dalla radice del repository (emulatori Auth 9199, Firestore 8180,
// Functions 5101; lo Storage non serve: nessun caso arriva a salvare la firma),
// sul Mac mini (`mini`, ~/dev/agent-handbook/rules/mac-mini.md):
//   mini 'JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//     firebase emulators:exec --config firebase.room-test.json --project demo-parent-cancel \
//     "node --test --test-concurrency=1 functions/tests/parentAuthorizationCancelledEmulator.test.mjs"'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (anche hub, logging e websocket di Firestore) in un file
// temporaneo e rimuovilo a fine prova. Il test legge Auth e Firestore dalle
// variabili d'ambiente di emulators:exec e chiede la porta delle Functions
// all'hub (FIREBASE_EMULATOR_HUB).
//
// Le email sono simulate: fuori produzione partono solo verso EMAIL_ALLOWLIST,
// che negli emulatori non è impostata (getEmailPolicy in functions/lib/config.js).
// I casi "errore vero del provider" girano solo con EMAIL_ALLOWLIST=@fallisce.invalid
// davanti a `firebase emulators:exec` (arriva al runtime delle Functions:
// nessun functions/.env* lo sovrascrive per demo-parent-cancel) e con
// BREVO_API_KEY vuota nel runtime: allora deliver (functions/lib/brevo.js)
// lancia "BREVO_API_KEY non configurata." prima di qualunque chiamata di rete.
// Se functions/.secret.local definisce una BREVO_API_KEY non vuota (sul mini
// c'è un segnaposto) il test li salta: l'emulatore chiamerebbe Brevo davvero.
// Senza .secret.local l'emulatore prova a leggere il segreto da Secret Manager
// (fallisce su un progetto demo-*, ma è una chiamata di rete verso Google).
// Dati sintetici con ids unici per run.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");
const { PNG } = require("pngjs");
const { PARENT_CONSENT_CHECKBOXES } = require("../lib/legalDocs.js");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
const hostOf = (value, label) => {
  assert.match(value || "", /^(127\.0\.0\.1|localhost):\d+$/u, `${label}: emulatore locale richiesto`);
  const [host, port] = value.split(":");
  return { host, port: Number(port) };
};
const AUTH = hostOf(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth");
hostOf(process.env.FIRESTORE_EMULATOR_HOST, "Firestore");

/** Porta delle Functions: variabile esplicita, altrimenti l'elenco dell'hub, altrimenti 5101. */
async function functionsHost() {
  if (process.env.FUNCTIONS_EMULATOR_HOST) return hostOf(process.env.FUNCTIONS_EMULATOR_HOST, "Functions");
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (hub) {
    const { host, port } = hostOf(hub, "Hub");
    const list = await (await fetch(`http://${host}:${port}/emulators`)).json();
    if (list.functions) return hostOf(`${list.functions.host}:${list.functions.port}`, "Functions");
  }
  return { host: "127.0.0.1", port: 5101 };
}
const FUNCTIONS = await functionsHost();

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const STAKE = `cancelled-${runId}`;
const PASSWORD = `Pw-${runId}-cancel!`; // credenziale di test, vale solo nell'emulatore
const PARENT_EMAIL = "genitore@example.invalid";
const SEEDED_AT = "2026-10-01T08:00:00.000Z";
const ACTIVITY_TITLE = "Campo di test";
const CANCELLED_MESSAGE = "L'iscrizione è annullata.";
// Stesso valore di MAX_EMAIL_RETRIES in functions/lib/parentAuthorization.js.
const MAX_EMAIL_RETRIES = 3;
const FAILING_DOMAIN = "@fallisce.invalid";
const FAILING_PARENT_EMAIL = `x${FAILING_DOMAIN}`;

const hashToken = (raw) => createHash("sha256").update(raw, "utf8").digest("hex");
const regPath = (activityId, registrationId) =>
  `stakes/${STAKE}/activities/${activityId}/registrations/${registrationId}`;
const getReg = async (activityId, registrationId) =>
  (await adminDb.doc(regPath(activityId, registrationId)).get()).data();
const getToken = async (hash) => (await adminDb.doc(`parentAuthorizationTokens/${hash}`).get()).data();

// ---------------------------------------------------------------------------
// Client e callable
// ---------------------------------------------------------------------------

const apps = [];

/** Utente vero dell'Auth emulator, oppure la pagina pubblica senza login. */
async function makeClient(name, { signIn = true } = {}) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.host}:${AUTH.port}`, { disableWarnings: true });
  if (signIn) await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, PASSWORD);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  return {
    uid: auth.currentUser?.uid ?? null,
    call: async (callable, data) => (await httpsCallable(functions, callable)(data)).data,
  };
}

async function expectCallError(promise, code, message) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${code}`, `${error?.code}: ${error?.message}`);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  });
}

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(read, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await pausa(250);
  }
  assert.fail(`${label}: condizione non raggiunta in ${timeoutMs} ms. Ultimo stato: ${JSON.stringify(last)}`);
}

// ---------------------------------------------------------------------------
// Semina
// ---------------------------------------------------------------------------

let counter = 0;
const who = {};

/** Attività nuova per ogni caso: l'id iscrizione child_<genitore>_<figlio> si ripete. */
async function newActivity() {
  counter += 1;
  const activityId = `campo-${counter}`;
  await adminDb.doc(`stakes/${STAKE}/activities/${activityId}`).set({
    title: ACTIVITY_TITLE,
    activityType: "camp",
    status: "registrations_open",
    requiresParentAuthorization: true,
    startDate: "2026-10-16T14:00:00.000Z",
    endDate: "2026-10-18T16:00:00.000Z",
  });
  return activityId;
}

/** Token come quelli di sendInitialAuthorizationEmail (o dell'app con mode "self"). */
async function seedToken(activityId, registrationId, { createdByMode = "system", omitMode = false, extra = {} } = {}) {
  const rawToken = randomBytes(32).toString("hex");
  const hash = hashToken(rawToken);
  const data = {
    id: hash,
    tokenHash: hash,
    stakeId: STAKE,
    activityId,
    registrationId,
    parentEmail: PARENT_EMAIL,
    participantName: "Figlio Test",
    activityTitle: ACTIVITY_TITLE,
    activityStartDate: "2026-10-16T14:00:00.000Z",
    activityEndDate: "2026-10-18T16:00:00.000Z",
    status: "pending",
    createdAt: SEEDED_AT,
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    usedAt: null,
    invalidatedAt: null,
    createdByUserId: null,
    createdByMode,
    ...extra,
  };
  if (omitMode) delete data.createdByMode; // token emessi prima del campo
  await adminDb.doc(`parentAuthorizationTokens/${hash}`).set(data);
  return { rawToken, hash };
}

/**
 * Iscrizione figlio con la forma del client e lo stato della prima mail.
 * Senza dettagli sanitari né cambi di email il trigger non riscrive nulla
 * (ramo "token già presente"), così i confronti prima/dopo sono stabili.
 */
function childRegistration(parentUid, childId, tokenHash, overrides = {}) {
  return {
    userId: null,
    anonymousUid: null,
    parentUid,
    childId,
    anonymousTokenId: null,
    firstName: "Figlio",
    lastName: "Test",
    fullName: "Figlio Test",
    email: PARENT_EMAIL,
    phone: "3330000000",
    birthDate: "2012-02-26",
    genderRoleCategory: "giovane_donna",
    unitId: "unita-1",
    unitNameSnapshot: "Unità Uno",
    answers: {
      birthDate: "2012-02-26",
      transportMode: "bus",
      parentAuthorizationRequest: {
        parentFirstName: "Genitore",
        parentLastName: "Test",
        parentEmail: PARENT_EMAIL,
        parentPhone: "3330000000",
      },
    },
    roomPreferenceMatches: {},
    participatingDays: ["2026-10-16", "2026-10-17"],
    recoveryPdfGenerated: false,
    parentAuthorization: tokenHash
      ? {
          status: "email_sent",
          tokenId: tokenHash,
          selfTokenIssuedAt: null,
          parentFirstName: "Genitore",
          parentLastName: "Test",
          parentEmail: PARENT_EMAIL,
          parentPhone: "3330000000",
          emailSentAt: SEEDED_AT,
          emailRetryCount: 0,
          photoConsent: "not_answered",
          socialPublicationConsent: "not_answered",
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        }
      : null,
    registrationStatus: "pending_parent_authorization",
    submittedByMode: "parent",
    assignedRoomId: null,
    assignedTempleShiftId: null,
    assignedServiceTeamIds: [],
    assignedCommittees: [],
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    ...overrides,
  };
}

/** Iscrizione con token della mail; `overrides` per annullarla o cambiarne lo stato. */
async function seedRegistration(childId, overrides = {}, tokenOptions = {}) {
  const activityId = await newActivity();
  const registrationId = `child_${who.genitore.uid}_${childId}`;
  const token = await seedToken(activityId, registrationId, tokenOptions);
  await adminDb
    .doc(regPath(activityId, registrationId))
    .set(childRegistration(who.genitore.uid, childId, token.hash, overrides));
  return { activityId, registrationId, ...token };
}

async function auditRows(activityId, registrationId) {
  const snapshot = await adminDb.collection(`stakes/${STAKE}/activities/${activityId}/consentAuditLogs`).get();
  return snapshot.docs.map((d) => d.data()).filter((row) => row.registrationId === registrationId);
}

async function auditEvents(activityId, registrationId) {
  return (await auditRows(activityId, registrationId)).map((row) => row.event);
}

async function tokensOf(activityId, registrationId) {
  const snapshot = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", STAKE).get();
  return snapshot.docs
    .map((d) => d.data())
    .filter((t) => t.activityId === activityId && t.registrationId === registrationId);
}

/** Come seedRegistration, ma con campi di parentAuthorization diversi da quelli della prima mail. */
async function seedRegistrationWithAuth(childId, authOverrides, { registration = {}, token = {} } = {}) {
  const activityId = await newActivity();
  const registrationId = `child_${who.genitore.uid}_${childId}`;
  const seeded = await seedToken(activityId, registrationId, token);
  const base = childRegistration(who.genitore.uid, childId, seeded.hash, registration);
  await adminDb.doc(regPath(activityId, registrationId)).set({
    ...base,
    parentAuthorization: { ...base.parentAuthorization, ...authOverrides },
  });
  return { activityId, registrationId, ...seeded };
}

/** Stato lasciato da un invio fallito con `emailRetryCount` tentativi alle spalle. */
const erroreInvio = (emailRetryCount) => ({
  status: "email_error",
  emailRetryCount,
  emailLastError: "Brevo API error 503: prova",
});

const contaEvento = (eventi, nome) => eventi.filter((evento) => evento === nome).length;

/** Mail inviate, fallite e richieste di autorizzazione registrate nell'audit. */
async function contatori(activityId, registrationId) {
  const eventi = await auditEvents(activityId, registrationId);
  return {
    mailInviate: contaEvento(eventi, "email_sent"),
    mailFallite: contaEvento(eventi, "email_failed"),
    richieste: contaEvento(eventi, "authorization_requested"),
  };
}
const NESSUN_EVENTO = { mailInviate: 0, mailFallite: 0, richieste: 0 };

/**
 * Esito di un invio rispetto a `prima`: quanti link restano vivi, se il vivo è
 * quello annotato sull'iscrizione e quante mail (e richieste) in più. Un solo
 * oggetto, così un fallimento mostra tutti i numeri insieme.
 */
async function esito(activityId, registrationId, prima) {
  const [tokens, reg, dopo] = await Promise.all([
    tokensOf(activityId, registrationId),
    getReg(activityId, registrationId),
    contatori(activityId, registrationId),
  ]);
  const vivi = tokens.filter((t) => t.status === "pending");
  return {
    linkVivi: vivi.length,
    vivoAnnotato: vivi.length === 1 && vivi[0].id === reg?.parentAuthorization?.tokenId,
    mailInviate: dopo.mailInviate - prima.mailInviate,
    mailFallite: dopo.mailFallite - prima.mailFallite,
    richieste: dopo.richieste - prima.richieste,
  };
}
const UN_LINK_UNA_MAIL = { linkVivi: 1, vivoAnnotato: true, mailInviate: 1, mailFallite: 0, richieste: 1 };

/** Il solo token pending dell'iscrizione in quell'attività (dopo un `esito` verificato). */
async function linkVivo(activityId, registrationId) {
  const vivi = (await tokensOf(activityId, registrationId)).filter((t) => t.status === "pending");
  assert.equal(vivi.length, 1, "un solo link vivo");
  return vivi[0];
}

async function fotografia(activityId, registrationId) {
  const [tokens, eventi, snapshot] = await Promise.all([
    tokensOf(activityId, registrationId),
    auditEvents(activityId, registrationId),
    adminDb.doc(regPath(activityId, registrationId)).get(),
  ]);
  return JSON.stringify([
    tokens.map((t) => `${t.id}:${t.status}`).sort(),
    eventi.length,
    snapshot.updateTime?.toMillis() ?? null,
  ]);
}

/**
 * Aspetta che trigger e callable si assestino: per `quietMs` di fila nessun
 * token nuovo o cambiato, nessun evento di audit, nessuna scrittura
 * dell'iscrizione. Il trigger reagisce anche alle proprie scritture (e a quelle
 * intermedie del reinvio), quindi "a regime" vuol dire dopo l'ultima reazione.
 */
async function aRegime(activityId, registrationId, { quietMs = 4000, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let ultima = await fotografia(activityId, registrationId);
  let fermaDa = Date.now();
  while (Date.now() < deadline) {
    await pausa(250);
    const attuale = await fotografia(activityId, registrationId);
    if (attuale !== ultima) {
      ultima = attuale;
      fermaDa = Date.now();
    } else if (Date.now() - fermaDa >= quietMs) {
      return;
    }
  }
  assert.fail(`${registrationId}: ancora in movimento dopo ${timeoutMs} ms (${ultima})`);
}

/** Scrittura del modulo che non cambia genitore né dati sanitari. */
const scritturaInnocua = (activityId, registrationId) =>
  adminDb.doc(regPath(activityId, registrationId)).update({
    "answers.transportMode": "auto",
    updatedAt: new Date().toISOString(),
  });

/**
 * I casi con l'errore vero del provider hanno bisogno che la mail esca
 * dall'allowlist (EMAIL_ALLOWLIST=@fallisce.invalid) e che deliver fallisca
 * senza rete (BREVO_API_KEY vuota). Restituisce il motivo per saltarli, o null.
 */
function motivoSaltoErroreProvider() {
  const allowlist = String(process.env.EMAIL_ALLOWLIST || "").toLowerCase();
  if (!allowlist.includes(FAILING_DOMAIN)) {
    return `serve EMAIL_ALLOWLIST=${FAILING_DOMAIN} davanti a firebase emulators:exec (vedi intestazione)`;
  }
  let secretLocal = "";
  try {
    secretLocal = readFileSync(new URL("../.secret.local", import.meta.url), "utf8");
  } catch {
    // Assente: il runtime non ha la chiave (vedi intestazione).
  }
  const chiave = secretLocal.match(/^\s*BREVO_API_KEY\s*=(.*)$/mu)?.[1]?.trim().replace(/^(["'])(.*)\1$/u, "$2");
  if (chiave) {
    return "functions/.secret.local ha una BREVO_API_KEY non vuota: con l'allowlist l'emulatore chiamerebbe Brevo";
  }
  return null;
}

function signatureDataUrl() {
  const png = new PNG({ width: 160, height: 60 });
  for (let x = 10; x < 150; x += 1) {
    for (const y of [20 + Math.round(10 * Math.sin(x / 9)), 21 + Math.round(10 * Math.sin(x / 9))]) {
      const index = (png.width * y + x) << 2;
      png.data[index] = 10;
      png.data[index + 1] = 10;
      png.data[index + 2] = 40;
      png.data[index + 3] = 255;
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

/** Payload della pagina di firma, valido in tutto tranne lo stato dell'iscrizione. */
const confirmPayload = (rawToken) => ({
  token: rawToken,
  consents: Object.fromEntries(PARENT_CONSENT_CHECKBOXES.map((item) => [item.key, true])),
  photoConsent: "accepted",
  socialPublicationConsent: "refused",
  signatureDataUrl: signatureDataUrl(),
});

const annullata = { registrationStatus: "cancelled", updatedAt: "2026-10-05T10:00:00.000Z" };

before(async () => {
  const [genitore, altroGenitore, admin, anonimo] = await Promise.all([
    makeClient("genitore"),
    makeClient("altro-genitore"),
    makeClient("admin"),
    makeClient("pagina-pubblica", { signIn: false }),
  ]);
  Object.assign(who, { genitore, altroGenitore, admin, anonimo });
  await Promise.all([
    adminDb.doc(`stakes/${STAKE}`).set({ name: `Palo ${STAKE}` }),
    adminDb.doc(`users/${genitore.uid}`).set({ role: "parent", stakeId: STAKE, fullName: "Genitore Test" }),
    adminDb.doc(`users/${altroGenitore.uid}`).set({ role: "parent", stakeId: STAKE, fullName: "Altro Genitore" }),
    adminDb.doc(`users/${admin.uid}`).set({ role: "admin", stakeId: STAKE, fullName: "Admin Test" }),
  ]);
});

after(async () => {
  try {
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE}`));
    const leftovers = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", STAKE).get();
    await Promise.all(leftovers.docs.map((d) => d.ref.delete()));
    await Promise.all([who.genitore, who.altroGenitore, who.admin].map((c) => c && adminDb.doc(`users/${c.uid}`).delete()));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// parentAuthorizationGetContext
// ===========================================================================

describe("parentAuthorizationGetContext", () => {
  // Chiamata dalla pagina pubblica senza login: canSignInApp false.
  const invalidated = {
    status: "invalidated",
    reason: "registration_cancelled",
    activityTitle: ACTIVITY_TITLE,
    participantName: "Figlio Test",
    canSignInApp: false,
  };

  test("link valido, iscrizione annullata dal genitore: invalidated con motivo e niente dati personali", async () => {
    const { rawToken } = await seedRegistration("ctx-annullata", annullata);
    assert.deepEqual(await who.anonimo.call("parentAuthorizationGetContext", { token: rawToken }), invalidated);
  });

  test("link valido, iscrizione cancellata dall'admin (documento assente): invalidated", async () => {
    const activityId = await newActivity();
    const { rawToken } = await seedToken(activityId, `child_${who.genitore.uid}_ctx-cancellata`);
    assert.deepEqual(await who.anonimo.call("parentAuthorizationGetContext", { token: rawToken }), invalidated);
  });

  test("iscrizione annullata nel vecchio campo `status`: invalidated", async () => {
    // registrationStatus diverso da pending: il trigger non interviene.
    const { rawToken } = await seedRegistration("ctx-legacy", { registrationStatus: "submitted", status: "cancelled" });
    assert.deepEqual(await who.anonimo.call("parentAuthorizationGetContext", { token: rawToken }), invalidated);
  });

  test("iscrizione attiva, link di «Autorizza ora»: valid con createdByMode self", async () => {
    const { activityId, registrationId } = await seedRegistration("ctx-self");
    const { token } = await who.genitore.call("parentAuthorizationIssueOwnToken", {
      stakeId: STAKE,
      activityId,
      registrationId,
    });

    const context = await who.anonimo.call("parentAuthorizationGetContext", { token });
    assert.equal(context.status, "valid");
    assert.equal(context.createdByMode, "self");
    assert.equal(context.participantName, "Figlio Test");
    assert.equal(context.parentEmail, PARENT_EMAIL);
    assert.equal(context.reason, undefined);
  });

  test("iscrizione attiva, link della mail: valid con createdByMode system", async () => {
    const { rawToken } = await seedRegistration("ctx-system");
    const context = await who.anonimo.call("parentAuthorizationGetContext", { token: rawToken });
    assert.equal(context.status, "valid");
    assert.equal(context.createdByMode, "system");
  });

  test("token emesso prima del campo createdByMode: valid con createdByMode null", async () => {
    const { rawToken } = await seedRegistration("ctx-vecchio", {}, { omitMode: true });
    const context = await who.anonimo.call("parentAuthorizationGetContext", { token: rawToken });
    assert.equal(context.status, "valid");
    assert.equal(context.createdByMode, null);
  });
});

// ===========================================================================
// parentAuthorizationGetContext: canSignInApp
// ===========================================================================

// true solo se chi chiama è il genitore titolare (registrationId del token che
// inizia con child_<uid>_), in tutti i rami, compresi i token non validi.
describe("parentAuthorizationGetContext: canSignInApp", () => {
  const callers = () => [
    ["genitore titolare", who.genitore, true],
    ["altro genitore", who.altroGenitore, false],
    ["senza login", who.anonimo, false],
  ];

  async function expectCanSign(rawToken, expectedStatus, { ownerExpected = true } = {}) {
    for (const [label, client, expected] of callers()) {
      const context = await client.call("parentAuthorizationGetContext", { token: rawToken });
      assert.equal(context.status, expectedStatus, `${label}: stato`);
      assert.equal(context.canSignInApp, expected && ownerExpected, `${label}: canSignInApp`);
    }
  }

  test("link valido, iscrizione attiva", async () => {
    const { rawToken } = await seedRegistration("csa-valido");
    await expectCanSign(rawToken, "valid");
  });

  test("link valido, iscrizione annullata", async () => {
    const { rawToken } = await seedRegistration("csa-annullata", annullata);
    await expectCanSign(rawToken, "invalidated");
  });

  test("link valido, iscrizione cancellata (documento assente)", async () => {
    const activityId = await newActivity();
    const { rawToken } = await seedToken(activityId, `child_${who.genitore.uid}_csa-cancellata`);
    await expectCanSign(rawToken, "invalidated");
  });

  test("link già usato", async () => {
    const { rawToken } = await seedRegistration("csa-usato", {}, { extra: { status: "used", usedAt: SEEDED_AT } });
    await expectCanSign(rawToken, "used");
  });

  test("link invalidato", async () => {
    const { rawToken } = await seedRegistration("csa-invalidato", {}, {
      extra: { status: "invalidated", invalidatedAt: SEEDED_AT },
    });
    await expectCanSign(rawToken, "invalidated");
  });

  test("link scaduto", async () => {
    const { rawToken } = await seedRegistration("csa-scaduto", {}, { extra: { expiresAt: "2026-01-01T00:00:00.000Z" } });
    await expectCanSign(rawToken, "expired");
  });

  test("link inesistente: mai true (nessuna iscrizione da collegare)", async () => {
    // Il ramo not_found può omettere il campo: il client lo legge come Boolean(...).
    for (const [label, client] of callers()) {
      const context = await client.call("parentAuthorizationGetContext", { token: randomBytes(32).toString("hex") });
      assert.equal(context.status, "not_found", `${label}: stato`);
      assert.notEqual(context.canSignInApp, true, `${label}: canSignInApp`);
    }
  });

  test("iscrizione personale (user_<uid>), non di un figlio: false anche per il titolare dell'account", async () => {
    const activityId = await newActivity();
    const { rawToken } = await seedToken(activityId, `user_${who.genitore.uid}`);
    await expectCanSign(rawToken, "invalidated", { ownerExpected: false });
  });
});

// ===========================================================================
// parentAuthorizationConfirm
// ===========================================================================

describe("parentAuthorizationConfirm", () => {
  test("iscrizione annullata: failed-precondition, documento e token intatti", async () => {
    const { activityId, registrationId, rawToken, hash } = await seedRegistration("conf-annullata", annullata);
    const prima = await getReg(activityId, registrationId);

    await expectCallError(
      who.anonimo.call("parentAuthorizationConfirm", confirmPayload(rawToken)),
      "failed-precondition",
      CANCELLED_MESSAGE,
    );

    assert.deepEqual(await getReg(activityId, registrationId), prima, "iscrizione invariata");
    assert.equal((await getToken(hash)).status, "pending", "il link non viene consumato");
    assert.ok(!(await auditEvents(activityId, registrationId)).includes("parent_authorized"));
  });

  test("iscrizione annullata dopo «Autorizza ora»: il token dell'app non conferma", async () => {
    const { activityId, registrationId } = await seedRegistration("conf-self-annullata");
    const { token } = await who.genitore.call("parentAuthorizationIssueOwnToken", {
      stakeId: STAKE,
      activityId,
      registrationId,
    });
    await adminDb.doc(regPath(activityId, registrationId)).update(annullata);
    const prima = await getReg(activityId, registrationId);

    await expectCallError(
      who.anonimo.call("parentAuthorizationConfirm", confirmPayload(token)),
      "failed-precondition",
      CANCELLED_MESSAGE,
    );
    assert.deepEqual(await getReg(activityId, registrationId), prima);
  });

  test("iscrizione cancellata (documento assente): not-found e il documento non rinasce", async () => {
    const activityId = await newActivity();
    const registrationId = `child_${who.genitore.uid}_conf-cancellata`;
    const { rawToken, hash } = await seedToken(activityId, registrationId);

    await expectCallError(who.anonimo.call("parentAuthorizationConfirm", confirmPayload(rawToken)), "not-found");

    assert.equal((await adminDb.doc(regPath(activityId, registrationId)).get()).exists, false);
    assert.equal((await getToken(hash)).status, "pending");
  });
});

// ===========================================================================
// parentAuthorizationReject
// ===========================================================================

describe("parentAuthorizationReject", () => {
  const alertPath = (activityId, registrationId) =>
    `stakes/${STAKE}/adminAlerts/parent_rejected_${activityId}_${registrationId}`;

  test("iscrizione annullata: failed-precondition, resta annullata, nessun avviso all'admin", async () => {
    const { activityId, registrationId, rawToken, hash } = await seedRegistration("rej-annullata", annullata);
    const prima = await getReg(activityId, registrationId);

    await expectCallError(
      who.anonimo.call("parentAuthorizationReject", { token: rawToken, reason: "Non partecipa più" }),
      "failed-precondition",
      CANCELLED_MESSAGE,
    );

    const dopo = await getReg(activityId, registrationId);
    assert.deepEqual(dopo, prima, "iscrizione invariata");
    assert.equal(dopo.registrationStatus, "cancelled", "non passa a rejected_by_parent");
    assert.equal((await getToken(hash)).status, "pending");
    assert.equal((await adminDb.doc(alertPath(activityId, registrationId)).get()).exists, false);
    assert.ok(!(await auditEvents(activityId, registrationId)).includes("parent_rejected"));
  });

  test("iscrizione cancellata (documento assente): not-found e il documento NON viene ricreato", async () => {
    const activityId = await newActivity();
    const registrationId = `child_${who.genitore.uid}_rej-cancellata`;
    const { rawToken, hash } = await seedToken(activityId, registrationId);

    await expectCallError(who.anonimo.call("parentAuthorizationReject", { token: rawToken }), "not-found");

    assert.equal((await adminDb.doc(regPath(activityId, registrationId)).get()).exists, false);
    assert.equal((await getToken(hash)).status, "pending");
    assert.equal((await adminDb.doc(alertPath(activityId, registrationId)).get()).exists, false);
  });

  test("controllo: su un'iscrizione attiva il rifiuto funziona ancora", async () => {
    const { activityId, registrationId, rawToken, hash } = await seedRegistration("rej-attiva");

    assert.deepEqual(await who.anonimo.call("parentAuthorizationReject", { token: rawToken }), { ok: true });

    const dopo = await getReg(activityId, registrationId);
    assert.equal(dopo.registrationStatus, "rejected_by_parent");
    assert.equal(dopo.parentAuthorization.status, "rejected_by_parent");
    assert.equal((await getToken(hash)).status, "used");
    assert.equal((await adminDb.doc(alertPath(activityId, registrationId)).get()).exists, true);
  });

  // Un reinvio partito mentre il genitore decideva lasciava valido il link
  // nuovo: la sua mail chiedeva una seconda decisione.
  for (const conQuale of ["annotato", "non annotato"]) {
    test(`rifiuto con il link ${conQuale} mentre ne esiste un altro pendente: usato quello, invalidato l'altro, intatto il link di un'altra attività`, async () => {
      // Stesso figlio iscritto a un'altra attività: stesso registrationId, altro activityId.
      const childId = `rej-doppio-${conQuale === "annotato" ? "a" : "na"}`;
      const altra = await seedRegistration(childId);
      const annotato = await seedRegistration(childId);
      const { activityId, registrationId } = annotato;
      const altro = await seedToken(activityId, registrationId);
      const [usato, superato] = conQuale === "annotato" ? [annotato, altro] : [altro, annotato];

      assert.deepEqual(await who.anonimo.call("parentAuthorizationReject", { token: usato.rawToken }), { ok: true });
      await aRegime(activityId, registrationId);

      assert.equal((await getToken(usato.hash)).status, "used", "link del rifiuto");
      assert.equal((await getToken(superato.hash)).status, "invalidated", "l'altro link non vale più");
      const invalidati = (await auditRows(activityId, registrationId))
        .filter((row) => row.event === "token_invalidated")
        .map((row) => row.tokenId);
      assert.deepEqual(invalidati, [superato.hash], "token_invalidated del solo link superato");
      assert.equal((await tokensOf(activityId, registrationId)).length, 2, "nessun link nuovo");
      assert.equal((await getReg(activityId, registrationId)).registrationStatus, "rejected_by_parent");
      assert.equal((await getToken(altra.hash)).status, "pending", "link dell'altra attività");
      assert.equal(
        (await getReg(altra.activityId, altra.registrationId)).parentAuthorization.status,
        "email_sent",
        "iscrizione dell'altra attività intatta",
      );
    });
  }
});

// ===========================================================================
// parentAuthorizationResend
// ===========================================================================

describe("parentAuthorizationResend", () => {
  test("iscrizione annullata: failed-precondition, nessuna mail, link e iscrizione intatti", async () => {
    const { activityId, registrationId, hash } = await seedRegistration("resend-annullata", annullata);
    const prima = await getReg(activityId, registrationId);

    await expectCallError(
      who.admin.call("parentAuthorizationResend", { stakeId: STAKE, activityId, registrationId }),
      "failed-precondition",
      CANCELLED_MESSAGE,
    );

    assert.deepEqual(await getReg(activityId, registrationId), prima, "iscrizione invariata");
    assert.equal((await getToken(hash)).status, "pending", "il link precedente non viene toccato");
    const tokens = await tokensOf(activityId, registrationId);
    assert.equal(tokens.length, 1, "nessun token nuovo");
    const eventi = await auditEvents(activityId, registrationId);
    assert.ok(!eventi.includes("authorization_requested") && !eventi.includes("email_resent"), eventi.join(","));
  });

  // Un reinvio arrivato dopo la firma (o il rifiuto) ne cancellava l'esito:
  // azzerava tokenId e stato e spediva un link nuovo.
  for (const [label, authOverrides, registrationStatus, message] of [
    [
      "già firmata",
      { status: "authorized", authorizedAt: SEEDED_AT },
      "confirmed",
      "L'autorizzazione è già stata firmata.",
    ],
    [
      "rifiutata dal genitore",
      { status: "rejected_by_parent", rejectedAt: SEEDED_AT },
      "rejected_by_parent",
      "Il genitore ha rifiutato l'autorizzazione.",
    ],
  ]) {
    test(`autorizzazione ${label}: failed-precondition, iscrizione e token intatti, nessun link nuovo`, async () => {
      const { activityId, registrationId, hash } = await seedRegistrationWithAuth(
        `resend-${authOverrides.status}`,
        authOverrides,
        { registration: { registrationStatus }, token: { extra: { status: "used", usedAt: SEEDED_AT } } },
      );
      const prima = await getReg(activityId, registrationId);
      const tokenPrima = await getToken(hash);

      await expectCallError(
        who.admin.call("parentAuthorizationResend", { stakeId: STAKE, activityId, registrationId }),
        "failed-precondition",
        message,
      );

      await aRegime(activityId, registrationId);
      assert.deepEqual(await getReg(activityId, registrationId), prima, "iscrizione invariata");
      assert.deepEqual(await getToken(hash), tokenPrima, "token invariato");
      assert.equal((await tokensOf(activityId, registrationId)).length, 1, "nessun token nuovo");
      const eventi = await auditEvents(activityId, registrationId);
      for (const evento of ["token_invalidated", "authorization_requested", "email_sent", "email_resent"]) {
        assert.ok(!eventi.includes(evento), `nessun ${evento}: ${eventi.join(",")}`);
      }
    });
  }

  // Prima il reinvio invalidava il link e poi tornava { sent: false }: il
  // genitore restava senza nessun link valido e l'admin senza sapere perché.
  const SENZA_DATI_GENITORE = "Mancano i dati del genitore: riapri il modulo di iscrizione e salvalo.";
  const senzaRichiesta = { answers: { birthDate: "2012-02-26", transportMode: "bus" } };
  const emailVuota = {
    answers: {
      birthDate: "2012-02-26",
      transportMode: "bus",
      parentAuthorizationRequest: {
        parentFirstName: "Genitore",
        parentLastName: "Test",
        parentEmail: "",
        parentPhone: "3330000000",
      },
    },
  };
  for (const [label, childId, overrides] of [
    ["senza answers.parentAuthorizationRequest", "resend-senza-richiesta", senzaRichiesta],
    ["con l'email del genitore vuota", "resend-email-vuota", emailVuota],
  ]) {
    test(`iscrizione ${label}: failed-precondition, iscrizione invariata, il link pendente resta valido`, async () => {
      const { activityId, registrationId, hash } = await seedRegistration(childId, overrides);
      await aRegime(activityId, registrationId);
      const prima = await getReg(activityId, registrationId);
      const tokenPrima = await getToken(hash);

      await expectCallError(
        who.admin.call("parentAuthorizationResend", { stakeId: STAKE, activityId, registrationId }),
        "failed-precondition",
        SENZA_DATI_GENITORE,
      );

      await aRegime(activityId, registrationId);
      assert.deepEqual(await getReg(activityId, registrationId), prima, "iscrizione invariata");
      assert.deepEqual(await getToken(hash), tokenPrima, "il link pendente resta pending");
      assert.equal((await tokensOf(activityId, registrationId)).length, 1, "nessun token nuovo");
      const eventi = await auditEvents(activityId, registrationId);
      for (const evento of ["token_invalidated", "authorization_requested", "email_sent", "email_resent"]) {
        assert.ok(!eventi.includes(evento), `nessun ${evento}: ${eventi.join(",")}`);
      }
    });
  }
});

// ===========================================================================
// selfTokenIssuedAt
// ===========================================================================

describe("parentAuthorization.selfTokenIssuedAt", () => {
  /** Emette il link dall'app e verifica che selfTokenIssuedAt sia l'ora dell'emissione. */
  async function issueOwnToken(activityId, registrationId) {
    const startedAt = new Date().toISOString();
    const result = await who.genitore.call("parentAuthorizationIssueOwnToken", {
      stakeId: STAKE,
      activityId,
      registrationId,
    });
    const endedAt = new Date().toISOString();
    const state = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.equal(typeof state.selfTokenIssuedAt, "string", "selfTokenIssuedAt scritto");
    assert.ok(
      state.selfTokenIssuedAt >= startedAt && state.selfTokenIssuedAt <= endedAt,
      `selfTokenIssuedAt nell'intervallo della chiamata (${state.selfTokenIssuedAt})`,
    );
    assert.equal(state.tokenId, hashToken(result.token));
    return result;
  }

  test("IssueOwnToken lo scrive (ISO dell'emissione)", async () => {
    const { activityId, registrationId } = await seedRegistration("self-set");
    await issueOwnToken(activityId, registrationId);
  });

  test("la prima mail del trigger lo scrive a null", async () => {
    const activityId = await newActivity();
    const registrationId = `child_${who.genitore.uid}_self-prima-mail`;
    // Iscrizione appena salvata dal modulo: nessun parentAuthorization, parte il trigger.
    await adminDb
      .doc(regPath(activityId, registrationId))
      .set(childRegistration(who.genitore.uid, "self-prima-mail", null));

    const state = (
      await waitFor(
        () => getReg(activityId, registrationId),
        (reg) => typeof reg?.parentAuthorization?.tokenId === "string" && reg.parentAuthorization.status === "email_sent",
        "prima mail del trigger",
      )
    ).parentAuthorization;
    assert.ok("selfTokenIssuedAt" in state, "campo presente");
    assert.equal(state.selfTokenIssuedAt, null);
  });

  test("il reinvio del trigger (email del genitore cambiata dopo «Autorizza ora») lo azzera, un solo link vivo e una sola mail", async () => {
    const { activityId, registrationId } = await seedRegistration("self-cambio-email");
    const { token } = await issueOwnToken(activityId, registrationId);
    const selfHash = hashToken(token);
    const prima = await contatori(activityId, registrationId);

    // Il genitore corregge l'email nel modulo: il trigger invalida il link e rimanda la mail.
    await adminDb.doc(regPath(activityId, registrationId)).update({
      "answers.parentAuthorizationRequest.parentEmail": "nuovo-genitore@example.invalid",
      updatedAt: new Date().toISOString(),
    });

    const state = (
      await waitFor(
        () => getReg(activityId, registrationId),
        (reg) =>
          reg?.parentAuthorization?.parentEmail === "nuovo-genitore@example.invalid" &&
          reg.parentAuthorization.status === "email_sent" &&
          typeof reg.parentAuthorization.tokenId === "string",
        "reinvio del trigger",
      )
    ).parentAuthorization;
    assert.equal(state.selfTokenIssuedAt, null);
    assert.notEqual(state.tokenId, selfHash);
    assert.equal((await getToken(selfHash)).status, "invalidated", "il link dell'app non vale più");

    // A regime (il trigger reagisce anche alla propria scrittura intermedia):
    // il campo resta null, resta vivo un solo link, verso il nuovo indirizzo, ed
    // è partita una sola mail.
    await aRegime(activityId, registrationId);
    assert.equal((await getReg(activityId, registrationId)).parentAuthorization.selfTokenIssuedAt, null);
    assert.deepEqual(await esito(activityId, registrationId, prima), UN_LINK_UNA_MAIL);
    assert.equal((await linkVivo(activityId, registrationId)).parentEmail, "nuovo-genitore@example.invalid");
  });

  test("la callable di reinvio dell'admin lo azzera, un solo link vivo e una sola mail", async () => {
    const { activityId, registrationId } = await seedRegistration("self-reinvio");
    const { token } = await issueOwnToken(activityId, registrationId);
    const prima = await contatori(activityId, registrationId);

    const result = await who.admin.call("parentAuthorizationResend", { stakeId: STAKE, activityId, registrationId });
    assert.equal(result.ok, true);

    const state = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.equal(state.selfTokenIssuedAt, null);
    assert.equal(state.status, "email_sent");
    assert.equal((await getToken(hashToken(token))).status, "invalidated");

    // Il trigger reagisce alla scrittura intermedia del reinvio: a regime il
    // campo resta null e il solo link vivo è quello che la callable ha spedito.
    await aRegime(activityId, registrationId);
    assert.equal((await getReg(activityId, registrationId)).parentAuthorization.selfTokenIssuedAt, null);
    assert.deepEqual(await esito(activityId, registrationId, prima), UN_LINK_UNA_MAIL);
    assert.equal((await linkVivo(activityId, registrationId)).id, result.tokenId, "il link vivo è quello del reinvio");
  });
});

// ===========================================================================
// Un solo link vivo per iscrizione
// ===========================================================================

// Il reinvio azzerava tokenId con una scrittura intermedia: il trigger la
// leggeva come iscrizione senza link e ne emetteva un secondo, con una seconda
// mail. Due link validi nella stessa casella.
describe("un solo link vivo per iscrizione", () => {
  test("cambio di email con un link orfano: invalidati annotato e orfano, un solo link verso il nuovo indirizzo", async () => {
    const { activityId, registrationId, hash: annotato } = await seedRegistration("orfano-cambio-email");
    // Lasciato da un invio fallito o interrotto: pending ma non annotato sull'iscrizione.
    const { hash: orfano } = await seedToken(activityId, registrationId);
    const prima = await contatori(activityId, registrationId);

    await adminDb.doc(regPath(activityId, registrationId)).update({
      "answers.parentAuthorizationRequest.parentEmail": "nuovo-genitore@example.invalid",
      updatedAt: new Date().toISOString(),
    });
    await waitFor(
      () => getReg(activityId, registrationId),
      (reg) =>
        reg?.parentAuthorization?.parentEmail === "nuovo-genitore@example.invalid" &&
        reg.parentAuthorization.status === "email_sent",
      "reinvio del trigger",
    );
    await aRegime(activityId, registrationId);

    assert.deepEqual(await esito(activityId, registrationId, prima), UN_LINK_UNA_MAIL);
    assert.equal((await getToken(annotato)).status, "invalidated", "link annotato");
    assert.equal((await getToken(orfano)).status, "invalidated", "link orfano");
    assert.equal((await linkVivo(activityId, registrationId)).parentEmail, "nuovo-genitore@example.invalid");
  });

  test("reinvio dell'admin con un link orfano: invalidati annotato e orfano, intatto il link dello stesso figlio in un'altra attività", async () => {
    // Stesso figlio iscritto a un'altra attività: stesso registrationId, altro activityId.
    const altra = await seedRegistration("orfano-reinvio");
    const { activityId, registrationId, hash: annotato } = await seedRegistration("orfano-reinvio");
    const { hash: orfano } = await seedToken(activityId, registrationId);
    const prima = await contatori(activityId, registrationId);

    const result = await who.admin.call("parentAuthorizationResend", { stakeId: STAKE, activityId, registrationId });
    assert.equal(result.ok, true);
    await aRegime(activityId, registrationId);

    assert.deepEqual(await esito(activityId, registrationId, prima), UN_LINK_UNA_MAIL);
    assert.equal((await getToken(annotato)).status, "invalidated", "link annotato");
    assert.equal((await getToken(orfano)).status, "invalidated", "link orfano");
    assert.equal((await linkVivo(activityId, registrationId)).id, result.tokenId, "il link vivo è quello del reinvio");
    assert.equal((await getToken(altra.hash)).status, "pending", "link dell'altra attività");
    assert.equal(
      (await getReg(altra.activityId, altra.registrationId)).parentAuthorization.tokenId,
      altra.hash,
      "iscrizione dell'altra attività intatta",
    );
  });

  test("due scritture ravvicinate del modulo su un'iscrizione nuova: un solo token e una sola mail", async () => {
    const activityId = await newActivity();
    const childId = "doppia-scrittura";
    const registrationId = `child_${who.genitore.uid}_${childId}`;
    const ref = adminDb.doc(regPath(activityId, registrationId));

    // Il modulo salva e subito dopo riscrive un campo innocuo, senza aspettare il trigger.
    await ref.set(childRegistration(who.genitore.uid, childId, null));
    await ref.update({ "answers.transportMode": "auto", updatedAt: new Date().toISOString() });

    await waitFor(
      () => getReg(activityId, registrationId),
      (reg) => typeof reg?.parentAuthorization?.tokenId === "string" && reg.parentAuthorization.status === "email_sent",
      "prima mail del trigger",
    );
    await aRegime(activityId, registrationId);

    assert.deepEqual(await esito(activityId, registrationId, NESSUN_EVENTO), UN_LINK_UNA_MAIL);
    assert.equal((await tokensOf(activityId, registrationId)).length, 1, "un solo token emesso in tutto");
  });
});

// ===========================================================================
// Tetto ai riprovi automatici (MAX_EMAIL_RETRIES)
// ===========================================================================

describe("tetto ai riprovi del trigger", () => {
  test("sotto il tetto: il trigger riprova e lascia vivo solo il link nuovo", async () => {
    const { activityId, registrationId, hash } = await seedRegistrationWithAuth(
      "tetto-sotto",
      erroreInvio(MAX_EMAIL_RETRIES - 1),
    );

    // La semina stessa fa ripartire il trigger: la mail simulata riesce.
    await waitFor(
      () => getReg(activityId, registrationId),
      (reg) => reg?.parentAuthorization?.status === "email_sent" && reg.parentAuthorization.tokenId !== hash,
      "riprova del trigger",
    );
    await aRegime(activityId, registrationId);

    assert.deepEqual(await esito(activityId, registrationId, NESSUN_EVENTO), UN_LINK_UNA_MAIL);
    assert.equal((await getToken(hash)).status, "invalidated", "il link del tentativo fallito non vale più");
    assert.equal((await getReg(activityId, registrationId)).parentAuthorization.emailRetryCount, 0);
  });

  test("oltre il tetto: una scrittura innocua non fa ripartire il trigger", async () => {
    const { activityId, registrationId, hash } = await seedRegistrationWithAuth(
      "tetto-fermo",
      erroreInvio(MAX_EMAIL_RETRIES),
    );
    // La semina stessa passa dal trigger: anche quella scrittura non deve riprovare.
    await scritturaInnocua(activityId, registrationId);
    await aRegime(activityId, registrationId);

    const state = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.equal(state.status, "email_error", "stato invariato");
    assert.equal(state.emailRetryCount, MAX_EMAIL_RETRIES, "contatore invariato");
    assert.equal(state.tokenId, hash, "link annotato invariato");
    const tokens = await tokensOf(activityId, registrationId);
    assert.deepEqual(tokens.map((t) => [t.id, t.status]), [[hash, "pending"]], "nessun token nuovo");
    assert.deepEqual(await contatori(activityId, registrationId), NESSUN_EVENTO, "nessun tentativo di invio");
  });

  test("oltre il tetto: il reinvio dell'admin funziona e azzera il contatore", async () => {
    const { activityId, registrationId, hash } = await seedRegistrationWithAuth(
      "tetto-reinvio",
      erroreInvio(MAX_EMAIL_RETRIES),
    );
    const prima = await contatori(activityId, registrationId);

    const result = await who.admin.call("parentAuthorizationResend", { stakeId: STAKE, activityId, registrationId });
    assert.equal(result.ok, true);
    assert.equal(result.sent, true);
    await aRegime(activityId, registrationId);

    assert.deepEqual(await esito(activityId, registrationId, prima), UN_LINK_UNA_MAIL);
    assert.equal((await getToken(hash)).status, "invalidated", "il link fallito non vale più");
    assert.equal((await linkVivo(activityId, registrationId)).id, result.tokenId, "il link vivo è quello del reinvio");
    const state = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.equal(state.status, "email_sent");
    assert.equal(state.emailRetryCount, 0);
  });

  // L'errore poteva essere proprio l'indirizzo: una mail corretta nel modulo
  // vale un tentativo anche oltre il tetto.
  test("oltre il tetto: il modulo corregge l'email, un solo tentativo verso il nuovo indirizzo", async () => {
    const { activityId, registrationId, hash } = await seedRegistrationWithAuth(
      "tetto-mail-corretta",
      erroreInvio(MAX_EMAIL_RETRIES),
    );
    const prima = await contatori(activityId, registrationId);

    await adminDb.doc(regPath(activityId, registrationId)).update({
      "answers.parentAuthorizationRequest.parentEmail": "nuovo-genitore@example.invalid",
      updatedAt: new Date().toISOString(),
    });
    await waitFor(
      () => getReg(activityId, registrationId),
      (reg) =>
        reg?.parentAuthorization?.parentEmail === "nuovo-genitore@example.invalid" &&
        reg.parentAuthorization.status === "email_sent",
      "invio verso il nuovo indirizzo",
    );
    await aRegime(activityId, registrationId);

    assert.deepEqual(await esito(activityId, registrationId, prima), UN_LINK_UNA_MAIL);
    assert.equal((await getToken(hash)).status, "invalidated", "il link fallito non vale più");
    assert.equal((await linkVivo(activityId, registrationId)).parentEmail, "nuovo-genitore@example.invalid");
    assert.equal((await getReg(activityId, registrationId)).parentAuthorization.emailRetryCount, 0);
  });
});

// ===========================================================================
// Dati sanitari dal modulo
// ===========================================================================

describe("dati sanitari dal modulo", () => {
  test("autorizzazione aperta: le allergie passano su parentAuthorization, stesso link, nessuna mail", async () => {
    const { activityId, registrationId, hash } = await seedRegistration("sanitari-aperta");

    await adminDb.doc(regPath(activityId, registrationId)).update({
      "answers.parentAuthorizationRequest.allergies": "Arachidi",
      updatedAt: new Date().toISOString(),
    });
    await waitFor(
      () => getReg(activityId, registrationId),
      (reg) => reg?.parentAuthorization?.allergies === "Arachidi",
      "allergie copiate",
    );
    await aRegime(activityId, registrationId);

    const state = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.equal(state.allergies, "Arachidi");
    assert.equal(state.tokenId, hash, "tokenId invariato");
    assert.equal(state.status, "email_sent", "status invariato");
    assert.deepEqual(
      (await tokensOf(activityId, registrationId)).map((t) => [t.id, t.status]),
      [[hash, "pending"]],
      "nessun token nuovo",
    );
    assert.deepEqual(await contatori(activityId, registrationId), NESSUN_EVENTO, "nessuna mail");
  });

  // Stato incoerente, come uno snapshot in ritardo dopo la firma: la copia dei
  // dati sanitari riscriveva un'autorizzazione già firmata.
  test("autorizzazione già firmata con l'iscrizione ancora in attesa: parentAuthorization non si tocca", async () => {
    const { activityId, registrationId, hash } = await seedRegistrationWithAuth(
      "sanitari-firmata",
      { status: "authorized", authorizedAt: SEEDED_AT },
      { token: { extra: { status: "used", usedAt: SEEDED_AT } } },
    );
    await aRegime(activityId, registrationId);
    const prima = (await getReg(activityId, registrationId)).parentAuthorization;

    await adminDb.doc(regPath(activityId, registrationId)).update({
      "answers.parentAuthorizationRequest.allergies": "Arachidi",
      updatedAt: new Date().toISOString(),
    });
    await aRegime(activityId, registrationId);

    const dopo = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.deepEqual(dopo, prima, "parentAuthorization invariato");
    assert.equal(dopo.allergies, prima.allergies, "allergie invariate");
    assert.equal((await tokensOf(activityId, registrationId)).length, 1, "nessun token nuovo");
    assert.equal((await getToken(hash)).status, "used");
    assert.deepEqual(await contatori(activityId, registrationId), NESSUN_EVENTO, "nessuna mail");
  });
});

// ===========================================================================
// Tetto ai riprovi: errore vero del provider
// ===========================================================================

// Solo con EMAIL_ALLOWLIST=@fallisce.invalid e BREVO_API_KEY vuota nel runtime
// (vedi intestazione): la mail verso FAILING_PARENT_EMAIL esce dall'allowlist e
// deliver fallisce prima della rete. I due casi sono in sequenza sulla stessa
// iscrizione.
describe("tetto ai riprovi: errore vero del provider", () => {
  const motivoSalto = motivoSaltoErroreProvider();
  let caso = null;

  test("il trigger riprova fino al tetto e poi si ferma, con un solo link vivo", async (t) => {
    if (motivoSalto) {
      t.skip(motivoSalto);
      return;
    }
    const activityId = await newActivity();
    const childId = "provider-ko";
    const registrationId = `child_${who.genitore.uid}_${childId}`;
    const base = childRegistration(who.genitore.uid, childId, null);
    await adminDb.doc(regPath(activityId, registrationId)).set({
      ...base,
      email: FAILING_PARENT_EMAIL,
      answers: {
        ...base.answers,
        parentAuthorizationRequest: { ...base.answers.parentAuthorizationRequest, parentEmail: FAILING_PARENT_EMAIL },
      },
    });

    await waitFor(
      () => getReg(activityId, registrationId),
      (reg) =>
        reg?.parentAuthorization?.status === "email_error" &&
        Number(reg.parentAuthorization.emailRetryCount) >= MAX_EMAIL_RETRIES,
      "tentativi fino al tetto",
      60_000,
    );
    await aRegime(activityId, registrationId);

    const state = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.equal(state.status, "email_error");
    assert.equal(state.emailRetryCount, MAX_EMAIL_RETRIES);
    // Il messaggio di deliver prima della fetch: prova che non si è toccata la rete.
    assert.equal(state.emailLastError, "BREVO_API_KEY non configurata.");
    const { richieste: _richieste, ...esitoTentativi } = await esito(activityId, registrationId, NESSUN_EVENTO);
    assert.deepEqual(
      esitoTentativi,
      { linkVivi: 1, vivoAnnotato: true, mailInviate: 0, mailFallite: MAX_EMAIL_RETRIES },
      "i link dei tentativi precedenti sono invalidati",
    );

    // Qualche secondo in più: il trigger resta fermo.
    const emessi = (await tokensOf(activityId, registrationId)).length;
    await pausa(5000);
    assert.equal((await tokensOf(activityId, registrationId)).length, emessi, "nessun token nuovo");
    caso = { activityId, registrationId };
  });

  test("oltre il tetto il reinvio dell'admin riprova una volta: contatore conservato e incrementato", async (t) => {
    if (motivoSalto) {
      t.skip(motivoSalto);
      return;
    }
    assert.ok(caso, "serve l'iscrizione del caso precedente");
    const { activityId, registrationId } = caso;
    const prima = await contatori(activityId, registrationId);
    const emessiPrima = (await tokensOf(activityId, registrationId)).length;

    const result = await who.admin.call("parentAuthorizationResend", { stakeId: STAKE, activityId, registrationId });
    assert.equal(result.ok, true);
    assert.equal(result.sent, false);
    await aRegime(activityId, registrationId);

    const state = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.equal(state.status, "email_error");
    assert.equal(state.emailRetryCount, MAX_EMAIL_RETRIES + 1, "conservato e incrementato, non azzerato");
    assert.equal(state.emailLastError, "BREVO_API_KEY non configurata.");
    assert.deepEqual(await esito(activityId, registrationId, prima), {
      linkVivi: 1,
      vivoAnnotato: true,
      mailInviate: 0,
      mailFallite: 1,
      richieste: 1,
    });
    assert.equal(
      (await tokensOf(activityId, registrationId)).length,
      emessiPrima + 1,
      "solo il token del reinvio: il trigger non riprova",
    );
  });

  test("oltre il tetto il modulo corregge l'email verso un indirizzo che fallisce: un tentativo, poi fermo", async (t) => {
    if (motivoSalto) {
      t.skip(motivoSalto);
      return;
    }
    const nuovaEmail = `y${FAILING_DOMAIN}`;
    const { activityId, registrationId, hash } = await seedRegistrationWithAuth(
      "provider-ko-mail-corretta",
      erroreInvio(MAX_EMAIL_RETRIES),
    );
    const prima = await contatori(activityId, registrationId);

    await adminDb.doc(regPath(activityId, registrationId)).update({
      "answers.parentAuthorizationRequest.parentEmail": nuovaEmail,
      updatedAt: new Date().toISOString(),
    });
    await waitFor(
      () => getReg(activityId, registrationId),
      (reg) =>
        reg?.parentAuthorization?.parentEmail === nuovaEmail &&
        reg.parentAuthorization.status === "email_error" &&
        Number(reg.parentAuthorization.emailRetryCount) > MAX_EMAIL_RETRIES,
      "tentativo verso il nuovo indirizzo",
    );
    await aRegime(activityId, registrationId);

    const state = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.equal(state.emailRetryCount, MAX_EMAIL_RETRIES + 1);
    assert.equal(state.emailLastError, "BREVO_API_KEY non configurata.");
    assert.deepEqual(await esito(activityId, registrationId, prima), {
      linkVivi: 1,
      vivoAnnotato: true,
      mailInviate: 0,
      mailFallite: 1,
      richieste: 1,
    });
    assert.equal((await getToken(hash)).status, "invalidated", "il link del vecchio indirizzo non vale più");
    assert.equal((await linkVivo(activityId, registrationId)).parentEmail, nuovaEmail);

    // Qualche secondo in più: con la nuova email ormai registrata il tetto ferma il trigger.
    const emessi = (await tokensOf(activityId, registrationId)).length;
    await pausa(5000);
    assert.equal((await tokensOf(activityId, registrationId)).length, emessi, "nessun altro tentativo");
  });
});

