// Dati sintetici per la demo (progetto di staging o emulatori), con i 4 ruoli:
// admin di palo, dirigente di unità, partecipante, genitore con due figli.
// Tre attività: viaggio (futuro, piano stanze pubblicato), campeggio estivo
// (futuro) e campeggio d'autunno (concluso: galleria, pattuglie e comitati,
// staff, sondaggio con risposte), più i post della home del palo.
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
import fs from "node:fs";
import { createRequire } from "node:module";

import { buildMemberDocument, buildStakeDocument, buildUnitDocument, buildUserDocument, unitIdFor } from "./stakes.mjs";

const require = createRequire(new URL("../../functions/package.json", import.meta.url));

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

export const PAST_CAMP_ID = "campeggio-autunno";
// Segnaposto per i campi Timestamp (finestra della galleria, savedAt): il
// dataset resta JSON puro e confrontabile, seedDemo lo converte in scrittura.
export const TIMESTAMP = "__demoTimestamp";
// Titoli ed emoji dei comitati storici come in functions/lib/campManagement.js.
const CAMP_COMMITTEES = {
  logistics: { title: "Logistica e Materiali", emoji: "🧱" },
  wellbeing: { title: "Benessere e Supporto", emoji: "🛋️" },
  kitchen: { title: "Cucina", emoji: "🥘" },
  games: { title: "Giochi e Attività", emoji: "🛝" },
  spiritual: { title: "Pensieri Spirituali e Serate", emoji: "ℹ️" },
};
// File in tools/demo-media (generate.py): `uploader` 0 = Sofia, poi i giovani.
export const DEMO_MEDIA = [
  { file: "alba-sul-campo", caption: "Prima alba al campo", uploader: 0 },
  { file: "le-tende", caption: "Tende montate prima di cena", uploader: 3 },
  { file: "lago-al-mattino", caption: "Il lago dell'escursione", uploader: 5 },
  { file: "sentiero-del-gioco", caption: "Il sentiero del grande gioco", uploader: 0 },
  { file: "bandierine-del-campo", caption: "Le bandierine delle pattuglie", uploader: 2 },
  { file: "bosco-di-pini", caption: "Pausa nel bosco", uploader: 7 },
  { file: "serata-al-fuoco", caption: "Serata attorno al fuoco", uploader: 4 },
  { file: "cielo-stellato", caption: "L'ultima notte sotto le stelle", uploader: 9 },
];
const SURVEY_ANSWERS = [
  { category: "giovane_donna", giudizio: 5, programma: 4.5, ricordo: "La serata attorno al fuoco con tutte le unità.", parole: ["stelle", "amici", "freddo"] },
  { category: "giovane_uomo", giudizio: 4.5, programma: 4, ricordo: "Il grande gioco nel bosco, abbiamo vinto noi.", parole: ["fango", "squadra", "risate"] },
  { category: "giovane_donna", giudizio: 4, programma: 3.5, ricordo: "Il pensiero del mattino in riva al lago.", parole: ["pace", "lago", "sonno"] },
  { category: "giovane_uomo", giudizio: 5, programma: 5, ricordo: "Montare la tenda sotto la pioggia e riuscirci.", parole: ["tende", "pioggia", "orgoglio"] },
  { category: "dirigente", giudizio: 4.5, programma: 4, ricordo: "Vedere le pattuglie organizzarsi da sole il secondo giorno.", parole: ["fiducia", "servizio", "ordine"] },
  { category: "giovane_donna", giudizio: 3.5, programma: 3, ricordo: "La cucina: stancante ma divertente.", parole: ["cucina", "turni", "pasta"] },
  { category: "giovane_uomo", giudizio: 4, programma: 4.5, ricordo: "L'escursione al lago.", parole: ["cammino", "panorama", "zaino"] },
  { category: "giovane_donna", giudizio: 5, programma: 4, ricordo: "Le canzoni dell'ultima sera.", parole: ["musica", "fuoco", "abbracci"] },
  { category: "giovane_uomo", giudizio: 3, programma: 3.5, ricordo: "Troppo poco tempo libero, ma il gioco notturno era bello.", parole: ["notte", "torce", "corsa"] },
  { category: "dirigente", giudizio: 5, programma: 4.5, ricordo: "Il servizio al paese vicino il sabato mattina.", parole: ["servizio", "gratitudine", "sole"] },
  { category: "giovane_donna", giudizio: 4.5, programma: 5, ricordo: "Conoscere ragazze delle altre unità.", parole: ["nuove amiche", "giochi", "stelle"] },
];
// Scelte del genitore varie, perché le pill dei consensi mostrino tutti i casi:
// quasi tutti sì alle foto, social divisi, qualche firma senza risposta.
const consentMix = (index) =>
  index % 7 === 6
    ? { photoConsent: "not_answered", socialPublicationConsent: "not_answered" }
    : { photoConsent: index % 5 === 4 ? "refused" : "accepted", socialPublicationConsent: index % 2 === 0 ? "accepted" : "refused" };
// Le date sono relative a `today`: il nome della stagione segue la data di
// inizio, così un seed di novembre non presenta un "Campeggio estivo" a gennaio.
const campTitle = (iso) => {
  const month = new Date(iso).getUTCMonth() + 1;
  const season = month === 12 || month <= 2 ? "d'inverno" : month <= 5 ? "di primavera" : month <= 8 ? "estivo" : "d'autunno";
  return `Campeggio ${season}`;
};
const tokenFor = (seed) => {
  const hex = crypto.createHash("sha256").update(`demo-media-token/${seed}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const hashToken = (raw) => crypto.createHash("sha256").update(raw, "utf8").digest("hex");
export const hashEmail = (email) =>
  crypto.createHash("sha256").update(String(email).trim().toLowerCase(), "utf8").digest("hex");

// Scelte foto e social della firma: "accepted" | "refused" | "not_answered".
function authorizedState({ parentName, parentEmail, now, photoConsent = "not_answered", socialPublicationConsent = "not_answered" }) {
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
    photoConsent,
    socialPublicationConsent,
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
export function buildDemoDataset({ today, parentEmail, appUrl, stakeId = DEMO_STAKE_ID, prefix = "demo", media = null }) {
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

  // Appartenenza al palo: ogni profilo del palo demo è membro attivo.
  for (const { path, data } of docs.filter((entry) => /^users\/[^/]+$/u.test(entry.path))) {
    add(`stakes/${stakeId}/members/${path.slice("users/".length)}`, buildMemberDocument({ user: data, ref: "tools/seed-demo", now }));
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
    title: campTitle(at(80, 15)),
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
      photoConsent: "accepted", socialPublicationConsent: "refused",
    }),
    createdAt: at(-7),
  }));
  reg("viaggio-tempio", `user_${participant.uid}`, registrationDoc({
    firstName: participant.firstName, lastName: participant.lastName, genderRoleCategory: "giovane_donna",
    birthDate: "2011-03-14", unit: aurora, status: "confirmed", mode: "authenticated", userId: participant.uid,
    answers: { transportMode: "Vengo con la mia famiglia", photoInternalConsent: true },
    parentAuthorization: authorizedState({ ...genitoreSintetico, now: at(-8), ...consentMix(0) }),
    createdAt: at(-9),
  }));

  youth.forEach((person, index) => {
    const withAuthorization = authorizedState({ ...genitoreSintetico, now: at(-5), ...consentMix(index + 1) });
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

  // Campeggio già concluso: galleria, pattuglie e comitati, staff e sondaggio
  // hanno bisogno di un'attività iniziata o finita (le altre due sono future).
  const pastCamp = {
    ...activityBase,
    title: campTitle(at(-9, 15)),
    description: "Quattro giorni in tenda con pattuglie, comitati e serate attorno al fuoco. Dati sintetici di esempio.",
    location: "Campo scout di esempio",
    program: "Arrivo e montaggio delle tende, giochi a pattuglie, escursione al lago, serata delle unità e rientro.",
    year: base.getUTCFullYear(),
    activityType: "camp",
    overnight: true,
    startDate: at(-9, 15),
    endDate: at(-5, 11),
    registrationOpen: at(-40, 0),
    registrationClose: at(-12, 22),
    status: "registrations_closed",
    maxParticipants: 60,
    createdAt: at(-45),
    updatedAt: at(-45),
  };
  add(`stakes/${stakeId}/activities/${PAST_CAMP_ID}`, pastCamp);
  add(`stakes/${stakeId}/activities/${PAST_CAMP_ID}/config/form`, { allowGuestRegistration: false, requireLoginForEdit: true });
  const pastCampRegs = [];
  const pastReg = (id, data) => {
    reg(PAST_CAMP_ID, id, data);
    pastCampRegs.push({ id, fullName: data.fullName, genderRoleCategory: data.genderRoleCategory, unitName: data.unitNameSnapshot });
  };
  pastReg(`user_${participant.uid}`, registrationDoc({
    firstName: participant.firstName, lastName: participant.lastName, genderRoleCategory: "giovane_donna",
    birthDate: "2011-03-14", unit: aurora, status: "confirmed", mode: "authenticated", userId: participant.uid,
    answers: { transportMode: "Pullman organizzato", photoInternalConsent: true },
    parentAuthorization: authorizedState({ ...genitoreSintetico, now: at(-20), ...consentMix(0) }),
    createdAt: at(-30),
  }));
  pastReg(`child_${parent.uid}_${chiara.id}`, registrationDoc({
    firstName: chiara.firstName, lastName: chiara.lastName, genderRoleCategory: chiara.gender,
    birthDate: chiara.birthDate, unit: aurora, status: "confirmed", mode: "parent",
    parentUid: parent.uid, childId: chiara.id,
    answers: { ...request({ submittedAt: at(-28) }), transportMode: "Vengo con la mia famiglia", photoInternalConsent: true },
    parentAuthorization: authorizedState({
      parentName: `${parent.firstName} ${parent.lastName}`, parentEmail: realParentEmail.toLowerCase(), now: at(-27),
      photoConsent: "accepted", socialPublicationConsent: "refused",
    }),
    createdAt: at(-28),
  }));
  pastReg(`user_${leader.uid}`, registrationDoc({
    firstName: leader.firstName, lastName: leader.lastName, genderRoleCategory: "dirigente",
    birthDate: "1985-09-03", unit: aurora, status: "confirmed", mode: "authenticated", userId: leader.uid,
    answers: { transportMode: "Posso dare un passaggio ad altri" },
    createdAt: at(-33),
  }));
  youth.slice(0, 12).forEach((person, index) => {
    pastReg(`user_${person.uid}`, registrationDoc({
      firstName: person.firstName, lastName: person.lastName, genderRoleCategory: person.gender,
      birthDate: person.birthDate, unit: person.unit, status: "confirmed", mode: "authenticated", userId: person.uid,
      answers: { transportMode: TRANSPORT_CHOICES[index % TRANSPORT_CHOICES.length], photoInternalConsent: index % 3 !== 0 },
      parentAuthorization: authorizedState({ ...genitoreSintetico, now: at(-25 + (index % 5)), ...consentMix(index + 1) }),
      createdAt: at(-32 + (index % 6)),
    }));
  });

  const patchRegistration = (activityId, registrationId, fields) => {
    const entry = docs.find((item) => item.path === `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`);
    if (!entry) throw new Error(`Iscrizione demo assente: ${activityId}/${registrationId}`);
    Object.assign(entry.data, fields);
  };
  const regById = new Map(pastCampRegs.map((item) => [item.id, item]));
  const youthReg = (index) => `user_${youth[index].uid}`;
  const sofiaReg = `user_${participant.uid}`;
  const chiaraReg = `child_${parent.uid}_${chiara.id}`;
  const leaderReg = `user_${leader.uid}`;
  const campUpdatedAt = at(-12);

  // Pattuglie e comitati (management/camp, forma di functions/lib/campManagement.js)
  const publicMember = (registrationId, role) => {
    const item = regById.get(registrationId);
    return { registrationId, fullName: item.fullName, genderRoleCategory: item.genderRoleCategory, unitName: item.unitName, role };
  };
  const patrolPlan = [
    { id: "patrol-aquile", name: "Aquile", leader: youthReg(8), supervisors: [leaderReg], members: [sofiaReg, youthReg(0), youthReg(3), youthReg(5)] },
    { id: "patrol-volpi", name: "Volpi", leader: youthReg(9), supervisors: [], members: [chiaraReg, youthReg(1), youthReg(4)] },
    { id: "patrol-cervi", name: "Cervi", leader: youthReg(10), supervisors: [], members: [youthReg(2), youthReg(6), youthReg(7), youthReg(11)] },
  ];
  const committeePlan = [
    { id: "logistics", leaders: [youthReg(10)], members: [youthReg(1), youthReg(6)], responsibilities: "Tende, materiale comune e smontaggio dell'ultimo giorno." },
    { id: "wellbeing", leaders: [], members: [youthReg(3)], responsibilities: "Primo soccorso leggero e attenzione a chi resta indietro." },
    { id: "kitchen", leaders: [youthReg(9)], members: [chiaraReg, youthReg(4), youthReg(7)], responsibilities: "Turni di cucina e lista della spesa." },
    { id: "games", leaders: [youthReg(8)], members: [sofiaReg, youthReg(0), youthReg(2)], responsibilities: "Giochi a pattuglie e grande gioco del sabato." },
    { id: "spiritual", leaders: [leaderReg], members: [youthReg(5), youthReg(11)], responsibilities: "Pensiero del mattino e serata attorno al fuoco." },
  ];
  const patrols = patrolPlan.map((patrol) => ({
    id: patrol.id,
    name: patrol.name,
    leaderRegistrationId: patrol.leader,
    supervisorRegistrationIds: patrol.supervisors,
    manualSupervisorIds: [],
    memberRegistrationIds: patrol.members,
    publicMembers: [
      publicMember(patrol.leader, "leader"),
      ...patrol.supervisors.map((id) => publicMember(id, "supervisor")),
      ...patrol.members.map((id) => publicMember(id, "member")),
    ],
    updatedAt: campUpdatedAt,
  }));
  const committees = committeePlan.map((committee) => {
    const definition = CAMP_COMMITTEES[committee.id];
    return {
      id: committee.id,
      title: definition.title,
      emoji: definition.emoji,
      responsibilities: committee.responsibilities,
      leaderRegistrationIds: committee.leaders,
      manualLeaderIds: [],
      memberRegistrationIds: committee.members,
      publicMembers: [
        ...committee.leaders.map((id) => publicMember(id, "leader")),
        ...committee.members.map((id) => publicMember(id, "member")),
      ],
      updatedAt: campUpdatedAt,
    };
  });
  add(`stakes/${stakeId}/activities/${PAST_CAMP_ID}/management/camp`, {
    groupLabel: "pattuglia",
    committees,
    patrols,
    manualLeaders: [],
    updatedAt: campUpdatedAt,
    savedAt: { [TIMESTAMP]: campUpdatedAt },
  });
  add(`stakes/${stakeId}/activities/${PAST_CAMP_ID}/management/campStaff`, {
    staffUids: [leader.uid],
    updatedAt: campUpdatedAt,
    updatedBy: admin.uid,
  });
  for (const patrol of patrolPlan) {
    const roleOf = (id) => (id === patrol.leader ? "leader" : patrol.supervisors.includes(id) ? "supervisor" : "member");
    for (const id of [patrol.leader, ...patrol.supervisors, ...patrol.members]) {
      patchRegistration(PAST_CAMP_ID, id, { assignedPatrolId: patrol.id, assignedPatrolName: patrol.name, assignedPatrolRole: roleOf(id) });
    }
  }
  for (const committee of committeePlan) {
    const title = CAMP_COMMITTEES[committee.id].title;
    for (const id of committee.leaders) patchRegistration(PAST_CAMP_ID, id, { assignedCommittees: [{ id: committee.id, title, role: "leader" }] });
    for (const id of committee.members) patchRegistration(PAST_CAMP_ID, id, { assignedCommittees: [{ id: committee.id, title, role: "member" }] });
  }

  // Piano stanze pubblicato sul viaggio (management/rooms, functions/lib/roomManagement.js):
  // i ragazzi vedono "La tua stanza" e i compagni dalla callable roomMates.
  const tripRooms = [
    { id: "stanza-ulivo", name: "Stanza Ulivo", category: "boys", floor: "Primo piano" },
    { id: "stanza-pino", name: "Stanza Pino", category: "boys", floor: "Primo piano" },
    { id: "stanza-glicine", name: "Stanza Glicine", category: "girls", floor: "Secondo piano" },
    { id: "stanza-lavanda", name: "Stanza Lavanda", category: "girls", floor: "Secondo piano" },
  ].map((room) => ({ ...room, capacity: 4, accessible: false, notes: "", minAge: null, maxAge: null }));
  const tripPrefix = `stakes/${stakeId}/activities/viaggio-tempio/registrations/`;
  const tripEligible = docs
    .filter((entry) => entry.path.startsWith(tripPrefix))
    .filter((entry) => ["confirmed", "pending_parent_authorization"].includes(entry.data.registrationStatus))
    .map((entry) => ({ id: entry.path.slice(tripPrefix.length), gender: entry.data.genderRoleCategory }));
  const roomAssignments = {};
  for (const [gender, roomIds] of [["giovane_uomo", ["stanza-ulivo", "stanza-pino"]], ["giovane_donna", ["stanza-glicine", "stanza-lavanda"]]]) {
    tripEligible.filter((item) => item.gender === gender).forEach((item, index) => {
      roomAssignments[item.id] = roomIds[Math.floor(index / 4)];
    });
  }
  const roomsUpdatedAt = at(-1);
  add(`stakes/${stakeId}/activities/viaggio-tempio/management/rooms`, {
    rooms: tripRooms,
    assignments: roomAssignments,
    lockedIds: [],
    adultGenders: {},
    couples: [],
    published: true,
    staffElsewhere: true,
    revision: 1,
    updatedAt: roomsUpdatedAt,
    savedAt: { [TIMESTAMP]: roomsUpdatedAt },
  });
  for (const [registrationId, roomId] of Object.entries(roomAssignments)) {
    const room = tripRooms.find((item) => item.id === roomId);
    patchRegistration("viaggio-tempio", registrationId, { assignedRoomId: room.id, assignedRoomName: room.name });
  }

  // Piano tende pubblicato sul campeggio concluso: stessa forma del piano
  // stanze (l'admin vede «Tende» perché activityType è "camp"). Tende da 4,
  // quante ne servono per genere; lo staff dorme altrove.
  const campPrefix = `stakes/${stakeId}/activities/${PAST_CAMP_ID}/registrations/`;
  const campEligible = docs
    .filter((entry) => entry.path.startsWith(campPrefix))
    .filter((entry) => entry.data.registrationStatus === "confirmed")
    .map((entry) => ({ id: entry.path.slice(campPrefix.length), gender: entry.data.genderRoleCategory }));
  const tentNames = {
    giovane_uomo: { category: "boys", floor: "Prato nord", names: ["Tenda Quercia", "Tenda Faggio", "Tenda Castagno"] },
    giovane_donna: { category: "girls", floor: "Prato sud", names: ["Tenda Betulla", "Tenda Ginestra", "Tenda Mimosa"] },
  };
  const campTents = [];
  const tentAssignments = {};
  for (const [gender, spec] of Object.entries(tentNames)) {
    const members = campEligible.filter((item) => item.gender === gender);
    const needed = Math.ceil(members.length / 4);
    if (needed > spec.names.length) throw new Error(`Tende demo insufficienti per ${gender}: ${members.length} iscritti.`);
    const tents = spec.names.slice(0, needed).map((name) => ({
      id: `tenda-${name.split(" ")[1].toLowerCase()}`, name, category: spec.category, floor: spec.floor,
      capacity: 4, accessible: false, notes: "", minAge: null, maxAge: null,
    }));
    campTents.push(...tents);
    members.forEach((item, index) => {
      tentAssignments[item.id] = tents[Math.floor(index / 4)].id;
    });
  }
  const tentsUpdatedAt = at(-14);
  add(`stakes/${stakeId}/activities/${PAST_CAMP_ID}/management/rooms`, {
    rooms: campTents,
    assignments: tentAssignments,
    lockedIds: [],
    adultGenders: {},
    couples: [],
    published: true,
    staffElsewhere: true,
    revision: 1,
    updatedAt: tentsUpdatedAt,
    savedAt: { [TIMESTAMP]: tentsUpdatedAt },
  });
  for (const [registrationId, tentId] of Object.entries(tentAssignments)) {
    const tent = campTents.find((item) => item.id === tentId);
    patchRegistration(PAST_CAMP_ID, registrationId, { assignedRoomId: tent.id, assignedRoomName: tent.name });
  }

  // Sondaggio del campeggio concluso, con risposte anonime (niente userId).
  const surveyPath = `stakes/${stakeId}/activities/${PAST_CAMP_ID}`;
  const questions = [
    { id: "q-giudizio", text: "Quanto ti è piaciuto il campeggio?", type: "rating", fieldCount: 0 },
    { id: "q-programma", text: "Come giudichi giochi e attività del programma?", type: "rating", fieldCount: 0 },
    { id: "q-ricordo", text: "Qual è il momento che ti porti a casa?", type: "open", fieldCount: 0 },
    { id: "q-parole", text: "Descrivi il campeggio in tre parole.", type: "fields", fieldCount: 3 },
  ];
  questions.forEach((question, order) => {
    add(`${surveyPath}/surveyQuestions/${question.id}`, {
      eventId: PAST_CAMP_ID, stakeId, text: question.text, type: question.type, fieldCount: question.fieldCount,
      order, status: "active", createdAt: at(-6), updatedAt: at(-6),
    });
  });
  SURVEY_ANSWERS.forEach((answer, index) => {
    const submittedAt = at(-4 + Math.floor(index / 4), 9 + (index % 10));
    add(`${surveyPath}/surveyResponses/r-${String(index + 1).padStart(2, "0")}`, {
      eventId: PAST_CAMP_ID,
      stakeId,
      isDraft: false,
      category: answer.category,
      answers: {
        "q-giudizio": { type: "rating", value: answer.giudizio },
        "q-programma": { type: "rating", value: answer.programma },
        "q-ricordo": { type: "open", value: answer.ricordo },
        "q-parole": { type: "fields", value: answer.parole },
      },
      submittedAt,
      createdAt: submittedAt,
      updatedAt: submittedAt,
    });
  });

  // Galleria del campeggio concluso: illustrazioni senza persone (tools/demo-media).
  // Solo con `media` (bucket noto): senza, niente file e niente documenti media.
  const galleryId = `act_${PAST_CAMP_ID}`;
  const galleryPath = `stakes/${stakeId}/galleries/${galleryId}`;
  const uploads = [];
  const mediaDocs = [];
  if (media) {
    const runId = media.runId || today.replaceAll("-", "");
    DEMO_MEDIA.forEach((item, index) => {
      const mediaId = `m${runId}${String(index + 1).padStart(2, "0")}`;
      const uploader = [participant, ...youth][item.uploader];
      const createdAt = at(-8 + Math.floor(index / 3), 10 + (index % 3) * 3);
      const stamp = Date.parse(createdAt);
      const folder = `protected/stakes/${stakeId}/galleries/${galleryId}/media/${mediaId}/`;
      const files = {};
      for (const [kind, suffix] of [["optimized", ""], ["thumb", "-thumb"]]) {
        const path = `${folder}${kind}-${stamp}-${item.file}.jpg`;
        const token = tokenFor(`${runId}/${path}`);
        const url = `${media.baseUrl.replace(/\/$/, "")}/v0/b/${media.bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
        files[kind] = { path, url };
        uploads.push({
          localFile: `${item.file}${suffix}.jpg`,
          path,
          token,
          customMetadata: { uploadedBy: uploader.uid, stakeId, galleryId, mediaId, kind },
        });
      }
      mediaDocs.push({ id: mediaId, url: files.optimized.url });
      add(`${galleryPath}/media/${mediaId}`, {
        activityId: PAST_CAMP_ID,
        type: "image",
        storagePath: files.optimized.path,
        storageUrl: files.optimized.url,
        originalPath: null,
        originalUrl: null,
        optimizedPath: files.optimized.path,
        optimizedUrl: files.optimized.url,
        thumbnailPath: files.thumb.path,
        thumbnailUrl: files.thumb.url,
        posterPath: null,
        posterUrl: null,
        width: 1600,
        height: 1066,
        duration: null,
        order: index,
        caption: item.caption,
        filename: `${item.file}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: item.sizeBytes ?? 70000,
        uploadedBy: uploader.uid,
        status: "uploaded",
        likeCount: 0,
        createdAt,
        updatedAt: createdAt,
      });
    });
  }
  const window = { from: at(-9, 13), until: at(2, 11) };
  add(galleryPath, {
    title: pastCamp.title,
    description: "",
    activityId: PAST_CAMP_ID,
    createdBy: admin.uid,
    createdAt: at(-9, 13),
    updatedAt: at(-4),
    published: false,
    publishedAt: null,
    coverMediaId: mediaDocs[0]?.id ?? null,
    coverImageUrl: mediaDocs[0]?.url ?? null,
    mediaCount: mediaDocs.length,
    batchSize: 30,
    accessMode: "open",
    likeCount: 0,
    commentsEnabled: false,
    postsCreated: false,
    uploadsClosed: false,
    uploadsWindowSource: "activity",
    uploadsOpenFrom: { [TIMESTAMP]: window.from },
    uploadsOpenUntil: { [TIMESTAMP]: window.until },
  });

  // Post nella home del palo (stakes/{s}/feedPosts, src/services/firestore/feedService.ts)
  const post = (id, data) => add(`stakes/${stakeId}/feedPosts/${id}`, {
    type: "announcement", activityId: null, galleryId: null, galleryBatchIndex: null, mediaIds: [], likeCount: 0,
    ctaLabel: null, ctaUrl: null, createdBy: admin.uid, published: true, pinned: false, visibility: "all_authenticated",
    ...data,
    updatedAt: data.createdAt,
    publishedAt: data.createdAt,
  });
  post("post-viaggio-aperto", {
    title: "Iscrizioni aperte: Viaggio al Tempio",
    body: "Due giorni al Tempio con pernottamento in foresteria. Iscriviti entro tre settimane: per chi è minorenne serve l'autorizzazione del genitore.",
    activityId: "viaggio-tempio",
    ctaLabel: "Vai all'attività",
    ctaUrl: "/activities/viaggio-tempio",
    pinned: true,
    createdAt: at(-9, 18),
  });
  post("post-sondaggio-campeggio", {
    title: "Com'è andato il campeggio?",
    body: `Grazie a tutti per il ${pastCamp.title}. Il sondaggio è anonimo e richiede due minuti: ci aiuta a preparare il prossimo.`,
    activityId: PAST_CAMP_ID,
    createdAt: at(-4, 19),
  });
  if (mediaDocs.length) {
    post("post-galleria-campeggio", {
      type: "gallery",
      title: `Le foto del ${pastCamp.title}`,
      body: "Alba, tende e serata al fuoco: la galleria resta aperta ancora qualche giorno per chi vuole aggiungere le sue.",
      activityId: PAST_CAMP_ID,
      galleryId,
      galleryBatchIndex: 0,
      mediaIds: mediaDocs.slice(0, 6).map((item) => item.id),
      visibility: "gallery_members",
      createdAt: at(-4, 12),
    });
  }
  post("post-campeggio-estivo", {
    type: "activity_reminder",
    title: `${camp.title}: si aprono le iscrizioni`,
    body: "Le date e il programma sono nella scheda dell'attività. Le pattuglie si formano a iscrizioni chiuse.",
    activityId: "campeggio-estivo",
    ctaLabel: "Vai all'attività",
    ctaUrl: "/activities/campeggio-estivo",
    createdAt: at(-5, 17),
  });

  const registrations = docs.filter((entry) => entry.path.includes("/registrations/")).length;
  return {
    docs,
    uploads,
    registrations,
    magicToken,
    magicLink: `${appUrl.replace(/\/$/, "")}/parent-confirm/${magicToken}`,
    summary: {
      stake: stakeId,
      today,
      documents: docs.length,
      registrations,
      media: mediaDocs.length,
      logins: Object.values(accounts).map((account) => account.email),
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Scrive il dataset (upsert con ids fissi) e crea/aggiorna i 4 account di login. */
// Moduli firmati con il PDF vero (stesso generatore e stesso percorso della
// firma in functions/lib/parentAuthorization.js, con la firma digitata come
// nella conversione legacy): l'admin vede «N moduli firmati disponibili per il
// download» e lo zip funziona. Dati solo sintetici. Modifica `docs` sul posto.
const SEED_SIGNATURE_ID = "demo-seed";
export async function attachSignedConsentPdfs(docs, { bucket, stakeId }) {
  const { generateOfficialConsentPdf, generateChurchActivityConductPdf } = require("./lib/officialConsentPdf.js");
  const { LEGAL_DOC_VERSIONS } = require("./lib/legalDocs.js");
  const stake = docs.find((entry) => entry.path === `stakes/${stakeId}`)?.data ?? {};
  const conductPdf = await generateChurchActivityConductPdf();
  const pattern = new RegExp(`^stakes/${stakeId}/activities/([^/]+)/registrations/([^/]+)$`, "u");
  let count = 0;
  for (const entry of docs) {
    const match = entry.path.match(pattern);
    const registration = entry.data;
    const original = registration.parentAuthorization;
    if (!match || original?.status !== "authorized" || original.pdfPath) continue;
    // Il dataset riusa lo stesso oggetto su più iscrizioni (stesso ragazzo in
    // due attività): copia, così ogni iscrizione ha il suo PDF.
    const state = { ...original };
    registration.parentAuthorization = state;
    const [, activityId, registrationId] = match;
    const activity = docs.find((item) => item.path === `stakes/${stakeId}/activities/${activityId}`)?.data ?? {};
    const confirmedAt = state.authorizedAt;
    const officialPdf = await generateOfficialConsentPdf({
      activity: {
        title: activity.title || "",
        description: activity.description || activity.program || "",
        publicNotes: activity.publicNotes || "",
        startDate: activity.startDate || "",
        endDate: activity.endDate || "",
        location: activity.location || "",
        activityType: activity.activityType || (activity.overnight ? "overnight" : "standard"),
        overnight: Boolean(activity.overnight),
        stakeName: stake.name || "",
      },
      organization: {
        stakeName: stake.name || "",
        unitName: registration.unitNameSnapshot || "",
        leaderName: activity.eventLeaderName || "",
        leaderPhone: activity.eventLeaderPhone || "",
        leaderEmail: activity.eventLeaderEmail || "",
      },
      participant: {
        fullName: registration.fullName || "",
        birthDate: registration.birthDate || "",
        email: registration.email || "",
        phone: registration.phone || "",
        unitName: registration.unitNameSnapshot || "",
        address: "",
        city: "",
        stateOrProvince: "",
      },
      parent: { firstName: state.parentFirstName, lastName: state.parentLastName, email: state.parentEmail, phone: "" },
      emergency: { name: "", phone: "", relation: "", secondaryPhone: "" },
      medical: { allergies: "", medications: "", medicalNotes: "", dietaryNotes: "" },
      confirmedAt,
      signatureText: state.parentName,
    });
    // = STORAGE_PATH_PARENT_AUTH_PDF in functions/lib/config.js (non caricato
    // qui: fuori da produzione pretende il file .env del progetto).
    const folder = `protected/stakes/${stakeId}/activities/${activityId}/parent-authorization-pdfs/${registrationId}`;
    const pdfPath = `${folder}/${SEED_SIGNATURE_ID}-official.pdf`;
    const conductPdfPath = `${folder}/${SEED_SIGNATURE_ID}-conduct.pdf`;
    const metadata = { tokenHash: SEED_SIGNATURE_ID, confirmedAt, signatureSource: "legacy_typed" };
    await bucket.file(pdfPath).save(Buffer.from(officialPdf), {
      resumable: false, contentType: "application/pdf", metadata: { metadata: { ...metadata, documentKind: "official_consent" } },
    });
    await bucket.file(conductPdfPath).save(Buffer.from(conductPdf), {
      resumable: false, contentType: "application/pdf", metadata: { metadata: { ...metadata, documentKind: "church_activity_conduct" } },
    });
    Object.assign(state, { legalVersions: LEGAL_DOC_VERSIONS, signatureSource: "legacy_typed", pdfPath, conductPdfPath });
    Object.assign(registration, {
      parentConsentDocumentName: `modulo-consenso-${registrationId}.pdf`,
      parentConsentDocumentPath: pdfPath,
      parentConsentDocumentUrl: null,
      parentConsentUploadedAt: confirmedAt,
      consentSignatureSetAt: confirmedAt,
    });
    count += 1;
  }
  return count;
}

export async function seedDemo(
  { db, auth },
  { today, parentEmail, appUrl, password, apply, settleAlertsMs = 6000, keepAlerts = false, stakeId = DEMO_STAKE_ID, prefix = "demo", media = null },
) {
  const accounts = demoAccounts(prefix);
  // `media` = { bucket, baseUrl, runId? }: con il bucket la galleria ha i file.
  // runId nuovo a ogni giro: un mediaId cancellato lascia una tombstone
  // (mediaLifecycle) che cancellerebbe anche i file ricaricati con lo stesso id.
  const mediaInput = media?.bucket
    ? { bucketName: media.bucket.name, baseUrl: media.baseUrl, runId: media.runId || (apply ? Date.now().toString(36) : null) }
    : null;
  const dataset = buildDemoDataset({ today, parentEmail, appUrl, stakeId, prefix, media: mediaInput });
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

  let signedPdfs = 0;
  if (mediaInput) {
    // Prima i file, poi i documenti che li citano. I media di un giro precedente
    // (id diversi) si cancellano dal documento: il trigger toglie i loro file.
    const mediaDir = new URL("../demo-media/", import.meta.url);
    for (const upload of dataset.uploads) {
      await media.bucket.file(upload.path).save(fs.readFileSync(new URL(upload.localFile, mediaDir)), {
        resumable: false,
        contentType: "image/jpeg",
        metadata: { cacheControl: "private, max-age=86400", metadata: { ...upload.customMetadata, firebaseStorageDownloadTokens: upload.token } },
      });
    }
    const galleryMedia = dataset.docs.filter((entry) => /^stakes\/[^/]+\/galleries\/[^/]+\/media\/[^/]+$/u.test(entry.path));
    const keep = new Set(galleryMedia.map((entry) => entry.path));
    const galleries = new Set(galleryMedia.map((entry) => entry.path.replace(/\/media\/[^/]+$/u, "")));
    for (const gallery of galleries) {
      const existing = await db.collection(`${gallery}/media`).get();
      for (const snapshot of existing.docs) if (!keep.has(snapshot.ref.path)) await snapshot.ref.delete();
    }
    signedPdfs = await attachSignedConsentPdfs(dataset.docs, { bucket: media.bucket, stakeId });
  }

  const { Timestamp } = require("firebase-admin/firestore");
  const toFirestore = (value) => {
    if (Array.isArray(value)) return value.map(toFirestore);
    if (value && typeof value === "object") {
      if (Object.keys(value).length === 1 && typeof value[TIMESTAMP] === "string") return Timestamp.fromDate(new Date(value[TIMESTAMP]));
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, toFirestore(inner)]));
    }
    return value;
  };
  for (let index = 0; index < dataset.docs.length; index += 400) {
    const batch = db.batch();
    for (const { path, data } of dataset.docs.slice(index, index + 400)) batch.set(db.doc(path), toFirestore(data));
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

  return { applied: true, ...dataset, clearedAlerts, signedPdfs };
}

// Con `force` l'SDK rifiuta con un array di errori, uno per file. Un 404 vuol
// dire "già cancellato": dopo la cancellazione dei documenti i trigger della
// galleria (onGalleryMediaDeleted) svuotano le stesse cartelle in parallelo.
export async function deletePrefix(bucket, prefix) {
  try {
    await bucket.deleteFiles({ prefix, force: true });
  } catch (caught) {
    const errors = (Array.isArray(caught) ? caught : [caught]).filter((error) => Number(error?.code) !== 404);
    if (errors.length) {
      throw new Error(`Storage ${prefix}: ${errors.map((error) => error?.message || String(error)).join("; ")}`);
    }
  }
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
    for (const prefix of prefixes) await deletePrefix(bucket, prefix);
  }
  return { applied: true, plan };
}
