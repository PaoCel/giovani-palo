// Consensi foto e social: callable `parentAuthorizationConfirm` (validazione delle
// due scelte), `parentConsentGetContext`, `parentConsentUpdate` (genitore con
// account e link senza account) e `parentConsentRequestCompletion` (admin),
// provate negli emulatori con utenti VERI dell'Auth emulator e le callable vere
// (SDK client -> Functions emulator). L'Admin SDK serve solo per seminare e per
// ispezionare lo stato, perché ignora le rules.
//
// Rilancio dalla radice del repository (emulatori Auth 9199, Firestore 8180,
// Functions 5101, Storage 9299). Lo Storage serve: la conferma salva la firma e
// senza bucket muore su "bucket does not exist" (lezione del 2026-09):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --config firebase.multistake-test.json --project demo-consent-test \
//     'node --test --test-concurrency=1 functions/tests/parentConsentEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse in un file temporaneo (il test legge gli host dalle variabili
// d'ambiente che imposta emulators:exec) e rimuovilo a fine prova.
//
// Copre anche expectedUpdatedAt (scheda vecchia respinta con consent_stale), il
// consentUpdatedAt grezzo del contesto pubblico e le corse durante l'invio dei
// completamenti (iscrizione annullata, email cambiata, prenotazione altrui),
// expectedUpdatedAt obbligatorio, digest dell'elenco e stato di invio (sending/sent).
// Conferma con un altro link pendente della stessa iscrizione (un reinvio partito
// durante la firma): quello della firma diventa used, l'altro invalidated con
// token_invalidated, il link dello stesso figlio in un'altra attività resta.
//
// Le email sono simulate: fuori produzione partono solo verso EMAIL_ALLOWLIST e
// negli emulatori non è impostata, quindi nessuna mail esce (getEmailPolicy in
// functions/lib/config.js). Dati sintetici con ids unici per run.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");
const { PNG } = require("pngjs");
const {
  CONSENT_TEXT_VERSION,
  deriveConsentLinkStatus,
  hashLinkToken,
  issueConsentLink,
} = require("../lib/consentCore.js");
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
hostOf(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "Storage");
const FUNCTIONS = hostOf(process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5101", "Functions");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const STAKE = `consent-${runId}`; // conferma, cambio scelte, link
const STAKE_COMPLETION = `consent-comp-${runId}`; // richiesta di completamento
const STAKE_BATCH = `consent-batch-${runId}`; // tetto dei 100 destinatari
const STAKE_RACE = `consent-race-${runId}`; // corse durante l'invio dei completamenti
const STAKE_CLAIM = `consent-claim-${runId}`; // prenotazione sending/sent
const OTHER_STAKE = `consent-other-${runId}`;
const MY_STAKES = [STAKE, STAKE_COMPLETION, STAKE_BATCH, STAKE_RACE, STAKE_CLAIM];
const ACTIVITY = "gita";
const ACTIVITY_2 = "gita2";
const PASSWORD = `Pw-${runId}-consent!`; // credenziale di test, vale solo nell'emulatore
const PARENT_EMAIL = "genitore@example.invalid";
const SEEDED_AT = "2026-10-01T00:00:00.000Z";
const PAST = "2026-01-01T00:00:00.000Z";

const regPath = (stake, activity, id) => `stakes/${stake}/activities/${activity}/registrations/${id}`;

// ---------------------------------------------------------------------------
// Client e callable
// ---------------------------------------------------------------------------

const apps = [];

/** Utente vero dell'Auth emulator (o sessione non autenticata se `email` è null). */
async function makeClient(name, { signIn = true } = {}) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.host}:${AUTH.port}`, { disableWarnings: true });
  if (signIn) {
    await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, PASSWORD);
  }
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  return {
    uid: auth.currentUser?.uid ?? null,
    call: async (callable, data) => (await httpsCallable(functions, callable)(data)).data,
  };
}

async function expectCallError(promise, code, { reason, message } = {}) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${code}`, `${error?.code}: ${error?.message}`);
    if (reason !== undefined) assert.equal(error.details?.reason, reason);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Semina e ispezione
// ---------------------------------------------------------------------------

/** Iscrizione già firmata. `photo`/`social` undefined = campo assente (firma pre-obbligo). */
function signedRegistration(id, { photo, social, parentUid = null, parentEmail = PARENT_EMAIL, extra = {}, state = {} } = {}) {
  const parentAuthorization = {
    status: "authorized",
    parentFirstName: "Genitore",
    parentLastName: "Test",
    parentEmail,
    authorizedAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    ...state,
  };
  if (photo !== undefined) parentAuthorization.photoConsent = photo;
  if (social !== undefined) parentAuthorization.socialPublicationConsent = social;
  return {
    fullName: `Figlio ${id}`,
    birthDate: "2012-02-26",
    genderRoleCategory: "giovane_donna",
    registrationStatus: "confirmed",
    parentUid,
    updatedAt: SEEDED_AT,
    parentAuthorization,
    ...extra,
  };
}

/** Iscrizione in attesa della firma, con token pendente. Ritorna il token in chiaro. */
async function seedPendingSignature(id, stake = STAKE) {
  const rawToken = `${runId}-${id}-`.padEnd(64, "a");
  const tokenHash = hashLinkToken(rawToken); // stesso sha256 di hashToken in parentAuthorization.js
  await adminDb.doc(`parentAuthorizationTokens/${tokenHash}`).set({
    id: tokenHash,
    tokenHash,
    stakeId: stake,
    activityId: ACTIVITY,
    registrationId: id,
    parentEmail: PARENT_EMAIL,
    participantName: `Figlio ${id}`,
    activityTitle: "Gita di test",
    status: "pending",
    createdAt: SEEDED_AT,
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    usedAt: null,
    invalidatedAt: null,
    createdByUserId: null,
    createdByMode: "system",
  });
  await adminDb.doc(regPath(stake, ACTIVITY, id)).set({
    fullName: `Figlio ${id}`,
    birthDate: "2012-02-26",
    genderRoleCategory: "giovane_donna",
    registrationStatus: "submitted", // non pending_parent_authorization: eviterebbe il trigger di invio mail
    updatedAt: SEEDED_AT,
    parentAuthorization: {
      status: "email_sent",
      tokenId: tokenHash,
      parentFirstName: "Genitore",
      parentLastName: "Test",
      parentEmail: PARENT_EMAIL,
      parentPhone: "3330000000",
    },
  });
  return { rawToken, tokenHash };
}

/**
 * Un altro token pendente con lo stesso registrationId: il link di un reinvio
 * partito durante la firma (stessa attività) o lo stesso figlio iscritto a
 * un'altra attività. Ritorna l'hash.
 */
async function seedOtherPendingToken(id, { activityId = ACTIVITY, label, stake = STAKE }) {
  const tokenHash = hashLinkToken(`${runId}-${id}-${label}-`.padEnd(64, "b"));
  await adminDb.doc(`parentAuthorizationTokens/${tokenHash}`).set({
    id: tokenHash,
    tokenHash,
    stakeId: stake,
    activityId,
    registrationId: id,
    parentEmail: PARENT_EMAIL,
    participantName: `Figlio ${id}`,
    activityTitle: "Gita di test",
    status: "pending",
    createdAt: SEEDED_AT,
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    usedAt: null,
    invalidatedAt: null,
    createdByUserId: null,
    createdByMode: "system",
  });
  return tokenHash;
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

const allConsents = () => Object.fromEntries(PARENT_CONSENT_CHECKBOXES.map((item) => [item.key, true]));

const getReg = async (stake, activity, id) => (await adminDb.doc(regPath(stake, activity, id)).get()).data();

async function auditRows(stake, activity, registrationId, event) {
  const snapshot = await adminDb.collection(`stakes/${stake}/activities/${activity}/consentAuditLogs`).get();
  return snapshot.docs
    .map((doc) => doc.data())
    .filter((row) => row.registrationId === registrationId && (!event || row.event === event));
}

async function tasksOf(stake, activity, registrationId) {
  const snapshot = await adminDb.collection(`stakes/${stake}/activities/${activity}/consentTasks`).get();
  return snapshot.docs.map((doc) => doc.data()).filter((task) => task.registrationId === registrationId);
}

async function linksOf(registrationId, kind) {
  const snapshot = await adminDb.collection("parentConsentLinks").where("registrationId", "==", registrationId).get();
  return snapshot.docs
    .map((doc) => doc.data())
    .filter((link) => MY_STAKES.includes(link.stakeId) && (!kind || link.kind === kind));
}

const newLink = (stake, registrationId, parentEmail = PARENT_EMAIL, activityId = ACTIVITY) =>
  issueConsentLink(adminDb, { stakeId: stake, activityId, registrationId, parentEmail, kind: "test" });

/** Simulazione + invio reale con numero e digest visti in simulazione (come fa il client). */
async function realSend(client, request, overrides = {}) {
  const dry = await client.call("parentConsentRequestCompletion", { ...request, dryRun: true });
  return client.call("parentConsentRequestCompletion", {
    ...request,
    dryRun: false,
    expectedCount: dry.total,
    expectedDigest: dry.digest,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Attori
// ---------------------------------------------------------------------------

const who = {};
const SEEDED_USERS = ["admin", "superAdmin", "otherAdmin", "participant"];

before(async () => {
  const [genitore, estraneo, admin, superAdmin, otherAdmin, participant, senzaProfilo, anonimo] = await Promise.all([
    makeClient("genitore"),
    makeClient("estraneo"),
    makeClient("admin"),
    makeClient("superadmin"),
    makeClient("otheradmin"),
    makeClient("participant"),
    makeClient("senzaprofilo"),
    makeClient("anonimo", { signIn: false }),
  ]);
  Object.assign(who, { genitore, estraneo, admin, superAdmin, otherAdmin, participant, senzaProfilo, anonimo });

  await Promise.all([
    adminDb.doc(`users/${admin.uid}`).set({ role: "admin", stakeId: STAKE_COMPLETION }),
    adminDb.doc(`users/${superAdmin.uid}`).set({ role: "super_admin", stakeId: OTHER_STAKE }),
    adminDb.doc(`users/${otherAdmin.uid}`).set({ role: "admin", stakeId: OTHER_STAKE }),
    adminDb.doc(`users/${participant.uid}`).set({ role: "participant", stakeId: STAKE_COMPLETION }),
    ...MY_STAKES.map((stake) => adminDb.doc(`stakes/${stake}`).set({ name: `Palo ${stake}` })),
    ...MY_STAKES.map((stake) =>
      adminDb.doc(`stakes/${stake}/activities/${ACTIVITY}`).set({
        title: "Gita di test",
        startDate: "2026-10-16T14:00:00.000Z",
        endDate: "2026-10-17T16:00:00.000Z",
        status: "registrations_open",
      }),
    ),
    adminDb.doc(`stakes/${STAKE_COMPLETION}/activities/${ACTIVITY_2}`).set({
      title: "Seconda gita",
      startDate: "2026-11-16T14:00:00.000Z",
      status: "registrations_open",
    }),
  ]);
});

after(async () => {
  try {
    for (const stake of MY_STAKES) {
      await adminDb.recursiveDelete(adminDb.doc(`stakes/${stake}`));
      for (const collectionName of ["parentConsentLinks", "parentAuthorizationTokens"]) {
        const leftovers = await adminDb.collection(collectionName).where("stakeId", "==", stake).get();
        await Promise.all(leftovers.docs.map((doc) => doc.ref.delete()));
      }
    }
    await Promise.all(
      SEEDED_USERS.map((name) => adminDb.doc(`users/${who[name]?.uid}`).delete()),
    );
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// (a) parentAuthorizationConfirm
// ===========================================================================

describe("parentAuthorizationConfirm: le due scelte sono obbligatorie", () => {
  const INVALID = [
    ["not_answered su entrambe", { photoConsent: "not_answered", socialPublicationConsent: "not_answered" }, "consent_required"],
    ["scelte assenti (scheda aperta prima del rilascio)", {}, "consent_required"],
    ["solo la foto", { photoConsent: "accepted" }, "consent_required"],
    ["solo il social", { socialPublicationConsent: "refused" }, "consent_required"],
    ["foto not_answered e social refused", { photoConsent: "not_answered", socialPublicationConsent: "refused" }, "consent_required"],
    ["revoked non è una scelta ammessa", { photoConsent: "revoked", socialPublicationConsent: "refused" }, "consent_required"],
    ["valore inventato", { photoConsent: "forse", socialPublicationConsent: "accepted" }, "consent_required"],
    ["booleani al posto delle stringhe", { photoConsent: true, socialPublicationConsent: true }, "consent_required"],
    ["social sì con foto no", { photoConsent: "refused", socialPublicationConsent: "accepted" }, "social_needs_photo"],
  ];

  for (const [label, choices, reason] of INVALID) {
    test(`rifiuta ${label} senza consumare il token`, async () => {
      const id = `conf-bad-${reason}-${Math.random().toString(36).slice(2, 7)}`;
      const { rawToken, tokenHash } = await seedPendingSignature(id);

      await expectCallError(
        who.anonimo.call("parentAuthorizationConfirm", {
          token: rawToken,
          consents: allConsents(),
          signatureDataUrl: signatureDataUrl(),
          ...choices,
        }),
        "invalid-argument",
        {
          reason,
          message:
            reason === "consent_required"
              ? "Scegli una risposta per le foto e per i social"
              : "Per pubblicare sui social serve anche il consenso alle foto",
        },
      );

      const token = (await adminDb.doc(`parentAuthorizationTokens/${tokenHash}`).get()).data();
      assert.equal(token.status, "pending", "il token non è consumato");
      assert.equal(token.usedAt, null);
      const registration = await getReg(STAKE, ACTIVITY, id);
      assert.equal(registration.parentAuthorization.status, "email_sent", "firma non registrata");
      assert.equal(registration.parentAuthorization.photoConsent, undefined);
      assert.equal(registration.registrationStatus, "submitted");
      assert.deepEqual(await auditRows(STAKE, ACTIVITY, id), [], "nessuna riga di audit");

      // Il genitore corregge la scheda e riprova con lo stesso link: deve poter firmare.
      const retry = await who.anonimo.call("parentAuthorizationConfirm", {
        token: rawToken,
        consents: allConsents(),
        signatureDataUrl: signatureDataUrl(),
        photoConsent: "refused",
        socialPublicationConsent: "refused",
      });
      assert.equal(retry.ok, true);
    });
  }

  test("conferma valida salva scelte, versione del testo, data e una riga di audit", async () => {
    const id = "conf-ok";
    const { rawToken, tokenHash } = await seedPendingSignature(id);
    const before = Date.now();

    const result = await who.anonimo.call("parentAuthorizationConfirm", {
      token: rawToken,
      consents: allConsents(),
      signatureDataUrl: signatureDataUrl(),
      photoConsent: "accepted",
      socialPublicationConsent: "refused",
    });
    assert.equal(result.ok, true);

    const registration = await getReg(STAKE, ACTIVITY, id);
    const state = registration.parentAuthorization;
    assert.equal(state.status, "authorized");
    assert.equal(state.photoConsent, "accepted");
    assert.equal(state.socialPublicationConsent, "refused", "social no alla firma resta refused, non revoked");
    assert.equal(state.consentTextVersion, CONSENT_TEXT_VERSION);
    assert.equal(typeof state.consentUpdatedAt, "string");
    assert.equal(state.consentUpdatedAt, state.authorizedAt, "alla firma la data delle scelte è quella della firma");
    assert.ok(new Date(state.consentUpdatedAt).getTime() >= before - 1000);
    assert.equal(registration.registrationStatus, "confirmed");
    assert.equal(state.parentEmail, PARENT_EMAIL, "i dati del genitore non vanno persi");

    const token = (await adminDb.doc(`parentAuthorizationTokens/${tokenHash}`).get()).data();
    assert.equal(token.status, "used");

    const audit = await auditRows(STAKE, ACTIVITY, id, "parent_authorized");
    assert.equal(audit.length, 1);
    assert.equal(audit[0].photoConsent, "accepted");
    assert.equal(audit[0].socialPublicationConsent, "refused");
    assert.equal(audit[0].consentTextVersion, CONSENT_TEXT_VERSION);
    assert.equal(audit[0].consentVia, "signature");
    assert.equal(audit[0].tokenId, tokenHash);

    const links = await linksOf(id, "signed_copy");
    assert.equal(links.length, 1, "un link di gestione scelte nella copia firmata");
    assert.equal(links[0].parentEmail, PARENT_EMAIL);

    // Il token è usato: una seconda conferma non passa.
    await expectCallError(
      who.anonimo.call("parentAuthorizationConfirm", {
        token: rawToken,
        consents: allConsents(),
        signatureDataUrl: signatureDataUrl(),
        photoConsent: "accepted",
        socialPublicationConsent: "accepted",
      }),
      "failed-precondition",
    );
  });

  test("conferma valida con foto sì e social sì, e con tutti no", async () => {
    for (const [id, photo, social] of [
      ["conf-yy", "accepted", "accepted"],
      ["conf-nn", "refused", "refused"],
    ]) {
      const { rawToken } = await seedPendingSignature(id);
      const result = await who.anonimo.call("parentAuthorizationConfirm", {
        token: rawToken,
        consents: allConsents(),
        signatureDataUrl: signatureDataUrl(),
        photoConsent: photo,
        socialPublicationConsent: social,
      });
      assert.equal(result.ok, true);
      const state = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;
      assert.equal(state.photoConsent, photo);
      assert.equal(state.socialPublicationConsent, social);
      assert.equal(state.consentTextVersion, CONSENT_TEXT_VERSION);
      const audit = await auditRows(STAKE, ACTIVITY, id, "parent_authorized");
      assert.equal(audit.length, 1);
      assert.equal(audit[0].photoConsent, photo);
    }
  });
});

// Un reinvio partito mentre il genitore firmava lasciava valido il link nuovo:
// la sua mail chiedeva una seconda firma.
describe("parentAuthorizationConfirm: un altro link pendente della stessa iscrizione", () => {
  const getToken = async (hash) => (await adminDb.doc(`parentAuthorizationTokens/${hash}`).get()).data();

  test("firma con il link annotato: usato quello, invalidato l'altro con audit, intatto il link di un'altra attività", async () => {
    const id = "conf-doppio";
    const { rawToken, tokenHash } = await seedPendingSignature(id);
    const reinvio = await seedOtherPendingToken(id, { label: "reinvio" });
    const altraAttivita = await seedOtherPendingToken(id, { activityId: "gita-altra", label: "altra" });

    const result = await who.anonimo.call("parentAuthorizationConfirm", {
      token: rawToken,
      consents: allConsents(),
      signatureDataUrl: signatureDataUrl(),
      photoConsent: "accepted",
      socialPublicationConsent: "refused",
    });
    assert.equal(result.ok, true);

    assert.equal((await getReg(STAKE, ACTIVITY, id)).parentAuthorization.status, "authorized");
    assert.equal((await getToken(tokenHash)).status, "used", "link della firma");
    assert.equal((await getToken(reinvio)).status, "invalidated", "il link del reinvio non vale più");
    assert.deepEqual(
      (await auditRows(STAKE, ACTIVITY, id, "token_invalidated")).map((row) => row.tokenId),
      [reinvio],
      "token_invalidated del solo link superato",
    );
    assert.equal((await getToken(altraAttivita)).status, "pending", "link dell'altra attività");
    assert.deepEqual(await auditRows(STAKE, "gita-altra", id), [], "nessun evento nell'altra attività");
  });
});

// ===========================================================================
// (b) parentConsentUpdate: genitore con account
// ===========================================================================

describe("parentConsentUpdate: genitore con account", () => {
  // expectedUpdatedAt è obbligatorio: null = la firma non ha ancora un consentUpdatedAt.
  const data = (id, photoConsent, socialPublicationConsent, stake = STAKE, extra = {}) => ({
    stakeId: stake,
    activityId: ACTIVITY,
    registrationId: id,
    photoConsent,
    socialPublicationConsent,
    expectedUpdatedAt: null,
    ...extra,
  });

  test("accepted -> refused diventa revoked, con data, audit, compito e iscrizione aggiornata", async () => {
    const id = "fam-revoke";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(
      signedRegistration(id, {
        photo: "accepted",
        social: "accepted",
        parentUid: who.genitore.uid,
        state: { consentTextVersion: "v1-vecchia", tokenId: "tok-originale" },
      }),
    );
    const before = Date.now();

    const result = await who.genitore.call("parentConsentUpdate", data(id, "refused", "refused"));
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.photoConsent, "revoked");
    assert.equal(result.socialPublicationConsent, "revoked");

    const registration = await getReg(STAKE, ACTIVITY, id);
    const state = registration.parentAuthorization;
    assert.equal(state.photoConsent, "revoked");
    assert.equal(state.socialPublicationConsent, "revoked");
    assert.equal(state.consentTextVersion, CONSENT_TEXT_VERSION);
    assert.ok(new Date(state.consentUpdatedAt).getTime() >= before - 1000);
    assert.notEqual(state.consentUpdatedAt, SEEDED_AT);
    assert.ok(registration.updatedAt > SEEDED_AT, "registration.updatedAt aggiornato");
    assert.equal(registration.updatedAt, state.consentUpdatedAt);
    // Il resto della firma non si tocca.
    assert.equal(state.status, "authorized");
    assert.equal(state.authorizedAt, SEEDED_AT);
    assert.equal(state.tokenId, "tok-originale");
    assert.equal(state.parentEmail, PARENT_EMAIL);
    assert.equal(registration.registrationStatus, "confirmed");

    const audit = await auditRows(STAKE, ACTIVITY, id, "consent_updated");
    assert.equal(audit.length, 1);
    assert.equal(audit[0].previousPhotoConsent, "accepted");
    assert.equal(audit[0].previousSocialPublicationConsent, "accepted");
    assert.equal(audit[0].photoConsent, "revoked");
    assert.equal(audit[0].socialPublicationConsent, "revoked");
    assert.equal(audit[0].consentTextVersion, CONSENT_TEXT_VERSION);
    assert.equal(audit[0].consentVia, "family");
    assert.equal(audit[0].actorUserId, who.genitore.uid);
    assert.equal(audit[0].parentEmail, PARENT_EMAIL);

    const tasks = await tasksOf(STAKE, ACTIVITY, id);
    assert.equal(tasks.length, 1, "UN solo compito anche se si revocano entrambi i consensi");
    assert.equal(tasks[0].kind, "photo_consent_revoked");
    assert.equal(tasks[0].status, "todo");
    assert.equal(tasks[0].title, `Consenso foto revocato per Figlio ${id}: controlla album e social`);
    assert.equal(tasks[0].participantName, `Figlio ${id}`);
    assert.equal(tasks[0].stakeId, STAKE);
    assert.equal(tasks[0].activityId, ACTIVITY);
    assert.equal(tasks[0].doneAt, null);
    assert.equal(tasks[0].doneByUid, null);
    assert.equal(typeof tasks[0].createdAt, "string");
    assert.equal(typeof tasks[0].id, "string");

    const receipt = await linksOf(id, "receipt");
    assert.equal(receipt.length, 1, "ricevuta con link per cambiare di nuovo");

    // Secondo invio identico: niente di nuovo.
    const stampedAt = state.consentUpdatedAt;
    const again = await who.genitore.call(
      "parentConsentUpdate",
      data(id, "refused", "refused", STAKE, { expectedUpdatedAt: stampedAt }),
    );
    assert.equal(again.ok, true);
    assert.equal(again.changed, false);
    assert.equal(again.photoConsent, "revoked", "revoked -> refused resta revoked");
    assert.equal(again.socialPublicationConsent, "revoked");
    assert.equal(again.receiptSent, false);
    assert.equal((await tasksOf(STAKE, ACTIVITY, id)).length, 1, "nessun secondo compito");
    assert.equal((await auditRows(STAKE, ACTIVITY, id, "consent_updated")).length, 1, "nessuna seconda riga di audit");
    assert.equal((await linksOf(id, "receipt")).length, 1, "nessuna seconda ricevuta");
    assert.equal((await getReg(STAKE, ACTIVITY, id)).parentAuthorization.consentUpdatedAt, state.consentUpdatedAt);
  });

  test("revoca solo del social: compito social, foto invariata", async () => {
    const id = "fam-social";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(
      signedRegistration(id, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid }),
    );

    const result = await who.genitore.call("parentConsentUpdate", data(id, "accepted", "refused"));
    assert.equal(result.changed, true);
    assert.equal(result.photoConsent, "accepted");
    assert.equal(result.socialPublicationConsent, "revoked");

    const tasks = await tasksOf(STAKE, ACTIVITY, id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].kind, "social_consent_revoked");
    assert.equal(tasks[0].title, `Consenso social revocato per Figlio ${id}: controlla i post pubblicati`);
    assert.equal(tasks[0].status, "todo");
  });

  test("da refused a accepted ridà il consenso senza compiti", async () => {
    const id = "fam-regrant";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(
      signedRegistration(id, { photo: "refused", social: "refused", parentUid: who.genitore.uid }),
    );
    const result = await who.genitore.call("parentConsentUpdate", data(id, "accepted", "accepted"));
    assert.equal(result.changed, true);
    assert.equal(result.photoConsent, "accepted");
    assert.deepEqual(await tasksOf(STAKE, ACTIVITY, id), []);
    const audit = await auditRows(STAKE, ACTIVITY, id, "consent_updated");
    assert.equal(audit[0].previousPhotoConsent, "refused");
  });

  test("scelte non valide: errore e nessuna scrittura", async () => {
    const id = "fam-invalid";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(
      signedRegistration(id, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid }),
    );
    for (const [photo, social, reason] of [
      ["not_answered", "refused", "consent_required"],
      ["revoked", "revoked", "consent_required"],
      [undefined, undefined, "consent_required"],
      ["refused", "accepted", "social_needs_photo"],
    ]) {
      await expectCallError(
        who.genitore.call("parentConsentUpdate", data(id, photo, social)),
        "invalid-argument",
        { reason },
      );
    }
    const state = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;
    assert.equal(state.photoConsent, "accepted");
    assert.equal(state.socialPublicationConsent, "accepted");
    assert.deepEqual(await auditRows(STAKE, ACTIVITY, id, "consent_updated"), []);
    assert.deepEqual(await tasksOf(STAKE, ACTIVITY, id), []);
  });

  test("un altro utente (non parentUid) riceve permission-denied e nulla cambia", async () => {
    const id = "fam-stranger";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(
      signedRegistration(id, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid }),
    );
    await expectCallError(
      who.estraneo.call("parentConsentUpdate", data(id, "refused", "refused")),
      "permission-denied",
    );
    // Anche un admin del palo che non è il genitore non passa da questa strada.
    await expectCallError(
      who.superAdmin.call("parentConsentUpdate", data(id, "refused", "refused")),
      "permission-denied",
    );
    const state = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;
    assert.equal(state.photoConsent, "accepted");
    assert.deepEqual(await tasksOf(STAKE, ACTIVITY, id), []);
    assert.deepEqual(await auditRows(STAKE, ACTIVITY, id, "consent_updated"), []);
  });

  test("iscrizione senza genitore con account: nemmeno un utente qualsiasi la cambia", async () => {
    const id = "fam-noparent";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(signedRegistration(id, { photo: "accepted", social: "accepted" }));
    await expectCallError(
      who.estraneo.call("parentConsentUpdate", data(id, "refused", "refused")),
      "permission-denied",
    );
  });

  test("iscrizione non firmata: failed-precondition", async () => {
    const id = "fam-unsigned";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set({
      fullName: `Figlio ${id}`,
      registrationStatus: "submitted",
      parentUid: who.genitore.uid,
      parentAuthorization: { status: "email_sent", parentEmail: PARENT_EMAIL },
    });
    await expectCallError(
      who.genitore.call("parentConsentUpdate", data(id, "accepted", "accepted")),
      "failed-precondition",
    );
    assert.equal((await getReg(STAKE, ACTIVITY, id)).parentAuthorization.photoConsent, undefined);
  });

  test("senza login e senza token: unauthenticated", async () => {
    await expectCallError(
      who.anonimo.call("parentConsentUpdate", data("fam-revoke", "refused", "refused")),
      "unauthenticated",
    );
    await expectCallError(who.anonimo.call("parentConsentUpdate", {}), "unauthenticated");
  });

  test("parametri mancanti e iscrizione inesistente", async () => {
    await expectCallError(
      who.genitore.call("parentConsentUpdate", { photoConsent: "accepted", socialPublicationConsent: "accepted" }),
      "invalid-argument",
    );
    await expectCallError(
      who.genitore.call("parentConsentUpdate", data("non-esiste", "accepted", "accepted")),
      "not-found",
    );
    // Stesso id ma palo sbagliato: il percorso non esiste.
    await expectCallError(
      who.genitore.call("parentConsentUpdate", data("fam-revoke", "accepted", "accepted", OTHER_STAKE)),
      "not-found",
    );
  });
});

// ===========================================================================
// (c) Link di gestione senza account
// ===========================================================================

describe("link di gestione delle scelte", () => {
  const viaLink = (token, photoConsent, socialPublicationConsent, extra = {}) => ({
    token,
    photoConsent,
    socialPublicationConsent,
    expectedUpdatedAt: null,
    ...extra,
  });

  test("getContext: token valido mostra attività, nome e scelte attuali, senza login", async () => {
    const id = "link-ctx";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(signedRegistration(id, { photo: "accepted" }));
    const { rawToken } = await newLink(STAKE, id);

    const context = await who.anonimo.call("parentConsentGetContext", { token: rawToken });
    assert.equal(context.status, "valid");
    assert.equal(context.activityTitle, "Gita di test");
    assert.equal(context.participantName, `Figlio ${id}`);
    assert.equal(context.photoConsent, "accepted");
    assert.equal(context.socialPublicationConsent, "not_answered", "campo assente = nessuna risposta");
    assert.equal(context.consentUpdatedAt, null, "valore grezzo: la firma senza consentUpdatedAt dà null, non authorizedAt");
    assert.equal(context.activityStartDate, "2026-10-16T14:00:00.000Z");
    // Con il campo presente (firma nuova o cambio successivo) ritorna esattamente quello.
    const stampedId = "link-ctx-stamped";
    await adminDb.doc(regPath(STAKE, ACTIVITY, stampedId)).set(
      signedRegistration(stampedId, { photo: "accepted", social: "refused", state: { consentUpdatedAt: "2026-10-05T09:00:00.000Z" } }),
    );
    const stamped = await newLink(STAKE, stampedId);
    const stampedContext = await who.anonimo.call("parentConsentGetContext", { token: stamped.rawToken });
    assert.equal(stampedContext.consentUpdatedAt, "2026-10-05T09:00:00.000Z");
    assert.equal(stampedContext.socialPublicationConsent, "refused");
    // Il contesto pubblico non deve esporre dati del genitore o altri identificativi.
    for (const key of ["parentEmail", "parentName", "stakeId", "registrationId", "tokenHash"]) {
      assert.equal(key in context, false, `${key} non deve uscire`);
    }
  });

  test("getContext: not_found, expired, mismatch, not_signed e token vuoto", async () => {
    assert.deepEqual(await who.anonimo.call("parentConsentGetContext", { token: "x".repeat(64) }), {
      status: "not_found",
    });

    await expectCallError(who.anonimo.call("parentConsentGetContext", { token: "  " }), "invalid-argument");
    await expectCallError(who.anonimo.call("parentConsentGetContext", {}), "invalid-argument");

    // Scaduto: scadenza nel passato.
    const expiredId = "link-expired";
    await adminDb.doc(regPath(STAKE, ACTIVITY, expiredId)).set(signedRegistration(expiredId, { photo: "accepted", social: "accepted" }));
    const expired = await newLink(STAKE, expiredId);
    await adminDb.doc(`parentConsentLinks/${hashLinkToken(expired.rawToken)}`).update({ expiresAt: PAST });
    assert.deepEqual(await who.anonimo.call("parentConsentGetContext", { token: expired.rawToken }), { status: "expired" });

    // Mail del genitore cambiata dopo l'emissione del link.
    const mismatchId = "link-mismatch";
    await adminDb.doc(regPath(STAKE, ACTIVITY, mismatchId)).set(signedRegistration(mismatchId, { photo: "accepted", social: "accepted" }));
    const mismatch = await newLink(STAKE, mismatchId);
    await adminDb.doc(regPath(STAKE, ACTIVITY, mismatchId)).update({ "parentAuthorization.parentEmail": "nuovo@example.invalid" });
    assert.deepEqual(await who.anonimo.call("parentConsentGetContext", { token: mismatch.rawToken }), { status: "mismatch" });

    // Link invalidato.
    const invalidatedId = "link-invalidated";
    await adminDb.doc(regPath(STAKE, ACTIVITY, invalidatedId)).set(signedRegistration(invalidatedId, { photo: "accepted", social: "accepted" }));
    const invalidated = await newLink(STAKE, invalidatedId);
    await adminDb.doc(`parentConsentLinks/${hashLinkToken(invalidated.rawToken)}`).update({ invalidatedAt: SEEDED_AT });
    assert.deepEqual(await who.anonimo.call("parentConsentGetContext", { token: invalidated.rawToken }), { status: "not_found" });

    // Link per un'iscrizione cancellata.
    const goneId = "link-gone";
    await adminDb.doc(regPath(STAKE, ACTIVITY, goneId)).set(signedRegistration(goneId, { photo: "accepted", social: "accepted" }));
    const gone = await newLink(STAKE, goneId);
    await adminDb.doc(regPath(STAKE, ACTIVITY, goneId)).delete();
    assert.deepEqual(await who.anonimo.call("parentConsentGetContext", { token: gone.rawToken }), { status: "not_found" });

    // Firma non ancora data.
    const unsignedId = "link-unsigned";
    await adminDb.doc(regPath(STAKE, ACTIVITY, unsignedId)).set({
      fullName: `Figlio ${unsignedId}`,
      registrationStatus: "submitted",
      parentAuthorization: { status: "email_sent", parentEmail: PARENT_EMAIL },
    });
    const unsigned = await newLink(STAKE, unsignedId);
    assert.deepEqual(await who.anonimo.call("parentConsentGetContext", { token: unsigned.rawToken }), { status: "not_signed" });
  });

  test("update via link: cambio scelte con audit consentVia link e hash del token", async () => {
    const id = "link-update";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(signedRegistration(id, { photo: "accepted", social: "accepted" }));
    const link = await newLink(STAKE, id);

    const result = await who.anonimo.call("parentConsentUpdate", viaLink(link.rawToken, "accepted", "refused"));
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.photoConsent, "accepted");
    assert.equal(result.socialPublicationConsent, "revoked");

    const state = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;
    assert.equal(state.socialPublicationConsent, "revoked");
    assert.equal(state.consentTextVersion, CONSENT_TEXT_VERSION);

    const audit = await auditRows(STAKE, ACTIVITY, id, "consent_updated");
    assert.equal(audit.length, 1);
    assert.equal(audit[0].consentVia, "link");
    assert.equal(audit[0].actorUserId, null);
    assert.equal(audit[0].tokenId, hashLinkToken(link.rawToken));
    assert.equal(audit[0].previousSocialPublicationConsent, "accepted");

    const tasks = await tasksOf(STAKE, ACTIVITY, id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].kind, "social_consent_revoked");

    // Il link resta valido (un anno): si può cambiare di nuovo, e ripetere non fa danni.
    const stampedAt = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization.consentUpdatedAt;
    const again = await who.anonimo.call(
      "parentConsentUpdate",
      viaLink(link.rawToken, "accepted", "refused", { expectedUpdatedAt: stampedAt }),
    );
    assert.equal(again.changed, false);
    const back = await who.anonimo.call(
      "parentConsentUpdate",
      viaLink(link.rawToken, "accepted", "accepted", { expectedUpdatedAt: stampedAt }),
    );
    assert.equal(back.changed, true);
    assert.equal(back.socialPublicationConsent, "accepted");
    assert.equal((await tasksOf(STAKE, ACTIVITY, id)).length, 1, "tornare a sì non crea compiti");
  });

  test("update via link: il link vale solo per la sua iscrizione, gli id nel corpo sono ignorati", async () => {
    const target = "link-own";
    const victim = "link-victim";
    await adminDb.doc(regPath(STAKE, ACTIVITY, target)).set(signedRegistration(target, { photo: "accepted", social: "accepted" }));
    await adminDb.doc(regPath(STAKE, ACTIVITY, victim)).set(
      signedRegistration(victim, { photo: "accepted", social: "accepted", parentEmail: "altro@example.invalid" }),
    );
    const link = await newLink(STAKE, target);

    const result = await who.anonimo.call(
      "parentConsentUpdate",
      viaLink(link.rawToken, "refused", "refused", { stakeId: STAKE, activityId: ACTIVITY, registrationId: victim }),
    );
    assert.equal(result.changed, true);
    assert.equal((await getReg(STAKE, ACTIVITY, target)).parentAuthorization.photoConsent, "revoked");
    const untouched = (await getReg(STAKE, ACTIVITY, victim)).parentAuthorization;
    assert.equal(untouched.photoConsent, "accepted");
    assert.equal(untouched.socialPublicationConsent, "accepted");
    assert.deepEqual(await tasksOf(STAKE, ACTIVITY, victim), []);
    assert.deepEqual(await auditRows(STAKE, ACTIVITY, victim, "consent_updated"), []);
  });

  test("update via link: link scaduto, mail cambiata, sconosciuto o su iscrizione non firmata", async () => {
    const expiredId = "link-upd-expired";
    await adminDb.doc(regPath(STAKE, ACTIVITY, expiredId)).set(signedRegistration(expiredId, { photo: "accepted", social: "accepted" }));
    const expired = await newLink(STAKE, expiredId);
    await adminDb.doc(`parentConsentLinks/${hashLinkToken(expired.rawToken)}`).update({ expiresAt: PAST });
    await expectCallError(
      who.anonimo.call("parentConsentUpdate", viaLink(expired.rawToken, "refused", "refused")),
      "failed-precondition",
      { reason: "link_expired", message: "Questo link è scaduto. Per riceverne uno nuovo contatta il dirigente della tua unità." },
    );

    const mismatchId = "link-upd-mismatch";
    await adminDb.doc(regPath(STAKE, ACTIVITY, mismatchId)).set(signedRegistration(mismatchId, { photo: "accepted", social: "accepted" }));
    const mismatch = await newLink(STAKE, mismatchId);
    await adminDb.doc(regPath(STAKE, ACTIVITY, mismatchId)).update({ "parentAuthorization.parentEmail": "nuovo@example.invalid" });
    await expectCallError(
      who.anonimo.call("parentConsentUpdate", viaLink(mismatch.rawToken, "refused", "refused")),
      "failed-precondition",
      { reason: "link_mismatch" },
    );

    await expectCallError(
      who.anonimo.call("parentConsentUpdate", viaLink("y".repeat(64), "refused", "refused")),
      "failed-precondition",
      { reason: "link_not_found" },
    );

    const unsignedId = "link-upd-unsigned";
    await adminDb.doc(regPath(STAKE, ACTIVITY, unsignedId)).set({
      fullName: `Figlio ${unsignedId}`,
      registrationStatus: "submitted",
      parentAuthorization: { status: "email_sent", parentEmail: PARENT_EMAIL },
    });
    const unsigned = await newLink(STAKE, unsignedId);
    await expectCallError(
      who.anonimo.call("parentConsentUpdate", viaLink(unsigned.rawToken, "accepted", "accepted")),
      "failed-precondition",
    );

    for (const id of [expiredId, mismatchId]) {
      const state = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;
      assert.equal(state.photoConsent, "accepted", id);
      assert.equal(state.socialPublicationConsent, "accepted", id);
      assert.equal(state.consentUpdatedAt, undefined, `${id}: nessuna scrittura`);
      assert.deepEqual(await tasksOf(STAKE, ACTIVITY, id), [], id);
      assert.deepEqual(await auditRows(STAKE, ACTIVITY, id, "consent_updated"), [], id);
    }
  });

  test("update via link con scelte non valide: invalid-argument", async () => {
    const id = "link-upd-invalid";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(signedRegistration(id, { photo: "accepted", social: "accepted" }));
    const link = await newLink(STAKE, id);
    await expectCallError(
      who.anonimo.call("parentConsentUpdate", viaLink(link.rawToken, "not_answered", "not_answered")),
      "invalid-argument",
      { reason: "consent_required" },
    );
    await expectCallError(
      who.anonimo.call("parentConsentUpdate", viaLink(link.rawToken, "refused", "accepted")),
      "invalid-argument",
      { reason: "social_needs_photo" },
    );
    assert.equal((await getReg(STAKE, ACTIVITY, id)).parentAuthorization.photoConsent, "accepted");
  });

  test("update via link: link invalidato o cancellato prima della scrittura è respinto con link_not_found", async () => {
    const invalidatedId = "link-tx-invalidated";
    const deletedId = "link-tx-deleted";
    for (const id of [invalidatedId, deletedId]) {
      await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(signedRegistration(id, { photo: "accepted", social: "accepted" }));
    }
    const invalidated = await newLink(STAKE, invalidatedId);
    const deleted = await newLink(STAKE, deletedId);
    await adminDb.doc(`parentConsentLinks/${hashLinkToken(invalidated.rawToken)}`).update({ invalidatedAt: new Date().toISOString() });
    await adminDb.doc(`parentConsentLinks/${hashLinkToken(deleted.rawToken)}`).delete();

    for (const [id, link] of [[invalidatedId, invalidated], [deletedId, deleted]]) {
      await expectCallError(
        who.anonimo.call("parentConsentUpdate", viaLink(link.rawToken, "refused", "refused")),
        "failed-precondition",
        { reason: "link_not_found", message: "Link non valido. Controlla di aver aperto l'ultima email ricevuta." },
      );
      const state = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;
      assert.equal(state.photoConsent, "accepted", id);
      assert.equal(state.consentUpdatedAt, undefined, `${id}: nessuna scrittura`);
      assert.deepEqual(await tasksOf(STAKE, ACTIVITY, id), [], id);
      assert.deepEqual(await auditRows(STAKE, ACTIVITY, id, "consent_updated"), [], id);
    }
    // Il contesto pubblico dice lo stesso.
    assert.deepEqual(await who.anonimo.call("parentConsentGetContext", { token: invalidated.rawToken }), { status: "not_found" });
  });

  test("completamento di una firma con not_answered: nessuna revoca, nessun compito", async () => {
    const yesId = "link-complete-yes";
    const noId = "link-complete-no";
    const mixedId = "link-complete-mixed";
    await adminDb.doc(regPath(STAKE, ACTIVITY, yesId)).set(signedRegistration(yesId, { photo: "not_answered", social: "not_answered" }));
    await adminDb.doc(regPath(STAKE, ACTIVITY, noId)).set(signedRegistration(noId)); // campi assenti
    await adminDb.doc(regPath(STAKE, ACTIVITY, mixedId)).set(signedRegistration(mixedId, { photo: "accepted" }));

    const yes = await newLink(STAKE, yesId);
    const no = await newLink(STAKE, noId);
    const mixed = await newLink(STAKE, mixedId);

    const contextBefore = await who.anonimo.call("parentConsentGetContext", { token: no.rawToken });
    assert.equal(contextBefore.photoConsent, "not_answered");
    assert.equal(contextBefore.socialPublicationConsent, "not_answered");

    const yesResult = await who.anonimo.call("parentConsentUpdate", viaLink(yes.rawToken, "accepted", "accepted"));
    assert.equal(yesResult.changed, true);
    assert.equal(yesResult.photoConsent, "accepted");

    const noResult = await who.anonimo.call("parentConsentUpdate", viaLink(no.rawToken, "refused", "refused"));
    assert.equal(noResult.changed, true);
    assert.equal(noResult.photoConsent, "refused", "da senza risposta a no è refused, non revoked");
    assert.equal(noResult.socialPublicationConsent, "refused");

    const mixedResult = await who.anonimo.call("parentConsentUpdate", viaLink(mixed.rawToken, "accepted", "refused"));
    assert.equal(mixedResult.changed, true);
    assert.equal(mixedResult.photoConsent, "accepted");
    assert.equal(mixedResult.socialPublicationConsent, "refused");

    for (const id of [yesId, noId, mixedId]) {
      assert.deepEqual(await tasksOf(STAKE, ACTIVITY, id), [], `nessun compito per ${id}`);
      const audit = await auditRows(STAKE, ACTIVITY, id, "consent_updated");
      assert.equal(audit.length, 1, id);
      assert.equal(audit[0].previousSocialPublicationConsent, "not_answered", id);
      assert.equal(audit[0].consentVia, "link");
    }
    assert.equal((await getReg(STAKE, ACTIVITY, noId)).parentAuthorization.socialPublicationConsent, "refused");

    // Ora hanno risposto: il contesto del link lo riflette.
    const contextAfter = await who.anonimo.call("parentConsentGetContext", { token: no.rawToken });
    assert.equal(contextAfter.photoConsent, "refused");
    assert.notEqual(contextAfter.consentUpdatedAt, SEEDED_AT);
  });

  test("i link emessi da issueConsentLink si valutano con deriveConsentLinkStatus sullo stesso archivio", async () => {
    const id = "link-derive";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(signedRegistration(id, { photo: "accepted", social: "accepted" }));
    const link = await newLink(STAKE, id);
    const stored = (await adminDb.doc(`parentConsentLinks/${hashLinkToken(link.rawToken)}`).get()).data();
    assert.equal(stored.tokenHash, hashLinkToken(link.rawToken));
    assert.equal("rawToken" in stored, false, "in archivio resta solo l'hash");
    assert.equal(JSON.stringify(stored).includes(link.rawToken), false);
    assert.equal(deriveConsentLinkStatus(stored, await getReg(STAKE, ACTIVITY, id)), "valid");
  });
});

// ===========================================================================
// expectedUpdatedAt: una scheda vecchia non annulla un cambio fatto altrove
// ===========================================================================

describe("parentConsentUpdate: expectedUpdatedAt (consent_stale)", () => {
  const T0 = "2026-10-05T09:00:00.000Z";
  const family = (id, photoConsent, socialPublicationConsent, extra = {}) => ({
    stakeId: STAKE,
    activityId: ACTIVITY,
    registrationId: id,
    photoConsent,
    socialPublicationConsent,
    ...extra,
  });
  const staleOptions = { reason: "consent_stale" };

  async function expectNoWrite(id, { photo, social, updatedAt, audits = 0, tasks = 0 }) {
    const state = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;
    assert.equal(state.photoConsent, photo, `${id}: foto`);
    assert.equal(state.socialPublicationConsent, social, `${id}: social`);
    assert.equal(state.consentUpdatedAt, updatedAt, `${id}: consentUpdatedAt`);
    assert.equal((await auditRows(STAKE, ACTIVITY, id, "consent_updated")).length, audits, `${id}: audit`);
    assert.equal((await tasksOf(STAKE, ACTIVITY, id)).length, tasks, `${id}: compiti`);
  }

  test("scheda vecchia: A cambia sì/sì in no/no, B con la versione vecchia manda sì/no ed è respinto", async () => {
    const id = "stale-family";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(
      signedRegistration(id, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid, state: { consentUpdatedAt: T0 } }),
    );

    // A e B hanno aperto la pagina quando la versione era T0.
    const a = await who.genitore.call("parentConsentUpdate", family(id, "refused", "refused", { expectedUpdatedAt: T0 }));
    assert.equal(a.changed, true);
    assert.equal(a.photoConsent, "revoked");
    const afterA = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;
    assert.notEqual(afterA.consentUpdatedAt, T0);

    await expectCallError(
      who.genitore.call("parentConsentUpdate", family(id, "accepted", "refused", { expectedUpdatedAt: T0 })),
      "failed-precondition",
      staleOptions,
    );
    await expectNoWrite(id, { photo: "revoked", social: "revoked", updatedAt: afterA.consentUpdatedAt, audits: 1, tasks: 1 });

    // Dopo aver riletto (versione di A) B può cambiare.
    const b = await who.genitore.call(
      "parentConsentUpdate",
      family(id, "accepted", "refused", { expectedUpdatedAt: afterA.consentUpdatedAt }),
    );
    assert.equal(b.changed, true);
    assert.equal(b.photoConsent, "accepted");
    assert.equal(b.socialPublicationConsent, "revoked");
    assert.equal((await auditRows(STAKE, ACTIVITY, id, "consent_updated")).length, 2);
  });

  test("stessa versione passa", async () => {
    const id = "stale-same";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(
      signedRegistration(id, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid, state: { consentUpdatedAt: T0 } }),
    );
    const same = await who.genitore.call("parentConsentUpdate", family(id, "accepted", "refused", { expectedUpdatedAt: T0 }));
    assert.equal(same.changed, true);
    assert.equal((await getReg(STAKE, ACTIVITY, id)).parentAuthorization.photoConsent, "accepted");
  });

  test("expectedUpdatedAt assente (client vecchi) è respinto con consent_stale, senza scrivere", async () => {
    const withDate = "stale-absent-dated";
    const withoutDate = "stale-absent-undated";
    await adminDb.doc(regPath(STAKE, ACTIVITY, withDate)).set(
      signedRegistration(withDate, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid, state: { consentUpdatedAt: T0 } }),
    );
    await adminDb.doc(regPath(STAKE, ACTIVITY, withoutDate)).set(
      signedRegistration(withoutDate, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid }),
    );
    // Sia con una firma che ha già una data, sia senza, sia con scelte che cambierebbero qualcosa o niente.
    for (const [id, updatedAt] of [[withDate, T0], [withoutDate, undefined]]) {
      for (const [photo, social] of [["refused", "refused"], ["accepted", "accepted"]]) {
        await expectCallError(
          who.genitore.call("parentConsentUpdate", family(id, photo, social)),
          "failed-precondition",
          staleOptions,
        );
        await expectNoWrite(id, { photo: "accepted", social: "accepted", updatedAt });
      }
    }
    // Stessa regola via link.
    const link = await newLink(STAKE, withoutDate);
    await expectCallError(
      who.anonimo.call("parentConsentUpdate", { token: link.rawToken, photoConsent: "refused", socialPublicationConsent: "refused" }),
      "failed-precondition",
      staleOptions,
    );
    await expectNoWrite(withoutDate, { photo: "accepted", social: "accepted", updatedAt: undefined });
    // E si passa con null, che per una firma senza data è il valore giusto.
    const ok = await who.anonimo.call("parentConsentUpdate", {
      token: link.rawToken, photoConsent: "refused", socialPublicationConsent: "refused", expectedUpdatedAt: null,
    });
    assert.equal(ok.changed, true);
  });

  test("anche un invio che non cambierebbe nulla ma con versione vecchia è respinto", async () => {
    const id = "stale-noop";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(
      signedRegistration(id, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid, state: { consentUpdatedAt: T0 } }),
    );
    await expectCallError(
      who.genitore.call("parentConsentUpdate", family(id, "accepted", "accepted", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" })),
      "failed-precondition",
      staleOptions,
    );
    await expectNoWrite(id, { photo: "accepted", social: "accepted", updatedAt: T0 });
  });

  test("firma senza consentUpdatedAt: null e stringa vuota combaciano, una data no", async () => {
    const id = "stale-null";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(
      signedRegistration(id, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid }),
    );
    // La pagina ha visto "nessuna data" ma qualcuno l'ha già valorizzata? Qui il dato non c'è: una data attesa è vecchia.
    await expectCallError(
      who.genitore.call("parentConsentUpdate", family(id, "refused", "refused", { expectedUpdatedAt: T0 })),
      "failed-precondition",
      staleOptions,
    );
    await expectNoWrite(id, { photo: "accepted", social: "accepted", updatedAt: undefined });

    const withNull = await who.genitore.call("parentConsentUpdate", family(id, "accepted", "refused", { expectedUpdatedAt: null }));
    assert.equal(withNull.changed, true, "null combacia con il campo assente");
    const stamped = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization.consentUpdatedAt;
    assert.equal(typeof stamped, "string");

    // Ora la data c'è: aspettarsi ancora null è una scheda vecchia.
    await expectCallError(
      who.genitore.call("parentConsentUpdate", family(id, "refused", "refused", { expectedUpdatedAt: null })),
      "failed-precondition",
      staleOptions,
    );
    await expectNoWrite(id, { photo: "accepted", social: "revoked", updatedAt: stamped, audits: 1, tasks: 1 });

    const id2 = "stale-empty-string";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id2)).set(
      signedRegistration(id2, { photo: "accepted", social: "accepted", parentUid: who.genitore.uid }),
    );
    const withEmpty = await who.genitore.call("parentConsentUpdate", family(id2, "accepted", "refused", { expectedUpdatedAt: "" }));
    assert.equal(withEmpty.changed, true, "stringa vuota vale null");
  });

  test("via link: il flusso getContext -> update rimanda il consentUpdatedAt grezzo", async () => {
    const id = "stale-link";
    await adminDb.doc(regPath(STAKE, ACTIVITY, id)).set(signedRegistration(id, { photo: "accepted", social: "accepted" }));
    const linkA = await newLink(STAKE, id);
    const linkB = await newLink(STAKE, id);

    const contextA = await who.anonimo.call("parentConsentGetContext", { token: linkA.rawToken });
    const contextB = await who.anonimo.call("parentConsentGetContext", { token: linkB.rawToken });
    assert.equal(contextA.consentUpdatedAt, null);
    assert.equal(contextB.consentUpdatedAt, null);

    const a = await who.anonimo.call("parentConsentUpdate", {
      token: linkA.rawToken, photoConsent: "refused", socialPublicationConsent: "refused", expectedUpdatedAt: contextA.consentUpdatedAt,
    });
    assert.equal(a.changed, true);
    const afterA = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;

    await expectCallError(
      who.anonimo.call("parentConsentUpdate", {
        token: linkB.rawToken, photoConsent: "accepted", socialPublicationConsent: "refused", expectedUpdatedAt: contextB.consentUpdatedAt,
      }),
      "failed-precondition",
      staleOptions,
    );
    await expectNoWrite(id, { photo: "revoked", social: "revoked", updatedAt: afterA.consentUpdatedAt, audits: 1, tasks: 1 });

    const fresh = await who.anonimo.call("parentConsentGetContext", { token: linkB.rawToken });
    assert.equal(fresh.consentUpdatedAt, afterA.consentUpdatedAt);
    assert.equal(fresh.photoConsent, "revoked");
    const b = await who.anonimo.call("parentConsentUpdate", {
      token: linkB.rawToken, photoConsent: "accepted", socialPublicationConsent: "refused", expectedUpdatedAt: fresh.consentUpdatedAt,
    });
    assert.equal(b.changed, true);
  });

  test("dopo la firma dall'app il contesto ritorna consentUpdatedAt = data della firma", async () => {
    const id = "stale-signed";
    const { rawToken } = await seedPendingSignature(id);
    await who.anonimo.call("parentAuthorizationConfirm", {
      token: rawToken,
      consents: allConsents(),
      signatureDataUrl: signatureDataUrl(),
      photoConsent: "accepted",
      socialPublicationConsent: "accepted",
    });
    const state = (await getReg(STAKE, ACTIVITY, id)).parentAuthorization;
    const link = await newLink(STAKE, id);
    const context = await who.anonimo.call("parentConsentGetContext", { token: link.rawToken });
    assert.equal(context.consentUpdatedAt, state.consentUpdatedAt);
    // E con quella versione il primo cambio passa.
    const result = await who.anonimo.call("parentConsentUpdate", {
      token: link.rawToken, photoConsent: "accepted", socialPublicationConsent: "refused", expectedUpdatedAt: context.consentUpdatedAt,
    });
    assert.equal(result.changed, true);
  });
});

// ===========================================================================
// (d) parentConsentRequestCompletion
// ===========================================================================

describe("parentConsentRequestCompletion", () => {
  const S = STAKE_COMPLETION;
  const REQUEST = { stakeId: S, activityId: ACTIVITY };
  const markerOf = async (id, activity = ACTIVITY) => (await getReg(S, activity, id)).parentAuthorization.consentCompletionRequestedAt;

  before(async () => {
    const regs = {
      // Candidati
      "c-none": signedRegistration("c-none", { parentEmail: "c-none@example.invalid" }),
      "c-half": signedRegistration("c-half", { photo: "accepted", social: "not_answered", parentEmail: "c-half@example.invalid" }),
      // Esclusi
      "x-answered": signedRegistration("x-answered", { photo: "accepted", social: "refused", parentEmail: "x-answered@example.invalid" }),
      "x-revoked": signedRegistration("x-revoked", { photo: "revoked", social: "revoked", parentEmail: "x-revoked@example.invalid" }),
      "x-cancelled": signedRegistration("x-cancelled", {
        parentEmail: "x-cancelled@example.invalid",
        extra: { registrationStatus: "cancelled" },
      }),
      "x-cancelled-status": signedRegistration("x-cancelled-status", {
        parentEmail: "x-cancelled-status@example.invalid",
        extra: { status: "cancelled" },
      }),
      "x-noemail": signedRegistration("x-noemail", { parentEmail: "" }),
      "x-already": signedRegistration("x-already", {
        parentEmail: "x-already@example.invalid",
        state: { consentCompletionRequestedAt: "2026-10-10T08:00:00.000Z" },
      }),
      "x-unsigned": {
        fullName: "Figlio x-unsigned",
        registrationStatus: "submitted",
        parentAuthorization: { status: "email_sent", parentEmail: "x-unsigned@example.invalid" },
      },
    };
    await Promise.all(Object.entries(regs).map(([id, data]) => adminDb.doc(regPath(S, ACTIVITY, id)).set(data)));
    await adminDb.doc(regPath(S, ACTIVITY_2, "c-other")).set(signedRegistration("c-other", { parentEmail: "c-other@example.invalid" }));
  });

  test("solo un admin del palo: gli altri ricevono errore", async () => {
    await expectCallError(who.participant.call("parentConsentRequestCompletion", REQUEST), "permission-denied");
    await expectCallError(who.genitore.call("parentConsentRequestCompletion", REQUEST), "permission-denied");
    await expectCallError(who.senzaProfilo.call("parentConsentRequestCompletion", REQUEST), "permission-denied");
    await expectCallError(who.otherAdmin.call("parentConsentRequestCompletion", REQUEST), "permission-denied", {});
    await expectCallError(who.anonimo.call("parentConsentRequestCompletion", REQUEST), "unauthenticated");
    // Anche con dryRun:false e il numero giusto, un non-admin non invia nulla.
    await expectCallError(
      who.participant.call("parentConsentRequestCompletion", { ...REQUEST, dryRun: false, expectedCount: 2 }),
      "permission-denied",
    );
    assert.equal(await markerOf("c-none"), undefined);
    assert.deepEqual(await linksOf("c-none"), []);
  });

  test("senza stakeId: invalid-argument", async () => {
    await expectCallError(who.admin.call("parentConsentRequestCompletion", {}), "invalid-argument");
    await expectCallError(who.admin.call("parentConsentRequestCompletion", { activityId: ACTIVITY }), "invalid-argument");
  });

  test("simulazione di default: elenca i candidati, non invia e non scrive marker", async () => {
    const result = await who.admin.call("parentConsentRequestCompletion", REQUEST);
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.total, 2);
    assert.equal(result.skippedAlreadyRequested, 1);
    assert.equal(result.skippedNoEmail, 1);
    assert.deepEqual(result.candidates.map((c) => c.registrationId).sort(), ["c-half", "c-none"]);
    const half = result.candidates.find((c) => c.registrationId === "c-half");
    assert.deepEqual(half.missing, ["social"]);
    assert.equal(half.parentEmail, "c-half@example.invalid");
    assert.equal(half.participantName, "Figlio c-half");
    assert.equal(half.activityTitle, "Gita di test");
    assert.equal(half.alreadyRequestedAt, null);
    assert.deepEqual(result.candidates.find((c) => c.registrationId === "c-none").missing, ["photo", "social"]);
    assert.equal(result.preview.subject, "Completa le scelte su foto e social - Gita di test");
    assert.ok(Array.isArray(result.preview.paragraphs) && result.preview.paragraphs.length > 0);
    assert.equal(JSON.stringify(result).includes("parent-consent/"), false, "nessun link nell'anteprima");

    // Anche dryRun esplicito e valori "quasi falsi" restano simulazioni: si invia solo con false esatto.
    for (const dryRun of [true, "false", 0, null]) {
      const again = await who.admin.call("parentConsentRequestCompletion", { ...REQUEST, dryRun, expectedCount: 2 });
      assert.equal(again.dryRun, true, `dryRun=${JSON.stringify(dryRun)}`);
    }

    for (const id of ["c-none", "c-half"]) {
      assert.equal(await markerOf(id), undefined, `${id}: nessun marker`);
      assert.deepEqual(await linksOf(id), [], `${id}: nessun link`);
      assert.deepEqual(await auditRows(S, ACTIVITY, id, "consent_completion_requested"), []);
    }
  });

  test("senza activityId la simulazione copre tutte le attività del palo", async () => {
    const result = await who.admin.call("parentConsentRequestCompletion", { stakeId: S });
    assert.equal(result.total, 3);
    assert.deepEqual(result.candidates.map((c) => c.registrationId).sort(), ["c-half", "c-none", "c-other"]);
    const other = result.candidates.find((c) => c.registrationId === "c-other");
    assert.equal(other.activityId, ACTIVITY_2);
    assert.equal(other.activityTitle, "Seconda gita");

    const empty = await who.admin.call("parentConsentRequestCompletion", { stakeId: S, activityId: "non-esiste" });
    assert.equal(empty.total, 0);
    assert.equal(empty.preview, null);
  });

  test("un super_admin può simulare su un palo che non è il suo", async () => {
    const result = await who.superAdmin.call("parentConsentRequestCompletion", REQUEST);
    assert.equal(result.dryRun, true);
    assert.equal(result.total, 2);
  });

  test("dryRun:false senza expectedCount o con numero sbagliato: failed-precondition, nulla parte", async () => {
    for (const expectedCount of [undefined, null, 0, 1, 3, 2.5, "boh", -2]) {
      await expectCallError(
        who.admin.call("parentConsentRequestCompletion", { ...REQUEST, dryRun: false, expectedCount }),
        "failed-precondition",
      );
    }
    for (const id of ["c-none", "c-half"]) {
      assert.equal(await markerOf(id), undefined, `${id}: nessun marker`);
      assert.deepEqual(await linksOf(id), [], `${id}: nessun link`);
    }
  });

  test("la simulazione ritorna il digest: sha256 dell'elenco ordinato activityId/registrationId/parentEmail", async () => {
    const dry = await who.admin.call("parentConsentRequestCompletion", REQUEST);
    assert.match(dry.digest, /^[0-9a-f]{64}$/u);
    const lines = dry.candidates.map((c) => `${c.activityId}/${c.registrationId}/${c.parentEmail}`).sort();
    assert.equal(dry.digest, createHash("sha256").update(lines.join("\n"), "utf8").digest("hex"));
    const again = await who.admin.call("parentConsentRequestCompletion", REQUEST);
    assert.equal(again.digest, dry.digest, "stabile se l'elenco non cambia");
    // Anche l'elenco vuoto ha un digest (sha256 della stringa vuota).
    const empty = await who.admin.call("parentConsentRequestCompletion", { stakeId: S, activityId: "non-esiste" });
    assert.equal(empty.digest, createHash("sha256").update("", "utf8").digest("hex"));
  });

  test("dryRun:false con digest mancante o sbagliato (numero giusto): failed-precondition, nessuna mail", async () => {
    const dry = await who.admin.call("parentConsentRequestCompletion", REQUEST);
    const wrong = "0".repeat(64);
    for (const expectedDigest of [undefined, null, "", "abc", wrong, dry.digest.toUpperCase(), 123]) {
      await expectCallError(
        who.admin.call("parentConsentRequestCompletion", { ...REQUEST, dryRun: false, expectedCount: dry.total, expectedDigest }),
        "failed-precondition",
      );
    }
    for (const id of ["c-none", "c-half"]) {
      assert.equal(await markerOf(id), undefined, `${id}: nessun marker`);
      assert.deepEqual(await linksOf(id), [], `${id}: nessun link`);
      assert.deepEqual(await auditRows(S, ACTIVITY, id, "consent_completion_requested"), [], `${id}: nessun audit`);
    }
  });

  test("email di un destinatario cambiata dopo la simulazione, stesso numero: digest diverso, invio respinto", async () => {
    const dry = await who.admin.call("parentConsentRequestCompletion", REQUEST);
    assert.equal(dry.total, 2);
    const original = "c-half@example.invalid";
    await adminDb.doc(regPath(S, ACTIVITY, "c-half")).update({ "parentAuthorization.parentEmail": "altra-casella@example.invalid" });
    try {
      const changed = await who.admin.call("parentConsentRequestCompletion", REQUEST);
      assert.equal(changed.total, 2, "stesso numero di destinatari");
      assert.notEqual(changed.digest, dry.digest);

      await expectCallError(
        who.admin.call("parentConsentRequestCompletion", { ...REQUEST, dryRun: false, expectedCount: 2, expectedDigest: dry.digest }),
        "failed-precondition",
      );
      for (const id of ["c-none", "c-half"]) {
        assert.equal(await markerOf(id), undefined, `${id}: nessun marker`);
        assert.deepEqual(await linksOf(id), [], `${id}: nessun link`);
        assert.deepEqual(await auditRows(S, ACTIVITY, id, "consent_completion_requested"), [], `${id}: nessuna mail`);
      }
    } finally {
      await adminDb.doc(regPath(S, ACTIVITY, "c-half")).update({ "parentAuthorization.parentEmail": original });
    }
    const restored = await who.admin.call("parentConsentRequestCompletion", REQUEST);
    assert.equal(restored.digest, dry.digest, "ripristinata la mail, torna il digest della simulazione");
  });

  test("invio con il numero giusto: mail simulate, marker, link e audit", async () => {
    const result = await realSend(who.admin, REQUEST);
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, false);
    assert.equal(result.total, 2);
    assert.equal(result.sent, 2);
    assert.equal(result.simulated, 2, "negli emulatori nessuna mail esce davvero");
    assert.deepEqual(result.errors, []);

    for (const id of ["c-none", "c-half"]) {
      const marker = await markerOf(id);
      assert.equal(typeof marker, "string", `${id}: marker scritto`);
      assert.ok(Math.abs(Date.now() - new Date(marker).getTime()) < 60_000);
      const claimed = (await getReg(S, ACTIVITY, id)).parentAuthorization;
      assert.equal(claimed.consentCompletionStatus, "sent", `${id}: stato sent a invio riuscito`);
      assert.match(claimed.consentCompletionClaimId, /^[0-9a-f]{16}$/u);

      const links = await linksOf(id, "completion");
      assert.equal(links.length, 1, `${id}: un link di completamento`);
      assert.equal(links[0].parentEmail, `${id}@example.invalid`);
      assert.equal(
        deriveConsentLinkStatus(links[0], await getReg(S, ACTIVITY, id)),
        "valid",
        `${id}: il link è utilizzabile`,
      );

      const audit = await auditRows(S, ACTIVITY, id, "consent_completion_requested");
      assert.equal(audit.length, 1);
      assert.equal(audit[0].emailProvider, "simulated");
      assert.equal(audit[0].actorUserId, who.admin.uid);
      assert.equal(audit[0].parentEmail, `${id}@example.invalid`);
    }

    // Gli esclusi e l'altra attività non sono stati toccati.
    for (const id of ["x-answered", "x-revoked", "x-cancelled", "x-cancelled-status", "x-noemail", "x-unsigned"]) {
      assert.equal((await getReg(S, ACTIVITY, id)).parentAuthorization.consentCompletionRequestedAt, undefined, id);
      assert.deepEqual(await linksOf(id), [], id);
    }
    assert.equal(await markerOf("x-already"), "2026-10-10T08:00:00.000Z", "il marker precedente non viene sovrascritto");
    assert.equal(await markerOf("c-other", ACTIVITY_2), undefined);
    // Le scelte non sono state toccate dall'invio.
    assert.equal((await getReg(S, ACTIVITY, "c-half")).parentAuthorization.photoConsent, "accepted");
    assert.equal((await getReg(S, ACTIVITY, "c-none")).parentAuthorization.photoConsent, undefined);
  });

  test("il genitore completa dal link della richiesta, poi esce dall'elenco dei candidati", async () => {
    const id = "c-none";
    const link = (await linksOf(id, "completion"))[0];
    assert.ok(link, "serve il link emesso dall'invio");
    // Il token in chiaro non si legge dall'archivio: ne emetto uno equivalente, come la mail.
    const { rawToken } = await newLink(S, id, link.parentEmail);
    const result = await who.anonimo.call("parentConsentUpdate", {
      token: rawToken,
      photoConsent: "refused",
      socialPublicationConsent: "refused",
      expectedUpdatedAt: null,
    });
    assert.equal(result.changed, true);
    assert.equal(result.photoConsent, "refused");
    assert.deepEqual(await tasksOf(S, ACTIVITY, id), [], "completare non crea compiti");

    const resend = await who.admin.call("parentConsentRequestCompletion", { ...REQUEST, resend: true });
    assert.deepEqual(resend.candidates.map((c) => c.registrationId).sort(), ["c-half", "x-already"], "c-none ha risposto");
  });

  test("seconda esecuzione: 0 destinatari (idempotente)", async () => {
    const dry = await who.admin.call("parentConsentRequestCompletion", REQUEST);
    assert.equal(dry.total, 0);
    assert.equal(dry.candidates.length, 0);
    assert.equal(dry.skippedAlreadyRequested, 2, "c-half e x-already (c-none ha risposto)");

    const markerBefore = await markerOf("c-half");
    const linksBefore = (await linksOf("c-half", "completion")).length;

    await expectCallError(
      who.admin.call("parentConsentRequestCompletion", { ...REQUEST, dryRun: false, expectedCount: 2 }),
      "failed-precondition",
    );
    const real = await realSend(who.admin, REQUEST);
    assert.equal(real.total, 0);
    assert.equal(real.sent, 0);
    assert.deepEqual(real.errors, []);

    assert.equal(await markerOf("c-half"), markerBefore, "marker invariato");
    assert.equal((await linksOf("c-half", "completion")).length, linksBefore, "nessun nuovo link");
    assert.equal((await auditRows(S, ACTIVITY, "c-half", "consent_completion_requested")).length, 1, "nessuna nuova riga di audit");
  });

  test("resend:true ripropone i già contattati e li rinvia", async () => {
    const dry = await who.admin.call("parentConsentRequestCompletion", { ...REQUEST, resend: true });
    assert.equal(dry.dryRun, true);
    assert.deepEqual(dry.candidates.map((c) => c.registrationId).sort(), ["c-half", "x-already"]);
    assert.equal(dry.skippedAlreadyRequested, 0);
    const half = dry.candidates.find((c) => c.registrationId === "c-half");
    assert.equal(typeof half.alreadyRequestedAt, "string");

    // resend senza dryRun:false resta una simulazione.
    assert.equal(await markerOf("x-already"), "2026-10-10T08:00:00.000Z");

    const markerBefore = await markerOf("c-half");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const real = await realSend(who.admin, { ...REQUEST, resend: true });
    assert.equal(real.sent, 2);
    assert.equal(real.simulated, 2);
    assert.notEqual(await markerOf("c-half"), markerBefore, "marker aggiornato");
    assert.notEqual(await markerOf("x-already"), "2026-10-10T08:00:00.000Z");
    assert.equal((await linksOf("c-half", "completion")).length, 2, "i link precedenti restano validi, uno nuovo si aggiunge");
    assert.equal((await auditRows(S, ACTIVITY, "c-half", "consent_completion_requested")).length, 2);
  });

  test("l'invio su una sola attività non tocca le altre; poi resta solo quella", async () => {
    assert.equal(await markerOf("c-other", ACTIVITY_2), undefined);
    const wide = await who.admin.call("parentConsentRequestCompletion", { stakeId: S });
    assert.deepEqual(wide.candidates.map((c) => c.registrationId), ["c-other"]);
    assert.equal(wide.skippedAlreadyRequested, 2);
    const real = await realSend(who.admin, { stakeId: S });
    assert.equal(real.sent, 1);
    assert.equal(typeof (await markerOf("c-other", ACTIVITY_2)), "string");
  });

  test("oltre 100 destinatari l'invio è rifiutato anche col numero giusto", async () => {
    const batch = adminDb.batch();
    for (let index = 0; index < 101; index += 1) {
      const id = `b-${String(index).padStart(3, "0")}`;
      batch.set(
        adminDb.doc(regPath(STAKE_BATCH, ACTIVITY, id)),
        signedRegistration(id, { parentEmail: `${id}@example.invalid` }),
      );
    }
    await batch.commit();

    const dry = await who.superAdmin.call("parentConsentRequestCompletion", { stakeId: STAKE_BATCH, activityId: ACTIVITY });
    assert.equal(dry.total, 101);
    await expectCallError(
      who.superAdmin.call("parentConsentRequestCompletion", { stakeId: STAKE_BATCH, activityId: ACTIVITY, dryRun: false, expectedCount: 101, expectedDigest: dry.digest }),
      "failed-precondition",
    );
    const after = await adminDb.collection(`stakes/${STAKE_BATCH}/activities/${ACTIVITY}/registrations`).get();
    assert.equal(
      after.docs.filter((doc) => doc.data().parentAuthorization?.consentCompletionRequestedAt).length,
      0,
      "nessun invio parziale",
    );
  });
});

// ===========================================================================
// (e) Corse durante l'invio dei completamenti
// ===========================================================================
// Il batch rilegge ogni iscrizione dentro la transazione di prenotazione. Per
// provarlo da fuori si cambia lo stato di iscrizioni lontane in coda MENTRE il
// batch gira (si aspetta che la prima sia stata prenotata, poi si modificano le
// ultime): con 40 destinatari il ciclo dura abbastanza da rendere la corsa certa.

describe("parentConsentRequestCompletion: stato cambiato durante l'invio", () => {
  const S = STAKE_RACE;
  const COUNT = 40;
  const idOf = (index) => `r-${String(index).padStart(3, "0")}`;
  const REQUEST = { stakeId: S, activityId: ACTIVITY };
  const marker = async (id) => (await getReg(S, ACTIVITY, id)).parentAuthorization.consentCompletionRequestedAt;

  async function waitFor(condition, label) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timeout: ${label}`);
  }

  before(async () => {
    for (let from = 0; from < COUNT; from += 20) {
      const batch = adminDb.batch();
      for (let index = from; index < from + 20; index += 1) {
        const id = idOf(index);
        batch.set(adminDb.doc(regPath(S, ACTIVITY, id)), signedRegistration(id, { parentEmail: `${id}@example.invalid` }));
      }
      await batch.commit();
    }
  });

  test("annullata, email cambiata o già risposta dopo la lista: quel destinatario non riceve nulla", async () => {
    const dry = await who.superAdmin.call("parentConsentRequestCompletion", REQUEST);
    assert.equal(dry.total, COUNT);

    const running = who.superAdmin.call("parentConsentRequestCompletion", { ...REQUEST, dryRun: false, expectedCount: COUNT, expectedDigest: dry.digest });
    await waitFor(async () => (await marker(idOf(0))) !== undefined, "prima prenotazione");
    // Il batch ha già la lista: da qui in poi cambiano le ultime tre.
    await Promise.all([
      adminDb.doc(regPath(S, ACTIVITY, idOf(COUNT - 1))).update({ registrationStatus: "cancelled" }),
      adminDb.doc(regPath(S, ACTIVITY, idOf(COUNT - 2))).update({ "parentAuthorization.parentEmail": "nuovo@example.invalid" }),
      adminDb.doc(regPath(S, ACTIVITY, idOf(COUNT - 3))).update({
        "parentAuthorization.photoConsent": "accepted",
        "parentAuthorization.socialPublicationConsent": "refused",
      }),
    ]);
    const result = await running;

    assert.equal(result.ok, true);
    assert.equal(result.total, COUNT);
    assert.equal(result.sent, COUNT - 3, "gli altri 37 ricevono la mail");
    assert.equal(result.simulated, COUNT - 3);
    assert.deepEqual(result.errors, [], "saltare una prenotazione non è un errore");

    for (let index = 0; index < COUNT - 3; index += 1) {
      assert.equal(typeof (await marker(idOf(index))), "string", `${idOf(index)} prenotata`);
    }
    for (const index of [COUNT - 1, COUNT - 2, COUNT - 3]) {
      const id = idOf(index);
      assert.equal(await marker(id), undefined, `${id}: nessun marker`);
      assert.deepEqual(await linksOf(id, "completion"), [], `${id}: nessun link`);
      assert.deepEqual(await auditRows(S, ACTIVITY, id, "consent_completion_requested"), [], `${id}: nessun audit`);
    }
    // Chi è stato saltato verso la vecchia email non ha mai ricevuto un link per quell'indirizzo.
    const changed = await getReg(S, ACTIVITY, idOf(COUNT - 2));
    assert.equal(changed.parentAuthorization.parentEmail, "nuovo@example.invalid");
  });

  test("resend:true non rispedisce se un altro invio ha prenotato (sending) dopo l'inizio del batch", async () => {
    // Dopo il primo giro: 37 con marker, r-038 (email nuova, nessun marker, ancora senza risposta).
    const dry = await who.superAdmin.call("parentConsentRequestCompletion", { ...REQUEST, resend: true });
    assert.equal(dry.total, COUNT - 3 + 1, "i 37 già contattati + r-038 con la nuova email");

    const lastId = idOf(COUNT - 2);
    const firstId = idOf(0);
    // Un altro invio che prenota mentre questo gira: stato "sending" fresco.
    const otherSender = new Date().toISOString();
    // r-037 (risposta) e r-039 (annullata) sono fuori lista: r-038 è l'ultimo candidato.
    await adminDb.doc(regPath(S, ACTIVITY, lastId)).update({ "parentAuthorization.consentCompletionRequestedAt": "2026-10-01T00:00:00.000Z" });
    const dryAgain = await who.superAdmin.call("parentConsentRequestCompletion", { ...REQUEST, resend: true });
    assert.equal(dryAgain.total, COUNT - 3 + 1);

    const oldFirst = await marker(firstId);
    const running = who.superAdmin.call("parentConsentRequestCompletion", {
      ...REQUEST, resend: true, dryRun: false, expectedCount: dryAgain.total, expectedDigest: dryAgain.digest,
    });
    await waitFor(async () => (await marker(firstId)) !== oldFirst, "primo marker rinnovato");
    await adminDb.doc(regPath(S, ACTIVITY, lastId)).update({
      "parentAuthorization.consentCompletionRequestedAt": otherSender,
      "parentAuthorization.consentCompletionStatus": "sending",
      "parentAuthorization.consentCompletionClaimId": "altro-invio",
    });
    const result = await running;

    assert.equal(result.total, COUNT - 3 + 1);
    assert.equal(result.sent, COUNT - 3, "l'ultimo, prenotato da un altro invio, non viene rispedito");
    assert.deepEqual(result.errors, []);
    assert.equal(await marker(lastId), otherSender, "il marker dell'altro invio non è sovrascritto");
    const theirs = (await getReg(S, ACTIVITY, lastId)).parentAuthorization;
    assert.equal(theirs.consentCompletionStatus, "sending");
    assert.equal(theirs.consentCompletionClaimId, "altro-invio");
    assert.deepEqual(await linksOf(lastId, "completion"), [], "nessun link per chi è stato saltato");
    assert.notEqual(await marker(firstId), oldFirst, "gli altri sono stati rinnovati");
  });
});

// ===========================================================================
// (f) Prenotazione: consentCompletionStatus sending/sent e claimId
// ===========================================================================

describe("parentConsentRequestCompletion: stato di invio (sending/sent)", () => {
  const S = STAKE_CLAIM;
  const REQUEST = { stakeId: S, activityId: ACTIVITY };
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
  const stateOf = async (id) => (await getReg(S, ACTIVITY, id)).parentAuthorization;
  const ids = ["k-plain", "k-fresh", "k-stale", "k-sent"];

  before(async () => {
    const seed = (id, state = {}) =>
      adminDb.doc(regPath(S, ACTIVITY, id)).set(signedRegistration(id, { parentEmail: `${id}@example.invalid`, state }));
    await Promise.all([
      seed("k-plain"),
      // Invio di un altro batch in corso: prenotato un minuto fa, ancora "sending".
      seed("k-fresh", { consentCompletionRequestedAt: minutesAgo(1), consentCompletionStatus: "sending", consentCompletionClaimId: "claim-fresco" }),
      // "sending" rimasto appeso da 11 minuti (batch morto): si può riprendere.
      seed("k-stale", { consentCompletionRequestedAt: minutesAgo(11), consentCompletionStatus: "sending", consentCompletionClaimId: "claim-vecchio" }),
      // Già spedito ieri.
      seed("k-sent", { consentCompletionRequestedAt: minutesAgo(24 * 60), consentCompletionStatus: "sent", consentCompletionClaimId: "claim-ieri" }),
    ]);
  });

  test("senza resend nessuno dei già prenotati è toccato; la nuova riceve e passa a sent", async () => {
    const dry = await who.superAdmin.call("parentConsentRequestCompletion", REQUEST);
    assert.deepEqual(dry.candidates.map((c) => c.registrationId), ["k-plain"]);
    assert.equal(dry.skippedAlreadyRequested, 3);

    const before = Date.now();
    const result = await realSend(who.superAdmin, REQUEST);
    assert.equal(result.sent, 1);
    assert.deepEqual(result.errors, []);

    const plain = await stateOf("k-plain");
    assert.equal(plain.consentCompletionStatus, "sent");
    assert.equal(typeof plain.consentCompletionRequestedAt, "string", "il marker resta dopo l'invio riuscito");
    assert.ok(new Date(plain.consentCompletionRequestedAt).getTime() >= before - 1000);
    assert.match(plain.consentCompletionClaimId, /^[0-9a-f]{16}$/u);
    assert.equal((await linksOf("k-plain", "completion")).length, 1);

    const fresh = await stateOf("k-fresh");
    assert.equal(fresh.consentCompletionStatus, "sending");
    assert.equal(fresh.consentCompletionClaimId, "claim-fresco");
    assert.equal((await stateOf("k-stale")).consentCompletionClaimId, "claim-vecchio");
    assert.equal((await stateOf("k-sent")).consentCompletionClaimId, "claim-ieri");
  });

  test("resend:true salta chi ha sending fresco, anche se il marker è precedente all'inizio del batch", async () => {
    const freshBefore = await stateOf("k-fresh");
    const staleBefore = await stateOf("k-stale");
    const sentBefore = await stateOf("k-sent");
    const plainBefore = await stateOf("k-plain");

    const dry = await who.superAdmin.call("parentConsentRequestCompletion", { ...REQUEST, resend: true });
    assert.equal(dry.total, 4, "la lista li propone tutti, il filtro del sending avviene alla prenotazione");
    assert.equal(dry.candidates.find((c) => c.registrationId === "k-fresh").alreadyRequestedAt, freshBefore.consentCompletionRequestedAt);

    const batchStart = Date.now();
    const result = await realSend(who.superAdmin, { ...REQUEST, resend: true });
    assert.equal(result.total, 4);
    assert.equal(result.sent, 3, "k-fresh non viene rispedita");
    assert.equal(result.simulated, 3);
    assert.deepEqual(result.errors, [], "saltare una prenotazione non è un errore");

    // sending fresco (marker di un minuto fa, quindi precedente all'inizio di questo batch): intatto.
    const fresh = await stateOf("k-fresh");
    assert.equal(fresh.consentCompletionStatus, "sending");
    assert.equal(fresh.consentCompletionClaimId, "claim-fresco");
    assert.equal(fresh.consentCompletionRequestedAt, freshBefore.consentCompletionRequestedAt);
    assert.deepEqual(await linksOf("k-fresh", "completion"), []);
    assert.deepEqual(await auditRows(S, ACTIVITY, "k-fresh", "consent_completion_requested"), []);

    // sending di 11 minuti fa: ripreso, spedito, ora sent con marker e claim nuovi.
    const stale = await stateOf("k-stale");
    assert.equal(stale.consentCompletionStatus, "sent");
    assert.notEqual(stale.consentCompletionClaimId, staleBefore.consentCompletionClaimId);
    assert.ok(new Date(stale.consentCompletionRequestedAt).getTime() >= batchStart - 1000, "marker rinnovato");
    assert.equal((await linksOf("k-stale", "completion")).length, 1);
    assert.equal((await auditRows(S, ACTIVITY, "k-stale", "consent_completion_requested")).length, 1);

    // già sent: rispedito con resend, resta sent con marker rinnovato.
    const sent = await stateOf("k-sent");
    assert.equal(sent.consentCompletionStatus, "sent");
    assert.notEqual(sent.consentCompletionClaimId, sentBefore.consentCompletionClaimId);
    assert.ok(sent.consentCompletionRequestedAt > sentBefore.consentCompletionRequestedAt);

    const plain = await stateOf("k-plain");
    assert.equal(plain.consentCompletionStatus, "sent");
    assert.notEqual(plain.consentCompletionClaimId, plainBefore.consentCompletionClaimId);
  });

  test("dopo gli invii, senza resend non ci sono più destinatari tranne chi è rimasto in sending", async () => {
    const dry = await who.superAdmin.call("parentConsentRequestCompletion", REQUEST);
    assert.equal(dry.total, 0);
    assert.equal(dry.skippedAlreadyRequested, 4);
    const empty = await realSend(who.superAdmin, REQUEST);
    assert.equal(empty.sent, 0);
    for (const id of ids) {
      const state = await stateOf(id);
      assert.equal(state.consentCompletionStatus, id === "k-fresh" ? "sending" : "sent", id);
    }
  });
});
