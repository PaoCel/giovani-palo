// Reiscrizione di un'iscrizione annullata:
// onRegistrationPendingParentAuth, quando il documento passa da annullata a
// `pending_parent_authorization`, vale come una richiesta nuova
// (restartParentAuthorizationAfterCancellation in functions/lib/parentAuthorization.js).
// Prima il trigger vedeva il tokenId vecchio e sincronizzava solo i dati sanitari:
// con link scaduto, invalidato o dopo un rifiuto il minore restava in attesa senza
// nessun link valido.
//
// Il percorso è quello vero: utenti veri dell'Auth emulator, scritture del titolare
// con l'SDK client (quindi attraverso le rules) e trigger attivo. L'annullamento è
// la scrittura di cancelRegistrationById (solo `registrationStatus: "cancelled"` e
// `updatedAt`); il risalvataggio è quella di upsertRegistration (ramo updateDoc, i
// tredici campi del modulo), con lo stato scelto dalla funzione vera del client,
// resolveRegistrationStatusOnSave. Rifiuto e «Autorizza ora» passano dalle callable
// vere. L'Admin SDK serve solo per seminare e ispezionare (ignora le rules), e per
// l'unica scrittura che il client non può fare (guardia del caso 7).
//
// A regime, dopo ogni reiscrizione: UN solo token `pending` per (palo, attività,
// iscrizione), quello annotato in parentAuthorization.tokenId, con scadenza a 14
// giorni, e UNA mail (eventi `email_sent` dell'audit in consentAuditLogs). Dopo il
// risultato atteso ogni caso aspetta che trigger e callable si assestino e
// ricontrolla: nessuna seconda mail, nessun secondo link.
//   1. Annullata con il link della mail ancora valido, risalvata: link nuovo,
//      vecchio `invalidated`, `status: email_sent`, `selfTokenIssuedAt: null`,
//      `emailRetryCount: 0`.
//   2. Link scaduto (pending con `expiresAt` nel passato): come 1.
//   3. Link annotato già `invalidated` (visto in produzione): come 1, e il vecchio
//      non viene invalidato una seconda volta.
//   4. Rifiutata dal genitore (callable vera), annullata dal titolare, risalvata:
//      richiesta nuova, `rejectedAt`, `ipAddress` e `userAgent` azzerati, il token
//      `used` resta com'è.
//   5. `email_error` con `emailRetryCount` = MAX_EMAIL_RETRIES, annullata, risalvata:
//      un tentativo nuovo parte (in emulatore l'invio è simulato e riesce), contatore
//      a 0.
//   6. Link di «Autorizza ora» (callable vera, `selfTokenIssuedAt` valorizzato, token
//      `createdByMode: "self"`): mail nuova, `selfTokenIssuedAt: null`.
//   7. Firmata (`authorized`), annullata, risalvata: il client la rimette `active`,
//      nessun token nuovo, nessuna mail, firma intatta. Guardia server: se
//      qualcuno (Admin SDK) la porta da annullata a `pending_parent_authorization`,
//      l'autorizzazione firmata resta intatta e non parte nessuna mail.
//   8. Doppia scrittura ravvicinata (annullata -> in attesa e subito un secondo
//      salvataggio in attesa -> in attesa), con link valido, con `email_error` sotto
//      il tetto e dopo un rifiuto: un solo link vivo, una sola mail.
//   9. Non regressione: un'iscrizione in attesa mai annullata e risalvata con la
//      stessa email non manda mail e non cambia link; un `rejected_by_parent` su
//      un'iscrizione non annullata non viene riaperto da una scrittura successiva
//      (del titolare, né di chi la porta a `pending_parent_authorization`).
//  10. Il link dello stesso figlio in un'altra attività resta intatto.
//  In più: reiscrizione con la mail del genitore corretta (una sola mail, al nuovo
//  indirizzo, dati sanitari nuovi sull'autorizzazione) e due cicli di annullamento
//  e reiscrizione di fila.
//
// Rilancio dalla radice del repository (emulatori Auth 9199, Firestore 8180,
// Functions 5101; lo Storage non serve: nessun caso salva una firma), sul Mac
// mini (`mini`, ~/dev/agent-handbook/rules/mac-mini.md):
//   mini 'JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//     firebase emulators:exec --config firebase.room-test.json --project demo-parent-restart \
//     "node --test --test-concurrency=1 functions/tests/parentAuthorizationRestartEmulator.test.mjs functions/tests/parentAuthorizationCancelledEmulator.test.mjs"'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (anche hub, logging e websocket di Firestore) in un file
// temporaneo e rimuovilo a fine prova. Il test legge Auth e Firestore dalle
// variabili d'ambiente di emulators:exec e chiede la porta delle Functions
// all'hub (FIREBASE_EMULATOR_HUB).
//
// Le email sono simulate: fuori produzione partono solo verso EMAIL_ALLOWLIST,
// che negli emulatori non è impostata (getEmailPolicy in functions/lib/config.js).
// Dati sintetici con ids unici per run.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, updateDoc } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

import { resolveRegistrationStatusOnSave } from "../../src/utils/registrationStatus.ts";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
const hostOf = (value, label) => {
  assert.match(value || "", /^(127\.0\.0\.1|localhost):\d+$/u, `${label}: emulatore locale richiesto`);
  const [host, port] = value.split(":");
  return { host, port: Number(port) };
};
const AUTH = hostOf(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth");
const FIRESTORE = hostOf(process.env.FIRESTORE_EMULATOR_HOST, "Firestore");

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
const STAKE = `riemissione-${runId}`;
const PASSWORD = `Pw-${runId}-restart!`; // credenziale di test, vale solo nell'emulatore
const PARENT_EMAIL = "genitore@example.invalid";
const NEW_PARENT_EMAIL = "nuovo-genitore@example.invalid";
const SEEDED_AT = "2026-10-01T08:00:00.000Z";
const SIGNED_AT = "2026-10-02T19:30:00.000Z";
const REJECTED_AT = "2026-10-03T09:15:00.000Z";
const INVALIDATED_AT = "2026-10-03T09:00:00.000Z";
const ACTIVITY_TITLE = "Campo di test";
const GIORNO = 86_400_000;
// Stesso valore di MAX_EMAIL_RETRIES in functions/lib/parentAuthorization.js.
const MAX_EMAIL_RETRIES = 3;

const hashToken = (raw) => createHash("sha256").update(raw, "utf8").digest("hex");
const regPath = (activityId, registrationId) =>
  `stakes/${STAKE}/activities/${activityId}/registrations/${registrationId}`;
const getReg = async (activityId, registrationId) =>
  (await adminDb.doc(regPath(activityId, registrationId)).get()).data();
const getToken = async (hash) => (await adminDb.doc(`parentAuthorizationTokens/${hash}`).get()).data();

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const apps = [];

/** Utente vero dell'Auth emulator con Firestore e callable, oppure la pagina pubblica senza login. */
async function makeClient(name, { signIn = true } = {}) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.host}:${AUTH.port}`, { disableWarnings: true });
  if (signIn) await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, PASSWORD);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, FIRESTORE.host, FIRESTORE.port);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  return {
    uid: auth.currentUser?.uid ?? null,
    firestore,
    call: async (callable, data) => (await httpsCallable(functions, callable)(data)).data,
  };
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
// Ispezione (Admin SDK)
// ---------------------------------------------------------------------------

async function auditRows(activityId, registrationId) {
  const snapshot = await adminDb.collection(`stakes/${STAKE}/activities/${activityId}/consentAuditLogs`).get();
  return snapshot.docs.map((d) => d.data()).filter((row) => row.registrationId === registrationId);
}

const auditEvents = async (activityId, registrationId) =>
  (await auditRows(activityId, registrationId)).map((row) => row.event);

async function tokensOf(activityId, registrationId) {
  const snapshot = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", STAKE).get();
  return snapshot.docs
    .map((d) => d.data())
    .filter((t) => t.activityId === activityId && t.registrationId === registrationId);
}

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
 * Esito rispetto a `prima`: quanti link restano vivi, se il vivo è quello annotato
 * sull'iscrizione e quante mail (e richieste) in più. Un solo oggetto, così un
 * fallimento mostra tutti i numeri insieme.
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
const NESSUNA_MAIL = { mailInviate: 0, mailFallite: 0, richieste: 0 };

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
 * dell'iscrizione. Il trigger reagisce anche alle proprie scritture, quindi "a
 * regime" vuol dire dopo l'ultima reazione.
 */
async function aRegime(activityId, registrationId, { quietMs = 5000, timeoutMs = 60_000 } = {}) {
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
async function seedToken(activityId, registrationId, { createdByMode = "system", extra = {} } = {}) {
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
    expiresAt: new Date(Date.now() + 14 * GIORNO).toISOString(),
    usedAt: null,
    invalidatedAt: null,
    createdByUserId: null,
    createdByMode,
    ...extra,
  };
  await adminDb.doc(`parentAuthorizationTokens/${hash}`).set(data);
  return { rawToken, hash, data };
}

/** Stato scritto da sendInitialAuthorizationEmail dopo la prima mail. */
function emailSentState(tokenId, expiresAt) {
  return {
    status: "email_sent",
    tokenId,
    selfTokenIssuedAt: null,
    parentFirstName: "Genitore",
    parentLastName: "Test",
    parentEmail: PARENT_EMAIL,
    parentPhone: "3330000000",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    allergies: "",
    medications: "",
    medicalNotes: "",
    dietaryNotes: "",
    emailSentAt: SEEDED_AT,
    emailLastError: null,
    emailRetryCount: 0,
    emailProvider: "brevo",
    brevoMessageId: null,
    authorizedAt: null,
    rejectedAt: null,
    expiresAt,
    legalVersions: null,
    consents: null,
    photoConsent: "not_answered",
    socialPublicationConsent: "not_answered",
    signatureUrl: null,
    signaturePath: null,
    pdfUrl: null,
    pdfPath: null,
    ipAddress: null,
    userAgent: null,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  };
}

/** Cosa cambia con la firma (parentAuthorizationConfirm), sopra lo stato della mail. */
const firmaDelGenitore = ({ registrationId }) => {
  const base = `parentAuthorizations/${STAKE}/act/${registrationId}`;
  return {
    status: "authorized",
    authorizedAt: SIGNED_AT,
    legalVersions: { participation: "v1-2026-05", privacy: "v1-2026-05", photo: "v1-2026-05" },
    consents: {
      isParentOrGuardian: true,
      authorizesParticipation: true,
      confirmsDataAccuracy: true,
      authorizesEmergencyContact: true,
      readPrivacyNotice: true,
    },
    photoConsent: "accepted",
    socialPublicationConsent: "refused",
    consentTextVersion: "v2-2026-10",
    consentUpdatedAt: SIGNED_AT,
    signaturePath: `${base}/signature.png`,
    pdfPath: `${base}/consenso.pdf`,
    conductPdfPath: `${base}/condotta.pdf`,
    auditPdfPath: `${base}/audit.pdf`,
    signatureSource: "drawn",
    signedCopyEmailSentAt: SIGNED_AT,
    signedCopyEmailMessageId: null,
    signedCopyEmailLastError: null,
    ipAddress: "203.0.113.7",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    updatedAt: SIGNED_AT,
  };
};

/** Il genitore ha firmato: iscrizione confermata, consenso e firma agganciati al documento. */
const iscrizioneFirmata = ({ registrationId }) => ({
  registrationStatus: "confirmed",
  parentConsentDocumentName: `modulo-consenso-${registrationId}.pdf`,
  parentConsentDocumentPath: `parentAuthorizations/${STAKE}/act/${registrationId}/consenso.pdf`,
  parentConsentUploadedAt: SIGNED_AT,
  consentSignaturePath: `parentAuthorizations/${STAKE}/act/${registrationId}/signature.png`,
  consentSignatureSetAt: SIGNED_AT,
  updatedAt: SIGNED_AT,
});
const TOKEN_USATO = { extra: { status: "used", usedAt: SIGNED_AT } };

/** Cosa scrive parentAuthorizationReject. */
const RIFIUTO = {
  status: "rejected_by_parent",
  rejectedAt: REJECTED_AT,
  ipAddress: "203.0.113.9",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  updatedAt: REJECTED_AT,
};
const ISCRIZIONE_RIFIUTATA = { registrationStatus: "rejected_by_parent" };
const TOKEN_DEL_RIFIUTO = { extra: { status: "used", usedAt: REJECTED_AT } };

/** Iscrizione figlio con la forma del client (setDoc di saveRegistration) e lo stato della mail. */
function childRegistration(parentUid, childId, parentAuthorization, overrides = {}) {
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
      genderRoleCategory: "giovane_donna",
      transportMode: "bus",
      parentAuthorizationRequest: {
        parentFirstName: "Genitore",
        parentLastName: "Test",
        parentEmail: PARENT_EMAIL,
        parentPhone: "3330000000",
      },
    },
    roomPreferenceMatches: {},
    accessCode: null,
    recoveryCode: null,
    participatingDays: ["2026-10-16", "2026-10-17"],
    recoveryPdfGenerated: false,
    parentConsentDocumentName: null,
    parentConsentDocumentUrl: null,
    parentConsentDocumentPath: null,
    parentConsentUploadedAt: null,
    consentSignatureUrl: null,
    consentSignaturePath: null,
    consentSignatureSetAt: null,
    parentIdDocumentName: null,
    parentIdDocumentUrl: null,
    parentIdDocumentPath: null,
    parentIdUploadedAt: null,
    parentAuthorization,
    linkedLaterToUserId: null,
    registrationStatus: "pending_parent_authorization",
    submittedByMode: "parent",
    assignedRoomId: null,
    assignedTempleShiftId: null,
    assignedServiceTeamIds: [],
    assignedPatrolId: null,
    assignedPatrolName: null,
    assignedPatrolRole: null,
    assignedCommittees: [],
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    ...overrides,
  };
}

const resolveOption = (value, ctx) => (typeof value === "function" ? value(ctx) : (value ?? {}));

/**
 * Iscrizione con il suo link, nello stato voluto, e baseline dei contatori dopo
 * che il trigger della semina si è assestato (non deve fare nulla: il link
 * annotato c'è già, o l'iscrizione non è in attesa, o i tentativi sono al tetto).
 * `auth` e `reg` sono oggetti o funzioni di `{ activityId, registrationId }`.
 */
async function seed(childId, { reg, auth, token = {}, settle = true } = {}) {
  const activityId = await newActivity();
  const registrationId = `child_${who.genitore.uid}_${childId}`;
  const seeded = await seedToken(activityId, registrationId, token);
  const ctx = {
    activityId,
    registrationId,
    path: regPath(activityId, registrationId),
    vecchio: seeded,
    prima: NESSUN_EVENTO,
  };
  const stato = { ...emailSentState(seeded.hash, seeded.data.expiresAt), ...resolveOption(auth, ctx) };
  await adminDb.doc(ctx.path).set(childRegistration(who.genitore.uid, childId, stato, resolveOption(reg, ctx)));
  if (settle) {
    await aRegime(activityId, registrationId, { quietMs: 2500 });
    ctx.prima = await contatori(activityId, registrationId);
    assert.deepEqual(ctx.prima, NESSUN_EVENTO, "la semina non deve far partire mail");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Scritture del titolare (SDK client, quindi rules) e callable vere
// ---------------------------------------------------------------------------

/** cancelRegistrationById (registrationsService.ts): solo stato e updatedAt. */
const annulla = (ctx, actor = who.genitore) =>
  updateDoc(doc(actor.firestore, ctx.path), {
    registrationStatus: "cancelled",
    updatedAt: new Date().toISOString(),
  });

/**
 * upsertRegistration sul documento esistente (ramo updateDoc): i tredici campi del
 * modulo, con lo stato scelto da resolveRegistrationStatusOnSave. `changes.answers`
 * è una funzione sulle risposte attuali. Restituisce lo stato inviato.
 */
async function risalva(ctx, changes = {}) {
  const corrente = (await adminDb.doc(ctx.path).get()).data();
  const answers = changes.answers ? changes.answers(corrente.answers) : corrente.answers;
  const registrationStatus = resolveRegistrationStatusOnSave(
    { registrationStatus: corrente.registrationStatus, parentAuthorization: corrente.parentAuthorization ?? null },
    "pending_parent_authorization",
    { parentAuthorizationRequested: Boolean(answers?.parentAuthorizationRequest) },
  );
  await updateDoc(doc(who.genitore.firestore, ctx.path), {
    firstName: corrente.firstName,
    lastName: corrente.lastName,
    fullName: corrente.fullName,
    email: corrente.email,
    phone: corrente.phone,
    birthDate: corrente.birthDate,
    genderRoleCategory: corrente.genderRoleCategory,
    unitNameSnapshot: corrente.unitNameSnapshot,
    answers,
    roomPreferenceMatches: corrente.roomPreferenceMatches,
    participatingDays: corrente.participatingDays,
    registrationStatus,
    updatedAt: new Date().toISOString(),
  });
  return registrationStatus;
}

/** Cambia un campo innocuo del modulo: stessa email, stessi dati sanitari. */
const conTrasporto = (trasporto) => ({ answers: (answers) => ({ ...answers, transportMode: trasporto }) });

// ---------------------------------------------------------------------------
// Verifiche
// ---------------------------------------------------------------------------

/**
 * Dopo la reiscrizione aspetta la mail, lascia assestare il trigger e verifica:
 * UN link vivo (quello annotato) con scadenza a 14 giorni, UNA mail, e lo stato
 * di una richiesta nuova. `ctx.vecchio` è il link di prima, `ctx.prima` la
 * baseline dei contatori.
 */
async function verificaRichiestaNuova(ctx, { totaleToken = 2, mailAl = PARENT_EMAIL } = {}) {
  const { activityId, registrationId, prima, vecchio } = ctx;
  await waitFor(() => esito(activityId, registrationId, prima), (e) => e.mailInviate >= 1, "mail della reiscrizione");
  // Il trigger reagisce anche alle proprie scritture: dopo il risultato atteso si
  // aspetta che non arrivi altro (una seconda mail, un secondo link).
  await aRegime(activityId, registrationId);

  assert.deepEqual(
    await esito(activityId, registrationId, prima),
    UN_LINK_UNA_MAIL,
    "un solo link vivo (quello annotato) e una sola mail",
  );
  const tokens = await tokensOf(activityId, registrationId);
  assert.equal(tokens.length, totaleToken, `token emessi in tutto: ${tokens.map((t) => t.status).join(",")}`);

  const reg = await getReg(activityId, registrationId);
  const stato = reg.parentAuthorization;
  assert.equal(reg.registrationStatus, "pending_parent_authorization");
  assert.equal(stato.status, "email_sent");
  assert.notEqual(stato.tokenId, vecchio.hash, "il link annotato è nuovo");
  assert.equal(stato.selfTokenIssuedAt, null, "il link valido torna quello della mail");
  assert.equal(stato.emailRetryCount, 0, "tentativi da zero");
  assert.equal(stato.emailLastError, null);
  assert.equal(stato.parentEmail, mailAl);
  for (const campo of ["rejectedAt", "authorizedAt", "ipAddress", "userAgent", "signaturePath", "pdfPath"]) {
    assert.equal(stato[campo], null, `${campo} azzerato`);
  }

  const nuovo = tokens.find((t) => t.status === "pending");
  assert.equal(nuovo.id, stato.tokenId);
  assert.equal(nuovo.createdByMode, "system");
  assert.equal(nuovo.parentEmail, mailAl);
  assert.equal(nuovo.stakeId, STAKE);
  const scade = Date.parse(nuovo.expiresAt) - Date.now();
  assert.ok(scade > 13 * GIORNO && scade < 15 * GIORNO, `il link nuovo scade fra ${(scade / GIORNO).toFixed(2)} giorni`);
  assert.equal(stato.expiresAt, nuovo.expiresAt, "la scadenza annotata è quella del link");

  const mailDelLinkNuovo = (await auditRows(activityId, registrationId)).filter(
    (row) => row.event === "email_sent" && row.tokenId === nuovo.id,
  );
  assert.equal(mailDelLinkNuovo.length, 1, "la mail spedita è quella del link vivo");
  assert.equal(mailDelLinkNuovo[0].parentEmail, mailAl);
  return { reg, stato, nuovo, tokens };
}

/** Il vecchio link è stato invalidato (una volta sola, con il suo evento di audit) e non è più utilizzabile. */
async function assertVecchioInvalidato(ctx) {
  const vecchio = await getToken(ctx.vecchio.hash);
  assert.equal(vecchio.status, "invalidated", "il vecchio link non vale più");
  assert.equal(typeof vecchio.invalidatedAt, "string");
  const righe = (await auditRows(ctx.activityId, ctx.registrationId)).filter(
    (row) => row.event === "token_invalidated" && row.tokenId === ctx.vecchio.hash,
  );
  assert.equal(righe.length, 1, "token_invalidated del vecchio link, una volta sola");
}

// ---------------------------------------------------------------------------
// Avvio e chiusura
// ---------------------------------------------------------------------------

before(async () => {
  const [genitore, altroGenitore, anonimo] = await Promise.all([
    makeClient("genitore"),
    makeClient("altro-genitore"),
    makeClient("pagina-pubblica", { signIn: false }),
  ]);
  Object.assign(who, { genitore, altroGenitore, anonimo });
  const profilo = (nome) => ({ role: "parent", stakeId: STAKE, fullName: nome });
  await Promise.all([
    adminDb.doc(`stakes/${STAKE}`).set({ name: `Palo ${STAKE}` }),
    adminDb.doc(`users/${genitore.uid}`).set(profilo("Genitore Test")),
    adminDb.doc(`users/${altroGenitore.uid}`).set(profilo("Altro Genitore")),
  ]);

  // Il primo evento della sessione carica il runtime delle Functions, e può
  // richiedere diversi secondi: lo si scalda qui con una prima iscrizione senza
  // link, così i casi "nessuna mail" non scambiano un trigger ancora freddo per
  // un trigger che ha deciso di non fare nulla.
  const activityId = await newActivity();
  const registrationId = `child_${genitore.uid}_scaldamento`;
  await adminDb.doc(regPath(activityId, registrationId)).set(childRegistration(genitore.uid, "scaldamento", null));
  await waitFor(
    () => getReg(activityId, registrationId),
    (reg) => typeof reg?.parentAuthorization?.tokenId === "string" && reg.parentAuthorization.status === "email_sent",
    "prima mail del trigger (scaldamento)",
    120_000,
  );
});

after(async () => {
  try {
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE}`));
    const leftovers = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", STAKE).get();
    await Promise.all(leftovers.docs.map((d) => d.ref.delete()));
    await Promise.all([who.genitore, who.altroGenitore].map((c) => c && adminDb.doc(`users/${c.uid}`).delete()));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// Controllo: le rules sono caricate
// ===========================================================================

describe("controllo", () => {
  // Una config senza `firestore.rules` fa girare l'emulatore con rules aperte, e le
  // scritture del titolare "passerebbero" senza provare nulla.
  test("le rules sono caricate: un altro genitore non annulla l'iscrizione", async () => {
    const ctx = await seed("controllo-rules", { settle: false });
    await assert.rejects(annulla(ctx, who.altroGenitore), (error) => {
      assert.equal(error?.code, "permission-denied", `${error?.code}: ${error?.message}`);
      return true;
    });
    assert.equal((await getReg(ctx.activityId, ctx.registrationId)).registrationStatus, "pending_parent_authorization");
  });
});

// ===========================================================================
// Casi 1-3: il link di prima non serve più
// ===========================================================================

describe("annullata e risalvata: link nuovo e mail nuova", () => {
  test("1. link della mail ancora valido: nuovo link, vecchio invalidated, una mail", async () => {
    const ctx = await seed("link-valido");

    await annulla(ctx);
    assert.equal(await risalva(ctx), "pending_parent_authorization");

    await verificaRichiestaNuova(ctx);
    await assertVecchioInvalidato(ctx);
  });

  test("2. link scaduto (pending con expiresAt nel passato): nuovo link, vecchio invalidated, una mail", async () => {
    const scaduto = new Date(Date.now() - 3 * GIORNO).toISOString();
    const ctx = await seed("link-scaduto", {
      token: { extra: { expiresAt: scaduto } },
      auth: { expiresAt: scaduto },
    });
    assert.equal(ctx.vecchio.data.status, "pending");

    await annulla(ctx);
    await risalva(ctx);

    await verificaRichiestaNuova(ctx);
    await assertVecchioInvalidato(ctx);
  });

  test("3. link annotato già invalidated (visto in produzione): nuovo link, il vecchio non si invalida di nuovo", async () => {
    const ctx = await seed("link-invalidato", {
      token: { extra: { status: "invalidated", invalidatedAt: INVALIDATED_AT } },
    });

    await annulla(ctx);
    await risalva(ctx);

    await verificaRichiestaNuova(ctx);
    const vecchio = await getToken(ctx.vecchio.hash);
    assert.equal(vecchio.status, "invalidated");
    assert.equal(vecchio.invalidatedAt, INVALIDATED_AT, "invalidatedAt di prima, non riscritto");
    assert.equal(contaEvento(await auditEvents(ctx.activityId, ctx.registrationId), "token_invalidated"), 0);
  });
});

// ===========================================================================
// Caso 4: il genitore ha rifiutato
// ===========================================================================

describe("rifiutata dal genitore", () => {
  test("4. rifiuto, annullamento del titolare, risalvataggio: richiesta nuova e rifiuto azzerato", async (t) => {
    const ctx = await seed("rifiutata");

    // Il genitore rifiuta con il link della mail (callable vera, pagina pubblica).
    assert.deepEqual(await who.anonimo.call("parentAuthorizationReject", { token: ctx.vecchio.rawToken }), { ok: true });
    await aRegime(ctx.activityId, ctx.registrationId, { quietMs: 2500 });
    let reg = await getReg(ctx.activityId, ctx.registrationId);
    assert.equal(reg.registrationStatus, "rejected_by_parent");
    assert.equal(reg.parentAuthorization.status, "rejected_by_parent");
    assert.equal(typeof reg.parentAuthorization.rejectedAt, "string");
    // Il rifiuto registra IP e user agent se la richiesta li porta; senza, si
    // scrivono a mano, così "azzerati" dopo la reiscrizione dice qualcosa.
    if (!reg.parentAuthorization.ipAddress || !reg.parentAuthorization.userAgent) {
      await adminDb.doc(ctx.path).update({
        "parentAuthorization.ipAddress": reg.parentAuthorization.ipAddress || RIFIUTO.ipAddress,
        "parentAuthorization.userAgent": reg.parentAuthorization.userAgent || RIFIUTO.userAgent,
      });
      await aRegime(ctx.activityId, ctx.registrationId, { quietMs: 2500 });
      reg = await getReg(ctx.activityId, ctx.registrationId);
    }
    assert.ok(reg.parentAuthorization.ipAddress && reg.parentAuthorization.userAgent, "IP e user agent del rifiuto");
    const tokenUsato = await getToken(ctx.vecchio.hash);
    assert.equal(tokenUsato.status, "used");
    ctx.prima = await contatori(ctx.activityId, ctx.registrationId);

    // Il titolare annulla (la rule lo consente da qualunque stato) e si reiscrive.
    await annulla(ctx);
    assert.equal(await risalva(ctx), "pending_parent_authorization");

    const { reg: dopo } = await verificaRichiestaNuova(ctx);
    assert.equal(dopo.parentAuthorization.rejectedAt, null);
    assert.deepEqual(await getToken(ctx.vecchio.hash), tokenUsato, "il link del rifiuto resta used, com'era");
    assert.equal(contaEvento(await auditEvents(ctx.activityId, ctx.registrationId), "token_invalidated"), 0);

    // Osservazione, non asserzione: l'avviso all'admin del rifiuto è ancora attivo?
    const avviso = await adminDb.doc(`stakes/${STAKE}/adminAlerts/parent_rejected_${ctx.activityId}_${ctx.registrationId}`).get();
    t.diagnostic(`adminAlerts/parent_rejected dopo la reiscrizione: esiste=${avviso.exists} active=${avviso.data()?.active}`);
  });
});

// ===========================================================================
// Caso 5: tetto ai riprovi
// ===========================================================================

describe("email_error al tetto dei riprovi", () => {
  test("5. annullata e risalvata: parte un tentativo nuovo, contatore a 0", async () => {
    const ctx = await seed("errore-al-tetto", {
      auth: { status: "email_error", emailRetryCount: MAX_EMAIL_RETRIES, emailLastError: "Brevo API error 503: prova" },
    });
    // Al tetto una scrittura innocua non fa ripartire il trigger: è il comportamento da non perdere.
    await adminDb.doc(ctx.path).update({ "answers.transportMode": "auto", updatedAt: new Date().toISOString() });
    await aRegime(ctx.activityId, ctx.registrationId, { quietMs: 3000 });
    assert.deepEqual(await esito(ctx.activityId, ctx.registrationId, ctx.prima), { ...NESSUNA_MAIL, linkVivi: 1, vivoAnnotato: true });

    await annulla(ctx);
    await risalva(ctx);

    await verificaRichiestaNuova(ctx);
    await assertVecchioInvalidato(ctx);
  });
});

// ===========================================================================
// Caso 6: «Autorizza ora»
// ===========================================================================

describe("link di «Autorizza ora»", () => {
  test("6. annullata e risalvata: mail nuova, selfTokenIssuedAt a null", async () => {
    const ctx = await seed("autorizza-ora");
    const { token } = await who.genitore.call("parentAuthorizationIssueOwnToken", {
      stakeId: STAKE,
      activityId: ctx.activityId,
      registrationId: ctx.registrationId,
    });
    await aRegime(ctx.activityId, ctx.registrationId, { quietMs: 2500 });
    const self = { hash: hashToken(token) };
    const prima = await getReg(ctx.activityId, ctx.registrationId);
    assert.equal(typeof prima.parentAuthorization.selfTokenIssuedAt, "string", "selfTokenIssuedAt valorizzato");
    assert.equal(prima.parentAuthorization.tokenId, self.hash);
    assert.equal((await getToken(self.hash)).createdByMode, "self");
    // Da qui il link valido è quello dell'app: il vecchio della mail è già invalidato.
    assert.equal((await getToken(ctx.vecchio.hash)).status, "invalidated");
    ctx.vecchio = self;
    ctx.prima = await contatori(ctx.activityId, ctx.registrationId);
    assert.deepEqual(ctx.prima, NESSUN_EVENTO, "«Autorizza ora» non manda mail");

    await annulla(ctx);
    await risalva(ctx);

    await verificaRichiestaNuova(ctx, { totaleToken: 3 });
    await assertVecchioInvalidato(ctx);
  });
});

// ===========================================================================
// Caso 7: firmata
// ===========================================================================

describe("autorizzazione firmata", () => {
  test("7. annullata e risalvata: il client la rimette active, nessun token, nessuna mail, firma intatta", async () => {
    const ctx = await seed("firmata", { reg: iscrizioneFirmata, auth: firmaDelGenitore, token: TOKEN_USATO });
    const prima = await getReg(ctx.activityId, ctx.registrationId);
    assert.equal(prima.parentAuthorization.status, "authorized");

    await annulla(ctx);
    assert.equal(await risalva(ctx), "active", "il client non ricomincia dal genitore");
    await aRegime(ctx.activityId, ctx.registrationId);

    const dopo = await getReg(ctx.activityId, ctx.registrationId);
    assert.equal(dopo.registrationStatus, "active");
    assert.deepEqual(dopo.parentAuthorization, prima.parentAuthorization, "firma, PDF e consensi intatti");
    assert.equal(dopo.consentSignaturePath, prima.consentSignaturePath);
    const tokens = await tokensOf(ctx.activityId, ctx.registrationId);
    assert.deepEqual(tokens.map((t) => `${t.id}:${t.status}`), [`${ctx.vecchio.hash}:used`], "nessun token nuovo");
    assert.deepEqual(await contatori(ctx.activityId, ctx.registrationId), NESSUN_EVENTO, "nessuna mail");
  });

  test("7b. guardia server: annullata -> pending_parent_authorization (Admin SDK) non tocca la firma", async () => {
    const ctx = await seed("firmata-guardia", {
      reg: (c) => ({ ...iscrizioneFirmata(c), registrationStatus: "cancelled" }),
      auth: firmaDelGenitore,
      token: TOKEN_USATO,
    });
    const prima = await getReg(ctx.activityId, ctx.registrationId);

    // Il client non può farlo (la rule vuole `active` per una firma già data): un
    // altro scrittore sì, e il trigger non deve riaprire ciò che il genitore ha firmato.
    await adminDb.doc(ctx.path).update({
      registrationStatus: "pending_parent_authorization",
      updatedAt: new Date().toISOString(),
    });
    await aRegime(ctx.activityId, ctx.registrationId);

    const dopo = await getReg(ctx.activityId, ctx.registrationId);
    assert.deepEqual(dopo.parentAuthorization, prima.parentAuthorization, "l'autorizzazione firmata resta intatta");
    const tokens = await tokensOf(ctx.activityId, ctx.registrationId);
    assert.deepEqual(tokens.map((t) => `${t.id}:${t.status}`), [`${ctx.vecchio.hash}:used`], "nessun token nuovo");
    assert.deepEqual(await contatori(ctx.activityId, ctx.registrationId), NESSUN_EVENTO, "nessuna mail");
    assert.equal(
      contaEvento(await auditEvents(ctx.activityId, ctx.registrationId), "token_invalidated"),
      0,
      "nessun link toccato",
    );
  });
});

// ===========================================================================
// Caso 8: due scritture ravvicinate
// ===========================================================================

// Il modulo salva e subito dopo riscrive: il primo evento è annullata -> in
// attesa, il secondo in attesa -> in attesa (con lo stato di prima di ogni
// risposta del trigger). Due giri sullo stesso documento non devono emettere due
// link né spedire due mail.
describe("doppia scrittura ravvicinata dopo la riattivazione", () => {
  test("8. link valido: un solo link vivo, una sola mail", async () => {
    const ctx = await seed("doppia-valido");

    await annulla(ctx);
    assert.equal(await risalva(ctx), "pending_parent_authorization");
    assert.equal(await risalva(ctx, conTrasporto("auto")), "pending_parent_authorization");

    await verificaRichiestaNuova(ctx);
    await assertVecchioInvalidato(ctx);
    assert.equal((await getReg(ctx.activityId, ctx.registrationId)).answers.transportMode, "auto");
  });

  // Seminata già annullata: con `email_error` sotto il tetto il trigger della
  // semina riproverebbe da solo, e il caso non partirebbe da quello stato.
  test("8b. email_error sotto il tetto: il secondo evento riprova a sua volta, un solo link vivo, una sola mail", async () => {
    const ctx = await seed("doppia-errore", {
      reg: { registrationStatus: "cancelled" },
      auth: { status: "email_error", emailRetryCount: 1, emailLastError: "Brevo API error 503: prova" },
    });

    assert.equal(await risalva(ctx), "pending_parent_authorization");
    assert.equal(await risalva(ctx, conTrasporto("auto")), "pending_parent_authorization");

    await verificaRichiestaNuova(ctx);
    await assertVecchioInvalidato(ctx);
  });

  test("8c. dopo un rifiuto: un solo link vivo, una sola mail, il rifiuto azzerato", async () => {
    const ctx = await seed("doppia-rifiuto", { reg: ISCRIZIONE_RIFIUTATA, auth: RIFIUTO, token: TOKEN_DEL_RIFIUTO });

    await annulla(ctx);
    assert.equal(await risalva(ctx), "pending_parent_authorization");
    assert.equal(await risalva(ctx, conTrasporto("auto")), "pending_parent_authorization");

    await verificaRichiestaNuova(ctx);
    assert.equal((await getToken(ctx.vecchio.hash)).status, "used", "il link del rifiuto resta used");
  });
});

// ===========================================================================
// Caso 9: non regressione
// ===========================================================================

describe("non regressione: senza annullamento il trigger non riemette niente", () => {
  test("9. in attesa, mai annullata, risalvata con la stessa email: nessuna mail, stesso link", async () => {
    const ctx = await seed("mai-annullata");
    const prima = await getReg(ctx.activityId, ctx.registrationId);

    assert.equal(await risalva(ctx, conTrasporto("auto")), "pending_parent_authorization");
    await aRegime(ctx.activityId, ctx.registrationId);

    const dopo = await getReg(ctx.activityId, ctx.registrationId);
    assert.equal(dopo.answers.transportMode, "auto", "la scrittura del client è arrivata");
    assert.deepEqual(dopo.parentAuthorization, prima.parentAuthorization, "stesso link, stesso stato");
    assert.deepEqual(await esito(ctx.activityId, ctx.registrationId, ctx.prima), {
      ...NESSUNA_MAIL,
      linkVivi: 1,
      vivoAnnotato: true,
    });
    assert.equal((await tokensOf(ctx.activityId, ctx.registrationId)).length, 1);
    assert.equal((await getToken(ctx.vecchio.hash)).status, "pending", "il link di prima è ancora valido");
  });

  test("9b. rifiutata e non annullata: il risalvataggio del titolare non la riapre", async () => {
    const ctx = await seed("rifiutata-non-annullata", { reg: ISCRIZIONE_RIFIUTATA, auth: RIFIUTO, token: TOKEN_DEL_RIFIUTO });
    const prima = await getReg(ctx.activityId, ctx.registrationId);

    // Il client conserva lo stato di un'iscrizione che non è annullata.
    assert.equal(await risalva(ctx, conTrasporto("auto")), "rejected_by_parent");
    await aRegime(ctx.activityId, ctx.registrationId);

    const dopo = await getReg(ctx.activityId, ctx.registrationId);
    assert.equal(dopo.answers.transportMode, "auto");
    assert.equal(dopo.registrationStatus, "rejected_by_parent");
    assert.deepEqual(dopo.parentAuthorization, prima.parentAuthorization);
    assert.equal((await tokensOf(ctx.activityId, ctx.registrationId)).length, 1, "nessun link nuovo");
    assert.deepEqual(await contatori(ctx.activityId, ctx.registrationId), NESSUN_EVENTO, "nessuna mail");
  });

  test("9c. rifiutata e non annullata: anche con lo stato portato a pending_parent_authorization il rifiuto resta", async () => {
    const ctx = await seed("rifiutata-in-attesa", { reg: ISCRIZIONE_RIFIUTATA, auth: RIFIUTO, token: TOKEN_DEL_RIFIUTO });
    const prima = await getReg(ctx.activityId, ctx.registrationId);

    // Non è una reiscrizione (prima non era annullata): il trigger non rimette in gioco una decisione.
    await adminDb.doc(ctx.path).update({
      registrationStatus: "pending_parent_authorization",
      updatedAt: new Date().toISOString(),
    });
    await aRegime(ctx.activityId, ctx.registrationId);

    const dopo = await getReg(ctx.activityId, ctx.registrationId);
    assert.deepEqual(dopo.parentAuthorization, prima.parentAuthorization, "il rifiuto non si riapre");
    assert.equal((await tokensOf(ctx.activityId, ctx.registrationId)).length, 1, "nessun link nuovo");
    assert.deepEqual(await contatori(ctx.activityId, ctx.registrationId), NESSUN_EVENTO, "nessuna mail");
  });
});

// ===========================================================================
// Caso 10: un'altra attività
// ===========================================================================

describe("lo stesso figlio in un'altra attività", () => {
  test("10. il suo link e la sua iscrizione restano intatti dopo la reiscrizione", async () => {
    // Stesso figlio, stesso registrationId, due attività: seminate entrambe prima di agire.
    const altra = await seed("due-attivita");
    const ctx = await seed("due-attivita");
    assert.equal(altra.registrationId, ctx.registrationId);
    assert.notEqual(altra.activityId, ctx.activityId);
    const altraIscrizione = await getReg(altra.activityId, altra.registrationId);
    const altroToken = await getToken(altra.vecchio.hash);

    await annulla(ctx);
    await risalva(ctx);

    await verificaRichiestaNuova(ctx);
    await assertVecchioInvalidato(ctx);
    assert.deepEqual(await getToken(altra.vecchio.hash), altroToken, "il link dell'altra attività non è toccato");
    assert.equal(altroToken.status, "pending");
    assert.deepEqual(await getReg(altra.activityId, altra.registrationId), altraIscrizione, "iscrizione dell'altra attività intatta");
    assert.equal((await tokensOf(altra.activityId, altra.registrationId)).length, 1, "nessun link nuovo nell'altra attività");
    assert.deepEqual(await contatori(altra.activityId, altra.registrationId), NESSUN_EVENTO, "nessuna mail nell'altra attività");
  });
});

// ===========================================================================
// In più
// ===========================================================================

describe("reiscrizione, altri percorsi", () => {
  test("la mail del genitore corretta nel modulo: una sola mail, al nuovo indirizzo, con i dati sanitari nuovi", async () => {
    const ctx = await seed("mail-corretta");

    await annulla(ctx);
    await risalva(ctx, {
      answers: (answers) => ({
        ...answers,
        parentAuthorizationRequest: {
          ...answers.parentAuthorizationRequest,
          parentEmail: NEW_PARENT_EMAIL,
          allergies: "Graminacee",
        },
      }),
    });

    const { stato } = await verificaRichiestaNuova(ctx, { mailAl: NEW_PARENT_EMAIL });
    assert.equal(stato.allergies, "Graminacee", "i dati sanitari del modulo sono sull'autorizzazione");
    await assertVecchioInvalidato(ctx);
    assert.equal(
      contaEvento(await auditEvents(ctx.activityId, ctx.registrationId), "email_resent"),
      0,
      "è una richiesta nuova, non un reinvio",
    );
  });

  test("due cicli di annullamento e reiscrizione: ogni giro un solo link vivo e una sola mail", async () => {
    const ctx = await seed("due-cicli");

    await annulla(ctx);
    await risalva(ctx);
    const primo = await verificaRichiestaNuova(ctx);

    // Secondo giro: il link nuovo diventa "quello di prima".
    ctx.vecchio = { hash: primo.nuovo.id };
    ctx.prima = await contatori(ctx.activityId, ctx.registrationId);
    await annulla(ctx);
    await risalva(ctx);
    await verificaRichiestaNuova(ctx, { totaleToken: 3 });

    const tokens = await tokensOf(ctx.activityId, ctx.registrationId);
    assert.deepEqual(tokens.map((t) => t.status).sort(), ["invalidated", "invalidated", "pending"]);
  });
});
