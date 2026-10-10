// Notte dei Record (docs/NOTTE_DEI_RECORD.md).
//
// Record e tentativi li scrive solo questo modulo (Admin SDK): le rules
// Firestore negano ogni scrittura client. Ogni azione legge e scrive in UNA
// transazione (letture prima delle scritture): attività (flag e scadenza),
// iscrizione (stato), tentativi della persona (limite e unicità), record
// (contatore). Le date sono stringhe ISO come nel resto del progetto.
//
// La logica pura (limite, unicità, transizioni, delta del contatore, finestra
// di iscrizione) sta in funzioni esportate e provate senza emulatore in
// functions/tests/recordNightLogic.test.mjs.

const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted, onDocumentWritten } = require("firebase-functions/v2/firestore");

const { REGION } = require("./config");

// Se cambi questi elenchi aggiorna anche src/utils/recordNight.ts e
// src/types/models.ts: il test di logica controlla che combacino.
const RECORD_CATEGORIES = ["resistenza", "velocita", "precisione", "equilibrio", "mente", "fantasia"];
const RECORD_MEASURES = [
  "count_in_time",
  "count_streak",
  "longest_time",
  "fastest_time",
  "distance",
  "other",
];
const RECORD_STATUSES = ["open", "hidden"];
const ENTRY_STATUSES = ["pending", "approved", "rejected", "withdrawn"];

const MAX_ACTIVE_ENTRIES = 2;
const DURATION_MIN_SECONDS = 10;
const DURATION_MAX_SECONDS = 60;
const LIMITS = Object.freeze({
  title: 80,
  notes: 200,
  text: 120,
  needs: 120,
  reason: 200,
  participantName: 120,
});

// Documento con l'elenco di chi gestisce i record oltre agli admin e ai dirigenti
// di unità: `stakes/{s}/activities/{a}/management/recordNight`, campo `staffUids`.
// Lo scrive solo il server, su richiesta di un admin del palo.
const STAFF_DOC_ID = "recordNight";
const MAX_STAFF = 100;
const INACTIVE_REGISTRATION_STATUSES = new Set(["cancelled", "rejected_by_parent"]);
// Categorie degli adulti: servono SOLO a ordinare l'elenco di chi può essere
// messo in staff. `genderRoleCategory` è autodichiarato: non dà alcun permesso.
const ADULT_ROLE_CATEGORIES = new Set(["dirigente", "accompagnatore"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const RESERVED_MAP_IDS = new Set(["__proto__", "prototype", "constructor"]);
// Caratteri di controllo (tab e a capo esclusi): non servono a nessun campo.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

// `context` è di sola lettura. `propose` e `challenge` accettano
// `registrationId` (un figlio iscritto): `edit`, `withdraw` e `restore`
// restano su `entryId` e verificano `entry.ownerUid == uid`.
const PARTICIPANT_ACTION_KEYS = Object.freeze({
  context: [],
  propose: ["text", "measure", "durationSeconds", "needs", "registrationId"],
  challenge: ["recordId", "registrationId"],
  edit: ["entryId", "text", "measure", "durationSeconds", "needs"],
  withdraw: ["entryId"],
  restore: ["entryId"],
});

const ADMIN_ACTION_KEYS = Object.freeze({
  approve: ["entryId", "title", "category", "measure", "durationSeconds", "notes"],
  merge: ["entryId", "recordId"],
  reject: ["entryId", "reason"],
  reopen: ["entryId"],
  createRecord: ["title", "category", "measure", "durationSeconds", "notes"],
  updateRecord: ["recordId", "title", "category", "measure", "durationSeconds", "notes", "status"],
  addParticipant: ["recordId", "registrationId"],
  withdrawEntry: ["entryId"],
  listParticipants: [],
  // Solo admin e super_admin del palo.
  listStaff: [],
  setStaff: ["uid", "enabled"],
});

// Azioni riservate agli admin del palo: non ai dirigenti di unità né a chi è in elenco.
const ADMIN_ONLY_ACTIONS = new Set(["listStaff", "setStaff"]);

// ---------------------------------------------------------------------------
// Validazione input
// ---------------------------------------------------------------------------

function ownObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, allowed, context) {
  if (!ownObject(value)) throw new HttpsError("invalid-argument", `${context} non valido.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new HttpsError("invalid-argument", `${context}: campi non ammessi (${unexpected.join(", ")}).`);
  }
}

function pathId(value, label) {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", `${label} non valido.`);
  const id = value.trim();
  if (!ID_PATTERN.test(id) || RESERVED_MAP_IDS.has(id)) {
    throw new HttpsError("invalid-argument", `${label} non valido.`);
  }
  return id;
}

// Testo su una riga: spazi e a capo collassati. `required` = non vuoto.
function cleanLine(value, label, maxLength, required) {
  if (value === undefined || value === null) {
    if (required) throw new HttpsError("invalid-argument", `Campo «${label}» obbligatorio.`);
    return "";
  }
  if (typeof value !== "string" || CONTROL_CHARS.test(value)) {
    throw new HttpsError("invalid-argument", `Campo «${label}» non valido.`);
  }
  const text = value.replace(/\s+/gu, " ").trim();
  if (required && !text) throw new HttpsError("invalid-argument", `Campo «${label}» obbligatorio.`);
  if (text.length > maxLength) {
    throw new HttpsError("invalid-argument", `Campo «${label}» troppo lungo (massimo ${maxLength} caratteri).`);
  }
  return text;
}

// Note scritte dall'admin: possono andare a capo, ma niente righe infinite.
function cleanNotes(value, label, maxLength) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || CONTROL_CHARS.test(value)) {
    throw new HttpsError("invalid-argument", `Campo «${label}» non valido.`);
  }
  const text = value.replace(/\r\n?/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
  if (text.length > maxLength) {
    throw new HttpsError("invalid-argument", `Campo «${label}» troppo lungo (massimo ${maxLength} caratteri).`);
  }
  return text;
}

function parseMeasure(value) {
  if (typeof value !== "string" || !RECORD_MEASURES.includes(value)) {
    throw new HttpsError("invalid-argument", "Campo «Come si misura» non valido.");
  }
  return value;
}

function parseCategory(value) {
  if (typeof value !== "string" || !RECORD_CATEGORIES.includes(value)) {
    throw new HttpsError("invalid-argument", "Campo «Categoria» non valido.");
  }
  return value;
}

// La durata esiste solo per "Quante volte in un tempo dato" (10-60 secondi).
function parseDuration(measure, value) {
  if (measure !== "count_in_time") {
    if (value === undefined || value === null) return null;
    throw new HttpsError("invalid-argument", "La durata si indica solo per le prove a tempo.");
  }
  if (!Number.isInteger(value) || value < DURATION_MIN_SECONDS || value > DURATION_MAX_SECONDS) {
    throw new HttpsError(
      "invalid-argument",
      `La durata deve essere un numero intero di secondi, da ${DURATION_MIN_SECONDS} a ${DURATION_MAX_SECONDS}.`,
    );
  }
  return value;
}

function parseProposalFields(data) {
  const text = cleanLine(data.text, "Cosa fai", LIMITS.text, true);
  const measure = parseMeasure(data.measure);
  return {
    text,
    measure,
    durationSeconds: parseDuration(measure, data.durationSeconds),
    needs: cleanLine(data.needs, "Serve qualcosa", LIMITS.needs, false),
  };
}

// `notes` assente: nuovo record = vuoto, modifica = invariato (`undefined`).
function parseRecordFields(data, { keepNotesWhenMissing }) {
  const measure = parseMeasure(data.measure);
  const fields = {
    title: cleanLine(data.title, "Titolo", LIMITS.title, true),
    category: parseCategory(data.category),
    measure,
    durationSeconds: parseDuration(measure, data.durationSeconds),
  };
  if (data.notes === undefined && keepNotesWhenMissing) fields.notes = undefined;
  else fields.notes = cleanNotes(data.notes, "Regole e materiale", LIMITS.notes);
  return fields;
}

function parseRequestEnvelope(data, actionKeys) {
  if (!ownObject(data)) throw new HttpsError("invalid-argument", "Richiesta non valida.");
  const { action } = data;
  if (typeof action !== "string" || !Object.hasOwn(actionKeys, action)) {
    throw new HttpsError("invalid-argument", "Azione non valida.");
  }
  assertExactKeys(data, ["stakeId", "activityId", "action", ...actionKeys[action]], "Richiesta");
  return {
    stakeId: pathId(data.stakeId, "stakeId"),
    activityId: pathId(data.activityId, "activityId"),
    action,
  };
}

function parseParticipantRequest(data) {
  const base = parseRequestEnvelope(data, PARTICIPANT_ACTION_KEYS);
  switch (base.action) {
    case "context":
      return { ...base, fields: {} };
    case "propose":
      return { ...base, fields: { ...parseProposalFields(data), registrationId: parseActingRegistrationId(data.registrationId) } };
    case "challenge":
      return {
        ...base,
        fields: { recordId: pathId(data.recordId, "recordId"), registrationId: parseActingRegistrationId(data.registrationId) },
      };
    case "edit":
      return { ...base, fields: { entryId: pathId(data.entryId, "entryId"), ...parseProposalFields(data) } };
    default:
      return { ...base, fields: { entryId: pathId(data.entryId, "entryId") } };
  }
}

function parseKnownRegistrationId(value) {
  const id = pathId(value, "registrationId");
  if (id.startsWith("guest_")) {
    throw new HttpsError("invalid-argument", "Le iscrizioni senza account non partecipano ai record.");
  }
  if (!/^(user_.+|child_.+)$/u.test(id)) {
    throw new HttpsError("invalid-argument", "registrationId non valido.");
  }
  return id;
}

// Iscrizione per cui agisce il partecipante: assente = la propria (`user_<uid>`).
function parseActingRegistrationId(value) {
  return value === undefined || value === null ? null : parseKnownRegistrationId(value);
}

function parseAdminRequest(data) {
  const base = parseRequestEnvelope(data, ADMIN_ACTION_KEYS);
  switch (base.action) {
    case "approve":
      return {
        ...base,
        fields: { entryId: pathId(data.entryId, "entryId"), ...parseRecordFields(data, { keepNotesWhenMissing: false }) },
      };
    case "merge":
      return {
        ...base,
        fields: { entryId: pathId(data.entryId, "entryId"), recordId: pathId(data.recordId, "recordId") },
      };
    case "reject":
      return {
        ...base,
        fields: { entryId: pathId(data.entryId, "entryId"), reason: cleanLine(data.reason, "Motivo", LIMITS.reason, true) },
      };
    case "listParticipants":
    case "listStaff":
      return { ...base, fields: {} };
    case "setStaff":
      if (typeof data.enabled !== "boolean") {
        throw new HttpsError("invalid-argument", "Campo «enabled» non valido.");
      }
      return { ...base, fields: { uid: pathId(data.uid, "uid"), enabled: data.enabled } };
    case "createRecord":
      return { ...base, fields: parseRecordFields(data, { keepNotesWhenMissing: false }) };
    case "updateRecord": {
      if (typeof data.status !== "string" || !RECORD_STATUSES.includes(data.status)) {
        throw new HttpsError("invalid-argument", "Campo «Stato» non valido.");
      }
      return {
        ...base,
        fields: {
          recordId: pathId(data.recordId, "recordId"),
          status: data.status,
          ...parseRecordFields(data, { keepNotesWhenMissing: true }),
        },
      };
    }
    case "addParticipant":
      return {
        ...base,
        fields: {
          recordId: pathId(data.recordId, "recordId"),
          registrationId: parseKnownRegistrationId(data.registrationId),
        },
      };
    default:
      return { ...base, fields: { entryId: pathId(data.entryId, "entryId") } };
  }
}

// ---------------------------------------------------------------------------
// Logica pura
// ---------------------------------------------------------------------------

// pending -> approved/rejected/withdrawn (approva, rifiuta, ritira)
// approved -> pending/withdrawn (riporta in attesa, ritira)
// rejected -> pending (riporta in attesa)
// withdrawn -> pending/approved (annulla il ritiro: torna a statusBeforeWithdraw)
const ENTRY_TRANSITIONS = Object.freeze({
  pending: ["approved", "rejected", "withdrawn"],
  approved: ["pending", "withdrawn"],
  rejected: ["pending"],
  withdrawn: ["pending", "approved"],
});

const STATUS_LABELS = Object.freeze({
  pending: "in attesa",
  approved: "approvata",
  rejected: "rifiutata",
  withdrawn: "ritirata",
});

function canTransition(from, to) {
  return Object.hasOwn(ENTRY_TRANSITIONS, from) && ENTRY_TRANSITIONS[from].includes(to);
}

function assertTransition(from, to) {
  if (canTransition(from, to)) return;
  throw new HttpsError(
    "failed-precondition",
    `Operazione non consentita: l'iscrizione è ${STATUS_LABELS[from] || "in uno stato non valido"}.`,
  );
}

// Il contatore `challengerCount` conta i tentativi `approved` del record.
// `from` è null per un tentativo che nasce già approvato (sfida, iscrizione
// fatta da un admin); `to` è null non serve: un tentativo non si cancella.
function counterDelta(from, to) {
  return (to === "approved" ? 1 : 0) - (from === "approved" ? 1 : 0);
}

function nextChallengerCount(current, delta) {
  const base = Number.isInteger(current) && current > 0 ? current : 0;
  return Math.max(0, base + delta);
}

function isActiveEntry(entry) {
  return entry.status === "pending" || entry.status === "approved";
}

function activeEntries(entries, excludeId) {
  return entries.filter((entry) => isActiveEntry(entry) && entry.id !== excludeId);
}

// Al massimo 2 tentativi pending/approved per iscrizione.
function assertEntryLimit(entries, audience, excludeId) {
  if (activeEntries(entries, excludeId).length < MAX_ACTIVE_ENTRIES) return;
  throw new HttpsError(
    "failed-precondition",
    audience === "admin"
      ? "Limite di 2 record raggiunto per questa persona: ne va ritirato uno prima."
      : "Limite di 2 record raggiunto: ritirane uno per sceglierne un altro.",
  );
}

// Una persona non ha due tentativi attivi sullo stesso record. Le proposte in
// attesa hanno `recordId` null, quindi non contano qui.
function assertNotAlreadyInRecord(entries, recordId, audience, excludeId) {
  const present = activeEntries(entries, excludeId).some((entry) => entry.recordId === recordId);
  if (!present) return;
  throw new HttpsError(
    "failed-precondition",
    audience === "admin"
      ? "Questa persona è già iscritta a questo record."
      : "Già in gara per questo record.",
  );
}

function normalizeForCompare(value) {
  return String(value || "")
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

// Doppio tocco o rinvio: la stessa proposta identica non si apre due volte.
function assertNoDuplicateProposal(entries, fields, excludeId) {
  const wanted = normalizeForCompare(fields.text);
  const duplicate = activeEntries(entries, excludeId).some(
    (entry) =>
      entry.kind === "proposal" &&
      normalizeForCompare(entry.proposedText) === wanted &&
      entry.proposedMeasure === fields.measure &&
      (entry.proposedDurationSeconds ?? null) === fields.durationSeconds,
  );
  if (duplicate) throw new HttpsError("failed-precondition", "Questa proposta è già presente.");
}

function isRegistrationActive(registration) {
  if (!ownObject(registration)) return false;
  if (INACTIVE_REGISTRATION_STATUSES.has(registration.registrationStatus)) return false;
  // Campo legacy: alcune iscrizioni vecchie portano solo `status: "cancelled"`.
  return registration.status !== "cancelled";
}

function participantNameFromRegistration(registration) {
  const first = typeof registration.firstName === "string" ? registration.firstName.trim() : "";
  const last = typeof registration.lastName === "string" ? registration.lastName.trim() : "";
  const joined = `${first} ${last}`.trim();
  const full = typeof registration.fullName === "string" ? registration.fullName.trim() : "";
  return (joined || full || "Partecipante").slice(0, LIMITS.participantName);
}

// Account che gestisce l'iscrizione: `user_<uid>` -> quell'uid; `child_<parentUid>_<childId>`
// -> l'uid del genitore (dal campo `parentUid` dell'iscrizione, altrimenti
// dall'id). Qualunque altro prefisso non partecipa.
function ownerUidFromRegistrationId(registrationId, registration) {
  if (/^user_.+$/u.test(registrationId)) return registrationId.slice("user_".length);
  if (/^child_.+$/u.test(registrationId)) {
    if (ownObject(registration) && typeof registration.parentUid === "string" && registration.parentUid) {
      return registration.parentUid;
    }
    const match = /^child_([^_]+)_.+$/u.exec(registrationId);
    return match ? match[1] : null;
  }
  throw new HttpsError("invalid-argument", "registrationId non valido.");
}

// Un utente agisce per la propria `user_<uid>` e per le `child_<uid>_*`.
function canActForRegistration(uid, registrationId) {
  if (typeof uid !== "string" || !uid || typeof registrationId !== "string") return false;
  if (registrationId === `user_${uid}`) return true;
  const childPrefix = `child_${uid}_`;
  return registrationId.startsWith(childPrefix) && registrationId.length > childPrefix.length;
}

function firstNameOf(registration) {
  const first = typeof registration.firstName === "string" ? registration.firstName.trim() : "";
  if (first) return first;
  const full = typeof registration.fullName === "string" ? registration.fullName.trim() : "";
  return full.split(/\s+/u)[0] || "";
}

// Persone per cui l'utente può agire: prima la propria iscrizione, poi i
// figli. Nome di battesimo; nome e cognome se due persone hanno lo stesso.
function buildPeople(ownRegistration, childRegistrations) {
  const items = [];
  if (ownRegistration) items.push({ id: ownRegistration.id, data: ownRegistration.data, isSelf: true });
  const children = [...childRegistrations].sort(
    (left, right) => firstNameOf(left.data).localeCompare(firstNameOf(right.data), "it-IT") || left.id.localeCompare(right.id),
  );
  for (const child of children) items.push({ id: child.id, data: child.data, isSelf: false });
  const counts = new Map();
  for (const item of items) {
    const key = firstNameOf(item.data).toLocaleLowerCase("it-IT");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return items.map((item) => {
    const first = firstNameOf(item.data);
    const homonyms = (counts.get(first.toLocaleLowerCase("it-IT")) || 0) > 1;
    return {
      registrationId: item.id,
      displayName: first && !homonyms ? first : participantNameFromRegistration(item.data),
      isSelf: item.isSelf,
    };
  });
}

// Chi gestisce i record (uguale alle rules): admin del palo o super_admin,
// dirigente di unità del palo (ruolo assegnato da un admin), oppure un uid
// messo in `staffUids` da un admin che ha ancora una propria iscrizione
// `user_<uid>` attiva (se il trigger che lo toglie fallisse, un ex iscritto non
// resterebbe gestore). La categoria dichiarata nell'iscrizione (`dirigente`,
// `accompagnatore`) non conta: la scrive chiunque nel proprio profilo.
// Restituisce 'admin' | 'unit_leader' | 'listed' | null.
function resolveStaffAccess(profile, stakeId, uid, staffUids, ownRegistration) {
  if (ownObject(profile)) {
    if (profile.role === "super_admin") return "admin";
    if (profile.stakeId === stakeId) {
      if (profile.role === "admin") return "admin";
      if (profile.role === "unit_leader") return "unit_leader";
    }
  }
  return typeof uid === "string" && uid && Array.isArray(staffUids) && staffUids.includes(uid) && isRegistrationActive(ownRegistration)
    ? "listed"
    : null;
}

// Accesso dello staff dentro una transazione (solo letture): profilo, poi
// l'elenco, e l'iscrizione `user_<uid>` solo per chi è in elenco.
async function resolveStaffAccessInTx(tx, firestore, refs, uid, stakeId) {
  const profileSnap = await tx.get(firestore.doc(`users/${uid}`));
  const profile = profileSnap.exists ? profileSnap.data() : null;
  const direct = resolveStaffAccess(profile, stakeId, uid, null, null);
  if (direct) return direct;
  const staffSnap = await tx.get(refs.staff);
  const staffUids = staffUidsOf(staffSnap.exists ? staffSnap.data() : null);
  if (!staffUids.includes(uid)) return null;
  const registrationSnap = await tx.get(refs.registrations.doc(`user_${uid}`));
  return resolveStaffAccess(profile, stakeId, uid, staffUids, registrationSnap.exists ? registrationSnap.data() : null);
}

// Solo admin e super_admin del palo scelgono chi è in elenco.
function canManageStaff(access) {
  return access === "admin";
}

function staffUidsOf(staffDoc) {
  return ownObject(staffDoc) && Array.isArray(staffDoc.staffUids)
    ? staffDoc.staffUids.filter((item) => typeof item === "string" && item)
    : [];
}

// Elenco aggiornato (senza doppioni, ordinato). Togliere chi non c'è è un no-op.
function nextStaffUids(current, uid, enabled) {
  const set = new Set(current);
  if (enabled) set.add(uid);
  else set.delete(uid);
  if (set.size > MAX_STAFF) {
    throw new HttpsError("failed-precondition", `Troppe persone in elenco (massimo ${MAX_STAFF}).`);
  }
  return [...set].sort();
}

function toDate(value) {
  let candidate = value;
  if (candidate && typeof candidate.toDate === "function") candidate = candidate.toDate();
  if (candidate instanceof Date) return Number.isNaN(candidate.getTime()) ? null : candidate;
  if (typeof candidate === "string" && candidate.trim()) {
    const parsed = new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

// Chiusura delle iscrizioni: `recordsCloseAt` se valorizzato, altrimenti
// `startDate`. Un valore scritto ma illeggibile NON ricade su `startDate`:
// restituisce null e chi chiama tratta l'iscrizione come chiusa.
function resolveCloseAt(activity) {
  const explicit = activity.recordsCloseAt;
  if (explicit !== undefined && explicit !== null && explicit !== "") return toDate(explicit);
  return toDate(activity.startDate);
}

// "disabled" | "closed" | "open" per i partecipanti (l'admin guarda solo il flag).
function getParticipantWindow(activity, now) {
  if (activity.recordsEnabled !== true) return "disabled";
  const closeAt = resolveCloseAt(activity);
  if (!closeAt || now.getTime() >= closeAt.getTime()) return "closed";
  return "open";
}

// Ritiro d'ufficio dei tentativi di un'iscrizione annullata o cancellata:
// niente "Annulla" da qui (statusBeforeWithdraw null). Idempotente: dopo il
// primo passaggio i tentativi sono `withdrawn` e il piano torna vuoto.
function planRetireEntries(entries, nowIso) {
  const patches = [];
  const recordDeltas = new Map();
  for (const entry of entries) {
    if (!isActiveEntry(entry)) continue;
    patches.push({
      id: entry.id,
      patch: {
        status: "withdrawn",
        statusBeforeWithdraw: null,
        withdrawnBy: "system",
        withdrawnWithRecordHide: false,
        updatedAt: nowIso,
      },
    });
    const delta = counterDelta(entry.status, "withdrawn");
    if (delta !== 0 && typeof entry.recordId === "string" && entry.recordId) {
      recordDeltas.set(entry.recordId, (recordDeltas.get(entry.recordId) || 0) + delta);
    }
  }
  return { patches, recordDeltas };
}

// Nascondere un record ritira i tentativi approvati: niente "Annulla" per il
// ragazzo, ma il flag permette di rimetterli quando il record torna visibile.
function planHideRecord(recordEntries, nowIso) {
  const patches = recordEntries
    .filter((entry) => entry.status === "approved")
    .map((entry) => ({
      id: entry.id,
      patch: {
        status: "withdrawn",
        statusBeforeWithdraw: null,
        withdrawnBy: "staff",
        withdrawnWithRecordHide: true,
        updatedAt: nowIso,
      },
    }));
  return { patches, withdrawnCount: patches.length };
}

// Record di nuovo visibile: i tentativi ritirati con il record tornano
// `approved` se l'iscrizione è attiva, la persona ha meno di 2 tentativi
// attivi e non è già su quel record. Gli altri restano ritirati (il flag si
// spegne: la decisione è presa). `siblingsByRegistration` = tutti i tentativi
// di ciascuna persona; `activeRegistrations` = id con iscrizione attiva.
function planShowRecord(recordId, recordEntries, activeRegistrations, siblingsByRegistration, nowIso) {
  const flagged = recordEntries
    .filter((entry) => entry.status === "withdrawn" && entry.withdrawnWithRecordHide === true)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.id.localeCompare(right.id));
  const working = new Map();
  for (const [registrationId, list] of siblingsByRegistration) working.set(registrationId, list.map((item) => ({ ...item })));
  const restores = [];
  const skipped = [];
  for (const entry of flagged) {
    const list = working.get(entry.registrationId) || [];
    const others = activeEntries(list, entry.id);
    const canRestore =
      activeRegistrations.has(entry.registrationId) &&
      others.length < MAX_ACTIVE_ENTRIES &&
      !others.some((other) => other.recordId === recordId);
    if (canRestore) {
      restores.push({
        id: entry.id,
        patch: {
          status: "approved",
          statusBeforeWithdraw: null,
          withdrawnBy: null,
          withdrawnWithRecordHide: false,
          updatedAt: nowIso,
        },
      });
      const mine = list.find((item) => item.id === entry.id);
      if (mine) Object.assign(mine, { status: "approved", recordId });
    } else {
      skipped.push({ id: entry.id, patch: { withdrawnWithRecordHide: false, updatedAt: nowIso } });
    }
  }
  const alreadyApproved = recordEntries.filter((entry) => entry.status === "approved").length;
  return { restores, skipped, approvedCount: alreadyApproved + restores.length };
}

function buildEntryBase({ registrationId, ownerUid, participantName, kind, createdByAdmin, nowIso }) {
  return {
    registrationId,
    ownerUid,
    participantName,
    kind,
    proposedText: null,
    proposedMeasure: null,
    proposedDurationSeconds: null,
    proposedNeeds: "",
    recordId: null,
    status: "pending",
    statusBeforeWithdraw: null,
    // Chi ha ritirato: "self" (titolare), "staff", "system" (iscrizione annullata).
    withdrawnBy: null,
    // Ritirato perché lo staff ha nascosto il record: si rimette con "mostra".
    withdrawnWithRecordHide: false,
    rejectionReason: "",
    createdByAdmin,
    createdAt: nowIso,
    updatedAt: nowIso,
    decidedAt: null,
    decidedBy: null,
  };
}

function buildProposalEntry({ registrationId, ownerUid, participantName, fields, nowIso }) {
  return {
    ...buildEntryBase({ registrationId, ownerUid, participantName, kind: "proposal", createdByAdmin: false, nowIso }),
    proposedText: fields.text,
    proposedMeasure: fields.measure,
    proposedDurationSeconds: fields.durationSeconds,
    proposedNeeds: fields.needs,
  };
}

// Sfida a un record esistente o iscrizione fatta da un admin: nasce `approved`.
// `decidedBy` è l'admin che iscrive, null per la sfida del ragazzo.
function buildChallengeEntry({ registrationId, ownerUid, participantName, recordId, createdByAdmin, decidedBy, nowIso }) {
  return {
    ...buildEntryBase({ registrationId, ownerUid, participantName, kind: "challenge", createdByAdmin, nowIso }),
    recordId,
    status: "approved",
    decidedAt: nowIso,
    decidedBy: decidedBy ?? null,
  };
}

// ---------------------------------------------------------------------------
// Accesso ai dati
// ---------------------------------------------------------------------------

function refsFor(db, stakeId, activityId) {
  const activityRef = db.doc(`stakes/${stakeId}/activities/${activityId}`);
  return {
    activityRef,
    registrations: activityRef.collection("registrations"),
    records: activityRef.collection("records"),
    entries: activityRef.collection("recordEntries"),
    staff: activityRef.collection("management").doc(STAFF_DOC_ID),
  };
}

function view(snapshot) {
  return { id: snapshot.id, ref: snapshot.ref, data: snapshot.data() || {} };
}

function plain(entryView) {
  return { ...entryView.data, id: entryView.id };
}

function plainList(views) {
  return views.map(plain);
}

function shape(id, data) {
  return { id, ...data };
}

async function readEntriesOfRegistration(tx, refs, registrationId) {
  const snapshot = await tx.get(refs.entries.where("registrationId", "==", registrationId));
  return snapshot.docs.map(view);
}

async function readEntriesOfRecord(tx, refs, recordId) {
  const snapshot = await tx.get(refs.entries.where("recordId", "==", recordId));
  return snapshot.docs.map(view);
}

async function readEntry(tx, refs, entryId) {
  const snapshot = await tx.get(refs.entries.doc(entryId));
  if (!snapshot.exists) throw new HttpsError("not-found", "Iscrizione al record non trovata.");
  return view(snapshot);
}

async function readRecord(tx, refs, recordId) {
  const snapshot = await tx.get(refs.records.doc(recordId));
  return snapshot.exists ? view(snapshot) : null;
}

function requireRecord(record) {
  if (!record) throw new HttpsError("not-found", "Record non trovato.");
  return record;
}

function assertRecordOpen(record, message) {
  if (record.data.status !== "open") {
    throw new HttpsError("failed-precondition", message || "Questo record non è più disponibile.");
  }
}

// Applica il delta del contatore e restituisce il record aggiornato.
function writeCounter(tx, recordView, delta, nowIso, extraPatch = {}) {
  const patch = {
    challengerCount: nextChallengerCount(recordView.data.challengerCount, delta),
    updatedAt: nowIso,
    ...extraPatch,
  };
  tx.update(recordView.ref, patch);
  return shape(recordView.id, { ...recordView.data, ...patch });
}

function writeEntryPatch(tx, entryView, patch) {
  tx.update(entryView.ref, patch);
  return shape(entryView.id, { ...entryView.data, ...patch });
}

function findOwnEntry(entries, entryId) {
  const found = entries.find((entry) => entry.id === entryId);
  if (!found) throw new HttpsError("not-found", "Iscrizione al record non trovata.");
  return found;
}

function assertProposalPending(entryView) {
  if (entryView.data.kind !== "proposal" || entryView.data.status !== "pending") {
    throw new HttpsError("failed-precondition", "La proposta non è in attesa di approvazione.");
  }
}

// ---------------------------------------------------------------------------
// Azioni del partecipante
// ---------------------------------------------------------------------------

async function participantPropose(ctx) {
  const { tx, refs, fields, registration, registrationId, uid, nowIso } = ctx;
  const entries = plainList(ctx.entries);
  assertEntryLimit(entries, "self");
  assertNoDuplicateProposal(entries, fields);
  const entryRef = refs.entries.doc();
  const data = buildProposalEntry({
    registrationId,
    ownerUid: uid,
    participantName: participantNameFromRegistration(registration),
    fields,
    nowIso,
  });
  tx.create(entryRef, data);
  return { entry: shape(entryRef.id, data), record: null };
}

async function participantChallenge(ctx) {
  const { tx, refs, fields, registration, registrationId, uid, nowIso } = ctx;
  const record = await readRecord(tx, refs, fields.recordId);
  // Un record a zero iscritti non è visibile agli altri: non si sfida a mano.
  if (!record || record.data.status !== "open" || !(record.data.challengerCount > 0)) {
    throw new HttpsError("failed-precondition", "Questo record non è più disponibile.");
  }
  const entries = plainList(ctx.entries);
  assertNotAlreadyInRecord(entries, record.id, "self");
  assertEntryLimit(entries, "self");
  const entryRef = refs.entries.doc();
  const data = buildChallengeEntry({
    registrationId,
    ownerUid: uid,
    participantName: participantNameFromRegistration(registration),
    recordId: record.id,
    createdByAdmin: false,
    decidedBy: null,
    nowIso,
  });
  tx.create(entryRef, data);
  const updated = writeCounter(tx, record, counterDelta(null, "approved"), nowIso);
  return { entry: shape(entryRef.id, data), record: updated };
}

async function participantEdit(ctx) {
  const { tx, fields, nowIso } = ctx;
  const entry = findOwnEntry(ctx.entries, fields.entryId);
  if (entry.data.kind !== "proposal" || entry.data.status !== "pending") {
    throw new HttpsError("failed-precondition", "Si può modificare solo una proposta in attesa di approvazione.");
  }
  // Come in propose, ma senza contare la proposta che si sta modificando.
  assertNoDuplicateProposal(plainList(ctx.entries), fields, entry.id);
  const updated = writeEntryPatch(tx, entry, {
    proposedText: fields.text,
    proposedMeasure: fields.measure,
    proposedDurationSeconds: fields.durationSeconds,
    proposedNeeds: fields.needs,
    updatedAt: nowIso,
  });
  return { entry: updated, record: null };
}

// Ritiro: salva lo stato di prima per "Annulla". Se era approvato scende il
// contatore del record. Ripetuto su un tentativo già ritirato non cambia nulla.
async function applyWithdraw(ctx, entry, { keepUndo, by }) {
  const { tx, refs, nowIso } = ctx;
  const from = entry.data.status;
  if (from === "withdrawn") return { entry: shape(entry.id, entry.data), record: null };
  assertTransition(from, "withdrawn");
  const delta = counterDelta(from, "withdrawn");
  const record = delta !== 0 && entry.data.recordId ? await readRecord(tx, refs, entry.data.recordId) : null;
  const updatedEntry = writeEntryPatch(tx, entry, {
    status: "withdrawn",
    statusBeforeWithdraw: keepUndo ? from : null,
    withdrawnBy: by,
    withdrawnWithRecordHide: false,
    updatedAt: nowIso,
  });
  return { entry: updatedEntry, record: record ? writeCounter(tx, record, delta, nowIso) : null };
}

async function participantWithdraw(ctx) {
  return applyWithdraw(ctx, findOwnEntry(ctx.entries, ctx.fields.entryId), { keepUndo: true, by: "self" });
}

async function participantRestore(ctx) {
  const { tx, refs, nowIso } = ctx;
  const entry = findOwnEntry(ctx.entries, ctx.fields.entryId);
  const current = entry.data.status;
  // Doppio tocco su "Annulla": è già tornato com'era.
  if (current === "pending" || current === "approved") return { entry: shape(entry.id, entry.data), record: null };
  const target = entry.data.statusBeforeWithdraw;
  if (current !== "withdrawn" || (target !== "pending" && target !== "approved")) {
    throw new HttpsError("failed-precondition", "Non c'è niente da ripristinare.");
  }
  assertTransition("withdrawn", target);
  const entries = plainList(ctx.entries);
  assertEntryLimit(entries, "self", entry.id);
  // Tornare in attesa non deve riaprire una proposta identica a una già attiva.
  if (target === "pending" && entry.data.kind === "proposal") {
    assertNoDuplicateProposal(
      entries,
      {
        text: entry.data.proposedText,
        measure: entry.data.proposedMeasure,
        durationSeconds: entry.data.proposedDurationSeconds ?? null,
      },
      entry.id,
    );
  }

  let record = null;
  if (target === "approved") {
    record = await readRecord(tx, refs, entry.data.recordId);
    if (!record || record.data.status !== "open") {
      throw new HttpsError("failed-precondition", "Il record non è più disponibile: non si può annullare il ritiro.");
    }
    assertNotAlreadyInRecord(entries, record.id, "self", entry.id);
  }
  const updatedEntry = writeEntryPatch(tx, entry, {
    status: target,
    statusBeforeWithdraw: null,
    withdrawnBy: null,
    withdrawnWithRecordHide: false,
    updatedAt: nowIso,
  });
  return {
    entry: updatedEntry,
    record: record ? writeCounter(tx, record, counterDelta("withdrawn", target), nowIso) : null,
  };
}

const PARTICIPANT_ACTIONS = Object.freeze({
  propose: participantPropose,
  challenge: participantChallenge,
  edit: participantEdit,
  withdraw: participantWithdraw,
  restore: participantRestore,
});

// ---------------------------------------------------------------------------
// Azioni dell'admin
// ---------------------------------------------------------------------------

async function adminApprove(ctx) {
  const { tx, refs, fields, uid, nowIso } = ctx;
  const entry = await readEntry(tx, refs, fields.entryId);
  assertProposalPending(entry);
  assertTransition("pending", "approved");
  const recordRef = refs.records.doc();
  const recordData = {
    title: fields.title,
    category: fields.category,
    measure: fields.measure,
    durationSeconds: fields.durationSeconds,
    notes: fields.notes,
    challengerCount: nextChallengerCount(0, counterDelta("pending", "approved")),
    status: "open",
    // Serve a "Riporta in attesa": se il record nasce da questa approvazione e
    // resta a zero, torna nascosto invece di restare leggibile al palo.
    createdFromEntryId: entry.id,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: uid,
  };
  tx.create(recordRef, recordData);
  const updatedEntry = writeEntryPatch(tx, entry, {
    status: "approved",
    recordId: recordRef.id,
    statusBeforeWithdraw: null,
    rejectionReason: "",
    decidedAt: nowIso,
    decidedBy: uid,
    updatedAt: nowIso,
  });
  return { entry: updatedEntry, record: shape(recordRef.id, recordData) };
}

async function adminMerge(ctx) {
  const { tx, refs, fields, uid, nowIso } = ctx;
  const entry = await readEntry(tx, refs, fields.entryId);
  const record = requireRecord(await readRecord(tx, refs, fields.recordId));
  const siblings = plainList(await readEntriesOfRegistration(tx, refs, entry.data.registrationId));
  assertProposalPending(entry);
  assertTransition("pending", "approved");
  assertRecordOpen(record, "Il record è nascosto: rendilo di nuovo visibile prima di unire.");
  assertNotAlreadyInRecord(siblings, record.id, "admin", entry.id);
  const updatedEntry = writeEntryPatch(tx, entry, {
    status: "approved",
    recordId: record.id,
    statusBeforeWithdraw: null,
    rejectionReason: "",
    decidedAt: nowIso,
    decidedBy: uid,
    updatedAt: nowIso,
  });
  return { entry: updatedEntry, record: writeCounter(tx, record, counterDelta("pending", "approved"), nowIso) };
}

async function adminReject(ctx) {
  const { tx, refs, fields, uid, nowIso } = ctx;
  const entry = await readEntry(tx, refs, fields.entryId);
  assertProposalPending(entry);
  assertTransition("pending", "rejected");
  const updatedEntry = writeEntryPatch(tx, entry, {
    status: "rejected",
    rejectionReason: fields.reason,
    decidedAt: nowIso,
    decidedBy: uid,
    updatedAt: nowIso,
  });
  return { entry: updatedEntry, record: null };
}

// "Riporta in attesa": annulla approva/unisci/rifiuta. Il testo originale non
// è mai stato toccato (il titolo ufficiale sta sul record).
async function adminReopen(ctx) {
  const { tx, refs, nowIso } = ctx;
  const entry = await readEntry(tx, refs, ctx.fields.entryId);
  const from = entry.data.status;
  if (entry.data.kind !== "proposal") {
    throw new HttpsError("failed-precondition", "Una sfida non si riporta in attesa: si può solo ritirare.");
  }
  if (from === "pending") return { entry: shape(entry.id, entry.data), record: null };
  // La tabella delle transizioni ammette anche withdrawn -> pending (Annulla
  // del ragazzo): da qui si riapre solo ciò che l'admin ha approvato o rifiutato.
  if (from !== "approved" && from !== "rejected") {
    throw new HttpsError("failed-precondition", "Operazione non consentita: la proposta è stata ritirata.");
  }
  assertTransition(from, "pending");

  let record = null;
  if (from === "approved" && entry.data.recordId) record = await readRecord(tx, refs, entry.data.recordId);
  if (from === "rejected") {
    // Da rifiutata a in attesa il tentativo torna a contare nel limite.
    const registrationSnap = await tx.get(refs.registrations.doc(entry.data.registrationId));
    if (!registrationSnap.exists || !isRegistrationActive(registrationSnap.data())) {
      throw new HttpsError("failed-precondition", "L'iscrizione all'attività è annullata.");
    }
    const siblings = plainList(await readEntriesOfRegistration(tx, refs, entry.data.registrationId));
    assertEntryLimit(siblings, "admin", entry.id);
  }
  const updatedEntry = writeEntryPatch(tx, entry, {
    status: "pending",
    recordId: null,
    statusBeforeWithdraw: null,
    rejectionReason: "",
    decidedAt: null,
    decidedBy: null,
    updatedAt: nowIso,
  });
  let updatedRecord = null;
  if (record) {
    const delta = counterDelta(from, "pending");
    // Annullare l'approvazione che ha creato il record, se non resta nessuno,
    // lo nasconde: il titolo non deve restare leggibile al palo.
    const hide =
      record.data.createdFromEntryId === entry.id &&
      record.data.status === "open" &&
      nextChallengerCount(record.data.challengerCount, delta) === 0;
    updatedRecord = writeCounter(tx, record, delta, nowIso, hide ? { status: "hidden" } : {});
  }
  return { entry: updatedEntry, record: updatedRecord };
}

// Record nuovo creato dall'admin (per chi non ha un account): nasce aperto ma
// a zero iscritti, quindi invisibile agli altri finché qualcuno non ci entra
// (addParticipant). Nessun tentativo coinvolto.
async function adminCreateRecord(ctx) {
  const { tx, refs, fields, uid, nowIso } = ctx;
  const recordRef = refs.records.doc();
  const recordData = {
    title: fields.title,
    category: fields.category,
    measure: fields.measure,
    durationSeconds: fields.durationSeconds,
    notes: fields.notes,
    challengerCount: 0,
    status: "open",
    createdFromEntryId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: uid,
  };
  tx.create(recordRef, recordData);
  return { entry: null, record: shape(recordRef.id, recordData) };
}

// Modifica del record. Nascondere ritira i tentativi approvati (contatore a 0);
// rimostrare rimette quelli ritirati con il record, dove limite e unicità lo
// consentono, e ricalcola il contatore. Tutto nella stessa transazione.
async function adminUpdateRecord(ctx) {
  const { tx, refs, fields, nowIso } = ctx;
  const record = requireRecord(await readRecord(tx, refs, fields.recordId));
  const becomesHidden = fields.status === "hidden";
  const becomesOpen = fields.status === "open" && record.data.status === "hidden";

  // Letture: tentativi del record e, per rimostrare, iscrizioni e tentativi di ogni persona.
  const recordEntries =
    becomesHidden || becomesOpen ? plainList(await readEntriesOfRecord(tx, refs, record.id)) : [];
  let hidePlan = { patches: [], withdrawnCount: 0 };
  let showPlan = { restores: [], skipped: [], approvedCount: 0 };
  if (becomesHidden) hidePlan = planHideRecord(recordEntries, nowIso);
  if (becomesOpen) {
    const registrationIds = [
      ...new Set(
        recordEntries
          .filter((entry) => entry.status === "withdrawn" && entry.withdrawnWithRecordHide === true)
          .map((entry) => entry.registrationId),
      ),
    ];
    const activeRegistrations = new Set();
    const siblings = new Map();
    for (const registrationId of registrationIds) {
      const registrationSnap = await tx.get(refs.registrations.doc(registrationId));
      if (registrationSnap.exists && isRegistrationActive(registrationSnap.data())) activeRegistrations.add(registrationId);
      siblings.set(registrationId, plainList(await readEntriesOfRegistration(tx, refs, registrationId)));
    }
    showPlan = planShowRecord(record.id, recordEntries, activeRegistrations, siblings, nowIso);
  }

  // Scritture.
  for (const { id, patch } of [...hidePlan.patches, ...showPlan.restores, ...showPlan.skipped]) {
    tx.update(refs.entries.doc(id), patch);
  }
  const patch = {
    title: fields.title,
    category: fields.category,
    measure: fields.measure,
    durationSeconds: fields.durationSeconds,
    notes: fields.notes === undefined ? record.data.notes ?? "" : fields.notes,
    status: fields.status,
    updatedAt: nowIso,
  };
  if (becomesHidden) patch.challengerCount = 0;
  if (becomesOpen) patch.challengerCount = showPlan.approvedCount;
  tx.update(record.ref, patch);
  return {
    entry: null,
    record: shape(record.id, { ...record.data, ...patch }),
    withdrawnCount: hidePlan.withdrawnCount,
    restoredCount: showPlan.restores.length,
    notRestoredCount: showPlan.skipped.length,
  };
}

async function adminAddParticipant(ctx) {
  const { tx, refs, fields, uid, nowIso } = ctx;
  const record = requireRecord(await readRecord(tx, refs, fields.recordId));
  const registrationSnap = await tx.get(refs.registrations.doc(fields.registrationId));
  if (!registrationSnap.exists) throw new HttpsError("not-found", "Iscrizione all'attività non trovata.");
  const registration = registrationSnap.data() || {};
  const siblings = plainList(await readEntriesOfRegistration(tx, refs, fields.registrationId));
  if (!isRegistrationActive(registration)) {
    throw new HttpsError("failed-precondition", "L'iscrizione all'attività è annullata.");
  }
  assertRecordOpen(record, "Il record è nascosto: rendilo di nuovo visibile prima di iscrivere qualcuno.");
  assertNotAlreadyInRecord(siblings, record.id, "admin");
  assertEntryLimit(siblings, "admin");
  const entryRef = refs.entries.doc();
  const data = buildChallengeEntry({
    registrationId: fields.registrationId,
    ownerUid: ownerUidFromRegistrationId(fields.registrationId, registration),
    participantName: participantNameFromRegistration(registration),
    recordId: record.id,
    createdByAdmin: true,
    decidedBy: uid,
    nowIso,
  });
  tx.create(entryRef, data);
  const updated = writeCounter(tx, record, counterDelta(null, "approved"), nowIso);
  return { entry: shape(entryRef.id, data), record: updated };
}

// L'admin ritira senza "Annulla": il ragazzo non deve poter disfare da solo
// una decisione dell'organizzazione. Per rimettere qualcuno: "Iscrivi qualcuno".
async function adminWithdrawEntry(ctx) {
  const entry = await readEntry(ctx.tx, ctx.refs, ctx.fields.entryId);
  return applyWithdraw(ctx, entry, { keepUndo: false, by: "staff" });
}

// Letture dell'elenco iscrizioni: sono solo lettura e girano FUORI dalla
// transazione di autorizzazione, che altrimenti terrebbe bloccata la collezione
// per tutta la chiamata.
async function readActiveRegistrations(refs, idPattern) {
  const snapshot = await refs.registrations.get();
  return snapshot.docs.map(view).filter((item) => idPattern.test(item.id) && isRegistrationActive(item.data));
}

function byName(left, right) {
  return left.name.localeCompare(right.name, "it-IT") || left.registrationId.localeCompare(right.registrationId);
}

// Elenco per "Iscrivi qualcuno": dirigenti di unità e chi è in staff non possono
// leggere tutte le iscrizioni dalle rules, quindi le passa il server, con i soli
// campi che servono.
async function adminListParticipants(ctx) {
  const registrations = await readActiveRegistrations(ctx.refs, /^(user_|child_).+/u);
  const participants = registrations
    .map((item) => ({
      registrationId: item.id,
      name: participantNameFromRegistration(item.data),
      unitName: String(item.data.unitName || item.data.unitNameSnapshot || ""),
      isAdult: ADULT_ROLE_CATEGORIES.has(item.data.genderRoleCategory),
    }))
    .sort(byName);
  return { participants };
}

// Chi si può mettere in staff: le iscrizioni `user_` attive. Gli adulti vengono
// prima solo per comodità di lettura (la categoria è autodichiarata e non dà
// alcun permesso).
async function adminListStaff(ctx) {
  const registrations = await readActiveRegistrations(ctx.refs, /^user_.+/u);
  const staffSnap = await ctx.refs.staff.get();
  const staffUids = new Set(staffUidsOf(staffSnap.exists ? staffSnap.data() : null));
  const candidates = registrations
    .map((item) => ({
      uid: ownerUidFromRegistrationId(item.id, item.data),
      registrationId: item.id,
      name: participantNameFromRegistration(item.data),
      unitName: String(item.data.unitName || item.data.unitNameSnapshot || ""),
      isAdult: ADULT_ROLE_CATEGORIES.has(item.data.genderRoleCategory),
    }))
    .map((item) => ({ ...item, isStaff: staffUids.has(item.uid) }))
    .sort((left, right) => Number(right.isAdult) - Number(left.isAdult) || byName(left, right));
  return { candidates };
}

// Aggiunge o toglie un uid da `staffUids`. Aggiungere richiede una iscrizione
// `user_<uid>` attiva a questa attività.
async function adminSetStaff(ctx) {
  const { tx, refs, fields, uid, nowIso } = ctx;
  const staffSnap = await tx.get(refs.staff);
  const registrationSnap = fields.enabled ? await tx.get(refs.registrations.doc(`user_${fields.uid}`)) : null;
  if (fields.enabled && !(registrationSnap.exists && isRegistrationActive(registrationSnap.data()))) {
    throw new HttpsError("failed-precondition", "Può gestire i record solo chi ha un'iscrizione attiva all'attività.");
  }
  const current = staffUidsOf(staffSnap.exists ? staffSnap.data() : null);
  const staffUids = nextStaffUids(current, fields.uid, fields.enabled);
  const changed = staffUids.length !== current.length || staffUids.some((item, index) => item !== current[index]);
  if (changed || !staffSnap.exists) {
    const data = { staffUids, updatedAt: nowIso, updatedBy: uid };
    if (staffSnap.exists) tx.update(refs.staff, data);
    else tx.create(refs.staff, data);
  }
  return { staffUids };
}

const ADMIN_ACTIONS = Object.freeze({
  approve: adminApprove,
  merge: adminMerge,
  reject: adminReject,
  reopen: adminReopen,
  createRecord: adminCreateRecord,
  updateRecord: adminUpdateRecord,
  addParticipant: adminAddParticipant,
  withdrawEntry: adminWithdrawEntry,
  setStaff: adminSetStaff,
});

// Solo lettura: dopo l'autorizzazione girano fuori dalla transazione.
const READ_ONLY_ADMIN_ACTIONS = Object.freeze({
  listParticipants: adminListParticipants,
  listStaff: adminListStaff,
});

// ---------------------------------------------------------------------------
// Handler delle callable
// ---------------------------------------------------------------------------

function assertParticipantAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login richiesto.");
  if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("permission-denied", "Per partecipare ai record serve un account personale.");
  }
  return request.auth.uid;
}

function assertAdminAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login richiesto.");
  if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("permission-denied", "Serve un account amministratore.");
  }
  return request.auth.uid;
}

function assertParticipantWindowOpen(activity, now) {
  const state = getParticipantWindow(activity, now);
  if (state === "disabled") {
    throw new HttpsError("failed-precondition", "La Notte dei Record non è attiva per questa attività.");
  }
  if (state === "closed") {
    throw new HttpsError("failed-precondition", "Le iscrizioni ai record sono chiuse.");
  }
}

function assertRecordsEnabled(activity) {
  if (activity.recordsEnabled !== true) {
    throw new HttpsError("failed-precondition", "La Notte dei Record non è attiva per questa attività.");
  }
}

// Sola lettura: le iscrizioni per cui l'utente può agire (la propria, poi i
// figli), se gestisce i record e se può scegliere chi li gestisce. Funziona
// anche dopo la chiusura.
async function participantContext({ tx, refs, firestore, uid, stakeId }) {
  const access = await resolveStaffAccessInTx(tx, firestore, refs, uid, stakeId);
  const ownSnap = await tx.get(refs.registrations.doc(`user_${uid}`));
  const childrenSnap = await tx.get(refs.registrations.where("parentUid", "==", uid));
  const own = ownSnap.exists && isRegistrationActive(ownSnap.data()) ? view(ownSnap) : null;
  const children = childrenSnap.docs
    .map(view)
    .filter((child) => canActForRegistration(uid, child.id) && child.id !== `user_${uid}` && isRegistrationActive(child.data));
  return {
    people: buildPeople(own, children),
    isStaff: access !== null,
    canManageStaff: canManageStaff(access),
  };
}

const ENTRY_ACTIONS = new Set(["edit", "withdraw", "restore"]);

function createRecordNightParticipantHandler({ db, clock = () => new Date() } = {}) {
  return async (request) => {
    const firestore = db || getFirestore();
    const uid = assertParticipantAuth(request);
    const input = parseParticipantRequest(request.data);
    const refs = refsFor(firestore, input.stakeId, input.activityId);

    const result = await firestore.runTransaction(async (tx) => {
      const now = clock();
      const nowIso = now.toISOString();
      const activitySnap = await tx.get(refs.activityRef);
      if (!activitySnap.exists) throw new HttpsError("not-found", "Attività non trovata.");
      const activity = activitySnap.data() || {};
      if (input.action === "context") {
        assertRecordsEnabled(activity);
        return participantContext({ tx, refs, firestore, uid, stakeId: input.stakeId });
      }
      assertParticipantWindowOpen(activity, now);

      // Per quale iscrizione si agisce: propose e challenge scelgono (default la
      // propria); edit, withdraw e restore seguono il tentativo, che deve essere
      // del titolare.
      let registrationId;
      if (ENTRY_ACTIONS.has(input.action)) {
        const entrySnap = await tx.get(refs.entries.doc(input.fields.entryId));
        if (!entrySnap.exists || entrySnap.data().ownerUid !== uid) {
          throw new HttpsError("not-found", "Iscrizione al record non trovata.");
        }
        registrationId = entrySnap.data().registrationId;
      } else {
        registrationId = input.fields.registrationId || `user_${uid}`;
        if (!canActForRegistration(uid, registrationId)) {
          throw new HttpsError("permission-denied", "Non puoi agire per questa iscrizione.");
        }
      }
      const registrationSnap = await tx.get(refs.registrations.doc(registrationId));
      if (!registrationSnap.exists || !isRegistrationActive(registrationSnap.data())) {
        throw new HttpsError("permission-denied", "Per partecipare ai record serve l'iscrizione all'attività.");
      }
      const registration = registrationSnap.data() || {};
      if (registrationId.startsWith("child_") && typeof registration.parentUid === "string" && registration.parentUid !== uid) {
        throw new HttpsError("permission-denied", "Non puoi agire per questa iscrizione.");
      }
      const entries = await readEntriesOfRegistration(tx, refs, registrationId);
      return PARTICIPANT_ACTIONS[input.action]({
        tx,
        refs,
        uid,
        registrationId,
        registration,
        entries,
        fields: input.fields,
        nowIso,
      });
    });

    logger.info("Record night participant action.", {
      action: input.action,
      stakeId: input.stakeId,
      activityId: input.activityId,
      uid,
      entryId: result.entry?.id ?? null,
      recordId: result.record?.id ?? result.entry?.recordId ?? null,
    });
    return { ok: true, action: input.action, ...result };
  };
}

// Chi può chiamare recordNightAdmin: admin del palo o super_admin, dirigente di
// unità del palo, uid in `staffUids` con iscrizione attiva. Solo letture. Con `listStaff` e `setStaff`
// serve un admin. Il modulo deve essere acceso (anche dopo la scadenza).
async function authorizeAdminCall(tx, firestore, refs, uid, input) {
  const access = await resolveStaffAccessInTx(tx, firestore, refs, uid, input.stakeId);
  if (!access) {
    throw new HttpsError("permission-denied", "Non hai i permessi per gestire i record di questa attività.");
  }
  if (ADMIN_ONLY_ACTIONS.has(input.action) && !canManageStaff(access)) {
    throw new HttpsError("permission-denied", "Solo gli amministratori del palo possono scegliere chi gestisce i record.");
  }
  const activitySnap = await tx.get(refs.activityRef);
  if (!activitySnap.exists) throw new HttpsError("not-found", "Attività non trovata.");
  assertRecordsEnabled(activitySnap.data() || {});
  return access;
}

function createRecordNightAdminHandler({ db, clock = () => new Date() } = {}) {
  return async (request) => {
    const firestore = db || getFirestore();
    const uid = assertAdminAuth(request);
    const input = parseAdminRequest(request.data);
    const refs = refsFor(firestore, input.stakeId, input.activityId);

    let result;
    if (Object.hasOwn(READ_ONLY_ADMIN_ACTIONS, input.action)) {
      // Autorizzazione in una transazione breve, poi la lettura delle iscrizioni senza blocchi.
      await firestore.runTransaction((tx) => authorizeAdminCall(tx, firestore, refs, uid, input));
      result = await READ_ONLY_ADMIN_ACTIONS[input.action]({ refs, uid, fields: input.fields });
    } else {
      result = await firestore.runTransaction(async (tx) => {
        const nowIso = clock().toISOString();
        await authorizeAdminCall(tx, firestore, refs, uid, input);
        return ADMIN_ACTIONS[input.action]({ tx, refs, uid, fields: input.fields, nowIso });
      });
    }

    logger.info("Record night admin action.", {
      action: input.action,
      stakeId: input.stakeId,
      activityId: input.activityId,
      uid,
      entryId: result.entry?.id ?? null,
      recordId: result.record?.id ?? result.entry?.recordId ?? null,
    });
    return { ok: true, action: input.action, ...result };
  };
}

// ---------------------------------------------------------------------------
// Trigger: iscrizione annullata o cancellata
// ---------------------------------------------------------------------------

// Ritira i tentativi pending/approved di un'iscrizione e scala i contatori, in
// una transazione. Se l'iscrizione è `user_<uid>` toglie anche l'uid da
// `staffUids`: chi non è più iscritto non gestisce più i record. Rilegge
// l'iscrizione: se nel frattempo è stata riattivata (o ricreata con lo stesso
// id) non tocca niente. Idempotente.
async function retireEntriesForRegistration(db, { stakeId, activityId, registrationId }, clock = () => new Date()) {
  const refs = refsFor(db, stakeId, activityId);
  return db.runTransaction(async (tx) => {
    const nowIso = clock().toISOString();
    const registrationSnap = await tx.get(refs.registrations.doc(registrationId));
    if (registrationSnap.exists && isRegistrationActive(registrationSnap.data())) {
      return { retired: 0, staffRemoved: false };
    }
    const entries = plainList(await readEntriesOfRegistration(tx, refs, registrationId));
    const plan = planRetireEntries(entries, nowIso);
    const staffUid = /^user_.+$/u.test(registrationId) ? registrationId.slice("user_".length) : null;
    const staffSnap = staffUid ? await tx.get(refs.staff) : null;
    const staffUids = staffSnap && staffSnap.exists ? staffUidsOf(staffSnap.data()) : [];
    const removeStaff = staffUid !== null && staffUids.includes(staffUid);
    if (!plan.patches.length && !removeStaff) return { retired: 0, staffRemoved: false };
    const recordIds = [...plan.recordDeltas.keys()];
    const recordSnaps = recordIds.length ? await tx.getAll(...recordIds.map((id) => refs.records.doc(id))) : [];

    for (const { id, patch } of plan.patches) tx.update(refs.entries.doc(id), patch);
    for (const snap of recordSnaps) {
      if (!snap.exists) continue;
      writeCounter(tx, view(snap), plan.recordDeltas.get(snap.id), nowIso);
    }
    if (removeStaff) {
      tx.update(refs.staff, { staffUids: nextStaffUids(staffUids, staffUid, false), updatedAt: nowIso, updatedBy: "system" });
    }
    return { retired: plan.patches.length, staffRemoved: removeStaff };
  });
}

// Pulizia quando si cancella l'attività: record, tentativi (con i nomi dei
// ragazzi) ed elenco dello staff non devono restare orfani. Idempotente.
async function cleanupDeletedActivity(db, { stakeId, activityId }) {
  const refs = refsFor(db, stakeId, activityId);
  if ((await refs.activityRef.get()).exists) return false;
  await db.recursiveDelete(refs.entries);
  await db.recursiveDelete(refs.records);
  await refs.staff.delete();
  return true;
}

const recordNightParticipant = onCall(
  { region: REGION, timeoutSeconds: 60 },
  createRecordNightParticipantHandler(),
);

const recordNightAdmin = onCall(
  { region: REGION, timeoutSeconds: 60 },
  createRecordNightAdminHandler(),
);

// Un solo trigger per update e delete: parte solo per il passaggio a
// cancelled/rejected_by_parent o per la cancellazione del documento.
const onRecordNightRegistrationChanged = onDocumentWritten(
  {
    document: "stakes/{stakeId}/activities/{activityId}/registrations/{registrationId}",
    region: REGION,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before) return; // creazione: nessun tentativo da ritirare
    if (after && (isRegistrationActive(after) || !isRegistrationActive(before))) return;
    const result = await retireEntriesForRegistration(getFirestore(), event.params);
    if (result.retired || result.staffRemoved) {
      logger.info("Record night entries retired for registration.", {
        ...event.params,
        retired: result.retired,
        staffRemoved: result.staffRemoved,
      });
    }
  },
);

const onRecordNightActivityDeleted = onDocumentDeleted(
  {
    document: "stakes/{stakeId}/activities/{activityId}",
    region: REGION,
  },
  async (event) => {
    const cleaned = await cleanupDeletedActivity(getFirestore(), event.params);
    if (cleaned) logger.info("Record night data removed for deleted activity.", event.params);
  },
);

module.exports = {
  recordNightParticipant,
  recordNightAdmin,
  onRecordNightRegistrationChanged,
  onRecordNightActivityDeleted,
  createRecordNightParticipantHandler,
  createRecordNightAdminHandler,
  retireEntriesForRegistration,
  cleanupDeletedActivity,
  // Logica pura, provata in functions/tests/recordNightLogic.test.mjs.
  RECORD_CATEGORIES,
  RECORD_MEASURES,
  RECORD_STATUSES,
  ENTRY_STATUSES,
  MAX_ACTIVE_ENTRIES,
  ENTRY_TRANSITIONS,
  canTransition,
  assertTransition,
  counterDelta,
  nextChallengerCount,
  isActiveEntry,
  assertEntryLimit,
  assertNotAlreadyInRecord,
  assertNoDuplicateProposal,
  isRegistrationActive,
  canActForRegistration,
  buildPeople,
  resolveStaffAccess,
  canManageStaff,
  nextStaffUids,
  staffUidsOf,
  planHideRecord,
  planShowRecord,
  participantNameFromRegistration,
  ownerUidFromRegistrationId,
  resolveCloseAt,
  getParticipantWindow,
  planRetireEntries,
  buildProposalEntry,
  buildChallengeEntry,
  parseParticipantRequest,
  parseAdminRequest,
  parseProposalFields,
  parseRecordFields,
};
