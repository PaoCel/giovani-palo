const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { isAdultByAge } = require("./adultAge");

const REGION = "europe-west1";

const COMMITTEE_DEFINITIONS = [
  { id: "logistics", title: "Logistica e Materiali", emoji: "🧱" },
  { id: "wellbeing", title: "Benessere e Supporto", emoji: "🛋️" },
  { id: "kitchen", title: "Cucina", emoji: "🥘" },
  { id: "games", title: "Giochi e Attività", emoji: "🛝" },
  { id: "spiritual", title: "Pensieri Spirituali e Serate", emoji: "ℹ️" },
];

function nowIso() {
  return new Date().toISOString();
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  return values
    .map((value) => String(value).trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function asGenderRoleCategory(value) {
  return value === "giovane_uomo" ||
    value === "giovane_donna" ||
    value === "dirigente" ||
    value === "accompagnatore"
    ? value
    : "";
}

function isAdultCategory(value) {
  return value === "dirigente" || value === "accompagnatore";
}

function getPublicName(data) {
  return (
    asString(data.fullName) ||
    [asString(data.firstName), asString(data.lastName)].filter(Boolean).join(" ")
  ).trim();
}

function getPublicUnitName(data) {
  return (asString(data.unitNameSnapshot) || asString(data.unitName)).trim();
}

function normalizeManualLeader(source, index) {
  const data =
    source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const timestamp = asString(data.updatedAt) || nowIso();

  return {
    id: asString(data.id) || `manual-leader-${index + 1}`,
    fullName: asString(data.fullName).trim(),
    linkedRegistrationId: asString(data.linkedRegistrationId) || null,
    createdAt: asString(data.createdAt) || timestamp,
    updatedAt: timestamp,
  };
}

function normalizeCommittee(definition, source, claimedRegistrationIds, claimedManualLeaderIds) {
  const data =
    source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const timestamp = asString(data.updatedAt) || nowIso();
  const leaderRegistrationIds = [];
  const manualLeaderIds = [];
  const memberRegistrationIds = [];

  for (const registrationId of uniqueStrings(asStringArray(data.leaderRegistrationIds))) {
    if (claimedRegistrationIds.has(registrationId)) continue;
    claimedRegistrationIds.add(registrationId);
    leaderRegistrationIds.push(registrationId);
  }

  for (const manualLeaderId of uniqueStrings(asStringArray(data.manualLeaderIds))) {
    if (claimedManualLeaderIds.has(manualLeaderId)) continue;
    claimedManualLeaderIds.add(manualLeaderId);
    manualLeaderIds.push(manualLeaderId);
  }

  for (const registrationId of uniqueStrings(asStringArray(data.memberRegistrationIds))) {
    if (claimedRegistrationIds.has(registrationId)) continue;
    claimedRegistrationIds.add(registrationId);
    memberRegistrationIds.push(registrationId);
  }

  return {
    id: definition.id,
    title: asString(data.title) || definition.title,
    emoji: asString(data.emoji) || definition.emoji,
    leaderRegistrationIds,
    manualLeaderIds,
    memberRegistrationIds,
    publicMembers: [],
    updatedAt: timestamp,
  };
}

function normalizePatrol(
  source,
  index,
  claimedRegistrationIds,
  claimedManualSupervisorIds,
) {
  const data =
    source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const timestamp = asString(data.updatedAt) || nowIso();
  const leaderRegistrationId = asString(data.leaderRegistrationId);
  const safeLeaderRegistrationId =
    leaderRegistrationId && !claimedRegistrationIds.has(leaderRegistrationId)
      ? leaderRegistrationId
      : "";
  const supervisorRegistrationIds = [];
  const manualSupervisorIds = [];
  const memberRegistrationIds = [];

  if (safeLeaderRegistrationId) {
    claimedRegistrationIds.add(safeLeaderRegistrationId);
  }

  for (const registrationId of uniqueStrings(asStringArray(data.supervisorRegistrationIds))) {
    if (claimedRegistrationIds.has(registrationId)) continue;
    claimedRegistrationIds.add(registrationId);
    supervisorRegistrationIds.push(registrationId);
  }

  for (const manualSupervisorId of uniqueStrings(asStringArray(data.manualSupervisorIds))) {
    if (claimedManualSupervisorIds.has(manualSupervisorId)) continue;
    claimedManualSupervisorIds.add(manualSupervisorId);
    manualSupervisorIds.push(manualSupervisorId);
  }

  for (const registrationId of uniqueStrings(asStringArray(data.memberRegistrationIds))) {
    if (claimedRegistrationIds.has(registrationId)) continue;
    claimedRegistrationIds.add(registrationId);
    memberRegistrationIds.push(registrationId);
  }

  return {
    id: asString(data.id) || `patrol-${index + 1}`,
    name: asString(data.name) || `Pattuglia ${index + 1}`,
    leaderRegistrationId: safeLeaderRegistrationId,
    supervisorRegistrationIds,
    manualSupervisorIds,
    memberRegistrationIds,
    publicMembers: [],
    updatedAt: timestamp,
  };
}

function normalizeCampManagement(source) {
  const data =
    source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const timestamp = nowIso();
  const rawCommittees = Array.isArray(data.committees) ? data.committees : [];
  const rawPatrols = Array.isArray(data.patrols) ? data.patrols : [];
  const rawManualLeaders = Array.isArray(data.manualLeaders) ? data.manualLeaders : [];
  const committeeById = new Map();

  for (const item of rawCommittees) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = item.id;
    if (
      id === "logistics" ||
      id === "wellbeing" ||
      id === "kitchen" ||
      id === "games" ||
      id === "spiritual"
    ) {
      committeeById.set(id, item);
    }
  }

  const claimedCommitteeRegistrationIds = new Set();
  const claimedManualLeaderIds = new Set();
  const claimedPatrolRegistrationIds = new Set();
  const claimedPatrolManualSupervisorIds = new Set();

  return {
    committees: COMMITTEE_DEFINITIONS.map((definition) =>
      normalizeCommittee(
        definition,
        committeeById.get(definition.id),
        claimedCommitteeRegistrationIds,
        claimedManualLeaderIds,
      ),
    ),
    patrols: rawPatrols.map((patrol, index) =>
      normalizePatrol(
        patrol,
        index,
        claimedPatrolRegistrationIds,
        claimedPatrolManualSupervisorIds,
      ),
    ),
    manualLeaders: rawManualLeaders
      .map((leader, index) => normalizeManualLeader(leader, index))
      .filter((leader) => leader.fullName),
    updatedAt: asString(data.updatedAt) || timestamp,
  };
}

function buildPublicMember(registrationsById, registrationId, role) {
  const registration = registrationsById.get(registrationId);
  if (!registration) return null;

  const fullName = getPublicName(registration);
  if (!fullName) return null;

  return {
    registrationId,
    fullName,
    genderRoleCategory: asGenderRoleCategory(registration.genderRoleCategory),
    unitName: getPublicUnitName(registration),
    role,
  };
}

function attachPublicMembers(registrationsSnapshot, plan) {
  const registrationsById = new Map();

  for (const document of registrationsSnapshot.docs) {
    registrationsById.set(document.id, document.data() || {});
  }

  return {
    ...plan,
    committees: plan.committees.map((committee) => ({
      ...committee,
      publicMembers: [
        ...committee.leaderRegistrationIds.map((registrationId) =>
          buildPublicMember(registrationsById, registrationId, "leader"),
        ),
        ...committee.memberRegistrationIds.map((registrationId) =>
          buildPublicMember(registrationsById, registrationId, "member"),
        ),
      ].filter(Boolean),
    })),
    patrols: plan.patrols.map((patrol) => ({
      ...patrol,
      publicMembers: [
        patrol.leaderRegistrationId
          ? buildPublicMember(registrationsById, patrol.leaderRegistrationId, "leader")
          : null,
        ...patrol.supervisorRegistrationIds.map((registrationId) =>
          buildPublicMember(registrationsById, registrationId, "supervisor"),
        ),
        ...patrol.memberRegistrationIds.map((registrationId) =>
          buildPublicMember(registrationsById, registrationId, "member"),
        ),
      ].filter(Boolean),
    })),
  };
}

function buildPatrolAssignments(plan) {
  const assignments = new Map();

  for (const patrol of plan.patrols) {
    const patrolName = String(patrol.name || "").trim();
    if (!patrol.id || !patrolName) continue;

    for (const registrationId of patrol.memberRegistrationIds) {
      assignments.set(registrationId, {
        assignedPatrolId: patrol.id,
        assignedPatrolName: patrolName,
        assignedPatrolRole: "member",
      });
    }

    for (const registrationId of patrol.supervisorRegistrationIds) {
      assignments.set(registrationId, {
        assignedPatrolId: patrol.id,
        assignedPatrolName: patrolName,
        assignedPatrolRole: "supervisor",
      });
    }

    if (patrol.leaderRegistrationId) {
      assignments.set(patrol.leaderRegistrationId, {
        assignedPatrolId: patrol.id,
        assignedPatrolName: patrolName,
        assignedPatrolRole: "leader",
      });
    }
  }

  return assignments;
}

function buildCommitteeAssignments(plan) {
  const assignments = new Map();
  const manualLeaderById = new Map(plan.manualLeaders.map((leader) => [leader.id, leader]));

  function addAssignment(registrationId, assignment) {
    if (!registrationId) return;
    assignments.set(registrationId, [...(assignments.get(registrationId) || []), assignment]);
  }

  for (const committee of plan.committees) {
    for (const registrationId of committee.leaderRegistrationIds) {
      addAssignment(registrationId, {
        id: committee.id,
        title: committee.title,
        role: "leader",
      });
    }

    for (const manualLeaderId of committee.manualLeaderIds) {
      const linkedRegistrationId = manualLeaderById.get(manualLeaderId)?.linkedRegistrationId;
      if (!linkedRegistrationId) continue;
      addAssignment(linkedRegistrationId, {
        id: committee.id,
        title: committee.title,
        role: "leader",
      });
    }

    for (const registrationId of committee.memberRegistrationIds) {
      addAssignment(registrationId, {
        id: committee.id,
        title: committee.title,
        role: "member",
      });
    }
  }

  return assignments;
}

function linkManualLeadersByName(registrationsSnapshot, plan) {
  const adultRegistrationIdByName = new Map();

  for (const document of registrationsSnapshot.docs) {
    const data = document.data() || {};
    if (!isAdultCategory(data.genderRoleCategory)) continue;
    const normalized = normalizeName(getPublicName(data));
    if (normalized && !adultRegistrationIdByName.has(normalized)) {
      adultRegistrationIdByName.set(normalized, document.id);
    }
  }

  return {
    ...plan,
    manualLeaders: plan.manualLeaders.map((leader) => ({
      ...leader,
      linkedRegistrationId: adultRegistrationIdByName.get(normalizeName(leader.fullName)) || null,
    })),
  };
}

const MAX_STAFF = 100;

function ownObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function staffUidsOf(staffDoc) {
  return ownObject(staffDoc) && Array.isArray(staffDoc.staffUids)
    ? staffDoc.staffUids.filter((item) => typeof item === "string" && item)
    : [];
}

// Come le rules: conta solo `registrationStatus`; se manca, le rules negano.
function isActiveRegistration(registration) {
  return (
    ownObject(registration) &&
    typeof registration.registrationStatus === "string" &&
    registration.registrationStatus !== "cancelled"
  );
}

// Chi gestisce il campeggio (uguale alle rules): admin del palo o super_admin,
// dirigente di unità del palo (ruolo assegnato da un admin), oppure un uid in
// `management/campStaff.staffUids` con iscrizione `user_<uid>` non annullata. La
// categoria dichiarata (`dirigente`, `accompagnatore`) non conta: la scrive
// chiunque nel proprio profilo. Restituisce 'admin' | 'unit_leader' | 'listed' | null.
function resolveCampAccess({ profile, stakeId, uid, staffUids, ownRegistration }) {
  if (ownObject(profile)) {
    if (profile.role === "super_admin") return "admin";
    if (profile.stakeId === stakeId) {
      if (profile.role === "admin") return "admin";
      if (profile.role === "unit_leader") return "unit_leader";
    }
  }
  return typeof uid === "string" && uid && Array.isArray(staffUids) && staffUids.includes(uid) && isActiveRegistration(ownRegistration)
    ? "listed"
    : null;
}

function campRefs(db, stakeId, activityId) {
  const activityRef = db.doc(`stakes/${stakeId}/activities/${activityId}`);
  return {
    activityRef,
    registrations: activityRef.collection("registrations"),
    staff: activityRef.collection("management").doc("campStaff"),
  };
}

function assertSignedIn(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login richiesto.");
  }
  if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("permission-denied", "Servono privilegi comitato/pattuglia.");
  }
}

async function loadCampAccess(db, request, stakeId, activityId) {
  assertSignedIn(request);
  const uid = request.auth.uid;
  const refs = campRefs(db, stakeId, activityId);
  const userDoc = await db.doc(`users/${uid}`).get();
  const profile = userDoc.exists ? userDoc.data() || {} : null;
  const direct = resolveCampAccess({ profile, stakeId, uid });
  if (direct) return { access: direct, refs };

  const staffSnap = await refs.staff.get();
  const staffUids = staffUidsOf(staffSnap.exists ? staffSnap.data() : null);
  if (!staffUids.includes(uid)) return { access: null, refs };
  const registrationSnap = await refs.registrations.doc(`user_${uid}`).get();
  return {
    access: resolveCampAccess({
      profile,
      stakeId,
      uid,
      staffUids,
      ownRegistration: registrationSnap.exists ? registrationSnap.data() : null,
    }),
    refs,
  };
}

async function assertCampManager(db, request, stakeId, activityId) {
  const { access } = await loadCampAccess(db, request, stakeId, activityId);
  if (!access) {
    throw new HttpsError("permission-denied", "Servono privilegi comitato/pattuglia.");
  }
  return access;
}

async function syncRegistrationCampAssignments(db, registrationsSnapshot, plan, timestamp) {
  const patrolAssignments = buildPatrolAssignments(plan);
  const committeeAssignments = buildCommitteeAssignments(plan);

  for (let start = 0; start < registrationsSnapshot.docs.length; start += 400) {
    const batch = db.batch();

    for (const document of registrationsSnapshot.docs.slice(start, start + 400)) {
      const patrolAssignment = patrolAssignments.get(document.id) || {};

      batch.update(document.ref, {
        assignedPatrolId: patrolAssignment.assignedPatrolId || null,
        assignedPatrolName: patrolAssignment.assignedPatrolName || null,
        assignedPatrolRole: patrolAssignment.assignedPatrolRole || null,
        assignedCommittees: committeeAssignments.get(document.id) || [],
        updatedAt: timestamp,
      });
    }

    await batch.commit();
  }
}

const campManagementSave = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    const db = getFirestore();
    const stakeId = asString(request.data?.stakeId);
    const activityId = asString(request.data?.activityId || request.data?.eventId);

    if (!stakeId || !activityId) {
      throw new HttpsError("invalid-argument", "stakeId e activityId sono obbligatori.");
    }

    await assertCampManager(db, request, stakeId, activityId);

    const activityRef = db.doc(`stakes/${stakeId}/activities/${activityId}`);
    const activitySnapshot = await activityRef.get();
    if (!activitySnapshot.exists) {
      throw new HttpsError("not-found", "Attività non trovata.");
    }

    const activity = activitySnapshot.data() || {};
    if (activity.activityType !== "camp") {
      throw new HttpsError("failed-precondition", "I comitati sono modificabili solo su attività camp.");
    }

    const timestamp = nowIso();
    const normalized = normalizeCampManagement({
      ...(request.data?.plan && typeof request.data.plan === "object" ? request.data.plan : {}),
      updatedAt: timestamp,
    });
    const registrationsSnapshot = await activityRef.collection("registrations").get();
    const linked = linkManualLeadersByName(registrationsSnapshot, normalized);
    const publicPlan = attachPublicMembers(registrationsSnapshot, linked);

    await activityRef.collection("management").doc("camp").set(
      {
        ...publicPlan,
        savedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await syncRegistrationCampAssignments(db, registrationsSnapshot, publicPlan, timestamp);

    logger.info("Camp management saved.", {
      stakeId,
      activityId,
      uid: request.auth.uid,
      committees: publicPlan.committees.length,
      patrols: publicPlan.patrols.length,
      registrationsSynced: registrationsSnapshot.size,
    });

    return {
      ok: true,
      plan: publicPlan,
      registrationsSynced: registrationsSnapshot.size,
    };
  },
);

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

// Chi si può mettere in staff: le iscrizioni `user_` non annullate, più chi è già
// in elenco senza un'iscrizione attiva (annullata o sparita), così l'admin lo
// vede e lo può togliere. Gli adulti (categoria adulta e maggiorenni) vengono
// prima solo per comodità di lettura.
async function listStaffCandidates(refs) {
  const [registrations, staffSnap] = await Promise.all([refs.registrations.get(), refs.staff.get()]);
  const staffUids = new Set(staffUidsOf(staffSnap.exists ? staffSnap.data() : null));
  const candidates = [];
  const seen = new Set();

  for (const document of registrations.docs) {
    if (!document.id.startsWith("user_")) continue;
    const data = document.data() || {};
    const uid = document.id.slice("user_".length);
    const active = isActiveRegistration(data);
    if (!active && !staffUids.has(uid)) continue;
    seen.add(uid);
    const name = getPublicName(data) || uid;
    candidates.push({
      uid,
      registrationId: document.id,
      name: active ? name : `${name} (iscrizione annullata)`,
      unitName: getPublicUnitName(data),
      isAdult: active && isAdultCategory(data.genderRoleCategory) && isAdultByAge(data.birthDate),
      isStaff: staffUids.has(uid),
    });
  }
  for (const uid of staffUids) {
    if (seen.has(uid)) continue;
    candidates.push({
      uid,
      registrationId: "",
      name: `${uid} (senza iscrizione)`,
      unitName: "",
      isAdult: false,
      isStaff: true,
    });
  }

  return candidates.sort(
    (left, right) =>
      Number(right.isAdult) - Number(left.isAdult) ||
      left.name.localeCompare(right.name, "it-IT") ||
      left.uid.localeCompare(right.uid),
  );
}

// Aggiunge o toglie un uid da `staffUids`. Aggiungere richiede una iscrizione
// `user_<uid>` non annullata a questo campeggio.
async function setStaffMember(db, refs, { uid, enabled }, adminUid) {
  return db.runTransaction(async (tx) => {
    const staffSnap = await tx.get(refs.staff);
    const registrationSnap = enabled ? await tx.get(refs.registrations.doc(`user_${uid}`)) : null;
    if (enabled && !(registrationSnap.exists && isActiveRegistration(registrationSnap.data()))) {
      throw new HttpsError("failed-precondition", "Può gestire il campeggio solo chi ha un'iscrizione attiva.");
    }
    const current = staffUidsOf(staffSnap.exists ? staffSnap.data() : null);
    const staffUids = nextStaffUids(current, uid, enabled);
    const changed = staffUids.length !== current.length || staffUids.some((item, index) => item !== current[index]);
    if (changed || !staffSnap.exists) {
      const data = { staffUids, updatedAt: nowIso(), updatedBy: adminUid };
      if (staffSnap.exists) tx.update(refs.staff, data);
      else tx.create(refs.staff, data);
    }
    return staffUids;
  });
}

const campManagementStaff = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
  },
  async (request) => {
    const db = getFirestore();
    const stakeId = asString(request.data?.stakeId);
    const activityId = asString(request.data?.activityId || request.data?.eventId);
    const action = asString(request.data?.action);

    if (!stakeId || !activityId) {
      throw new HttpsError("invalid-argument", "stakeId e activityId sono obbligatori.");
    }
    if (!["context", "list", "set"].includes(action)) {
      throw new HttpsError("invalid-argument", "Azione non valida.");
    }

    const { access, refs } = await loadCampAccess(db, request, stakeId, activityId);
    const activitySnapshot = await refs.activityRef.get();
    if (!activitySnapshot.exists || activitySnapshot.data()?.activityType !== "camp") {
      throw new HttpsError("failed-precondition", "L'elenco staff esiste solo per i campeggi.");
    }

    if (action === "context") {
      return { ok: true, isStaff: access !== null, canManageStaff: access === "admin" };
    }
    if (access !== "admin") {
      throw new HttpsError("permission-denied", "Solo un admin sceglie chi gestisce il campeggio.");
    }
    if (action === "list") {
      return { ok: true, candidates: await listStaffCandidates(refs) };
    }

    const uid = asString(request.data?.uid);
    if (!uid || typeof request.data?.enabled !== "boolean") {
      throw new HttpsError("invalid-argument", "uid ed enabled sono obbligatori.");
    }
    const staffUids = await setStaffMember(db, refs, { uid, enabled: request.data.enabled }, request.auth.uid);
    logger.info("Camp staff updated.", { stakeId, activityId, by: request.auth.uid, enabled: request.data.enabled, total: staffUids.length });
    return { ok: true, staffUids };
  },
);

module.exports = {
  campManagementSave,
  campManagementStaff,
  resolveCampAccess,
  nextStaffUids,
  isAdultByAge,
};
