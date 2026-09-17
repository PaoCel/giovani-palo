// Firma dall'app: la callable emette un token solo al genitore che gestisce
// quell'iscrizione, invalida il precedente e non manda nessuna mail.
// Richiede gli emulatori di firebase.room-test.json (auth 9199, firestore 8180,
// functions 5101) e il progetto demo-room-planner.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { initializeApp as initializeClientApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
assert.equal(PROJECT, "demo-room-planner", "Usare esclusivamente il progetto demo-room-planner");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):8180$/, "Firestore Emulator sulla 8180");
assert.match(AUTH_HOST, /^(127\.0\.0\.1|localhost):9199$/, "Auth Emulator sulla 9199");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `self-sign-${runId}`;
const activityId = "viaggio";
const activityPath = `stakes/${stakeId}/activities/${activityId}`;

async function client(name) {
  const app = initializeClientApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });
  await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, "self-sign-password");
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5101);
  return { auth, issue: httpsCallable(functions, "parentAuthorizationIssueOwnToken") };
}

function registrazione(parentUid, extra = {}) {
  return {
    fullName: "Figlio Test",
    birthDate: "2012-02-26",
    genderRoleCategory: "giovane_donna",
    registrationStatus: "pending_parent_authorization",
    submittedByMode: "parent",
    parentUid,
    childId: "figlio-1",
    userId: null,
    answers: {
      parentAuthorizationRequest: {
        parentFirstName: "Genitore",
        parentLastName: "Test",
        parentEmail: "genitore@example.invalid",
        parentPhone: "3330000000",
      },
    },
    ...extra,
  };
}

async function expectCode(promise, suffix) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${suffix}`);
    return true;
  });
}

test("il genitore firma dall'app, gli altri no", async () => {
  const [genitore, estraneo] = await Promise.all([client("genitore"), client("estraneo")]);
  const parentUid = genitore.auth.currentUser.uid;

  await adminDb.doc(activityPath).set({
    title: "Viaggio al tempio · test",
    startDate: "2026-10-16T14:00:00.000Z",
    endDate: "2026-10-17T16:00:00.000Z",
    requiresParentAuthorization: true,
    status: "registrations_open",
  });

  // Token precedente gia' inviato via mail: deve essere invalidato dal nuovo.
  const vecchioToken = `vecchio-${runId}`;
  await adminDb.doc(`parentAuthorizationTokens/${vecchioToken}`).set({
    id: vecchioToken,
    registrationId: "figlia",
    status: "pending",
  });
  await adminDb.doc(`${activityPath}/registrations/figlia`).set(
    registrazione(parentUid, {
      parentAuthorization: {
        status: "email_sent",
        tokenId: vecchioToken,
        parentEmail: "genitore@example.invalid",
      },
    }),
  );

  await expectCode(
    estraneo.issue({ stakeId, activityId, registrationId: "figlia" }),
    "permission-denied",
  );

  const risposta = await genitore.issue({ stakeId, activityId, registrationId: "figlia" });
  assert.equal(risposta.data.ok, true);
  assert.match(risposta.data.token, /^[0-9a-f]{64}$/u, "token grezzo esadecimale");
  assert.ok(
    new Date(risposta.data.expiresAt).getTime() - Date.now() < 2 * 60 * 60 * 1000,
    "il token dall'app dura poco, non 14 giorni",
  );

  const dopo = (await adminDb.doc(`${activityPath}/registrations/figlia`).get()).data();
  assert.notEqual(dopo.parentAuthorization.tokenId, vecchioToken, "token sostituito");
  assert.equal(dopo.parentAuthorization.parentEmail, "genitore@example.invalid");
  assert.equal(dopo.registrationStatus, "pending_parent_authorization", "stato invariato");
  assert.equal(
    (await adminDb.doc(`parentAuthorizationTokens/${vecchioToken}`).get()).data().status,
    "invalidated",
    "il vecchio link non vale piu'",
  );

  const nuovo = (await adminDb.doc(`parentAuthorizationTokens/${dopo.parentAuthorization.tokenId}`).get()).data();
  assert.equal(nuovo.createdByMode, "self");
  assert.equal(nuovo.createdByUserId, parentUid);
  assert.equal(nuovo.registrationId, "figlia");

  const logs = await adminDb.collection(`${activityPath}/consentAuditLogs`).get();
  const eventi = logs.docs.map((d) => d.data().event);
  assert.ok(eventi.includes("token_issued_in_app"), "l'emissione dall'app e' tracciata");
  assert.ok(eventi.includes("token_invalidated"), "l'invalidazione e' tracciata");
});

test("niente token per iscrizioni annullate, gia' firmate o senza dati genitore", async () => {
  const genitore = await client("genitore2");
  const parentUid = genitore.auth.currentUser.uid;

  await adminDb.doc(`${activityPath}/registrations/annullata`).set(
    registrazione(parentUid, { registrationStatus: "cancelled" }),
  );
  await adminDb.doc(`${activityPath}/registrations/firmata`).set(
    registrazione(parentUid, {
      registrationStatus: "confirmed",
      parentAuthorization: { status: "authorized", tokenId: "usato" },
    }),
  );
  await adminDb.doc(`${activityPath}/registrations/senza-dati`).set({
    ...registrazione(parentUid),
    answers: {},
  });

  await expectCode(
    genitore.issue({ stakeId, activityId, registrationId: "annullata" }),
    "failed-precondition",
  );
  await expectCode(
    genitore.issue({ stakeId, activityId, registrationId: "firmata" }),
    "failed-precondition",
  );
  await expectCode(
    genitore.issue({ stakeId, activityId, registrationId: "senza-dati" }),
    "failed-precondition",
  );
  await expectCode(
    genitore.issue({ stakeId, activityId, registrationId: "inesistente" }),
    "not-found",
  );
});
