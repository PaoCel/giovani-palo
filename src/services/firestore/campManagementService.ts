import {
  getDefaultCampGroupLabel,
  isValidCommitteeId,
  normalizeCampGroupLabel,
} from "@/utils/campGroups";
import { getDocFromServer, doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/services/firebase/app";
import { getDocCacheFirst } from "@/services/firestore/cacheFirst";
import type {
  ActivityType,
  CampCommitteeId,
  CampCommitteePlan,
  CampManagementPlan,
  CampManualLeader,
  CampPatrolPlan,
  CampPublicMember,
  CampRosterEntry,
  GenderRoleCategory,
  RegistrationStatus,
} from "@/types";

// I cinque comitati con cui parte ogni attività senza piano salvato. Sono
// rinominabili ed eliminabili; i comitati aggiunti dopo non hanno emoji.
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

interface CampManagementSaveResult {
  ok: boolean;
  plan: CampManagementPlan;
  registrationsSynced: number;
}

// Formato 2: `plan.committees` è l'elenco completo (un comitato omesso è
// eliminato) ed `expectedUpdatedAt` è la revisione vista, anche null.
const campManagementSaveCallable = httpsCallable<
  {
    stakeId: string;
    activityId: string;
    plan: CampManagementPlan;
    expectedUpdatedAt: string | null;
    planFormat: 2;
  },
  CampManagementSaveResult
>(functions, "campManagementSave");

export interface CampStaffCandidate {
  uid: string;
  registrationId: string;
  name: string;
  unitName: string;
  isAdult: boolean;
  isStaff: boolean;
}

export interface CampStaffContext {
  isStaff: boolean;
  canManageStaff: boolean;
}

interface CampStaffResult {
  ok: boolean;
  isStaff?: boolean;
  canManageStaff?: boolean;
  candidates?: unknown;
  staffUids?: unknown;
  registrations?: unknown;
}

const campManagementStaffCallable = httpsCallable<
  Record<string, unknown>,
  CampStaffResult
>(functions, "campManagementStaff");

function mapCampStaffCandidate(value: unknown): CampStaffCandidate | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const uid = asString(item.uid);
  if (!uid) return null;
  return {
    uid,
    registrationId: asString(item.registrationId),
    name: asString(item.name) || uid,
    unitName: asString(item.unitName),
    isAdult: item.isAdult === true,
    isStaff: item.isStaff === true,
  };
}

const REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  "draft",
  "submitted",
  "confirmed",
  "waitlist",
  "active",
  "cancelled",
  "pending_parent_authorization",
  "rejected_by_parent",
];

function mapRosterEntry(value: unknown): CampRosterEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = asString(item.id);
  if (!id) return null;
  const firstName = asString(item.firstName).trim();
  const lastName = asString(item.lastName).trim();
  const registrationStatus = REGISTRATION_STATUSES.find((status) => status === item.registrationStatus) ?? "active";
  return {
    id,
    firstName,
    lastName,
    fullName: asString(item.fullName).trim() || [firstName, lastName].filter(Boolean).join(" "),
    genderRoleCategory: asGenderRoleCategory(item.genderRoleCategory),
    unitName: asString(item.unitName).trim(),
    registrationStatus,
    status: item.status === "cancelled" || registrationStatus === "cancelled" ? "cancelled" : "active",
  };
}

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

function asGenderRoleCategory(value: unknown): GenderRoleCategory | "" {
  return value === "giovane_uomo" ||
    value === "giovane_donna" ||
    value === "dirigente" ||
    value === "accompagnatore"
    ? value
    : "";
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

function normalizePublicMember(
  source: unknown,
  roleByRegistrationId: Map<string, CampPublicMember["role"]>,
): CampPublicMember | null {
  const data =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {};
  const registrationId = asString(data.registrationId);
  const role = roleByRegistrationId.get(registrationId);
  const fullName = asString(data.fullName).trim();

  if (!registrationId || !role || !fullName) {
    return null;
  }

  return {
    registrationId,
    fullName,
    genderRoleCategory: asGenderRoleCategory(data.genderRoleCategory),
    unitName: asString(data.unitName).trim(),
    role,
  };
}

function normalizePublicMembers(
  source: unknown,
  roleByRegistrationId: Map<string, CampPublicMember["role"]>,
) {
  const rawMembers = Array.isArray(source) ? source : [];
  const seen = new Set<string>();

  return rawMembers
    .map((member) => normalizePublicMember(member, roleByRegistrationId))
    .filter((member): member is CampPublicMember => {
      if (!member || seen.has(member.registrationId)) return false;
      seen.add(member.registrationId);
      return true;
    });
}

function normalizeCommittee(
  definition: { id: CampCommitteeId; title: string; emoji: string },
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
  const roleByRegistrationId = new Map<string, CampPublicMember["role"]>();

  for (const registrationId of uniqueStrings(asStringArray(data.leaderRegistrationIds))) {
    if (claimedRegistrationIds.has(registrationId)) continue;
    claimedRegistrationIds.add(registrationId);
    leaderRegistrationIds.push(registrationId);
    roleByRegistrationId.set(registrationId, "leader");
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
    roleByRegistrationId.set(registrationId, "member");
  }

  return {
    id: definition.id,
    title: asString(data.title) || definition.title,
    emoji: asString(data.emoji) || definition.emoji,
    responsibilities: asString(data.responsibilities),
    leaderRegistrationIds,
    manualLeaderIds,
    memberRegistrationIds,
    publicMembers: normalizePublicMembers(data.publicMembers, roleByRegistrationId),
    updatedAt: timestamp,
  };
}

function normalizePatrol(
  source: unknown,
  index: number,
  claimedRegistrationIds: Set<string>,
  claimedManualSupervisorIds: Set<string>,
): CampPatrolPlan {
  const data =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {};
  const timestamp = asString(data.updatedAt) || nowIso();
  const leaderRegistrationId = asString(data.leaderRegistrationId);
  const supervisorRegistrationIds: string[] = [];
  const manualSupervisorIds: string[] = [];
  const memberRegistrationIds: string[] = [];
  const roleByRegistrationId = new Map<string, CampPublicMember["role"]>();
  const safeLeaderRegistrationId =
    leaderRegistrationId && !claimedRegistrationIds.has(leaderRegistrationId)
      ? leaderRegistrationId
      : "";

  if (safeLeaderRegistrationId) {
    claimedRegistrationIds.add(safeLeaderRegistrationId);
    roleByRegistrationId.set(safeLeaderRegistrationId, "leader");
  }

  for (const registrationId of uniqueStrings(asStringArray(data.supervisorRegistrationIds))) {
    if (claimedRegistrationIds.has(registrationId)) continue;
    claimedRegistrationIds.add(registrationId);
    supervisorRegistrationIds.push(registrationId);
    roleByRegistrationId.set(registrationId, "supervisor");
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
    roleByRegistrationId.set(registrationId, "member");
  }

  return {
    id: asString(data.id) || `patrol-${index + 1}`,
    name: asString(data.name) || `Pattuglia ${index + 1}`,
    leaderRegistrationId: safeLeaderRegistrationId,
    supervisorRegistrationIds,
    manualSupervisorIds,
    memberRegistrationIds,
    publicMembers: normalizePublicMembers(data.publicMembers, roleByRegistrationId),
    updatedAt: timestamp,
  };
}

// Documento assente: i cinque comitati storici con incarico vuoto e la
// denominazione del tipo di attività. Documento presente: l'elenco salvato,
// nell'ordine salvato, anche vuoto; si scartano solo ID non validi o ripetuti.
// Un documento senza l'elenco (piani storici) riparte dai cinque.
function normalizeCampManagement(
  data: Record<string, unknown> | null,
  activityType?: ActivityType | null,
): CampManagementPlan {
  const rawCommittees = Array.isArray(data?.committees) ? data.committees : null;
  const rawPatrols = Array.isArray(data?.patrols) ? data.patrols : [];
  const rawManualLeaders = Array.isArray(data?.manualLeaders) ? data.manualLeaders : [];
  const historicById = new Map(COMMITTEE_DEFINITIONS.map((definition) => [definition.id, definition]));
  const committeeSources: Array<{ id: CampCommitteeId; source: unknown }> = [];

  if (rawCommittees) {
    const seen = new Set<string>();
    for (const item of rawCommittees) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const id = (item as Record<string, unknown>).id;
      if (!isValidCommitteeId(id) || seen.has(id)) continue;
      seen.add(id);
      committeeSources.push({ id, source: item });
    }
  } else {
    for (const definition of COMMITTEE_DEFINITIONS) {
      committeeSources.push({ id: definition.id, source: null });
    }
  }

  const claimedCommitteeRegistrationIds = new Set<string>();
  const claimedManualLeaderIds = new Set<string>();
  const claimedPatrolRegistrationIds = new Set<string>();
  const claimedPatrolManualSupervisorIds = new Set<string>();

  return {
    groupLabel: normalizeCampGroupLabel(
      data?.groupLabel,
      data ? "pattuglia" : getDefaultCampGroupLabel(activityType),
    ),
    committees: committeeSources.map(({ id, source }) =>
      normalizeCommittee(
        historicById.get(id) ?? { id, title: "", emoji: "" },
        source,
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
      .filter((leader) => leader.fullName.trim()),
    updatedAt: asString(data?.updatedAt),
  };
}

function getCampManagementReference(stakeId: string, eventId: string) {
  return doc(db, "stakes", stakeId, "activities", eventId, "management", "camp");
}

async function readSavedCampManagement(
  stakeId: string,
  eventId: string,
  serverOnly: boolean,
): Promise<CampManagementPlan | null> {
  const reference = getCampManagementReference(stakeId, eventId);
  const snapshot = await (serverOnly ? getDocFromServer(reference) : getDocCacheFirst(reference));
  return snapshot.exists() ? normalizeCampManagement(snapshot.data()) : null;
}

export function getCampStaffErrorMessage(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: string; message?: unknown };
  if (
    (code === "functions/failed-precondition" || code === "functions/permission-denied") &&
    typeof message === "string" &&
    message.trim()
  ) {
    return message;
  }
  return "Non è stato possibile completare l'operazione. Controlla la connessione e riprova.";
}

export const campManagementService = {
  // Chi gestisce il campeggio lo decide il server (admin, dirigenti di unità,
  // elenco scelto da un admin): la categoria del profilo è autodichiarata.
  async getStaffContext(stakeId: string, eventId: string): Promise<CampStaffContext> {
    const result = await campManagementStaffCallable({
      stakeId,
      activityId: eventId,
      action: "context",
    });
    return {
      isStaff: result.data.isStaff === true,
      canManageStaff: result.data.canManageStaff === true,
    };
  },

  async listStaff(stakeId: string, eventId: string): Promise<CampStaffCandidate[]> {
    const result = await campManagementStaffCallable({
      stakeId,
      activityId: eventId,
      action: "list",
    });
    return Array.isArray(result.data.candidates)
      ? result.data.candidates
          .map(mapCampStaffCandidate)
          .filter((item): item is CampStaffCandidate => item !== null)
      : [];
  },

  async setStaff(
    stakeId: string,
    eventId: string,
    uid: string,
    enabled: boolean,
  ): Promise<string[]> {
    const result = await campManagementStaffCallable({
      stakeId,
      activityId: eventId,
      action: "set",
      uid,
      enabled,
    });
    return asStringArray(result.data.staffUids);
  },

  // Nomi per assegnare persone a comitati e gruppi, per chi può salvare il
  // piano su ogni tipo di attività: solo i campi elencati in CampRosterEntry,
  // mai l'elenco completo delle iscrizioni.
  async getRoster(stakeId: string, eventId: string): Promise<CampRosterEntry[]> {
    const result = await campManagementStaffCallable({
      stakeId,
      activityId: eventId,
      action: "roster",
    });
    return Array.isArray(result.data.registrations)
      ? result.data.registrations
          .map(mapRosterEntry)
          .filter((item): item is CampRosterEntry => item !== null)
      : [];
  },

  getDefaultCampManagement(activityType?: ActivityType | null): CampManagementPlan {
    return normalizeCampManagement(null, activityType);
  },

  // Il piano salvato, oppure null se il documento non esiste: chi deve
  // distinguere un piano mai salvato dai valori predefiniti (scheda personale
  // fuori dal campeggio) parte da qui.
  async getSavedCampManagement(
    stakeId: string,
    eventId: string,
    serverOnly = false,
  ): Promise<CampManagementPlan | null> {
    return readSavedCampManagement(stakeId, eventId, serverOnly);
  },

  async getCampManagement(
    stakeId: string,
    eventId: string,
    serverOnly = false,
    activityType?: ActivityType | null,
  ): Promise<CampManagementPlan> {
    const saved = await readSavedCampManagement(stakeId, eventId, serverOnly);
    return saved ?? normalizeCampManagement(null, activityType);
  },

  async saveCampManagement(
    stakeId: string,
    eventId: string,
    input: CampManagementPlan,
  ): Promise<CampManagementPlan> {
    const result = await campManagementSaveCallable({
      stakeId,
      activityId: eventId,
      plan: input,
      expectedUpdatedAt: input.updatedAt || null,
      planFormat: 2,
    });

    return normalizeCampManagement(result.data.plan as unknown as Record<string, unknown>);
  },
};
