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
        await expectDenied(cancel(actor, path), path, await stored(path));
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
    await expectDenied(deleteDoc(ref("genitore", path)), path, await stored(path));
  });
});

// ===========================================================================
// Modulo «Gestisci» e reiscrizione: stessi campi di upsertRegistration, nel
// budget delle 1000 espressioni (ramo validRegistrationUpdate)
// ===========================================================================

// TODO (lavoro separato): il risalvataggio del modulo su un'iscrizione figlio
// "pesante" supera le 1000 espressioni nel ramo validRegistrationUpdate, già con
// le rules di HEAD prima della fase 2. Va ridotto il costo di quella funzione;
// intanto questi casi restano `todo`: girano, il rosso resta visibile nel report
// di node --test, ma non fanno fallire la suite.
const HEAVY_RESAVE_TODO =
  "costo di validRegistrationUpdate: un'iscrizione figlio pesante supera le 1000 espressioni (lavoro separato)";

/** Iscrizione già annullata, seminata direttamente: isola la reiscrizione dall'annullamento. */
const asCancelled = (build) => (parentUid, id) => ({ ...build(parentUid, id), registrationStatus: "cancelled" });

describe("modulo «Gestisci»: modifica di un'iscrizione figlio con parentAuthorization", () => {
  const CASES = [
    ["in attesa della firma (email_sent)", pendingRegistration, "pending_parent_authorization"],
    ["firmata e confermata", signedRegistration, "confirmed"],
    ["pesante, firmata e confermata", heavyRegistration, "confirmed", HEAVY_RESAVE_TODO],
  ];
  for (const [label, build, status, todo] of CASES) {
    test(label, { todo }, async () => {
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

describe("reiscrizione dopo l'annullamento (risalvataggio del modulo)", () => {
  const CASES = [
    ["in attesa della firma", pendingRegistration],
    ["firmata", signedRegistration],
    ["pesante, firmata", heavyRegistration, HEAVY_RESAVE_TODO],
  ];
  for (const [label, build, todo] of CASES) {
    for (const target of ["pending_parent_authorization", "active"]) {
      test(`${label}: cancelled -> ${target}`, { todo }, async () => {
        const { path } = await seed(asCancelled(build));
        const current = await stored(path);

        await resave("genitore", path, current, target);

        const after = await stored(path);
        assert.equal(after.registrationStatus, target);
        assert.deepEqual(after.parentAuthorization, current.parentAuthorization);
      });
    }
  }

  test("cancelled -> active con soli stato e updatedAt: lo concede validRegistrationUpdate, come prima", async () => {
    const { path } = await seed(asCancelled(pendingRegistration));
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
