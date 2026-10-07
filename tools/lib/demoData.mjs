// Dati sintetici per la demo (progetto di staging o emulatori), con i 4 ruoli:
// admin di palo, dirigente di unità, partecipante, genitore con due figli.
//
// Deterministico: ids fissi, nomi da liste fisse, date relative a `today`
// (--today YYYY-MM-DD, altrimenti oggi). Stesso `today` = stessi documenti.
// Email: `.invalid` per i login e per i genitori sintetici; solo
// DEMO_PARENT_EMAIL (indirizzo di chi gestisce la demo) può essere vero e
// non è mai nel sorgente.
//
// Forma dei documenti: firestore.rules (validUserPayload, validRegistrationPayload,
// validChildPayload) e le callable in functions/lib/parentAuthorization.js.
import crypto from "node:crypto";

import { buildStakeDocument, buildUnitDocument, buildUserDocument, unitIdFor } from "./stakes.mjs";

export const DEMO_STAKE_ID = "palo-demo";
export const DEMO_STAKE_NAME = "Palo Demo";
export const DEMO_STAKE_SLUG = "palo-demo";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_UNITS = [
  { name: "Rione Aurora", type: "rione" },
  { name: "Rione Brezza", type: "rione" },
  { name: "Ramo Collina", type: "ramo" },
];

/**
 * Account con login del palo demo. `prefix` serve solo ai test, per seminare un
 * secondo set isolato accanto a quello vero (uid ed email cambiano, i nomi no).
 */
export function demoAccounts(prefix = "demo") {
  return {
    admin: { uid: `${prefix}-admin`, email: `admin.${prefix}@example.invalid`, firstName: "Elena", lastName: "Marchetti" },
    leader: { uid: `${prefix}-leader`, email: `dirigente.${prefix}@example.invalid`, firstName: "Roberto", lastName: "Ferri" },
    participant: { uid: `${prefix}-participant`, email: `partecipante.${prefix}@example.invalid`, firstName: "Sofia", lastName: "Bianchi" },
    parent: { uid: `${prefix}-parent`, email: `genitore.${prefix}@example.invalid`, firstName: "Laura", lastName: "Conti" },
  };
}
export const DEMO_ACCOUNTS = demoAccounts("demo");

const demoChildren = (prefix) => [
  { id: `${prefix}-child-matteo`, firstName: "Matteo", lastName: "Conti", gender: "giovane_uomo", birthDate: "2011-05-20" },
  { id: `${prefix}-child-chiara`, firstName: "Chiara", lastName: "Conti", gender: "giovane_donna", birthDate: "2009-11-02" },
];
const magicTokenFor = (prefix) =>
  crypto.createHash("sha256").update(`${prefix}-magic-link-matteo`).digest("hex");

const BOYS = ["Marco", "Luca", "Andrea", "Davide", "Simone", "Gabriele", "Pietro", "Lorenzo", "Filippo", "Tommaso"];
const GIRLS = ["Giulia", "Anna", "Elena", "Alice", "Sara", "Emma", "Giorgia", "Beatrice", "Aurora", "Martina"];
const SURNAMES = ["Rossi", "Russo", "Esposito", "Romano", "Colombo", "Ricci", "Marino", "Greco", "Bruno", "Gallo", "Costa", "Fontana"];
const YOUTH_COUNT = 18;
// Valori di `transportMode` come nel modulo (src/utils/formFields.ts).
const TRANSPORT_CHOICES = [
  "Vengo con la mia famiglia",
  "Pullman organizzato",
  "Ho bisogno di un passaggio",
  "Posso dare un passaggio ad altri",
  "Treno",
];

export const MATTEO_MAGIC_TOKEN = magicTokenFor("demo");
const hashToken = (raw) => crypto.createHash("sha256").update(raw, "utf8").digest("hex");
export const hashEmail = (email) =>
  crypto.createHash("sha256").update(String(email).trim().toLowerCase(), "utf8").digest("hex");

function authorizedState({ parentName, parentEmail, now }) {
  const [parentFirstName, ...rest] = parentName.split(" ");
  return {
    status: "authorized",
    tokenId: null,
    parentFirstName,
    parentLastName: rest.join(" "),
    parentEmail,
    parentPhone: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    allergies: "",
    medications: "",
    medicalNotes: "",
    dietaryNotes: "",
    emailSentAt: now,
    emailLastError: null,
    emailRetryCount: 0,
    emailProvider: "brevo",
    brevoMessageId: null,
    authorizedAt: now,
    rejectedAt: null,
    expiresAt: null,
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
    createdAt: now,
    updatedAt: now,
    parentName,
  };
}

function pendingState({ parentName, parentEmail, tokenId, now, expiresAt }) {
  return {
    ...authorizedState({ parentName, parentEmail, now }),
    status: "pending_parent_authorization",
    // tokenId valorizzato: il trigger non rimanda mai la mail iniziale.
    tokenId,
    authorizedAt: null,
    expiresAt,
  };
}

function registrationDoc({
  firstName,
  lastName,
  genderRoleCategory,
  birthDate,
  unit,
  status,
  mode,
  userId = null,
  parentUid,
  childId,
  answers = {},
  parentAuthorization,
  createdAt,
}) {
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    email: "",
    phone: "",
    birthDate,
    genderRoleCategory,
    unitId: unit.id,
    unitNameSnapshot: unit.name,
    answers: { birthDate, genderRoleCategory, unitName: unit.name, ...answers },
    roomPreferenceMatches: {},
    participatingDays: [],
    accessCode: null,
    recoveryCode: null,
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
    linkedLaterToUserId: null,
    registrationStatus: status,
    submittedByMode: mode,
    userId,
    anonymousUid: null,
    anonymousTokenId: null,
    ...(parentUid ? { parentUid, childId } : {}),
    ...(parentAuthorization ? { parentAuthorization } : {}),
    assignedRoomId: null,
    assignedTempleShiftId: null,
    assignedServiceTeamIds: [],
    assignedPatrolId: null,
    assignedPatrolName: null,
    assignedPatrolRole: null,
    assignedCommittees: [],
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Costruisce l'intero set di documenti (senza scrivere niente).
 * @returns {{ auth: Array, docs: Array<{path: string, data: object}>, summary: object, magicLink: string }}
 */
export function buildDemoDataset({ today, parentEmail, appUrl, stakeId = DEMO_STAKE_ID, prefix = "demo" }) {
  const accounts = demoAccounts(prefix);
  const CHILDREN = demoChildren(prefix);
  const magicToken = magicTokenFor(prefix);
  const base = new Date(`${today}T12:00:00.000Z`);
  if (Number.isNaN(base.getTime())) throw new Error(`--today non valido: ${today}`);
  const at = (offsetDays, hour = 12) =>
    new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offsetDays, hour)).toISOString();
  const now = at(0);

  const stake =
    stakeId === DEMO_STAKE_ID
      ? { id: stakeId, name: DEMO_STAKE_NAME, slug: DEMO_STAKE_SLUG }
      : { id: stakeId, name: `Palo ${stakeId}`, slug: stakeId };
  const units = DEMO_UNITS.map((unit) => ({ ...unit, id: unitIdFor(stakeId, unit.name) }));
  const [aurora, brezza, collina] = units;
  const realParentEmail = parentEmail || `genitore.registrazione.${prefix}@example.invalid`;

  const docs = [];
  const add = (path, data) => docs.push({ path, data });

  add(`stakes/${stakeId}`, {
    ...buildStakeDocument({ ...stake, supportContact: "demo.supporto@example.invalid", now }),
    publicHomeTitle: "Attività giovanili · Demo",
    youngMenPresident: "Paolo Greco",
    youngMenCounselors: ["Franco Villa", "Marco Neri"],
    youngWomenPresident: "Elena Marchetti",
    youngWomenCounselors: ["Chiara Sala", "Anna Longo"],
  });
  for (const unit of units) add(`stakes/${stakeId}/units/${unit.id}`, buildUnitDocument({ ...unit, now }));

  // Account con login
  const { admin, leader, participant, parent } = accounts;
  add(`users/${admin.uid}`, buildUserDocument({
    ...admin, role: "admin", stake, genderRoleCategory: "dirigente", birthDate: "1982-04-12", unit: aurora, now,
  }));
  add(`users/${leader.uid}`, buildUserDocument({
    ...leader, role: "unit_leader", stake, genderRoleCategory: "dirigente", birthDate: "1985-09-03", unit: aurora, now,
  }));
  add(`users/${participant.uid}`, buildUserDocument({
    ...participant, role: "participant", stake, genderRoleCategory: "giovane_donna", birthDate: "2011-03-14", unit: aurora, now,
  }));
  add(`users/${parent.uid}`, buildUserDocument({
    ...parent, role: "parent", stake, unit: aurora, city: "Roma", now,
  }));
  for (const child of CHILDREN) {
    add(`users/${parent.uid}/children/${child.id}`, {
      firstName: child.firstName,
      lastName: child.lastName,
      fullName: `${child.firstName} ${child.lastName}`,
      birthDate: child.birthDate,
      genderRoleCategory: child.gender,
      unitId: aurora.id,
      unitName: aurora.name,
      stakeId: stakeId,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Giovani sintetici (profili senza login), a rotazione sulle tre unità
  const youth = Array.from({ length: YOUTH_COUNT }, (_, index) => {
    const isBoy = index % 2 === 0;
    const pool = isBoy ? BOYS : GIRLS;
    const unit = units[index % units.length];
    return {
      uid: `${prefix}-youth-${String(index + 1).padStart(2, "0")}`,
      firstName: pool[Math.floor(index / 2) % pool.length],
      lastName: SURNAMES[index % SURNAMES.length],
      gender: isBoy ? "giovane_uomo" : "giovane_donna",
      birthDate: `${2008 + (index % 5)}-${String(1 + ((index * 5) % 12)).padStart(2, "0")}-${String(3 + ((index * 7) % 24)).padStart(2, "0")}`,
      unit,
    };
  });
  for (const person of youth) {
    add(`users/${person.uid}`, buildUserDocument({
      firstName: person.firstName, lastName: person.lastName, role: "participant", stake,
      genderRoleCategory: person.gender, birthDate: person.birthDate, unit: person.unit, now,
    }));
  }

  // Attività
  const activityBase = {
    description: "Attività di esempio con dati sintetici.",
    audience: "congiunta",
    isPublic: true,
    isVisible: true,
    status: "registrations_open",
    requiresAccount: true,
    requiresParentAuthorization: true,
    requiresEmergencyContacts: true,
    requiresMedicalNotes: true,
    createdBy: admin.uid,
    createdAt: at(-20),
    updatedAt: at(-20),
  };
  const trip = {
    ...activityBase,
    title: "Viaggio al Tempio",
    description: "Due giorni al Tempio con pernottamento. Dati sintetici di esempio.",
    location: "Tempio di Roma e Foresteria",
    program: "Sessione al tempio, cena insieme, serata e rientro il giorno dopo.",
    year: base.getUTCFullYear(),
    activityType: "trip",
    overnight: true,
    startDate: at(30, 6),
    endDate: at(31, 18),
    registrationOpen: at(-10, 0),
    registrationClose: at(20, 22),
    maxParticipants: 40,
  };
  const camp = {
    ...activityBase,
    title: "Campeggio estivo",
    description: "Campeggio di palo con pattuglie e comitati. Dati sintetici di esempio.",
    location: "Campo scout di esempio",
    program: "Quattro giorni di attività all'aperto, servizio e serate attorno al fuoco.",
    year: base.getUTCFullYear(),
    activityType: "camp",
    overnight: true,
    startDate: at(80, 15),
    endDate: at(84, 11),
    registrationOpen: at(-5, 0),
    registrationClose: at(60, 22),
    maxParticipants: 60,
  };
  const activities = [
    { id: "viaggio-tempio", doc: trip },
    { id: "campeggio-estivo", doc: camp },
  ];
  for (const { id, doc } of activities) {
    add(`stakes/${stakeId}/activities/${id}`, doc);
    add(`stakes/${stakeId}/activities/${id}/config/form`, {
      allowGuestRegistration: false,
      requireLoginForEdit: true,
    });
  }

  // Iscrizioni
  const reg = (activityId, id, data) => add(`stakes/${stakeId}/activities/${activityId}/registrations/${id}`, data);
  const genitoreSintetico = { parentName: "Genitore Esempio", parentEmail: `genitore.esempio.${prefix}@example.invalid` };
  const request = (extra) => ({
    parentAuthorizationRequest: {
      parentFirstName: parent.firstName,
      parentLastName: parent.lastName,
      parentEmail: realParentEmail.toLowerCase(),
      parentPhone: "3330001122",
      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelation: "",
      allergies: "",
      medications: "",
      medicalNotes: "",
      dietaryNotes: "",
      submittedAt: at(-3),
      ...extra,
    },
  });

  const matteo = CHILDREN[0];
  const chiara = CHILDREN[1];
  const magicTokenId = hashToken(magicToken);
  reg("viaggio-tempio", `child_${parent.uid}_${matteo.id}`, registrationDoc({
    firstName: matteo.firstName, lastName: matteo.lastName, genderRoleCategory: matteo.gender,
    birthDate: matteo.birthDate, unit: aurora, status: "pending_parent_authorization", mode: "parent",
    parentUid: parent.uid, childId: matteo.id, answers: request(),
    parentAuthorization: pendingState({
      parentName: `${parent.firstName} ${parent.lastName}`, parentEmail: realParentEmail.toLowerCase(),
      tokenId: magicTokenId, now: at(-3), expiresAt: at(11),
    }),
    createdAt: at(-3),
  }));
  add(`parentAuthorizationTokens/${magicTokenId}`, {
    id: magicTokenId,
    tokenHash: magicTokenId,
    stakeId: stakeId,
    activityId: "viaggio-tempio",
    registrationId: `child_${parent.uid}_${matteo.id}`,
    parentEmail: realParentEmail.toLowerCase(),
    participantName: `${matteo.firstName} ${matteo.lastName}`,
    activityTitle: trip.title,
    activityStartDate: trip.startDate,
    activityEndDate: trip.endDate,
    status: "pending",
    createdAt: at(-3),
    expiresAt: at(11),
    usedAt: null,
    invalidatedAt: null,
    createdByUserId: null,
    createdByMode: "system",
  });
  reg("viaggio-tempio", `child_${parent.uid}_${chiara.id}`, registrationDoc({
    firstName: chiara.firstName, lastName: chiara.lastName, genderRoleCategory: chiara.gender,
    birthDate: chiara.birthDate, unit: aurora, status: "confirmed", mode: "parent",
    parentUid: parent.uid, childId: chiara.id,
    answers: { ...request(), transportMode: "Pullman organizzato", photoInternalConsent: true },
    parentAuthorization: authorizedState({
      parentName: `${parent.firstName} ${parent.lastName}`, parentEmail: realParentEmail.toLowerCase(), now: at(-6),
    }),
    createdAt: at(-7),
  }));
  reg("viaggio-tempio", `user_${participant.uid}`, registrationDoc({
    firstName: participant.firstName, lastName: participant.lastName, genderRoleCategory: "giovane_donna",
    birthDate: "2011-03-14", unit: aurora, status: "confirmed", mode: "authenticated", userId: participant.uid,
    answers: { transportMode: "Vengo con la mia famiglia", photoInternalConsent: true },
    parentAuthorization: authorizedState({ ...genitoreSintetico, now: at(-8) }),
    createdAt: at(-9),
  }));

  youth.forEach((person, index) => {
    const withAuthorization = authorizedState({ ...genitoreSintetico, now: at(-5) });
    const common = {
      firstName: person.firstName, lastName: person.lastName, genderRoleCategory: person.gender,
      birthDate: person.birthDate, unit: person.unit, mode: "authenticated", userId: person.uid,
      // Un po' di lacune volute (foto, trasporto) perché le dashboard mostrino numeri veri.
      answers: {
        ...(index % 4 === 3 ? {} : { transportMode: TRANSPORT_CHOICES[index % TRANSPORT_CHOICES.length] }),
        photoInternalConsent: index % 3 !== 0,
      },
      parentAuthorization: withAuthorization, createdAt: at(-9 + (index % 8)),
    };
    // Viaggio: 14 iscritti (12 confermati, 1 lista d'attesa, 1 annullato)
    if (index < 14) {
      const status = index === 12 ? "waitlist" : index === 13 ? "cancelled" : "confirmed";
      reg("viaggio-tempio", `user_${person.uid}`, registrationDoc({ ...common, status }));
    }
    // Campeggio: gli ultimi 8
    if (index >= YOUTH_COUNT - 8) {
      reg("campeggio-estivo", `user_${person.uid}`, registrationDoc({ ...common, status: "confirmed" }));
    }
  });

  const registrations = docs.filter((entry) => entry.path.includes("/registrations/")).length;
  return {
    docs,
    registrations,
    magicToken,
    magicLink: `${appUrl.replace(/\/$/, "")}/parent-confirm/${magicToken}`,
    summary: {
      stake: stakeId,
      today,
      documents: docs.length,
      registrations,
      logins: Object.values(accounts).map((account) => account.email),
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Scrive il dataset (upsert con ids fissi) e crea/aggiorna i 4 account di login. */
export async function seedDemo(
  { db, auth },
  { today, parentEmail, appUrl, password, apply, settleAlertsMs = 6000, keepAlerts = false, stakeId = DEMO_STAKE_ID, prefix = "demo" },
) {
  const accounts = demoAccounts(prefix);
  const dataset = buildDemoDataset({ today, parentEmail, appUrl, stakeId, prefix });
  if (!apply) return { applied: false, ...dataset };

  for (const account of Object.values(accounts)) {
    const profile = {
      email: account.email,
      emailVerified: true,
      displayName: `${account.firstName} ${account.lastName}`,
      password,
    };
    try {
      await auth.updateUser(account.uid, profile);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
      await auth.createUser({ uid: account.uid, ...profile });
    }
  }

  for (let index = 0; index < dataset.docs.length; index += 400) {
    const batch = db.batch();
    for (const { path, data } of dataset.docs.slice(index, index + 400)) batch.set(db.doc(path), data);
    await batch.commit();
  }

  let clearedAlerts = 0;
  if (!keepAlerts) {
    // sendAdminPushForNewRegistration scrive un avviso "Nuovo iscritto" per ogni
    // iscrizione creata: li togliamo dopo che il trigger ha finito.
    await sleep(settleAlertsMs);
    const alerts = await db.collection(`stakes/${stakeId}/adminAlerts`).get();
    const stale = alerts.docs.filter((alert) => alert.id.startsWith("registration_created_"));
    for (let index = 0; index < stale.length; index += 400) {
      const batch = db.batch();
      for (const alert of stale.slice(index, index + 400)) batch.delete(alert.ref);
      await batch.commit();
    }
    clearedAlerts = stale.length;
  }

  return { applied: true, ...dataset, clearedAlerts };
}

/**
 * Cancella TUTTO ciò che appartiene al palo demo: documenti, profili e account
 * Auth di chi ha stakeId demo, token, cache firme dei genitori demo, Storage.
 * @param {object} ctx { db, auth, bucket|null }
 */
export async function resetDemo(
  { db, auth, bucket },
  { parentEmail, apply, stakeId = DEMO_STAKE_ID, prefix = "demo" },
) {
  const accounts = demoAccounts(prefix);
  const demoUsers = await db.collection("users").where("stakeId", "==", stakeId).get();
  const uids = [...new Set([...demoUsers.docs.map((doc) => doc.id), ...Object.values(accounts).map((a) => a.uid)])];
  const tokens = [
    ...(await db.collection("parentAuthorizationTokens").where("stakeId", "==", stakeId).get()).docs,
    ...(await db.collection("anonymousRegistrationTokens").where("stakeId", "==", stakeId).get()).docs,
  ];
  const emails = [
    parentEmail,
    `genitore.esempio.${prefix}@example.invalid`,
    `genitore.registrazione.${prefix}@example.invalid`,
    ...Object.values(accounts).map((a) => a.email),
  ].filter(Boolean);
  const cacheHashes = [...new Set(emails.map(hashEmail))];
  const prefixes = [
    `public/stakes/${stakeId}/`,
    `protected/stakes/${stakeId}/`,
    ...cacheHashes.map((hash) => `protected/parent-authorization-signature-cache/${hash}/`),
  ];

  // Chi si è registrato da solo nel palo demo (visitatori, account QA) viene
  // cancellato come gli account sintetici: l'elenco va letto prima di --apply.
  const seededUids = new Set([...Object.values(accounts).map((a) => a.uid)]);
  const strangers = demoUsers.docs
    .filter((doc) => !seededUids.has(doc.id) && !doc.id.startsWith(`${prefix}-youth-`))
    .map((doc) => ({ uid: doc.id, email: doc.data().email ?? null }));

  const plan = {
    stake: `stakes/${stakeId} (ricorsivo)`,
    users: uids.length,
    nonSeedUsers: strangers,
    tokens: tokens.length,
    signatureCacheDocs: cacheHashes.length,
    storagePrefixes: bucket ? prefixes : "(Storage non toccato)",
  };
  if (!apply) return { applied: false, plan };

  await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  for (const uid of uids) await db.recursiveDelete(db.doc(`users/${uid}`));
  for (const token of tokens) await token.ref.delete();
  for (const hash of cacheHashes) await db.doc(`parentAuthorizationSignatureCache/${hash}`).delete();
  await auth.deleteUsers(uids);
  if (bucket) {
    for (const prefix of prefixes) await bucket.deleteFiles({ prefix, force: true });
  }
  return { applied: true, plan };
}
