// Stato iniziale di un'iscrizione e riattivazione dopo l'annullamento
// (validInitialRegistrationStatus, parentAuthorizationRequired e il ramo di
// riattivazione di validRegistrationUpdate in firestore.rules, 2026-10-19):
// un non-admin crea un'iscrizione solo `pending_parent_authorization` o
// `active`, e `active` non è ammesso per un minorenne in un'attività con
// `requiresParentAuthorization == true`. Da `cancelled` si torna a
// `pending_parent_authorization` sempre, a `active` solo se la firma del
// genitore c'era già o se l'autorizzazione non serve. `confirmed` lo scrive
// solo la callable della firma. Gli admin del palo restano liberi.
//
// Prova anche che validRegistrationCreate "snella" (i 21 campi che alla
// creazione restano vuoti controllati con un solo `diff`) nega e consente
// gli stessi payload di prima, e che il documento massimo sta nel budget
// delle 1000 espressioni (caso peggiore misurato: 837).
//
// Chiamate e payload sono quelli del client, campo per campo:
// - src/services/firestore/registrationsService.ts (upsertRegistration:
//   setDoc alla prima iscrizione, updateDoc coi tredici campi del
//   risalvataggio);
// - src/components/RegistrationEditor.tsx (handleSubmit: richiesta
//   all'autorizzazione solo se l'attività la chiede E il partecipante è
//   minorenne secondo isMinorBirthDate);
// - stato dalle funzioni vere (src/utils/registrationStatus.ts,
//   src/utils/age.ts, src/utils/roomPreferences.ts).
//
// SDK client con utenti normali (token mock dell'emulatore: password per
// genitore, titolare dell'account, dirigente e admin; anonimo per l'ospite);
// l'Admin SDK serve solo per seminare e rileggere, perché ignora le rules.
// Ogni tentativo ha la sua attività e il suo figlio: un rifiuto non lascia
// traccia e il controllo "lo stesso payload con lo stato giusto passa" prova
// che a negare sia davvero il campo o lo stato in esame.
//
// Rilancio dalla radice del repository (solo Firestore, porta 8180):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-initial-status \
//     'node --test --test-concurrency=1 functions/tests/registrationInitialStatusRulesEmulator.test.mjs functions/tests/parentChildFlowRulesEmulator.test.mjs functions/tests/parentCancelRulesEmulator.test.mjs'
// Gli altri due file sono la regressione su figli, iscrizioni child_,
// annullamento e riattivazione. Con le porte occupate da un'altra sessione non
// fermarla: copia la config su porte diverse (Firestore, hub, logging,
// websocket) e rimuovi la copia a fine prova; il test legge l'host da
// FIRESTORE_EMULATOR_HOST. Sul Mac mini il lavoro gira lì (`mini`).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, setDoc, updateDoc } from "firebase/firestore";

import { isMinorBirthDate } from "../../src/utils/age.ts";
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
const stakeId = `stato-iniziale-${runId}`;
const otherStakeId = `altro-palo-${runId}`;
const uid = (name) => `${name}-${runId}`;
const SEEDED_AT = "2026-10-01T08:00:00.000Z";
const SIGNED_AT = "2026-10-02T19:30:00.000Z";
const nowIso = () => new Date().toISOString();
const UNIT = { id: "unita-1", name: "Unità Uno" };
const DAYS = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"];

// Date di nascita: minorenne di 14 anni, maggiorenne senza dubbi.
const MINOR = "2012-05-09";
const ADULT = "1990-06-15";

// ---------------------------------------------------------------------------
// Attori e iscritti
// ---------------------------------------------------------------------------

const ACTORS = {
  genitore: { name: "genitore", provider: "password", profile: { role: "parent", stakeId } },
  titolare: { name: "titolare", provider: "password", profile: { role: "participant", stakeId } },
  ospite: { name: "ospite", provider: "anonymous", profile: null },
  dirigente: { name: "dirigente", provider: "password", profile: { role: "unit_leader", stakeId } },
  admin: { name: "admin-palo", provider: "password", profile: { role: "admin", stakeId } },
  adminAltroPalo: { name: "admin-altro-palo", provider: "password", profile: { role: "admin", stakeId: otherStakeId } },
};
const clients = {};
const fs = (actor) => clients[actor].firestore;
const stored = async (path) => (await adminDb.doc(path).get()).data();

/** I tre modi di iscriversi: l'id del documento e il lookup di upsertRegistration. */
const KINDS = [
  { kind: "figlio", actor: "genitore", label: "iscrizione di un figlio (child_<genitore>_<figlio>)" },
  { kind: "account", actor: "titolare", label: "iscrizione di un account (user_<uid>)" },
  { kind: "ospite", actor: "ospite", label: "iscrizione di un ospite anonimo (guest_<uid>)" },
];
const kindOf = (kind) => KINDS.find((item) => item.kind === kind);

let childCounter = 0;
/** Chi si iscrive: per un figlio crea anche il documento del figlio nell'account del genitore (lo vuole la rule). */
async function newPerson(kindDef, birthDate, actor = kindDef.actor) {
  const ownerUid = uid(ACTORS[actor].name);
  const person = {
    kind: kindDef.kind,
    actor,
    ownerUid,
    birthDate,
    genderRoleCategory: "giovane_uomo",
    firstName: kindDef.kind === "figlio" ? "Marco" : kindDef.kind === "account" ? "Giorgio" : "Ospite",
    lastName: kindDef.kind === "figlio" ? "Rossi" : kindDef.kind === "account" ? "Bianchi" : "Test",
  };
  if (kindDef.kind === "figlio") {
    childCounter += 1;
    const childId = `figlio-${childCounter}`;
    await adminDb.doc(`users/${ownerUid}/children/${childId}`).set({
      firstName: person.firstName,
      lastName: person.lastName,
      fullName: `${person.firstName} ${person.lastName}`,
      birthDate,
      genderRoleCategory: person.genderRoleCategory,
      unitId: UNIT.id,
      unitName: UNIT.name,
      stakeId,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    return {
      ...person,
      lookup: { userId: null, anonymousUid: null, parentUid: ownerUid, childId },
      registrationId: `child_${ownerUid}_${childId}`,
    };
  }
  if (kindDef.kind === "account") {
    return {
      ...person,
      lookup: { userId: ownerUid, anonymousUid: null, parentUid: null, childId: null },
      registrationId: `user_${ownerUid}`,
    };
  }
  return {
    ...person,
    lookup: { userId: null, anonymousUid: ownerUid, parentUid: null, childId: null },
    registrationId: `guest_${ownerUid}`,
  };
}

// ---------------------------------------------------------------------------
// Attività
// ---------------------------------------------------------------------------

let activityCounter = 0;
/**
 * Attività aperta alle iscrizioni. `requires`: true, false, oppure "assente"
 * (documento senza il campo, come le attività create prima della funzione).
 * `allowGuest`: true/false nel modulo, null = nessun documento config/form.
 */
async function seedActivity({ requires = true, allowGuest = true, open = true } = {}) {
  activityCounter += 1;
  const activityId = `attivita-${activityCounter}`;
  const data = {
    title: `Viaggio al tempio ${activityCounter}`,
    activityType: "trip",
    overnight: true,
    status: open ? "registrations_open" : "registrations_closed",
    isPublic: true,
    isVisible: true,
    registrationOpen: "2026-09-01T08:00:00.000Z",
    startDate: "2026-11-13T14:00:00.000Z",
    endDate: "2026-11-17T16:00:00.000Z",
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  };
  if (requires !== "assente") data.requiresParentAuthorization = requires;
  await adminDb.doc(`stakes/${stakeId}/activities/${activityId}`).set(data);
  if (allowGuest !== null) {
    await adminDb.doc(`stakes/${stakeId}/activities/${activityId}/config/form`).set({ allowGuestRegistration: allowGuest });
  }
  return activityId;
}

const registrationPath = (activityId, registrationId) =>
  `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`;
const registrationRef = (actor, activityId, registrationId) =>
  doc(fs(actor), "stakes", stakeId, "activities", activityId, "registrations", registrationId);

/** Rifiuto delle rules: l'operazione si passa come funzione, così non resta una promessa rifiutata senza gestore. */
async function expectDenied(operation, label = "") {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, "permission-denied", `${label} ${error?.code}: ${error?.message}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Payload del client
// ---------------------------------------------------------------------------

/** splitFullName di registrationsService.ts */
function splitFullName(value) {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Input che RegistrationEditor.handleSubmit passa a onSubmit. La richiesta
 * all'autorizzazione del genitore c'è solo se l'attività la chiede E il
 * partecipante è minorenne (eventRequiresParentAuthorization, con la vera
 * isMinorBirthDate); per un'iscrizione nuova lo stato richiesto è
 * pending_parent_authorization in quel caso, active negli altri
 * (nextRegistrationStatus).
 */
function editorInput(person, { requiresAuth = true, answerCount = 12, birthDate = person.birthDate } = {}) {
  const needsParent = requiresAuth && isMinorBirthDate(birthDate);
  const answers = {
    birthDate,
    genderRoleCategory: person.genderRoleCategory,
    youthGroup: "Giovani Uomini",
    unitName: UNIT.name,
    phone: "3471234567",
    city: "Roma",
    transportMode: "Pullman del palo",
    roomPreference1Name: getRoomPreferenceTextFromAnswers({ roomPreference1Name: "  Luca   Bianchi " }, "roomPreference1Name"),
    roomPreference2Name: "Giovanni Verdi",
    roomNotes: "Preferisce il letto in basso, si sveglia presto.",
    allergies: "Graminacee, acari, nichel",
    photoInternalConsent: true,
  };
  for (let index = 1; index <= answerCount; index += 1) {
    const key = `domanda_${String(index).padStart(2, "0")}`;
    answers[key] =
      index % 5 === 0
        ? index
        : index % 4 === 0
          ? null
          : index % 3 === 0
            ? index % 2 === 0
            : index % 2 === 0
              ? [`scelta ${index}a`, `scelta ${index}b`]
              : `Risposta libera alla domanda ${index}: ${"dettaglio ".repeat(8).trim()}`;
  }
  if (needsParent) {
    answers.parentAuthorizationRequest = {
      parentFirstName: "Paola",
      parentLastName: "Rossi",
      parentEmail: "genitore@example.invalid",
      parentPhone: "3331234567",
      emergencyContactName: "Anna Rossi",
      emergencyContactPhone: "3409876543",
      emergencyContactRelation: "nonna",
      allergies: "Graminacee, acari, nichel",
      medications: "Salbutamolo spray al bisogno.",
      medicalNotes: "Asma da sforzo, porta sempre lo spray.",
      dietaryNotes: "Niente frutta a guscio.",
      submittedAt: nowIso(),
    };
  }
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    fullName: `${person.firstName} ${person.lastName}`,
    email: person.kind === "figlio" ? "" : `${person.actor}@example.invalid`,
    phone: "3471234567",
    birthDate,
    genderRoleCategory: person.genderRoleCategory,
    unitName: UNIT.name,
    answers,
    registrationStatus: needsParent ? "pending_parent_authorization" : "active",
    status: "active",
    participatingDays: DAYS.slice(0, 3),
  };
}

/** registrationPayload di upsertRegistration (setDoc alla prima iscrizione, `existing` = null). */
function buildRegistrationPayload(person, input, existing, timestamp) {
  const { lookup } = person;
  const fullName = input.fullName.trim();
  const names = splitFullName(fullName);
  const recoveryCode = existing?.recoveryCode ?? (lookup.anonymousUid ? "REC-ABCD-1234" : null);
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
    unitId: UNIT.id,
    unitNameSnapshot: UNIT.name,
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

/** Payload di partenza di una prima iscrizione, come lo scrive il client. */
const baselinePayload = (person, options) => buildRegistrationPayload(person, editorInput(person, options), null, nowIso());

/** Scrittura della prima iscrizione. */
const createRegistration = (person, activityId, payload) =>
  setDoc(registrationRef(person.actor, activityId, person.registrationId), payload);

/**
 * `rejected` è negato e non lascia traccia; poi `accepted` (stesso iscritto,
 * stessa attività) passa: a negare era davvero la differenza fra i due.
 */
async function expectDeniedThenAccepted(person, activityId, rejected, accepted, label) {
  const path = registrationPath(activityId, person.registrationId);
  await expectDenied(() => createRegistration(person, activityId, rejected), label);
  assert.equal(await stored(path), undefined, `${label}: un rifiuto non lascia documenti`);
  await createRegistration(person, activityId, accepted);
  assert.equal((await stored(path)).registrationStatus, accepted.registrationStatus, `${label}: il controllo è stato scritto`);
}

/** Creazione consentita: il documento c'è con lo stato scritto. */
async function expectCreated(person, activityId, payload, label = "") {
  await createRegistration(person, activityId, payload);
  const data = await stored(registrationPath(activityId, person.registrationId));
  assert.ok(data, `${label}: documento creato`);
  assert.equal(data.registrationStatus, payload.registrationStatus, label);
  return data;
}

/** Il client prima legge la propria iscrizione e poi scrive: setDoc se non c'è, updateDoc coi campi del risalvataggio. */
async function clientUpsert(person, activityId, input) {
  const reference = registrationRef(person.actor, activityId, person.registrationId);
  const snapshot = await getDocFromServer(reference);
  const existing = snapshot.exists() ? snapshot.data() : null;
  const payload = buildRegistrationPayload(person, input, existing, nowIso());
  if (snapshot.exists()) {
    await updateDoc(reference, resaveFields(payload));
  } else {
    await setDoc(reference, payload);
  }
  return { branch: snapshot.exists() ? "updateDoc" : "setDoc", payload, saved: (await getDocFromServer(reference)).data() };
}

/** I campi del ramo updateDoc di upsertRegistration. */
const resaveFields = (payload) => ({
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

/** Preferenze stanza abbinate (scrittura dell'admin). */
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
  roomPreference3Name: {
    key: "roomPreference3Name",
    rawValue: "Paolo Neri",
    normalizedValue: "paolo neri",
    matchedRegistrationId: "child_x_figlio-9",
    matchedFullName: "Paolo Neri",
    matchedCategory: "giovane_uomo",
    score: 0.9,
    status: "matched",
    updatedAt: SEEDED_AT,
  },
});

// ---------------------------------------------------------------------------
// Date: bordi dei 18 anni, calcolati da oggi in UTC
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const startOfTodayUtc = () => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Data di nascita di chi compie 18 anni fra `offsetDays` giorni (0 = oggi, in UTC). */
function birthDateTurning18In(offsetDays) {
  const target = new Date(startOfTodayUtc() + offsetDays * DAY_MS);
  return isoDate(Date.UTC(target.getUTCFullYear() - 18, target.getUTCMonth(), target.getUTCDate()));
}

/** Giorni da oggi (UTC) al 18° compleanno di quella data di nascita. */
function daysUntil18(birthDate) {
  const [year, month, day] = birthDate.split("-").map(Number);
  return Math.round((Date.UTC(year + 18, month - 1, day) - startOfTodayUtc()) / DAY_MS);
}

/** Giorni in meno di 18 anni che la rule conta (6573): 1 se nei 18 anni cadono 4 bisestili, 2 se 5. */
function ruleMarginDays(birthDate) {
  const [year, month, day] = birthDate.split("-").map(Number);
  const span = Math.round((Date.UTC(year + 18, month - 1, day) - Date.UTC(year, month - 1, day)) / DAY_MS);
  return span - 6573;
}

/** Come la rule: minorenne se data di nascita + 6573 giorni è ancora nel futuro. */
const minorByRule = (birthDate) => Date.parse(`${birthDate}T00:00:00Z`) + 6573 * DAY_MS > Date.now();

/**
 * La rule tratta come minorenne chi compie 18 anni fra 3 giorni o più e come
 * maggiorenne chi li compie entro domani; fra 2 giorni dipende dai bisestili.
 */
function deniedAsMinor(birthDate) {
  const days = daysUntil18(birthDate);
  return days >= 3 ? true : days <= 1 ? false : minorByRule(birthDate);
}

// ---------------------------------------------------------------------------
// Campi che alla creazione devono restare vuoti
// ---------------------------------------------------------------------------

// [campo, valore valorizzato (valido per il payload), valore vuoto ma non null (o null se non c'è)]
const PROTECTED_FIELDS = [
  ["parentConsentDocumentName", "modulo-consenso.pdf", ""],
  ["parentConsentDocumentUrl", "https://storage.example.invalid/consenso.pdf", ""],
  ["parentConsentDocumentPath", "parentAuthorizations/s/act/r/consenso.pdf", ""],
  ["parentConsentUploadedAt", SIGNED_AT, ""],
  ["consentSignatureUrl", "https://storage.example.invalid/firma.png", ""],
  ["consentSignaturePath", "parentAuthorizations/s/act/r/signature.png", ""],
  ["consentSignatureSetAt", SIGNED_AT, ""],
  ["parentIdDocumentName", "documento.pdf", ""],
  ["parentIdDocumentUrl", "https://storage.example.invalid/documento.pdf", ""],
  ["parentIdDocumentPath", "parentAuthorizations/s/act/r/documento.pdf", ""],
  ["parentIdUploadedAt", SIGNED_AT, ""],
  ["parentAuthorization", { status: "authorized", authorizedAt: SIGNED_AT }, {}],
  ["assignedRoomId", "stanza-12", ""],
  ["assignedRoomName", "Stanza 12", ""],
  ["assignedTempleShiftId", "turno-tempio-3", ""],
  ["assignedServiceTeamIds", ["squadra-cucina"], null],
  ["assignedPatrolId", "pattuglia-aquile", ""],
  ["assignedPatrolName", "Aquile", ""],
  ["assignedPatrolRole", "member", null],
  ["assignedCommittees", ["cucina"], null],
  ["linkedLaterToUserId", "utente-collegato", ""],
];
assert.equal(PROTECTED_FIELDS.length, 21, "i campi protetti sono 21");
// Campi che il payload può non avere affatto (letti con `in` o get(): validRegistrationPayload).
const OPTIONAL_PROTECTED = ["parentAuthorization", "assignedRoomName", "assignedCommittees"];
const withoutKey = (payload, field) => Object.fromEntries(Object.entries(payload).filter(([key]) => key !== field));

// ---------------------------------------------------------------------------
// Stati
// ---------------------------------------------------------------------------

// Stati che un non-admin non scrive mai in creazione.
const FORBIDDEN_INITIAL_STATUSES = [
  "confirmed",
  "cancelled",
  "draft",
  "submitted",
  "waitlist",
  "rejected_by_parent",
];

// ---------------------------------------------------------------------------
// Semina
// ---------------------------------------------------------------------------

before(async () => {
  await adminDb.doc(`stakes/${stakeId}`).set({ name: "Palo di prova", createdAt: SEEDED_AT, updatedAt: SEEDED_AT });
  await adminDb.doc(`stakes/${stakeId}/units/${UNIT.id}`).set({
    name: UNIT.name,
    type: "ward",
    isActive: true,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  const writes = [];
  for (const actor of Object.values(ACTORS)) {
    if (!actor.profile) continue;
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
        mustChangePassword: false,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
        lastLoginAt: SEEDED_AT,
        ...actor.profile,
      }),
    );
  }
  await Promise.all(writes);

  for (const [actor, data] of Object.entries(ACTORS)) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actor}-${runId}`);
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), {
      mockUserToken: {
        sub: uid(data.name),
        email: `${data.name}-${runId}@example.invalid`,
        email_verified: data.provider !== "anonymous",
        firebase: { sign_in_provider: data.provider },
      },
    });
    clients[actor] = { app, firestore };
  }
});

after(async () => {
  try {
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
    for (const actor of Object.values(ACTORS)) {
      await adminDb.recursiveDelete(adminDb.doc(`users/${uid(actor.name)}`));
    }
  } finally {
    await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// 1. Creazione in un'attività che chiede l'autorizzazione del genitore
// ===========================================================================

for (const kindDef of KINDS) {
  describe(`1. creazione, attività con requiresParentAuthorization: ${kindDef.label}`, () => {
    test("minorenne: pending_parent_authorization consentito", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      const payload = baselinePayload(person);
      assert.equal(payload.registrationStatus, "pending_parent_authorization");
      assert.ok(payload.answers.parentAuthorizationRequest, "il modulo ha raccolto i dati del genitore");
      await expectCreated(person, activityId, payload);
    });

    test("minorenne: active negato (si salterebbe il consenso)", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      const accepted = baselinePayload(person);
      await expectDeniedThenAccepted(person, activityId, { ...accepted, registrationStatus: "active" }, accepted, "active");
    });

    test("minorenne: active negato anche senza i dati del genitore nelle risposte", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      const accepted = baselinePayload(person);
      const { parentAuthorizationRequest: _request, ...answers } = accepted.answers;
      await expectDeniedThenAccepted(
        person,
        activityId,
        { ...accepted, answers, registrationStatus: "active" },
        accepted,
        "active senza parentAuthorizationRequest",
      );
    });

    test("minorenne: confermata e ogni altro stato negati", async () => {
      for (const status of FORBIDDEN_INITIAL_STATUSES) {
        const person = await newPerson(kindDef, MINOR);
        const activityId = await seedActivity();
        const accepted = baselinePayload(person);
        await expectDeniedThenAccepted(person, activityId, { ...accepted, registrationStatus: status }, accepted, status);
      }
    });

    test("maggiorenne: active consentito", async () => {
      const person = await newPerson(kindDef, ADULT);
      const activityId = await seedActivity();
      const payload = baselinePayload(person);
      assert.equal(payload.registrationStatus, "active");
      assert.ok(!("parentAuthorizationRequest" in payload.answers), "nessuna richiesta al genitore per un adulto");
      await expectCreated(person, activityId, payload);
    });

    test("maggiorenne: pending_parent_authorization consentito (la rule ammette i due stati iniziali)", async () => {
      const person = await newPerson(kindDef, ADULT);
      const activityId = await seedActivity();
      await expectCreated(person, activityId, { ...baselinePayload(person), registrationStatus: "pending_parent_authorization" });
    });

    test("maggiorenne: confirmed, cancelled, draft, submitted, waitlist, rejected_by_parent negati", async () => {
      for (const status of FORBIDDEN_INITIAL_STATUSES) {
        const person = await newPerson(kindDef, ADULT);
        const activityId = await seedActivity();
        const accepted = baselinePayload(person);
        await expectDeniedThenAccepted(person, activityId, { ...accepted, registrationStatus: status }, accepted, status);
      }
    });

    test("stato fuori elenco o non stringa: negato", async () => {
      for (const status of ["pending", "ACTIVE", "", null, 1, ["active"]]) {
        const person = await newPerson(kindDef, ADULT);
        const activityId = await seedActivity();
        const accepted = baselinePayload(person);
        await expectDeniedThenAccepted(
          person,
          activityId,
          { ...accepted, registrationStatus: status },
          accepted,
          `stato ${JSON.stringify(status)}`,
        );
      }
    });
  });
}

// ===========================================================================
// 2. Attività che non chiede l'autorizzazione (false o campo assente)
// ===========================================================================

for (const kindDef of KINDS) {
  describe(`2. creazione, attività senza autorizzazione del genitore: ${kindDef.label}`, () => {
    for (const requires of [false, "assente"]) {
      const activityLabel = requires === false ? "requiresParentAuthorization: false" : "senza il campo requiresParentAuthorization";

      test(`${activityLabel}: minorenne active consentito`, async () => {
        const person = await newPerson(kindDef, MINOR);
        const activityId = await seedActivity({ requires });
        // Il modulo non raccoglie i dati del genitore e chiede active.
        const payload = baselinePayload(person, { requiresAuth: false });
        assert.equal(payload.registrationStatus, "active");
        assert.ok(!("parentAuthorizationRequest" in payload.answers));
        await expectCreated(person, activityId, payload);
      });

      test(`${activityLabel}: minorenne pending_parent_authorization consentito`, async () => {
        const person = await newPerson(kindDef, MINOR);
        const activityId = await seedActivity({ requires });
        await expectCreated(person, activityId, { ...baselinePayload(person), registrationStatus: "pending_parent_authorization" });
      });

      test(`${activityLabel}: confirmed e gli altri stati restano negati`, async () => {
        for (const status of FORBIDDEN_INITIAL_STATUSES) {
          const person = await newPerson(kindDef, MINOR);
          const activityId = await seedActivity({ requires });
          const accepted = baselinePayload(person, { requiresAuth: false });
          await expectDeniedThenAccepted(person, activityId, { ...accepted, registrationStatus: status }, accepted, status);
        }
      });
    }

    test("attività con iscrizioni chiuse: negato anche per un adulto in stato active", async () => {
      const person = await newPerson(kindDef, ADULT);
      const activityId = await seedActivity({ open: false });
      await expectDenied(() => createRegistration(person, activityId, baselinePayload(person)), "iscrizioni chiuse");
    });
  });
}

describe("2b. ospite anonimo: serve allowGuestRegistration", () => {
  test("modulo senza allowGuestRegistration: negato, anche in attesa", async () => {
    const person = await newPerson(kindOf("ospite"), MINOR);
    for (const allowGuest of [false, null]) {
      const activityId = await seedActivity({ allowGuest });
      await expectDenied(() => createRegistration(person, activityId, baselinePayload(person)), `allowGuest ${allowGuest}`);
      assert.equal(await stored(registrationPath(activityId, person.registrationId)), undefined);
    }
  });
});

// ===========================================================================
// 3. Bordi dell'età (calcolati da oggi in UTC)
// ===========================================================================

// La rule conta 6573 giorni da data di nascita: 1 o 2 giorni meno di 18 anni
// (4 o 5 bisestili nel periodo), così chi compie 18 anni oggi in Italia non
// viene rifiutato mentre in UTC è ancora ieri. Fermi: 18 anni compiuti ieri, oggi
// e domani sono maggiorenni per la rule; fra 3 giorni o più minorenni. Fra 2
// giorni dipende dai bisestili: il titolo dice quale dei due.
const AGE_EDGES = [
  ["compiuti ieri", -1],
  ["compiuti oggi", 0],
  ["compiuti domani", 1],
  ["compiuti fra 2 giorni", 2],
  ["compiuti fra 3 giorni", 3],
  ["compiuti fra una settimana", 7],
];

for (const kindDef of KINDS) {
  describe(`3. bordi dell'età, attività con autorizzazione: ${kindDef.label}`, () => {
    for (const [label, offset] of AGE_EDGES) {
      const birthDate = birthDateTurning18In(offset);
      const days = daysUntil18(birthDate);
      const denied = deniedAsMinor(birthDate);
      const note = days === 2 ? ` (4 o 5 bisestili nei 18 anni: margine di ${ruleMarginDays(birthDate)} giorni)` : "";

      test(`18 anni ${label} (${birthDate}): active ${denied ? "negato" : "consentito"}${note}`, async () => {
        const person = await newPerson(kindDef, birthDate);
        const activityId = await seedActivity();
        const active = { ...baselinePayload(person, { requiresAuth: false }), registrationStatus: "active" };
        assert.equal(active.birthDate, birthDate);
        if (denied) {
          const pending = { ...baselinePayload(person), registrationStatus: "pending_parent_authorization" };
          await expectDeniedThenAccepted(person, activityId, active, pending, label);
        } else {
          await expectCreated(person, activityId, active, label);
        }
      });
    }

    test("un minorenne evidente (14 anni): active negato", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      const pending = baselinePayload(person);
      await expectDeniedThenAccepted(person, activityId, { ...pending, registrationStatus: "active" }, pending, "14 anni");
    });

    test("un minorenne a 17 anni e 11 mesi (18 anni fra 30 giorni): active negato", async () => {
      const birthDate = birthDateTurning18In(30);
      assert.ok(daysUntil18(birthDate) >= 29, `${birthDate} compie 18 anni fra circa 30 giorni`);
      const person = await newPerson(kindDef, birthDate);
      const activityId = await seedActivity();
      const pending = { ...baselinePayload(person), registrationStatus: "pending_parent_authorization" };
      const active = { ...baselinePayload(person, { requiresAuth: false }), registrationStatus: "active" };
      await expectDeniedThenAccepted(person, activityId, active, pending, "18 anni fra 30 giorni");
    });

    test("birthDate vuota: maggiorenne per la rule, active consentito (il client non chiede l'autorizzazione)", async () => {
      const person = await newPerson(kindDef, "");
      const activityId = await seedActivity();
      const payload = baselinePayload(person);
      assert.equal(payload.birthDate, "");
      assert.equal(payload.registrationStatus, "active");
      await expectCreated(person, activityId, payload);
    });

    for (const malformed of ["9 maggio 2012", "2012-5-9", "2012/05/09", "09-05-2012", "2012-05-09T00:00:00Z"]) {
      test(`birthDate non nel formato YYYY-MM-DD («${malformed}»): maggiorenne per la rule, active consentito`, async () => {
        const person = await newPerson(kindDef, malformed);
        const activityId = await seedActivity();
        const payload = { ...baselinePayload(person, { requiresAuth: false }), registrationStatus: "active" };
        assert.equal(payload.birthDate, malformed);
        await expectCreated(person, activityId, payload);
      });
    }

    test("birthDate non stringa: negata dal payload (non arriva alla rule dell'età)", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      const accepted = baselinePayload(person);
      await expectDeniedThenAccepted(person, activityId, { ...accepted, birthDate: null }, accepted, "birthDate null");
    });
  });
}

describe("3b. osservazione: date che passano la forma ma non il calendario", () => {
  test("2013-02-30 e 2012-13-45: esito registrato (la rule non le tratta come maggiorenni)", async (t) => {
    const kindDef = kindOf("account");
    for (const birthDate of ["2013-02-30", "2012-13-45", "0000-00-00"]) {
      const person = await newPerson(kindDef, birthDate);
      const activityId = await seedActivity();
      const payload = { ...baselinePayload(person, { requiresAuth: false }), registrationStatus: "active" };
      let outcome;
      try {
        await createRegistration(person, activityId, payload);
        outcome = "consentito";
      } catch (error) {
        outcome = `negato (${error?.code})`;
      }
      t.diagnostic(`birthDate «${birthDate}», active, attività con autorizzazione: ${outcome}`);
    }
  });
});

// ===========================================================================
// 4. I 21 campi che alla creazione restano vuoti
// ===========================================================================

for (const kindDef of KINDS) {
  describe(`4. campi protetti in creazione: ${kindDef.label}`, () => {
    test("il payload di partenza passa (controllo)", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      const payload = baselinePayload(person);
      for (const [field] of PROTECTED_FIELDS) {
        if (!OPTIONAL_PROTECTED.includes(field)) assert.ok(field in payload, `${field} presente nel payload del client`);
      }
      await expectCreated(person, activityId, payload);
    });

    for (const [field, value] of PROTECTED_FIELDS) {
      test(`${field} valorizzato: negato`, async () => {
        const person = await newPerson(kindDef, MINOR);
        const activityId = await seedActivity();
        const accepted = baselinePayload(person);
        await expectDeniedThenAccepted(person, activityId, { ...accepted, [field]: value }, accepted, field);
      });
    }

    test("campi stringa o mappa vuoti ma non null (\"\" e {}): negati", async () => {
      for (const [field, , empty] of PROTECTED_FIELDS) {
        if (empty === null) continue;
        const person = await newPerson(kindDef, MINOR);
        const activityId = await seedActivity();
        const accepted = baselinePayload(person);
        await expectDeniedThenAccepted(person, activityId, { ...accepted, [field]: empty }, accepted, `${field} = ${JSON.stringify(empty)}`);
      }
    });

    test("tutti i 21 campi valorizzati insieme: negato", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      const accepted = baselinePayload(person);
      const everything = { ...accepted, ...Object.fromEntries(PROTECTED_FIELDS.map(([field, value]) => [field, value])) };
      await expectDeniedThenAccepted(person, activityId, everything, accepted, "tutti i campi protetti");
    });

    test("assignedServiceTeamIds e assignedCommittees vuoti ([]): consentiti, sono il valore di partenza", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      const payload = baselinePayload(person);
      assert.deepEqual(payload.assignedServiceTeamIds, []);
      assert.deepEqual(payload.assignedCommittees, []);
      await expectCreated(person, activityId, payload);
    });

    test("i tre campi opzionali assenti insieme: consentito", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      let payload = baselinePayload(person);
      for (const field of OPTIONAL_PROTECTED) payload = withoutKey(payload, field);
      for (const field of OPTIONAL_PROTECTED) assert.ok(!(field in payload));
      await expectCreated(person, activityId, payload);
    });

    for (const field of OPTIONAL_PROTECTED) {
      test(`${field} assente da solo: consentito`, async () => {
        const person = await newPerson(kindDef, MINOR);
        const activityId = await seedActivity();
        const payload = withoutKey(baselinePayload(person), field);
        assert.ok(!(field in payload));
        await expectCreated(person, activityId, payload);
      });
    }

    for (const [field] of PROTECTED_FIELDS) {
      if (OPTIONAL_PROTECTED.includes(field)) continue;
      test(`${field} assente: negato (campo obbligatorio)`, async () => {
        const person = await newPerson(kindDef, MINOR);
        const activityId = await seedActivity();
        const accepted = baselinePayload(person);
        await expectDeniedThenAccepted(person, activityId, withoutKey(accepted, field), accepted, `${field} assente`);
      });
    }
  });
}

// ===========================================================================
// 5. Documento massimo: il budget delle 1000 espressioni
// ===========================================================================

/** Ogni campo ammesso valorizzato (tranne i 21 che alla creazione restano vuoti): il caso peggiore di costo. */
function maximalPayload(person, { birthDate, status }) {
  const input = editorInput(person, { requiresAuth: true, answerCount: 56, birthDate });
  input.answers.parentAuthorizationRequest = {
    parentFirstName: "Paola",
    parentLastName: "Rossi",
    parentEmail: "genitore@example.invalid",
    parentPhone: "3331234567",
    emergencyContactName: "Anna Rossi",
    emergencyContactPhone: "3409876543",
    emergencyContactRelation: "nonna",
    allergies: "Graminacee, acari, nichel",
    medications: "Salbutamolo spray al bisogno; cetirizina 10 mg la sera da aprile a giugno.",
    medicalNotes: "Asma da sforzo diagnosticata nel 2019, seguita dal pediatra. ".repeat(6),
    dietaryNotes: "Niente frutta a guscio; latte senza lattosio a colazione.",
    submittedAt: nowIso(),
  };
  return {
    ...buildRegistrationPayload(person, input, null, nowIso()),
    anonymousTokenId: "token-anonimo-1",
    roomPreferenceMatches: roomMatches(),
    participatingDays: DAYS,
    accessCode: "ACC-1234",
    recoveryCode: "REC-5678",
    recoveryPdfGenerated: true,
    registrationStatus: status,
  };
}

for (const kindDef of KINDS) {
  describe(`5. documento massimo in creazione: ${kindDef.label}`, () => {
    test("minorenne in attesa: nel budget", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      const payload = maximalPayload(person, { birthDate: MINOR, status: "pending_parent_authorization" });
      assert.ok(Object.keys(payload.answers).length >= 55, `risposte (${Object.keys(payload.answers).length})`);
      assert.ok(payload.answers.parentAuthorizationRequest);
      assert.equal(Object.keys(payload.roomPreferenceMatches).length, 3);
      assert.equal(payload.participatingDays.length, 5);
      assert.ok(payload.accessCode && payload.recoveryCode && payload.anonymousTokenId);
      await expectCreated(person, activityId, payload);
    });

    // active su un'attività che chiede l'autorizzazione obbliga la rule a leggere
    // l'attività e a calcolare l'età: il percorso più costoso che passa.
    test("maggiorenne attivo, attività con autorizzazione (lettura dell'attività e calcolo dell'età): nel budget", async () => {
      const person = await newPerson(kindDef, ADULT);
      const activityId = await seedActivity();
      const payload = maximalPayload(person, { birthDate: ADULT, status: "active" });
      assert.ok(Object.keys(payload.answers).length >= 55);
      await expectCreated(person, activityId, payload);
    });

    test("minorenne attivo in un'attività senza autorizzazione: nel budget", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity({ requires: false });
      await expectCreated(person, activityId, maximalPayload(person, { birthDate: MINOR, status: "active" }));
    });
  });
}

// ===========================================================================
// 6. Il percorso vero del client (handleSubmit → upsertRegistration)
// ===========================================================================

for (const kindDef of KINDS) {
  describe(`6. percorso del client: ${kindDef.label}`, () => {
    test("minorenne: lo stato richiesto non conta, resolveRegistrationStatusOnSave porta in attesa e la rule consente", async () => {
      for (const requested of ["active", "pending_parent_authorization"]) {
        const person = await newPerson(kindDef, MINOR);
        const activityId = await seedActivity();
        const input = { ...editorInput(person), registrationStatus: requested };
        assert.ok(input.answers.parentAuthorizationRequest);
        const result = await clientUpsert(person, activityId, input);
        assert.equal(result.branch, "setDoc");
        assert.equal(result.payload.registrationStatus, "pending_parent_authorization", `richiesto ${requested}`);
        assert.equal(result.saved.registrationStatus, "pending_parent_authorization");
      }
    });

    test("maggiorenne: active, e il risalvataggio (updateDoc) lo conserva", async () => {
      const person = await newPerson(kindDef, ADULT);
      const activityId = await seedActivity();
      const first = await clientUpsert(person, activityId, editorInput(person));
      assert.equal(first.branch, "setDoc");
      assert.equal(first.saved.registrationStatus, "active");
      const second = await clientUpsert(person, activityId, { ...editorInput(person), phone: "3470000001" });
      assert.equal(second.branch, "updateDoc");
      assert.equal(second.saved.registrationStatus, "active");
      assert.equal(second.saved.phone, "3470000001");
    });

    test("minorenne in attesa: il risalvataggio (updateDoc) resta in attesa", async () => {
      const person = await newPerson(kindDef, MINOR);
      const activityId = await seedActivity();
      await clientUpsert(person, activityId, editorInput(person));
      const second = await clientUpsert(person, activityId, { ...editorInput(person), phone: "3470000002" });
      assert.equal(second.branch, "updateDoc");
      assert.equal(second.saved.registrationStatus, "pending_parent_authorization");
    });

    test("minorenne in un'attività senza autorizzazione: il modulo non chiede il genitore, active consentito", async () => {
      for (const requires of [false, "assente"]) {
        const person = await newPerson(kindDef, MINOR);
        const activityId = await seedActivity({ requires });
        const input = editorInput(person, { requiresAuth: false });
        assert.ok(!input.answers.parentAuthorizationRequest);
        const result = await clientUpsert(person, activityId, input);
        assert.equal(result.saved.registrationStatus, "active", `requires ${requires}`);
      }
    });

    test("intorno ai 18 anni (da 4 giorni fa a fra 4 giorni): qualunque stato scelga il client, la rule lo accetta", async (t) => {
      const outcomes = [];
      for (let offset = -4; offset <= 4; offset += 1) {
        const birthDate = birthDateTurning18In(offset);
        const person = await newPerson(kindDef, birthDate);
        const activityId = await seedActivity();
        // Il client conta l'età sulla data locale con isMinorBirthDate, la rule su UTC con il margine.
        const input = editorInput(person, { requiresAuth: true, birthDate });
        const result = await clientUpsert(person, activityId, input);
        outcomes.push(`${birthDate}→${result.saved.registrationStatus === "active" ? "active" : "attesa"}`);
      }
      t.diagnostic(`stati scelti dal client (fuso del processo): ${outcomes.join(", ")}`);
    });
  });
}

// ===========================================================================
// 7. Riattivazione dopo l'annullamento (updateDoc coi campi di upsertRegistration)
// ===========================================================================

/** Stato di parentAuthorization di un'iscrizione annullata: null, o il documento nello stato dato. */
function authorizationOf(status, registrationId) {
  if (status === null) return null;
  const base = `parentAuthorizations/${stakeId}/act/${registrationId}`;
  const state = {
    status,
    tokenId: "token-mail",
    selfTokenIssuedAt: null,
    parentFirstName: "Paola",
    parentLastName: "Rossi",
    parentEmail: "genitore@example.invalid",
    parentPhone: "3331234567",
    emergencyContactName: "Anna Rossi",
    emergencyContactPhone: "3409876543",
    emergencyContactRelation: "nonna",
    allergies: "Graminacee",
    medications: "Salbutamolo",
    medicalNotes: "Asma da sforzo",
    dietaryNotes: "",
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
  if (status !== "authorized") return state;
  return {
    ...state,
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
}

/**
 * Iscrizione annullata "pesante": molte risposte, preferenze stanza, stanza
 * pubblicata, pattuglia, comitati e, se firmata, consenso e firma agganciati.
 */
function cancelledRegistration(person, { authorizationStatus, requiresAuth }) {
  const input = editorInput(person, { requiresAuth, answerCount: 56 });
  const base = buildRegistrationPayload(person, input, null, SEEDED_AT);
  const folder = `parentAuthorizations/${stakeId}/act/${person.registrationId}`;
  const signed = authorizationStatus === "authorized";
  return {
    ...base,
    registrationStatus: "cancelled",
    parentAuthorization: authorizationOf(authorizationStatus, person.registrationId),
    ...(signed
      ? {
          parentConsentDocumentName: `modulo-consenso-${person.registrationId}.pdf`,
          parentConsentDocumentPath: `${folder}/consenso.pdf`,
          parentConsentUploadedAt: SIGNED_AT,
          consentSignaturePath: `${folder}/signature.png`,
          consentSignatureSetAt: SIGNED_AT,
        }
      : {}),
    roomPreferenceMatches: roomMatches(),
    participatingDays: DAYS,
    assignedRoomId: "stanza-12",
    assignedRoomName: "Stanza 12",
    assignedPatrolId: "pattuglia-aquile",
    assignedPatrolName: "Aquile",
    assignedPatrolRole: "member",
    assignedCommittees: ["cucina", "pulizie"],
    updatedAt: signed ? SIGNED_AT : SEEDED_AT,
  };
}

/**
 * Semina un'iscrizione annullata. `authorizationStatus`: null o uno stato di
 * parentAuthorization; `requires`: come seedActivity. Il modulo che la
 * riattiva è lo stesso, riaperto da chi l'ha annullata.
 */
async function seedCancelled(
  kindDef,
  { birthDate = MINOR, authorizationStatus = "email_sent", requires = true, status = "cancelled", actor } = {},
) {
  const person = await newPerson(kindDef, birthDate, actor);
  const activityId = await seedActivity({ requires });
  const requiresAuth = requires === true;
  const path = registrationPath(activityId, person.registrationId);
  await adminDb.doc(path).set({ ...cancelledRegistration(person, { authorizationStatus, requiresAuth }), registrationStatus: status });
  const current = await stored(path);
  const input = editorInput(person, { requiresAuth, answerCount: 56 });
  return { person, activityId, path, current, input };
}

/** updateDoc coi campi di upsertRegistration; senza `status` vale quello del client (resolveRegistrationStatusOnSave). */
async function reactivate(ctx, status, changes = {}) {
  const payload = buildRegistrationPayload(ctx.person, { ...ctx.input, ...changes }, ctx.current, nowIso());
  const sent = status ?? payload.registrationStatus;
  await updateDoc(registrationRef(ctx.person.actor, ctx.activityId, ctx.person.registrationId), {
    ...resaveFields(payload),
    registrationStatus: sent,
  });
  return sent;
}

/** Stato che il client manderebbe senza toccare nulla. */
const clientStatus = (ctx) =>
  buildRegistrationPayload(ctx.person, ctx.input, ctx.current, nowIso()).registrationStatus;

async function expectReactivationDenied(ctx, status, label) {
  await expectDenied(() => reactivate(ctx, status), label);
  assert.deepEqual(await stored(ctx.path), ctx.current, `${label}: un rifiuto non cambia il documento`);
}

async function expectReactivated(ctx, status, label = "") {
  const sent = await reactivate(ctx, status);
  const after = await stored(ctx.path);
  assert.equal(after.registrationStatus, sent, label);
  assert.deepEqual(after.parentAuthorization, ctx.current.parentAuthorization, `${label}: parentAuthorization intatto`);
  assert.equal(after.assignedRoomName, "Stanza 12");
  assert.deepEqual(after.assignedCommittees, ["cucina", "pulizie"]);
  return after;
}

// Stati di parentAuthorization che non sono una firma.
const NOT_SIGNED_STATUSES = ["email_sent", "expired", "revoked", "rejected_by_parent", "email_error", "pending_request"];
const OTHER_STATUSES_FROM_CANCELLED = ["draft", "submitted", "waitlist", "rejected_by_parent"];

for (const kindDef of KINDS) {
  describe(`7. riattivazione: ${kindDef.label}`, () => {
    test("minorenne, mail al genitore partita (email_sent): active negato, pending_parent_authorization consentito", async () => {
      const ctx = await seedCancelled(kindDef, { authorizationStatus: "email_sent" });
      assert.equal(clientStatus(ctx), "pending_parent_authorization", "il client riparte dal genitore");
      await expectReactivationDenied(ctx, "active", "active");
      await expectReactivationDenied(ctx, "confirmed", "confirmed");
      for (const status of OTHER_STATUSES_FROM_CANCELLED) await expectReactivationDenied(ctx, status, status);
      await expectReactivated(ctx, "pending_parent_authorization");
    });

    test("minorenne, mai partita la mail (parentAuthorization null): active negato, pending_parent_authorization consentito", async () => {
      const ctx = await seedCancelled(kindDef, { authorizationStatus: null });
      assert.equal(ctx.current.parentAuthorization, null);
      assert.equal(clientStatus(ctx), "pending_parent_authorization");
      await expectReactivationDenied(ctx, "active", "active");
      await expectReactivationDenied(ctx, "confirmed", "confirmed");
      await expectReactivated(ctx, "pending_parent_authorization");
    });

    test("minorenne, il client riattiva: la scrittura con lo stato scelto da resolveRegistrationStatusOnSave passa", async () => {
      for (const authorizationStatus of [null, "email_sent"]) {
        const ctx = await seedCancelled(kindDef, { authorizationStatus });
        const after = await expectReactivated(ctx, undefined, `autorizzazione ${authorizationStatus}`);
        assert.equal(after.registrationStatus, "pending_parent_authorization");
      }
    });

    test("minorenne, autorizzazione non firmata (scaduta, revocata, rifiutata, errore mail, richiesta): active negato", async () => {
      for (const authorizationStatus of NOT_SIGNED_STATUSES) {
        const ctx = await seedCancelled(kindDef, { authorizationStatus });
        await expectReactivationDenied(ctx, "active", `active con ${authorizationStatus}`);
        await expectReactivated(ctx, "pending_parent_authorization", authorizationStatus);
      }
    });

    test("minorenne, firma già data (authorized): active consentito, come fa il client", async () => {
      const ctx = await seedCancelled(kindDef, { authorizationStatus: "authorized" });
      assert.equal(clientStatus(ctx), "active", "il client non rifà firmare");
      await expectReactivated(ctx, undefined, "client");
    });

    test("minorenne, firma già data: confirmed negato, pending_parent_authorization consentito", async () => {
      const ctx = await seedCancelled(kindDef, { authorizationStatus: "authorized" });
      await expectReactivationDenied(ctx, "confirmed", "confirmed");
      for (const status of OTHER_STATUSES_FROM_CANCELLED) await expectReactivationDenied(ctx, status, status);
      await expectReactivated(ctx, "pending_parent_authorization");
    });

    test("maggiorenne: active consentito, anche con una mail al genitore rimasta o nessuna autorizzazione", async () => {
      for (const authorizationStatus of [null, "email_sent"]) {
        const ctx = await seedCancelled(kindDef, { birthDate: ADULT, authorizationStatus });
        assert.equal(clientStatus(ctx), "active");
        await expectReactivated(ctx, undefined, `adulto, autorizzazione ${authorizationStatus}`);
      }
    });

    test("maggiorenne: confirmed e gli altri stati negati, pending_parent_authorization consentito", async () => {
      const ctx = await seedCancelled(kindDef, { birthDate: ADULT, authorizationStatus: null });
      await expectReactivationDenied(ctx, "confirmed", "confirmed");
      for (const status of OTHER_STATUSES_FROM_CANCELLED) await expectReactivationDenied(ctx, status, status);
      await expectReactivated(ctx, "pending_parent_authorization");
    });

    for (const requires of [false, "assente"]) {
      const activityLabel = requires === false ? "requiresParentAuthorization: false" : "senza il campo";
      test(`minorenne, attività ${activityLabel}: active consentito`, async () => {
        for (const authorizationStatus of [null, "email_sent"]) {
          const ctx = await seedCancelled(kindDef, { requires, authorizationStatus });
          assert.equal(clientStatus(ctx), "active", "il modulo non raccoglie il genitore");
          await expectReactivated(ctx, undefined, `autorizzazione ${authorizationStatus}`);
        }
      });

      test(`minorenne, attività ${activityLabel}: confirmed negato`, async () => {
        const ctx = await seedCancelled(kindDef, { requires, authorizationStatus: null });
        await expectReactivationDenied(ctx, "confirmed", "confirmed");
        await expectReactivated(ctx, "active");
      });
    }

    test("bordo dei 18 anni: oggi e domani active passa, a 3 giorni dai 18 no (senza firma)", async () => {
      for (const offset of [0, 1, 3]) {
        const birthDate = birthDateTurning18In(offset);
        const days = daysUntil18(birthDate);
        const ctx = await seedCancelled(kindDef, { birthDate, authorizationStatus: "email_sent" });
        if (deniedAsMinor(birthDate)) {
          await expectReactivationDenied(ctx, "active", `18 anni fra ${days} giorni`);
          await expectReactivated(ctx, "pending_parent_authorization");
        } else {
          await expectReactivated(ctx, "active", `18 anni fra ${days} giorni`);
        }
      }
    });

    test("iscrizione non annullata: da pending_parent_authorization ad active è negato, il risalvataggio invariato passa", async () => {
      const ctx = await seedCancelled(kindDef, { authorizationStatus: "email_sent", status: "pending_parent_authorization" });
      assert.equal(clientStatus(ctx), "pending_parent_authorization", "il client conserva lo stato esistente");
      await expectReactivationDenied(ctx, "active", "pending -> active");
      await expectReactivationDenied(ctx, "confirmed", "pending -> confirmed");
      await expectReactivated(ctx, undefined, "risalvataggio");
    });

    test("iscrizione attiva di un maggiorenne: il risalvataggio invariato passa, il ritorno a pending no", async () => {
      const ctx = await seedCancelled(kindDef, { birthDate: ADULT, authorizationStatus: null, status: "active" });
      assert.equal(clientStatus(ctx), "active");
      await expectReactivationDenied(ctx, "pending_parent_authorization", "active -> pending");
      await expectReactivated(ctx, undefined, "risalvataggio");
    });
  });
}

describe("7b. osservazione: la data di nascita non è congelata dalla riattivazione", () => {
  test("minorenne senza firma che riattiva cambiando birthDate in maggiorenne: esito registrato", async (t) => {
    const ctx = await seedCancelled(kindOf("figlio"), { authorizationStatus: "email_sent" });
    let outcome;
    try {
      await reactivate(ctx, "active", {
        birthDate: ADULT,
        answers: { ...ctx.input.answers, birthDate: ADULT },
      });
      outcome = "consentito";
    } catch (error) {
      outcome = `negato (${error?.code})`;
    }
    t.diagnostic(`riattivazione in active di un figlio di 14 anni con birthDate riscritta a ${ADULT}: ${outcome}`);
  });
});

// ===========================================================================
// 8. Admin del palo e altri ruoli
// ===========================================================================

describe("8. admin del palo: stati liberi, come prima", () => {
  /** L'admin scrive l'iscrizione di un altro (un account del palo) con il suo SDK. */
  async function adminCreates(actor, activityId, person, payload) {
    await setDoc(registrationRef(actor, activityId, person.registrationId), payload);
    return stored(registrationPath(activityId, person.registrationId));
  }

  test("crea con confirmed l'iscrizione di un minorenne in un'attività con autorizzazione", async () => {
    const person = await newPerson(kindOf("account"), MINOR);
    const activityId = await seedActivity();
    const data = await adminCreates("admin", activityId, person, { ...baselinePayload(person), registrationStatus: "confirmed" });
    assert.equal(data.registrationStatus, "confirmed");
  });

  test("crea con active, draft, submitted, waitlist, cancelled e rejected_by_parent", async () => {
    for (const status of ["active", "draft", "submitted", "waitlist", "cancelled", "rejected_by_parent"]) {
      const person = await newPerson(kindOf("account"), MINOR);
      const activityId = await seedActivity();
      const data = await adminCreates("admin", activityId, person, { ...baselinePayload(person), registrationStatus: status });
      assert.equal(data.registrationStatus, status);
    }
  });

  test("crea un'iscrizione già firmata e assegnata (campi protetti valorizzati, come un import)", async () => {
    const person = await newPerson(kindOf("figlio"), MINOR);
    const activityId = await seedActivity();
    const signed = cancelledRegistration(person, { authorizationStatus: "authorized", requiresAuth: true });
    const data = await adminCreates("admin", activityId, person, { ...signed, registrationStatus: "confirmed" });
    assert.equal(data.registrationStatus, "confirmed");
    assert.equal(data.parentAuthorization.status, "authorized");
    assert.equal(data.assignedRoomName, "Stanza 12");
  });

  test("riattiva in active un'iscrizione annullata di un minorenne senza firma", async () => {
    const ctx = await seedCancelled(kindOf("account"), { authorizationStatus: "email_sent" });
    await updateDoc(registrationRef("admin", ctx.activityId, ctx.person.registrationId), {
      registrationStatus: "active",
      updatedAt: nowIso(),
    });
    assert.equal((await stored(ctx.path)).registrationStatus, "active");
  });

  test("un admin di un altro palo non è admin qui: per le sue iscrizioni valgono le regole normali", async () => {
    // In creazione: confirmed negato, lo stato normale passa.
    const person = await newPerson(kindOf("account"), MINOR, "adminAltroPalo");
    const activityId = await seedActivity();
    const accepted = baselinePayload(person);
    await expectDeniedThenAccepted(person, activityId, { ...accepted, registrationStatus: "confirmed" }, accepted, "confirmed");

    // In riattivazione: un minorenne senza firma non torna active, torna in attesa.
    const ctx = await seedCancelled(kindOf("account"), { authorizationStatus: "email_sent", actor: "adminAltroPalo" });
    await expectReactivationDenied(ctx, "active", "active");
    await expectReactivated(ctx, "pending_parent_authorization");
  });

  test("un dirigente di unità non è admin: crea la propria iscrizione solo in attesa o active, mai confirmed", async () => {
    const person = await newPerson(kindOf("account"), MINOR, "dirigente");
    const activityId = await seedActivity();
    const accepted = baselinePayload(person);
    await expectDeniedThenAccepted(person, activityId, { ...accepted, registrationStatus: "confirmed" }, accepted, "dirigente confirmed");
  });

  test("l'admin che si iscrive da sé col percorso normale del client: active", async () => {
    // Il client dell'admin passa dallo stesso upsertRegistration.
    const person = await newPerson(kindOf("account"), ADULT, "admin");
    const activityId = await seedActivity();
    const result = await clientUpsert(person, activityId, editorInput(person));
    assert.equal(result.saved.registrationStatus, "active");
  });
});
