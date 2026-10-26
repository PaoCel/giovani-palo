// Fixture condivise dai test dell'admin sugli iscritti (docs/ADMIN_ISCRITTI.md):
// rules (adminRegistrationRulesEmulator), budget delle 1000 espressioni
// (adminRegistrationBudgetEmulator) e trigger (adminRegistrationTriggerEmulator).
//
// - attori con SDK client e token mock dell'emulatore (le rules valgono), più
//   l'Admin SDK per seminare e rileggere (ignora le rules: non prova nulla);
// - documenti con la forma vera: le iscrizioni a mano nascono da
//   buildManualRegistrationDoc di src/utils/adminRegistration.ts, le altre
//   riprendono le forme di parentCancelRulesEmulator.test.mjs (figlio in
//   attesa, firmato, pesante, massimo) e di registrationInitialStatus (account);
// - le scritture dell'admin riproducono i servizi del client (clientOps).
//
// Solo progetti demo-* ed emulatore locale.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getFirestore,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { buildManualRegistrationDoc } from "../../../src/utils/adminRegistration.ts";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

export const SEEDED_AT = "2026-10-01T08:00:00.000Z";
export const SIGNED_AT = "2026-10-02T19:30:00.000Z";
export const CHILD_ID = "figlio-1";
export const nowIso = () => new Date().toISOString();

// Date di nascita relative a oggi, così i test non scadono: 14 anni e 40.
const thisYear = new Date().getFullYear();
export const MINOR = `${thisYear - 14}-05-09`;
export const ADULT = `${thisYear - 36}-06-15`;

export const UNIT_1 = { id: "unita-1", name: "Unità Uno" };
export const UNIT_2 = { id: "unita-2", name: "Unità Due" };
const OTHER_UNIT = { id: "unita-altro-palo", name: "Unità di un altro palo" };

export const DAYS = ["2026-10-16", "2026-10-17", "2026-10-18"];

export function createFixtures(label) {
  const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
  assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
  assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):\d+$/u, "Firestore Emulator locale richiesto");
  const [emulatorHost, emulatorPort] = FIRESTORE_HOST.split(":");

  if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
  const adminDb = getAdminFirestore();

  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const stakeId = `${label}-${runId}`;
  const otherStakeId = `${label}-altro-${runId}`;
  const uid = (name) => `${name}-${runId}`;

  // -------------------------------------------------------------------------
  // Attori
  // -------------------------------------------------------------------------

  const ACTORS = {
    admin: { name: "admin", profile: { role: "admin", stakeId } },
    superAdmin: { name: "super-admin", profile: { role: "super_admin", stakeId: otherStakeId } },
    adminAltroPalo: { name: "admin-altro-palo", profile: { role: "admin", stakeId: otherStakeId } },
    dirigente: { name: "dirigente", profile: { role: "unit_leader", stakeId, unitId: UNIT_1.id, unitName: UNIT_1.name } },
    dirigenteUnita2: {
      name: "dirigente-unita-2",
      profile: { role: "unit_leader", stakeId, unitId: UNIT_2.id, unitName: UNIT_2.name },
    },
    utente: { name: "utente", profile: { role: "participant", stakeId } },
    genitore: { name: "genitore", profile: { role: "parent", stakeId }, children: true },
    // Un admin che è anche genitore (e partecipante): le sue scritture sulle
    // proprie iscrizioni passano dal ramo del titolare prima di quello admin.
    adminGenitore: { name: "admin-genitore", profile: { role: "admin", stakeId }, children: true },
    nonAutenticato: { name: null, profile: null },
  };
  const clients = {};
  const fs = (actor) => clients[actor].firestore;

  async function setup() {
    await adminDb.doc(`stakes/${stakeId}`).set({ name: "Palo di prova", createdAt: SEEDED_AT, updatedAt: SEEDED_AT });
    await adminDb.doc(`stakes/${otherStakeId}`).set({ name: "Altro palo", createdAt: SEEDED_AT, updatedAt: SEEDED_AT });
    for (const unit of [UNIT_1, UNIT_2]) {
      await adminDb.doc(`stakes/${stakeId}/units/${unit.id}`).set({
        name: unit.name,
        type: "ward",
        isActive: true,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      });
    }
    await adminDb.doc(`stakes/${otherStakeId}/units/${OTHER_UNIT.id}`).set({
      name: OTHER_UNIT.name,
      type: "ward",
      isActive: true,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });

    const writes = [];
    for (const actor of Object.values(ACTORS)) {
      if (!actor.name) continue;
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
          unitId: UNIT_1.id,
          unitName: UNIT_1.name,
          mustChangePassword: false,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
          lastLoginAt: SEEDED_AT,
          ...actor.profile,
        }),
      );
      if (actor.children) {
        writes.push(
          adminDb.doc(`users/${uid(actor.name)}/children/${CHILD_ID}`).set({
            firstName: "Figlio",
            lastName: "Test",
            fullName: "Figlio Test",
            birthDate: MINOR,
            genderRoleCategory: "giovane_donna",
            unitId: UNIT_1.id,
            unitName: UNIT_1.name,
            stakeId,
            createdAt: SEEDED_AT,
            updatedAt: SEEDED_AT,
          }),
        );
      }
    }
    await Promise.all(writes);

    for (const [actorKey, data] of Object.entries(ACTORS)) {
      const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actorKey}-${runId}`);
      const firestore = getFirestore(app);
      connectFirestoreEmulator(
        firestore,
        emulatorHost,
        Number(emulatorPort),
        data.name
          ? {
              mockUserToken: {
                sub: uid(data.name),
                email: `${data.name}-${runId}@example.invalid`,
                email_verified: true,
                firebase: { sign_in_provider: "password" },
              },
            }
          : {},
      );
      clients[actorKey] = { app, firestore };
    }
  }

  async function teardown() {
    try {
      await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
      await adminDb.recursiveDelete(adminDb.doc(`stakes/${otherStakeId}`));
      for (const actor of Object.values(ACTORS)) {
        if (actor.name) await adminDb.recursiveDelete(adminDb.doc(`users/${uid(actor.name)}`));
      }
    } finally {
      await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
      await adminDb.terminate();
    }
  }

  // -------------------------------------------------------------------------
  // Attività e percorsi
  // -------------------------------------------------------------------------

  let activityCounter = 0;
  /** Attività nuova: `requires` true/false, `type` "trip" o "camp" (le assegnazioni di pattuglia vogliono un campeggio). */
  async function seedActivity({ requires = true, type = "trip", status = "registrations_open" } = {}) {
    activityCounter += 1;
    const activityId = `attivita-${activityCounter}`;
    await adminDb.doc(`stakes/${stakeId}/activities/${activityId}`).set({
      title: `Attività di prova ${activityCounter}`,
      activityType: type,
      overnight: true,
      status,
      isPublic: true,
      isVisible: true,
      registrationOpen: "2026-09-01T08:00:00.000Z",
      startDate: "2026-11-13T14:00:00.000Z",
      endDate: "2026-11-17T16:00:00.000Z",
      requiresParentAuthorization: requires,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    return activityId;
  }

  const regPath = (activityId, registrationId) => `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`;
  const regRef = (actor, activityId, registrationId) => doc(fs(actor), regPath(activityId, registrationId));
  const stored = async (path) => (await adminDb.doc(path).get()).data();

  /** Rifiuto delle rules: l'operazione si passa come funzione, così non resta una promessa rifiutata senza gestore. */
  async function expectDenied(operation, message = "") {
    let failure = null;
    try {
      await operation();
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, `${message}: la scrittura doveva essere negata e invece è passata`);
    assert.equal(failure?.code, "permission-denied", `${message} ${failure?.code}: ${failure?.message}`);
  }

  /** Negato, e il documento resta com'era (un rifiuto non lascia traccia). */
  async function expectDeniedUnchanged(path, operation, message = "") {
    const before = await stored(path);
    await expectDenied(operation, message);
    assert.deepEqual(await stored(path), before, `${message}: un rifiuto non cambia il documento`);
  }

  // -------------------------------------------------------------------------
  // Persone e iscrizioni a mano
  // -------------------------------------------------------------------------

  const personDraft = (overrides = {}) => ({
    firstName: "Luca",
    lastName: "Bianchi",
    birthDate: ADULT,
    genderRoleCategory: "giovane_uomo",
    unitId: UNIT_1.id,
    unitName: UNIT_1.name,
    email: "",
    phone: "",
    ...overrides,
  });
  const minorDraft = (overrides = {}) => personDraft({ firstName: "Marco", lastName: "Rossi", birthDate: MINOR, ...overrides });
  const parentDraft = (overrides = {}) => ({
    firstName: "Paola",
    lastName: "Rossi",
    email: "genitore@example.invalid",
    phone: "3331234567",
    ...overrides,
  });

  /** Il documento che scrive il client (buildManualRegistrationDoc), con l'admin di default come autore. */
  function manualDoc({ person = personDraft(), parent = parentDraft(), requires = true, createdBy, timestamp, ...overrides } = {}) {
    return {
      ...buildManualRegistrationDoc({
        person,
        parent,
        requiresParentAuthorization: requires,
        createdBy: createdBy ?? uid(ACTORS.admin.name),
        timestamp: timestamp ?? nowIso(),
      }),
      ...overrides,
    };
  }

  let manualCounter = 0;
  /** Id `manual_` valido e unico (stessa forma di newManualRegistrationId, ma deterministico nei test). */
  const manualId = () => {
    manualCounter += 1;
    return `manual_${runId}${String(manualCounter).padStart(4, "0")}`;
  };

  // -------------------------------------------------------------------------
  // Iscrizioni "esistenti": le forme dei flussi veri
  // -------------------------------------------------------------------------

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

  /** Preferenze stanza abbinate (scrittura dell'admin: normalizeRoomPreferenceMatches). */
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

  /** Risposte di un modulo lungo (circa `count` campi, anche annidati). */
  function heavyAnswers(count, base) {
    const answers = {
      ...base,
      address: "Via dei Test 1",
      city: "Roma",
      transportMode: "bus",
      roomPreference1Name: "Luca Bianchi",
      roomPreference2Name: "Giovanni Verdi",
      roomNotes: "Preferisce il letto in basso",
      allergies: "Graminacee, acari, nichel",
      photoInternalConsent: true,
      parentConfirmed: true,
      parentConfirmedAt: SEEDED_AT,
      parentalConsentAccepted: true,
      shirtSize: "M",
      swimming: "si",
      previousCamps: ["2024", "2025"],
      talents: ["canto", "chitarra", "cucina"],
      notesForLeaders: "Soffre il mal d'auto: meglio davanti sul pullman.",
    };
    for (let index = 1; index <= count; index += 1) {
      answers[`campo_${String(index).padStart(2, "0")}`] =
        index % 3 === 0 ? index % 2 === 0 : index % 3 === 1 ? `Risposta libera numero ${index}` : [`a${index}`, `b${index}`];
    }
    return answers;
  }

  /**
   * Iscrizione di un figlio gestita da un genitore. `flavor`: "pending" (dopo
   * la prima mail), "signed" (confermata, firma e consenso), "heavy" (firmata
   * con stanza, pattuglia, comitati e 56 risposte), "maximal" (ogni campo
   * ammesso valorizzato: il caso peggiore del budget). `cancelled` e `legacy`
   * (senza assignedRoomName e assignedCommittees) come nei documenti vecchi.
   */
  function childRegistration(parentUid, registrationId, flavor, { cancelled = false, legacy = false, birthDate = MINOR } = {}) {
    const signedFolder = `parentAuthorizations/${stakeId}/act/${registrationId}`;
    let data = {
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
      birthDate,
      genderRoleCategory: "giovane_donna",
      unitId: UNIT_1.id,
      unitNameSnapshot: UNIT_1.name,
      answers: {
        birthDate,
        genderRoleCategory: "giovane_donna",
        youthGroup: "Giovani Donne",
        unitName: UNIT_1.name,
        transportMode: "bus",
        parentAuthorizationRequest: parentRequest(),
      },
      roomPreferenceMatches: {},
      accessCode: null,
      recoveryCode: null,
      participatingDays: DAYS.slice(0, 2),
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
      parentAuthorization: emailSentState("token-in-attesa"),
      linkedLaterToUserId: null,
      registrationStatus: "pending_parent_authorization",
      submittedByMode: "parent",
      assignedRoomId: null,
      assignedRoomName: null,
      assignedTempleShiftId: null,
      assignedServiceTeamIds: [],
      assignedPatrolId: null,
      assignedPatrolName: null,
      assignedPatrolRole: null,
      assignedCommittees: [],
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    };
    if (flavor !== "pending") {
      data = {
        ...data,
        registrationStatus: "confirmed",
        parentAuthorization: authorizedState(registrationId, "token-usato"),
        parentConsentDocumentName: `modulo-consenso-${registrationId}.pdf`,
        parentConsentDocumentPath: `${signedFolder}/consenso.pdf`,
        parentConsentUploadedAt: SIGNED_AT,
        consentSignaturePath: `${signedFolder}/signature.png`,
        consentSignatureSetAt: SIGNED_AT,
        updatedAt: SIGNED_AT,
      };
    }
    if (flavor === "heavy" || flavor === "maximal") {
      data = {
        ...data,
        answers: heavyAnswers(30, {
          ...data.answers,
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
        }),
        roomPreferenceMatches: roomMatches(),
        participatingDays: DAYS,
        assignedRoomId: "stanza-12",
        assignedRoomName: "Stanza 12",
        assignedPatrolId: "pattuglia-aquile",
        assignedPatrolName: "Aquile",
        assignedPatrolRole: "member",
        assignedCommittees: [{ committeeId: "cucina", role: "member" }, { committeeId: "pulizie", role: "leader" }],
        parentAuthorization: authorizedState(registrationId, "token-usato", {
          emergencyContactName: "Nonna Test",
          emergencyContactPhone: "3332222222",
          emergencyContactRelation: "nonna",
          allergies: "Graminacee, acari",
          medications: "Antistaminico al bisogno",
          medicalNotes: "Asma lieve da sforzo, porta il suo spray.",
          dietaryNotes: "Niente frutta a guscio",
          brevoMessageId: "<202610010800.1234567890@smtp-relay.mailin.fr>",
        }),
      };
    }
    if (flavor === "maximal") {
      data = {
        ...data,
        anonymousTokenId: "token-anonimo-1",
        accessCode: "ACC-1234",
        recoveryCode: "REC-5678",
        recoveryPdfGenerated: true,
        parentConsentDocumentUrl: "https://storage.example.invalid/consenso.pdf",
        consentSignatureUrl: "https://storage.example.invalid/firma.png",
        parentIdDocumentName: `documento-${registrationId}.pdf`,
        parentIdDocumentUrl: "https://storage.example.invalid/documento.pdf",
        parentIdDocumentPath: `${signedFolder}/documento.pdf`,
        parentIdUploadedAt: SIGNED_AT,
        linkedLaterToUserId: uid(ACTORS.utente.name),
        assignedTempleShiftId: "turno-tempio-3",
        assignedServiceTeamIds: ["squadra-cucina", "squadra-pulizie"],
      };
    }
    if (cancelled) data = { ...data, registrationStatus: "cancelled" };
    if (legacy) {
      const { assignedRoomName: _room, assignedCommittees: _committees, ...rest } = data;
      data = rest;
    }
    return data;
  }

  /** Iscrizione di un account adulto (`user_<uid>`), "pesante" se flavor è heavy o maximal. */
  function accountRegistration(ownerUid, flavor = "light", { cancelled = false, legacy = false, authorization = null } = {}) {
    let data = {
      userId: ownerUid,
      anonymousUid: null,
      anonymousTokenId: null,
      firstName: "Giorgio",
      lastName: "Bianchi",
      fullName: "Giorgio Bianchi",
      email: "giorgio@example.invalid",
      phone: "3471234567",
      birthDate: ADULT,
      genderRoleCategory: "giovane_uomo",
      unitId: UNIT_1.id,
      unitNameSnapshot: UNIT_1.name,
      answers: { birthDate: ADULT, genderRoleCategory: "giovane_uomo", youthGroup: "Giovani Uomini", unitName: UNIT_1.name, transportMode: "bus" },
      roomPreferenceMatches: {},
      accessCode: null,
      recoveryCode: null,
      participatingDays: DAYS.slice(0, 2),
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
      parentAuthorization: authorization,
      linkedLaterToUserId: null,
      parentUid: null,
      childId: null,
      registrationStatus: "active",
      submittedByMode: "authenticated",
      assignedRoomId: null,
      assignedRoomName: null,
      assignedTempleShiftId: null,
      assignedServiceTeamIds: [],
      assignedPatrolId: null,
      assignedPatrolName: null,
      assignedPatrolRole: null,
      assignedCommittees: [],
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    };
    if (flavor === "heavy" || flavor === "maximal") {
      data = {
        ...data,
        answers: heavyAnswers(30, data.answers),
        roomPreferenceMatches: roomMatches(),
        participatingDays: DAYS,
        assignedRoomId: "stanza-12",
        assignedRoomName: "Stanza 12",
        assignedPatrolId: "pattuglia-aquile",
        assignedPatrolName: "Aquile",
        assignedPatrolRole: "member",
        assignedCommittees: [{ committeeId: "cucina", role: "member" }, { committeeId: "pulizie", role: "leader" }],
      };
    }
    if (flavor === "maximal") {
      data = {
        ...data,
        anonymousTokenId: "token-anonimo-1",
        accessCode: "ACC-1234",
        recoveryCode: "REC-5678",
        recoveryPdfGenerated: true,
        parentConsentDocumentName: "modulo-consenso.pdf",
        parentConsentDocumentUrl: "https://storage.example.invalid/consenso.pdf",
        parentConsentDocumentPath: `parentAuthorizations/${stakeId}/act/${ownerUid}/consenso.pdf`,
        parentConsentUploadedAt: SIGNED_AT,
        consentSignatureUrl: "https://storage.example.invalid/firma.png",
        consentSignaturePath: `parentAuthorizations/${stakeId}/act/${ownerUid}/signature.png`,
        consentSignatureSetAt: SIGNED_AT,
        parentIdDocumentName: "documento.pdf",
        parentIdDocumentUrl: "https://storage.example.invalid/documento.pdf",
        parentIdDocumentPath: `parentAuthorizations/${stakeId}/act/${ownerUid}/documento.pdf`,
        parentIdUploadedAt: SIGNED_AT,
        linkedLaterToUserId: uid(ACTORS.utente.name),
        assignedTempleShiftId: "turno-tempio-3",
        assignedServiceTeamIds: ["squadra-cucina", "squadra-pulizie"],
      };
    }
    if (cancelled) data = { ...data, registrationStatus: "cancelled" };
    if (legacy) {
      const { assignedRoomName: _room, assignedCommittees: _committees, ...rest } = data;
      data = rest;
    }
    return data;
  }

  /** Semina un'iscrizione in un'attività nuova (o in quella indicata) e rilegge ciò che c'è. */
  async function seedRegistration(build, registrationId, { activityId, requires = true, type = "trip" } = {}) {
    const activity = activityId ?? (await seedActivity({ requires, type }));
    const path = regPath(activity, registrationId);
    await adminDb.doc(path).set(build);
    return { activityId: activity, registrationId, path, current: await stored(path) };
  }

  // -------------------------------------------------------------------------
  // Le scritture del client admin, come i servizi (src/services/firestore)
  // -------------------------------------------------------------------------

  const clientOps = {
    /** adminCreateManualRegistration: setDoc del documento intero. */
    createManual: (actor, activityId, registrationId, document) =>
      setDoc(regRef(actor, activityId, registrationId), document),

    /** adminUpdateRegistration: updateDoc con le chiavi di buildAdminEditPatch / buildRequestAuthorizationPatch. */
    update: (actor, activityId, registrationId, patch) => updateDoc(regRef(actor, activityId, registrationId), patch),

    /** adminSetRegistrationStatus: stato e updatedAt. */
    setStatus: (actor, activityId, registrationId, status) =>
      updateDoc(regRef(actor, activityId, registrationId), { registrationStatus: status, updatedAt: nowIso() }),

    /** adminUpdateParentAuthorizationEmail: lettura dal server, `answers` intero e percorsi di parentAuthorization. */
    async updateParentEmail(actor, activityId, registrationId, parentEmail) {
      const reference = regRef(actor, activityId, registrationId);
      const existing = (await getDocFromServer(reference)).data();
      const normalizedEmail = parentEmail.trim().toLowerCase();
      const nextAnswers = { ...existing.answers };
      const request = nextAnswers.parentAuthorizationRequest;
      if (request && typeof request === "object" && !Array.isArray(request)) {
        nextAnswers.parentAuthorizationRequest = { ...request, parentEmail: normalizedEmail };
      }
      const timestamp = nowIso();
      const payload = { answers: nextAnswers, updatedAt: timestamp };
      if (existing.parentAuthorization) {
        payload["parentAuthorization.parentEmail"] = normalizedEmail;
        payload["parentAuthorization.emailLastError"] = null;
        payload["parentAuthorization.updatedAt"] = timestamp;
      }
      await updateDoc(reference, payload);
    },

    /** normalizeRoomPreferenceMatches: batch.update di roomPreferenceMatches e updatedAt per ogni iscrizione. */
    async normalizeRoomMatches(actor, targets) {
      const batch = writeBatch(fs(actor));
      const timestamp = nowIso();
      for (const { activityId, registrationId } of targets) {
        batch.update(regRef(actor, activityId, registrationId), { roomPreferenceMatches: roomMatches(), updatedAt: timestamp });
      }
      await batch.commit();
    },

    /** syncRegistrationCampAssignments (campManagementService): pattuglia e comitati su ogni iscrizione. */
    async campAssignments(actor, targets, { patrol = "pattuglia-aquile" } = {}) {
      const batch = writeBatch(fs(actor));
      const timestamp = nowIso();
      for (const { activityId, registrationId } of targets) {
        batch.update(regRef(actor, activityId, registrationId), {
          assignedPatrolId: patrol,
          assignedPatrolName: patrol ? "Aquile" : null,
          assignedPatrolRole: patrol ? "member" : null,
          assignedCommittees: [{ committeeId: "cucina", role: "member" }],
          updatedAt: timestamp,
        });
      }
      await batch.commit();
    },

    /**
     * upsertRegistration su documento esistente (ramo updateDoc): i campi che
     * il modulo riscrive; `changes` per telefono, risposte e stato.
     */
    resave(actor, activityId, registrationId, current, { status, changes = {} } = {}) {
      return updateDoc(regRef(actor, activityId, registrationId), {
        firstName: current.firstName,
        lastName: current.lastName,
        fullName: current.fullName,
        email: current.email,
        phone: changes.phone ?? current.phone,
        birthDate: changes.birthDate ?? current.birthDate,
        genderRoleCategory: current.genderRoleCategory,
        unitNameSnapshot: current.unitNameSnapshot,
        answers: changes.answers ?? current.answers,
        roomPreferenceMatches: current.roomPreferenceMatches,
        participatingDays: current.participatingDays,
        registrationStatus: status ?? current.registrationStatus,
        updatedAt: nowIso(),
      });
    },
  };

  return {
    PROJECT,
    FIRESTORE_HOST,
    runId,
    stakeId,
    otherStakeId,
    uid,
    ACTORS,
    clients,
    fs,
    adminDb,
    setup,
    teardown,
    seedActivity,
    regPath,
    regRef,
    stored,
    expectDenied,
    expectDeniedUnchanged,
    personDraft,
    minorDraft,
    parentDraft,
    manualDoc,
    manualId,
    parentRequest,
    emailSentState,
    authorizedState,
    roomMatches,
    heavyAnswers,
    childRegistration,
    accountRegistration,
    seedRegistration,
    clientOps,
  };
}
