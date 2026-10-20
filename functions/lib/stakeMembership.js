// Appartenenza al palo: `stakes/{stakeId}/members/{uid}`, scritto solo dal
// server (docs/APPARTENENZA_AL_PALO.md, parte B e "Contratto di
// autorizzazione"). Qui la logica pura, condivisa da script di migrazione,
// callable e trigger: niente Firestore, niente orologio implicito.

const MEMBER_STATUSES = Object.freeze(["pending", "active", "declined", "withdrawn", "removed", "blocked"]);
const STAFF_ROLES = Object.freeze(["admin", "unit_leader"]);
const SOURCE_KINDS = Object.freeze([
  "migration",
  "link_code",
  "parent_link",
  "manual_registration",
  "staff_approval",
  "staff_invite",
]);
const MAX_REGISTRATION_HINTS = 5;

// Ruolo staff copiato sul documento members, così Storage legge un solo
// documento. Il super admin del palo conta come admin.
function staffRoleFromUserRole(role) {
  if (role === "admin" || role === "super_admin") return "admin";
  if (role === "unit_leader") return "unit_leader";
  return null;
}

function birthYearOf(birthDate) {
  const match = /^(\d{4})-\d{2}-\d{2}$/u.exec(typeof birthDate === "string" ? birthDate : "");
  return match ? Number(match[1]) : null;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Account a cui appartiene un'iscrizione: il titolare (`userId`), il genitore
// che ha iscritto un figlio (`parentUid`), l'ospite che ha poi collegato un
// account con lo stesso uid (`anonymousUid`, iscrizione `guest_<uid>`).
// Le iscrizioni `manual_` non hanno account.
function registrationOwnerUids(registration) {
  const uids = new Set();
  for (const key of ["userId", "parentUid", "anonymousUid"]) {
    const value = cleanString(registration && registration[key]);
    if (value) uids.add(value);
  }
  return [...uids];
}

// Iscrizione inviata e non chiusa. Non contano la bozza mai inviata, quella
// annullata e quella rifiutata dal genitore: chi ha solo quelle va in coda e lo
// verifica un dirigente (il 2026-10-20 in produzione non ce n'erano).
const LIVE_REGISTRATION_STATUSES = Object.freeze([
  "submitted",
  "waitlist",
  "active",
  "pending_parent_authorization",
  "confirmed",
]);

function isLiveRegistration(registration) {
  return Boolean(registration) && LIVE_REGISTRATION_STATUSES.includes(registration.registrationStatus);
}

// Gruppi della scelta A3 (approvata il 2026-10-16):
// - staff (admin, dirigente di unità): `active` con `staffRole`;
// - participant/parent con almeno un'iscrizione inviata e non chiusa nel
//   palo (vedi isLiveRegistration), propria o di un figlio: `active` con
//   `reviewNeeded: true`;
// - gli altri: `pending` ("account esistente" in coda).
function migrationGroupOf(user, liveRegistrationCount) {
  if (staffRoleFromUserRole(user.role)) return "staff";
  return liveRegistrationCount > 0 ? "registered" : "queued";
}

function buildRegistrationHints(registrations, activityTitles) {
  const seen = new Set();
  const hints = [];
  for (const registration of registrations) {
    const activityId = cleanString(registration.activityId);
    if (!activityId || seen.has(activityId)) continue;
    seen.add(activityId);
    hints.push({ activityId, title: cleanString(activityTitles.get(activityId)) || "Attività" });
    if (hints.length >= MAX_REGISTRATION_HINTS) break;
  }
  return hints;
}

// Documento members iniziale per un account esistente. `at` è il Timestamp (o
// il sentinel serverTimestamp) dei campi di primo livello; `sourceAt` quello
// dentro `sources`, che deve essere un valore concreto: Firestore non accetta
// serverTimestamp() dentro un array.
function buildMigratedMember({ user, liveRegistrations, activityTitles, at, sourceAt = at, migrationRef }) {
  const group = migrationGroupOf(user, liveRegistrations.length);
  const active = group !== "queued";
  return {
    status: active ? "active" : "pending",
    sources: [{ kind: "migration", ref: migrationRef, at: sourceAt }],
    previous: null,
    staffRole: staffRoleFromUserRole(user.role),
    claimedUnitId: cleanString(user.unitId),
    claimedUnitName: cleanString(user.unitName),
    displayName: cleanString(user.fullName) || [cleanString(user.firstName), cleanString(user.lastName)].filter(Boolean).join(" "),
    birthYear: birthYearOf(user.birthDate),
    registrationHints: buildRegistrationHints(liveRegistrations, activityTitles),
    reviewNeeded: group === "registered",
    requestedAt: at,
    decidedAt: active ? at : null,
    decidedBy: active ? "system" : null,
    declineCount: 0,
    version: 1,
  };
}

// Membro attivo creato da chi ha già verificato la persona (tool del super
// admin per un palo nuovo, seed dei dati demo): stessa forma della migrazione,
// senza "da confermare".
function buildActiveMember({ user, source, at, sourceAt = at }) {
  return {
    status: "active",
    sources: [{ kind: source.kind, ref: source.ref, at: sourceAt }],
    previous: null,
    staffRole: staffRoleFromUserRole(user.role),
    claimedUnitId: cleanString(user.unitId),
    claimedUnitName: cleanString(user.unitName),
    displayName: cleanString(user.fullName) || [cleanString(user.firstName), cleanString(user.lastName)].filter(Boolean).join(" "),
    birthYear: birthYearOf(user.birthDate),
    registrationHints: [],
    reviewNeeded: false,
    requestedAt: at,
    decidedAt: at,
    decidedBy: "system",
    declineCount: 0,
    version: 1,
  };
}

// Piano della migrazione per un palo: un documento per ogni profilo con
// `users.stakeId == stakeId` che non ha ancora il proprio members. I documenti
// esistenti non si toccano mai (decisioni dello staff, richieste nuove).
//
// users: [{ uid, role, stakeId, unitId, unitName, fullName, firstName, lastName, birthDate }]
// registrations: [{ activityId, userId, parentUid, anonymousUid, registrationStatus }] del palo
// existingMemberUids: Set di uid con members già presente
function planStakeMemberMigration({ stakeId, users, registrations, existingMemberUids, activityTitles, at, sourceAt = at, migrationRef }) {
  const liveByUid = new Map();
  for (const registration of registrations) {
    if (!isLiveRegistration(registration)) continue;
    for (const uid of registrationOwnerUids(registration)) {
      if (!liveByUid.has(uid)) liveByUid.set(uid, []);
      liveByUid.get(uid).push(registration);
    }
  }
  const titles = activityTitles instanceof Map ? activityTitles : new Map(Object.entries(activityTitles || {}));
  const toCreate = [];
  const skipped = [];
  const counts = { staff: 0, registered: 0, queued: 0, alreadyMember: 0, otherStake: 0 };
  for (const user of users) {
    if (user.stakeId !== stakeId) {
      counts.otherStake += 1;
      continue;
    }
    if (existingMemberUids.has(user.uid)) {
      counts.alreadyMember += 1;
      skipped.push({ uid: user.uid, reason: "already_member" });
      continue;
    }
    const liveRegistrations = liveByUid.get(user.uid) || [];
    const doc = buildMigratedMember({ user, liveRegistrations, activityTitles: titles, at, sourceAt, migrationRef });
    counts[migrationGroupOf(user, liveRegistrations.length)] += 1;
    toCreate.push({ uid: user.uid, doc });
  }
  return { toCreate, skipped, counts };
}

// ---------------------------------------------------------------------------
// Callable `stakeMembership` e trigger su `users/{uid}` (fase 2): parti pure.
// Interfaccia: docs/APPARTENENZA_AL_PALO.md, «Callable e trigger: interfaccia».
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
// Dopo un rifiuto si può chiedere di nuovo dopo 7 giorni, al massimo 3 volte;
// poi serve il codice di uno staff (Tetti).
const DECLINE_COOLDOWN_MS = 7 * DAY_MS;
const MAX_DECLINES = 3;

// Campi che `previous` conserva per "Annulla" e "Riattiva".
const PREVIOUS_FIELDS = Object.freeze([
  "status",
  "sources",
  "staffRole",
  "reviewNeeded",
  "claimedUnitId",
  "claimedUnitName",
  "declineCount",
  "decidedAt",
  "decidedBy",
]);

// Azioni dello staff: le sole che "Annulla" ripristina. Il dirigente di unità
// fa solo le prime cinque, e solo per chi ha dichiarato la sua unità.
const UNIT_LEADER_ACTIONS = Object.freeze(["approve", "decline", "notMyUnit", "confirmKnown", "markUnknown"]);
const ADMIN_ACTIONS = Object.freeze(["approve", "decline", "confirmKnown", "markUnknown", "remove", "block", "unblock", "reactivate"]);
const STAFF_ACTIONS = Object.freeze([...new Set([...UNIT_LEADER_ACTIONS, ...ADMIN_ACTIONS])]);
const SELF_ACTIONS = Object.freeze(["request", "withdraw", "leave"]);
const ACTIONS = Object.freeze([...SELF_ACTIONS, ...STAFF_ACTIONS, "undo"]);

// "Partecipante" è il nome provvisorio dei profili creati senza nome.
function isPlaceholderName(value) {
  return !value || value === "Partecipante";
}

// Stessa regola del client (src/utils/profileCompletion.ts,
// needsProfileCompletion): per il genitore bastano nome, unità, palo e comune.
function needsProfileCompletion(profile) {
  const p = profile || {};
  if (p.role === "parent") {
    return isPlaceholderName(p.fullName) || !p.unitName || !p.stakeId || !p.city;
  }
  return isPlaceholderName(p.fullName) || !p.birthDate || !p.genderRoleCategory || !p.unitName || !p.stakeId;
}

// Poteri di chi chiama su un palo, dal ruolo del profilo (assegnato da un
// admin, mai autodichiarato). Il super admin vale come admin ovunque.
// Restituisce { level: "admin" | "unit_leader", superAdmin, unitId } o null.
function staffAuthorityOf(profile, stakeId) {
  if (!profile || typeof profile !== "object") return null;
  if (profile.role === "super_admin") return { level: "admin", superAdmin: true, unitId: "" };
  if (profile.stakeId !== stakeId) return null;
  if (profile.role === "admin") return { level: "admin", superAdmin: false, unitId: "" };
  if (profile.role === "unit_leader") {
    return { level: "unit_leader", superAdmin: false, unitId: cleanString(profile.unitId) };
  }
  return null;
}

// Ruolo staff che il documento members di un palo deve copiare: quello del
// profilo, solo se il profilo è di quel palo.
function staffRoleForStake(profile, stakeId) {
  if (!profile || typeof profile !== "object" || profile.stakeId !== stakeId) return null;
  return staffRoleFromUserRole(profile.role);
}

// Ruolo che dà poteri sul palo e che un'uscita dal palo deve togliere. Il
// super admin non è un ruolo del palo: lo tiene.
function isDemotableStaffOf(profile, stakeId) {
  return Boolean(profile) && profile.stakeId === stakeId && (profile.role === "admin" || profile.role === "unit_leader");
}

function isAdminOf(profile, stakeId) {
  return Boolean(profile) && profile.stakeId === stakeId && profile.role === "admin";
}

function timestampMs(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

// Perché una nuova richiesta non è ammessa, o null. Vale per `request`; il
// trigger non scavalca mai i tetti perché non tocca documenti esistenti.
function requestBlockOf(member, nowMs) {
  if (!member) return null;
  if (member.status === "removed" || member.status === "blocked") return { reason: "invalid_state" };
  if ((member.status === "declined" || member.status === "withdrawn") && Number(member.declineCount || 0) >= MAX_DECLINES) {
    return { reason: "too_many_declines" };
  }
  if (member.status === "declined") {
    const decidedMs = timestampMs(member.decidedAt);
    if (decidedMs !== null && nowMs - decidedMs < DECLINE_COOLDOWN_MS) {
      return { reason: "cooldown", retryAt: new Date(decidedMs + DECLINE_COOLDOWN_MS).toISOString() };
    }
  }
  return null;
}

function previousOf(member, { action, by, at, role = null, staffLists = null, moved = null }) {
  const previous = { action, by, at };
  for (const field of PREVIOUS_FIELDS) previous[field] = member && field in member ? member[field] : null;
  // `role` è il ruolo di prima, come gli altri campi; `roleAfter` quello che
  // l'azione ha lasciato, così "Annulla" non sovrascrive un ruolo cambiato poi.
  // `roleUnitId`: unità del profilo quando il ruolo è stato tolto. Un
  // dirigente riprende il ruolo solo nella stessa unità: da `participant` può
  // cambiarla da solo, e il ruolo gli darebbe i minori di un'altra unità.
  if (role) {
    previous.role = role.before;
    previous.roleAfter = role.after;
    previous.roleUnitId = role.unitId ?? null;
  }
  if (staffLists && staffLists.length) previous.staffLists = staffLists;
  if (moved && moved.length) previous.moved = moved;
  return previous;
}

// Chi può annullare l'ultima azione: un admin del palo qualunque azione dello
// staff, un dirigente solo le proprie. Le azioni dell'utente e del sistema non
// si annullano.
function canUndo(previous, authority, callerUid) {
  if (!previous || !STAFF_ACTIONS.includes(previous.action) || !previous.by || previous.by === "system") return "nothing";
  if (!authority) return "denied";
  if (authority.level === "admin") return "ok";
  return previous.by === callerUid && UNIT_LEADER_ACTIONS.includes(previous.action) ? "ok" : "denied";
}

// Campi della richiesta presi dal profilo (unità, nome, anno).
function requestFieldsFromProfile(profile) {
  const p = profile || {};
  return {
    claimedUnitId: cleanString(p.unitId),
    claimedUnitName: cleanString(p.unitName),
    displayName: cleanString(p.fullName) || [cleanString(p.firstName), cleanString(p.lastName)].filter(Boolean).join(" "),
    birthYear: birthYearOf(p.birthDate),
  };
}

module.exports = {
  DECLINE_COOLDOWN_MS,
  MAX_DECLINES,
  PREVIOUS_FIELDS,
  UNIT_LEADER_ACTIONS,
  ADMIN_ACTIONS,
  STAFF_ACTIONS,
  SELF_ACTIONS,
  ACTIONS,
  needsProfileCompletion,
  staffAuthorityOf,
  staffRoleForStake,
  isDemotableStaffOf,
  isAdminOf,
  timestampMs,
  requestBlockOf,
  previousOf,
  canUndo,
  requestFieldsFromProfile,
  buildRegistrationHints,
  MEMBER_STATUSES,
  STAFF_ROLES,
  SOURCE_KINDS,
  MAX_REGISTRATION_HINTS,
  LIVE_REGISTRATION_STATUSES,
  staffRoleFromUserRole,
  birthYearOf,
  registrationOwnerUids,
  isLiveRegistration,
  migrationGroupOf,
  buildMigratedMember,
  buildActiveMember,
  planStakeMemberMigration,
};
