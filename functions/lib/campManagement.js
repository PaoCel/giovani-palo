const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const REGION = "europe-west1";

const COMMITTEE_DEFINITIONS = [
  { id: "logistics", title: "Logistica e Materiali", emoji: "🧱" },
  { id: "wellbeing", title: "Benessere e Supporto", emoji: "🛋️" },
  { id: "kitchen", title: "Cucina", emoji: "🥘" },
  { id: "games", title: "Giochi e Attivita", emoji: "🛝" },
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

function normalizePatrol(source, index, claimedRegistrationIds) {
  const data =
    source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const timestamp = asString(data.updatedAt) || nowIso();
  const leaderRegistrationId = asString(data.leaderRegistrationId);
  const safeLeaderRegistrationId =
    leaderRegistrationId && !claimedRegistrationIds.has(leaderRegistrationId)
      ? leaderRegistrationId
      : "";
  const supervisorRegistrationIds = [];
  const memberRegistrationIds = [];

  if (safeLeaderRegistrationId) {
    claimedRegistrationIds.add(safeLeaderRegistrationId);
  }

  for (const registrationId of uniqueStrings(asStringArray(data.supervisorRegistrationIds))) {
    if (claimedRegistrationIds.has(registrationId)) continue;
    claimedRegistrationIds.add(registrationId);
    supervisorRegistrationIds.push(registrationId);
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
      normalizePatrol(patrol, index, claimedPatrolRegistrationIds),
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

async function assertCampManager(db, request, stakeId) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login richiesto.");
  }

  const userDoc = await db.doc(`users/${request.auth.uid}`).get();
  if (!userDoc.exists) {
    throw new HttpsError("permission-denied", "Profilo utente non trovato.");
  }

  const user = userDoc.data() || {};
  const sameStake = user.role === "super_admin" || user.stakeId === stakeId;
  const canManage =
    sameStake &&
    (user.role === "admin" || user.role === "super_admin" || user.role === "unit_leader");

  if (!canManage) {
    throw new HttpsError("permission-denied", "Servono privilegi comitato/pattuglia.");
  }

  return user;
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

    await assertCampManager(db, request, stakeId);

    const activityRef = db.doc(`stakes/${stakeId}/activities/${activityId}`);
    const activitySnapshot = await activityRef.get();
    if (!activitySnapshot.exists) {
      throw new HttpsError("not-found", "Attivita non trovata.");
    }

    const activity = activitySnapshot.data() || {};
    if (activity.activityType !== "camp") {
      throw new HttpsError("failed-precondition", "I comitati sono modificabili solo su attivita camp.");
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

module.exports = {
  campManagementSave,
};
