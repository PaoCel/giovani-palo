import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type {
  CampCommitteeAssignment,
  CampCommitteeId,
  CampCommitteePlan,
  CampManagementPlan,
  CampManualLeader,
  CampPatrolPlan,
  CampPatrolRole,
} from "@/types";

const COMMITTEE_DEFINITIONS: Array<{
  id: CampCommitteeId;
  title: string;
  emoji: string;
}> = [
  { id: "logistics", title: "Logistica e Materiali", emoji: "🧱" },
  { id: "wellbeing", title: "Benessere e Supporto", emoji: "🛋️" },
  { id: "kitchen", title: "Cucina", emoji: "🥘" },
  { id: "games", title: "Giochi e Attività", emoji: "🛝" },
  { id: "spiritual", title: "Pensieri Spirituali e Serate", emoji: "ℹ️" },
];

function nowIso() {
  return new Date().toISOString();
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();

  return values
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function normalizeName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function isAdultCategory(value: unknown) {
  return value === "dirigente" || value === "accompagnatore";
}

function normalizeManualLeader(source: unknown, index: number): CampManualLeader {
  const data =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {};
  const timestamp = asString(data.updatedAt) || nowIso();

  return {
    id: asString(data.id) || `manual-leader-${index + 1}`,
    fullName: asString(data.fullName),
    linkedRegistrationId: asString(data.linkedRegistrationId) || null,
    createdAt: asString(data.createdAt) || timestamp,
    updatedAt: timestamp,
  };
}

function normalizeCommittee(
  definition: (typeof COMMITTEE_DEFINITIONS)[number],
  source: unknown,
  claimedRegistrationIds: Set<string>,
  claimedManualLeaderIds: Set<string>,
): CampCommitteePlan {
  const data =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {};
  const timestamp = asString(data.updatedAt) || nowIso();
  const leaderRegistrationIds: string[] = [];
  const memberRegistrationIds: string[] = [];
  const manualLeaderIds: string[] = [];

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
    updatedAt: timestamp,
  };
}

function normalizePatrol(
  source: unknown,
  index: number,
  claimedRegistrationIds: Set<string>,
): CampPatrolPlan {
  const data =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {};
  const timestamp = asString(data.updatedAt) || nowIso();
  const leaderRegistrationId = asString(data.leaderRegistrationId);
  const supervisorRegistrationIds: string[] = [];
  const memberRegistrationIds: string[] = [];
  const safeLeaderRegistrationId =
    leaderRegistrationId && !claimedRegistrationIds.has(leaderRegistrationId)
      ? leaderRegistrationId
      : "";

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
    updatedAt: timestamp,
  };
}

function normalizeCampManagement(data: Record<string, unknown> | null): CampManagementPlan {
  const timestamp = nowIso();
  const rawCommittees = Array.isArray(data?.committees) ? data.committees : [];
  const rawPatrols = Array.isArray(data?.patrols) ? data.patrols : [];
  const rawManualLeaders = Array.isArray(data?.manualLeaders) ? data.manualLeaders : [];
  const committeeById = new Map<CampCommitteeId, unknown>();

  for (const item of rawCommittees) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = (item as Record<string, unknown>).id;
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

  const claimedCommitteeRegistrationIds = new Set<string>();
  const claimedManualLeaderIds = new Set<string>();
  const claimedPatrolRegistrationIds = new Set<string>();

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
      .filter((leader) => leader.fullName.trim()),
    updatedAt: asString(data?.updatedAt) || timestamp,
  };
}

function getCampManagementReference(stakeId: string, eventId: string) {
  return doc(db, "stakes", stakeId, "activities", eventId, "management", "camp");
}

function getRegistrationsCollection(stakeId: string, eventId: string) {
  return collection(db, "stakes", stakeId, "activities", eventId, "registrations");
}

function buildPatrolAssignments(plan: CampManagementPlan) {
  const assignments = new Map<
    string,
    { patrolId: string; patrolName: string; role: CampPatrolRole }
  >();

  for (const patrol of plan.patrols) {
    const patrolName = patrol.name.trim();
    if (!patrol.id || !patrolName) continue;

    for (const registrationId of patrol.memberRegistrationIds) {
      assignments.set(registrationId, {
        patrolId: patrol.id,
        patrolName,
        role: "member",
      });
    }

    for (const registrationId of patrol.supervisorRegistrationIds) {
      assignments.set(registrationId, {
        patrolId: patrol.id,
        patrolName,
        role: "supervisor",
      });
    }

    if (patrol.leaderRegistrationId) {
      assignments.set(patrol.leaderRegistrationId, {
        patrolId: patrol.id,
        patrolName,
        role: "leader",
      });
    }
  }

  return assignments;
}

function buildCommitteeAssignments(plan: CampManagementPlan) {
  const assignments = new Map<string, CampCommitteeAssignment[]>();
  const manualLeaderById = new Map(plan.manualLeaders.map((leader) => [leader.id, leader]));

  function addAssignment(registrationId: string, assignment: CampCommitteeAssignment) {
    if (!registrationId) return;
    assignments.set(registrationId, [...(assignments.get(registrationId) ?? []), assignment]);
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

async function linkManualLeadersByName(stakeId: string, eventId: string, plan: CampManagementPlan) {
  const snapshot = await getDocs(getRegistrationsCollection(stakeId, eventId));
  const adultRegistrationIdByName = new Map<string, string>();

  for (const document of snapshot.docs) {
    const data = document.data();
    if (!isAdultCategory(data.genderRoleCategory)) continue;
    const fullName =
      typeof data.fullName === "string"
        ? data.fullName
        : [asString(data.firstName), asString(data.lastName)].filter(Boolean).join(" ");
    const normalized = normalizeName(fullName);
    if (normalized && !adultRegistrationIdByName.has(normalized)) {
      adultRegistrationIdByName.set(normalized, document.id);
    }
  }

  return {
    registrationsSnapshot: snapshot,
    plan: {
      ...plan,
      manualLeaders: plan.manualLeaders.map((leader) => ({
        ...leader,
        linkedRegistrationId: adultRegistrationIdByName.get(normalizeName(leader.fullName)) ?? null,
      })),
    },
  };
}

async function syncRegistrationCampAssignments(
  registrationsSnapshot: Awaited<ReturnType<typeof getDocs>>,
  plan: CampManagementPlan,
  timestamp: string,
) {
  const patrolAssignments = buildPatrolAssignments(plan);
  const committeeAssignments = buildCommitteeAssignments(plan);

  for (let start = 0; start < registrationsSnapshot.docs.length; start += 450) {
    const batch = writeBatch(db);

    for (const document of registrationsSnapshot.docs.slice(start, start + 450)) {
      const patrolAssignment = patrolAssignments.get(document.id);

      batch.update(document.ref, {
        assignedPatrolId: patrolAssignment?.patrolId ?? null,
        assignedPatrolName: patrolAssignment?.patrolName ?? null,
        assignedPatrolRole: patrolAssignment?.role ?? null,
        assignedCommittees: committeeAssignments.get(document.id) ?? [],
        updatedAt: timestamp,
      });
    }

    await batch.commit();
  }
}

export const campManagementService = {
  getDefaultCampManagement(): CampManagementPlan {
    return normalizeCampManagement(null);
  },

  async getCampManagement(stakeId: string, eventId: string): Promise<CampManagementPlan> {
    const snapshot = await getDoc(getCampManagementReference(stakeId, eventId));
    return normalizeCampManagement(snapshot.exists() ? snapshot.data() : null);
  },

  async saveCampManagement(
    stakeId: string,
    eventId: string,
    input: CampManagementPlan,
  ): Promise<CampManagementPlan> {
    const timestamp = nowIso();
    const normalized = normalizeCampManagement({
      ...input,
      updatedAt: timestamp,
      committees: input.committees.map((committee) => ({
        ...committee,
        title: committee.title.trim(),
        leaderRegistrationIds: uniqueStrings(committee.leaderRegistrationIds),
        manualLeaderIds: uniqueStrings(committee.manualLeaderIds),
        memberRegistrationIds: uniqueStrings(committee.memberRegistrationIds),
        updatedAt: timestamp,
      })),
      patrols: input.patrols.map((patrol, index) => ({
        ...patrol,
        id: patrol.id.trim() || `patrol-${index + 1}`,
        name: patrol.name.trim() || `Pattuglia ${index + 1}`,
        supervisorRegistrationIds: uniqueStrings(patrol.supervisorRegistrationIds),
        memberRegistrationIds: uniqueStrings(patrol.memberRegistrationIds),
        updatedAt: timestamp,
      })),
      manualLeaders: input.manualLeaders.map((leader, index) => ({
        ...leader,
        id: leader.id.trim() || `manual-leader-${index + 1}`,
        fullName: leader.fullName.trim(),
        updatedAt: timestamp,
      })),
    });
    const linked = await linkManualLeadersByName(stakeId, eventId, normalized);

    await setDoc(
      getCampManagementReference(stakeId, eventId),
      {
        ...linked.plan,
        savedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await syncRegistrationCampAssignments(linked.registrationsSnapshot, linked.plan, timestamp);

    return linked.plan;
  },
};
