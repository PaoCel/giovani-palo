// Fase 4 del flusso genitore (docs/FLUSSO_GENITORE.md, "Chi vede, chi
// scrive", E, F e H): prova che le chiamate del client della fase 4 passano
// con le rules di oggi, senza una rule nuova, e che quelle altrui no.
//
// Le chiamate sono quelle del client, campo per campo:
// - src/services/firestore/childrenService.ts: createChild senza e con
//   `draft` ({ childId, createdAt } da newChildDraft: un "Salva" ripetuto
//   dopo un errore di rete riscrive lo stesso id con lo stesso createdAt),
//   updateChild, listChildren, getChild;
// - src/services/firestore/registrationsService.ts: getRegistrationByActor e
//   getRegistrationById sull'id fisso child_<genitore>_<figlio> ("Già
//   iscritto" in E, anche quando il documento non c'è), upsertRegistration
//   con le sue letture (attività, unità attive, iscrizione) e i due rami di
//   scrittura (setDoc alla prima iscrizione, updateDoc al risalvataggio),
//   watchRegistration (onSnapshot del singolo documento, H) e
//   listFamilyRegistrations (collection group where parentUid == uid);
// - src/components/RegistrationEditor.tsx (handleSubmit): l'input che arriva
//   a upsertRegistration, con answers.parentAuthorizationRequest compilato
//   dai dati dell'account (nome, email, telefono letti dal profilo) quando
//   l'attività chiede l'autorizzazione del genitore;
// - src/services/firestore/registrationAttemptsService.ts: il registro dei
//   tentativi che handleSubmit scrive intorno al salvataggio (nel client gli
//   errori sono inghiottiti: qui un rifiuto si vedrebbe).
// Stato e preferenze stanza al salvataggio vengono dalle funzioni vere
// (src/utils/registrationStatus.ts, src/utils/roomPreferences.ts).
//
// SDK client con utenti normali autenticati (token mock dell'emulatore) e
// profilo completo nel palo; l'Admin SDK serve solo per seminare palo, unità,
// attività e profili, per simulare le scritture del server (trigger della
// mail, firma, stanza) e per rileggere: ignora le rules.
//
// Ruoli (projects/giovani-palo.md): figli e iscrizioni child_ non guardano il
// ruolo nelle rules, "solo il genitore iscrive figli" è un vincolo del client.
// Le stesse operazioni con un partecipante adulto e un dirigente di unità
// devono quindi passare: il test fallisce solo se il risultato cambia.
//
// Rilancio dalla radice del repository (solo Firestore, porta 8180):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-parent-child \
//     'node --test --test-concurrency=1 functions/tests/parentChildFlowRulesEmulator.test.mjs functions/tests/parentCancelRulesEmulator.test.mjs'
// Il secondo file è la regressione sui casi pesanti dell'annullamento e del
// risalvataggio. Con le porte occupate da un'altra sessione non fermarla:
// copia la config su porte diverse (Firestore, hub, logging, websocket) in un
// file temporaneo e rimuovilo a fine prova; il test legge l'host da
// FIRESTORE_EMULATOR_HOST.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { resolveRegistrationStatusOnSave } from "../../src/utils/registrationStatus.ts";
import {
  getRoomPreferenceTextFromAnswers,
  parseRoomPreferenceMatches,
  preserveRoomPreferenceMatchesOnSave,
} from "../../src/utils/roomPreferences.ts";

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
const stakeId = `genitore-figlio-${runId}`;
const uid = (name) => `${name}-${runId}`;
const SEEDED_AT = "2026-10-01T08:00:00.000Z";
const SIGNED_AT = "2026-10-02T19:30:00.000Z";
const nowIso = () => new Date().toISOString();

const UNITS = [
  { id: "unita-1", name: "Unità Uno" },
  { id: "unita-2", name: "Unità Due" },
];

// Profilo completo nel palo, come lo lasciano "I tuoi dati" e Accedi.
const ACTORS = {
  genitore: {
    name: "genitore",
    role: "parent",
    firstName: "Paola",
    lastName: "Rossi",
    phone: "3331234567",
    birthDate: "1981-03-14",
    genderRoleCategory: "",
    unitId: "unita-1",
  },
  altroGenitore: {
    name: "altro-genitore",
    role: "parent",
    firstName: "Franco",
    lastName: "Neri",
    phone: "3337654321",
    birthDate: "1978-11-02",
    genderRoleCategory: "",
    unitId: "unita-2",
  },
  adulto: {
    name: "adulto",
    role: "participant",
    firstName: "Giorgio",
    lastName: "Bianchi",
    phone: "3351112233",
    birthDate: "1979-04-24",
    genderRoleCategory: "accompagnatore",
    unitId: "unita-1",
  },
  dirigente: {
    name: "dirigente",
    role: "unit_leader",
    firstName: "Sara",
    lastName: "Verdi",
    phone: "3384445566",
    birthDate: "1985-09-02",
    genderRoleCategory: "dirigente",
    unitId: "unita-1",
  },
  nonAutenticato: null,
};
const clients = {};
const fs = (actor) => clients[actor].firestore;
const stored = async (path) => (await adminDb.doc(path).get()).data();

/** Rifiuto delle rules: l'operazione si passa come funzione, così non resta una promessa rifiutata senza gestore. */
async function expectDenied(operation, label = "") {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, "permission-denied", `${label} ${error?.code}: ${error?.message}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Figli: childrenService.ts
// ---------------------------------------------------------------------------

const childPath = (parentUid, childId) => `users/${parentUid}/children/${childId}`;
const childrenCollection = (actor, parentUid) => collection(fs(actor), "users", parentUid, "children");
const childRef = (actor, parentUid, childId) => doc(fs(actor), "users", parentUid, "children", childId);

/** Input di saveChild (ActivityRegisterPage): unità scelta fra quelle attive, palo dell'attività. */
function childInput(overrides = {}) {
  return {
    firstName: "Marco",
    lastName: "Rossi",
    birthDate: "2012-05-09",
    genderRoleCategory: "giovane_uomo",
    unitId: "unita-1",
    unitName: "Unità Uno",
    stakeId,
    ...overrides,
  };
}

/** childrenService.buildPayload: stessi trim, stesso blocco sul nome vuoto. */
function buildChildPayload(input) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName) throw new Error("Il nome è obbligatorio.");
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    birthDate: input.birthDate,
    genderRoleCategory: input.genderRoleCategory,
    unitId: input.unitId,
    unitName: input.unitName.trim(),
    stakeId: input.stakeId,
  };
}

/** childrenService.newChildDraft */
const newChildDraft = (actor, parentUid) => ({
  childId: doc(childrenCollection(actor, parentUid)).id,
  createdAt: nowIso(),
});

/** childrenService.createChild */
async function createChild(actor, parentUid, input, draft) {
  const reference = draft
    ? childRef(actor, parentUid, draft.childId)
    : doc(childrenCollection(actor, parentUid));
  const timestamp = nowIso();
  const payload = {
    ...buildChildPayload(input),
    createdAt: draft?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await setDoc(reference, payload);
  return { id: reference.id, ...payload };
}

/** childrenService.updateChild */
const updateChild = (actor, parentUid, childId, input) =>
  updateDoc(childRef(actor, parentUid, childId), { ...buildChildPayload(input), updatedAt: nowIso() });

/** childrenService.listChildren e getChild (cache-first: qui la lettura dal server, quella che le rules giudicano). */
const listChildren = (actor, parentUid) => getDocsFromServer(childrenCollection(actor, parentUid));
const getChild = (actor, parentUid, childId) => getDocFromServer(childRef(actor, parentUid, childId));

// ---------------------------------------------------------------------------
// Attività e iscrizioni: registrationsService.ts, RegistrationEditor.tsx
// ---------------------------------------------------------------------------

let activityCounter = 0;
/** Viaggio al tempio aperto alle iscrizioni, con autorizzazione del genitore. */
async function seedActivity({ open = true } = {}) {
  activityCounter += 1;
  const activityId = `tempio-${activityCounter}`;
  await adminDb.doc(`stakes/${stakeId}/activities/${activityId}`).set({
    title: `Viaggio al tempio ${activityCounter}`,
    activityType: "trip",
    overnight: true,
    status: open ? "registrations_open" : "registrations_closed",
    isPublic: true,
    isVisible: true,
    requiresParentAuthorization: true,
    registrationOpen: "2026-09-01T08:00:00.000Z",
    startDate: "2026-11-13T14:00:00.000Z",
    endDate: "2026-11-15T16:00:00.000Z",
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  return activityId;
}

const childLookup = (parentUid, childId) => ({
  userId: null,
  anonymousAuthUid: null,
  anonymousUid: null,
  parentUid,
  childId,
});
const childRegistrationId = (parentUid, childId) => `child_${parentUid}_${childId}`;
const registrationPath = (activityId, registrationId) =>
  `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`;
const registrationRef = (actor, activityId, registrationId) =>
  doc(fs(actor), "stakes", stakeId, "activities", activityId, "registrations", registrationId);

/** registrationsService.getRegistrationById / getRegistrationByActor per un figlio. */
const readChildRegistration = (actor, activityId, parentUid, childId) =>
  getDocFromServer(registrationRef(actor, activityId, childRegistrationId(parentUid, childId)));

/** Profilo dell'account letto dal client (sessione): da qui il prefill del passo genitore. */
async function readParentAccount(actor) {
  const snapshot = await getDocFromServer(doc(fs(actor), "users", uid(ACTORS[actor].name)));
  assert.ok(snapshot.exists(), "profilo dell'account leggibile dal titolare");
  const profile = snapshot.data();
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
  };
}

const LONG_MEDICAL_NOTES = [
  "Asma da sforzo diagnosticata nel 2019, seguita dal pediatra.",
  "Porta sempre con sé lo spray di salbutamolo (due puff prima di camminate lunghe o salite).",
  "In caso di crisi: farlo sedere, due puff, chiamare il genitore; se non migliora in dieci minuti, 112.",
  "Allergia alle graminacee con rinite stagionale; da aprile a giugno prende un antistaminico la sera.",
  "Nessun intervento chirurgico. Vaccinazioni in regola, ultimo richiamo antitetanico a settembre 2024.",
  "Soffre il mal d'auto nei viaggi lunghi: meglio un posto davanti sul pullman e uno spuntino leggero.",
  "Dorme male in ambienti molto caldi; se possibile una stanza con finestra.",
].join(" ").repeat(3);

/**
 * Input che RegistrationEditor.handleSubmit passa a onSubmit per un figlio
 * scelto da un account: risposte standard e personalizzate del modulo, passo
 * "Genitore e sicurezza" partito dai dati dell'account, attività con
 * autorizzazione del genitore.
 */
function editorSubmitInput(child, parentAccount, options = {}) {
  const { registrationStatus = "pending_parent_authorization", phone = "3471234567", answerChanges = {} } = options;
  const consentAcceptedAt = nowIso();
  const category = child.genderRoleCategory;
  const youthGroup = category === "giovane_donna" ? "Giovani Donne" : "Giovani Uomini";
  const values = {
    firstName: child.firstName,
    lastName: child.lastName,
    email: "",
    phone,
    birthDate: child.birthDate,
    unitName: child.unitName,
    answers: {
      birthDate: child.birthDate,
      youthGroup,
      genderRoleCategory: category,
      phone,
      unitName: child.unitName,
      city: "Roma",
      transportMode: "Pullman del palo",
      roomPreference1Name: "  Luca   Bianchi ",
      roomPreference2Name: "Giovanni Verdi",
      roomNotes: "Preferisce il letto in basso, si sveglia presto.",
      allergies: "Graminacee, acari, nichel",
      dietaryNotes: "Niente frutta a guscio; latte senza lattosio a colazione.",
      medicalNotes: LONG_MEDICAL_NOTES,
      photoInternalConsent: true,
      photoPublicConsent: false,
      parentConfirmed: true,
      ...answerChanges,
    },
  };
  // Domande personalizzate del modulo (testo, scelte multiple, sì/no, numeri, vuote).
  for (let index = 1; index <= 32; index += 1) {
    const key = `domanda_${String(index).padStart(2, "0")}`;
    values.answers[key] =
      index % 5 === 0
        ? index
        : index % 4 === 0
          ? null
          : index % 3 === 0
            ? index % 2 === 0
            : index % 2 === 0
              ? [`scelta ${index}a`, `scelta ${index}b`]
              : `Risposta libera alla domanda ${index}: ${"dettaglio ".repeat(12).trim()}`;
  }

  const medicalText = (key, fallback) => {
    const answer = values.answers[key];
    return (typeof answer === "string" ? answer : fallback).trim();
  };
  const parentAuthorizationRequest = {
    parentFirstName: parentAccount.firstName.trim(),
    parentLastName: parentAccount.lastName.trim(),
    parentEmail: parentAccount.email.trim().toLowerCase(),
    parentPhone: parentAccount.phone.trim(),
    emergencyContactName: "Anna Rossi",
    emergencyContactPhone: "3409876543",
    emergencyContactRelation: "nonna",
    allergies: medicalText("allergies", ""),
    medications: "Salbutamolo spray al bisogno; cetirizina 10 mg la sera da aprile a giugno.",
    medicalNotes: medicalText("medicalNotes", ""),
    dietaryNotes: medicalText("dietaryNotes", ""),
    submittedAt: consentAcceptedAt,
  };

  return {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    fullName: `${values.firstName.trim()} ${values.lastName.trim()}`.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    birthDate: values.birthDate,
    genderRoleCategory: category,
    unitName: values.unitName.trim(),
    answers: {
      ...values.answers,
      roomPreference1Name: getRoomPreferenceTextFromAnswers(values.answers, "roomPreference1Name"),
      roomPreference2Name: getRoomPreferenceTextFromAnswers(values.answers, "roomPreference2Name"),
      birthDate: values.birthDate,
      genderRoleCategory: category,
      youthGroup,
      unitName: values.unitName.trim(),
      parentAuthorizationRequest,
    },
    registrationStatus,
    status: "active",
    participatingDays: ["2026-11-13", "2026-11-14", "2026-11-15"],
  };
}

/** splitFullName di registrationsService.ts */
function splitFullName(value) {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** registrationPayload di upsertRegistration (lookup di un figlio). */
function buildRegistrationPayload(lookup, input, resolvedUnit, existing, timestamp) {
  const fullName = input.fullName.trim();
  const names = splitFullName(fullName);
  const recoveryCode = existing?.recoveryCode ?? null;
  return {
    userId: lookup.userId ?? null,
    anonymousUid: lookup.userId || lookup.parentUid ? null : (lookup.anonymousUid ?? null),
    parentUid: lookup.parentUid ?? null,
    childId: lookup.parentUid ? (lookup.childId ?? null) : null,
    anonymousTokenId: existing?.anonymousTokenId ?? null,
    firstName: names.firstName,
    lastName: names.lastName,
    fullName,
    email: input.email.trim(),
    phone: input.phone.trim(),
    birthDate: typeof input.answers.birthDate === "string" ? input.answers.birthDate : "",
    genderRoleCategory: input.answers.genderRoleCategory,
    unitId: resolvedUnit?.id ?? existing?.unitId ?? "",
    unitNameSnapshot: resolvedUnit?.name ?? input.answers.unitName.trim(),
    answers: input.answers,
    roomPreferenceMatches: preserveRoomPreferenceMatchesOnSave(
      parseRoomPreferenceMatches(existing?.roomPreferenceMatches),
      input.answers,
    ),
    accessCode: existing?.accessCode ?? recoveryCode,
    recoveryCode,
    participatingDays: Array.isArray(input.participatingDays)
      ? input.participatingDays.filter((value) => typeof value === "string")
      : (existing?.participatingDays ?? []),
    recoveryPdfGenerated: existing?.recoveryPdfGenerated ?? false,
    parentConsentDocumentName: existing?.parentConsentDocumentName ?? null,
    parentConsentDocumentUrl: existing?.parentConsentDocumentUrl ?? null,
    parentConsentDocumentPath: existing?.parentConsentDocumentPath ?? null,
    parentConsentUploadedAt: existing?.parentConsentUploadedAt ?? null,
    consentSignatureUrl: existing?.consentSignatureUrl ?? null,
    consentSignaturePath: existing?.consentSignaturePath ?? null,
    consentSignatureSetAt: existing?.consentSignatureSetAt ?? null,
    parentIdDocumentName: existing?.parentIdDocumentName ?? null,
    parentIdDocumentUrl: existing?.parentIdDocumentUrl ?? null,
    parentIdDocumentPath: existing?.parentIdDocumentPath ?? null,
    parentIdUploadedAt: existing?.parentIdUploadedAt ?? null,
    parentAuthorization: existing?.parentAuthorization ?? null,
    linkedLaterToUserId: existing?.linkedLaterToUserId ?? null,
    registrationStatus: resolveRegistrationStatusOnSave(
      existing
        ? { registrationStatus: existing.registrationStatus, parentAuthorization: existing.parentAuthorization ?? null }
        : null,
      input.registrationStatus,
      { parentAuthorizationRequested: Boolean(input.answers?.parentAuthorizationRequest) },
    ),
    submittedByMode: lookup.parentUid ? "parent" : lookup.userId ? "authenticated" : "anonymous",
    assignedRoomId: existing?.assignedRoomId ?? null,
    assignedTempleShiftId: existing?.assignedTempleShiftId ?? null,
    assignedServiceTeamIds: existing?.assignedServiceTeamIds ?? [],
    assignedPatrolId: existing?.assignedPatrolId ?? null,
    assignedPatrolName: existing?.assignedPatrolName ?? null,
    assignedPatrolRole: existing?.assignedPatrolRole ?? null,
    assignedCommittees: existing?.assignedCommittees ?? [],
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

/**
 * registrationsService.upsertRegistration per un figlio, con le sue letture:
 * attività (eventsService.getEventById), unità attive
 * (organizationService.assertManagedUnit → unitsService.listUnits), la
 * propria iscrizione (getDoc server-first), poi setDoc o updateDoc e la
 * rilettura (getRegistrationById). `branch` dice quale ramo ha scritto.
 */
async function upsertRegistration(actor, activityId, lookup, input) {
  const db = fs(actor);
  const event = await getDocFromServer(doc(db, "stakes", stakeId, "activities", activityId));
  assert.ok(event.exists(), "attività letta dal client");
  const units = await getDocsFromServer(
    query(collection(db, "stakes", stakeId, "units"), where("isActive", "==", true)),
  );
  const unitName = input.answers.unitName.trim();
  const unitMatch = units.docs.find(
    (unit) =>
      unit.data().name.toLocaleLowerCase("it-IT") === unitName.toLocaleLowerCase("it-IT") && unit.data().isActive,
  );
  assert.ok(unitMatch, `unità «${unitName}» fra quelle attive`);
  const resolvedUnit = { id: unitMatch.id, name: unitMatch.data().name };

  const registrationId = childRegistrationId(lookup.parentUid, lookup.childId);
  const reference = registrationRef(actor, activityId, registrationId);
  const snapshot = await getDocFromServer(reference);
  const existing = snapshot.exists() ? snapshot.data() : null;
  const payload = buildRegistrationPayload(lookup, input, resolvedUnit, existing, nowIso());

  if (snapshot.exists()) {
    await updateDoc(reference, {
      firstName: payload.firstName,
      lastName: payload.lastName,
      fullName: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      birthDate: payload.birthDate,
      genderRoleCategory: payload.genderRoleCategory,
      unitNameSnapshot: payload.unitNameSnapshot,
      answers: payload.answers,
      roomPreferenceMatches: payload.roomPreferenceMatches,
      participatingDays: payload.participatingDays,
      registrationStatus: payload.registrationStatus,
      updatedAt: payload.updatedAt,
    });
  } else {
    await setDoc(reference, payload);
  }

  const saved = await getDocFromServer(reference);
  assert.ok(saved.exists(), "iscrizione riletta dopo il salvataggio");
  return { branch: snapshot.exists() ? "updateDoc" : "setDoc", registrationId, payload, saved: saved.data() };
}

/** registrationAttemptsService: startAttempt, markStep, markSucceeded (best effort nel client). */
async function startAttempt(actor, activityId, lookup, input) {
  const timestamp = nowIso();
  const reference = await addDoc(collection(fs(actor), "stakes", stakeId, "registrationAttempts"), {
    stakeId,
    eventId: activityId,
    eventTitle: `Viaggio al tempio ${activityId}`,
    registrationId: null,
    userId: lookup.userId ?? lookup.parentUid ?? null,
    anonymousUid: lookup.userId || lookup.parentUid ? null : (lookup.anonymousUid ?? null),
    submittedByMode: lookup.userId || lookup.parentUid ? "authenticated" : "anonymous",
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    status: "started",
    lastStep: "submit_started",
    route: `/activities/${activityId}/register?per=figlio&passo=modulo&child=${lookup.childId}`,
    displayMode: "standalone",
    online: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36",
    registrationStatus: null,
    errorCode: null,
    errorMessage: null,
    startedAt: timestamp,
    completedAt: null,
    failedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return reference.id;
}

const attemptRef = (actor, attemptId) => doc(fs(actor), "stakes", stakeId, "registrationAttempts", attemptId);

/** handleSubmit: tentativo, salvataggio, passo, esito. Il registro qui non inghiotte errori. */
async function submitChildRegistration(actor, activityId, lookup, input) {
  const attemptId = await startAttempt(actor, activityId, lookup, input);
  const result = await upsertRegistration(actor, activityId, lookup, input);
  await updateDoc(attemptRef(actor, attemptId), {
    lastStep: "registration_saved",
    registrationId: result.registrationId,
    registrationStatus: result.saved.registrationStatus,
    updatedAt: nowIso(),
  });
  const completedAt = nowIso();
  await updateDoc(attemptRef(actor, attemptId), {
    status: "succeeded",
    lastStep: "completed",
    registrationId: result.registrationId,
    registrationStatus: result.saved.registrationStatus,
    completedAt,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    updatedAt: completedAt,
  });
  return { ...result, attemptId };
}

/** Il trigger sendInitialAuthorizationEmail dopo la prima mail (scrittura del server). */
function emailSentState(request) {
  return {
    status: "email_sent",
    tokenId: "token-mail",
    selfTokenIssuedAt: null,
    parentFirstName: request.parentFirstName,
    parentLastName: request.parentLastName,
    parentEmail: request.parentEmail,
    parentPhone: request.parentPhone,
    emergencyContactName: request.emergencyContactName,
    emergencyContactPhone: request.emergencyContactPhone,
    emergencyContactRelation: request.emergencyContactRelation,
    allergies: request.allergies,
    medications: request.medications,
    medicalNotes: request.medicalNotes,
    dietaryNotes: request.dietaryNotes,
    emailSentAt: SEEDED_AT,
    emailLastError: null,
    emailRetryCount: 0,
    emailProvider: "brevo",
    brevoMessageId: "<202610010800.1234567890@smtp-relay.mailin.fr>",
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

/** Preferenze stanza abbinate da normalizeRoomPreferenceMatches (scrittura dell'admin). */
const roomMatches = () => ({
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
});

/** Firma del genitore, stanza pubblicata, pattuglia e comitati (scritture del server e dello staff). */
function signedAndAssigned(data, registrationId) {
  const base = `parentAuthorizations/${stakeId}/act/${registrationId}`;
  return {
    registrationStatus: "confirmed",
    parentAuthorization: {
      ...data.parentAuthorization,
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
    },
    parentConsentDocumentName: `modulo-consenso-${registrationId}.pdf`,
    parentConsentDocumentPath: `${base}/consenso.pdf`,
    parentConsentUploadedAt: SIGNED_AT,
    consentSignaturePath: `${base}/signature.png`,
    consentSignatureSetAt: SIGNED_AT,
    assignedRoomId: "stanza-12",
    assignedRoomName: "Stanza 12",
    assignedPatrolId: "pattuglia-aquile",
    assignedPatrolName: "Aquile",
    assignedPatrolRole: "member",
    assignedCommittees: ["cucina", "pulizie"],
    updatedAt: SIGNED_AT,
  };
}

/** Raccoglie gli snapshot di watchRegistration (stessa onSnapshot, senza opzioni). */
function watchRegistration(actor, activityId, registrationId) {
  const snapshots = [];
  const errors = [];
  const waiters = new Set();
  const notify = () => waiters.forEach((check) => check());
  const unsubscribe = onSnapshot(
    registrationRef(actor, activityId, registrationId),
    (snapshot) => {
      snapshots.push(snapshot.exists() ? snapshot.data() : null);
      notify();
    },
    (error) => {
      errors.push(error);
      notify();
    },
  );
  const waitFor = (predicate, label, ms = 10000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(new Error(`timeout in attesa di: ${label}`));
      }, ms);
      function check() {
        if (predicate()) {
          clearTimeout(timer);
          waiters.delete(check);
          resolve();
        }
      }
      waiters.add(check);
      check();
    });
  return { snapshots, errors, unsubscribe, waitFor };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** listFamilyRegistrations (ramo `fresh`: dal server). */
const listFamilyRegistrations = (actor, parentUid) =>
  getDocsFromServer(query(collectionGroup(fs(actor), "registrations"), where("parentUid", "==", parentUid)));

// ---------------------------------------------------------------------------
// Semina
// ---------------------------------------------------------------------------

before(async () => {
  const writes = [
    adminDb.doc(`stakes/${stakeId}`).set({ name: "Palo di prova", createdAt: SEEDED_AT, updatedAt: SEEDED_AT }),
    ...UNITS.map((unit) =>
      adminDb.doc(`stakes/${stakeId}/units/${unit.id}`).set({
        name: unit.name,
        type: "ward",
        isActive: true,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      }),
    ),
  ];
  for (const actor of Object.values(ACTORS)) {
    if (!actor) continue;
    const unit = UNITS.find((item) => item.id === actor.unitId);
    writes.push(
      adminDb.doc(`users/${uid(actor.name)}`).set({
        firstName: actor.firstName,
        lastName: actor.lastName,
        fullName: `${actor.firstName} ${actor.lastName}`,
        email: `${actor.name}-${runId}@example.invalid`,
        phone: actor.phone,
        birthDate: actor.birthDate,
        genderRoleCategory: actor.genderRoleCategory,
        youthGroup: "",
        unitId: unit.id,
        unitName: unit.name,
        stakeId,
        role: actor.role,
        mustChangePassword: false,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
        lastLoginAt: SEEDED_AT,
      }),
    );
  }
  await Promise.all(writes);

  for (const [actor, data] of Object.entries(ACTORS)) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actor}-${runId}`);
    const firestore = getFirestore(app);
    const options = data
      ? {
          mockUserToken: {
            sub: uid(data.name),
            email: `${data.name}-${runId}@example.invalid`,
            email_verified: true,
            firebase: { sign_in_provider: "password" },
          },
        }
      : {};
    connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), options);
    clients[actor] = { app, firestore };
  }
});

after(async () => {
  try {
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
    for (const actor of Object.values(ACTORS)) {
      if (actor) await adminDb.recursiveDelete(adminDb.doc(`users/${uid(actor.name)}`));
    }
  } finally {
    await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// 1. Figli: il genitore crea, ripete il salvataggio, modifica, legge
// ===========================================================================

describe("1. il genitore crea e modifica un figlio (childrenService)", () => {
  const actor = "genitore";
  const parentUid = () => uid("genitore");

  test("createChild senza draft: setDoc su un id automatico", async () => {
    const saved = await createChild(actor, parentUid(), childInput());
    const { id, ...payload } = saved;
    assert.deepEqual(await stored(childPath(parentUid(), id)), payload);
  });

  test("createChild con draft (newChildDraft): id e createdAt decisi prima del primo tentativo", async () => {
    const draft = newChildDraft(actor, parentUid());
    const saved = await createChild(actor, parentUid(), childInput({ firstName: "Giulia", genderRoleCategory: "giovane_donna" }), draft);
    assert.equal(saved.id, draft.childId);
    const data = await stored(childPath(parentUid(), draft.childId));
    assert.equal(data.createdAt, draft.createdAt);
    assert.equal(data.fullName, "Giulia Rossi");
  });

  test("«Salva» ripetuto dopo un errore di rete: stesso id e stesso createdAt, il primo era già arrivato", async () => {
    const draft = newChildDraft(actor, parentUid());
    const first = await createChild(actor, parentUid(), childInput({ firstName: "Elena", genderRoleCategory: "giovane_donna" }), draft);
    const countBefore = (await listChildren(actor, parentUid())).size;
    await pause(5);
    // Seconda pressione: nel frattempo il genitore ha corretto il cognome.
    await createChild(
      actor,
      parentUid(),
      childInput({ firstName: "Elena", lastName: "Rossi Neri", genderRoleCategory: "giovane_donna" }),
      draft,
    );
    const data = await stored(childPath(parentUid(), draft.childId));
    assert.equal(data.createdAt, draft.createdAt, "createdAt invariato");
    assert.equal(data.fullName, "Elena Rossi Neri");
    assert.ok(data.updatedAt > first.updatedAt, "updatedAt del secondo salvataggio");
    assert.equal((await listChildren(actor, parentUid())).size, countBefore, "nessun doppione");
  });

  test("stesso id con un createdAt diverso: negato", async () => {
    const draft = newChildDraft(actor, parentUid());
    await createChild(actor, parentUid(), childInput({ firstName: "Pietro" }), draft);
    const path = childPath(parentUid(), draft.childId);
    const before = await stored(path);
    await expectDenied(
      () => createChild(actor, parentUid(), childInput({ firstName: "Pietro" }), { ...draft, createdAt: nowIso() }),
      "setDoc con createdAt nuovo",
    );
    assert.deepEqual(await stored(path), before);
  });

  test("updateChild: updateDoc con i campi del foglio e updatedAt", async () => {
    const draft = newChildDraft(actor, parentUid());
    await createChild(actor, parentUid(), childInput({ firstName: "Tommaso" }), draft);
    await updateChild(actor, parentUid(), draft.childId, childInput({
      firstName: " Tommaso ",
      lastName: "Rossi",
      birthDate: "2013-01-20",
      unitId: "unita-2",
      unitName: "Unità Due ",
    }));
    const data = await stored(childPath(parentUid(), draft.childId));
    assert.equal(data.createdAt, draft.createdAt);
    assert.equal(data.firstName, "Tommaso");
    assert.equal(data.birthDate, "2013-01-20");
    assert.equal(data.unitId, "unita-2");
    assert.equal(data.unitName, "Unità Due");
  });

  test("listChildren e getChild: consentiti, anche getChild di un id che non c'è", async () => {
    const draft = newChildDraft(actor, parentUid());
    await createChild(actor, parentUid(), childInput({ firstName: "Chiara", genderRoleCategory: "giovane_donna" }), draft);
    const list = await listChildren(actor, parentUid());
    assert.ok(list.docs.some((item) => item.id === draft.childId), "il figlio nuovo è nell'elenco");
    const one = await getChild(actor, parentUid(), draft.childId);
    assert.equal(one.exists(), true);
    assert.equal(one.data().fullName, "Chiara Rossi");
    const missing = await getChild(actor, parentUid(), "figlio-che-non-esiste");
    assert.equal(missing.exists(), false);
  });

  describe("payload non valido: negato (il client blocca il nome vuoto prima, la rule è la seconda linea)", () => {
    const INVALID = [
      ["campo in più (allergies)", (payload) => ({ ...payload, allergies: "Graminacee" })],
      ["campo in più (parentUid)", (payload) => ({ ...payload, parentUid: uid("genitore") })],
      ["firstName vuoto", (payload) => ({ ...payload, firstName: "", fullName: "Rossi" })],
      ["genderRoleCategory non valido (genitore)", (payload) => ({ ...payload, genderRoleCategory: "genitore" })],
      ["genderRoleCategory non valido (GU)", (payload) => ({ ...payload, genderRoleCategory: "GU" })],
    ];
    for (const [label, mutate] of INVALID) {
      test(`creazione con ${label}`, async () => {
        const draft = newChildDraft(actor, parentUid());
        const payload = mutate({ ...buildChildPayload(childInput()), createdAt: draft.createdAt, updatedAt: nowIso() });
        await expectDenied(() => setDoc(childRef(actor, parentUid(), draft.childId), payload), label);
        assert.equal(await stored(childPath(parentUid(), draft.childId)), undefined);
      });

      test(`modifica con ${label}`, async () => {
        const draft = newChildDraft(actor, parentUid());
        await createChild(actor, parentUid(), childInput(), draft);
        const path = childPath(parentUid(), draft.childId);
        const before = await stored(path);
        const payload = mutate({ ...buildChildPayload(childInput()), updatedAt: nowIso() });
        await expectDenied(() => updateDoc(childRef(actor, parentUid(), draft.childId), payload), label);
        assert.deepEqual(await stored(path), before);
      });
    }
  });

  test("un altro genitore e un utente non autenticato non leggono né scrivono i figli del genitore", async () => {
    const draft = newChildDraft(actor, parentUid());
    await createChild(actor, parentUid(), childInput({ firstName: "Davide" }), draft);
    const path = childPath(parentUid(), draft.childId);
    const before = await stored(path);
    for (const outsider of ["altroGenitore", "nonAutenticato"]) {
      await expectDenied(() => listChildren(outsider, parentUid()), `${outsider} listChildren`);
      await expectDenied(() => getChild(outsider, parentUid(), draft.childId), `${outsider} getChild`);
      await expectDenied(
        () => updateChild(outsider, parentUid(), draft.childId, childInput({ firstName: "Intruso" })),
        `${outsider} updateChild`,
      );
      await expectDenied(
        () => createChild(outsider, parentUid(), childInput({ firstName: "Intruso" }), newChildDraft(outsider, parentUid())),
        `${outsider} createChild`,
      );
    }
    assert.deepEqual(await stored(path), before);
  });
});

// ===========================================================================
// 2. "Già iscritto": get dell'id fisso, anche quando manca
// ===========================================================================

describe("2. «Già iscritto»: getDoc di child_<genitore>_<figlio> (getRegistrationByActor)", () => {
  let activityId;
  let closedActivityId;
  let free;
  let enrolled;

  before(async () => {
    activityId = await seedActivity();
    closedActivityId = await seedActivity({ open: false });
    free = await createChild("genitore", uid("genitore"), childInput({ firstName: "Libero" }), newChildDraft("genitore", uid("genitore")));
    enrolled = await createChild("genitore", uid("genitore"), childInput({ firstName: "Iscritto" }), newChildDraft("genitore", uid("genitore")));
    const account = await readParentAccount("genitore");
    const payload = buildRegistrationPayload(
      childLookup(uid("genitore"), enrolled.id),
      editorSubmitInput(enrolled, account),
      { id: "unita-1", name: "Unità Uno" },
      null,
      SEEDED_AT,
    );
    await adminDb.doc(registrationPath(activityId, childRegistrationId(uid("genitore"), enrolled.id))).set(payload);
  });

  test("iscrizione che non esiste: consentito, exists() falso (niente permission-denied)", async () => {
    const snapshot = await readChildRegistration("genitore", activityId, uid("genitore"), free.id);
    assert.equal(snapshot.exists(), false);
  });

  test("iscrizione che esiste: consentito, la scheda mostra «Già iscritto»", async () => {
    const snapshot = await readChildRegistration("genitore", activityId, uid("genitore"), enrolled.id);
    assert.equal(snapshot.exists(), true);
    assert.equal(snapshot.data().registrationStatus, "pending_parent_authorization");
    assert.equal(snapshot.data().childId, enrolled.id);
  });

  test("stesso id su un'attività con iscrizioni chiuse (findLatestParentDetails): consentito", async () => {
    const snapshot = await readChildRegistration("genitore", closedActivityId, uid("genitore"), enrolled.id);
    assert.equal(snapshot.exists(), false);
  });

  test("un altro genitore: negato sull'iscrizione che non esiste e su quella che esiste", async () => {
    await expectDenied(
      () => readChildRegistration("altroGenitore", activityId, uid("genitore"), free.id),
      "inesistente",
    );
    await expectDenied(
      () => readChildRegistration("altroGenitore", activityId, uid("genitore"), enrolled.id),
      "esistente",
    );
  });

  test("un utente non autenticato: negato su entrambe", async () => {
    await expectDenied(() => readChildRegistration("nonAutenticato", activityId, uid("genitore"), free.id), "inesistente");
    await expectDenied(() => readChildRegistration("nonAutenticato", activityId, uid("genitore"), enrolled.id), "esistente");
  });
});

// ===========================================================================
// 3. Iscrizione del figlio: prima scrittura e risalvataggi
// ===========================================================================

describe("3. iscrizione del figlio (handleSubmit → upsertRegistration)", () => {
  const actor = "genitore";
  const parentUid = () => uid("genitore");
  let activityId;
  let child;
  let account;
  let path;

  before(async () => {
    activityId = await seedActivity();
    account = await readParentAccount(actor);
    // Figlio appena creato dal foglio "Aggiungi" (con draft), come nel percorso E → F.
    child = await createChild(actor, parentUid(), childInput({ firstName: "Marco" }), newChildDraft(actor, parentUid()));
    path = registrationPath(activityId, childRegistrationId(parentUid(), child.id));
  });

  test("prima iscrizione di un figlio appena creato: setDoc con il payload completo, registro tentativi e rilettura", async () => {
    const input = editorSubmitInput(child, account);
    // 16 campi standard, 32 domande personalizzate e il blocco del genitore.
    assert.ok(Object.keys(input.answers).length >= 49, `modulo con molte risposte (${Object.keys(input.answers).length})`);
    assert.equal(input.answers.parentAuthorizationRequest.parentEmail, `genitore-${runId}@example.invalid`);
    assert.equal(input.answers.parentAuthorizationRequest.parentFirstName, "Paola");
    assert.equal(input.answers.parentAuthorizationRequest.parentPhone, "3331234567");
    assert.ok(input.answers.parentAuthorizationRequest.medicalNotes.length > 1500, "note sanitarie lunghe");

    const result = await submitChildRegistration(actor, activityId, childLookup(parentUid(), child.id), input);

    assert.equal(result.branch, "setDoc");
    assert.deepEqual(await stored(path), result.payload);
    assert.equal(result.saved.registrationStatus, "pending_parent_authorization");
    assert.equal(result.saved.submittedByMode, "parent");
    assert.equal(result.saved.parentUid, parentUid());
    assert.equal(result.saved.unitId, "unita-1");
    const attempt = await stored(`stakes/${stakeId}/registrationAttempts/${result.attemptId}`);
    assert.equal(attempt.status, "succeeded");
    assert.equal(attempt.registrationId, result.registrationId);
  });

  test("risalvataggio subito dopo (risposta persa o «Gestisci»): ramo updateDoc", async () => {
    const before = await stored(path);
    const input = editorSubmitInput(child, account, {
      phone: "3479999999",
      answerChanges: { roomNotes: "Letto in basso, grazie." },
    });
    const result = await upsertRegistration(actor, activityId, childLookup(parentUid(), child.id), input);
    assert.equal(result.branch, "updateDoc");
    const after = await stored(path);
    assert.equal(after.phone, "3479999999");
    assert.equal(after.answers.roomNotes, "Letto in basso, grazie.");
    assert.equal(after.registrationStatus, "pending_parent_authorization");
    assert.equal(after.createdAt, before.createdAt);
  });

  test("risalvataggio dopo la mail del trigger (parentAuthorization email_sent, preferenze stanza abbinate)", async () => {
    const current = await stored(path);
    await adminDb.doc(path).update({
      parentAuthorization: emailSentState(current.answers.parentAuthorizationRequest),
      roomPreferenceMatches: roomMatches(),
    });
    const before = await stored(path);
    const input = editorSubmitInput(child, account, { phone: "3478888888" });
    const result = await upsertRegistration(actor, activityId, childLookup(parentUid(), child.id), input);
    assert.equal(result.branch, "updateDoc");
    const after = await stored(path);
    assert.deepEqual(after.parentAuthorization, before.parentAuthorization, "parentAuthorization intatto");
    assert.equal(after.roomPreferenceMatches.roomPreference1Name.status, "matched");
    assert.equal(after.registrationStatus, "pending_parent_authorization");
  });

  test("risalvataggio dopo la firma (confirmed, consenso, stanza, pattuglia, comitati): nel budget", async () => {
    const current = await stored(path);
    await adminDb.doc(path).update(signedAndAssigned(current, childRegistrationId(parentUid(), child.id)));
    const before = await stored(path);
    // Il modulo di un'iscrizione esistente conserva lo stato (nextRegistrationStatus).
    const input = editorSubmitInput(child, account, {
      registrationStatus: "confirmed",
      phone: "3477777777",
      answerChanges: { dietaryNotes: "Niente frutta a guscio." },
    });
    const result = await upsertRegistration(actor, activityId, childLookup(parentUid(), child.id), input);
    assert.equal(result.branch, "updateDoc");
    const after = await stored(path);
    assert.equal(after.registrationStatus, "confirmed");
    assert.equal(after.phone, "3477777777");
    assert.deepEqual(after.parentAuthorization, before.parentAuthorization);
    assert.equal(after.assignedRoomName, "Stanza 12");
  });

  test("figlio che non esiste nell'account: negato", async () => {
    const ghost = { ...child, id: "figlio-mai-creato" };
    const ghostPath = registrationPath(activityId, childRegistrationId(parentUid(), ghost.id));
    await expectDenied(
      () => upsertRegistration(actor, activityId, childLookup(parentUid(), ghost.id), editorSubmitInput(ghost, account)),
      "figlio inesistente",
    );
    assert.equal(await stored(ghostPath), undefined);
  });

  test("childId di un figlio di un altro genitore: negato", async () => {
    const otherChild = await createChild(
      "altroGenitore",
      uid("altro-genitore"),
      childInput({ firstName: "Luca", lastName: "Neri", unitId: "unita-2", unitName: "Unità Due" }),
      newChildDraft("altroGenitore", uid("altro-genitore")),
    );
    const foreignPath = registrationPath(activityId, childRegistrationId(parentUid(), otherChild.id));
    await expectDenied(
      () => upsertRegistration(actor, activityId, childLookup(parentUid(), otherChild.id), editorSubmitInput(otherChild, account)),
      "childId altrui",
    );
    assert.equal(await stored(foreignPath), undefined);
  });

  test("id e parentUid di un altro genitore: negato (setDoc diretto, la lettura che lo precede è già negata)", async () => {
    const otherChild = await createChild(
      "altroGenitore",
      uid("altro-genitore"),
      childInput({ firstName: "Anna", lastName: "Neri", genderRoleCategory: "giovane_donna", unitId: "unita-2", unitName: "Unità Due" }),
      newChildDraft("altroGenitore", uid("altro-genitore")),
    );
    const lookup = childLookup(uid("altro-genitore"), otherChild.id);
    const registrationId = childRegistrationId(uid("altro-genitore"), otherChild.id);
    await expectDenied(() => getDocFromServer(registrationRef(actor, activityId, registrationId)), "lettura");
    const payload = buildRegistrationPayload(
      lookup,
      editorSubmitInput(otherChild, account),
      { id: "unita-2", name: "Unità Due" },
      null,
      nowIso(),
    );
    await expectDenied(() => setDoc(registrationRef(actor, activityId, registrationId), payload), "scrittura");
    assert.equal(await stored(registrationPath(activityId, registrationId)), undefined);
  });

  test("stato iniziale scelto da un client modificato: «confirmed» e «active» sono negati", async () => {
    // Non è una chiamata del client: resolveRegistrationStatusOnSave impone
    // pending_parent_authorization quando c'è parentAuthorizationRequest.
    // La rule di creazione (validInitialRegistrationStatus) non accetta
    // «confirmed», che lo scrive solo la firma del genitore, né «active» per
    // un minore in un'attività con autorizzazione. La matrice completa sta in
    // registrationInitialStatusRulesEmulator.test.mjs.
    for (const status of ["confirmed", "active"]) {
      const extra = await createChild(actor, parentUid(), childInput({ firstName: `Stato ${status}` }), newChildDraft(actor, parentUid()));
      const registrationId = childRegistrationId(parentUid(), extra.id);
      const payload = {
        ...buildRegistrationPayload(
          childLookup(parentUid(), extra.id),
          editorSubmitInput(extra, account),
          { id: "unita-1", name: "Unità Uno" },
          null,
          nowIso(),
        ),
        registrationStatus: status,
      };
      await expectDenied(
        () => setDoc(registrationRef(actor, activityId, registrationId), payload),
        `creazione child_ con registrationStatus "${status}" senza firma`,
      );
      assert.equal(await stored(registrationPath(activityId, registrationId)), undefined, `${status}: nessun documento scritto`);
    }
  });
});

// ===========================================================================
// 4. "Iscrizione inviata" dal vivo e Famiglia
// ===========================================================================

describe("4. lettura dal vivo (watchRegistration) e Famiglia (listFamilyRegistrations)", () => {
  let activityId;
  let secondActivityId;
  let child;
  let registrationId;

  before(async () => {
    activityId = await seedActivity();
    secondActivityId = await seedActivity();
    const account = await readParentAccount("genitore");
    child = await createChild("genitore", uid("genitore"), childInput({ firstName: "Sofia", genderRoleCategory: "giovane_donna" }), newChildDraft("genitore", uid("genitore")));
    const first = await submitChildRegistration("genitore", activityId, childLookup(uid("genitore"), child.id), editorSubmitInput(child, account));
    registrationId = first.registrationId;
    await submitChildRegistration("genitore", secondActivityId, childLookup(uid("genitore"), child.id), editorSubmitInput(child, account));

    // Iscrizioni di altri nello stesso palo: figlio di un altro genitore e adulto con il suo account.
    const otherAccount = await readParentAccount("altroGenitore");
    const otherChild = await createChild(
      "altroGenitore",
      uid("altro-genitore"),
      childInput({ firstName: "Luca", lastName: "Neri", unitId: "unita-2", unitName: "Unità Due" }),
      newChildDraft("altroGenitore", uid("altro-genitore")),
    );
    await submitChildRegistration("altroGenitore", activityId, childLookup(uid("altro-genitore"), otherChild.id), editorSubmitInput(otherChild, otherAccount));
    await adminDb.doc(registrationPath(activityId, `user_${uid("adulto")}`)).set({
      ...buildRegistrationPayload(
        { userId: uid("adulto"), anonymousUid: null, parentUid: null, childId: null },
        { ...editorSubmitInput({ ...child, firstName: "Giorgio", lastName: "Bianchi" }, account), registrationStatus: "active" },
        { id: "unita-1", name: "Unità Uno" },
        null,
        SEEDED_AT,
      ),
      registrationStatus: "active",
    });
  });

  test("onSnapshot del proprio documento: primo snapshot senza errore, poi l'esito della mail", async () => {
    const watcher = watchRegistration("genitore", activityId, registrationId);
    try {
      await watcher.waitFor(() => watcher.snapshots.length > 0 || watcher.errors.length > 0, "primo snapshot");
      assert.deepEqual(watcher.errors, []);
      assert.equal(watcher.snapshots[0]?.registrationStatus, "pending_parent_authorization");

      // Il trigger scrive l'esito della mail: la pagina "Iscrizione inviata" lo vede dal vivo.
      const current = await stored(registrationPath(activityId, registrationId));
      await adminDb.doc(registrationPath(activityId, registrationId)).update({
        parentAuthorization: emailSentState(current.answers.parentAuthorizationRequest),
      });
      await watcher.waitFor(
        () => watcher.snapshots.some((data) => data?.parentAuthorization?.status === "email_sent") || watcher.errors.length > 0,
        "snapshot con email_sent",
      );
      assert.deepEqual(watcher.errors, []);
    } finally {
      watcher.unsubscribe();
    }
  });

  test("onSnapshot sull'iscrizione di un altro genitore: il callback d'errore riceve permission-denied", async () => {
    const watcher = watchRegistration("altroGenitore", activityId, registrationId);
    try {
      await watcher.waitFor(() => watcher.errors.length > 0 || watcher.snapshots.length > 0, "esito dell'ascolto");
      assert.equal(watcher.snapshots.length, 0, "nessun dato consegnato");
      assert.equal(watcher.errors[0]?.code, "permission-denied");
    } finally {
      watcher.unsubscribe();
    }
  });

  test("collection group parentUid == uid: passa e restituisce solo le iscrizioni del genitore", async () => {
    const snapshot = await listFamilyRegistrations("genitore", uid("genitore"));
    const expected = await adminDb.collectionGroup("registrations").where("parentUid", "==", uid("genitore")).get();
    assert.deepEqual(
      snapshot.docs.map((item) => item.ref.path).sort(),
      expected.docs.map((item) => item.ref.path).sort(),
    );
    assert.ok(snapshot.size >= 2, `almeno le due iscrizioni di Sofia (${snapshot.size})`);
    for (const item of snapshot.docs) {
      assert.equal(item.data().parentUid, uid("genitore"), item.ref.path);
    }
    const paths = snapshot.docs.map((item) => item.ref.path);
    assert.ok(paths.includes(registrationPath(activityId, registrationId)));
    assert.ok(paths.includes(registrationPath(secondActivityId, registrationId)));
    assert.ok(!paths.some((value) => value.includes(uid("altro-genitore"))), "niente iscrizioni dell'altro genitore");
    assert.ok(!paths.some((value) => value.endsWith(`user_${uid("adulto")}`)), "niente iscrizioni personali di altri");
  });

  test("collection group con il parentUid di un altro, o senza filtro: negato", async () => {
    await expectDenied(() => listFamilyRegistrations("genitore", uid("altro-genitore")), "parentUid altrui");
    await expectDenied(() => getDocsFromServer(collectionGroup(fs("genitore"), "registrations")), "senza filtro");
    await expectDenied(() => listFamilyRegistrations("nonAutenticato", uid("genitore")), "non autenticato");
  });
});

// ===========================================================================
// 5. Stesse operazioni con un partecipante adulto e un dirigente di unità
// ===========================================================================

const OTHER_ROLES = [
  ["adulto", "un partecipante adulto (role participant)"],
  ["dirigente", "un dirigente di unità (role unit_leader)"],
];

for (const [actor, label] of OTHER_ROLES) {
  describe(`5. ${label}: figli e iscrizioni child_ come il genitore`, () => {
    const parentUid = () => uid(ACTORS[actor].name);
    const NOTE = "consentito: le rules di figli e iscrizioni child_ non guardano il ruolo (vincolo solo del client)";
    let activityId;
    let draft;
    let child;
    let account;

    before(async () => {
      activityId = await seedActivity();
      account = await readParentAccount(actor);
    });

    test("createChild con draft e «Salva» ripetuto con lo stesso createdAt", async (t) => {
      draft = newChildDraft(actor, parentUid());
      child = await createChild(actor, parentUid(), childInput({ firstName: "Nicola", lastName: ACTORS[actor].lastName }), draft);
      await pause(5);
      child = await createChild(actor, parentUid(), childInput({ firstName: "Nicola", lastName: ACTORS[actor].lastName }), draft);
      assert.equal((await stored(childPath(parentUid(), draft.childId))).createdAt, draft.createdAt);
      await expectDenied(
        () => createChild(actor, parentUid(), childInput({ firstName: "Nicola" }), { ...draft, createdAt: nowIso() }),
        "createdAt diverso",
      );
      t.diagnostic(NOTE);
    });

    test("updateChild, listChildren e getChild", async (t) => {
      await updateChild(actor, parentUid(), draft.childId, childInput({ firstName: "Nicola", lastName: ACTORS[actor].lastName, birthDate: "2011-12-01" }));
      child = { ...child, birthDate: "2011-12-01" };
      const list = await listChildren(actor, parentUid());
      assert.ok(list.docs.some((item) => item.id === draft.childId));
      assert.equal((await getChild(actor, parentUid(), draft.childId)).data().birthDate, "2011-12-01");
      t.diagnostic(NOTE);
    });

    test("«Già iscritto»: getDoc dell'iscrizione che non esiste ancora", async (t) => {
      const snapshot = await readChildRegistration(actor, activityId, parentUid(), draft.childId);
      assert.equal(snapshot.exists(), false);
      t.diagnostic(NOTE);
    });

    test("iscrizione del figlio (setDoc) e risalvataggio (updateDoc)", async (t) => {
      const lookup = childLookup(parentUid(), draft.childId);
      const first = await submitChildRegistration(actor, activityId, lookup, editorSubmitInput(child, account));
      assert.equal(first.branch, "setDoc");
      assert.equal(first.saved.registrationStatus, "pending_parent_authorization");
      assert.equal(first.saved.answers.parentAuthorizationRequest.parentFirstName, ACTORS[actor].firstName);
      const second = await upsertRegistration(actor, activityId, lookup, editorSubmitInput(child, account, { phone: "3470000001" }));
      assert.equal(second.branch, "updateDoc");
      assert.equal(second.saved.phone, "3470000001");
      t.diagnostic(NOTE);
    });

    test("Famiglia: collection group parentUid == uid, solo le proprie", async (t) => {
      const snapshot = await listFamilyRegistrations(actor, parentUid());
      assert.ok(snapshot.size >= 1);
      for (const item of snapshot.docs) assert.equal(item.data().parentUid, parentUid());
      t.diagnostic(NOTE);
    });

    test("un altro genitore non legge l'iscrizione né i figli di questo account", async () => {
      await expectDenied(() => readChildRegistration("altroGenitore", activityId, parentUid(), draft.childId), "iscrizione");
      await expectDenied(() => listChildren("altroGenitore", parentUid()), "figli");
    });
  });
}
