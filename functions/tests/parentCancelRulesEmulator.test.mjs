// Annullamento dell'iscrizione di un figlio da Famiglia (fase 2 del flusso
// genitore): stessa scrittura di /me, `updateDoc(ref, { registrationStatus:
// "cancelled", updatedAt })` su registrations/child_<parentUid>_<childId>
// (cancelRegistrationById in src/services/firestore/registrationsService.ts).
// Provata con l'SDK client e utenti veri (token mock dell'emulatore, ruolo
// `parent` nel profilo); l'Admin SDK serve solo per seminare e ispezionare,
// perché ignora le rules. Copre il ramo economico validOwnerCancellation
// (un'iscrizione figlio "pesante" sforava le 1000 espressioni nel ramo
// validRegistrationUpdate), il divieto di toccare altri campi insieme
// all'annullamento, gli estranei, la modifica dal modulo «Gestisci» e la
// reiscrizione dopo l'annullamento (stessi campi di upsertRegistration), che
// devono restare nel budget anche su un'iscrizione figlio con firma completa.
//
// Rilancio dalla radice del repository (solo Firestore, porta 8180):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-parent-cancel \
//     'node --test --test-concurrency=1 functions/tests/parentCancelRulesEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (anche hub, logging e websocket di Firestore) in un file
// temporaneo e rimuovilo a fine prova; il test legge l'host da FIRESTORE_EMULATOR_HOST.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
  doc,
  getDocFromServer,
  getFirestore,
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
const stakeId = `parent-cancel-${runId}`;
const uid = (name) => `${name}-${runId}`;
const SEEDED_AT = "2026-10-01T08:00:00.000Z";
const SIGNED_AT = "2026-10-02T19:30:00.000Z";
const CHILD_ID = "figlio-1";

const ACTORS = [
  // [attore, nome uid, ruolo nel profilo]
  ["genitore", "genitore", "parent"],
  ["altroGenitore", "altro-genitore", "parent"],
  ["partecipante", "partecipante", "participant"],
  ["nonAutenticato", null, null],
];
const clients = {};

// ---------------------------------------------------------------------------
// Documenti con la forma reale
// ---------------------------------------------------------------------------

const parentRequest = () => ({
  parentFirstName: "Genitore",
  parentLastName: "Test",
  parentEmail: "genitore@example.invalid",
  parentPhone: "3330000000",
});

/** Stato scritto da sendInitialAuthorizationEmail dopo la prima mail. */
function emailSentState(tokenId) {
  return {
    status: "email_sent",
    tokenId,
    selfTokenIssuedAt: null,
    parentFirstName: "Genitore",
    parentLastName: "Test",
    parentEmail: "genitore@example.invalid",
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
function authorizedState(registrationId, tokenId, extra = {}) {
  const base = `parentAuthorizations/${stakeId}/act/${registrationId}`;
  return {
    ...emailSentState(tokenId),
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
    signatureUrl: null,
    pdfPath: `${base}/consenso.pdf`,
    pdfUrl: null,
    conductPdfPath: `${base}/condotta.pdf`,
    auditPdfPath: `${base}/audit.pdf`,
    signatureSource: "drawn",
    signedCopyEmailSentAt: SIGNED_AT,
    signedCopyEmailMessageId: null,
    signedCopyEmailLastError: null,
    ipAddress: "203.0.113.7",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    updatedAt: SIGNED_AT,
    ...extra,
  };
}

/** Payload di saveRegistration per un figlio (setDoc alla prima iscrizione). */
function childRegistration(parentUid, overrides = {}) {
  return {
    userId: null,
    anonymousUid: null,
    parentUid,
    childId: CHILD_ID,
    anonymousTokenId: null,
    firstName: "Figlio",
    lastName: "Test",
    fullName: "Figlio Test",
    email: "genitore@example.invalid",
    phone: "3330000000",
    birthDate: "2012-02-26",
    genderRoleCategory: "giovane_donna",
    unitId: "unita-1",
    unitNameSnapshot: "Unità Uno",
    answers: {
      birthDate: "2012-02-26",
      genderRoleCategory: "giovane_donna",
      transportMode: "bus",
      parentAuthorizationRequest: parentRequest(),
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
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    ...overrides,
  };
}

/** In attesa della firma, dopo la mail al genitore. */
const pendingRegistration = (parentUid) =>
  childRegistration(parentUid, { parentAuthorization: emailSentState("token-in-attesa") });

/** Firmata dal genitore: confermata, consenso e firma agganciati al documento. */
function signedRegistration(parentUid, registrationId) {
  return childRegistration(parentUid, {
    registrationStatus: "confirmed",
    parentAuthorization: authorizedState(registrationId, "token-usato"),
    parentConsentDocumentName: `modulo-consenso-${registrationId}.pdf`,
    parentConsentDocumentPath: `parentAuthorizations/${stakeId}/act/${registrationId}/consenso.pdf`,
    parentConsentUploadedAt: SIGNED_AT,
    consentSignaturePath: `parentAuthorizations/${stakeId}/act/${registrationId}/signature.png`,
    consentSignatureSetAt: SIGNED_AT,
    updatedAt: SIGNED_AT,
  });
}

/**
 * Iscrizione figlio "pesante" come nel modulo reale del campo: molte risposte
 * (anche annidate), preferenze stanza, giorni, stanza pubblicata, pattuglia,
 * comitati e autorizzazione firmata completa.
 */
function heavyRegistration(parentUid, registrationId) {
  const answers = {
    birthDate: "2012-02-26",
    genderRoleCategory: "giovane_donna",
    unitName: "Unità Uno",
    address: "Via dei Test 1",
    city: "Roma",
    stateOrProvince: "RM",
    transportMode: "bus",
    roomPreference: "Con le amiche della mia unità",
    roomNotes: "Preferisce il letto in basso",
    emergencyContactSecondaryPhone: "3331111111",
    parentalConsentAccepted: true,
    parentalConsentSignerName: "Genitore Test",
    parentalConsentAcceptedAt: SEEDED_AT,
    photoReleaseAccepted: true,
    photoReleaseSignerName: "Genitore Test",
    photoReleaseAcceptedAt: SEEDED_AT,
    photoInternalConsent: true,
    parentConfirmed: true,
    parentConfirmedAt: SEEDED_AT,
    parentAuthorizationAcceptedAt: SEEDED_AT,
    parentGuardianEmail: "genitore@example.invalid",
    shirtSize: "M",
    swimming: "si",
    previousCamps: ["2024", "2025"],
    talents: ["canto", "chitarra", "cucina"],
    medicalTherapies: "Nessuna",
    notesForLeaders: "Soffre il mal d'auto: meglio davanti sul pullman.",
    parentAuthorizationRequest: {
      ...parentRequest(),
      emergencyContactName: "Nonna Test",
      emergencyContactPhone: "3332222222",
      emergencyContactRelation: "nonna",
      allergies: "Graminacee, acari",
      medications: "Antistaminico al bisogno",
      medicalNotes: "Asma lieve da sforzo, porta il suo spray.",
      dietaryNotes: "Niente frutta a guscio",
    },
  };
  for (let index = 1; index <= 30; index += 1) {
    answers[`campo_${String(index).padStart(2, "0")}`] =
      index % 3 === 0 ? index % 2 === 0 : index % 3 === 1 ? `Risposta libera numero ${index}` : [`a${index}`, `b${index}`];
  }

  return {
    ...signedRegistration(parentUid, registrationId),
    answers,
    roomPreferenceMatches: {
      "amica-1": { status: "matched", registrationId: "child_x_amica-1", updatedAt: SEEDED_AT },
      "amica-2": { status: "pending", registrationId: null, updatedAt: SEEDED_AT },
      "amica-3": { status: "matched", registrationId: "user_amica-3", updatedAt: SEEDED_AT },
    },
    participatingDays: ["2026-10-16", "2026-10-17", "2026-10-18"],
    assignedRoomId: "stanza-12",
    assignedRoomName: "Stanza 12",
    assignedPatrolId: "pattuglia-aquile",
    assignedPatrolName: "Aquile",
    assignedPatrolRole: "member",
    assignedCommittees: ["cucina", "pulizie"],
    parentAuthorization: authorizedState(registrationId, "token-usato", {
      emergencyContactName: "Nonna Test",
      emergencyContactPhone: "3332222222",
      emergencyContactRelation: "nonna",
      allergies: "Graminacee, acari",
      medications: "Antistaminico al bisogno",
      medicalNotes: "Asma lieve da sforzo, porta il suo spray.",
      dietaryNotes: "Niente frutta a guscio",
      emailSentAt: SEEDED_AT,
      brevoMessageId: "<202610010800.1234567890@smtp-relay.mailin.fr>",
    }),
  };
}

// ---------------------------------------------------------------------------
// Semina e scritture con la forma del client
// ---------------------------------------------------------------------------

let counter = 0;
/** Ogni caso ha la sua attività: l'id del documento è sempre child_<genitore>_<figlio>. */
async function seed(build) {
  counter += 1;
  const activityId = `campo-${counter}`;
  const registrationId = `child_${uid("genitore")}_${CHILD_ID}`;
  const path = `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`;
  await adminDb.doc(`stakes/${stakeId}/activities/${activityId}`).set({
    title: `Campo di test ${counter}`,
    activityType: "camp",
    status: "registrations_open",
    requiresParentAuthorization: true,
    startDate: "2026-10-16T14:00:00.000Z",
    endDate: "2026-10-18T16:00:00.000Z",
  });
  await adminDb.doc(path).set(build(uid("genitore"), registrationId));
  return { path, registrationId };
}

const stored = async (path) => (await adminDb.doc(path).get()).data();
const ref = (actor, path) => doc(clients[actor].firestore, path);

/** cancelRegistrationById: la stessa scrittura di /me. */
const cancel = (actor, path, extra = {}) =>
  updateDoc(ref(actor, path), { registrationStatus: "cancelled", updatedAt: new Date().toISOString(), ...extra });

/**
 * upsertRegistration su documento esistente (registrationsService.ts, ramo
 * updateDoc): i campi che il modulo riscrive, con eventuali modifiche.
 */
function resave(actor, path, current, registrationStatus, changes = {}) {
  return updateDoc(ref(actor, path), {
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
    updatedAt: new Date().toISOString(),
  });
}

// `before` va letto prima di creare la scrittura: con
// `expectDenied(scrittura, path, await stored(path))` un rifiuto che arriva
// prima della lettura è una rejection non gestita e node --test fallisce.
async function expectDenied(promise, path, before) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, "permission-denied", `${error?.code}: ${error?.message}`);
    return true;
  });
  // Un'operazione negata non lascia traccia.
  assert.deepEqual(await stored(path), before);
}

/** Annullamento riuscito: cambiano solo stato e updatedAt, il resto è identico. */
function assertOnlyCancelled(before, after, startedAt) {
  assert.equal(after.registrationStatus, "cancelled");
  assert.ok(after.updatedAt >= startedAt, `updatedAt nuovo (${after.updatedAt})`);
  const { registrationStatus: _s1, updatedAt: _u1, ...restBefore } = before;
  const { registrationStatus: _s2, updatedAt: _u2, ...restAfter } = after;
  assert.deepEqual(restAfter, restBefore);
}

before(async () => {
  const profile = (role) => ({
    firstName: "Test",
    lastName: "Profilo",
    fullName: "Test Profilo",
    email: "profilo@example.invalid",
    birthDate: "",
    genderRoleCategory: "",
    unitId: "unita-1",
    unitName: "Unità Uno",
    stakeId,
    role,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  });
  const writes = [];
  for (const [, name, role] of ACTORS) {
    if (!name) continue;
    writes.push(adminDb.doc(`users/${uid(name)}`).set(profile(role)));
  }
  // Entrambi i genitori hanno un figlio con lo stesso childId: l'ownership è parentUid.
  for (const name of ["genitore", "altro-genitore"]) {
    writes.push(
      adminDb.doc(`users/${uid(name)}/children/${CHILD_ID}`).set({
        fullName: "Figlio Test",
        birthDate: "2012-02-26",
        genderRoleCategory: "giovane_donna",
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      }),
    );
  }
  await Promise.all(writes);

  for (const [actor, name] of ACTORS) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actor}-${runId}`);
    const firestore = getFirestore(app);
    const options = name
      ? {
          mockUserToken: {
            sub: uid(name),
            email: `${name}-${runId}@example.invalid`,
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
    for (const [, name] of ACTORS) {
      if (name) await adminDb.recursiveDelete(adminDb.doc(`users/${uid(name)}`));
    }
  } finally {
    await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// Il genitore annulla
// ===========================================================================

describe("il genitore annulla l'iscrizione del figlio da Famiglia", () => {
  test("in attesa della firma (pending_parent_authorization)", async () => {
    const { path } = await seed(pendingRegistration);
    const before = await stored(path);
    const startedAt = new Date().toISOString();

    await cancel("genitore", path);

    assertOnlyCancelled(before, await stored(path), startedAt);
    // Il client rilegge il documento subito dopo (getRegistrationById).
    const reread = await getDocFromServer(ref("genitore", path));
    assert.equal(reread.data().registrationStatus, "cancelled");
  });

  test("confermata con autorizzazione firmata: parentAuthorization e consensi invariati", async () => {
    const { path } = await seed(signedRegistration);
    const before = await stored(path);
    const startedAt = new Date().toISOString();

    await cancel("genitore", path);

    const after = await stored(path);
    assertOnlyCancelled(before, after, startedAt);
    assert.deepEqual(after.parentAuthorization, before.parentAuthorization);
    assert.equal(after.parentAuthorization.status, "authorized");
    assert.equal(after.consentSignaturePath, before.consentSignaturePath);
    assert.equal(after.parentConsentDocumentPath, before.parentConsentDocumentPath);
  });

  test("iscrizione pesante (modulo del campo, stanza pubblicata, firma completa): sta nel budget", async () => {
    const { path } = await seed(heavyRegistration);
    const before = await stored(path);
    assert.ok(Object.keys(before.answers).length >= 55, "answers con molti campi");
    const startedAt = new Date().toISOString();

    await cancel("genitore", path);

    const after = await stored(path);
    assertOnlyCancelled(before, after, startedAt);
    assert.deepEqual(after.parentAuthorization, before.parentAuthorization);
    assert.equal(after.assignedRoomName, "Stanza 12");
  });

  test("annullare di nuovo un'iscrizione già annullata è innocuo", async () => {
    const { path } = await seed((parentUid, id) => ({ ...signedRegistration(parentUid, id), registrationStatus: "cancelled" }));
    const before = await stored(path);
    const startedAt = new Date().toISOString();

    await cancel("genitore", path);

    assertOnlyCancelled(before, await stored(path), startedAt);
  });
});

// ===========================================================================
// Gli estranei no
// ===========================================================================

describe("chi non è il genitore titolare non annulla", () => {
  const OUTSIDERS = [
    ["un altro genitore (stesso childId, altro parentUid)", "altroGenitore"],
    ["un partecipante dello stesso palo", "partecipante"],
    ["un utente non autenticato", "nonAutenticato"],
  ];
  for (const [label, actor] of OUTSIDERS) {
    for (const [stato, build] of [
      ["in attesa", pendingRegistration],
      ["firmata", signedRegistration],
      ["pesante", heavyRegistration],
    ]) {
      test(`${label}: iscrizione ${stato}`, async () => {
        const { path } = await seed(build);
        const before = await stored(path);
        await expectDenied(cancel(actor, path), path, before);
      });
    }
  }
});

// ===========================================================================
// L'annullamento non porta con sé altri campi
// ===========================================================================

describe("annullamento insieme ad altri campi: negato", () => {
  const CASES = [
    ["parentAuthorization sostituito (stato revocato)", signedRegistration, (data) => ({
      parentAuthorization: { ...data.parentAuthorization, status: "revoked" },
    })],
    ["parentAuthorization azzerato", signedRegistration, () => ({ parentAuthorization: null })],
    ["parentAuthorization rimosso (deleteField)", signedRegistration, () => ({ parentAuthorization: deleteField() })],
    ["parentAuthorization.status col percorso puntato", pendingRegistration, () => ({
      "parentAuthorization.status": "cancelled",
    })],
    ["firma rimossa (parentAuthorization.signaturePath)", heavyRegistration, () => ({
      "parentAuthorization.signaturePath": null,
    })],
    ["childId cambiato", pendingRegistration, () => ({ childId: "altro-figlio" })],
    ["parentUid passato a un altro genitore", signedRegistration, () => ({ parentUid: uid("altro-genitore") })],
    ["userId assegnato al genitore", pendingRegistration, () => ({ userId: uid("genitore") })],
    ["stanza tolta (assignedRoomId)", heavyRegistration, () => ({ assignedRoomId: null })],
    ["stanza rinominata (assignedRoomName)", heavyRegistration, () => ({ assignedRoomName: "Stanza 1" })],
    ["copia firmata scollegata (consentSignaturePath)", signedRegistration, () => ({ consentSignaturePath: null })],
    ["modulo di consenso scollegato (parentConsentDocumentPath)", heavyRegistration, () => ({
      parentConsentDocumentPath: null,
    })],
    ["pattuglia cambiata", heavyRegistration, () => ({ assignedPatrolId: "pattuglia-lupi" })],
    ["createdAt riscritto", pendingRegistration, () => ({ createdAt: "2020-01-01T00:00:00.000Z" })],
  ];

  for (const [label, build, extra] of CASES) {
    test(label, async () => {
      const { path } = await seed(build);
      const before = await stored(path);
      await expectDenied(cancel("genitore", path, extra(before)), path, before);
    });
  }

  test("updatedAt non stringa (Date): negato", async () => {
    const { path } = await seed(pendingRegistration);
    const before = await stored(path);
    await expectDenied(
      updateDoc(ref("genitore", path), { registrationStatus: "cancelled", updatedAt: new Date() }),
      path,
      before,
    );
  });

  test("il genitore non cancella il documento (Famiglia annulla, non elimina)", async () => {
    const { path } = await seed(signedRegistration);
    const before = await stored(path);
    await expectDenied(deleteDoc(ref("genitore", path)), path, before);
  });
});

// ===========================================================================
// Modulo «Gestisci» e reiscrizione: stessi campi di upsertRegistration, nel
// budget delle 1000 espressioni (ramo validRegistrationUpdate)
// ===========================================================================

// I casi "pesante" superavano le 1000 espressioni nel ramo
// validRegistrationUpdate (anche prima della fase 2) e sono rimasti `todo` fino
// alla riduzione del costo di quella funzione (2026-10-19).

/** Iscrizione già annullata, seminata direttamente: isola la reiscrizione dall'annullamento. */
const asCancelled = (build) => (parentUid, id) => ({ ...build(parentUid, id), registrationStatus: "cancelled" });

describe("modulo «Gestisci»: modifica di un'iscrizione figlio con parentAuthorization", () => {
  const CASES = [
    ["in attesa della firma (email_sent)", pendingRegistration, "pending_parent_authorization"],
    ["firmata e confermata", signedRegistration, "confirmed"],
    ["pesante, firmata e confermata", heavyRegistration, "confirmed"],
  ];
  for (const [label, build, status] of CASES) {
    test(label, async () => {
      const { path } = await seed(build);
      const before = await stored(path);

      // resolveRegistrationStatusOnSave lascia lo stato esistente se non è annullata.
      await resave("genitore", path, before, status, {
        phone: "3339999999",
        answers: { ...before.answers, transportMode: "auto" },
      });

      const after = await stored(path);
      assert.equal(after.phone, "3339999999");
      assert.equal(after.answers.transportMode, "auto");
      assert.equal(after.registrationStatus, status);
      assert.deepEqual(after.parentAuthorization, before.parentAuthorization);
    });
  }
});

// Riattivazione e consenso (2026-10-19): da `cancelled` si torna a
// `pending_parent_authorization` sempre, a `active` solo se la firma del
// genitore c'era già (`parentAuthorization.status == 'authorized'`) o se
// l'autorizzazione non serve. Le attività di questo file la richiedono e il
// figlio ha 14 anni: l'iscrizione non firmata (`pendingRegistration`) non
// torna `active`, e il client infatti manda `pending_parent_authorization`
// (resolveRegistrationStatusOnSave). Il resto della matrice (minore con
// stato null, adulto, attività senza autorizzazione, bordi dell'età) sta in
// registrationInitialStatusRulesEmulator.test.mjs.
describe("reiscrizione dopo l'annullamento (risalvataggio del modulo)", () => {
  const CASES = [
    ["in attesa della firma", pendingRegistration, false],
    ["firmata", signedRegistration, true],
    ["pesante, firmata", heavyRegistration, true],
  ];
  for (const [label, build, canReturnActive] of CASES) {
    test(`${label}: cancelled -> pending_parent_authorization`, async () => {
      const { path } = await seed(asCancelled(build));
      const current = await stored(path);

      await resave("genitore", path, current, "pending_parent_authorization");

      const after = await stored(path);
      assert.equal(after.registrationStatus, "pending_parent_authorization");
      assert.deepEqual(after.parentAuthorization, current.parentAuthorization);
    });

    if (canReturnActive) {
      test(`${label}: cancelled -> active (la firma c'era già)`, async () => {
        const { path } = await seed(asCancelled(build));
        const current = await stored(path);

        await resave("genitore", path, current, "active");

        const after = await stored(path);
        assert.equal(after.registrationStatus, "active");
        assert.deepEqual(after.parentAuthorization, current.parentAuthorization);
      });
    } else {
      test(`${label}: cancelled -> active è negato (il consenso del genitore non c'è)`, async () => {
        const { path } = await seed(asCancelled(build));
        const current = await stored(path);
        await expectDenied(resave("genitore", path, current, "active"), path, current);
      });
    }
  }

  test("cancelled -> active con soli stato e updatedAt su un'iscrizione non firmata: negato", async () => {
    const { path } = await seed(asCancelled(pendingRegistration));
    const current = await stored(path);
    await expectDenied(
      updateDoc(ref("genitore", path), { registrationStatus: "active", updatedAt: new Date().toISOString() }),
      path,
      current,
    );
  });

  test("cancelled -> active con soli stato e updatedAt su un'iscrizione firmata: lo concede validRegistrationUpdate", async () => {
    const { path } = await seed(asCancelled(signedRegistration));
    await updateDoc(ref("genitore", path), { registrationStatus: "active", updatedAt: new Date().toISOString() });
    assert.equal((await stored(path)).registrationStatus, "active");
  });

  test("annullata dal genitore e poi risalvata: il percorso completo di Famiglia", async () => {
    const { path } = await seed(signedRegistration);
    await cancel("genitore", path);
    const current = await stored(path);

    await resave("genitore", path, current, "active");

    const after = await stored(path);
    assert.equal(after.registrationStatus, "active");
    assert.deepEqual(after.parentAuthorization, current.parentAuthorization);
  });

  test("dopo l'annullamento il genitore non rimette 'confirmed' (lo scrive solo la firma)", async () => {
    const { path } = await seed(asCancelled(signedRegistration));
    const current = await stored(path);

    await expectDenied(
      updateDoc(ref("genitore", path), { registrationStatus: "confirmed", updatedAt: new Date().toISOString() }),
      path,
      current,
    );
    await expectDenied(resave("genitore", path, current, "confirmed"), path, current);
  });

  test("un altro genitore non riattiva un'iscrizione annullata", async () => {
    const { path } = await seed(asCancelled(signedRegistration));
    const current = await stored(path);
    await expectDenied(resave("altroGenitore", path, current, "active"), path, current);
  });
});

// ===========================================================================
// validRegistrationUpdate: confronti dettagliati e iscrizione massima
// ===========================================================================

// Il risalvataggio del modulo passa dalle scorciatoie della rule (nessuna
// chiave del gruppo in affectedKeys). Qui si prova l'altro lato: i confronti
// dettagliati su pattuglia, stanza, comitati, consensi e codici di accesso
// quando la scorciatoia non vale, con le scritture del client (updateDoc), e
// l'iscrizione figlio con ogni campo valorizzato, il caso peggiore del budget
// delle 1000 espressioni.
describe("validRegistrationUpdate: rami dettagliati e iscrizione massima", () => {
  /** Campi che il modulo «Gestisci» cambia davvero; tutto il resto resta identico. */
  const CHANGED_BY_FORM = ["phone", "answers", "registrationStatus", "updatedAt"];
  const withoutKeys = (data, keys) => Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));

  /** updateDoc mirato: solo i campi indicati più updatedAt. */
  const patch = (actor, path, fields) =>
    updateDoc(ref(actor, path), { ...fields, updatedAt: new Date().toISOString() });

  /** Iscrizione figlio leggera, come dopo la prima mail al genitore, con campi a scelta. */
  const light = (overrides = {}) => (parentUid) =>
    childRegistration(parentUid, { parentAuthorization: emailSentState("token-in-attesa"), ...overrides });

  /** Documento precedente a stanze pubblicate e comitati: senza quei due campi. */
  const legacy = (build) => (parentUid, id) => {
    const { assignedRoomName: _room, assignedCommittees: _committees, ...rest } = build(parentUid, id);
    return rest;
  };

  /** Ogni campo opzionale valorizzato: il caso peggiore di costo per validRegistrationUpdate. */
  function maximalRegistration(parentUid, registrationId) {
    const base = `parentAuthorizations/${stakeId}/act/${registrationId}`;
    return {
      ...heavyRegistration(parentUid, registrationId),
      anonymousTokenId: "token-anonimo-1",
      accessCode: "ACC-1234",
      recoveryCode: "REC-5678",
      recoveryPdfGenerated: true,
      parentConsentDocumentUrl: "https://storage.example.invalid/consenso.pdf",
      consentSignatureUrl: "https://storage.example.invalid/firma.png",
      parentIdDocumentName: `documento-${registrationId}.pdf`,
      parentIdDocumentUrl: "https://storage.example.invalid/documento.pdf",
      parentIdDocumentPath: `${base}/documento.pdf`,
      parentIdUploadedAt: SIGNED_AT,
      linkedLaterToUserId: uid("partecipante"),
      assignedTempleShiftId: "turno-tempio-3",
      assignedServiceTeamIds: ["squadra-cucina", "squadra-pulizie"],
    };
  }

  /** Scrittura ammessa: cambiano solo i campi indicati (e updatedAt), il resto è identico. */
  async function expectOnlyChanged(path, before, changes) {
    const after = await stored(path);
    for (const [key, value] of Object.entries(changes)) assert.deepEqual(after[key], value, key);
    const touched = [...Object.keys(changes), "updatedAt"];
    assert.deepEqual(withoutKeys(after, touched), withoutKeys(before, touched));
    return after;
  }

  // -------------------------------------------------------------------------
  // Codici di accesso e recupero: si impostano una volta, poi restano
  // -------------------------------------------------------------------------

  describe("codici di accesso e recupero", () => {
    for (const field of ["accessCode", "recoveryCode", "anonymousTokenId"]) {
      test(`${field}: da null a stringa è ammesso`, async () => {
        const { path } = await seed(light({ [field]: null }));
        const before = await stored(path);

        await patch("genitore", path, { [field]: "valore-1" });

        await expectOnlyChanged(path, before, { [field]: "valore-1" });
      });

      test(`${field}: da stringa a un'altra stringa è negato`, async () => {
        const { path } = await seed(light({ [field]: "valore-1" }));
        const before = await stored(path);
        await expectDenied(patch("genitore", path, { [field]: "valore-2" }), path, before);
      });

      test(`${field}: da stringa a null è negato`, async () => {
        const { path } = await seed(light({ [field]: "valore-1" }));
        const before = await stored(path);
        await expectDenied(patch("genitore", path, { [field]: null }), path, before);
      });
    }

    test("recoveryPdfGenerated: false -> true è ammesso", async () => {
      const { path } = await seed(light({ recoveryPdfGenerated: false }));
      const before = await stored(path);

      await patch("genitore", path, { recoveryPdfGenerated: true });

      await expectOnlyChanged(path, before, { recoveryPdfGenerated: true });
    });

    test("recoveryPdfGenerated: true -> false è negato", async () => {
      const { path } = await seed(light({ recoveryPdfGenerated: true }));
      const before = await stored(path);
      await expectDenied(patch("genitore", path, { recoveryPdfGenerated: false }), path, before);
    });

    test("i quattro campi insieme (forma di saveAnonymousRecovery): null/false -> valori è ammesso", async () => {
      const { path } = await seed(light());
      const before = await stored(path);
      const changes = {
        anonymousTokenId: "token-anonimo-1",
        accessCode: "ACC-1234",
        recoveryCode: "ACC-1234",
        recoveryPdfGenerated: true,
      };

      await patch("genitore", path, changes);

      await expectOnlyChanged(path, before, changes);
    });

    test("iscrizione pesante: accessCode da null a stringa è ammesso (confronto dettagliato nel budget)", async () => {
      const { path } = await seed(heavyRegistration);
      const before = await stored(path);

      await patch("genitore", path, { accessCode: "ACC-1234" });

      await expectOnlyChanged(path, before, { accessCode: "ACC-1234" });
    });
  });

  // -------------------------------------------------------------------------
  // Pattuglia, stanza, comitati, consensi: il titolare non li cambia da solo
  // -------------------------------------------------------------------------

  describe("campi assegnati e consensi: la modifica diretta è negata", () => {
    const CASES = [
      ["consenso: parentIdDocumentPath da null a valore", light(), {
        parentIdDocumentPath: `parentAuthorizations/${stakeId}/act/x/documento.pdf`,
      }],
      ["consenso: parentIdDocumentName da null a valore", light(), { parentIdDocumentName: "documento.pdf" }],
      ["consenso: consentSignatureUrl da null a valore", light(), {
        consentSignatureUrl: "https://storage.example.invalid/firma.png",
      }],
      ["consenso: parentConsentDocumentPath da valore a un altro", signedRegistration, {
        parentConsentDocumentPath: `parentAuthorizations/${stakeId}/act/x/altro.pdf`,
      }],
      ["consenso: consentSignaturePath da valore a null", signedRegistration, { consentSignaturePath: null }],
      ["comitati: da [] a un elemento", light(), { assignedCommittees: ["cucina"] }],
      ["comitati: da un elemento a []", light({ assignedCommittees: ["cucina"] }), { assignedCommittees: [] }],
      ["comitati: da un elemento a un altro", light({ assignedCommittees: ["cucina"] }), {
        assignedCommittees: ["pulizie"],
      }],
      ["pattuglia: assignedPatrolId da null a valore", light(), { assignedPatrolId: "pattuglia-lupi" }],
      ["pattuglia: assignedPatrolName da null a valore", light(), { assignedPatrolName: "Lupi" }],
      ["pattuglia: assignedPatrolRole da null a leader", light(), { assignedPatrolRole: "leader" }],
      ["pattuglia: assignedPatrolRole da member a null", heavyRegistration, { assignedPatrolRole: null }],
      ["stanza: assignedRoomName da assente a valore", light(), { assignedRoomName: "Stanza 1" }],
      ["stanza: assignedRoomName da valore a null", heavyRegistration, { assignedRoomName: null }],
      ["childId cambiato", light(), { childId: "altro-figlio" }],
      ["iscrizione massima: accessCode cambiato", maximalRegistration, { accessCode: "ACC-9999" }],
      ["iscrizione massima: parentIdDocumentPath azzerato", maximalRegistration, { parentIdDocumentPath: null }],
    ];

    for (const [label, build, fields] of CASES) {
      test(label, async () => {
        const { path } = await seed(build);
        const before = await stored(path);
        await expectDenied(patch("genitore", path, fields), path, before);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Documenti legacy: assignedRoomName e assignedCommittees assenti
  // -------------------------------------------------------------------------

  describe("documenti legacy senza assignedRoomName e assignedCommittees", () => {
    test("assignedCommittees: aggiungere [] è ammesso (assente e vuoto si equivalgono)", async () => {
      const { path } = await seed(legacy(light()));
      const before = await stored(path);
      assert.ok(!("assignedCommittees" in before));

      await patch("genitore", path, { assignedCommittees: [] });

      await expectOnlyChanged(path, before, { assignedCommittees: [] });
    });

    test("assignedCommittees: aggiungere un elemento è negato", async () => {
      const { path } = await seed(legacy(light()));
      const before = await stored(path);
      await expectDenied(patch("genitore", path, { assignedCommittees: ["cucina"] }), path, before);
    });

    test("assignedRoomName: aggiungere null è ammesso (assente e null si equivalgono)", async () => {
      const { path } = await seed(legacy(light()));
      const before = await stored(path);

      await patch("genitore", path, { assignedRoomName: null });

      await expectOnlyChanged(path, before, { assignedRoomName: null });
    });

    test("assignedRoomName: aggiungere un valore è negato", async () => {
      const { path } = await seed(legacy(light()));
      const before = await stored(path);
      await expectDenied(patch("genitore", path, { assignedRoomName: "Stanza 1" }), path, before);
    });

    test("assignedRoomName: da null a campo rimosso è ammesso", async () => {
      const { path } = await seed(light({ assignedRoomName: null }));
      const before = await stored(path);

      await patch("genitore", path, { assignedRoomName: deleteField() });

      const after = await expectOnlyChanged(path, before, { assignedRoomName: undefined });
      assert.ok(!("assignedRoomName" in after));
    });

    test("assignedRoomName: da valore a campo rimosso è negato", async () => {
      const { path } = await seed(heavyRegistration);
      const before = await stored(path);
      await expectDenied(patch("genitore", path, { assignedRoomName: deleteField() }), path, before);
    });

    // Con il campo nel documento precedente e non nel nuovo, la rule legge un
    // campo mancante: errore, quindi negato.
    test("assignedCommittees: da [] a campo rimosso è negato", async () => {
      const { path } = await seed(light());
      const before = await stored(path);
      await expectDenied(patch("genitore", path, { assignedCommittees: deleteField() }), path, before);
    });

    // `reactivated`: lo stato con cui il modulo riattiva l'iscrizione annullata,
    // quello di resolveRegistrationStatusOnSave: senza firma si riparte dal
    // genitore, con la firma già data si torna attivi.
    for (const [label, build, status, reactivated] of [
      ["in attesa della firma", pendingRegistration, "pending_parent_authorization", "pending_parent_authorization"],
      ["firmata", signedRegistration, "confirmed", "active"],
      ["pesante, firmata", heavyRegistration, "confirmed", "active"],
    ]) {
      test(`${label}: il modulo risalva e i due campi restano assenti`, async () => {
        const { path } = await seed(legacy(build));
        const before = await stored(path);
        assert.ok(!("assignedCommittees" in before) && !("assignedRoomName" in before));

        await resave("genitore", path, before, status, { phone: "3339999999" });

        const after = await stored(path);
        assert.equal(after.phone, "3339999999");
        assert.equal(after.registrationStatus, status);
        assert.ok(!("assignedCommittees" in after) && !("assignedRoomName" in after));
        assert.deepEqual(withoutKeys(after, CHANGED_BY_FORM), withoutKeys(before, CHANGED_BY_FORM));
      });

      test(`${label}: annullata e riattivata dal modulo`, async () => {
        const { path } = await seed(asCancelled(legacy(build)));
        const before = await stored(path);

        await resave("genitore", path, before, reactivated);

        const after = await stored(path);
        assert.equal(after.registrationStatus, reactivated);
        assert.ok(!("assignedCommittees" in after) && !("assignedRoomName" in after));
        assert.deepEqual(withoutKeys(after, CHANGED_BY_FORM), withoutKeys(before, CHANGED_BY_FORM));
      });
    }

    // Due gruppi nel ramo dettagliato nella stessa scrittura, su un'iscrizione
    // pesante: si pagano i confronti su pattuglia, stanza, comitati e codici
    // (i consensi restano sulla loro scorciatoia). Nessun client la fa: è la
    // sonda del caso peggiore del budget.
    for (const [label, build, registrationStatus] of [
      ["stato invariato", legacy(heavyRegistration), null],
      ["con riattivazione", asCancelled(legacy(heavyRegistration)), "active"],
    ]) {
      test(`caso peggiore, due gruppi dettagliati su iscrizione pesante: ${label}`, async () => {
        const { path } = await seed(build);
        const before = await stored(path);
        const changes = {
          assignedCommittees: [],
          assignedRoomName: null,
          anonymousTokenId: "token-anonimo-1",
          accessCode: "ACC-1234",
          recoveryCode: "REC-5678",
          recoveryPdfGenerated: true,
          ...(registrationStatus ? { registrationStatus } : {}),
        };

        await patch("genitore", path, changes);

        await expectOnlyChanged(path, before, changes);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Iscrizione figlio massima: modulo, annullamento e riattivazione
  // -------------------------------------------------------------------------

  describe("iscrizione figlio massima (ogni campo opzionale valorizzato)", () => {
    test("il genitore la annulla: cambiano solo stato e updatedAt", async () => {
      const { path } = await seed(maximalRegistration);
      const before = await stored(path);
      const startedAt = new Date().toISOString();

      await cancel("genitore", path);

      assertOnlyCancelled(before, await stored(path), startedAt);
    });

    test("modulo «Gestisci»: telefono e risposte cambiano, codici e consensi restano", async () => {
      const { path } = await seed(maximalRegistration);
      const before = await stored(path);

      await resave("genitore", path, before, "confirmed", {
        phone: "3339999999",
        answers: { ...before.answers, transportMode: "auto" },
      });

      const after = await stored(path);
      assert.equal(after.phone, "3339999999");
      assert.equal(after.answers.transportMode, "auto");
      assert.equal(after.registrationStatus, "confirmed");
      assert.equal(after.accessCode, "ACC-1234");
      assert.equal(after.recoveryPdfGenerated, true);
      assert.deepEqual(withoutKeys(after, CHANGED_BY_FORM), withoutKeys(before, CHANGED_BY_FORM));
    });

    for (const target of ["pending_parent_authorization", "active"]) {
      test(`riattivazione dopo l'annullamento: cancelled -> ${target}`, async () => {
        const { path } = await seed(asCancelled(maximalRegistration));
        const current = await stored(path);

        await resave("genitore", path, current, target);

        const after = await stored(path);
        assert.equal(after.registrationStatus, target);
        assert.deepEqual(withoutKeys(after, CHANGED_BY_FORM), withoutKeys(current, CHANGED_BY_FORM));
      });
    }

    test("annullata dal genitore e poi risalvata: il percorso completo di Famiglia", async () => {
      const { path } = await seed(maximalRegistration);
      await cancel("genitore", path);
      const current = await stored(path);

      await resave("genitore", path, current, "active");

      const after = await stored(path);
      assert.equal(after.registrationStatus, "active");
      assert.deepEqual(withoutKeys(after, CHANGED_BY_FORM), withoutKeys(current, CHANGED_BY_FORM));
    });
  });

  // -------------------------------------------------------------------------
  // Titolarità: validRegistrationUpdate non rilegge isOwnRegistration(resource.data)
  // -------------------------------------------------------------------------

  describe("chi non è titolare non modifica né si appropria dell'iscrizione", () => {
    const OUTSIDERS = [
      ["un altro genitore", "altroGenitore"],
      ["un partecipante dello stesso palo", "partecipante"],
      ["un utente non autenticato", "nonAutenticato"],
    ];
    for (const [label, actor] of OUTSIDERS) {
      for (const [stato, build] of [
        ["leggera", light()],
        ["pesante", heavyRegistration],
        ["massima", maximalRegistration],
      ]) {
        test(`${label}: telefono di un'iscrizione ${stato}`, async () => {
          const { path } = await seed(build);
          const before = await stored(path);
          await expectDenied(patch(actor, path, { phone: "3330000001" }), path, before);
        });
      }
    }

    // L'iscrizione passerebbe registrationBelongsToCaller: ciò che la ferma è
    // l'uguaglianza di parentUid con il documento precedente.
    for (const [label, actor, name] of [
      ["un altro genitore", "altroGenitore", "altro-genitore"],
      ["un partecipante dello stesso palo", "partecipante", "partecipante"],
    ]) {
      test(`${label}: si intesta l'iscrizione (parentUid)`, async () => {
        const { path } = await seed(light());
        const before = await stored(path);
        await expectDenied(patch(actor, path, { parentUid: uid(name) }), path, before);
      });

      test(`${label}: si intesta l'iscrizione (userId)`, async () => {
        const { path } = await seed(light());
        const before = await stored(path);
        await expectDenied(patch(actor, path, { userId: uid(name) }), path, before);
      });
    }
  });
});
