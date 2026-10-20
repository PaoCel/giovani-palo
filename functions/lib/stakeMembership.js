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

function isLiveRegistration(registration) {
  return Boolean(registration) && registration.registrationStatus !== "cancelled";
}

// Gruppi della scelta A3 (approvata il 2026-10-16):
// - staff (admin, dirigente di unità): `active` con `staffRole`;
// - participant/parent con almeno un'iscrizione non annullata nel palo,
//   propria o di un figlio: `active` con `reviewNeeded: true`;
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

module.exports = {
  MEMBER_STATUSES,
  STAFF_ROLES,
  SOURCE_KINDS,
  MAX_REGISTRATION_HINTS,
  staffRoleFromUserRole,
  birthYearOf,
  registrationOwnerUids,
  isLiveRegistration,
  migrationGroupOf,
  buildMigratedMember,
  buildActiveMember,
  planStakeMemberMigration,
};
