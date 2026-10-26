// Ospite che collega Google o un'email (2026-10-19): la sessione anonima
// diventa un account vero, ma l'uid resta lo stesso, quindi la sua iscrizione
// resta `registrations/guest_<uid>` e le domande stanno sotto di essa.
//
// Prima il client (upsertRegistration) risalvava facendo `setDoc` di
// `user_<uid>` con una copia del documento ospite (stato, parentAuthorization,
// firma, consensi, stanza, pattuglia, comitati) e poi cancellava `guest_<uid>`:
// validRegistrationCreate nega quella create se l'ospite era in attesa del
// genitore o firmato (stato iniziale e i 21 campi che alla creazione restano
// vuoti), e l'id cambiato staccava token, domande, stanze e comitati. Ora il
// client NON migra più: se `user_<uid>` non esiste e `guest_<uid>` sì, fa
// `updateDoc(guest_<uid>, ...)` coi tredici campi del ramo "esiste già" di
// upsertRegistration (src/services/firestore/registrationsService.ts).
// Le domande usano l'id dell'iscrizione mostrata (questionsService.create/
// update/remove/listOwn ricevono `registration.id`): `guest_<uid>` per l'ospite
// collegato, `child_<parentUid>_<childId>` per il genitore.
//
// Questo file prova:
// 1. l'aggiornamento sul posto di `guest_<uid>` da parte dell'account collegato
//    (token non anonimo, stesso uid) in quattro casi: adulto attivo,
//    minore in attesa del genitore, minore firmato "pesante" e riattivazione
//    cancelled -> active dello stesso firmato;
// 2. che il vecchio comportamento (setDoc di user_<uid> con la copia) resti
//    negato, con i controlli che isolano la causa: sono i campi copiati e lo
//    stato, non il percorso;
// 3. i negativi dell'aggiornamento sul posto (autoconferma, riattivazione
//    senza firma, altro account, parentAuthorization e stanza);
// 4. le domande sotto `guest_<uid>` (create, lista, update, delete) e che sotto
//    `user_<uid>` (vecchio client) la create sia negata;
// 5. la lista delle domande del genitore sotto `child_<parentUid>_<childId>`.
//
// Provata con l'SDK client e utenti veri (token mock dell'emulatore: "anonymous"
// per l'ospite non ancora collegato, "google.com" per lo stesso uid collegato);
// l'Admin SDK serve solo per seminare e ispezionare, perché ignora le rules.
// Documenti realistici e "pesanti" come in .claude/qa-guest-migration/measure.mjs
// (che misura gli stessi casi via REST); payload come quelli del client.
//
// Rilancio dalla radice del repository (solo Firestore, porta 8180):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-guest-linked \
//     'node --test --test-concurrency=1 functions/tests/guestLinkedAccountRulesEmulator.test.mjs'
// Sul Mac mini (`mini`, JDK 21 già nel PATH di openjdk@21) con porte libere:
//   mini 'PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH firebase emulators:exec --only firestore \
//     --config <config con altre porte> --project demo-guest-linked \
//     "node --test --test-concurrency=1 functions/tests/guestLinkedAccountRulesEmulator.test.mjs"'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (anche hub, logging e websocket di Firestore) e rimuovi la copia
// a fine prova; il test legge l'host da FIRESTORE_EMULATOR_HOST. La config deve
// avere `"firestore": { "rules": "firestore.rules" }`: senza, l'emulatore ammette
// tutto e il canarino in `before` fallisce subito.
// Nell'emulatore ogni update negato logga «maximum of 1000 expressions» per
// 'update' @ registrations (anche nei test esistenti, con qualunque documento):
// l'esito è comunque permission-denied, quindi i negativi che contano hanno un
// controllo "lo stesso payload con l'elemento giusto passa".
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):\d+$/u, "Firestore Emulator locale richiesto");
const [emulatorHost, emulatorPort] = FIRESTORE_HOST.split(":");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `ospite-collegato-${runId}`;
const uid = (name) => `${name}-${runId}`;
const SEEDED_AT = "2026-10-01T08:00:00.000Z";
const SIGNED_AT = "2026-10-02T19:30:00.000Z";
const nowIso = () => new Date().toISOString();
const UNIT = { id: "unita-1", name: "Unità Uno" };
const DAYS = ["2026-11-13", "2026-11-14", "2026-11-15"];

// L'ospite G: stesso uid prima (anonimo) e dopo (collegato).
const G = uid("ospite");
const GUEST_ID = `guest_${G}`;
const USER_ID = `user_${G}`;
// Il genitore P con il figlio C.
const P = uid("genitore");
const CHILD_ID = "figlio-1";
const CHILD_REGISTRATION_ID = `child_${P}_${CHILD_ID}`;

// Date di nascita: minorenne di 15 anni (calcolata da oggi), maggiorenne senza dubbi.
function yearsAgo(years) {
  const now = new Date();
  const day = Math.min(now.getUTCDate(), 28);
  return `${now.getUTCFullYear() - years}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const MINOR = yearsAgo(15);
const ADULT = "1990-04-24";

// ---------------------------------------------------------------------------
// Attori
// ---------------------------------------------------------------------------

const ACTORS = {
  // Lo stesso uid G, con due token: prima del collegamento e dopo.
  ospite: { name: "ospite", provider: "anonymous", profile: null },
  collegato: { name: "ospite", provider: "google.com", profile: { role: "participant" } },
  estraneo: { name: "estraneo", provider: "google.com", profile: { role: "participant" } },
  estraneoAnonimo: { name: "estraneo-anonimo", provider: "anonymous", profile: null },
  genitore: { name: "genitore", provider: "password", profile: { role: "parent" } },
  altroGenitore: { name: "altro-genitore", provider: "password", profile: { role: "parent" } },
};
const clients = {};
const fs = (actor) => clients[actor].firestore;
const stored = async (path) => (await adminDb.doc(path).get()).data();
const withoutKeys = (data, keys) => Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));

const registrationPath = (activityId, registrationId) =>
  `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`;
const regRef = (actor, activityId, registrationId) =>
  doc(fs(actor), "stakes", stakeId, "activities", activityId, "registrations", registrationId);
const questionsCol = (actor, activityId, registrationId) =>
  collection(fs(actor), "stakes", stakeId, "activities", activityId, "registrations", registrationId, "questions");
const questionPath = (activityId, registrationId, questionId) =>
  `${registrationPath(activityId, registrationId)}/questions/${questionId}`;

// ---------------------------------------------------------------------------
// Documenti con la forma reale
// ---------------------------------------------------------------------------

const parentRequest = () => ({
  parentFirstName: "Paola",
  parentLastName: "Rossi",
  parentEmail: "genitore@example.invalid",
  parentPhone: "3331234567",
  emergencyContactName: "Anna Rossi",
  emergencyContactPhone: "3409876543",
  emergencyContactRelation: "nonna",
  allergies: "Graminacee, acari",
  medications: "Salbutamolo spray al bisogno",
  medicalNotes: "Asma da sforzo, porta sempre lo spray.",
  dietaryNotes: "Niente frutta a guscio.",
  submittedAt: SEEDED_AT,
});

/** Stato scritto da sendInitialAuthorizationEmail dopo la prima mail. */
function emailSentState(tokenId) {
  return {
    status: "email_sent",
    tokenId,
    selfTokenIssuedAt: null,
    parentFirstName: "Paola",
    parentLastName: "Rossi",
    parentEmail: "genitore@example.invalid",
    parentPhone: "3331234567",
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
    expiresAt: "2026-10-15T08:00:00.000Z",
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

/** Stato scritto da parentAuthorizationConfirm dopo la firma. */
function authorizedState(activityId) {
  const base = `parentAuthorizations/${stakeId}/${activityId}/${GUEST_ID}`;
  return {
    ...emailSentState("token-usato"),
    status: "authorized",
    emergencyContactName: "Anna Rossi",
    emergencyContactPhone: "3409876543",
    emergencyContactRelation: "nonna",
    allergies: "Graminacee, acari",
    medications: "Salbutamolo spray al bisogno",
    medicalNotes: "Asma da sforzo, porta sempre lo spray.",
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
    brevoMessageId: "<202610010800.1234567890@smtp-relay.mailin.fr>",
    ipAddress: "203.0.113.7",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    updatedAt: SIGNED_AT,
  };
}

/** Risposte del modulo: `count` domande miste (testo, liste, numeri, booleani, null) più i campi fissi. */
function answersFor({ birthDate, count, withParentRequest }) {
  const answers = {
    birthDate,
    genderRoleCategory: "giovane_uomo",
    youthGroup: "Giovani Uomini",
    unitName: UNIT.name,
    phone: "3471234567",
    city: "Roma",
    transportMode: "Pullman del palo",
    roomPreference1Name: "Luca Bianchi",
    roomPreference2Name: "Giovanni Verdi",
    roomNotes: "Preferisce il letto in basso, si sveglia presto.",
    allergies: "Graminacee, acari, nichel",
    photoInternalConsent: true,
  };
  for (let index = 1; index <= count; index += 1) {
    answers[`domanda_${String(index).padStart(2, "0")}`] =
      index % 5 === 0
        ? index
        : index % 4 === 0
          ? null
          : index % 3 === 0
            ? index % 2 === 0
            : index % 2 === 0
              ? [`scelta ${index}a`, `scelta ${index}b`]
              : `Risposta libera alla domanda ${index}: ${"dettaglio ".repeat(6).trim()}`;
  }
  if (withParentRequest) answers.parentAuthorizationRequest = parentRequest();
  return answers;
}

/** Iscrizione ospite come la scrive upsertRegistration da anonimo (setDoc alla prima iscrizione). */
function guestDoc({ birthDate, status, answerCount = 12, withParentRequest = false, ...overrides }) {
  return {
    userId: null,
    anonymousUid: G,
    parentUid: null,
    childId: null,
    anonymousTokenId: "tok-ospite",
    firstName: "Luca",
    lastName: "Rossi",
    fullName: "Luca Rossi",
    email: "luca@example.invalid",
    phone: "3471234567",
    birthDate,
    genderRoleCategory: "giovane_uomo",
    unitId: UNIT.id,
    unitNameSnapshot: UNIT.name,
    answers: answersFor({ birthDate, count: answerCount, withParentRequest }),
    roomPreferenceMatches: {},
    accessCode: "REC-123456",
    recoveryCode: "REC-123456",
    participatingDays: DAYS.slice(0, 2),
    recoveryPdfGenerated: true,
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
    parentAuthorization: null,
    linkedLaterToUserId: null,
    registrationStatus: status,
    submittedByMode: "anonymous",
    assignedRoomId: null,
    assignedRoomName: null,
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

/** (a) Adulto attivo, attività senza autorizzazione del genitore. */
const adultGuest = () => guestDoc({ birthDate: ADULT, status: "active" });

/** (b) Minore in attesa del genitore: mail partita, parentAuthorization `email_sent`. */
const pendingGuest = (status = "pending_parent_authorization", parentAuthorization = emailSentState("token-in-attesa")) =>
  guestDoc({ birthDate: MINOR, status, answerCount: 30, withParentRequest: true, parentAuthorization });

/** (c) Minore firmato "pesante": autorizzazione, firma, consensi, stanza, turno, squadra, pattuglia, comitati, ~55 risposte. */
function heavyGuest(activityId, status = "confirmed") {
  const base = `parentAuthorizations/${stakeId}/${activityId}/${GUEST_ID}`;
  return guestDoc({
    birthDate: MINOR,
    status,
    answerCount: 56,
    withParentRequest: true,
    parentAuthorization: authorizedState(activityId),
    parentConsentDocumentName: `modulo-consenso-${GUEST_ID}.pdf`,
    parentConsentDocumentUrl: "https://storage.example.invalid/consenso.pdf",
    parentConsentDocumentPath: `${base}/consenso.pdf`,
    parentConsentUploadedAt: SIGNED_AT,
    consentSignatureUrl: "https://storage.example.invalid/firma.png",
    consentSignaturePath: `${base}/signature.png`,
    consentSignatureSetAt: SIGNED_AT,
    parentIdDocumentName: `documento-${GUEST_ID}.pdf`,
    parentIdDocumentUrl: "https://storage.example.invalid/documento.pdf",
    parentIdDocumentPath: `${base}/documento.pdf`,
    parentIdUploadedAt: SIGNED_AT,
    roomPreferenceMatches: {
      roomPreference1Name: {
        key: "roomPreference1Name",
        rawValue: "Luca Bianchi",
        normalizedValue: "luca bianchi",
        matchedRegistrationId: "user_luca-bianchi",
        matchedFullName: "Luca Bianchi",
        matchedCategory: "giovane_uomo",
        score: 1,
        status: "matched",
        updatedAt: SEEDED_AT,
      },
      roomPreference2Name: {
        key: "roomPreference2Name",
        rawValue: "Giovanni Verdi",
        normalizedValue: "giovanni verdi",
        matchedRegistrationId: null,
        matchedFullName: null,
        matchedCategory: "",
        score: null,
        status: "unmatched",
        updatedAt: SEEDED_AT,
      },
    },
    participatingDays: DAYS,
    assignedRoomId: "stanza-12",
    assignedRoomName: "Stanza 12",
    assignedTempleShiftId: "turno-tempio-3",
    assignedServiceTeamIds: ["squadra-cucina"],
    assignedPatrolId: "pattuglia-aquile",
    assignedPatrolName: "Aquile",
    assignedPatrolRole: "member",
    assignedCommittees: ["cucina", "pulizie"],
    updatedAt: SIGNED_AT,
  });
}

/** Iscrizione di un figlio, per le domande del genitore. */
const childDoc = () =>
  guestDoc({
    birthDate: MINOR,
    status: "pending_parent_authorization",
    answerCount: 6,
    withParentRequest: true,
    parentAuthorization: emailSentState("token-figlio"),
    anonymousUid: null,
    parentUid: P,
    childId: CHILD_ID,
    anonymousTokenId: null,
    accessCode: null,
    recoveryCode: null,
    recoveryPdfGenerated: false,
    submittedByMode: "parent",
    firstName: "Figlio",
    fullName: "Figlio Rossi",
    email: "genitore@example.invalid",
  });

// ---------------------------------------------------------------------------
// Semina
// ---------------------------------------------------------------------------

let counter = 0;
/** Attività aperta alle iscrizioni; `camp`: campeggio con autorizzazione del genitore e ospiti ammessi. */
async function seedActivity({ camp }) {
  counter += 1;
  const activityId = `${camp ? "campeggio" : "attivita"}-${counter}`;
  await adminDb.doc(`stakes/${stakeId}/activities/${activityId}`).set({
    title: `${camp ? "Campeggio" : "Attività"} di prova ${counter}`,
    activityType: camp ? "camp" : "standard",
    overnight: camp,
    status: "registrations_open",
    isPublic: true,
    isVisible: true,
    registrationOpen: "2026-09-01T08:00:00.000Z",
    startDate: "2026-11-13T14:00:00.000Z",
    endDate: "2026-11-15T16:00:00.000Z",
    requiresParentAuthorization: camp,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  await adminDb.doc(`stakes/${stakeId}/activities/${activityId}/config/form`).set({ allowGuestRegistration: true });
  return activityId;
}

/** Ogni caso ha la sua attività: un rifiuto non lascia traccia e i casi non si pestano. */
async function seedCase({ camp, build }) {
  const activityId = await seedActivity({ camp });
  const guestPath = registrationPath(activityId, GUEST_ID);
  await adminDb.doc(guestPath).set(build(activityId));
  return {
    activityId,
    guestPath,
    userPath: registrationPath(activityId, USER_ID),
    current: await stored(guestPath),
  };
}

// ---------------------------------------------------------------------------
// Scritture con la forma del client
// ---------------------------------------------------------------------------

// I tredici campi del ramo "esiste già" di upsertRegistration.
const RESAVE_KEYS = [
  "firstName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "birthDate",
  "genderRoleCategory",
  "unitNameSnapshot",
  "answers",
  "roomPreferenceMatches",
  "participatingDays",
  "registrationStatus",
  "updatedAt",
];
assert.equal(RESAVE_KEYS.length, 13, "i campi del risalvataggio sono 13");

/** Modifica che il modulo fa davvero: un telefono e una risposta. */
const edits = (current) => ({
  phone: "3470000001",
  answers: { ...current.answers, domanda_01: "risposta cambiata" },
});

/** updateDoc di upsertRegistration: i campi del partecipante, con eventuali modifiche. */
function resaveFields(current, registrationStatus, changes = {}) {
  return {
    firstName: current.firstName,
    lastName: current.lastName,
    fullName: current.fullName,
    email: current.email,
    phone: changes.phone ?? current.phone,
    birthDate: current.birthDate,
    genderRoleCategory: current.genderRoleCategory,
    unitNameSnapshot: current.unitNameSnapshot,
    answers: changes.answers ?? current.answers,
    roomPreferenceMatches: current.roomPreferenceMatches,
    participatingDays: current.participatingDays,
    registrationStatus,
    updatedAt: nowIso(),
  };
}

/**
 * Il percorso dell'account collegato: upsertRegistration legge `user_<uid>`
 * (assente), poi `guest_<uid>` (presente) e lo aggiorna sul posto con i tredici
 * campi; infine rilegge lo stesso documento.
 */
async function clientResave(ctx, registrationStatus, actor = "collegato") {
  const userSnapshot = await getDocFromServer(regRef(actor, ctx.activityId, USER_ID));
  assert.equal(userSnapshot.exists(), false, "user_<uid> non esiste");
  const guestSnapshot = await getDocFromServer(regRef(actor, ctx.activityId, GUEST_ID));
  assert.equal(guestSnapshot.exists(), true, "guest_<uid> esiste");
  const current = guestSnapshot.data();
  const patch = resaveFields(current, registrationStatus, edits(current));
  await updateDoc(guestSnapshot.ref, patch);
  const reread = await getDocFromServer(guestSnapshot.ref);
  return { patch, reread: reread.data() };
}

/** Rifiuto delle rules: l'operazione si passa come funzione, così non resta una promessa rifiutata senza gestore. */
async function expectDenied(operation, label = "") {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, "permission-denied", `${label}: ${error?.code}: ${error?.message}`);
    return true;
  });
}

async function assertNoUserDoc(ctx, label = "") {
  assert.equal((await adminDb.doc(ctx.userPath).get()).exists, false, `${label}: user_<uid> non esiste`);
}

/** Un'operazione negata non lascia traccia: guest_<uid> identico e nessun user_<uid>. */
async function expectDeniedUnchanged(ctx, operation, label) {
  await expectDenied(operation, label);
  assert.deepEqual(await stored(ctx.guestPath), ctx.current, `${label}: guest_<uid> non è cambiato`);
  await assertNoUserDoc(ctx, label);
}

/** Aggiornamento riuscito sul posto: cambiano solo i tredici campi, guest_<uid> c'è ancora e user_<uid> no. */
async function expectResavedInPlace(ctx, patch, label) {
  const after = await stored(ctx.guestPath);
  assert.ok(after, `${label}: guest_<uid> esiste ancora`);
  assert.notDeepEqual(after, ctx.current, `${label}: il documento è cambiato`);
  assert.equal(after.registrationStatus, patch.registrationStatus, `${label}: stato`);
  assert.equal(after.phone, "3470000001", `${label}: telefono`);
  assert.equal(after.answers.domanda_01, "risposta cambiata", `${label}: risposta`);
  assert.deepEqual(after.answers, patch.answers, `${label}: risposte`);
  assert.equal(after.updatedAt, patch.updatedAt, `${label}: updatedAt`);
  // Tutto il resto è identico: parentAuthorization, firma, consensi, stanza, pattuglia, comitati.
  assert.deepEqual(withoutKeys(after, RESAVE_KEYS), withoutKeys(ctx.current, RESAVE_KEYS), `${label}: il resto del documento`);
  assert.equal(after.anonymousUid, G, `${label}: anonymousUid resta l'uid`);
  assert.equal(after.userId, null, `${label}: userId resta null`);
  await assertNoUserDoc(ctx, label);
}

// ---------------------------------------------------------------------------
// Semina degli attori e pulizia
// ---------------------------------------------------------------------------

before(async () => {
  const writes = [];
  const seededNames = new Set();
  for (const actor of Object.values(ACTORS)) {
    if (!actor.profile || seededNames.has(actor.name)) continue;
    seededNames.add(actor.name);
    writes.push(
      adminDb.doc(`users/${uid(actor.name)}`).set({
        firstName: "Test",
        lastName: actor.name,
        fullName: `Test ${actor.name}`,
        email: `${actor.name}-${runId}@example.invalid`,
        phone: "3330000000",
        birthDate: "1980-01-01",
        genderRoleCategory: "",
        youthGroup: "",
        unitId: UNIT.id,
        unitName: UNIT.name,
        stakeId,
        mustChangePassword: false,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
        lastLoginAt: SEEDED_AT,
        ...actor.profile,
      }),
    );
  }
  // Un figlio nell'account del genitore, con l'ownership su parentUid.
  writes.push(
    adminDb.doc(`users/${P}/children/${CHILD_ID}`).set({
      firstName: "Figlio",
      lastName: "Rossi",
      fullName: "Figlio Rossi",
      birthDate: MINOR,
      genderRoleCategory: "giovane_uomo",
      unitId: UNIT.id,
      unitName: UNIT.name,
      stakeId,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    }),
  );
  await Promise.all(writes);

  for (const [actor, data] of Object.entries(ACTORS)) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actor}-${runId}`);
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), {
      mockUserToken: {
        sub: uid(data.name),
        ...(data.provider === "anonymous" ? {} : { email: `${data.name}-${runId}@example.invalid` }),
        email_verified: data.provider !== "anonymous",
        firebase: { sign_in_provider: data.provider },
      },
    });
    clients[actor] = { app, firestore };
  }

  // Canarino: una config senza `firestore.rules` fa girare l'emulatore con
  // rules aperte e ogni test "negato" fallirebbe con "Missing expected
  // rejection". Un percorso senza match deve essere rifiutato a un utente vero.
  let canaryWritten = false;
  try {
    await setDoc(doc(fs("estraneo"), `stakes/${stakeId}/canary/rules-caricate`), { ok: true });
    canaryWritten = true;
  } catch (error) {
    assert.equal(error?.code, "permission-denied", `${error?.code}: ${error?.message}`);
  }
  assert.equal(
    canaryWritten,
    false,
    "Le rules non sono caricate: la config dell'emulatore deve avere firestore.rules (vedi il comando in testa al file)",
  );
});

after(async () => {
  try {
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
    for (const name of new Set(Object.values(ACTORS).map((actor) => actor.name))) {
      await adminDb.recursiveDelete(adminDb.doc(`users/${uid(name)}`));
    }
  } finally {
    await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// 1. L'account collegato aggiorna sul posto guest_<uid>
// ===========================================================================

describe("1. l'account collegato (google.com, stesso uid) aggiorna sul posto guest_<uid>", () => {
  test("(a) adulto attivo, attività senza autorizzazione del genitore", async () => {
    const ctx = await seedCase({ camp: false, build: adultGuest });
    assert.equal(ctx.current.registrationStatus, "active");

    const { patch, reread } = await clientResave(ctx, "active");

    await expectResavedInPlace(ctx, patch, "(a)");
    assert.equal(reread.registrationStatus, "active");
    assert.equal(reread.anonymousUid, G);
  });

  test("(b) minore in attesa del genitore (email_sent), campeggio con requiresParentAuthorization e ospiti ammessi", async () => {
    const ctx = await seedCase({ camp: true, build: () => pendingGuest() });
    assert.equal(ctx.current.registrationStatus, "pending_parent_authorization");
    assert.equal(ctx.current.parentAuthorization.status, "email_sent");
    assert.equal((await stored(`stakes/${stakeId}/activities/${ctx.activityId}`)).requiresParentAuthorization, true);
    assert.equal((await stored(`stakes/${stakeId}/activities/${ctx.activityId}/config/form`)).allowGuestRegistration, true);

    const { patch, reread } = await clientResave(ctx, "pending_parent_authorization");

    await expectResavedInPlace(ctx, patch, "(b)");
    assert.equal(reread.parentAuthorization.status, "email_sent");
    assert.equal(reread.parentAuthorization.tokenId, "token-in-attesa", "il token del genitore resta agganciato");
  });

  test("(c) minore confermato e firmato pesante (firma, consensi, stanza, turno, squadra, pattuglia, comitati, ~55 risposte)", async () => {
    const ctx = await seedCase({ camp: true, build: (activityId) => heavyGuest(activityId, "confirmed") });
    assert.ok(Object.keys(ctx.current.answers).length >= 55, "answers con molti campi");
    assert.equal(ctx.current.parentAuthorization.status, "authorized");

    const { patch, reread } = await clientResave(ctx, "confirmed");

    await expectResavedInPlace(ctx, patch, "(c)");
    const after = await stored(ctx.guestPath);
    assert.equal(after.registrationStatus, "confirmed");
    assert.equal(after.parentAuthorization.status, "authorized");
    assert.equal(after.consentSignaturePath, ctx.current.consentSignaturePath);
    assert.equal(after.assignedRoomId, "stanza-12");
    assert.equal(after.assignedRoomName, "Stanza 12");
    assert.equal(after.assignedTempleShiftId, "turno-tempio-3");
    assert.deepEqual(after.assignedServiceTeamIds, ["squadra-cucina"]);
    assert.equal(after.assignedPatrolId, "pattuglia-aquile");
    assert.deepEqual(after.assignedCommittees, ["cucina", "pulizie"]);
    assert.equal(reread.assignedRoomName, "Stanza 12");
  });

  test("(d) riattivazione cancelled -> active dello stesso firmato pesante", async () => {
    const ctx = await seedCase({ camp: true, build: (activityId) => heavyGuest(activityId, "cancelled") });
    assert.equal(ctx.current.registrationStatus, "cancelled");
    assert.equal(ctx.current.parentAuthorization.status, "authorized", "la firma c'era già");

    const { patch, reread } = await clientResave(ctx, "active");

    await expectResavedInPlace(ctx, patch, "(d)");
    assert.equal((await stored(ctx.guestPath)).registrationStatus, "active");
    assert.equal(reread.registrationStatus, "active");
    assert.equal(reread.parentAuthorization.status, "authorized");
  });

  test("il collegato non cancella guest_<uid>: senza user_<uid> la delete è negata", async () => {
    const ctx = await seedCase({ camp: false, build: adultGuest });
    await expectDeniedUnchanged(ctx, () => deleteDoc(regRef("collegato", ctx.activityId, GUEST_ID)), "delete");
  });
});

// ===========================================================================
// 2. Il vecchio comportamento (setDoc di user_<uid> con la copia) resta negato
// ===========================================================================

// Perché il client non migra più: la create di user_<uid> con i campi copiati
// dall'ospite è negata dalle rules (stato iniziale e campi che alla creazione
// restano vuoti), e non c'è modo di renderla ammissibile senza far perdere la
// firma o l'attesa del genitore.

/** Payload che il vecchio client mandava con setDoc su user_<uid> (registrationPayload con existing = guest_<uid>). */
const migrationPayload = (current, registrationStatus = current.registrationStatus, overrides = {}) => ({
  ...current,
  userId: G,
  anonymousUid: null,
  parentUid: null,
  childId: null,
  answers: { ...current.answers, domanda_01: "risposta cambiata" },
  registrationStatus,
  submittedByMode: "authenticated",
  updatedAt: nowIso(),
  ...overrides,
});

const migrate = (ctx, payload) => setDoc(regRef("collegato", ctx.activityId, USER_ID), payload);

// I 21 campi che alla creazione restano vuoti (diff di validRegistrationCreate).
const PROTECTED_DEFAULTS = {
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
  parentAuthorization: null,
  assignedRoomId: null,
  assignedRoomName: null,
  assignedTempleShiftId: null,
  assignedServiceTeamIds: [],
  assignedPatrolId: null,
  assignedPatrolName: null,
  assignedPatrolRole: null,
  assignedCommittees: [],
  linkedLaterToUserId: null,
};
assert.equal(Object.keys(PROTECTED_DEFAULTS).length, 21, "i campi protetti sono 21");

describe("2. setDoc(user_<uid>) con la copia dell'ospite: negato", () => {
  test("(b) minore in attesa: la copia porta parentAuthorization email_sent e la create è negata", async () => {
    const ctx = await seedCase({ camp: true, build: () => pendingGuest() });
    const payload = migrationPayload(ctx.current);
    assert.equal(payload.registrationStatus, "pending_parent_authorization", "lo stato iniziale sarebbe ammesso");
    assert.equal(payload.parentAuthorization.status, "email_sent");

    await expectDeniedUnchanged(ctx, () => migrate(ctx, payload), "migrazione (b)");
  });

  test("(b) controllo: la stessa create con parentAuthorization azzerato passa, a negare era la copia", async () => {
    const ctx = await seedCase({ camp: true, build: () => pendingGuest() });
    const payload = migrationPayload(ctx.current, "pending_parent_authorization", { parentAuthorization: null });

    await migrate(ctx, payload);

    const created = await stored(ctx.userPath);
    assert.equal(created.registrationStatus, "pending_parent_authorization");
    assert.equal(created.parentAuthorization, null, "e il genitore perderebbe la richiesta di autorizzazione");
    assert.equal(created.userId, G);
  });

  test("(c) minore firmato pesante: la copia (confirmed e campi firmati) è negata", async () => {
    const ctx = await seedCase({ camp: true, build: (activityId) => heavyGuest(activityId, "confirmed") });
    await expectDeniedUnchanged(ctx, () => migrate(ctx, migrationPayload(ctx.current)), "migrazione (c)");
  });

  // Tabella 2x2 su (c): né lo stato né i campi copiati bastano da soli, e
  // azzerarli entrambi fa passare la create (ma si perderebbe la firma).
  for (const [label, status, stripped, allowed] of [
    ["stato confirmed e campi copiati (come faceva il client)", "confirmed", false, false],
    ["stato pending_parent_authorization ma campi copiati", "pending_parent_authorization", false, false],
    ["stato confirmed ma campi azzerati", "confirmed", true, false],
    ["stato pending_parent_authorization e campi azzerati (si perde la firma)", "pending_parent_authorization", true, true],
  ]) {
    test(`(c) causa: ${label} -> ${allowed ? "passa" : "negato"}`, async () => {
      const ctx = await seedCase({ camp: true, build: (activityId) => heavyGuest(activityId, "confirmed") });
      const payload = migrationPayload(ctx.current, status, stripped ? PROTECTED_DEFAULTS : {});

      if (allowed) {
        await migrate(ctx, payload);
        const created = await stored(ctx.userPath);
        assert.equal(created.registrationStatus, status);
        assert.equal(created.parentAuthorization, null);
        assert.equal(created.assignedRoomId, null, "la stanza assegnata andrebbe persa");
      } else {
        await expectDeniedUnchanged(ctx, () => migrate(ctx, payload), label);
      }
    });
  }
});

// ===========================================================================
// 3. Negativi dell'aggiornamento sul posto
// ===========================================================================

describe("3. negativi dell'aggiornamento sul posto di guest_<uid>", () => {
  describe("stato", () => {
    test("pending_parent_authorization -> confirmed (autoconferma, con i tredici campi): negato", async () => {
      const ctx = await seedCase({ camp: true, build: () => pendingGuest() });
      const patch = resaveFields(ctx.current, "confirmed", edits(ctx.current));
      await expectDeniedUnchanged(ctx, () => updateDoc(regRef("collegato", ctx.activityId, GUEST_ID), patch), "pending -> confirmed");
    });

    test("pending_parent_authorization -> confirmed con soli stato e updatedAt: negato", async () => {
      const ctx = await seedCase({ camp: true, build: () => pendingGuest() });
      await expectDeniedUnchanged(
        ctx,
        () => updateDoc(regRef("collegato", ctx.activityId, GUEST_ID), { registrationStatus: "confirmed", updatedAt: nowIso() }),
        "pending -> confirmed (solo stato)",
      );
    });

    // Minore non firmato annullato: `active` salterebbe il consenso. Il
    // controllo (stesso documento, pending_parent_authorization) prova che a
    // negare è lo stato richiesto.
    for (const [label, authorization] of [
      ["mail al genitore partita (email_sent)", emailSentState("token-in-attesa")],
      ["parentAuthorization assente", null],
    ]) {
      test(`minore non firmato cancelled -> active: negato (${label}); cancelled -> pending_parent_authorization: passa`, async () => {
        const ctx = await seedCase({ camp: true, build: () => pendingGuest("cancelled", authorization) });

        const denied = resaveFields(ctx.current, "active", edits(ctx.current));
        await expectDeniedUnchanged(ctx, () => updateDoc(regRef("collegato", ctx.activityId, GUEST_ID), denied), "cancelled -> active");

        const accepted = resaveFields(ctx.current, "pending_parent_authorization", edits(ctx.current));
        await updateDoc(regRef("collegato", ctx.activityId, GUEST_ID), accepted);
        await expectResavedInPlace(ctx, accepted, "cancelled -> pending_parent_authorization");
      });
    }
  });

  describe("un altro account non tocca guest_<uid>", () => {
    for (const [stato, camp, build] of [
      ["adulto attivo", false, adultGuest],
      ["minore firmato pesante", true, (activityId) => heavyGuest(activityId, "confirmed")],
    ]) {
      for (const [label, actor] of [
        ["un altro account (google.com)", "estraneo"],
        ["un'altra sessione anonima", "estraneoAnonimo"],
      ]) {
        test(`${label} aggiorna i tredici campi (${stato}): negato`, async () => {
          const ctx = await seedCase({ camp, build });
          const patch = resaveFields(ctx.current, ctx.current.registrationStatus, edits(ctx.current));
          await expectDeniedUnchanged(ctx, () => updateDoc(regRef(actor, ctx.activityId, GUEST_ID), patch), label);
        });

        test(`${label} annulla l'iscrizione (${stato}): negato`, async () => {
          const ctx = await seedCase({ camp, build });
          await expectDeniedUnchanged(
            ctx,
            () => updateDoc(regRef(actor, ctx.activityId, GUEST_ID), { registrationStatus: "cancelled", updatedAt: nowIso() }),
            `${label} annulla`,
          );
        });
      }
    }

    test("un altro account non si intesta guest_<uid> (userId)", async () => {
      const ctx = await seedCase({ camp: false, build: adultGuest });
      await expectDeniedUnchanged(
        ctx,
        () => updateDoc(regRef("estraneo", ctx.activityId, GUEST_ID), { userId: uid("estraneo"), updatedAt: nowIso() }),
        "userId altrui",
      );
    });
  });

  describe("l'account collegato non cambia i campi che non gli appartengono", () => {
    test("parentAuthorization sostituito insieme ai tredici campi (si dichiara firmato): negato", async () => {
      const ctx = await seedCase({ camp: true, build: () => pendingGuest() });
      const patch = {
        ...resaveFields(ctx.current, "pending_parent_authorization", edits(ctx.current)),
        parentAuthorization: { ...ctx.current.parentAuthorization, status: "authorized", authorizedAt: nowIso() },
      };
      await expectDeniedUnchanged(ctx, () => updateDoc(regRef("collegato", ctx.activityId, GUEST_ID), patch), "parentAuthorization");
    });

    test("parentAuthorization.status col percorso puntato: negato", async () => {
      const ctx = await seedCase({ camp: true, build: () => pendingGuest() });
      await expectDeniedUnchanged(
        ctx,
        () => updateDoc(regRef("collegato", ctx.activityId, GUEST_ID), { "parentAuthorization.status": "authorized", updatedAt: nowIso() }),
        "parentAuthorization.status",
      );
    });

    test("parentAuthorization rimosso (deleteField) da un'iscrizione firmata: negato", async () => {
      const ctx = await seedCase({ camp: true, build: (activityId) => heavyGuest(activityId, "confirmed") });
      await expectDeniedUnchanged(
        ctx,
        () => updateDoc(regRef("collegato", ctx.activityId, GUEST_ID), { parentAuthorization: deleteField(), updatedAt: nowIso() }),
        "parentAuthorization rimosso",
      );
    });

    // [etichetta, attività da campeggio, costruttore, campi da cambiare insieme ai tredici]
    const FIELD_CASES = [
      ["assignedRoomId: da null a una stanza (minore in attesa)", () => pendingGuest(), { assignedRoomId: "stanza-1" }],
      ["assignedRoomId: da una stanza a un'altra (firmato pesante)", (id) => heavyGuest(id), { assignedRoomId: "stanza-99" }],
      ["assignedRoomId: stanza tolta (firmato pesante)", (id) => heavyGuest(id), { assignedRoomId: null }],
      ["assignedRoomName: rinominata (firmato pesante)", (id) => heavyGuest(id), { assignedRoomName: "Stanza 1" }],
      ["assignedPatrolId: pattuglia cambiata (firmato pesante)", (id) => heavyGuest(id), { assignedPatrolId: "pattuglia-lupi" }],
      ["assignedCommittees: comitati cambiati (firmato pesante)", (id) => heavyGuest(id), { assignedCommittees: ["giochi"] }],
      ["assignedTempleShiftId: turno cambiato (firmato pesante)", (id) => heavyGuest(id), { assignedTempleShiftId: "turno-tempio-9" }],
      ["consentSignaturePath: firma scollegata (firmato pesante)", (id) => heavyGuest(id), { consentSignaturePath: null }],
      ["userId: si trasforma in user_<uid> restando guest_<uid> (adulto attivo)", adultGuest, { userId: G }],
    ];
    for (const [label, build, fields] of FIELD_CASES) {
      test(`${label}: negato`, async () => {
        const camp = build !== adultGuest;
        const ctx = await seedCase({ camp, build });
        const patch = { ...resaveFields(ctx.current, ctx.current.registrationStatus, edits(ctx.current)), ...fields };
        await expectDeniedUnchanged(ctx, () => updateDoc(regRef("collegato", ctx.activityId, GUEST_ID), patch), label);
      });
    }
  });
});

// ===========================================================================
// 4. Domande dell'ospite collegato
// ===========================================================================

describe("4. domande sotto l'iscrizione mostrata (guest_<uid> per l'ospite collegato)", () => {
  /** Payload di create di questionsService: l'account collegato è `authorUserId`, l'ospite anonimo `authorAnonymousUid`. */
  const questionPayload = (ctx, registrationId, overrides = {}) => {
    const timestamp = nowIso();
    return {
      eventId: ctx.activityId,
      stakeId,
      registrationId,
      authorUserId: G,
      authorAnonymousUid: null,
      authorName: "Luca Rossi",
      text: "A che ora si parte da piazza?",
      isAnonymous: false,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  };

  /** Domanda scritta quando l'ospite era ancora anonimo (authorAnonymousUid G, authorUserId null). */
  async function seedAnonymousQuestion(ctx, questionId = "domanda-vecchia") {
    const data = questionPayload(ctx, GUEST_ID, {
      authorUserId: null,
      authorAnonymousUid: G,
      text: "Serve il sacco a pelo?",
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    await adminDb.doc(questionPath(ctx.activityId, GUEST_ID, questionId)).set(data);
    return { questionId, data };
  }

  const newQuestionRef = (actor, ctx, registrationId) => doc(questionsCol(actor, ctx.activityId, registrationId));
  const adultCase = () => seedCase({ camp: false, build: adultGuest });

  test("l'account collegato crea una domanda sotto guest_<uid>", async () => {
    const ctx = await adultCase();
    const payload = questionPayload(ctx, GUEST_ID);
    const reference = newQuestionRef("collegato", ctx, GUEST_ID);

    await setDoc(reference, payload);

    assert.deepEqual(await stored(questionPath(ctx.activityId, GUEST_ID, reference.id)), payload);
    assert.equal((await adminDb.doc(ctx.userPath).get()).exists, false, "user_<uid> non esiste");
  });

  test("domanda anonima dell'account collegato: authorName null, resta sotto guest_<uid>", async () => {
    const ctx = await adultCase();
    const payload = questionPayload(ctx, GUEST_ID, { isAnonymous: true, authorName: null });
    const reference = newQuestionRef("collegato", ctx, GUEST_ID);

    await setDoc(reference, payload);

    const saved = await stored(questionPath(ctx.activityId, GUEST_ID, reference.id));
    assert.equal(saved.isAnonymous, true);
    assert.equal(saved.authorName, null);
    assert.equal(saved.authorUserId, G);
  });

  test("la stessa domanda sotto user_<uid> (vecchio client, ricostruito dalla sessione): negata", async () => {
    const ctx = await adultCase();
    const payload = questionPayload(ctx, USER_ID);
    const reference = newQuestionRef("collegato", ctx, USER_ID);

    await expectDenied(() => setDoc(reference, payload), "create sotto user_<uid>");

    const leftovers = await adminDb.collection(`${ctx.userPath}/questions`).get();
    assert.equal(leftovers.size, 0, "nessuna domanda scritta");
    // Controllo: lo stesso payload sotto l'iscrizione che esiste (guest_<uid>) passa.
    const sameUnderGuest = newQuestionRef("collegato", ctx, GUEST_ID);
    await setDoc(sameUnderGuest, { ...payload, registrationId: GUEST_ID });
    assert.ok(await stored(questionPath(ctx.activityId, GUEST_ID, sameUnderGuest.id)));
  });

  test("l'ospite ancora anonimo crea sotto guest_<uid> (authorAnonymousUid): passa", async () => {
    const ctx = await adultCase();
    const payload = questionPayload(ctx, GUEST_ID, { authorUserId: null, authorAnonymousUid: G });
    const reference = newQuestionRef("ospite", ctx, GUEST_ID);

    await setDoc(reference, payload);

    assert.deepEqual(await stored(questionPath(ctx.activityId, GUEST_ID, reference.id)), payload);
  });

  test("l'account collegato lista le domande di guest_<uid>, anche quella scritta da anonimo", async () => {
    const ctx = await adultCase();
    const old = await seedAnonymousQuestion(ctx);
    const created = newQuestionRef("collegato", ctx, GUEST_ID);
    await setDoc(created, questionPayload(ctx, GUEST_ID));

    const snapshot = await getDocsFromServer(questionsCol("collegato", ctx.activityId, GUEST_ID));

    const ids = snapshot.docs.map((item) => item.id).sort();
    assert.deepEqual(ids, [old.questionId, created.id].sort());
    const oldRead = snapshot.docs.find((item) => item.id === old.questionId).data();
    assert.equal(oldRead.authorAnonymousUid, G);
    assert.equal(oldRead.authorUserId, null);
  });

  test("la lista sotto user_<uid> è consentita ma vuota: le domande non stanno lì (era il bug)", async () => {
    const ctx = await adultCase();
    await seedAnonymousQuestion(ctx);

    const snapshot = await getDocsFromServer(questionsCol("collegato", ctx.activityId, USER_ID));

    assert.equal(snapshot.size, 0);
  });

  test("l'account collegato aggiorna la domanda scritta da anonimo con il payload di update", async () => {
    const ctx = await adultCase();
    const old = await seedAnonymousQuestion(ctx);
    const updatedAt = new Date(Date.now() + 1000).toISOString();

    await updateDoc(doc(fs("collegato"), questionPath(ctx.activityId, GUEST_ID, old.questionId)), {
      text: "Serve il sacco a pelo? Anche il materassino?",
      isAnonymous: true,
      authorName: null,
      updatedAt,
    });

    const after = await stored(questionPath(ctx.activityId, GUEST_ID, old.questionId));
    assert.equal(after.text, "Serve il sacco a pelo? Anche il materassino?");
    assert.equal(after.isAnonymous, true);
    assert.equal(after.authorName, null);
    assert.equal(after.updatedAt, updatedAt);
    // L'autore non si sposta: resta l'uid anonimo con cui è stata scritta.
    assert.equal(after.authorAnonymousUid, G);
    assert.equal(after.authorUserId, null);
    assert.equal(after.createdAt, SEEDED_AT);
    assert.equal(after.registrationId, GUEST_ID);
  });

  test("l'account collegato aggiorna anche la propria domanda (authorUserId) e poi la cancella", async () => {
    const ctx = await adultCase();
    const reference = newQuestionRef("collegato", ctx, GUEST_ID);
    await setDoc(reference, questionPayload(ctx, GUEST_ID));
    const path = questionPath(ctx.activityId, GUEST_ID, reference.id);

    await updateDoc(reference, { text: "Testo corretto", isAnonymous: false, authorName: "Luca Rossi", updatedAt: nowIso() });
    assert.equal((await stored(path)).text, "Testo corretto");

    await deleteDoc(reference);
    assert.equal(await stored(path), undefined);
  });

  test("l'account collegato cancella la domanda scritta da anonimo (remove del service)", async () => {
    const ctx = await adultCase();
    const old = await seedAnonymousQuestion(ctx);
    const path = questionPath(ctx.activityId, GUEST_ID, old.questionId);

    await deleteDoc(doc(fs("collegato"), path));

    assert.equal(await stored(path), undefined);
  });

  describe("un estraneo non entra nelle domande di guest_<uid>", () => {
    for (const [label, actor, authorUserId, authorAnonymousUid] of [
      ["un altro account (google.com), a proprio nome", "estraneo", uid("estraneo"), null],
      ["un altro account (google.com), spacciandosi per l'ospite", "estraneo", G, null],
      ["un'altra sessione anonima, a proprio nome", "estraneoAnonimo", null, uid("estraneo-anonimo")],
      ["un'altra sessione anonima, con l'uid anonimo dell'ospite", "estraneoAnonimo", null, G],
    ]) {
      test(`${label}: create negata`, async () => {
        const ctx = await adultCase();
        const payload = questionPayload(ctx, GUEST_ID, { authorUserId, authorAnonymousUid });
        const reference = newQuestionRef(actor, ctx, GUEST_ID);

        await expectDenied(() => setDoc(reference, payload), label);

        assert.equal(await stored(questionPath(ctx.activityId, GUEST_ID, reference.id)), undefined);
      });
    }

    test("un altro account non lista, non legge, non aggiorna e non cancella le domande dell'ospite", async () => {
      const ctx = await adultCase();
      const old = await seedAnonymousQuestion(ctx);
      const path = questionPath(ctx.activityId, GUEST_ID, old.questionId);
      const before = await stored(path);

      await expectDenied(() => getDocsFromServer(questionsCol("estraneo", ctx.activityId, GUEST_ID)), "lista");
      await expectDenied(() => getDocFromServer(doc(fs("estraneo"), path)), "lettura");
      await expectDenied(
        () => updateDoc(doc(fs("estraneo"), path), { text: "manomessa", isAnonymous: false, authorName: null, updatedAt: nowIso() }),
        "aggiornamento",
      );
      await expectDenied(() => deleteDoc(doc(fs("estraneo"), path)), "cancellazione");

      assert.deepEqual(await stored(path), before);
    });
  });
});

// ===========================================================================
// 5. Domande del genitore sotto child_<parentUid>_<childId>
// ===========================================================================

describe("5. il genitore e le domande sotto child_<parentUid>_<childId>", () => {
  async function seedChildCase() {
    const activityId = await seedActivity({ camp: true });
    const path = registrationPath(activityId, CHILD_REGISTRATION_ID);
    await adminDb.doc(path).set(childDoc());
    const questionId = "domanda-del-genitore";
    const timestamp = SEEDED_AT;
    await adminDb.doc(questionPath(activityId, CHILD_REGISTRATION_ID, questionId)).set({
      eventId: activityId,
      stakeId,
      registrationId: CHILD_REGISTRATION_ID,
      authorUserId: P,
      authorAnonymousUid: null,
      authorName: "Paola Rossi",
      text: "Il figlio può portare la chitarra?",
      isAnonymous: false,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { activityId, questionId };
  }

  test("il genitore lista le domande sotto child_<parentUid>_<childId>", async () => {
    const { activityId, questionId } = await seedChildCase();

    const snapshot = await getDocsFromServer(questionsCol("genitore", activityId, CHILD_REGISTRATION_ID));

    assert.deepEqual(snapshot.docs.map((item) => item.id), [questionId]);
    assert.equal(snapshot.docs[0].data().authorUserId, P);
  });

  test("il genitore crea una domanda sotto child_<parentUid>_<childId> (authorUserId = parentUid)", async () => {
    const { activityId } = await seedChildCase();
    const timestamp = nowIso();
    const reference = doc(questionsCol("genitore", activityId, CHILD_REGISTRATION_ID));
    const payload = {
      eventId: activityId,
      stakeId,
      registrationId: CHILD_REGISTRATION_ID,
      authorUserId: P,
      authorAnonymousUid: null,
      authorName: "Paola Rossi",
      text: "A che ora ritiriamo il figlio?",
      isAnonymous: false,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await setDoc(reference, payload);

    assert.deepEqual(await stored(questionPath(activityId, CHILD_REGISTRATION_ID, reference.id)), payload);
  });

  test("un altro genitore non lista né crea sotto il figlio altrui", async () => {
    const { activityId, questionId } = await seedChildCase();
    const timestamp = nowIso();

    await expectDenied(() => getDocsFromServer(questionsCol("altroGenitore", activityId, CHILD_REGISTRATION_ID)), "lista");
    await expectDenied(
      () =>
        setDoc(doc(questionsCol("altroGenitore", activityId, CHILD_REGISTRATION_ID)), {
          eventId: activityId,
          stakeId,
          registrationId: CHILD_REGISTRATION_ID,
          authorUserId: uid("altro-genitore"),
          authorAnonymousUid: null,
          authorName: "Altro Genitore",
          text: "Intrusa",
          isAnonymous: false,
          status: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      "create",
    );

    const remaining = await adminDb.collection(`${registrationPath(activityId, CHILD_REGISTRATION_ID)}/questions`).get();
    assert.deepEqual(remaining.docs.map((item) => item.id), [questionId]);
  });
});
