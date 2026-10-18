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
//   - parentAuthorizationResend su iscrizione annullata -> failed-precondition.
//   - selfTokenIssuedAt: scritto da parentAuthorizationIssueOwnToken, azzerato
//     da ogni mail (prima mail del trigger, reinvio del trigger dopo il cambio
//     di email, callable di reinvio).
//
// Rilancio dalla radice del repository (emulatori Auth 9199, Firestore 8180,
// Functions 5101; lo Storage non serve: nessun caso arriva a salvare la firma):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --config firebase.room-test.json --project demo-parent-cancel \
//     'node --test --test-concurrency=1 functions/tests/parentAuthorizationCancelledEmulator.test.mjs'
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

async function waitFor(read, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
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

async function auditEvents(activityId, registrationId) {
  const snapshot = await adminDb.collection(`stakes/${STAKE}/activities/${activityId}/consentAuditLogs`).get();
  return snapshot.docs.map((d) => d.data()).filter((row) => row.registrationId === registrationId).map((row) => row.event);
}

async function tokensOf(activityId, registrationId) {
  const snapshot = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", STAKE).get();
  return snapshot.docs
    .map((d) => d.data())
    .filter((t) => t.activityId === activityId && t.registrationId === registrationId);
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

  test("il reinvio del trigger (email del genitore cambiata dopo «Autorizza ora») lo azzera", async (t) => {
    const { activityId, registrationId } = await seedRegistration("self-cambio-email");
    const { token } = await issueOwnToken(activityId, registrationId);
    const selfHash = hashToken(token);

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

    // Osservazione (non bloccante): quanti link restano vivi dopo il reinvio.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const pending = (await tokensOf(activityId, registrationId)).filter((x) => x.status === "pending");
    t.diagnostic(`link pendenti dopo il reinvio del trigger: ${pending.length}`);
    assert.equal((await getReg(activityId, registrationId)).parentAuthorization.selfTokenIssuedAt, null);
  });

  test("la callable di reinvio dell'admin lo azzera", async (t) => {
    const { activityId, registrationId } = await seedRegistration("self-reinvio");
    const { token } = await issueOwnToken(activityId, registrationId);

    const result = await who.admin.call("parentAuthorizationResend", { stakeId: STAKE, activityId, registrationId });
    assert.equal(result.ok, true);

    const state = (await getReg(activityId, registrationId)).parentAuthorization;
    assert.equal(state.selfTokenIssuedAt, null);
    assert.equal(state.status, "email_sent");
    assert.equal((await getToken(hashToken(token))).status, "invalidated");

    // Il trigger reagisce alla scrittura intermedia del reinvio: a regime il campo resta null.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.equal((await getReg(activityId, registrationId)).parentAuthorization.selfTokenIssuedAt, null);
    const pending = (await tokensOf(activityId, registrationId)).filter((x) => x.status === "pending");
    t.diagnostic(`link pendenti dopo il reinvio dell'admin: ${pending.length}`);
  });
});

