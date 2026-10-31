const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { isAdultByAge } = require("./adultAge");
const {
  normalizeCampConfiguration,
  assertCampRevision,
  nextCampRevision,
  readPlanFormat,
  assertLegacyPlanEditable,
  isHistoricCommitteeId,
  isValidCommitteeId,
  CampConfigurationError,
} = require("./campConfiguration");

const REGION = "europe-west1";

// Default dei piani nuovi e titolo/emoji di ripiego dei cinque comitati storici.
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
    // I comitati nuovi (`c_…`) non hanno emoji: la UI mostra le iniziali.
    emoji: isHistoricCommitteeId(definition.id) ? asString(data.emoji) || definition.emoji : "",
    responsibilities: asString(data.responsibilities),
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

function committeeDefinition(id) {
  return COMMITTEE_DEFINITIONS.find((definition) => definition.id === id) || { id, title: "", emoji: "" };
}

// Payload dei client precedenti: solo i cinque comitati storici, nell'ordine di
// sempre; a parità di ID vince l'ultimo, quelli mancanti tornano ai default.
function historicCommittees(committees) {
  const committeeById = new Map();
  for (const item of Array.isArray(committees) ? committees : []) {
    if (ownObject(item) && isHistoricCommitteeId(item.id)) committeeById.set(item.id, item);
  }
  return COMMITTEE_DEFINITIONS.map((definition) => committeeById.get(definition.id) || { id: definition.id });
}

function normalizeCampManagement(source) {
  const data =
    source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const timestamp = nowIso();
  // Senza elenco salvato il piano parte dai cinque comitati storici.
  const rawCommittees = Array.isArray(data.committees)
    ? data.committees
    : COMMITTEE_DEFINITIONS.map((definition) => ({ id: definition.id }));
  const rawPatrols = Array.isArray(data.patrols) ? data.patrols : [];
  const rawManualLeaders = Array.isArray(data.manualLeaders) ? data.manualLeaders : [];
  const committeeIds = new Set();
  const committees = rawCommittees.filter((item) => {
    if (!ownObject(item) || !isValidCommitteeId(item.id) || committeeIds.has(item.id)) return false;
    committeeIds.add(item.id);
    return true;
  });

  const claimedCommitteeRegistrationIds = new Set();
  const claimedManualLeaderIds = new Set();
  const claimedPatrolRegistrationIds = new Set();
  const claimedPatrolManualSupervisorIds = new Set();

  return {
    groupLabel: data.groupLabel || "pattuglia",
    committees: committees.map((item) =>
      normalizeCommittee(
        committeeDefinition(item.id),
        item,
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

// Voci comitato per iscrizione nell'ordine dell'elenco: guide, dirigenti manuali
// collegati per nome, membri. Gli ID diretti sono già unici fra i comitati; il
// collegamento per nome può invece portare la stessa iscrizione in un secondo.
function committeeEntries(plan) {
  const manualLeaderById = new Map(plan.manualLeaders.map((leader) => [leader.id, leader]));
  const entries = [];

  for (const committee of plan.committees) {
    for (const registrationId of committee.leaderRegistrationIds) {
      entries.push({ registrationId, committee, role: "leader" });
    }
    for (const manualLeaderId of committee.manualLeaderIds) {
      const leader = manualLeaderById.get(manualLeaderId);
      if (!leader?.linkedRegistrationId) continue;
      entries.push({ registrationId: leader.linkedRegistrationId, committee, role: "leader", manualLeader: leader });
    }
    for (const registrationId of committee.memberRegistrationIds) {
      entries.push({ registrationId, committee, role: "member" });
    }
  }

  return entries.filter((entry) => entry.registrationId);
}

// Una persona sta in un solo comitato: nella proiezione vale la prima voce
// nell'ordine dell'elenco, anche per i payload dei client precedenti.
function buildCommitteeAssignments(plan) {
  const assignments = new Map();

  for (const { registrationId, committee, role } of committeeEntries(plan)) {
    if (assignments.has(registrationId)) continue;
    assignments.set(registrationId, [{ id: committee.id, title: committee.title, role }]);
  }

  return assignments;
}

// Formato 2: la stessa iscrizione in due comitati diversi (anche tramite un
// dirigente manuale collegato per nome) rifiuta il salvataggio.
function assertSingleCommittee(registrationsSnapshot, plan) {
  const firstByRegistrationId = new Map();

  for (const entry of committeeEntries(plan)) {
    const first = firstByRegistrationId.get(entry.registrationId);
    if (!first) {
      firstByRegistrationId.set(entry.registrationId, entry);
      continue;
    }
    if (first.committee.id === entry.committee.id) continue;

    const registration = registrationsSnapshot.docs.find((document) => document.id === entry.registrationId);
    const name =
      getPublicName(registration ? registration.data() || {} : {}) ||
      asString((first.manualLeader || entry.manualLeader)?.fullName).trim() ||
      "Una persona";
    throw new HttpsError(
      "invalid-argument",
      `${name} è in due comitati: ${first.committee.title} e ${entry.committee.title}. Togli una delle due assegnazioni e salva di nuovo.`,
    );
  }
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

// Comitati e gruppi su ogni tipo di attività: admin e dirigenti di unità del palo
// ovunque, lo staff in elenco solo se l'attività è un campeggio (l'elenco dà
// accesso ai dati sanitari ed è scelto per il campeggio).
function resolvePlanAccess({ activityType, ...input }) {
  const access = resolveCampAccess(input);
  return access === "listed" && activityType !== "camp" ? null : access;
}

function activityTypeOf(snapshot) {
  return snapshot && snapshot.exists ? (snapshot.data() || {}).activityType : undefined;
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
  const [userDoc, activity] = await Promise.all([db.doc(`users/${uid}`).get(), refs.activityRef.get()]);
  const profile = userDoc.exists ? userDoc.data() || {} : null;
  const activityType = activityTypeOf(activity);
  const direct = resolvePlanAccess({ profile, stakeId, uid, activityType });
  if (direct) return { access: direct, refs, activity };
  if (activityType !== "camp") return { access: null, refs, activity };

  const staffSnap = await refs.staff.get();
  const staffUids = staffUidsOf(staffSnap.exists ? staffSnap.data() : null);
  if (!staffUids.includes(uid)) return { access: null, refs, activity };
  const registrationSnap = await refs.registrations.doc(`user_${uid}`).get();
  return {
    access: resolvePlanAccess({
      profile,
      stakeId,
      uid,
      activityType,
      staffUids,
      ownRegistration: registrationSnap.exists ? registrationSnap.data() : null,
    }),
    refs,
    activity,
  };
}

async function assertCampManager(db, request, stakeId, activityId) {
  const loaded = await loadCampAccess(db, request, stakeId, activityId);
  if (!loaded.access) {
    throw new HttpsError("permission-denied", "Servono privilegi comitato/pattuglia.");
  }
  return loaded;
}

// Rilegge ruolo, elenco staff e tipo dell'attività nella transazione: una revoca
// (o un cambio di tipo che toglie lo staff in elenco) blocca la scrittura.
async function assertTransactionalCampManager(transaction, db, request, stakeId, activityId) {
  assertSignedIn(request);
  const uid = request.auth.uid;
  const refs = campRefs(db, stakeId, activityId);
  const [profile, staff, registration, activity] = await Promise.all([
    transaction.get(db.doc(`users/${uid}`)),
    transaction.get(refs.staff),
    transaction.get(refs.registrations.doc(`user_${uid}`)),
    transaction.get(refs.activityRef),
  ]);
  const access = resolvePlanAccess({
    profile: profile.exists ? profile.data() : null,
    stakeId, uid,
    activityType: activityTypeOf(activity),
    staffUids: staffUidsOf(staff.exists ? staff.data() : null),
    ownRegistration: registration.exists ? registration.data() : null,
  });
  if (!access) throw new HttpsError("permission-denied", "Non hai più il permesso di modificare questo piano.");
  return { access, activity };
}

async function syncRegistrationCampAssignments(db, registrationsSnapshot, plan, timestamp, request, stakeId, activityId) {
  const patrolAssignments = buildPatrolAssignments(plan);
  const committeeAssignments = buildCommitteeAssignments(plan);
  const planRef = db.doc(`stakes/${stakeId}/activities/${activityId}/management/camp`);

  for (let start = 0; start < registrationsSnapshot.docs.length; start += 400) {
    const documents = registrationsSnapshot.docs.slice(start, start + 400);
    await db.runTransaction(async (transaction) => {
      await assertTransactionalCampManager(transaction, db, request, stakeId, activityId);
      const current = await transaction.get(planRef);
      assertCampRevision(timestamp, current.exists ? current.data() : null);
      // Re-read before updating: a registration deleted while saving stays deleted.
      const live = await transaction.getAll(...documents.map((document) => document.ref));
      for (const document of live) {
        if (!document.exists) continue;
        const patrolAssignment = patrolAssignments.get(document.id) || {};
        transaction.update(document.ref, {
          assignedPatrolId: patrolAssignment.assignedPatrolId || null,
          assignedPatrolName: patrolAssignment.assignedPatrolName || null,
          assignedPatrolRole: patrolAssignment.assignedPatrolRole || null,
          assignedCommittees: committeeAssignments.get(document.id) || [],
          updatedAt: timestamp,
        });
      }
    });
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
    let planFormat;
    try {
      planFormat = readPlanFormat(request.data);
    } catch (error) {
      if (error instanceof CampConfigurationError) throw new HttpsError(error.code, error.message);
      throw error;
    }

    const { refs, activity: activitySnapshot } = await assertCampManager(db, request, stakeId, activityId);
    if (!activitySnapshot.exists) {
      throw new HttpsError("not-found", "Attività non trovata.");
    }

    const activityRef = refs.activityRef;
    const planRef = activityRef.collection("management").doc("camp");
    const registrationsSnapshot = await activityRef.collection("registrations").get();
    let publicPlan;
    try {
      publicPlan = await db.runTransaction(async (transaction) => {
        const { activity: currentActivity } = await assertTransactionalCampManager(transaction, db, request, stakeId, activityId);
        const saved = await transaction.get(planRef);
        if (!currentActivity.exists) {
          throw new HttpsError("not-found", "Attività non trovata.");
        }
        const activityType = activityTypeOf(currentActivity);
        const previous = saved.exists ? saved.data() : null;
        if (planFormat !== 2) assertLegacyPlanEditable(activityType, previous);
        assertCampRevision(request.data?.expectedUpdatedAt, previous);
        const timestamp = nextCampRevision(previous?.updatedAt);
        const input = request.data?.plan === undefined ? {} : request.data.plan;
        const configured = normalizeCampConfiguration(input, previous || {}, {
          planFormat,
          defaultGroupLabel: activityType === "camp" ? "pattuglia" : "gruppo",
        });
        const normalized = normalizeCampManagement({
          ...configured,
          committees: planFormat === 2 ? configured.committees : historicCommittees(configured.committees),
          updatedAt: timestamp,
        });
        const linked = linkManualLeadersByName(registrationsSnapshot, normalized);
        if (planFormat === 2) assertSingleCommittee(registrationsSnapshot, linked);
        const plan = attachPublicMembers(registrationsSnapshot, linked);
        transaction.set(planRef, { ...plan, savedAt: FieldValue.serverTimestamp() }, { merge: true });
        return plan;
      });
      await syncRegistrationCampAssignments(db, registrationsSnapshot, publicPlan, publicPlan.updatedAt, request, stakeId, activityId);
    } catch (error) {
      if (publicPlan) {
        logger.error("Camp assignment sync incomplete.", { stakeId, activityId, code: String(error?.code || "unknown") });
        throw new HttpsError(
          error instanceof CampConfigurationError || error instanceof HttpsError ? error.code : "unavailable",
          "Il piano è salvato, ma alcune assegnazioni potrebbero non essere aggiornate. Ricarica il piano salvato, controlla le persone e salva di nuovo.",
          { planSaved: true, updatedAt: publicPlan.updatedAt },
        );
      }
      if (error instanceof CampConfigurationError) throw new HttpsError(error.code, error.message);
      throw error;
    }

    logger.info("Camp management saved.", {
      stakeId,
      activityId,
      uid: request.auth.uid,
      planFormat,
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

const MAX_ROSTER_REGISTRATIONS = 2000;

// Voce dell'elenco nomi per assegnare comitati e gruppi: solo nome, categoria,
// unità e stato. Mai data di nascita, risposte, dati sanitari, contatti o uid.
function toRosterEntry(id, data) {
  return {
    id,
    firstName: asString(data.firstName),
    lastName: asString(data.lastName),
    fullName: getPublicName(data),
    genderRoleCategory: asGenderRoleCategory(data.genderRoleCategory),
    unitName: getPublicUnitName(data),
    registrationStatus: asString(data.registrationStatus),
    status: asString(data.status),
  };
}

async function listRosterRegistrations(refs) {
  // Proiezione: il server non carica nemmeno risposte e dati sanitari.
  const snapshot = await refs.registrations
    .select("firstName", "lastName", "fullName", "genderRoleCategory", "unitName", "unitNameSnapshot", "registrationStatus", "status")
    .limit(MAX_ROSTER_REGISTRATIONS + 1)
    .get();
  if (snapshot.size > MAX_ROSTER_REGISTRATIONS) {
    throw new HttpsError("failed-precondition", "L'attività ha più di 2.000 iscrizioni: l'elenco dei nomi non è disponibile.");
  }
  return snapshot.docs
    .filter((document) => isRosterRegistration(document.data()))
    .map((document) => toRosterEntry(document.id, document.data() || {}));
}

// Stessa idea dell'editor admin: annullata se lo dice `registrationStatus` o il
// vecchio `status`; un'iscrizione legacy senza `registrationStatus` resta attiva.
function isRosterRegistration(registration) {
  return ownObject(registration)
    && registration.registrationStatus !== "cancelled"
    && registration.status !== "cancelled";
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
    if (!["context", "list", "set", "roster"].includes(action)) {
      throw new HttpsError("invalid-argument", "Azione non valida.");
    }

    const { access, refs, activity: activitySnapshot } = await loadCampAccess(db, request, stakeId, activityId);
    // Nomi per assegnare comitati e gruppi: chi può salvare il piano, su ogni tipo.
    if (action === "roster") {
      if (!access) {
        throw new HttpsError("permission-denied", "Servono privilegi comitato/pattuglia.");
      }
      if (!activitySnapshot.exists) {
        throw new HttpsError("not-found", "Attività non trovata.");
      }
      return { ok: true, registrations: await listRosterRegistrations(refs) };
    }
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
  resolvePlanAccess,
  nextStaffUids,
  isAdultByAge,
  normalizeCampManagement,
  historicCommittees,
  buildCommitteeAssignments,
  assertSingleCommittee,
  toRosterEntry,
};
