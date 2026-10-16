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
// Le email sono simulate: fuori produzione partono solo verso EMAIL_ALLOWLIST e
// negli emulatori non è impostata, quindi nessuna mail esce (getEmailPolicy in
// functions/lib/config.js). Dati sintetici con ids unici per run.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
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
const OTHER_STAKE = `consent-other-${runId}`;
const MY_STAKES = [STAKE, STAKE_COMPLETION, STAKE_BATCH];
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
    ...[STAKE, STAKE_COMPLETION, STAKE_BATCH].map((stake) => adminDb.doc(`stakes/${stake}`).set({ name: `Palo ${stake}` })),
    ...[STAKE, STAKE_COMPLETION, STAKE_BATCH].map((stake) =>
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
    for (const stake of [STAKE, STAKE_COMPLETION, STAKE_BATCH]) {
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

// ===========================================================================
// (b) parentConsentUpdate: genitore con account
// ===========================================================================

describe("parentConsentUpdate: genitore con account", () => {
  const data = (id, photoConsent, socialPublicationConsent, stake = STAKE) => ({
    stakeId: stake,
    activityId: ACTIVITY,
    registrationId: id,
    photoConsent,
    socialPublicationConsent,
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
    const again = await who.genitore.call("parentConsentUpdate", data(id, "refused", "refused"));
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
    assert.equal(context.consentUpdatedAt, SEEDED_AT, "senza cambi usa la data della firma");
    assert.equal(context.activityStartDate, "2026-10-16T14:00:00.000Z");
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
    const again = await who.anonimo.call("parentConsentUpdate", viaLink(link.rawToken, "accepted", "refused"));
    assert.equal(again.changed, false);
    const back = await who.anonimo.call("parentConsentUpdate", viaLink(link.rawToken, "accepted", "accepted"));
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
      assert.equal((await getReg(STAKE, ACTIVITY, id)).parentAuthorization.photoConsent, "accepted", id);
      assert.deepEqual(await tasksOf(STAKE, ACTIVITY, id), [], id);
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

  test("invio con il numero giusto: mail simulate, marker, link e audit", async () => {
    const result = await who.admin.call("parentConsentRequestCompletion", { ...REQUEST, dryRun: false, expectedCount: 2 });
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
    const result = await who.anonimo.call("parentConsentUpdate", { token: rawToken, photoConsent: "refused", socialPublicationConsent: "refused" });
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
    const real = await who.admin.call("parentConsentRequestCompletion", { ...REQUEST, dryRun: false, expectedCount: 0 });
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
    const real = await who.admin.call("parentConsentRequestCompletion", { ...REQUEST, resend: true, dryRun: false, expectedCount: 2 });
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
    const real = await who.admin.call("parentConsentRequestCompletion", { stakeId: S, dryRun: false, expectedCount: 1 });
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
      who.superAdmin.call("parentConsentRequestCompletion", { stakeId: STAKE_BATCH, activityId: ACTIVITY, dryRun: false, expectedCount: 101 }),
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
