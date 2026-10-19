// Fase 6 del flusso genitore (docs/FLUSSO_GENITORE.md, scelta G2 = a: i figli si
// aggiungono a QUALUNQUE account adulto, il ruolo resta quello che è): prova
// nell'emulatore, con le chiamate esatte del client, che le rules di oggi
// lasciano usare Famiglia (`/family`), «Chi iscrivi?» e «Iscrizione inviata»
// anche a un partecipante adulto, a un dirigente di unità (`unit_leader`), a un
// admin del palo e a un ex genitore convertito a `participant` che ha già figli
// e un'iscrizione `child_`. Nessuna rule viene toccata: dove qualcosa fosse
// negato, il test lo mostra e basta.
//
// Chiamate del client, campo per campo (copiate qui perché i service importano
// l'app Firebase del browser e non girano sotto Node):
// - src/services/firestore/childrenService.ts: newChildDraft, createChild
//   (con e senza `draft`), updateChild, deleteChild, listChildren, getChild;
// - src/services/firestore/registrationsService.ts: getRegistrationByActor e
//   getRegistrationById (id fisso `child_<titolare>_<figlio>` e `user_<uid>`,
//   anche quando il documento manca), upsertRegistration con le sue letture
//   (attività, profilo, unità attive, iscrizione propria e `guest_`) e i due
//   rami di scrittura (setDoc alla prima iscrizione, updateDoc al
//   risalvataggio), syncProfileFromRegistration dopo l'iscrizione propria,
//   watchRegistration (onSnapshot del singolo documento), listFamilyRegistrations
//   (collection group `parentUid == uid`), cancelRegistrationById;
// - src/services/firestore/usersService.ts: createOwnProfile (ensureProfileForUser),
//   setOwnAccountType, updateParentProfile e updateProfile con `role:
//   "participant"` (ramo di completeProfile in AuthProvider/ProfileForm), per
//   l'ex genitore;
// - src/services/firestore/registrationAttemptsService.ts: il registro dei
//   tentativi intorno al salvataggio (nel client gli errori sono inghiottiti:
//   qui un rifiuto si vedrebbe);
// - src/pages/family/FamilyDashboardPage.tsx e src/pages/public/ActivityRegisterPage.tsx:
//   le letture di apertura (figli, iscrizioni della famiglia, attività
//   pubbliche, unità attive, «Già iscritto» per ogni figlio e per sé).
// Il giro con le Functions (Autorizza ora, cambio dei consensi da Famiglia) sta
// in familyAnyAdultCallablesEmulator.test.mjs: ha bisogno di Auth e Functions.
//
// SDK client con utenti normali (token mock dell'emulatore) e profilo completo;
// l'Admin SDK serve solo per seminare palo, unità, attività e profili, per
// simulare le scritture del server (mail del trigger, firma, stanza) e per
// rileggere: ignora le rules.
//
// Che cosa passa da dove, per non leggere un verde per un altro:
// - l'admin del palo supera quasi ogni rule iscrizione con `isStakeAdmin`, che
//   non dice nulla sul ramo del titolare. Il ramo del titolare (validRegistrationCreate,
//   validOwnerCancellation, validRegistrationUpdate) si prova quindi anche con
//   un admin di UN ALTRO palo, che sul palo dell'attività non ha poteri;
// - le attività di prova sono viaggi (`trip`); per il dirigente di unità e per
//   l'admin c'è anche il giro su un campeggio (`camp`), dove le rules valutano
//   altri rami (staff del campo) prima o dopo quello del titolare.
//
// Rilancio dalla radice del repository (solo Firestore; porta libera a piacere):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-family-any-adult \
//     'node --test --test-concurrency=1 functions/tests/familyAnyAdultRulesEmulator.test.mjs'
// Sul Mac mini, da un worktree (ogni sync cancella i node_modules ignorati):
//   mini 'npm ci && (cd functions && npm ci) && JAVA_HOME=... firebase emulators:exec ... '
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (Firestore, hub, logging, websocket) in un file temporaneo nella
// radice del progetto e rimuovilo a fine prova; il test legge l'host da
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
  deleteDoc,
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

import { getYouthGroupLabel } from "../../src/utils/profile.ts";
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
const stakeId = `famiglia-adulti-${runId}`;
const otherStakeId = `famiglia-adulti-b-${runId}`;
const SEEDED_AT = "2026-10-01T08:00:00.000Z";
const SIGNED_AT = "2026-10-02T19:30:00.000Z";
const nowIso = () => new Date().toISOString();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STAKES = {
  [stakeId]: { name: "Palo di prova", slug: `palo-prova-${runId}` },
  [otherStakeId]: { name: "Altro palo", slug: `altro-palo-${runId}` },
};
const UNITS = {
  [stakeId]: [
    { id: "unita-1", name: "Unità Uno" },
    { id: "unita-2", name: "Unità Due" },
  ],
  [otherStakeId]: [{ id: "unita-b1", name: "Unità B Uno" }],
};

// ---------------------------------------------------------------------------
// Attori. Profilo completo nel palo, come lo lasciano «I tuoi dati» e Accedi.
// `category` è la categoria scelta in «I tuoi dati» (genderRoleCategory).
// ---------------------------------------------------------------------------

const ACTORS = {
  // Titolari dei figli (gli account che la fase 6 abilita a Famiglia).
  adulto: {
    label: "un partecipante adulto (role participant)",
    role: "participant",
    firstName: "Giorgio",
    lastName: "Bianchi",
    phone: "3351112233",
    birthDate: "1979-04-24",
    category: "accompagnatore",
    stake: stakeId,
    unitId: "unita-1",
  },
  dirigente: {
    label: "un dirigente di unità (role unit_leader)",
    role: "unit_leader",
    firstName: "Sara",
    lastName: "Verdi",
    phone: "3384445566",
    birthDate: "1985-09-02",
    category: "dirigente",
    stake: stakeId,
    unitId: "unita-1",
  },
  admin: {
    label: "un admin del palo (role admin)",
    role: "admin",
    firstName: "Marta",
    lastName: "Gialli",
    phone: "3396667788",
    birthDate: "1976-01-30",
    category: "dirigente",
    stake: stakeId,
    unitId: "unita-1",
  },
  // Nasce genitore (profilo e figli scritti dal client in setUpExGenitore) e
  // poi sceglie «Partecipo io»: il profilo qui sotto è quello dopo la conversione.
  exGenitore: {
    label: "un ex genitore convertito a participant (role participant)",
    role: "participant",
    firstName: "Paola",
    lastName: "Rossi",
    phone: "3331234567",
    birthDate: "1981-03-14",
    category: "accompagnatore",
    stake: stakeId,
    unitId: "unita-1",
  },
  // Estranei.
  altroAdulto: {
    label: "un altro partecipante adulto dello stesso palo e della stessa unità",
    role: "participant",
    firstName: "Franco",
    lastName: "Neri",
    phone: "3337654321",
    birthDate: "1978-11-02",
    category: "accompagnatore",
    stake: stakeId,
    unitId: "unita-1",
  },
  dirigenteAltraUnita: {
    label: "un dirigente di un'altra unità dello stesso palo",
    role: "unit_leader",
    firstName: "Elena",
    lastName: "Blu",
    phone: "3381112244",
    birthDate: "1983-06-18",
    category: "dirigente",
    stake: stakeId,
    unitId: "unita-2",
  },
  adminAltroPalo: {
    label: "un admin di un altro palo",
    role: "admin",
    firstName: "Luigi",
    lastName: "Rosa",
    phone: "3395556677",
    birthDate: "1974-12-05",
    category: "dirigente",
    stake: otherStakeId,
    unitId: "unita-b1",
  },
  nonAutenticato: null,
};
const OWNERS = ["adulto", "dirigente", "admin", "exGenitore"];
const OUTSIDERS = ["altroAdulto", "dirigenteAltraUnita", "adminAltroPalo", "nonAutenticato"];
// L'ex genitore ha il profilo scritto dal client; gli altri li semina l'Admin SDK.
const SEEDED_BY_ADMIN = ["adulto", "dirigente", "admin", "altroAdulto", "dirigenteAltraUnita", "adminAltroPalo"];

const clients = {};
const fs = (actor) => clients[actor].firestore;
const uid = (actor) => `${actor}-${runId}`;
const emailOf = (actor) => `${actor}-${runId}@example.invalid`;
const stored = async (path) => (await adminDb.doc(path).get()).data();
const unitOf = (actor) => UNITS[ACTORS[actor].stake].find((unit) => unit.id === ACTORS[actor].unitId);

/** Rifiuto delle rules: l'operazione si passa come funzione, così non resta una promessa rifiutata senza gestore. */
async function expectDenied(operation, label = "") {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, "permission-denied", `${label} ${error?.code}: ${error?.message}`);
    return true;
  });
}

/** Profilo con tutti i campi di validUserPayload, come lo scrive il client. */
function profileDocument(actor) {
  const data = ACTORS[actor];
  const unit = unitOf(actor);
  return {
    firstName: data.firstName,
    lastName: data.lastName,
    fullName: `${data.firstName} ${data.lastName}`,
    email: emailOf(actor),
    phone: data.phone,
    role: data.role,
    city: "Roma",
    birthDate: data.birthDate,
    genderRoleCategory: data.category,
    unitId: unit.id,
    unitName: unit.name,
    stakeId: data.stake,
    stakeSlug: STAKES[data.stake].slug,
    stakeName: STAKES[data.stake].name,
    mustChangePassword: false,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    lastLoginAt: SEEDED_AT,
  };
}

// ---------------------------------------------------------------------------
// Profilo: usersService.ts, solo per l'ex genitore (ramo `role: "participant"`)
// ---------------------------------------------------------------------------

const userRef = (actor) => doc(fs(actor), "users", uid(actor));

/** stakesService.getStakeById */
async function readStake(actor, id = stakeId) {
  const snapshot = await getDocFromServer(doc(fs(actor), "stakes", id));
  assert.ok(snapshot.exists(), "palo seminato");
  return { id, slug: snapshot.data().slug, name: snapshot.data().name };
}

/** organizationService.assertManagedUnit: unità attive del palo, per nome. */
async function readManagedUnit(actor, unitName, id = stakeId) {
  const snapshot = await getDocsFromServer(
    query(collection(fs(actor), "stakes", id, "units"), where("isActive", "==", true)),
  );
  assert.ok(snapshot.size > 0, "unità attive leggibili dal client");
  const normalized = unitName.trim().toLocaleLowerCase("it-IT");
  const match = snapshot.docs.find((item) => item.data().name.toLocaleLowerCase("it-IT") === normalized);
  assert.ok(match, `unità ${unitName} configurata`);
  return { id: match.id, name: match.data().name };
}

/** sanitizeRole di mapUserProfile. */
const sanitizeRole = (value) =>
  ["admin", "super_admin", "unit_leader", "parent"].includes(value) ? value : "participant";

/** getProfile + mapUserProfile (solo i campi che servono). */
async function readOwnProfile(actor) {
  const snapshot = await getDocFromServer(userRef(actor));
  assert.ok(snapshot.exists(), "profilo leggibile dal titolare");
  const data = snapshot.data();
  return { ...data, role: sanitizeRole(data.role), unitId: typeof data.unitId === "string" ? data.unitId : "" };
}

/** ensureProfileForUser, ramo "non esiste": il profilo nasce participant. */
async function createOwnProfile(actor) {
  assert.equal((await getDocFromServer(userRef(actor))).exists(), false, "profilo ancora da creare");
  const stake = await readStake(actor);
  const displayName = `${ACTORS[actor].firstName} ${ACTORS[actor].lastName}`;
  const createdAt = nowIso();
  await setDoc(userRef(actor), {
    firstName: ACTORS[actor].firstName,
    lastName: ACTORS[actor].lastName,
    fullName: displayName,
    email: emailOf(actor),
    phone: "",
    role: "participant",
    city: "",
    birthDate: "",
    genderRoleCategory: "",
    unitId: "",
    unitName: "",
    stakeId: stake.id,
    stakeSlug: stake.slug,
    stakeName: stake.name,
    mustChangePassword: false,
    createdAt,
    updatedAt: createdAt,
    lastLoginAt: createdAt,
  });
}

/** setOwnAccountType: solo ruolo e updatedAt. */
const setOwnAccountType = (actor, role) => updateDoc(userRef(actor), { role, updatedAt: nowIso() });

/** updateParentProfile («I tuoi dati» del genitore). */
async function updateParentProfile(actor, input) {
  await readOwnProfile(actor);
  const matchedUnit = await readManagedUnit(actor, input.unitName);
  const stake = await readStake(actor);
  await updateDoc(userRef(actor), {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    fullName: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
    role: "parent",
    city: input.city.trim(),
    unitId: matchedUnit.id,
    unitName: matchedUnit.name,
    stakeId: stakeId,
    stakeSlug: stake.slug,
    stakeName: stake.name,
    birthDate: "",
    genderRoleCategory: "",
    updatedAt: nowIso(),
    lastLoginAt: nowIso(),
  });
}

/**
 * updateProfile («I tuoi dati» di chi partecipa), come lo chiama
 * authService.completeProfile: il ruolo `participant` viaggia nella stessa
 * scrittura solo se il profilo attuale è `parent`.
 */
async function updateProfile(actor, input) {
  const currentProfile = await readOwnProfile(actor);
  const unitName = input.unitName.trim();
  const matchedUnit = unitName ? await readManagedUnit(actor, unitName) : null;
  const stake = await readStake(actor);
  await updateDoc(userRef(actor), {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    fullName: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
    unitId: matchedUnit?.id ?? currentProfile.unitId,
    unitName,
    birthDate: input.birthDate,
    genderRoleCategory: input.genderRoleCategory,
    stakeId: input.stakeId,
    stakeSlug: stake.slug,
    ...(input.role && currentProfile.role === "parent" ? { role: input.role } : {}),
    updatedAt: nowIso(),
    lastLoginAt: nowIso(),
  });
}

/**
 * syncProfileFromRegistration: dopo l'iscrizione PROPRIA (lookup.userId) il
 * client riallinea il profilo. Nel client un errore qui è inghiottito
 * (console.warn): qui un rifiuto farebbe fallire il test, così si vede.
 */
async function syncProfileFromRegistration(actor, input) {
  const reference = userRef(actor);
  const snapshot = await getDocFromServer(reference);
  if (!snapshot.exists()) return;
  const current = snapshot.data();
  const resolvedUnit = input.unitName?.trim() ? await readManagedUnit(actor, input.unitName, input.stakeId) : null;
  const stake = await readStake(actor, input.stakeId);
  const names = input.fullName.trim().split(/\s+/u);
  await updateDoc(reference, {
    firstName: names[0] ?? "",
    lastName: names.slice(1).join(" "),
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    phone: typeof input.phone === "string" && input.phone.trim() ? input.phone.trim() : current.phone,
    city: current.city,
    birthDate: input.birthDate ?? "",
    genderRoleCategory: input.genderRoleCategory ?? "",
    unitId: input.unitId ?? resolvedUnit?.id ?? current.unitId ?? "",
    unitName: resolvedUnit?.name ?? input.unitName ?? "",
    stakeId: input.stakeId,
    stakeSlug: stake.slug ?? "",
    updatedAt: nowIso(),
    lastLoginAt: nowIso(),
  });
}

/** Profilo letto dal client (sessione): da qui il prefill del passo «genitore». */
async function readAccount(actor) {
  const profile = await readOwnProfile(actor);
  return { firstName: profile.firstName, lastName: profile.lastName, email: profile.email, phone: profile.phone };
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
  const reference = draft ? childRef(actor, parentUid, draft.childId) : doc(childrenCollection(actor, parentUid));
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

/** childrenService.deleteChild */
const deleteChild = (actor, parentUid, childId) => deleteDoc(childRef(actor, parentUid, childId));

/** childrenService.listChildren e getChild (cache-first: qui la lettura dal server, quella che le rules giudicano). */
const listChildren = (actor, parentUid) => getDocsFromServer(childrenCollection(actor, parentUid));
const getChild = (actor, parentUid, childId) => getDocFromServer(childRef(actor, parentUid, childId));

// ---------------------------------------------------------------------------
// Attività e iscrizioni: registrationsService.ts, RegistrationEditor.tsx
// ---------------------------------------------------------------------------

let activityCounter = 0;
/** Attività aperta alle iscrizioni, con autorizzazione del genitore: viaggio al tempio o campeggio. */
async function seedActivity({ type = "trip", open = true } = {}) {
  activityCounter += 1;
  const activityId = `${type}-${activityCounter}`;
  await adminDb.doc(`stakes/${stakeId}/activities/${activityId}`).set({
    title: `Attività di prova ${activityCounter}`,
    activityType: type,
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
const ownLookup = (userId) => ({
  userId,
  anonymousAuthUid: null,
  anonymousUid: null,
  parentUid: null,
  childId: null,
});
const childRegistrationId = (parentUid, childId) => `child_${parentUid}_${childId}`;
/** getRegistrationDocId */
const registrationIdOf = (lookup) =>
  lookup.parentUid && lookup.childId
    ? childRegistrationId(lookup.parentUid, lookup.childId)
    : lookup.userId
      ? `user_${lookup.userId}`
      : `guest_${lookup.anonymousUid}`;
const registrationPath = (activityId, registrationId, id = stakeId) =>
  `stakes/${id}/activities/${activityId}/registrations/${registrationId}`;
const registrationRef = (actor, activityId, registrationId) =>
  doc(fs(actor), "stakes", stakeId, "activities", activityId, "registrations", registrationId);

/** getRegistrationById, lettura dal server (quella che le rules giudicano). */
const readRegistration = (actor, activityId, registrationId) =>
  getDocFromServer(registrationRef(actor, activityId, registrationId));

/** registrationsService.getRegistrationByActor: figlio, oppure `user_<uid>` e poi `guest_<uid>`. */
async function getRegistrationByActor(actor, activityId, lookup) {
  if (lookup.parentUid && lookup.childId) {
    const snapshot = await readRegistration(actor, activityId, registrationIdOf(lookup));
    return snapshot.exists() ? snapshot.data() : null;
  }
  const own = await readRegistration(actor, activityId, `user_${lookup.userId}`);
  if (own.exists()) return own.data();
  const guest = await readRegistration(actor, activityId, `guest_${lookup.userId}`);
  return guest.exists() ? guest.data() : null;
}

/** 32 domande personalizzate del modulo (testo, scelte multiple, sì/no, numeri, vuote). */
function customAnswers() {
  const answers = {};
  for (let index = 1; index <= 32; index += 1) {
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
              : `Risposta libera alla domanda ${index}: ${"dettaglio ".repeat(12).trim()}`;
  }
  return answers;
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
 * Input che RegistrationEditor.handleSubmit passa a onSubmit per un FIGLIO
 * scelto da un account: risposte standard e personalizzate del modulo, passo
 * «Genitore e sicurezza» partito dai dati dell'account, attività con
 * autorizzazione del genitore. Stesso input di parentChildFlowRulesEmulator.test.mjs.
 */
function editorSubmitInput(child, parentAccount, options = {}) {
  const { registrationStatus = "pending_parent_authorization", phone = "3471234567", answerChanges = {} } = options;
  const consentAcceptedAt = nowIso();
  const category = child.genderRoleCategory;
  const youthGroup = category === "giovane_donna" ? "Giovani Donne" : "Giovani Uomini";
  const answers = {
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
    ...customAnswers(),
    ...answerChanges,
  };
  const medicalText = (key, fallback) => (typeof answers[key] === "string" ? answers[key] : fallback).trim();
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
    firstName: child.firstName.trim(),
    lastName: child.lastName.trim(),
    fullName: `${child.firstName.trim()} ${child.lastName.trim()}`.trim(),
    email: "",
    phone,
    birthDate: child.birthDate,
    genderRoleCategory: category,
    unitName: child.unitName.trim(),
    answers: {
      ...answers,
      roomPreference1Name: getRoomPreferenceTextFromAnswers(answers, "roomPreference1Name"),
      roomPreference2Name: getRoomPreferenceTextFromAnswers(answers, "roomPreference2Name"),
      parentAuthorizationRequest,
    },
    registrationStatus,
    status: "active",
    participatingDays: ["2026-11-13", "2026-11-14", "2026-11-15"],
  };
}

/**
 * Input di handleSubmit per l'iscrizione PROPRIA di un adulto: stesso modulo,
 * ma niente blocco del genitore (maggiorenne), stato `active`, email e dati
 * dell'account.
 */
function ownEditorInput(actor, options = {}) {
  const { phone = ACTORS[actor].phone, answerChanges = {} } = options;
  const data = ACTORS[actor];
  const unit = unitOf(actor);
  const answers = {
    birthDate: data.birthDate,
    youthGroup: getYouthGroupLabel(data.category),
    genderRoleCategory: data.category,
    phone,
    unitName: unit.name,
    city: "Roma",
    transportMode: "Auto propria",
    roomNotes: "Preferisco una stanza tranquilla.",
    allergies: "",
    dietaryNotes: "Vegetariano.",
    medicalNotes: "",
    photoInternalConsent: true,
    photoPublicConsent: false,
    ...customAnswers(),
    ...answerChanges,
  };
  return {
    firstName: data.firstName,
    lastName: data.lastName,
    fullName: `${data.firstName} ${data.lastName}`,
    email: emailOf(actor),
    phone,
    birthDate: data.birthDate,
    genderRoleCategory: data.category,
    unitName: unit.name,
    answers: {
      ...answers,
      roomPreference1Name: getRoomPreferenceTextFromAnswers(answers, "roomPreference1Name"),
      roomPreference2Name: getRoomPreferenceTextFromAnswers(answers, "roomPreference2Name"),
    },
    registrationStatus: "active",
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

/** registrationPayload di upsertRegistration (figlio o iscrizione propria, a seconda del lookup). */
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
 * registrationsService.upsertRegistration, con le sue letture: attività
 * (eventsService.getEventById), profilo (getRegistrationCategory, solo per
 * l'iscrizione propria), unità attive (organizationService.assertManagedUnit),
 * la propria iscrizione (getDoc) e, se manca `user_<uid>`, `guest_<uid>`; poi
 * setDoc o updateDoc, il riallineamento del profilo (solo iscrizione propria)
 * e la rilettura. `branch` dice quale ramo ha scritto.
 */
async function upsertRegistration(actor, activityId, lookup, input) {
  const db = fs(actor);
  const event = await getDocFromServer(doc(db, "stakes", stakeId, "activities", activityId));
  assert.ok(event.exists(), "attività letta dal client");
  if (lookup.userId) {
    const profile = await getDocFromServer(doc(db, "users", lookup.userId));
    assert.ok(profile.exists(), "profilo letto da getRegistrationCategory");
  }
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

  const registrationId = registrationIdOf(lookup);
  const reference = registrationRef(actor, activityId, registrationId);
  const snapshot = await getDocFromServer(reference);
  if (lookup.userId && !snapshot.exists()) {
    const guest = await readRegistration(actor, activityId, `guest_${lookup.userId}`);
    assert.equal(guest.exists(), false, "nessuna iscrizione da ospite da collegare");
  }
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

  if (lookup.userId) {
    await syncProfileFromRegistration(actor, {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      stakeId,
      birthDate: payload.birthDate,
      genderRoleCategory: payload.genderRoleCategory,
      unitName: resolvedUnit.name,
      unitId: resolvedUnit.id,
    });
  }

  const saved = await getDocFromServer(reference);
  assert.ok(saved.exists(), "iscrizione riletta dopo il salvataggio");
  return { branch: snapshot.exists() ? "updateDoc" : "setDoc", registrationId, payload, saved: saved.data() };
}

/** registrationAttemptsService.startAttempt */
async function startAttempt(actor, activityId, lookup, input) {
  const timestamp = nowIso();
  const reference = await addDoc(collection(fs(actor), "stakes", stakeId, "registrationAttempts"), {
    stakeId,
    eventId: activityId,
    eventTitle: `Attività di prova ${activityId}`,
    registrationId: null,
    userId: lookup.userId ?? lookup.parentUid ?? null,
    anonymousUid: lookup.userId || lookup.parentUid ? null : (lookup.anonymousUid ?? null),
    submittedByMode: lookup.userId || lookup.parentUid ? "authenticated" : "anonymous",
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    status: "started",
    lastStep: "submit_started",
    route: `/activities/${activityId}/register${lookup.childId ? `?per=figlio&passo=modulo&child=${lookup.childId}` : ""}`,
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
async function submitRegistration(actor, activityId, lookup, input) {
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

/** cancelRegistrationById: la stessa scrittura di /me, poi la rilettura (getRegistrationById). */
async function cancelRegistrationById(actor, activityId, registrationId) {
  await updateDoc(registrationRef(actor, activityId, registrationId), {
    registrationStatus: "cancelled",
    updatedAt: nowIso(),
  });
  return (await readRegistration(actor, activityId, registrationId)).data();
}

/** I tredici campi che il modulo «Gestisci» riscrive (ramo updateDoc di upsertRegistration). */
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

/** listFamilyRegistrations (ramo `fresh`: dal server). */
const listFamilyRegistrations = (actor, parentUid) =>
  getDocsFromServer(query(collectionGroup(fs(actor), "registrations"), where("parentUid", "==", parentUid)));

/** Lo stesso elenco letto con l'Admin SDK: il termine di confronto. */
const adminFamilyPaths = async (parentUid) =>
  (await adminDb.collectionGroup("registrations").where("parentUid", "==", parentUid).get()).docs
    .map((item) => item.ref.path)
    .sort();

/** Annullamento riuscito: cambiano solo stato e updatedAt, il resto è identico. */
function assertOnlyCancelled(before, after, startedAt) {
  assert.equal(after.registrationStatus, "cancelled");
  assert.ok(after.updatedAt >= startedAt, `updatedAt nuovo (${after.updatedAt})`);
  const { registrationStatus: _s1, updatedAt: _u1, ...restBefore } = before;
  const { registrationStatus: _s2, updatedAt: _u2, ...restAfter } = after;
  assert.deepEqual(restAfter, restBefore);
}

// ---------------------------------------------------------------------------
// Scritture del server e dello staff, come le farebbero trigger e callable
// ---------------------------------------------------------------------------

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

/**
 * Iscrizione figlio «massima»: modulo con ~50 risposte, firma completa, stanza
 * pubblicata, pattuglia, comitati e ogni campo opzionale valorizzato (codici di
 * accesso, documento d'identità, turno al tempio, squadre di servizio). È il
 * caso peggiore del budget delle 1000 espressioni, lo stesso di
 * `maximalRegistration` in parentCancelRulesEmulator.test.mjs, costruito qui
 * con l'input vero del modulo.
 */
function maximalChildRegistration(parentUid, child, parentAccount) {
  const registrationId = childRegistrationId(parentUid, child.id);
  const base = buildRegistrationPayload(
    childLookup(parentUid, child.id),
    editorSubmitInput(child, parentAccount),
    { id: "unita-1", name: "Unità Uno" },
    null,
    SEEDED_AT,
  );
  const withMail = { ...base, parentAuthorization: emailSentState(base.answers.parentAuthorizationRequest) };
  const dir = `parentAuthorizations/${stakeId}/act/${registrationId}`;
  return {
    ...withMail,
    ...signedAndAssigned(withMail, registrationId),
    roomPreferenceMatches: roomMatches(),
    anonymousTokenId: "token-anonimo-1",
    accessCode: "ACC-1234",
    recoveryCode: "REC-5678",
    recoveryPdfGenerated: true,
    parentConsentDocumentUrl: "https://storage.example.invalid/consenso.pdf",
    consentSignatureUrl: "https://storage.example.invalid/firma.png",
    parentIdDocumentName: `documento-${registrationId}.pdf`,
    parentIdDocumentUrl: "https://storage.example.invalid/documento.pdf",
    parentIdDocumentPath: `${dir}/documento.pdf`,
    parentIdUploadedAt: SIGNED_AT,
    linkedLaterToUserId: `altro-account-${runId}`,
    assignedTempleShiftId: "turno-tempio-3",
    assignedServiceTeamIds: ["squadra-cucina", "squadra-pulizie"],
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

// ---------------------------------------------------------------------------
// Ciclo completo di un figlio su un'attività: lo stesso giro per ogni titolare
// ---------------------------------------------------------------------------

/**
 * Figlio nuovo → iscrizione (setDoc) → mail e firma (scritture del server) →
 * «Gestisci» sull'iscrizione firmata (updateDoc) → annullamento da Famiglia →
 * reiscrizione. `withOwn` aggiunge prima l'iscrizione propria dello stesso
 * account (con il riallineamento del profilo).
 */
async function childLifecycle(actor, activityId, { withOwn = true, name = "Ciclo" } = {}) {
  const me = uid(actor);
  const account = await readAccount(actor);
  const child = await createChild(
    actor,
    me,
    childInput({ firstName: name, lastName: ACTORS[actor].lastName }),
    newChildDraft(actor, me),
  );
  if (withOwn) {
    const own = await submitRegistration(actor, activityId, ownLookup(me), ownEditorInput(actor));
    assert.equal(own.branch, "setDoc");
    assert.equal(own.saved.registrationStatus, "active");
  }
  const lookup = childLookup(me, child.id);
  const registrationId = childRegistrationId(me, child.id);
  const path = registrationPath(activityId, registrationId);

  const first = await submitRegistration(actor, activityId, lookup, editorSubmitInput(child, account));
  assert.equal(first.branch, "setDoc");
  assert.equal(first.saved.registrationStatus, "pending_parent_authorization");
  assert.equal(first.saved.parentUid, me);

  // Il genitore firma (callable) e lo staff assegna la stanza: scritture del server.
  const current = await stored(path);
  await adminDb.doc(path).update({
    parentAuthorization: emailSentState(current.answers.parentAuthorizationRequest),
    roomPreferenceMatches: roomMatches(),
  });
  await adminDb.doc(path).update(signedAndAssigned(await stored(path), registrationId));
  const signed = await stored(path);
  assert.equal(signed.registrationStatus, "confirmed");

  const second = await upsertRegistration(
    actor,
    activityId,
    lookup,
    editorSubmitInput(child, account, { registrationStatus: "confirmed", phone: "3477777777" }),
  );
  assert.equal(second.branch, "updateDoc");
  const afterSave = await stored(path);
  assert.equal(afterSave.registrationStatus, "confirmed");
  assert.equal(afterSave.phone, "3477777777");
  assert.deepEqual(afterSave.parentAuthorization, signed.parentAuthorization, "firma intatta");
  assert.equal(afterSave.assignedRoomName, "Stanza 12");

  const startedAt = nowIso();
  await cancelRegistrationById(actor, activityId, registrationId);
  assertOnlyCancelled(afterSave, await stored(path), startedAt);

  const again = await upsertRegistration(actor, activityId, lookup, editorSubmitInput(child, account));
  assert.equal(again.branch, "updateDoc");
  const reactivated = await stored(path);
  assert.equal(reactivated.registrationStatus, "active", "la firma c'era già: torna attiva senza ripassare dal genitore");
  assert.deepEqual(reactivated.parentAuthorization, signed.parentAuthorization);
  return { child, registrationId, path };
}

// ---------------------------------------------------------------------------
// Semina
// ---------------------------------------------------------------------------

/** L'ex genitore nasce genitore (profilo, figli, un'iscrizione) e poi sceglie «Partecipo io». */
const legacy = {};
async function setUpExGenitore() {
  const actor = "exGenitore";
  const me = uid(actor);
  await createOwnProfile(actor);
  await setOwnAccountType(actor, "parent");
  await updateParentProfile(actor, {
    firstName: ACTORS[actor].firstName,
    lastName: ACTORS[actor].lastName,
    unitName: "Unità Uno",
    city: "Roma",
  });
  assert.equal((await stored(`users/${me}`)).role, "parent");

  legacy.activityId = await seedActivity();
  const account = await readAccount(actor);
  legacy.luca = await createChild(
    actor,
    me,
    childInput({ firstName: "Luca", lastName: "Rossi" }),
    newChildDraft(actor, me),
  );
  legacy.giulia = await createChild(
    actor,
    me,
    childInput({ firstName: "Giulia", lastName: "Rossi", genderRoleCategory: "giovane_donna" }),
    newChildDraft(actor, me),
  );
  legacy.registration = await submitRegistration(
    actor,
    legacy.activityId,
    childLookup(me, legacy.luca.id),
    editorSubmitInput(legacy.luca, account),
  );
  assert.equal(legacy.registration.saved.registrationStatus, "pending_parent_authorization");

  // «Partecipo io»: la stessa scrittura di ProfileForm → completeProfile → updateProfile.
  await updateProfile(actor, {
    firstName: ACTORS[actor].firstName,
    lastName: ACTORS[actor].lastName,
    unitName: "Unità Uno",
    birthDate: ACTORS[actor].birthDate,
    genderRoleCategory: ACTORS[actor].category,
    stakeId,
    role: "participant",
  });
  const converted = await stored(`users/${me}`);
  assert.equal(converted.role, "participant", "ruolo convertito");
  assert.equal(converted.birthDate, ACTORS[actor].birthDate);
  assert.equal(converted.genderRoleCategory, ACTORS[actor].category);
}

before(async () => {
  const writes = [];
  for (const id of [stakeId, otherStakeId]) {
    writes.push(adminDb.doc(`stakes/${id}`).set({ ...STAKES[id], isActive: true, createdAt: SEEDED_AT, updatedAt: SEEDED_AT }));
    for (const unit of UNITS[id]) {
      writes.push(
        adminDb.doc(`stakes/${id}/units/${unit.id}`).set({
          name: unit.name,
          type: "ward",
          isActive: true,
          stakeId: id,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        }),
      );
    }
  }
  for (const actor of SEEDED_BY_ADMIN) {
    writes.push(adminDb.doc(`users/${uid(actor)}`).set(profileDocument(actor)));
  }
  await Promise.all(writes);

  for (const [actor, data] of Object.entries(ACTORS)) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actor}-${runId}`);
    const firestore = getFirestore(app);
    const options = data
      ? {
          mockUserToken: {
            sub: uid(actor),
            email: emailOf(actor),
            email_verified: true,
            firebase: { sign_in_provider: "password" },
          },
        }
      : {};
    connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), options);
    clients[actor] = { app, firestore };
  }

  await setUpExGenitore();
});

after(async () => {
  try {
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${otherStakeId}`));
    for (const actor of Object.keys(ACTORS)) {
      if (ACTORS[actor]) await adminDb.recursiveDelete(adminDb.doc(`users/${uid(actor)}`));
    }
  } finally {
    await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// 1. Famiglia, «Chi iscrivi?» e «Iscrizione inviata» per ogni titolare
// ===========================================================================

const NOTE_ADMIN =
  "l'admin del palo supera le rules iscrizione anche con isStakeAdmin: il ramo del titolare è provato a parte, con un admin di un altro palo (sezione 3)";

for (const owner of OWNERS) {
  describe(`1. ${ACTORS[owner].label}: Famiglia, iscrizione di sé e dei figli`, () => {
    const actor = owner;
    const me = () => uid(owner);
    const note = owner === "admin" ? NOTE_ADMIN : "consentito: le rules di figli e iscrizioni child_ non guardano il ruolo";
    let account;
    let activityA;
    let activityB;
    let activityC;
    let nicola;
    let sofia;

    before(async () => {
      account = await readAccount(actor);
      activityA = await seedActivity();
      activityB = await seedActivity();
      activityC = await seedActivity();
    });

    test("figli: createChild con draft, «Salva» ripetuto (stesso id e createdAt), createdAt diverso negato", async (t) => {
      const draft = newChildDraft(actor, me());
      const input = childInput({ firstName: "Nicola", lastName: ACTORS[owner].lastName });
      const first = await createChild(actor, me(), input, draft);
      await pause(5);
      nicola = await createChild(actor, me(), { ...input, lastName: `${ACTORS[owner].lastName} Neri` }, draft);
      const data = await stored(childPath(me(), draft.childId));
      assert.equal(data.createdAt, draft.createdAt, "createdAt invariato");
      assert.equal(data.fullName, `Nicola ${ACTORS[owner].lastName} Neri`);
      assert.ok(data.updatedAt > first.updatedAt, "updatedAt del secondo salvataggio");
      await expectDenied(() => createChild(actor, me(), input, { ...draft, createdAt: nowIso() }), "createdAt diverso");
      t.diagnostic(note);
    });

    test("figli: createChild senza draft, updateChild, listChildren e getChild (anche di un figlio che non c'è)", async (t) => {
      sofia = await createChild(
        actor,
        me(),
        childInput({ firstName: "Sofia", lastName: ACTORS[owner].lastName, genderRoleCategory: "giovane_donna" }),
      );
      await updateChild(
        actor,
        me(),
        sofia.id,
        childInput({
          firstName: " Sofia ",
          lastName: ACTORS[owner].lastName,
          genderRoleCategory: "giovane_donna",
          birthDate: "2013-01-20",
          unitId: "unita-2",
          unitName: "Unità Due ",
        }),
      );
      const data = await stored(childPath(me(), sofia.id));
      assert.equal(data.firstName, "Sofia");
      assert.equal(data.birthDate, "2013-01-20");
      assert.equal(data.unitName, "Unità Due");
      assert.equal(data.createdAt, sofia.createdAt);

      const list = await listChildren(actor, me());
      const ids = list.docs.map((item) => item.id);
      assert.ok(ids.includes(nicola.id) && ids.includes(sofia.id), "i due figli sono nell'elenco");
      const one = await getChild(actor, me(), sofia.id);
      assert.equal(one.data().fullName, `Sofia ${ACTORS[owner].lastName}`);
      assert.equal((await getChild(actor, me(), "figlio-che-non-esiste")).exists(), false);
      t.diagnostic(note);
    });

    test("figli: deleteChild di un profilo senza iscrizioni", async (t) => {
      const spare = await createChild(actor, me(), childInput({ firstName: "Provvisorio", lastName: ACTORS[owner].lastName }));
      await deleteChild(actor, me(), spare.id);
      assert.equal(await stored(childPath(me(), spare.id)), undefined);
      assert.equal((await getChild(actor, me(), spare.id)).exists(), false);
      t.diagnostic(note);
    });

    test("apertura di Famiglia e di «Chi iscrivi?»: attività pubbliche, unità attive, iscrizioni della famiglia", async (t) => {
      const db = fs(actor);
      const events = await getDocsFromServer(
        query(
          collection(db, "stakes", stakeId, "activities"),
          where("isPublic", "==", true),
          where("isVisible", "==", true),
        ),
      );
      assert.ok(events.size >= 3, `attività pubbliche (${events.size})`);
      const units = await getDocsFromServer(
        query(collection(db, "stakes", stakeId, "units"), where("isActive", "==", true)),
      );
      assert.equal(units.size, 2);
      const family = await listFamilyRegistrations(actor, me());
      assert.deepEqual(family.docs.map((item) => item.ref.path).sort(), await adminFamilyPaths(me()));
      t.diagnostic(note);
    });

    test("«Già iscritto»: getDoc dell'iscrizione del figlio e di quella propria quando mancano (user_ e guest_)", async (t) => {
      assert.equal(await getRegistrationByActor(actor, activityA, childLookup(me(), nicola.id)), null);
      assert.equal(await getRegistrationByActor(actor, activityA, ownLookup(me())), null);
      assert.equal((await readRegistration(actor, activityA, `guest_${me()}`)).exists(), false);
      t.diagnostic(note);
    });

    test("attività A: prima l'iscrizione propria, poi quella del figlio; ascolto dal vivo del documento del figlio", async (t) => {
      const registrationId = childRegistrationId(me(), nicola.id);
      const path = registrationPath(activityA, registrationId);
      const watcher = watchRegistration(actor, activityA, registrationId);
      try {
        await watcher.waitFor(() => watcher.snapshots.length > 0 || watcher.errors.length > 0, "primo snapshot");
        assert.deepEqual(watcher.errors, [], "ascolto di un documento che non c'è ancora: nessun errore");
        assert.equal(watcher.snapshots[0], null, "primo snapshot vuoto");

        const own = await submitRegistration(actor, activityA, ownLookup(me()), ownEditorInput(owner));
        assert.equal(own.branch, "setDoc");
        assert.equal(own.registrationId, `user_${me()}`);
        assert.equal(own.saved.registrationStatus, "active");
        assert.equal(own.saved.submittedByMode, "authenticated");
        assert.equal(own.saved.userId, me());
        assert.equal(own.saved.parentUid, null);
        const profile = await stored(`users/${me()}`);
        assert.equal(profile.role, ACTORS[owner].role, "il ruolo non cambia con l'iscrizione propria");
        assert.equal(profile.unitId, ACTORS[owner].unitId);

        const child = await submitRegistration(actor, activityA, childLookup(me(), nicola.id), editorSubmitInput(nicola, account));
        assert.equal(child.branch, "setDoc");
        assert.equal(child.registrationId, registrationId);
        assert.equal(child.saved.registrationStatus, "pending_parent_authorization");
        assert.equal(child.saved.submittedByMode, "parent");
        assert.equal(child.saved.parentUid, me());
        assert.equal(child.saved.userId, null);
        assert.equal(child.saved.childId, nicola.id);
        assert.deepEqual(await stored(path), child.payload);
        const attempt = await stored(`stakes/${stakeId}/registrationAttempts/${child.attemptId}`);
        assert.equal(attempt.status, "succeeded");
        assert.equal(attempt.userId, me());

        // «Iscrizione inviata» vede la creazione e poi l'esito della mail del trigger.
        await watcher.waitFor(
          () => watcher.snapshots.some((data) => data?.registrationStatus === "pending_parent_authorization") || watcher.errors.length > 0,
          "snapshot con l'iscrizione",
        );
        const current = await stored(path);
        await adminDb.doc(path).update({
          parentAuthorization: emailSentState(current.answers.parentAuthorizationRequest),
          roomPreferenceMatches: roomMatches(),
        });
        await watcher.waitFor(
          () => watcher.snapshots.some((data) => data?.parentAuthorization?.status === "email_sent") || watcher.errors.length > 0,
          "snapshot con email_sent",
        );
        assert.deepEqual(watcher.errors, []);
      } finally {
        watcher.unsubscribe();
      }
      t.diagnostic(note);
    });

    test("attività B: prima l'iscrizione del figlio, poi quella propria", async (t) => {
      const child = await submitRegistration(actor, activityB, childLookup(me(), sofia.id), editorSubmitInput({ ...sofia, birthDate: "2013-01-20", unitName: "Unità Due" }, account));
      assert.equal(child.branch, "setDoc");
      assert.equal(child.saved.registrationStatus, "pending_parent_authorization");
      assert.equal(child.saved.unitId, "unita-2", "l'unità del figlio non è quella del titolare");
      const watcher = watchRegistration(actor, activityB, child.registrationId);
      try {
        await watcher.waitFor(() => watcher.snapshots.length > 0 || watcher.errors.length > 0, "primo snapshot");
        assert.deepEqual(watcher.errors, []);
        assert.equal(watcher.snapshots[0]?.registrationStatus, "pending_parent_authorization");
      } finally {
        watcher.unsubscribe();
      }

      const own = await submitRegistration(actor, activityB, ownLookup(me()), ownEditorInput(owner));
      assert.equal(own.branch, "setDoc");
      assert.equal(own.saved.registrationStatus, "active");
      assert.equal((await stored(`users/${me()}`)).role, ACTORS[owner].role);
      // L'iscrizione del figlio non è cambiata.
      assert.deepEqual(await stored(registrationPath(activityB, child.registrationId)), child.payload);
      t.diagnostic(note);
    });

    test("Famiglia: l'elenco per parentUid ha le iscrizioni dei figli e non quelle proprie", async (t) => {
      const snapshot = await listFamilyRegistrations(actor, me());
      const paths = snapshot.docs.map((item) => item.ref.path);
      assert.deepEqual([...paths].sort(), await adminFamilyPaths(me()));
      assert.ok(paths.includes(registrationPath(activityA, childRegistrationId(me(), nicola.id))));
      assert.ok(paths.includes(registrationPath(activityB, childRegistrationId(me(), sofia.id))));
      assert.ok(!paths.some((value) => value.endsWith(`/user_${me()}`)), "niente iscrizioni proprie");
      for (const item of snapshot.docs) assert.equal(item.data().parentUid, me(), item.ref.path);
      t.diagnostic(note);
    });

    test("«Già iscritto» con le iscrizioni presenti, e findLatestParentDetails su un'attività senza iscrizioni", async (t) => {
      const child = await getRegistrationByActor(actor, activityA, childLookup(me(), nicola.id));
      assert.equal(child?.childId, nicola.id);
      assert.equal(child?.registrationStatus, "pending_parent_authorization");
      const own = await getRegistrationByActor(actor, activityA, ownLookup(me()));
      assert.equal(own?.userId, me());
      assert.equal(await getRegistrationByActor(actor, activityC, childLookup(me(), nicola.id)), null);
      assert.equal(await getRegistrationByActor(actor, activityC, ownLookup(me())), null);
      t.diagnostic(note);
    });

    test("«Gestisci» dopo la mail del trigger: updateDoc sul figlio e sull'iscrizione propria", async (t) => {
      const childId = childRegistrationId(me(), nicola.id);
      const childPathA = registrationPath(activityA, childId);
      const before = await stored(childPathA);
      assert.equal(before.parentAuthorization.status, "email_sent");
      const result = await upsertRegistration(
        actor,
        activityA,
        childLookup(me(), nicola.id),
        editorSubmitInput(nicola, account, { phone: "3479999999", answerChanges: { roomNotes: "Letto in basso, grazie." } }),
      );
      assert.equal(result.branch, "updateDoc");
      const after = await stored(childPathA);
      assert.equal(after.phone, "3479999999");
      assert.equal(after.answers.roomNotes, "Letto in basso, grazie.");
      assert.equal(after.registrationStatus, "pending_parent_authorization");
      assert.deepEqual(after.parentAuthorization, before.parentAuthorization, "parentAuthorization intatto");
      assert.equal(after.roomPreferenceMatches.roomPreference1Name.status, "matched");
      assert.equal(after.createdAt, before.createdAt);

      const own = await upsertRegistration(actor, activityA, ownLookup(me()), ownEditorInput(owner, { phone: "3358889999" }));
      assert.equal(own.branch, "updateDoc");
      assert.equal(own.saved.phone, "3358889999");
      assert.equal(own.saved.registrationStatus, "active");
      t.diagnostic(note);
    });

    test("Famiglia annulla l'iscrizione del figlio e il figlio si reiscrive; l'iscrizione propria non si muove", async (t) => {
      const childId = childRegistrationId(me(), nicola.id);
      const childPathA = registrationPath(activityA, childId);
      const ownPathA = registrationPath(activityA, `user_${me()}`);
      const ownBefore = await stored(ownPathA);
      const before = await stored(childPathA);
      const startedAt = nowIso();

      const cancelled = await cancelRegistrationById(actor, activityA, childId);
      assert.equal(cancelled.registrationStatus, "cancelled");
      assertOnlyCancelled(before, await stored(childPathA), startedAt);
      assert.deepEqual(await stored(ownPathA), ownBefore, "l'iscrizione propria resta com'è");

      // «Annullata» resta nell'elenco della famiglia, con lo stato nuovo.
      const family = await listFamilyRegistrations(actor, me());
      assert.equal(family.docs.find((item) => item.ref.path === childPathA)?.data().registrationStatus, "cancelled");

      // Reiscrizione: senza firma si riparte dal genitore.
      const again = await upsertRegistration(actor, activityA, childLookup(me(), nicola.id), editorSubmitInput(nicola, account));
      assert.equal(again.branch, "updateDoc");
      assert.equal((await stored(childPathA)).registrationStatus, "pending_parent_authorization");

      // Il contrario: annullare l'iscrizione propria lascia quella del figlio.
      const childBefore = await stored(childPathA);
      const ownCancelled = await cancelRegistrationById(actor, activityA, `user_${me()}`);
      assert.equal(ownCancelled.registrationStatus, "cancelled");
      assert.deepEqual(await stored(childPathA), childBefore);
      const ownAgain = await upsertRegistration(actor, activityA, ownLookup(me()), ownEditorInput(owner));
      assert.equal(ownAgain.saved.registrationStatus, "active");
      assert.deepEqual(await stored(childPathA), childBefore, "il figlio non è toccato dalla reiscrizione propria");
      t.diagnostic(note);
    });

    test("iscrizione figlio «massima» (firma, stanza, pattuglia, ogni campo): annulla, si reiscrive, «Gestisci»", async (t) => {
      const activityD = await seedActivity();
      const heavyChild = await createChild(
        actor,
        me(),
        childInput({ firstName: "Massimo", lastName: ACTORS[owner].lastName }),
        newChildDraft(actor, me()),
      );
      const lookup = childLookup(me(), heavyChild.id);
      const registrationId = childRegistrationId(me(), heavyChild.id);
      const path = registrationPath(activityD, registrationId);
      await adminDb.doc(path).set(maximalChildRegistration(me(), heavyChild, account));
      const seeded = await stored(path);
      assert.ok(Object.keys(seeded.answers).length >= 49, `risposte (${Object.keys(seeded.answers).length})`);

      // Lettura e ascolto dal vivo del documento pesante.
      assert.equal((await getRegistrationByActor(actor, activityD, lookup)).accessCode, "ACC-1234");
      const watcher = watchRegistration(actor, activityD, registrationId);
      try {
        await watcher.waitFor(() => watcher.snapshots.length > 0 || watcher.errors.length > 0, "primo snapshot");
        assert.deepEqual(watcher.errors, []);
        assert.equal(watcher.snapshots[0]?.registrationStatus, "confirmed");
      } finally {
        watcher.unsubscribe();
      }

      // «Gestisci» sul documento confermato.
      const saved = await upsertRegistration(
        actor,
        activityD,
        lookup,
        editorSubmitInput(heavyChild, account, { registrationStatus: "confirmed", phone: "3475550000" }),
      );
      assert.equal(saved.branch, "updateDoc");
      const afterSave = await stored(path);
      assert.equal(afterSave.phone, "3475550000");
      assert.equal(afterSave.registrationStatus, "confirmed");
      assert.deepEqual(afterSave.parentAuthorization, seeded.parentAuthorization);
      assert.equal(afterSave.accessCode, "ACC-1234");

      // Annullamento da Famiglia: payload del client, documento pesante.
      const startedAt = nowIso();
      await cancelRegistrationById(actor, activityD, registrationId);
      const cancelled = await stored(path);
      assertOnlyCancelled(afterSave, cancelled, startedAt);
      assert.deepEqual(cancelled.parentAuthorization, seeded.parentAuthorization);
      assert.equal(cancelled.assignedRoomName, "Stanza 12");

      // Reiscrizione: la firma c'era, torna attiva senza ripassare dal genitore.
      const again = await upsertRegistration(actor, activityD, lookup, editorSubmitInput(heavyChild, account));
      assert.equal(again.branch, "updateDoc");
      const reactivated = await stored(path);
      assert.equal(reactivated.registrationStatus, "active");
      assert.deepEqual(reactivated.parentAuthorization, seeded.parentAuthorization);
      assert.equal(reactivated.parentIdDocumentPath, seeded.parentIdDocumentPath);

      // E ancora: annulla, poi cambia idea.
      await cancelRegistrationById(actor, activityD, registrationId);
      await upsertRegistration(actor, activityD, lookup, editorSubmitInput(heavyChild, account));
      assert.equal((await stored(path)).registrationStatus, "active");
      t.diagnostic(note);
    });

    if (owner === "exGenitore") {
      test("ex genitore: i figli e l'iscrizione di prima della conversione restano suoi", async (t) => {
        const registrationId = childRegistrationId(me(), legacy.luca.id);
        const path = registrationPath(legacy.activityId, registrationId);
        const list = await listChildren(actor, me());
        const ids = list.docs.map((item) => item.id);
        assert.ok(ids.includes(legacy.luca.id) && ids.includes(legacy.giulia.id), "i figli di prima sono nell'elenco");
        assert.equal((await getChild(actor, me(), legacy.giulia.id)).data().fullName, "Giulia Rossi");

        const family = await listFamilyRegistrations(actor, me());
        assert.ok(family.docs.some((item) => item.ref.path === path), "l'iscrizione di prima è in Famiglia");
        assert.equal((await getRegistrationByActor(actor, legacy.activityId, childLookup(me(), legacy.luca.id)))?.childId, legacy.luca.id);

        const watcher = watchRegistration(actor, legacy.activityId, registrationId);
        try {
          await watcher.waitFor(() => watcher.snapshots.length > 0 || watcher.errors.length > 0, "primo snapshot");
          assert.deepEqual(watcher.errors, []);
          assert.equal(watcher.snapshots[0]?.registrationStatus, "pending_parent_authorization");
        } finally {
          watcher.unsubscribe();
        }

        const account = await readAccount(actor);
        await updateChild(actor, me(), legacy.luca.id, childInput({ firstName: "Luca", lastName: "Rossi", birthDate: "2012-05-10" }));
        const resaved = await upsertRegistration(actor, legacy.activityId, childLookup(me(), legacy.luca.id), editorSubmitInput(legacy.luca, account, { phone: "3470001111" }));
        assert.equal(resaved.branch, "updateDoc");
        assert.equal((await stored(path)).phone, "3470001111");

        const before = await stored(path);
        const startedAt = nowIso();
        await cancelRegistrationById(actor, legacy.activityId, registrationId);
        assertOnlyCancelled(before, await stored(path), startedAt);
        await upsertRegistration(actor, legacy.activityId, childLookup(me(), legacy.luca.id), editorSubmitInput(legacy.luca, account));
        assert.equal((await stored(path)).registrationStatus, "pending_parent_authorization");
        assert.equal((await stored(`users/${me()}`)).role, "participant");
        t.diagnostic("consentito: la rule non guarda il ruolo, e il figlio e l'iscrizione scritti da genitore restano gestibili dopo la conversione");
      });
    }
  });
}

// ===========================================================================
// 2. Campeggio: dirigente di unità e admin valutano altri rami (staff del campo)
// ===========================================================================

for (const owner of OWNERS) {
  describe(`2. ${ACTORS[owner].label}: giro completo su un campeggio`, () => {
    test("figlio e iscrizione propria → firma → «Gestisci» → annulla → reiscrizione", async (t) => {
      const activityId = await seedActivity({ type: "camp" });
      const { path } = await childLifecycle(owner, activityId, { name: "Campeggio" });
      assert.equal((await stored(path)).registrationStatus, "active");
      const family = await listFamilyRegistrations(owner, uid(owner));
      assert.ok(family.docs.some((item) => item.ref.path === path));
      t.diagnostic(
        owner === "admin"
          ? NOTE_ADMIN
          : owner === "dirigente"
            ? "consentito: sul campeggio il dirigente è anche staff del campo, e il ramo del titolare passa lo stesso"
            : "consentito",
      );
    });
  });
}

// ===========================================================================
// 3. Il ramo del titolare, senza il ramo admin: un admin di un altro palo
// ===========================================================================

describe("3. admin di un altro palo che iscrive un figlio su un'attività di questo palo (ramo del titolare senza isStakeAdmin)", () => {
  const actor = "adminAltroPalo";

  test("sul palo dell'attività non ha poteri da admin: non legge le iscrizioni altrui", async () => {
    const activityId = await seedActivity();
    await adminDb.doc(registrationPath(activityId, "user_estraneo")).set({ fullName: "Estraneo", unitId: "unita-1" });
    await expectDenied(() => readRegistration(actor, activityId, "user_estraneo"), "iscrizione altrui");
  });

  for (const type of ["trip", "camp"]) {
    test(`figlio → iscrizione → firma → «Gestisci» → annulla → reiscrizione su un ${type === "trip" ? "viaggio" : "campeggio"}`, async () => {
      const activityId = await seedActivity({ type });
      // Senza iscrizione propria: il riallineamento del profilo sposterebbe il palo di un account privilegiato.
      const { path } = await childLifecycle(actor, activityId, { withOwn: false, name: "Altropalo" });
      assert.equal((await stored(path)).registrationStatus, "active");
    });
  }
});

// ===========================================================================
// 4. Gli altri account non toccano figli e iscrizioni del titolare
// ===========================================================================

for (const victim of OWNERS) {
  describe(`4. i figli e le iscrizioni di ${ACTORS[victim].label} restano suoi`, () => {
    const me = () => uid(victim);
    let activityId;
    let child;
    let registrationId;
    let path;
    let account;

    before(async () => {
      account = await readAccount(victim);
      activityId = await seedActivity();
      child = await createChild(
        victim,
        me(),
        childInput({ firstName: "Riservato", lastName: ACTORS[victim].lastName }),
        newChildDraft(victim, me()),
      );
      const saved = await submitRegistration(victim, activityId, childLookup(me(), child.id), editorSubmitInput(child, account));
      registrationId = saved.registrationId;
      path = registrationPath(activityId, registrationId);
    });

    for (const outsider of OUTSIDERS) {
      const who = ACTORS[outsider]?.label ?? "un utente non autenticato";

      describe(who, () => {
        test("figli: elenco, lettura, creazione, modifica e cancellazione negati", async () => {
          const before = await stored(childPath(me(), child.id));
          const count = (await adminDb.collection(`users/${me()}/children`).get()).size;
          await expectDenied(() => listChildren(outsider, me()), "listChildren");
          await expectDenied(() => getChild(outsider, me(), child.id), "getChild");
          await expectDenied(() => getChild(outsider, me(), "figlio-che-non-esiste"), "getChild inesistente");
          await expectDenied(
            () => createChild(outsider, me(), childInput({ firstName: "Intruso" }), newChildDraft(outsider, me())),
            "createChild",
          );
          await expectDenied(
            () => updateChild(outsider, me(), child.id, childInput({ firstName: "Intruso" })),
            "updateChild",
          );
          await expectDenied(() => deleteChild(outsider, me(), child.id), "deleteChild");
          assert.deepEqual(await stored(childPath(me(), child.id)), before);
          assert.equal((await adminDb.collection(`users/${me()}/children`).get()).size, count, "nessun figlio in più");
        });

        test("iscrizione: lettura (esistente e mancante) e ascolto dal vivo negati", async () => {
          await expectDenied(() => readRegistration(outsider, activityId, registrationId), "iscrizione esistente");
          await expectDenied(
            () => readRegistration(outsider, activityId, childRegistrationId(me(), "altro-figlio")),
            "iscrizione mancante",
          );
          const watcher = watchRegistration(outsider, activityId, registrationId);
          try {
            await watcher.waitFor(() => watcher.errors.length > 0 || watcher.snapshots.length > 0, "esito dell'ascolto");
            assert.equal(watcher.snapshots.length, 0, "nessun dato consegnato");
            assert.equal(watcher.errors[0]?.code, "permission-denied");
          } finally {
            watcher.unsubscribe();
          }
        });

        test("iscrizione: annullamento, «Gestisci», cancellazione e creazione a nome del titolare negati", async () => {
          const before = await stored(path);
          await expectDenied(() => cancelRegistrationById(outsider, activityId, registrationId), "annullamento");
          await expectDenied(
            () => updateDoc(registrationRef(outsider, activityId, registrationId), resaveFields(before, "pending_parent_authorization", { phone: "3330000001" })),
            "«Gestisci»",
          );
          await expectDenied(() => deleteDoc(registrationRef(outsider, activityId, registrationId)), "cancellazione");
          await expectDenied(
            () => updateDoc(registrationRef(outsider, activityId, registrationId), { parentUid: uid(outsider), updatedAt: nowIso() }),
            "intestarsi l'iscrizione",
          );
          assert.deepEqual(await stored(path), before);

          // Iscrivere un figlio non suo: a nome del titolare (parentUid) e a nome proprio col childId altrui.
          const otherChild = await createChild(victim, me(), childInput({ firstName: "Secondo", lastName: ACTORS[victim].lastName }), newChildDraft(victim, me()));
          const input = editorSubmitInput(otherChild, account);
          const asVictim = buildRegistrationPayload(childLookup(me(), otherChild.id), input, { id: "unita-1", name: "Unità Uno" }, null, nowIso());
          const victimId = childRegistrationId(me(), otherChild.id);
          await expectDenied(() => setDoc(registrationRef(outsider, activityId, victimId), asVictim), "a nome del titolare");
          assert.equal(await stored(registrationPath(activityId, victimId)), undefined);
          if (outsider !== "nonAutenticato") {
            const asOutsider = buildRegistrationPayload(childLookup(uid(outsider), otherChild.id), input, { id: "unita-1", name: "Unità Uno" }, null, nowIso());
            const ownId = childRegistrationId(uid(outsider), otherChild.id);
            await expectDenied(() => setDoc(registrationRef(outsider, activityId, ownId), asOutsider), "col childId altrui");
            assert.equal(await stored(registrationPath(activityId, ownId)), undefined);
          }
        });

        test("Famiglia: collection group con il parentUid del titolare, o senza filtro, negato", async () => {
          await expectDenied(() => listFamilyRegistrations(outsider, me()), "parentUid altrui");
          await expectDenied(() => getDocsFromServer(collectionGroup(fs(outsider), "registrations")), "senza filtro");
          if (outsider !== "nonAutenticato") {
            // Controllo positivo: la stessa query col proprio uid passa e non porta documenti altrui.
            const own = await listFamilyRegistrations(outsider, uid(outsider));
            assert.ok(!own.docs.some((item) => item.ref.path === path), "niente iscrizioni del titolare");
            for (const item of own.docs) assert.equal(item.data().parentUid, uid(outsider));
          }
        });
      });
    }
  });
}

// ===========================================================================
// 5. Perimetro che esiste già (non cambia con la fase 6)
// ===========================================================================

describe("5. chi già oggi vede le iscrizioni dei figli per il proprio ruolo (comportamento in produzione, non nuovo)", () => {
  let tripId;
  let campId;
  let child;
  let tripPath;
  let campPath;

  before(async () => {
    const account = await readAccount("adulto");
    tripId = await seedActivity();
    campId = await seedActivity({ type: "camp" });
    child = await createChild("adulto", uid("adulto"), childInput({ firstName: "Perimetro", lastName: "Bianchi" }), newChildDraft("adulto", uid("adulto")));
    const trip = await submitRegistration("adulto", tripId, childLookup(uid("adulto"), child.id), editorSubmitInput(child, account));
    const camp = await submitRegistration("adulto", campId, childLookup(uid("adulto"), child.id), editorSubmitInput(child, account));
    tripPath = registrationPath(tripId, trip.registrationId);
    campPath = registrationPath(campId, camp.registrationId);
  });

  test("admin dello stesso palo: legge figlio e iscrizione (supporto), come per un genitore", async () => {
    assert.equal((await getChild("admin", uid("adulto"), child.id)).exists(), true);
    assert.equal((await readRegistration("admin", tripId, childRegistrationId(uid("adulto"), child.id))).exists(), true);
  });

  test("dirigente della stessa unità del figlio: legge l'iscrizione, non il profilo del figlio, e non la annulla", async () => {
    const registrationId = childRegistrationId(uid("adulto"), child.id);
    assert.equal((await readRegistration("dirigente", tripId, registrationId)).exists(), true, "stessa unità: legge");
    await expectDenied(() => getChild("dirigente", uid("adulto"), child.id), "profilo del figlio");
    const before = await stored(tripPath);
    await expectDenied(() => cancelRegistrationById("dirigente", tripId, registrationId), "annullamento");
    assert.deepEqual(await stored(tripPath), before);
  });

  test("campeggio: ogni dirigente del palo è staff del campo, quindi legge anche le iscrizioni di un'altra unità; non le annulla", async () => {
    const registrationId = childRegistrationId(uid("adulto"), child.id);
    assert.equal(
      (await readRegistration("dirigenteAltraUnita", campId, registrationId)).exists(),
      true,
      "isCampStaffOfActivity: staff del campo",
    );
    const before = await stored(campPath);
    await expectDenied(() => cancelRegistrationById("dirigenteAltraUnita", campId, registrationId), "annullamento");
    assert.deepEqual(await stored(campPath), before);
    // Sul viaggio, dove non c'è staff del campo, lo stesso dirigente non legge (sezione 4).
    await expectDenied(() => readRegistration("dirigenteAltraUnita", tripId, registrationId), "viaggio");
  });
});
