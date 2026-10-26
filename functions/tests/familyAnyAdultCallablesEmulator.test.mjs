// Fase 6 del flusso genitore (docs/FLUSSO_GENITORE.md, scelta G2 = a), parte con
// le Functions: «Autorizza ora» (`parentAuthorizationIssueOwnToken`) e il cambio
// delle scelte su foto e social da Famiglia (`parentConsentUpdate` senza token,
// `consentVia: "family"`) per un account adulto che NON è `parent`: partecipante,
// dirigente di unità, admin del palo, ex genitore convertito a `participant`.
// Le callable autorizzano su `registration.parentUid == auth.uid` e non guardano
// il ruolo (functions/lib/parentAuthorization.js, assertCanIssueOwnToken;
// functions/lib/parentConsent.js, ramo `via === "family"`): qui lo si prova con
// le funzioni vere.
//
// Le Rules di Firestore e le altre chiamate del client stanno in
// familyAnyAdultRulesEmulator.test.mjs (solo Firestore, molto più veloce). Questo
// file ha bisogno di Auth, Firestore e Functions, e del runtime delle Functions
// che si scalda per decine di secondi: per questo è un file a parte.
//
// Il percorso è quello vero, come in parentAuthorizationRestartEmulator.test.mjs:
// utenti veri dell'Auth emulator, figlio e iscrizione scritti dal titolare con
// l'SDK client (quindi attraverso le rules), trigger `onRegistrationPendingParentAuth`
// attivo (la prima mail è simulata: fuori produzione partono solo verso
// EMAIL_ALLOWLIST, non impostata negli emulatori), poi la callable dal titolare.
// L'Admin SDK serve solo per seminare profili, palo e attività, per la firma
// (che nel mondo vero la scrive parentAuthorizationConfirm) e per ispezionare.
// Il profilo dell'ex genitore è seminato già `participant`: la conversione
// con le chiamate del client è provata nel file delle rules.
//
// Casi, per ognuno dei quattro titolari:
//  1. il titolare registra il figlio, il trigger manda la prima mail (un link
//     `pending`), poi «Autorizza ora»: token esadecimale a vita breve, il link
//     della mail invalidato (`token_invalidated`), `token_issued_in_app`
//     nell'audit, stato dell'iscrizione invariato, nessuna seconda mail;
//  2. chiunque altro, anche admin dello STESSO palo, admin di un ALTRO palo,
//     dirigente di un'altra unità, un altro adulto: `permission-denied`, e il
//     link della mail resta com'è; senza login: `unauthenticated`;
//  3. iscrizione firmata del figlio: il titolare cambia le scelte foto e social
//     (`parentConsentUpdate`), con audit `consentVia: "family"` e compito agli
//     admin per la revoca; gli altri `permission-denied`.
//
// Rilancio dalla radice del repository (Auth, Firestore, Functions; lo Storage
// non serve):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --config firebase.room-test.json --project demo-family-any-adult \
//     'node --test --test-concurrency=1 functions/tests/familyAnyAdultCallablesEmulator.test.mjs'
// Sul Mac mini, da un worktree: `npm ci && (cd functions && npm ci)` nello
// stesso comando (ogni sync cancella i node_modules ignorati). Con le porte
// occupate da un'altra sessione non fermarla: copia la config su porte diverse
// (auth, firestore, functions, hub, logging, websocket) in un file temporaneo
// nella radice del progetto e rimuovilo a fine prova. Il test legge Auth e
// Firestore dalle variabili d'ambiente di emulators:exec e chiede la porta delle
// Functions all'hub (FIREBASE_EMULATOR_HUB).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, setDoc } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

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
const STAKE = `famiglia-call-${runId}`;
const OTHER_STAKE = `famiglia-call-b-${runId}`;
const PASSWORD = `Pw-${runId}-family!`; // credenziale di test, vale solo nell'emulatore
const SEEDED_AT = "2026-10-01T08:00:00.000Z";
const SIGNED_AT = "2026-10-02T19:30:00.000Z";
const PARENT_EMAIL_DOMAIN = "example.invalid";
const ACTIVITY_TITLE = "Viaggio al tempio di prova";
const nowIso = () => new Date().toISOString();
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Attori. Titolari: gli account che la fase 6 abilita a Famiglia.
// ---------------------------------------------------------------------------

const ACTORS = {
  adulto: { label: "un partecipante adulto (role participant)", role: "participant", stake: STAKE, unitId: "unita-1", category: "accompagnatore", birthDate: "1979-04-24" },
  dirigente: { label: "un dirigente di unità (role unit_leader)", role: "unit_leader", stake: STAKE, unitId: "unita-1", category: "dirigente", birthDate: "1985-09-02" },
  admin: { label: "un admin del palo (role admin)", role: "admin", stake: STAKE, unitId: "unita-1", category: "dirigente", birthDate: "1976-01-30" },
  exGenitore: { label: "un ex genitore convertito a participant (role participant)", role: "participant", stake: STAKE, unitId: "unita-1", category: "accompagnatore", birthDate: "1981-03-14" },
  // Estranei.
  altroAdulto: { label: "un altro partecipante adulto", role: "participant", stake: STAKE, unitId: "unita-1", category: "accompagnatore", birthDate: "1978-11-02" },
  dirigenteAltraUnita: { label: "un dirigente di un'altra unità", role: "unit_leader", stake: STAKE, unitId: "unita-2", category: "dirigente", birthDate: "1983-06-18" },
  adminStessoPalo: { label: "un admin dello stesso palo", role: "admin", stake: STAKE, unitId: "unita-2", category: "dirigente", birthDate: "1970-02-11" },
  adminAltroPalo: { label: "un admin di un altro palo", role: "admin", stake: OTHER_STAKE, unitId: "unita-b1", category: "dirigente", birthDate: "1974-12-05" },
};
const OWNERS = ["adulto", "dirigente", "admin", "exGenitore"];
const OUTSIDERS = ["altroAdulto", "dirigenteAltraUnita", "adminStessoPalo", "adminAltroPalo"];

const who = {};
const apps = [];
const uid = (actor) => who[actor].uid;

/** Utente vero dell'Auth emulator con Firestore e callable, oppure la sessione senza login. */
async function makeClient(name, { signIn = true } = {}) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.host}:${AUTH.port}`, { disableWarnings: true });
  if (signIn) await createUserWithEmailAndPassword(auth, `${name}-${runId}@${PARENT_EMAIL_DOMAIN}`, PASSWORD);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, FIRESTORE.host, FIRESTORE.port);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  return {
    uid: auth.currentUser?.uid ?? null,
    email: signIn ? `${name}-${runId}@${PARENT_EMAIL_DOMAIN}` : null,
    firestore,
    call: async (callable, data) => (await httpsCallable(functions, callable)(data)).data,
  };
}

async function expectCallError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${code}`, `${error?.code}: ${error?.message}`);
    return true;
  });
}

async function waitFor(read, predicate, label, timeoutMs = 60_000) {
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

const regPath = (activityId, registrationId) => `stakes/${STAKE}/activities/${activityId}/registrations/${registrationId}`;
const getReg = async (activityId, registrationId) => (await adminDb.doc(regPath(activityId, registrationId)).get()).data();
const getToken = async (hash) => (await adminDb.doc(`parentAuthorizationTokens/${hash}`).get()).data();

async function tokensOf(activityId, registrationId) {
  const snapshot = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", STAKE).get();
  return snapshot.docs.map((d) => d.data()).filter((t) => t.activityId === activityId && t.registrationId === registrationId);
}

async function auditRows(activityId, registrationId, event) {
  const snapshot = await adminDb.collection(`stakes/${STAKE}/activities/${activityId}/consentAuditLogs`).get();
  return snapshot.docs
    .map((d) => d.data())
    .filter((row) => row.registrationId === registrationId && (!event || row.event === event));
}

/**
 * Aspetta che il trigger si assesti: per `quietMs` di fila l'iscrizione non
 * viene riscritta e i token non cambiano. Il trigger reagisce anche alle
 * proprie scritture, quindi "a regime" vuol dire dopo l'ultima reazione.
 */
async function aRegime(activityId, registrationId, { quietMs = 4000, timeoutMs = 60_000 } = {}) {
  const snapshotOf = async () => {
    const [tokens, reg] = await Promise.all([tokensOf(activityId, registrationId), adminDb.doc(regPath(activityId, registrationId)).get()]);
    return JSON.stringify([tokens.map((t) => `${t.id}:${t.status}`).sort(), reg.updateTime?.toMillis() ?? null]);
  };
  const deadline = Date.now() + timeoutMs;
  let ultima = await snapshotOf();
  let fermaDa = Date.now();
  while (Date.now() < deadline) {
    await pausa(250);
    const attuale = await snapshotOf();
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
// Semina e scritture del titolare (SDK client, quindi rules)
// ---------------------------------------------------------------------------

let activityCounter = 0;
async function newActivity() {
  activityCounter += 1;
  const activityId = `tempio-${activityCounter}`;
  await adminDb.doc(`stakes/${STAKE}/activities/${activityId}`).set({
    title: ACTIVITY_TITLE,
    activityType: "trip",
    overnight: true,
    status: "registrations_open",
    isPublic: true,
    isVisible: true,
    requiresParentAuthorization: true,
    startDate: "2026-11-13T14:00:00.000Z",
    endDate: "2026-11-15T16:00:00.000Z",
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  return activityId;
}

/** Figlio come lo scrive childrenService.createChild (setDoc con draft). */
async function createChildAs(actor, firstName) {
  const reference = doc(who[actor].firestore, "users", uid(actor), "children", `figlio-${firstName.toLowerCase()}-${runId}`);
  const timestamp = nowIso();
  const lastName = "Test";
  await setDoc(reference, {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    birthDate: "2012-05-09",
    genderRoleCategory: "giovane_uomo",
    unitId: "unita-1",
    unitName: "Unità Uno",
    stakeId: STAKE,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return { id: reference.id, firstName, lastName, fullName: `${firstName} ${lastName}` };
}

/**
 * Iscrizione del figlio come la scrive upsertRegistration (setDoc alla prima
 * iscrizione): stato `pending_parent_authorization`, dati del genitore nel
 * blocco `answers.parentAuthorizationRequest`, nessuna `parentAuthorization`
 * (la scrive il trigger dopo la mail).
 */
async function registerChildAs(actor, activityId, child, parentEmail) {
  const registrationId = `child_${uid(actor)}_${child.id}`;
  const timestamp = nowIso();
  await setDoc(doc(who[actor].firestore, "stakes", STAKE, "activities", activityId, "registrations", registrationId), {
    userId: null,
    anonymousUid: null,
    parentUid: uid(actor),
    childId: child.id,
    anonymousTokenId: null,
    firstName: child.firstName,
    lastName: child.lastName,
    fullName: child.fullName,
    email: "",
    phone: "3471234567",
    birthDate: "2012-05-09",
    genderRoleCategory: "giovane_uomo",
    unitId: "unita-1",
    unitNameSnapshot: "Unità Uno",
    answers: {
      birthDate: "2012-05-09",
      genderRoleCategory: "giovane_uomo",
      unitName: "Unità Uno",
      transportMode: "Pullman del palo",
      parentAuthorizationRequest: {
        parentFirstName: "Genitore",
        parentLastName: "Test",
        parentEmail,
        parentPhone: "3330000000",
        emergencyContactName: "Anna Rossi",
        emergencyContactPhone: "3409876543",
        emergencyContactRelation: "nonna",
        allergies: "Graminacee",
        medications: "",
        medicalNotes: "",
        dietaryNotes: "",
        submittedAt: timestamp,
      },
    },
    roomPreferenceMatches: {},
    accessCode: null,
    recoveryCode: null,
    participatingDays: ["2026-11-13", "2026-11-14", "2026-11-15"],
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
    parentAuthorization: null,
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
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return registrationId;
}

/** Iscrizione già firmata dal genitore (scrittura di parentAuthorizationConfirm), con le scelte foto e social date. */
function signedRegistration(parentUid, child, registrationId) {
  return {
    fullName: child.fullName,
    firstName: child.firstName,
    lastName: child.lastName,
    birthDate: "2012-05-09",
    genderRoleCategory: "giovane_uomo",
    registrationStatus: "confirmed",
    submittedByMode: "parent",
    parentUid,
    childId: child.id,
    userId: null,
    unitId: "unita-1",
    updatedAt: SIGNED_AT,
    parentAuthorization: {
      status: "authorized",
      tokenId: `usato-${registrationId}`,
      parentFirstName: "Genitore",
      parentLastName: "Test",
      parentEmail: `genitore@${PARENT_EMAIL_DOMAIN}`,
      authorizedAt: SIGNED_AT,
      photoConsent: "accepted",
      socialPublicationConsent: "accepted",
      updatedAt: SIGNED_AT,
    },
  };
}

// ---------------------------------------------------------------------------
// Avvio e chiusura
// ---------------------------------------------------------------------------

before(async () => {
  const names = [...OWNERS, ...OUTSIDERS];
  const clients = await Promise.all([...names.map((name) => makeClient(name)), makeClient("senza-login", { signIn: false })]);
  names.forEach((name, index) => {
    who[name] = clients[index];
  });
  who.senzaLogin = clients[names.length];

  const stakes = [STAKE, OTHER_STAKE];
  await Promise.all([
    ...stakes.map((stake) => adminDb.doc(`stakes/${stake}`).set({ name: `Palo ${stake}`, slug: stake, isActive: true })),
    adminDb.doc(`stakes/${STAKE}/units/unita-1`).set({ name: "Unità Uno", type: "ward", isActive: true, stakeId: STAKE }),
    adminDb.doc(`stakes/${STAKE}/units/unita-2`).set({ name: "Unità Due", type: "ward", isActive: true, stakeId: STAKE }),
    adminDb.doc(`stakes/${OTHER_STAKE}/units/unita-b1`).set({ name: "Unità B Uno", type: "ward", isActive: true, stakeId: OTHER_STAKE }),
    ...names.map((name) => {
      const data = ACTORS[name];
      return adminDb.doc(`users/${uid(name)}`).set({
        firstName: name,
        lastName: "Prova",
        fullName: `${name} Prova`,
        email: who[name].email,
        phone: "3330001122",
        role: data.role,
        city: "Roma",
        birthDate: data.birthDate,
        genderRoleCategory: data.category,
        unitId: data.unitId,
        unitName: data.unitId === "unita-1" ? "Unità Uno" : data.unitId === "unita-2" ? "Unità Due" : "Unità B Uno",
        stakeId: data.stake,
        stakeSlug: data.stake,
        stakeName: `Palo ${data.stake}`,
        mustChangePassword: false,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
        lastLoginAt: SEEDED_AT,
      });
    }),
  ]);

  // Il primo evento della sessione carica il runtime delle Functions e può
  // richiedere decine di secondi: lo si scalda con una prima iscrizione, così
  // i casi non scambiano un trigger ancora freddo per uno che non fa nulla.
  const activityId = await newActivity();
  const child = await createChildAs("adulto", "Scaldamento");
  const registrationId = await registerChildAs("adulto", activityId, child, `scaldamento@${PARENT_EMAIL_DOMAIN}`);
  await waitFor(
    () => getReg(activityId, registrationId),
    (reg) => typeof reg?.parentAuthorization?.tokenId === "string" && reg.parentAuthorization.status === "email_sent",
    "prima mail del trigger (scaldamento)",
    180_000,
  );
});

after(async () => {
  try {
    for (const stake of [STAKE, OTHER_STAKE]) {
      await adminDb.recursiveDelete(adminDb.doc(`stakes/${stake}`));
      const leftovers = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", stake).get();
      await Promise.all(leftovers.docs.map((d) => d.ref.delete()));
      const links = await adminDb.collection("parentConsentLinks").where("stakeId", "==", stake).get();
      await Promise.all(links.docs.map((d) => d.ref.delete()));
    }
    await Promise.all(
      [...OWNERS, ...OUTSIDERS].map((name) => who[name] && adminDb.recursiveDelete(adminDb.doc(`users/${uid(name)}`))),
    );
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// Controllo: le rules sono caricate
// ===========================================================================

describe("controllo", () => {
  // Una config senza `firestore.rules` fa girare l'emulatore con rules aperte, e
  // le scritture del titolare "passerebbero" senza provare nulla.
  test("le rules sono caricate: un altro adulto non scrive l'iscrizione di un figlio non suo", async () => {
    const activityId = await newActivity();
    const child = await createChildAs("adulto", "Controllo");
    await assert.rejects(
      () => registerChildAs("altroAdulto", activityId, { ...child, id: child.id }, `controllo@${PARENT_EMAIL_DOMAIN}`),
      (error) => {
        assert.equal(error?.code, "permission-denied", `${error?.code}: ${error?.message}`);
        return true;
      },
    );
  });
});

// ===========================================================================
// «Autorizza ora» e cambio delle scelte, per ogni titolare
// ===========================================================================

for (const owner of OWNERS) {
  describe(`${ACTORS[owner].label}: «Autorizza ora» e scelte su foto e social`, () => {
    const me = () => uid(owner);
    const note = owner === "admin"
      ? "le callable controllano solo parentUid: nemmeno l'admin dello stesso palo emette un token per il figlio di un altro"
      : "le callable controllano solo parentUid, non il ruolo";

    test("prima mail del trigger → «Autorizza ora»: token breve, link della mail invalidato, nessuna mail in più", async (t) => {
      const activityId = await newActivity();
      const child = await createChildAs(owner, "Autorizza");
      const parentEmail = `genitore-${owner}@${PARENT_EMAIL_DOMAIN}`.toLowerCase();
      const registrationId = await registerChildAs(owner, activityId, child, parentEmail);

      // Il trigger manda la prima mail (simulata) e annota il link.
      const prima = await waitFor(
        () => getReg(activityId, registrationId),
        (reg) => reg?.parentAuthorization?.status === "email_sent" && typeof reg.parentAuthorization.tokenId === "string",
        "prima mail del trigger",
      );
      await aRegime(activityId, registrationId);
      const vecchioHash = (await getReg(activityId, registrationId)).parentAuthorization.tokenId;
      assert.equal(prima.registrationStatus, "pending_parent_authorization");
      assert.equal((await getToken(vecchioHash)).status, "pending", "il link della mail è vivo");
      const mailPrima = (await auditRows(activityId, registrationId, "email_sent")).length;
      assert.equal(mailPrima, 1, "una sola mail");

      const risposta = await who[owner].call("parentAuthorizationIssueOwnToken", {
        stakeId: STAKE,
        activityId,
        registrationId,
      });
      assert.equal(risposta.ok, true);
      assert.match(risposta.token, /^[0-9a-f]{64}$/u, "token grezzo esadecimale");
      assert.ok(new Date(risposta.expiresAt).getTime() - Date.now() < 2 * 60 * 60 * 1000, "vita breve, non 14 giorni");

      await aRegime(activityId, registrationId);
      const dopo = await getReg(activityId, registrationId);
      assert.equal(dopo.registrationStatus, "pending_parent_authorization", "stato invariato");
      assert.notEqual(dopo.parentAuthorization.tokenId, vecchioHash, "link annotato sostituito");
      assert.equal(typeof dopo.parentAuthorization.selfTokenIssuedAt, "string", "Famiglia lo legge per dire «Riprendi da Autorizza ora»");
      assert.equal(dopo.parentAuthorization.parentEmail, parentEmail);
      assert.equal(dopo.parentUid, me());

      assert.equal((await getToken(vecchioHash)).status, "invalidated", "il link della mail non vale più");
      const nuovo = await getToken(dopo.parentAuthorization.tokenId);
      assert.equal(nuovo.status, "pending");
      assert.equal(nuovo.createdByMode, "self");
      assert.equal(nuovo.createdByUserId, me());
      assert.equal(nuovo.registrationId, registrationId);
      assert.equal(nuovo.stakeId, STAKE);
      const vivi = (await tokensOf(activityId, registrationId)).filter((token) => token.status === "pending");
      assert.equal(vivi.length, 1, "un solo link vivo: quello dell'app");

      const emessi = await auditRows(activityId, registrationId, "token_issued_in_app");
      assert.equal(emessi.length, 1);
      assert.equal(emessi[0].actorUserId, me());
      const invalidati = await auditRows(activityId, registrationId, "token_invalidated");
      assert.deepEqual(invalidati.map((row) => row.tokenId), [vecchioHash]);
      assert.equal(
        (await auditRows(activityId, registrationId, "email_sent")).length,
        mailPrima,
        "«Autorizza ora» non manda nessuna mail",
      );
      t.diagnostic(note);
    });

    test("gli altri account non emettono il token: permission-denied, e il link della mail resta com'è", async () => {
      const activityId = await newActivity();
      const child = await createChildAs(owner, "Riservata");
      const registrationId = await registerChildAs(owner, activityId, child, `genitore-${owner}@${PARENT_EMAIL_DOMAIN}`.toLowerCase());
      await waitFor(
        () => getReg(activityId, registrationId),
        (reg) => reg?.parentAuthorization?.status === "email_sent" && typeof reg.parentAuthorization.tokenId === "string",
        "prima mail del trigger",
      );
      await aRegime(activityId, registrationId);
      const before = await getReg(activityId, registrationId);
      const tokensBefore = (await tokensOf(activityId, registrationId)).map((token) => `${token.id}:${token.status}`).sort();

      for (const outsider of OUTSIDERS) {
        await expectCallError(
          who[outsider].call("parentAuthorizationIssueOwnToken", { stakeId: STAKE, activityId, registrationId }),
          "permission-denied",
        );
      }
      await expectCallError(
        who.senzaLogin.call("parentAuthorizationIssueOwnToken", { stakeId: STAKE, activityId, registrationId }),
        "unauthenticated",
      );
      // Un altro dei quattro titolari, di ruolo diverso, non è il titolare di questa iscrizione.
      const other = OWNERS.find((name) => name !== owner);
      await expectCallError(
        who[other].call("parentAuthorizationIssueOwnToken", { stakeId: STAKE, activityId, registrationId }),
        "permission-denied",
      );

      await pausa(1500);
      assert.deepEqual(await getReg(activityId, registrationId), before, "iscrizione intatta");
      assert.deepEqual(
        (await tokensOf(activityId, registrationId)).map((token) => `${token.id}:${token.status}`).sort(),
        tokensBefore,
        "nessun token nuovo, nessuno invalidato",
      );
      assert.equal((await auditRows(activityId, registrationId, "token_issued_in_app")).length, 0);
    });

    test("iscrizione firmata: il titolare cambia le scelte da Famiglia (consentVia family), gli altri no", async (t) => {
      const activityId = await newActivity();
      const child = await createChildAs(owner, "Firmata");
      const registrationId = `child_${me()}_${child.id}`;
      await adminDb.doc(regPath(activityId, registrationId)).set(signedRegistration(me(), child, registrationId));
      const data = (photoConsent, socialPublicationConsent) => ({
        stakeId: STAKE,
        activityId,
        registrationId,
        photoConsent,
        socialPublicationConsent,
        expectedUpdatedAt: null,
      });

      for (const outsider of OUTSIDERS) {
        await expectCallError(who[outsider].call("parentConsentUpdate", data("refused", "refused")), "permission-denied");
      }
      await expectCallError(who.senzaLogin.call("parentConsentUpdate", data("refused", "refused")), "unauthenticated");
      const untouched = await getReg(activityId, registrationId);
      assert.equal(untouched.parentAuthorization.photoConsent, "accepted", "le scelte non sono cambiate");
      assert.equal((await auditRows(activityId, registrationId, "consent_updated")).length, 0);

      const result = await who[owner].call("parentConsentUpdate", data("refused", "refused"));
      assert.equal(result.ok, true);
      assert.equal(result.changed, true);
      assert.equal(result.photoConsent, "revoked");
      assert.equal(result.socialPublicationConsent, "revoked");

      const state = (await getReg(activityId, registrationId)).parentAuthorization;
      assert.equal(state.photoConsent, "revoked");
      assert.equal(state.socialPublicationConsent, "revoked");
      assert.equal(state.status, "authorized", "la firma non si tocca");
      const audit = await auditRows(activityId, registrationId, "consent_updated");
      assert.equal(audit.length, 1);
      assert.equal(audit[0].consentVia, "family");
      assert.equal(audit[0].actorUserId, me());
      assert.equal(audit[0].previousPhotoConsent, "accepted");
      assert.equal(audit[0].photoConsent, "revoked");
      const tasks = (await adminDb.collection(`stakes/${STAKE}/activities/${activityId}/consentTasks`).get()).docs
        .map((d) => d.data())
        .filter((task) => task.registrationId === registrationId);
      assert.equal(tasks.length, 1, "compito agli admin per la revoca");
      assert.equal(tasks[0].kind, "photo_consent_revoked");
      t.diagnostic(note);
    });
  });
}
