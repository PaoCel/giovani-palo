import { RoomManagementPanel } from "@/components/admin/RoomManagementPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { AppIcon } from "@/components/AppIcon";
import { ANNULLA } from "@/copy/annulla";
import { ADMIN } from "@/copy/admin";
import { ISCRITTI } from "@/copy/iscritti";
import { fillCopy } from "@/copy/parole";
import { AppModal } from "@/components/AppModal";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { EmptyState } from "@/components/EmptyState";
import { PhotoConsentPills } from "@/components/PhotoConsentPills";
import { RegistrationExcelExportModal } from "@/components/RegistrationExcelExportModal";
import { ShareButton } from "@/components/ShareButton";
import { StatusBadge } from "@/components/StatusBadge";
import { SurveyEditor } from "@/components/SurveyEditor";
import { SurveyResultsPanel } from "@/components/SurveyResultsPanel";
import { CampStaffSection } from "@/components/admin/CampStaffSection";
import { AddManualRegistrationSheet } from "@/components/admin/registrations/AddManualRegistrationSheet";
import { EditRegistrationSheet } from "@/components/admin/registrations/EditRegistrationSheet";
import {
  DEFAULT_REGISTRATION_FILTERS,
  RegistrationsTab,
  type RegistrationFilters,
} from "@/components/admin/registrations/RegistrationsTab";
import { RequestAuthorizationSheet } from "@/components/admin/registrations/RequestAuthorizationSheet";
import {
  getCategoryShortLabel,
  getUnitLabel,
} from "@/components/admin/registrations/registrationLabels";
import { ModalFeedback } from "@/components/admin/ModalFeedback";
import { GalleryAdminTab } from "@/components/admin/gallery/GalleryAdminTab";
import { RecordNightAdminTab } from "@/components/admin/recordNight/RecordNightAdminTab";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { storageService } from "@/services/firebase/storageService";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import { campManagementService } from "@/services/firestore/campManagementService";
import { eventsService } from "@/services/firestore/eventsService";
import { organizationService } from "@/services/firestore/organizationService";
import { questionsService } from "@/services/firestore/questionsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { usersService } from "@/services/firestore/usersService";
import {
  parentAuthorizationService,
  type ConsentCompletionCandidate,
  type ConsentCompletionResult,
} from "@/services/firestore/parentAuthorizationService";
import type {
  CampCommitteeId,
  CampManagementPlan,
  CampPatrolPlan,
  CampPatrolRole,
  Question,
  Registration,
} from "@/types";
import { getAbsoluteUrl, getActivityPath } from "@/utils/activityLinks";
import { getAdminActionError } from "@/utils/adminErrors";
import {
  isManualRegistration,
  isMissingParentEmail,
  planAdminReactivate,
} from "@/utils/adminRegistration";
import { isOffline, withWriteTimeout } from "@/utils/writeTimeout";
import { formatDateOnly, formatDateRange, formatDateTime } from "@/utils/formatters";
import {
  downloadCampManagementExcel,
  downloadRegistrationsExcel,
  downloadYouthRegistrantsExcel,
  type ExportOptions,
} from "@/utils/registrationExcel";
import {
  getRegistrationDisplayName,
  getRoomPreferenceEntries,
} from "@/utils/roomPreferences";
import {
  getEffectiveEventStatus,
  getEventAudienceLabel,
  getEventStatusLabel,
  getEventStatusTone,
  isCampEvent,
} from "@/utils/events";
import { getPhotoConsentBadges } from "@/utils/parentAuthorization";
import { getGenderRoleCategoryLabel } from "@/utils/profile";
import {
  getRegistrationAnswerEntries,
  getRegistrationHighlights,
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";
import { DEFAULT_STAKE_ID } from "@/config/app";

type AdminEventTab =
  | "details"
  | "committees"
  | "registrations"
  | "consents"
  | "overnight"
  | "questions"
  | "records"
  | "surveys"
  | "gallery"
  | "stats";
type RegistrationModalMode = "registration" | "overnight";

interface DistributionItem {
  label: string;
  count: number;
  percent: number;
}

const sharedRegistrationEntryKeys = new Set([
  "birthDate",
  "genderRoleCategory",
  "unitName",
  "youthGroup",
]);

const roomRegistrationEntryKeys = new Set([
  "roomPreference1Name",
  "roomPreference2Name",
  "roomNotes",
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getPatrolRoleLabel(role: CampPatrolRole | null) {
  switch (role) {
    case "leader":
      return "Capo pattuglia";
    case "supervisor":
      return "Supervisore";
    case "member":
      return "Membro";
    default:
      return "";
  }
}

function createLocalId(prefix: string) {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}`;
}

function buildDistribution<T>(
  items: T[],
  getLabel: (item: T) => string,
  fallbackLabel: string,
) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const rawLabel = getLabel(item).trim();
    const label = rawLabel || fallbackLabel;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const total = items.length || 1;

  return [...counts.entries()]
    .sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0], "it"),
    )
    .map<DistributionItem>(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / total) * 100),
    }));
}

function getAgeFromBirthDate(value: string) {
  if (!value) {
    return null;
  }

  const birthDate = new Date(value);

  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() &&
      today.getDate() >= birthDate.getDate());

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

function getAverageAge(registrations: Registration[]) {
  const ages = registrations
    .map((registration) => getAgeFromBirthDate(registration.birthDate))
    .filter((value): value is number => value !== null);

  if (ages.length === 0) {
    return null;
  }

  const total = ages.reduce((sum, age) => sum + age, 0);
  return Math.round((total / ages.length) * 10) / 10;
}

function getCategoryLabel(registration: Registration) {
  return (
    getGenderRoleCategoryLabel(registration.genderRoleCategory) ||
    "Organizzazione non indicata"
  );
}

function isMinorRegistration(registration: Registration) {
  const age = getAgeFromBirthDate(registration.birthDate);
  return age !== null && age < 18;
}

function getParentAuthorizationRequest(registration: Registration) {
  const request = (registration.answers as Record<string, unknown>)
    .parentAuthorizationRequest;

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return null;
  }

  return request as Record<string, unknown>;
}

function getParentEmail(registration: Registration) {
  const request = getParentAuthorizationRequest(registration);
  const requestEmail = request?.parentEmail;

  return (
    registration.parentAuthorization?.parentEmail ||
    (typeof requestEmail === "string" ? requestEmail : "")
  );
}

function getParentName(registration: Registration) {
  const request = getParentAuthorizationRequest(registration);
  const firstName =
    registration.parentAuthorization?.parentFirstName ||
    (typeof request?.parentFirstName === "string"
      ? request.parentFirstName
      : "");
  const lastName =
    registration.parentAuthorization?.parentLastName ||
    (typeof request?.parentLastName === "string" ? request.parentLastName : "");

  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function getParentAuthorizationBadge(
  registration: Registration,
  required: boolean,
): {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
} {
  if (!required) {
    return { label: "Email non richiesta", tone: "neutral" };
  }

  const status = registration.parentAuthorization?.status ?? "missing";

  if (status === "authorized") {
    return { label: "Email OK", tone: "success" };
  }

  if (status === "rejected_by_parent") {
    return { label: "Rifiutata", tone: "danger" };
  }

  if (status === "email_error") {
    return { label: "Errore email", tone: "danger" };
  }

  if (status === "expired") {
    return { label: "Scaduta", tone: "warning" };
  }

  if (status === "email_sent" || status === "pending_parent_authorization") {
    return { label: "In attesa", tone: "warning" };
  }

  return { label: "Email mancante", tone: "warning" };
}

function getAdminEventTabFromPath(pathname: string, search = ""): AdminEventTab {
  if (pathname.endsWith("/committees") || pathname.endsWith("/comitati")) {
    return "committees";
  }

  if (pathname.endsWith("/registrations")) {
    return "registrations";
  }

  if (pathname.endsWith("/consents")) {
    return "consents";
  }

  if (pathname.endsWith("/rooms")) {
    return "overnight";
  }

  if (pathname.endsWith("/questions")) {
    return "questions";
  }

  if (pathname.endsWith("/surveys") || pathname.endsWith("/sondaggi")) {
    return "surveys";
  }

  if (pathname.endsWith("/gallery")) {
    return "gallery";
  }

  if (pathname.endsWith("/stats")) {
    return "stats";
  }

  // La scheda Record vive sulla rotta di base con `?tab=records` (nessuna
  // rotta nuova da registrare); `/records` è riconosciuto se la si aggiunge.
  if (
    pathname.endsWith("/records") ||
    new URLSearchParams(search).get("tab") === "records"
  ) {
    return "records";
  }

  return "details";
}

function getAdminEventTabHref(eventId: string, tab: AdminEventTab) {
  switch (tab) {
    case "committees":
      return `/admin/events/${eventId}/comitati`;
    case "registrations":
      return `/admin/events/${eventId}/registrations`;
    case "consents":
      return `/admin/events/${eventId}/consents`;
    case "overnight":
      return `/admin/events/${eventId}/rooms`;
    case "questions":
      return `/admin/events/${eventId}/questions`;
    case "records":
      return `/admin/events/${eventId}?tab=records`;
    case "surveys":
      return `/admin/events/${eventId}/surveys`;
    case "gallery":
      return `/admin/events/${eventId}/gallery`;
    case "stats":
      return `/admin/events/${eventId}/stats`;
    default:
      return `/admin/events/${eventId}`;
  }
}

// Foglio di conferma aperto (mai un dialogo del browser). Ognuno si lega
// all'oggetto con cui è stato aperto: se sparisce, o se cambiano account o
// rotta, il foglio si chiude e nessuna azione parte per l'oggetto sbagliato.
type AdminConfirm =
  | { kind: "removePatrol"; patrolId: string }
  | { kind: "deleteQuestion"; questionId: string }
  | { kind: "deleteActivity" }
  | { kind: "legacyApprovals" }
  | { kind: "consentCompletion"; digest: string; total: number }
  | { kind: "cancelRegistration"; registrationId: string }
  | { kind: "deleteRegistration"; registrationId: string }
  | { kind: "reactivateRegistration"; registrationId: string };

export function AdminEventDetailPage() {
  const { eventId } = useParams();
  const location = useLocation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const stakeId = session?.profile.stakeId ?? DEFAULT_STAKE_ID;
  const routeTab = getAdminEventTabFromPath(location.pathname, location.search);
  const isCampManagementTab = routeTab === "committees";
  const isStatsTab = routeTab === "stats";
  const isCampManagerOnly = isCampManagementTab && Boolean(session && !session.isAdmin);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [busy, setBusy] = useState<
    | null
    | "publish"
    | "delete"
    | "resendParentAuth"
    | "saveParentEmail"
    | "downloadSignedConsent"
    | "downloadSignedConsentsZip"
    | "backfillLegacyApprovals"
    | "consentCompletionCheck"
    | "consentCompletionSend"
    | "deleteQuestion"
    | "deleteRegistration"
    | "cancelRegistration"
    | "reactivateRegistration"
    | "saveCampManagement"
  >(null);
  const [busyRegistrationId, setBusyRegistrationId] = useState<string | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  // Link di download persistente: window.open dopo un await viene bloccato
  // dai popup blocker (Safari/iOS), quindi il link resta cliccabile qui.
  const [actionDownload, setActionDownload] = useState<{
    url: string;
    label: string;
  } | null>(null);
  const [registrationModalId, setRegistrationModalId] = useState<string | null>(
    null,
  );
  const [registrationModalMode, setRegistrationModalMode] =
    useState<RegistrationModalMode>("registration");
  const [selectedConsentRegistrationId, setSelectedConsentRegistrationId] =
    useState<string | null>(null);
  const [parentEmailEditingId, setParentEmailEditingId] = useState<
    string | null
  >(null);
  const [parentEmailDraft, setParentEmailDraft] = useState("");
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [excelExportModalOpen, setExcelExportModalOpen] = useState(false);
  const [normalizingRoomPreferences, setNormalizingRoomPreferences] =
    useState(false);
  const [consentCompletion, setConsentCompletion] = useState<Extract<
    ConsentCompletionResult,
    { dryRun: true }
  > | null>(null);
  const [consentCompletionOutcome, setConsentCompletionOutcome] = useState<Extract<
    ConsentCompletionResult,
    { dryRun: false }
  > | null>(null);
  const [campDraft, setCampDraft] = useState<CampManagementPlan>(
    campManagementService.getDefaultCampManagement(),
  );
  const [campDraftDirty, setCampDraftDirty] = useState(false);
  const [manualLeaderName, setManualLeaderName] = useState("");
  const [selectedCampCommitteeId, setSelectedCampCommitteeId] =
    useState<CampCommitteeId | null>(null);
  const [selectedCampPatrolId, setSelectedCampPatrolId] = useState<
    string | null
  >(null);
  const [confirmSheet, setConfirmSheet] = useState<AdminConfirm | null>(null);
  // Fogli degli iscritti (docs/ADMIN_ISCRITTI.md): aggiunta a mano dalla tab,
  // modifica e richiesta di autorizzazione sopra la scheda dell'iscrizione.
  const [addManualOpen, setAddManualOpen] = useState(false);
  const [registrationFilters, setRegistrationFilters] = useState<RegistrationFilters>(
    DEFAULT_REGISTRATION_FILTERS,
  );
  const [editRegistrationId, setEditRegistrationId] = useState<string | null>(null);
  const [requestAuthorizationId, setRequestAuthorizationId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Numero del foglio: l'esito di una richiesta partita da un foglio chiuso
  // nel frattempo non tocca quello aperto dopo.
  const confirmRunRef = useRef(0);

  function showConfirm(next: AdminConfirm | null) {
    confirmRunRef.current += 1;
    setConfirmError(null);
    setConfirmSheet(next);
    if (next) {
      setActionError(null);
    }
  }

  // Cambio di account o di rotta (altra attività, altra tab, Indietro) con il
  // foglio aperto: si chiude.
  const confirmContextKey = `${session?.firebaseUser.uid ?? ""}|${location.pathname}|${location.search}`;
  useEffect(() => {
    showConfirm(null);
    setAddManualOpen(false);
    setEditRegistrationId(null);
    setRequestAuthorizationId(null);
  }, [confirmContextKey]);
  // Account e attività di adesso (vuoto dopo l'uscita dalla pagina): l'esito
  // di una richiesta partita su un'altra attività, o prima di Indietro, non
  // tocca bozza, modali né navigazione.
  const eventContextKey = `${session?.firebaseUser.uid ?? ""}|${stakeId}|${eventId ?? ""}`;
  const eventContextRef = useRef(eventContextKey);
  useEffect(() => {
    eventContextRef.current = eventContextKey;
    return () => {
      eventContextRef.current = "";
    };
  }, [eventContextKey]);

  const { data, loading, error } = useAsyncData(
    async () => {
      if (!eventId) {
        return null;
      }

      if (isCampManagementTab) {
        const [workspace, campManagement] = await Promise.all([
          adminEventsService.getAdminEventWorkspace(stakeId, eventId),
          campManagementService.getCampManagement(stakeId, eventId),
        ]);

        if (!workspace) {
          return null;
        }

        return {
          workspace,
          organization: null,
          registrationsPerEvent: [],
          campManagement,
        };
      }

      const [workspace, organization, campManagement] = await Promise.all([
        adminEventsService.getAdminEventWorkspace(stakeId, eventId),
        organizationService.getProfile(stakeId),
        campManagementService.getCampManagement(stakeId, eventId),
      ]);

      if (!workspace) {
        return null;
      }

      // Le statistiche di confronto (rank + media iscritti tra eventi) vivono
      // solo nella tab "stats". Caricare le iscrizioni di TUTTI gli eventi ad
      // ogni apertura della scheda era un N+1 che rallentava ogni visita:
      // ora si paga solo quando serve davvero.
      const registrationsPerEvent = isStatsTab
        ? await Promise.all(
            (await adminEventsService.listAdminEvents(stakeId)).map(
              async (event) => ({
                eventId: event.id,
                registrations:
                  await registrationsService.listRegistrationsByEvent(
                    stakeId,
                    event.id,
                  ),
              }),
            ),
          )
        : [];

      return {
        workspace,
        organization,
        registrationsPerEvent,
        campManagement,
      };
    },
    [eventId, isCampManagementTab, isStatsTab, refreshKey, stakeId],
    null,
  );

  const questionsEnabled =
    !isCampManagementTab && data?.workspace.event.questionsEnabled === true;
  const [questionsRefreshKey, setQuestionsRefreshKey] = useState(0);
  const {
    data: questions,
    loading: questionsLoading,
    error: questionsError,
  } = useAsyncData<Question[]>(
    async () => {
      if (!eventId || !questionsEnabled) {
        return [];
      }

      return questionsService.listAllForEvent(stakeId, eventId);
    },
    [eventId, stakeId, questionsEnabled, questionsRefreshKey],
    [],
  );

  const event = data?.workspace.event ?? null;
  const formConfig = data?.workspace.formConfig ?? null;
  const registrations = data?.workspace.registrations ?? [];
  // Chi ha aggiunto a mano l'iscrizione aperta nella scheda.
  const modalCreatedBy =
    registrations.find((registration) => registration.id === registrationModalId)
      ?.createdBy ?? null;
  const { data: modalCreatorName } = useAsyncData<string | null>(
    async () => {
      if (!modalCreatedBy) return null;
      const profile = await usersService.getProfile(modalCreatedBy).catch(() => null);
      return profile?.fullName || null;
    },
    [modalCreatedBy],
    null,
  );
  const campManagement = useMemo(
    () =>
      data?.campManagement ?? campManagementService.getDefaultCampManagement(),
    [data?.campManagement],
  );

  useEffect(() => {
    setCampDraft(campManagement);
    setCampDraftDirty(false);
  }, [campManagement]);

  const sortedRegistrations = useMemo(
    () =>
      [...registrations].sort(
        (left, right) =>
          left.lastName.localeCompare(right.lastName, "it-IT") ||
          left.firstName.localeCompare(right.firstName, "it-IT") ||
          left.fullName.localeCompare(right.fullName, "it-IT"),
      ),
    [registrations],
  );
  const activeRegistrations = useMemo(
    () =>
      sortedRegistrations.filter(
        (registration) =>
          registration.registrationStatus !== "cancelled" &&
          registration.status !== "cancelled",
      ),
    [sortedRegistrations],
  );
  const activeRegistrationById = useMemo(() => {
    const map = new Map<string, Registration>();
    for (const registration of activeRegistrations) {
      map.set(registration.id, registration);
    }
    return map;
  }, [activeRegistrations]);
  const youthRegistrations = useMemo(
    () =>
      activeRegistrations.filter(
        (registration) =>
          registration.genderRoleCategory === "giovane_uomo" ||
          registration.genderRoleCategory === "giovane_donna",
      ),
    [activeRegistrations],
  );
  const adultRegistrations = useMemo(
    () =>
      activeRegistrations.filter(
        (registration) =>
          registration.genderRoleCategory === "dirigente" ||
          registration.genderRoleCategory === "accompagnatore",
      ),
    [activeRegistrations],
  );
  const manualLeaderById = useMemo(
    () => new Map(campDraft.manualLeaders.map((leader) => [leader.id, leader])),
    [campDraft.manualLeaders],
  );
  const committeeAssignmentByRegistrationId = useMemo(() => {
    const map = new Map<string, CampCommitteeId>();

    for (const committee of campDraft.committees) {
      for (const registrationId of [
        ...committee.leaderRegistrationIds,
        ...committee.memberRegistrationIds,
      ]) {
        if (!map.has(registrationId)) {
          map.set(registrationId, committee.id);
        }
      }
    }

    return map;
  }, [campDraft.committees]);
  const committeeAssignmentByManualLeaderId = useMemo(() => {
    const map = new Map<string, CampCommitteeId>();

    for (const committee of campDraft.committees) {
      for (const leaderId of committee.manualLeaderIds) {
        if (!map.has(leaderId)) {
          map.set(leaderId, committee.id);
        }
      }
    }

    return map;
  }, [campDraft.committees]);
  const patrolAssignmentByRegistrationId = useMemo(() => {
    const map = new Map<
      string,
      { patrolId: string; patrolName: string; role: CampPatrolRole }
    >();

    for (const patrol of campDraft.patrols) {
      if (patrol.leaderRegistrationId) {
        map.set(patrol.leaderRegistrationId, {
          patrolId: patrol.id,
          patrolName: patrol.name,
          role: "leader",
        });
      }

      for (const registrationId of patrol.supervisorRegistrationIds) {
        if (!map.has(registrationId)) {
          map.set(registrationId, {
            patrolId: patrol.id,
            patrolName: patrol.name,
            role: "supervisor",
          });
        }
      }

      for (const registrationId of patrol.memberRegistrationIds) {
        if (!map.has(registrationId)) {
          map.set(registrationId, {
            patrolId: patrol.id,
            patrolName: patrol.name,
            role: "member",
          });
        }
      }
    }

    return map;
  }, [campDraft.patrols]);
  const patrolAssignmentByManualSupervisorId = useMemo(() => {
    const map = new Map<string, { patrolId: string; patrolName: string }>();

    for (const patrol of campDraft.patrols) {
      for (const manualSupervisorId of patrol.manualSupervisorIds) {
        if (!map.has(manualSupervisorId)) {
          map.set(manualSupervisorId, {
            patrolId: patrol.id,
            patrolName: patrol.name,
          });
        }
      }
    }

    return map;
  }, [campDraft.patrols]);
  const organizationDistribution = useMemo(
    () =>
      buildDistribution(
        activeRegistrations,
        (registration) => getCategoryLabel(registration),
        "Organizzazione non indicata",
      ),
    [activeRegistrations],
  );
  const unitDistribution = useMemo(
    () =>
      buildDistribution(
        activeRegistrations,
        (registration) => getUnitLabel(registration),
        "Unità non indicata",
      ),
    [activeRegistrations],
  );
  const cityDistribution = useMemo(
    () =>
      buildDistribution(
        activeRegistrations,
        (registration) =>
          typeof registration.answers.city === "string"
            ? registration.answers.city
            : "",
        "Città non indicata",
      ),
    [activeRegistrations],
  );
  const registrationLookupById = useMemo(() => {
    const map = new Map<string, Registration>();
    for (const registration of registrations) {
      map.set(registration.id, registration);
    }
    return map;
  }, [registrations]);
  const sortedQuestions = useMemo(
    () =>
      (questions ?? [])
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [questions],
  );

  if (!eventId) {
    return (
      <div className="page">
        <EmptyState
          title="Attività non trovata"
          description="La scheda richiesta non è disponibile."
        />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page">
        {error ? (
          <div className="notice notice--warning">
            <div>
              <h3>Dettaglio non disponibile</h3>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="subtle-text">Sto preparando l'attività...</p>
        ) : (
          <EmptyState
            title="Attività non trovata"
            description="La scheda richiesta non è disponibile."
          />
        )}
      </div>
    );
  }

  const resolvedEvent = event;
  const resolvedEventId = eventId;
  const effectiveStatus = getEffectiveEventStatus(resolvedEvent);
  const currentCount = activeRegistrations.length;
  const authenticatedCount = activeRegistrations.filter(
    (registration) => registration.submittedByMode === "authenticated",
  ).length;
  const anonymousCount = activeRegistrations.filter(
    (registration) => registration.submittedByMode === "anonymous",
  ).length;
  const minorRegistrations = activeRegistrations.filter((registration) =>
    isMinorRegistration(registration),
  );
  const uploadedMinorConsentCount = minorRegistrations.filter((registration) =>
    Boolean(
      registration.parentConsentDocumentUrl ||
      registration.parentAuthorization?.pdfPath,
    ),
  ).length;
  const missingMinorConsentCount =
    minorRegistrations.length - uploadedMinorConsentCount;
  const signedParentAuthorizationCount = activeRegistrations.filter(
    (registration) =>
      registration.parentAuthorization?.status === "authorized" &&
      Boolean(registration.parentAuthorization?.pdfPath),
  ).length;
  const legacyApprovedWithoutPdfCount = activeRegistrations.filter(
    (registration) => {
      if (registration.parentAuthorization?.pdfPath) return false;
      if (registration.parentAuthorization?.status === "rejected_by_parent")
        return false;
      return (
        registration.parentAuthorization?.status === "authorized" ||
        registration.answers.parentConfirmed === true ||
        registration.answers.parentalConsentAccepted === true
      );
    },
  ).length;
  const assignedPatrolCount = patrolAssignmentByRegistrationId.size;
  const assignedCommitteeCount = committeeAssignmentByRegistrationId.size;
  const averageAge = getAverageAge(activeRegistrations);
  const comparisonCounts = (data?.registrationsPerEvent ?? [])
    .map((item) => ({
      eventId: item.eventId,
      total: item.registrations.filter(
        (registration) => registration.registrationStatus !== "cancelled",
      ).length,
    }))
    .sort((left, right) => right.total - left.total);
  const eventRankIndex = comparisonCounts.findIndex(
    (item) => item.eventId === resolvedEventId,
  );
  const eventRank = eventRankIndex >= 0 ? eventRankIndex + 1 : null;
  const averageRegistrations =
    comparisonCounts.length > 0
      ? Math.round(
          (comparisonCounts.reduce((sum, item) => sum + item.total, 0) /
            comparisonCounts.length) *
            10,
        ) / 10
      : 0;
  const activeTab = isCampManagerOnly
    ? "committees"
    : (!resolvedEvent.overnight && routeTab === "overnight") ||
        (!resolvedEvent.questionsEnabled && routeTab === "questions") ||
        (!resolvedEvent.recordsEnabled && routeTab === "records")
      ? "details"
      : routeTab;
  const isCampOvernight = resolvedEvent.activityType === "camp";
  const overnightUnitSingular = isCampOvernight ? "tenda" : "stanza";
  const overnightUnitSingularTitle = isCampOvernight ? "Tenda" : "Stanza";
  const overnightUnitPlural = isCampOvernight ? "tende" : "stanze";
  const overnightUnitPluralTitle = isCampOvernight ? "Tende" : "Stanze";
  const subtabsCountClass = (() => {
    let count = 5;
    if (resolvedEvent.overnight) count += 1;
    if (resolvedEvent.questionsEnabled) count += 1;
    if (resolvedEvent.recordsEnabled) count += 1;
    if (count >= 7) return "admin-subtabs admin-subtabs--six";
    if (count === 6) return "admin-subtabs admin-subtabs--six";
    if (count === 5) return "admin-subtabs admin-subtabs--five";
    return "admin-subtabs admin-subtabs--four";
  })();
  const visibleQuestions = sortedQuestions.filter(
    (question) => question.status === "active",
  );
  const hiddenQuestions = sortedQuestions.filter(
    (question) => question.status === "hidden",
  );
  const registrationModal =
    registrationModalId !== null
      ? (sortedRegistrations.find(
          (registration) => registration.id === registrationModalId,
        ) ?? null)
      : null;
  // I fogli sopra la scheda valgono per l'iscrizione con cui sono stati
  // aperti, finché c'è (riletta dal server, cancellata altrove: si chiudono).
  const editRegistration =
    editRegistrationId !== null
      ? (sortedRegistrations.find((registration) => registration.id === editRegistrationId) ??
        null)
      : null;
  const requestAuthorizationRegistration =
    requestAuthorizationId !== null
      ? (sortedRegistrations.find(
          (registration) =>
            registration.id === requestAuthorizationId && isMissingParentEmail(registration),
        ) ?? null)
      : null;
  const registrationModalHighlights = registrationModal
    ? getRegistrationHighlights(registrationModal)
    : [];
  const registrationModalRoomEntries = registrationModal
    ? getRoomPreferenceEntries(registrationModal)
    : [];
  const parentPhotoBadgesApply = registrationModal
    ? getPhotoConsentBadges(registrationModal) !== null
    : false;
  const registrationModalAnswerEntries =
    formConfig && registrationModal
      ? getRegistrationAnswerEntries(formConfig, registrationModal).filter(
          (entry) =>
            !sharedRegistrationEntryKeys.has(entry.key) &&
            !roomRegistrationEntryKeys.has(entry.key) &&
            // Per i minori la spunta foto del modulo non è un consenso: ci sono
            // le pill del genitore.
            !(
              parentPhotoBadgesApply &&
              (entry.key === "photoInternalConsent" ||
                entry.key === "photoPublicConsent")
            ),
        )
      : [];
  const modalSubtitle =
    registrationModalMode === "overnight"
      ? `Preferenze ${overnightUnitSingular} e dati inviati`
      : "Dettaglio registrazione";
  const selectedCampCommittee =
    selectedCampCommitteeId !== null
      ? (campDraft.committees.find(
          (committee) => committee.id === selectedCampCommitteeId,
        ) ?? null)
      : null;
  const selectedCampPatrol =
    selectedCampPatrolId !== null
      ? (campDraft.patrols.find(
          (patrol) => patrol.id === selectedCampPatrolId,
        ) ?? null)
      : null;
  // Con un modale aperto gli esiti delle azioni stanno dentro il modale: la
  // pagina sotto è coperta e inerte.
  const pageModalOpen = Boolean(
    registrationModal ||
      selectedCampCommittee ||
      selectedCampPatrol ||
      excelExportModalOpen ||
      addManualOpen,
  );

  function getRegistrationName(registrationId: string) {
    const registration = activeRegistrationById.get(registrationId);
    return registration
      ? getRegistrationDisplayName(registration)
      : "Non trovato";
  }

  function getRegistrationMeta(registrationId: string) {
    const registration = activeRegistrationById.get(registrationId);
    if (!registration) return "";
    return `${getUnitLabel(registration)} · ${getCategoryShortLabel(registration)}`;
  }

  function openTab(tab: AdminEventTab) {
    navigate(getAdminEventTabHref(resolvedEventId, tab));
  }

  function updateCommitteeRegistration(
    committeeId: CampCommitteeId,
    registrationId: string,
    role: "leader" | "member",
  ) {
    setCampDraftDirty(true);
    setCampDraft((current) => {
      const target = current.committees.find(
        (committee) => committee.id === committeeId,
      );
      const alreadyAssigned =
        target?.leaderRegistrationIds.includes(registrationId) ||
        target?.memberRegistrationIds.includes(registrationId);
      const nextCommittees = current.committees.map((committee) => {
        const withoutRegistration = {
          ...committee,
          leaderRegistrationIds: committee.leaderRegistrationIds.filter(
            (value) => value !== registrationId,
          ),
          memberRegistrationIds: committee.memberRegistrationIds.filter(
            (value) => value !== registrationId,
          ),
        };

        if (committee.id !== committeeId || alreadyAssigned) {
          return withoutRegistration;
        }

        return role === "leader"
          ? {
              ...withoutRegistration,
              leaderRegistrationIds: [
                ...withoutRegistration.leaderRegistrationIds,
                registrationId,
              ],
            }
          : {
              ...withoutRegistration,
              memberRegistrationIds: [
                ...withoutRegistration.memberRegistrationIds,
                registrationId,
              ],
            };
      });

      return { ...current, committees: nextCommittees };
    });
  }

  function toggleCommitteeManualLeader(
    committeeId: CampCommitteeId,
    manualLeaderId: string,
  ) {
    setCampDraftDirty(true);
    setCampDraft((current) => {
      const target = current.committees.find(
        (committee) => committee.id === committeeId,
      );
      const alreadyAssigned = Boolean(
        target?.manualLeaderIds.includes(manualLeaderId),
      );

      return {
        ...current,
        committees: current.committees.map((committee) => {
          const withoutLeader = {
            ...committee,
            manualLeaderIds: committee.manualLeaderIds.filter(
              (value) => value !== manualLeaderId,
            ),
          };

          if (committee.id !== committeeId || alreadyAssigned) {
            return withoutLeader;
          }

          return {
            ...withoutLeader,
            manualLeaderIds: [...withoutLeader.manualLeaderIds, manualLeaderId],
          };
        }),
      };
    });
  }

  function addManualLeader() {
    const fullName = manualLeaderName.trim();
    if (!fullName) return;

    const timestamp = new Date().toISOString();
    setCampDraftDirty(true);
    setCampDraft((current) => ({
      ...current,
      manualLeaders: [
        ...current.manualLeaders,
        {
          id: createLocalId("manual-leader"),
          fullName,
          linkedRegistrationId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }));
    setManualLeaderName("");
  }

  function removeManualLeader(manualLeaderId: string) {
    setCampDraftDirty(true);
    setCampDraft((current) => ({
      ...current,
      manualLeaders: current.manualLeaders.filter(
        (leader) => leader.id !== manualLeaderId,
      ),
      committees: current.committees.map((committee) => ({
        ...committee,
        manualLeaderIds: committee.manualLeaderIds.filter(
          (value) => value !== manualLeaderId,
        ),
      })),
      patrols: current.patrols.map((patrol) => ({
        ...patrol,
        manualSupervisorIds: patrol.manualSupervisorIds.filter(
          (value) => value !== manualLeaderId,
        ),
      })),
    }));
  }

  function addPatrol() {
    const timestamp = new Date().toISOString();

    setCampDraftDirty(true);
    setCampDraft((current) => ({
      ...current,
      patrols: [
        ...current.patrols,
        {
          id: createLocalId("patrol"),
          name: `Pattuglia ${current.patrols.length + 1}`,
          leaderRegistrationId: "",
          supervisorRegistrationIds: [],
          manualSupervisorIds: [],
          memberRegistrationIds: [],
          publicMembers: [],
          updatedAt: timestamp,
        },
      ],
    }));
  }

  function updatePatrolField<Key extends keyof CampPatrolPlan>(
    patrolId: string,
    key: Key,
    value: CampPatrolPlan[Key],
  ) {
    setCampDraftDirty(true);
    setCampDraft((current) => ({
      ...current,
      patrols: current.patrols.map((patrol) =>
        patrol.id === patrolId ? { ...patrol, [key]: value } : patrol,
      ),
    }));
  }

  function removeRegistrationFromPatrol(
    patrol: CampPatrolPlan,
    registrationId: string,
  ) {
    return {
      ...patrol,
      leaderRegistrationId:
        patrol.leaderRegistrationId === registrationId
          ? ""
          : patrol.leaderRegistrationId,
      supervisorRegistrationIds: patrol.supervisorRegistrationIds.filter(
        (value) => value !== registrationId,
      ),
      memberRegistrationIds: patrol.memberRegistrationIds.filter(
        (value) => value !== registrationId,
      ),
    };
  }

  function setPatrolLeader(patrolId: string, registrationId: string) {
    setCampDraftDirty(true);
    setCampDraft((current) => ({
      ...current,
      patrols: current.patrols.map((patrol) => {
        const withoutRegistration = registrationId
          ? removeRegistrationFromPatrol(patrol, registrationId)
          : patrol;

        return patrol.id === patrolId
          ? { ...withoutRegistration, leaderRegistrationId: registrationId }
          : withoutRegistration;
      }),
    }));
  }

  function togglePatrolAssignment(
    patrolId: string,
    key: "supervisorRegistrationIds" | "memberRegistrationIds",
    registrationId: string,
  ) {
    setCampDraftDirty(true);
    setCampDraft((current) => {
      const targetPatrol = current.patrols.find(
        (patrol) => patrol.id === patrolId,
      );
      const isRemoving = Boolean(targetPatrol?.[key].includes(registrationId));

      return {
        ...current,
        patrols: current.patrols.map((patrol) => {
          const withoutRegistration = removeRegistrationFromPatrol(
            patrol,
            registrationId,
          );
          if (patrol.id !== patrolId || isRemoving) {
            return withoutRegistration;
          }

          return {
            ...withoutRegistration,
            [key]: [...withoutRegistration[key], registrationId],
          };
        }),
      };
    });
  }

  function togglePatrolManualSupervisor(
    patrolId: string,
    manualSupervisorId: string,
  ) {
    setCampDraftDirty(true);
    setCampDraft((current) => {
      const target = current.patrols.find((patrol) => patrol.id === patrolId);
      const isRemoving = Boolean(
        target?.manualSupervisorIds.includes(manualSupervisorId),
      );

      return {
        ...current,
        patrols: current.patrols.map((patrol) => {
          const withoutSupervisor = {
            ...patrol,
            manualSupervisorIds: patrol.manualSupervisorIds.filter(
              (value) => value !== manualSupervisorId,
            ),
          };

          if (patrol.id !== patrolId || isRemoving) {
            return withoutSupervisor;
          }

          return {
            ...withoutSupervisor,
            manualSupervisorIds: [
              ...withoutSupervisor.manualSupervisorIds,
              manualSupervisorId,
            ],
          };
        }),
      };
    });
  }

  // Ritorna se il salvataggio è riuscito. L'errore va a `onError` (il foglio
  // di conferma aperto) o, senza, all'avviso della pagina o del modale aperto.
  async function handleSaveCampManagement(options?: {
    closeModal?: boolean;
    draftOverride?: CampManagementPlan;
    onError?: (message: string) => void;
  }) {
    setBusy("saveCampManagement");
    setActionError(null);
    setActionInfo(null);
    const startedFor = eventContextRef.current;

    try {
      const saved = await withWriteTimeout(
        campManagementService.saveCampManagement(
          stakeId,
          resolvedEventId,
          options?.draftOverride ?? campDraft,
        ),
      );
      if (eventContextRef.current !== startedFor) return false;
      setCampDraft(saved);
      setCampDraftDirty(false);
      setActionInfo("Comitati e pattuglie salvati.");
      if (options?.closeModal) {
        setSelectedCampCommitteeId(null);
        setSelectedCampPatrolId(null);
      }
      setRefreshKey((current) => current + 1);
      return true;
    } catch (caughtError) {
      if (eventContextRef.current !== startedFor) return false;
      const message = getAdminActionError(caughtError, ADMIN.erroreSalvaCampo);
      if (options?.onError) {
        options.onError(message);
      } else {
        setActionError(message);
      }
      return false;
    } finally {
      setBusy(null);
    }
  }

  // "Elimina e salva": la bozza cambia solo se il salvataggio riesce, così
  // "Tieni la pattuglia" dopo un errore ritrova tutto com'era.
  async function handleRemovePatrolAndSave(patrolId: string) {
    const run = confirmRunRef.current;
    const nextDraft = {
      ...campDraft,
      patrols: campDraft.patrols.filter((patrol) => patrol.id !== patrolId),
    };
    const saved = await handleSaveCampManagement({
      closeModal: true,
      draftOverride: nextDraft,
      onError: (message) => {
        if (run === confirmRunRef.current) setConfirmError(message);
      },
    });
    if (saved && run === confirmRunRef.current) {
      showConfirm(null);
    }
  }

  async function handleDownloadCampManagementExcel() {
    setDownloadingExcel(true);
    setActionError(null);
    setActionInfo(null);

    try {
      await downloadCampManagementExcel(
        resolvedEvent.title,
        activeRegistrations,
        campDraft,
      );
      setActionInfo("Excel comitati e pattuglie generato.");
    } catch (caughtError) {
      setActionError(getAdminActionError(caughtError, ADMIN.erroreExcel));
    } finally {
      setDownloadingExcel(false);
    }
  }

  async function handleToggleQuestionStatus(question: Question) {
    setActionError(null);
    setActionInfo(null);

    try {
      await questionsService.setStatus(
        stakeId,
        resolvedEventId,
        question.registrationId,
        question.id,
        question.status === "active" ? "hidden" : "active",
      );
      setQuestionsRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile aggiornare la domanda.",
      );
    }
  }

  async function handleExportQuestionsPdf() {
    setActionError(null);
    setActionInfo(null);

    try {
      const { downloadQuestionsPdf } = await import("@/utils/questionsPdf");
      downloadQuestionsPdf({
        event: resolvedEvent,
        questions: sortedQuestions,
      });
      setActionInfo("PDF domande generato.");
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile generare il PDF delle domande.",
      );
    }
  }

  async function handleDeleteQuestion(question: Question) {
    const run = confirmRunRef.current;
    const startedFor = eventContextRef.current;
    setBusy("deleteQuestion");
    setConfirmError(null);
    setActionInfo(null);

    try {
      await withWriteTimeout(
        questionsService.adminDelete(
          stakeId,
          resolvedEventId,
          question.registrationId,
          question.id,
        ),
      );
      if (eventContextRef.current !== startedFor) return;
      setQuestionsRefreshKey((current) => current + 1);
      setActionInfo("Domanda eliminata.");
      if (run === confirmRunRef.current) showConfirm(null);
    } catch (caughtError) {
      if (run === confirmRunRef.current) {
        setConfirmError(getAdminActionError(caughtError, ADMIN.erroreEliminaDomanda));
      }
    } finally {
      setBusy(null);
    }
  }

  function openRegistrationModal(
    registrationId: string,
    mode: RegistrationModalMode,
  ) {
    setActionError(null);
    setActionInfo(null);
    setRegistrationModalMode(mode);
    setRegistrationModalId(registrationId);
  }

  function closeRegistrationModal() {
    setActionError(null);
    setRegistrationModalId(null);
  }

  function openCampCommittee(committeeId: CampCommitteeId) {
    setActionError(null);
    setActionInfo(null);
    setSelectedCampCommitteeId(committeeId);
  }

  function openCampPatrol(patrolId: string) {
    setActionError(null);
    setActionInfo(null);
    setSelectedCampPatrolId(patrolId);
  }

  // Un errore visto nel modale non resta nella pagina dopo la chiusura.
  function closeCampModal() {
    setActionError(null);
    setSelectedCampCommitteeId(null);
    setSelectedCampPatrolId(null);
  }

  async function handlePublish() {
    setActionError(null);

    if (resolvedEvent.isPublic) {
      setActionInfo("L'attività è già pubblica.");
      return;
    }

    setBusy("publish");
    setActionInfo(null);

    try {
      await eventsService.publishEvent(stakeId, resolvedEventId);
      setActionInfo("Attività resa pubblica.");
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile pubblicare l'attività.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    const run = confirmRunRef.current;
    const startedFor = eventContextRef.current;
    setBusy("delete");
    setConfirmError(null);
    setActionInfo(null);

    // Prima i documenti, poi l'immagine: se la cancellazione si ferma,
    // l'attività resta con la sua immagine e si può riprovare. L'immagine si
    // toglie quando i documenti sono andati, anche dopo il timeout del foglio.
    const deletion = eventsService.deleteEvent(stakeId, resolvedEventId);
    const heroImagePath = resolvedEvent.heroImagePath;
    if (heroImagePath) {
      deletion
        .then(() => storageService.deleteFile(heroImagePath))
        .catch(() => undefined);
    }

    try {
      // Molti documenti in più lotti: un minuto prima di dire "nessuna risposta".
      await withWriteTimeout(deletion, 60000);

      if (run === confirmRunRef.current) showConfirm(null);
      // Indietro o un'altra attività nel frattempo: la pagina resta dov'è.
      if (eventContextRef.current === startedFor) {
        navigate("/admin/events", { replace: true });
      }
    } catch (caughtError) {
      if (run === confirmRunRef.current) {
        setConfirmError(getAdminActionError(caughtError, ADMIN.erroreEliminaAttivita));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleResendParentAuthEmail(registration: Registration) {
    setBusy("resendParentAuth");
    setBusyRegistrationId(registration.id);
    setActionError(null);
    setActionInfo(null);
    try {
      const result = await parentAuthorizationService.resend({
        stakeId,
        activityId: resolvedEventId,
        registrationId: registration.id,
      });
      if (result.sent) {
        setActionInfo(
          `Email di autorizzazione reinviata a ${getParentEmail(registration) || "genitore"}.`,
        );
      } else {
        setActionError(
          "Reinvio non riuscito (vecchio token invalidato ma email non partita). Controlla i log Cloud Functions.",
        );
      }
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile reinviare l'email di autorizzazione.",
      );
    } finally {
      setBusy(null);
      setBusyRegistrationId(null);
    }
  }

  function handleStartParentEmailEdit(registration: Registration) {
    setParentEmailEditingId(registration.id);
    setParentEmailDraft(getParentEmail(registration));
    setSelectedConsentRegistrationId(registration.id);
    setActionError(null);
    setActionInfo(null);
  }

  async function handleSaveParentEmail(registration: Registration) {
    const normalizedEmail = parentEmailDraft.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setActionError("Inserisci un'email genitore valida.");
      return;
    }

    setBusy("saveParentEmail");
    setBusyRegistrationId(registration.id);
    setActionError(null);
    setActionInfo(null);

    try {
      await registrationsService.adminUpdateParentAuthorizationEmail(
        stakeId,
        resolvedEventId,
        registration.id,
        normalizedEmail,
      );
      setActionInfo(`Email genitore aggiornata: ${normalizedEmail}.`);
      setParentEmailEditingId(null);
      setParentEmailDraft("");
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile aggiornare l'email del genitore.",
      );
    } finally {
      setBusy(null);
      setBusyRegistrationId(null);
    }
  }

  async function handleDownloadSignedConsent(
    registration: Registration,
    documentKind: "official" | "conduct" = "official",
  ) {
    setBusy("downloadSignedConsent");
    setBusyRegistrationId(registration.id);
    setActionError(null);
    setActionInfo(null);
    setActionDownload(null);

    try {
      const result =
        await parentAuthorizationService.getSignedConsentDownloadUrl({
          stakeId,
          activityId: resolvedEventId,
          registrationId: registration.id,
          documentKind,
        });
      window.open(result.url, "_blank", "noopener,noreferrer");
      setActionInfo(`Download pronto: ${result.filename}.`);
      setActionDownload({ url: result.url, label: "Scarica il modulo" });
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile scaricare il modulo firmato.",
      );
    } finally {
      setBusy(null);
      setBusyRegistrationId(null);
    }
  }

  async function handleDownloadSignedConsentsZip() {
    setBusy("downloadSignedConsentsZip");
    setActionError(null);
    setActionInfo(null);
    setActionDownload(null);

    try {
      const result = await parentAuthorizationService.downloadSignedConsentsZip(
        {
          stakeId,
          activityId: resolvedEventId,
        },
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
      setActionInfo(`ZIP pronto: ${result.count} moduli firmati.`);
      setActionDownload({ url: result.url, label: "Scarica lo ZIP" });
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile preparare lo ZIP dei moduli firmati.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleBackfillLegacyApprovals() {
    const run = confirmRunRef.current;
    const startedFor = eventContextRef.current;
    setBusy("backfillLegacyApprovals");
    setConfirmError(null);
    setActionError(null);
    setActionInfo(null);

    try {
      const result = await parentAuthorizationService.backfillLegacyApprovals({
        stakeId,
        activityId: resolvedEventId,
      });
      if (eventContextRef.current !== startedFor) return;
      setActionInfo(
        `Fallback completato: ${result.processed} moduli generati, ${result.emailed} email inviate` +
          (result.skipped ? `, ${result.skipped} saltati` : "") +
          (result.errors.length ? `, ${result.errors.length} avvisi` : "") +
          ".",
      );
      setRefreshKey((current) => current + 1);
      if (run === confirmRunRef.current) showConfirm(null);
    } catch (caughtError) {
      if (run === confirmRunRef.current) {
        setConfirmError(
          getAdminActionError(caughtError, ADMIN.erroreModuliVecchioMetodo),
        );
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleCheckConsentCompletion() {
    setBusy("consentCompletionCheck");
    setActionError(null);
    setActionInfo(null);
    setConsentCompletion(null);
    setConsentCompletionOutcome(null);

    try {
      // Solo simulazione: nessuna email parte da qui.
      const result = await parentAuthorizationService.requestConsentCompletion({
        stakeId,
        activityId: resolvedEventId,
        dryRun: true,
      });

      if (result.dryRun) {
        setConsentCompletion(result);
      }
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile controllare chi riceverebbe la mail.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSendConsentCompletion() {
    if (!consentCompletion || consentCompletion.total === 0) return;

    const run = confirmRunRef.current;
    const startedFor = eventContextRef.current;
    const total = consentCompletion.total;
    setBusy("consentCompletionSend");
    setConfirmError(null);
    setActionError(null);
    setActionInfo(null);

    try {
      const result = await parentAuthorizationService.requestConsentCompletion({
        stakeId,
        activityId: resolvedEventId,
        dryRun: false,
        expectedCount: total,
        expectedDigest: consentCompletion.digest,
      });

      if (eventContextRef.current !== startedFor) return;
      if (!result.dryRun) {
        if (run === confirmRunRef.current) showConfirm(null);
        setConsentCompletionOutcome(result);
        setConsentCompletion(null);
        setActionInfo(
          `Richiesta inviata: ${result.sent} email inviate` +
            (result.simulated ? `, ${result.simulated} simulate` : "") +
            (result.errors.length ? `, ${result.errors.length} errori` : "") +
            ".",
        );
        setRefreshKey((current) => current + 1);
      }
    } catch (caughtError) {
      // Se l'elenco è cambiato dopo la simulazione la callable risponde
      // failed-precondition: nessuna email è partita, si rifà la simulazione.
      const isStaleList =
        typeof caughtError === "object" &&
        caughtError !== null &&
        "code" in caughtError &&
        (caughtError as { code?: unknown }).code ===
          "functions/failed-precondition";
      // L'elenco è cambiato: il foglio non vale più (si chiude da solo) e lo
      // si dice nella pagina, dove si rifà il controllo.
      if (eventContextRef.current !== startedFor) return;
      if (isStaleList) {
        setConsentCompletion(null);
        if (run === confirmRunRef.current) showConfirm(null);
        setActionError(ADMIN.completamentoElencoCambiato);
      } else if (run === confirmRunRef.current) {
        setConfirmError(getAdminActionError(caughtError, ADMIN.erroreCompletamento));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleAdminDeleteRegistration(registration: Registration) {
    const run = confirmRunRef.current;
    const startedFor = eventContextRef.current;
    setBusy("deleteRegistration");
    setBusyRegistrationId(registration.id);
    setConfirmError(null);
    setActionError(null);
    setActionInfo(null);
    try {
      await withWriteTimeout(
        registrationsService.adminDeleteRegistration(
          stakeId,
          resolvedEventId,
          registration.id,
        ),
      );
      if (eventContextRef.current !== startedFor) return;
      setActionInfo(`Iscrizione di ${registration.fullName} eliminata.`);
      if (run === confirmRunRef.current) showConfirm(null);
      // Il modale di quell'iscrizione, se è ancora aperto, non ha più niente da mostrare.
      setRegistrationModalId((current) => (current === registration.id ? null : current));
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      if (run === confirmRunRef.current) {
        setConfirmError(getAdminActionError(caughtError, ADMIN.erroreEliminaIscrizione));
      }
    } finally {
      setBusy(null);
      setBusyRegistrationId(null);
    }
  }

  async function handleAdminCancelRegistration(registration: Registration) {
    const run = confirmRunRef.current;
    const startedFor = eventContextRef.current;
    setBusy("cancelRegistration");
    setBusyRegistrationId(registration.id);
    setConfirmError(null);
    setActionError(null);
    setActionInfo(null);
    try {
      await withWriteTimeout(
        registrationsService.adminSetRegistrationStatus(
          stakeId,
          resolvedEventId,
          registration.id,
          "cancelled",
        ),
      );
      if (eventContextRef.current !== startedFor) return;
      setActionInfo(`Iscrizione di ${registration.fullName} annullata.`);
      if (run === confirmRunRef.current) showConfirm(null);
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      if (run === confirmRunRef.current) {
        setConfirmError(getAdminActionError(caughtError, ADMIN.erroreAnnulla));
      }
    } finally {
      setBusy(null);
      setBusyRegistrationId(null);
    }
  }

  // Riattiva con la regola del titolare (planAdminReactivate): chi ha meno di
  // 18 anni in un'attività con autorizzazione torna in attesa del genitore.
  // Se parte una mail (o si riapre un rifiuto) prima un foglio di conferma.
  function requestReactivateRegistration(registration: Registration) {
    // Senza rete la riattivazione resterebbe in coda e potrebbe partire più
    // tardi con la mail al genitore: si dice subito, come nei fogli.
    if (isOffline()) {
      setActionInfo(null);
      setActionError(ISCRITTI.erroreRete);
      return;
    }
    const plan = planAdminReactivate(registration, resolvedEvent.requiresParentAuthorization === true);
    if (plan.sendsMail) {
      showConfirm({ kind: "reactivateRegistration", registrationId: registration.id });
      return;
    }
    void handleAdminReactivateRegistration(registration);
  }

  async function handleAdminReactivateRegistration(registration: Registration) {
    const run = confirmRunRef.current;
    if (isOffline()) {
      setConfirmError(ISCRITTI.erroreRete);
      return;
    }
    const startedFor = eventContextRef.current;
    const plan = planAdminReactivate(registration, resolvedEvent.requiresParentAuthorization === true);
    setBusy("reactivateRegistration");
    setBusyRegistrationId(registration.id);
    setConfirmError(null);
    setActionError(null);
    setActionInfo(null);
    try {
      await withWriteTimeout(
        registrationsService.adminSetRegistrationStatus(
          stakeId,
          resolvedEventId,
          registration.id,
          plan.status,
        ),
      );
      if (eventContextRef.current !== startedFor) return;
      setActionInfo(
        plan.status === "active"
          ? `Iscrizione di ${registration.fullName} riattivata.`
          : [
              fillCopy(ISCRITTI.riattivataInAttesa, { nome: registration.fullName }),
              plan.sendsMail ? ISCRITTI.mailInPartenza : "",
            ]
              .filter(Boolean)
              .join(" "),
      );
      if (run === confirmRunRef.current) showConfirm(null);
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      if (eventContextRef.current !== startedFor) return;
      const message = getAdminActionError(caughtError, ISCRITTI.erroreRiattiva);
      if (plan.sendsMail && run === confirmRunRef.current) {
        setConfirmError(message);
      } else {
        setActionError(message);
      }
    } finally {
      setBusy(null);
      setBusyRegistrationId(null);
    }
  }

  function openAddManualSheet() {
    setActionError(null);
    setActionInfo(null);
    setAddManualOpen(true);
  }

  function openExcelExportModal() {
    setActionError(null);
    setActionInfo(null);
    setExcelExportModalOpen(true);
  }

  async function handleDownloadExcel(options: ExportOptions) {
    setDownloadingExcel(true);
    setActionError(null);
    setActionInfo(null);

    try {
      const filtered = activeRegistrations.filter((registration) =>
        options.categories.includes(
          registration.genderRoleCategory as ExportOptions["categories"][number],
        ),
      );
      await downloadRegistrationsExcel(
        resolvedEvent.title,
        activeRegistrations,
        options,
      );
      setActionInfo(`Excel esportato con ${filtered.length} iscritti attivi.`);
      setExcelExportModalOpen(false);
    } catch (caughtError) {
      setActionError(
        getAdminActionError(caughtError, ADMIN.erroreExcel),
      );
    } finally {
      setDownloadingExcel(false);
    }
  }

  async function handleDownloadYouthRegistrantsExcel() {
    setDownloadingExcel(true);
    setActionError(null);
    setActionInfo(null);

    try {
      const youthRegistrations = activeRegistrations.filter(
        (registration) =>
          registration.genderRoleCategory === "giovane_uomo" ||
          registration.genderRoleCategory === "giovane_donna",
      );
      await downloadYouthRegistrantsExcel(
        resolvedEvent.title,
        activeRegistrations,
      );
      setActionInfo(
        `Elenco GU/GD esportato con ${youthRegistrations.length} iscritti attivi.`,
      );
    } catch (caughtError) {
      setActionError(getAdminActionError(caughtError, ADMIN.erroreExcel));
    } finally {
      setDownloadingExcel(false);
    }
  }

  async function handleNormalizeRoomPreferences() {
    setNormalizingRoomPreferences(true);
    setActionError(null);
    setActionInfo(null);

    try {
      const result = await registrationsService.normalizeRoomPreferenceMatches(
        stakeId,
        resolvedEventId,
      );

      if (result.processedRequestsCount === 0) {
        setActionInfo(
          `Nessuna richiesta ${overnightUnitSingular} da normalizzare.`,
        );
      } else {
        setActionInfo(
          `Normalizzazione completata: ${result.matchedCount} richieste abbinate, ${result.unmatchedCount} senza match su ${result.processedRequestsCount} richieste analizzate.`,
        );
      }

      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : `Impossibile normalizzare le richieste ${overnightUnitSingular}.`,
      );
    } finally {
      setNormalizingRoomPreferences(false);
    }
  }

  // Il foglio di conferma aperto, con l'oggetto ancora presente: se è
  // sparito (riletto dal server, cancellato altrove) il foglio non compare.
  const confirmView = ((): null | {
    title: string;
    body: string;
    cancelLabel: string;
    confirmLabel: string;
    busyLabel: string;
    busy: boolean;
    onConfirm: () => void;
  } => {
    if (!confirmSheet) return null;
    // Un'altra azione in corso: il foglio aspetta, non ne parte una seconda.
    const guard = (action: () => Promise<void>) => () => {
      if (busy === null) void action();
    };

    switch (confirmSheet.kind) {
      case "removePatrol": {
        const patrol = campDraft.patrols.find(
          (entry) => entry.id === confirmSheet.patrolId,
        );
        if (!patrol) return null;
        return {
          title: fillCopy(ADMIN.eliminaPattugliaTitolo, { nome: patrol.name }),
          body: campDraftDirty
            ? ADMIN.eliminaPattugliaCorpoBozza
            : ADMIN.eliminaPattugliaCorpo,
          cancelLabel: ADMIN.tieniPattuglia,
          confirmLabel: ADMIN.confermaEliminaPattuglia,
          busyLabel: ADMIN.salvataggio,
          busy: busy === "saveCampManagement",
          onConfirm: guard(() => handleRemovePatrolAndSave(patrol.id)),
        };
      }
      case "deleteQuestion": {
        const question = sortedQuestions.find(
          (entry) => entry.id === confirmSheet.questionId,
        );
        if (!question) return null;
        return {
          title: ADMIN.eliminaDomandaTitolo,
          body: ADMIN.eliminaDomandaCorpo,
          cancelLabel: ADMIN.tieniDomanda,
          confirmLabel: ADMIN.confermaEliminaDomanda,
          busyLabel: ADMIN.eliminazione,
          busy: busy === "deleteQuestion",
          onConfirm: guard(() => handleDeleteQuestion(question)),
        };
      }
      case "deleteActivity":
        return {
          title: fillCopy(ADMIN.eliminaAttivitaTitolo, {
            attivita: resolvedEvent.title,
          }),
          body: ADMIN.eliminaAttivitaCorpo,
          cancelLabel: ADMIN.tieniAttivita,
          confirmLabel: ADMIN.confermaEliminaAttivita,
          busyLabel: ADMIN.eliminazione,
          busy: busy === "delete",
          onConfirm: guard(handleDelete),
        };
      case "legacyApprovals":
        return {
          title: ADMIN.moduliVecchioMetodoTitolo,
          body: ADMIN.moduliVecchioMetodoCorpo,
          cancelLabel: ADMIN.nonOra,
          confirmLabel: ADMIN.confermaModuliVecchioMetodo,
          busyLabel: ADMIN.generazione,
          busy: busy === "backfillLegacyApprovals",
          onConfirm: guard(handleBackfillLegacyApprovals),
        };
      case "consentCompletion": {
        // Il foglio vale per l'elenco controllato: rifatto il controllo, si chiude.
        if (
          !consentCompletion ||
          consentCompletion.digest !== confirmSheet.digest ||
          consentCompletion.total !== confirmSheet.total
        ) {
          return null;
        }
        const total = confirmSheet.total;
        const n = String(total);
        return {
          title:
            total === 1
              ? ADMIN.completamentoTitoloUno
              : fillCopy(ADMIN.completamentoTitoloPiu, { n }),
          body: ADMIN.completamentoCorpo,
          cancelLabel: ADMIN.nonInviare,
          confirmLabel:
            total === 1
              ? ADMIN.confermaCompletamentoUno
              : fillCopy(ADMIN.confermaCompletamentoPiu, { n }),
          busyLabel: ADMIN.invio,
          busy: busy === "consentCompletionSend",
          onConfirm: guard(handleSendConsentCompletion),
        };
      }
      case "cancelRegistration": {
        const registration = sortedRegistrations.find(
          (entry) => entry.id === confirmSheet.registrationId,
        );
        if (!registration || registration.registrationStatus === "cancelled") {
          return null;
        }
        return {
          title: fillCopy(ADMIN.annullaIscrizioneTitolo, {
            nome: getRegistrationDisplayName(registration),
          }),
          body: fillCopy(ADMIN.annullaIscrizioneCorpo, {
            attivita: resolvedEvent.title,
          }),
          cancelLabel: ADMIN.tieniIscrizione,
          confirmLabel: ADMIN.confermaAnnulla,
          busyLabel: ADMIN.annullamento,
          busy:
            busy === "cancelRegistration" &&
            busyRegistrationId === registration.id,
          onConfirm: guard(() => handleAdminCancelRegistration(registration)),
        };
      }
      case "reactivateRegistration": {
        const registration = sortedRegistrations.find(
          (entry) => entry.id === confirmSheet.registrationId,
        );
        if (!registration || registration.registrationStatus !== "cancelled") return null;
        const plan = planAdminReactivate(registration, resolvedEvent.requiresParentAuthorization === true);
        return {
          title: fillCopy(ISCRITTI.riattivaTitolo, {
            nome: getRegistrationDisplayName(registration),
          }),
          body: plan.reopensRejection ? ISCRITTI.riattivaCorpoRifiuto : ISCRITTI.riattivaCorpoMail,
          cancelLabel: ISCRITTI.tieniAnnullata,
          confirmLabel: ISCRITTI.confermaRiattiva,
          busyLabel: ISCRITTI.riattivazione,
          busy:
            busy === "reactivateRegistration" &&
            busyRegistrationId === registration.id,
          onConfirm: guard(() => handleAdminReactivateRegistration(registration)),
        };
      }
      case "deleteRegistration": {
        const registration = sortedRegistrations.find(
          (entry) => entry.id === confirmSheet.registrationId,
        );
        if (!registration) return null;
        return {
          title: fillCopy(ADMIN.eliminaIscrizioneTitolo, {
            nome: getRegistrationDisplayName(registration),
          }),
          body: ADMIN.eliminaIscrizioneCorpo,
          cancelLabel: ADMIN.tieniIscrizione,
          confirmLabel: ADMIN.confermaEliminaIscrizione,
          busyLabel: ADMIN.eliminazione,
          busy:
            busy === "deleteRegistration" &&
            busyRegistrationId === registration.id,
          onConfirm: guard(() => handleAdminDeleteRegistration(registration)),
        };
      }
    }
  })();

  return (
    <div className={`page page--activity-ios page--admin-activity-detail${activeTab === "overnight" ? " page--room-planner" : ""}${activeTab === "records" ? " page--rna-wide" : ""}`}>
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Dettaglio non disponibile</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {actionInfo && !pageModalOpen ? (
        <div className="notice notice--info">
          <div>
            <h3>Informazione</h3>
            <p>{actionInfo}</p>
            {actionDownload ? (
              <p style={{ marginTop: "0.5rem" }}>
                <a
                  className="button button--primary button--small"
                  href={actionDownload.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {actionDownload.label}
                </a>{" "}
                <span className="subtle-text">
                  Il link scade tra 15 minuti.
                </span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {actionError && !pageModalOpen ? (
        <div className="notice notice--warning">
          <div>
            <h3>Azione non completata</h3>
            <p>{actionError}</p>
          </div>
        </div>
      ) : null}

      <section className="activity-ios-hero">
        <div
          className="activity-ios-hero__image"
          style={
            resolvedEvent.heroImageUrl
              ? { backgroundImage: `url(${resolvedEvent.heroImageUrl})` }
              : undefined
          }
        >
          {!resolvedEvent.heroImageUrl ? <AppIcon name="ticket" /> : null}
        </div>

        <div className="activity-ios-hero__content">
          <div className="activity-ios-chip-row">
            <StatusBadge
              label={getEventStatusLabel(effectiveStatus)}
              tone={getEventStatusTone(effectiveStatus)}
            />
            <span className="activity-ios-chip activity-ios-chip--blue">
              {getEventAudienceLabel(resolvedEvent.audience)}
            </span>
            {resolvedEvent.overnight ? (
              <span className="activity-ios-chip activity-ios-chip--violet">
                Pernottamento
              </span>
            ) : null}
          </div>

          <h1>{resolvedEvent.title}</h1>

          <p className="activity-ios-meta">
            <AppIcon name="calendar" />
            <span>
              {formatDateRange(resolvedEvent.startDate, resolvedEvent.endDate)}
            </span>
          </p>
          {resolvedEvent.location ? (
            <p className="activity-ios-meta">
              <AppIcon name="map-pin" />
              <span>{resolvedEvent.location}</span>
            </p>
          ) : null}
        </div>

        <div className="activity-ios-actions">
          {resolvedEvent.isPublic ? (
            <ShareButton
              className="activity-ios-action"
              iconOnly
              text="Guarda questa attività e apri l'iscrizione."
              title={resolvedEvent.title}
              url={getAbsoluteUrl(getActivityPath(resolvedEvent.id, stakeId))}
            />
          ) : null}
          <button
            aria-label="Modifica attività"
            className="activity-ios-action"
            onClick={() => {
              setActionInfo(null);
              setEditModalOpen(true);
            }}
            title="Modifica"
            type="button"
          >
            <AppIcon name="pencil" />
          </button>
          <button
            aria-label="Rendi pubblica"
            className="activity-ios-action"
            disabled={busy === "delete"}
            onClick={() => void handlePublish()}
            title="Pubblica"
            type="button"
          >
            <AppIcon name="globe" />
          </button>
          <button
            aria-label="Cancella attività"
            className="activity-ios-action activity-ios-action--danger"
            disabled={busy !== null}
            onClick={() => showConfirm({ kind: "deleteActivity" })}
            title="Cancella"
            type="button"
          >
            <AppIcon name="trash" />
          </button>
        </div>
      </section>

      <section className="activity-ios-metrics">
        <article className="activity-ios-metric">
          <span>
            <AppIcon name="users" />
          </span>
          <strong>{currentCount}</strong>
          <small>Attivi</small>
        </article>
        <article className="activity-ios-metric">
          <span>
            <AppIcon name="user" />
          </span>
          <strong>{sortedRegistrations.length}</strong>
          <small>Iscritti</small>
        </article>
        <article className="activity-ios-metric">
          <span>
            <AppIcon name="building" />
          </span>
          <strong>{resolvedEvent.overnight ? "Sì" : "No"}</strong>
          <small>Pernotto</small>
        </article>
      </section>

      {!isCampManagerOnly ? (
        <div
          className={subtabsCountClass}
          aria-label="Sezioni attività"
          role="tablist"
        >
        <button
          aria-pressed={activeTab === "details"}
          className={
            activeTab === "details"
              ? "admin-subtabs__item admin-subtabs__item--active"
              : "admin-subtabs__item"
          }
          onClick={() => openTab("details")}
          type="button"
        >
          <AppIcon name="list" />
          <span>Dettagli</span>
        </button>
        <button
          aria-pressed={activeTab === "committees"}
          className={
            activeTab === "committees"
              ? "admin-subtabs__item admin-subtabs__item--active"
              : "admin-subtabs__item"
          }
          onClick={() => openTab("committees")}
          type="button"
        >
          <AppIcon name="badge" />
          <span>Comitati</span>
        </button>
        <button
          aria-pressed={activeTab === "registrations"}
          className={
            activeTab === "registrations"
              ? "admin-subtabs__item admin-subtabs__item--active"
              : "admin-subtabs__item"
          }
          onClick={() => openTab("registrations")}
          type="button"
        >
          <AppIcon name="users" />
          <span>Iscritti</span>
        </button>
        <button
          aria-pressed={activeTab === "consents"}
          className={
            activeTab === "consents"
              ? "admin-subtabs__item admin-subtabs__item--active"
              : "admin-subtabs__item"
          }
          onClick={() => openTab("consents")}
          type="button"
        >
          <AppIcon name="lock" />
          <span>Consensi</span>
        </button>
        {resolvedEvent.overnight ? (
          <button
            aria-pressed={activeTab === "overnight"}
            className={
              activeTab === "overnight"
                ? "admin-subtabs__item admin-subtabs__item--active"
                : "admin-subtabs__item"
            }
            onClick={() => openTab("overnight")}
            type="button"
          >
            <AppIcon name="building" />
            <span>{overnightUnitPluralTitle}</span>
          </button>
        ) : null}
        {resolvedEvent.questionsEnabled ? (
          <button
            aria-pressed={activeTab === "questions"}
            className={
              activeTab === "questions"
                ? "admin-subtabs__item admin-subtabs__item--active"
                : "admin-subtabs__item"
            }
            onClick={() => openTab("questions")}
            type="button"
          >
            <AppIcon name="bell" />
            <span>Domande</span>
          </button>
        ) : null}
        {resolvedEvent.recordsEnabled ? (
          <button
            aria-pressed={activeTab === "records"}
            className={
              activeTab === "records"
                ? "admin-subtabs__item admin-subtabs__item--active"
                : "admin-subtabs__item"
            }
            onClick={() => openTab("records")}
            type="button"
          >
            <AppIcon name="sparkles" />
            <span>Record</span>
          </button>
        ) : null}
        <button
          aria-pressed={activeTab === "surveys"}
          className={
            activeTab === "surveys"
              ? "admin-subtabs__item admin-subtabs__item--active"
              : "admin-subtabs__item"
          }
          onClick={() => openTab("surveys")}
          type="button"
        >
          <AppIcon name="ticket" />
          <span>Sondaggi</span>
        </button>
        <button
          aria-pressed={activeTab === "gallery"}
          className={
            activeTab === "gallery"
              ? "admin-subtabs__item admin-subtabs__item--active"
              : "admin-subtabs__item"
          }
          onClick={() => openTab("gallery")}
          type="button"
        >
          <AppIcon name="eye" />
          <span>Galleria</span>
        </button>
        <button
          aria-pressed={activeTab === "stats"}
          className={
            activeTab === "stats"
              ? "admin-subtabs__item admin-subtabs__item--active"
              : "admin-subtabs__item"
          }
          onClick={() => openTab("stats")}
          type="button"
        >
          <AppIcon name="chart" />
          <span>Statistiche</span>
        </button>
        </div>
      ) : null}

      {activeTab === "details" ? (
        <section className="admin-detail-grid">
          <article className="surface-panel surface-panel--subtle">
            <h3>Panoramica</h3>
            <dl className="summary-list">
              <div>
                <dt>Stato</dt>
                <dd>
                  <StatusBadge
                    label={getEventStatusLabel(effectiveStatus)}
                    tone={getEventStatusTone(effectiveStatus)}
                  />
                </dd>
              </div>
              <div>
                <dt>Organizzazione</dt>
                <dd>{getEventAudienceLabel(resolvedEvent.audience)}</dd>
              </div>
              <div>
                <dt>Quando</dt>
                <dd>
                  {formatDateRange(
                    resolvedEvent.startDate,
                    resolvedEvent.endDate,
                  )}
                </dd>
              </div>
              <div>
                <dt>Luogo</dt>
                <dd>{resolvedEvent.location || "-"}</dd>
              </div>
              <div>
                <dt>Apertura iscrizioni</dt>
                <dd>{formatDateTime(resolvedEvent.registrationOpen)}</dd>
              </div>
              <div>
                <dt>Chiusura iscrizioni</dt>
                <dd>{formatDateTime(resolvedEvent.registrationClose)}</dd>
              </div>
              <div>
                <dt>Pernottamento</dt>
                <dd>{resolvedEvent.overnight ? "Sì" : "No"}</dd>
              </div>
              <div>
                <dt>Capienza</dt>
                <dd>
                  {resolvedEvent.maxParticipants
                    ? `${resolvedEvent.maxParticipants} posti`
                    : "-"}
                </dd>
              </div>
            </dl>
          </article>

          {resolvedEvent.description ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Descrizione</h3>
              <p>{resolvedEvent.description}</p>
            </article>
          ) : null}

          {resolvedEvent.program ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Programma</h3>
              <p>{resolvedEvent.program}</p>
            </article>
          ) : null}

          {resolvedEvent.publicNotes ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Note pubbliche</h3>
              <p>{resolvedEvent.publicNotes}</p>
            </article>
          ) : null}

          {resolvedEvent.menuInfo ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Menu</h3>
              <p>{resolvedEvent.menuInfo}</p>
            </article>
          ) : null}

          {resolvedEvent.allergiesInfo ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Allergie e indicazioni</h3>
              <p>{resolvedEvent.allergiesInfo}</p>
            </article>
          ) : null}

          {resolvedEvent.roomsInfo ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>{overnightUnitPluralTitle} e logistica</h3>
              <p>{resolvedEvent.roomsInfo}</p>
            </article>
          ) : null}

          {resolvedEvent.whatToBring ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Cosa portare</h3>
              <p>{resolvedEvent.whatToBring}</p>
            </article>
          ) : null}

          {resolvedEvent.organizerNotes ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Note organizzative</h3>
              <p>{resolvedEvent.organizerNotes}</p>
            </article>
          ) : null}
        </section>
      ) : null}

      {activeTab === "committees" ? (
        <section className="admin-detail-stack">
          {session?.isAdmin && eventId && event && isCampEvent(event) ? (
            <CampStaffSection eventId={eventId} stakeId={stakeId} />
          ) : null}

          <div className="admin-inline-metrics admin-inline-metrics--four">
            <article className="admin-inline-metric">
              <strong>{campDraft.committees.length}</strong>
              <span>Comitati</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{campDraft.patrols.length}</strong>
              <span>Pattuglie</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{assignedCommitteeCount}</strong>
              <span>Con comitato</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{assignedPatrolCount}</strong>
              <span>Con pattuglia</span>
            </article>
          </div>

          <article className="surface-panel surface-panel--subtle admin-roster">
            <div className="section-head admin-roster__head">
              <div>
                <h3>Comitati campeggio</h3>
                <p>
                  Dirigenti a capo e giovani membri. Ogni persona può stare in
                  un solo comitato.
                </p>
              </div>
              <div className="admin-section-actions">
                <button
                  className="button button--ghost button--small"
                  disabled={downloadingExcel}
                  onClick={() => void handleDownloadCampManagementExcel()}
                  type="button"
                >
                  <AppIcon name="download" />
                  <span>{downloadingExcel ? "Preparazione..." : "Excel"}</span>
                </button>
                <button
                  className="button button--primary button--small"
                  disabled={busy === "saveCampManagement" || loading}
                  onClick={() => void handleSaveCampManagement()}
                  type="button"
                >
                  <AppIcon name="check" />
                  <span>
                    {busy === "saveCampManagement"
                      ? "Salvataggio..."
                      : campDraftDirty
                        ? "Salva modifiche"
                        : "Salvato"}
                  </span>
                </button>
              </div>
            </div>

            {campDraftDirty ? (
              <div className="camp-save-state" role="status">
                <AppIcon name="bell" />
                <span>Modifiche non ancora salvate</span>
              </div>
            ) : null}

            <div className="form-stack form-stack--compact">
              <label className="field">
                <span className="field__label">
                  Dirigente non ancora iscritto
                </span>
                <div className="inline-actions">
                  <input
                    className="input"
                    value={manualLeaderName}
                    onChange={(eventInput) =>
                      setManualLeaderName(eventInput.target.value)
                    }
                    placeholder="Nome e cognome"
                  />
                  <button
                    className="button button--secondary button--small"
                    onClick={addManualLeader}
                    type="button"
                  >
                    <AppIcon name="plus" />
                    <span>Aggiungi</span>
                  </button>
                </div>
              </label>

              {campDraft.manualLeaders.length > 0 ? (
                <div className="chip-row admin-chip-row">
                  {campDraft.manualLeaders.map((leader) => (
                    <span className="chip" key={leader.id}>
                      {leader.fullName}
                      {leader.linkedRegistrationId ? " · collegato" : ""}
                      <button
                        aria-label={`Rimuovi ${leader.fullName}`}
                        className="chip__button"
                        onClick={() => removeManualLeader(leader.id)}
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="camp-committee-grid">
              {campDraft.committees.map((committee) => {
                const leaderNames = [
                  ...committee.leaderRegistrationIds.map((registrationId) =>
                    getRegistrationName(registrationId),
                  ),
                  ...committee.manualLeaderIds.map(
                    (leaderId) =>
                      manualLeaderById.get(leaderId)?.fullName ?? "Dirigente",
                  ),
                ];
                const previewNames = [
                  ...leaderNames,
                  ...committee.memberRegistrationIds
                    .slice(0, Math.max(0, 4 - leaderNames.length))
                    .map((registrationId) =>
                      getRegistrationName(registrationId),
                    ),
                ];

                return (
                  <button
                    className="camp-ios-card camp-ios-card--committee"
                    key={committee.id}
                    onClick={() => openCampCommittee(committee.id)}
                    type="button"
                  >
                    <span className="camp-ios-card__icon" aria-hidden="true">
                      {committee.emoji}
                    </span>
                    <span className="camp-ios-card__body">
                      <strong>{committee.title}</strong>
                      <small>
                        {committee.leaderRegistrationIds.length +
                          committee.manualLeaderIds.length}{" "}
                        dirigenti
                        {" · "}
                        {committee.memberRegistrationIds.length} giovani
                      </small>
                      <span className="camp-ios-card__preview">
                        {previewNames.length > 0
                          ? previewNames.join(", ")
                          : "Tocca per assegnare"}
                      </span>
                    </span>
                    <AppIcon name="arrow-right" />
                  </button>
                );
              })}
            </div>
          </article>

          <article className="surface-panel surface-panel--subtle admin-roster">
            <div className="section-head admin-roster__head">
              <div>
                <h3>Pattuglie</h3>
                <p>
                  Crea pattuglie e assegna capo pattuglia, supervisori e membri.
                </p>
              </div>
              <div className="admin-section-actions">
                <button
                  className="button button--secondary button--small"
                  onClick={addPatrol}
                  type="button"
                >
                  <AppIcon name="plus" />
                  <span>Aggiungi pattuglia</span>
                </button>
              </div>
            </div>

            {campDraft.patrols.length === 0 ? (
              <EmptyState
                title="Nessuna pattuglia"
                description="Aggiungi la prima pattuglia e assegna i partecipanti."
              />
            ) : (
              <div className="camp-committee-grid">
                {campDraft.patrols.map((patrol) => {
                  const previewNames = [
                    patrol.leaderRegistrationId
                      ? getRegistrationName(patrol.leaderRegistrationId)
                      : "",
                    ...patrol.supervisorRegistrationIds.map((registrationId) =>
                      getRegistrationName(registrationId),
                    ),
                    ...patrol.manualSupervisorIds.map(
                      (manualSupervisorId) =>
                        manualLeaderById.get(manualSupervisorId)?.fullName ?? "",
                    ),
                    ...patrol.memberRegistrationIds.map((registrationId) =>
                      getRegistrationName(registrationId),
                    ),
                  ].filter(Boolean);

                  return (
                    <button
                      className="camp-ios-card camp-ios-card--patrol"
                      key={patrol.id}
                      onClick={() => openCampPatrol(patrol.id)}
                      type="button"
                    >
                      <span className="camp-ios-card__icon" aria-hidden="true">
                        🧭
                      </span>
                      <span className="camp-ios-card__body">
                        <strong>{patrol.name}</strong>
                        <small>
                          {patrol.leaderRegistrationId
                            ? "Capo assegnato"
                            : "Capo mancante"}
                          {" · "}
                          {patrol.supervisorRegistrationIds.length +
                            patrol.manualSupervisorIds.length}{" "}
                          supervisori
                          {" · "}
                          {patrol.memberRegistrationIds.length} membri
                        </small>
                        <span className="camp-ios-card__preview">
                          {previewNames.length > 0
                            ? previewNames.slice(0, 4).join(", ")
                            : "Tocca per assegnare"}
                        </span>
                      </span>
                      <AppIcon name="arrow-right" />
                    </button>
                  );
                })}
              </div>
            )}
          </article>
        </section>
      ) : null}

      {activeTab === "registrations" ? (
        <RegistrationsTab
          activityType={resolvedEvent.activityType}
          canReadConsentTasks={session?.isAdmin === true}
          currentCount={currentCount}
          downloadingExcel={downloadingExcel}
          filters={registrationFilters}
          onFiltersChange={setRegistrationFilters}
          eventId={resolvedEventId}
          loading={loading}
          onAddManual={session?.isAdmin ? openAddManualSheet : undefined}
          onDownloadYouthExcel={() => void handleDownloadYouthRegistrantsExcel()}
          onOpenExcelExport={openExcelExportModal}
          onOpenRegistration={(registrationId) =>
            openRegistrationModal(registrationId, "registration")
          }
          pageBusy={busy !== null}
          sessionUid={session?.firebaseUser.uid ?? null}
          sortedRegistrations={sortedRegistrations}
          stakeId={stakeId}
        />
      ) : null}

      {activeTab === "consents" ? (
        <section className="admin-detail-stack">
          <div className="admin-inline-metrics admin-inline-metrics--four">
            <article className="admin-inline-metric">
              <strong>{activeRegistrations.length}</strong>
              <span>Attivi</span>
            </article>
            <article className="admin-inline-metric">
              <strong>
                {
                  activeRegistrations.filter(
                    (registration) =>
                      getParentAuthorizationBadge(
                        registration,
                        Boolean(resolvedEvent.requiresParentAuthorization),
                      ).tone === "success",
                  ).length
                }
              </strong>
              <span>Email OK</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{uploadedMinorConsentCount}</strong>
              <span>Doc. genitore</span>
            </article>
            <article className="admin-inline-metric">
              <strong>
                {
                  activeRegistrations.filter(
                    (registration) =>
                      (resolvedEvent.requiresParentAuthorization &&
                        getParentAuthorizationBadge(registration, true).tone !==
                          "success") ||
                      (resolvedEvent.requiresParentalConsent &&
                        registration.answers.parentalConsentAccepted !==
                          true) ||
                      (resolvedEvent.requiresPhotoRelease &&
                        registration.answers.photoReleaseAccepted !== true) ||
                      (isMinorRegistration(registration) &&
                        !registration.parentConsentDocumentUrl),
                  ).length
                }
              </strong>
              <span>Da verificare</span>
            </article>
          </div>

          {session?.isAdmin ? (
            <article className="consent-completion">
              <div>
                <h3>Scelte su foto e social da completare</h3>
                <p>
                  Chi ha firmato quando le scelte su foto e social erano
                  facoltative e non ha risposto a una o a entrambe riceve una
                  email con un link per completarle. Prima si controlla
                  l'elenco, poi si decide se inviare.
                </p>
              </div>
              <div className="admin-section-actions">
                <button
                  className="button button--ghost button--small"
                  disabled={busy !== null || loading}
                  onClick={() => void handleCheckConsentCompletion()}
                  type="button"
                >
                  <AppIcon name="refresh" />
                  <span>
                    {busy === "consentCompletionCheck"
                      ? "Controllo..."
                      : "Controlla chi riceverebbe la mail"}
                  </span>
                </button>
              </div>

              {consentCompletion ? (
                consentCompletion.total === 0 ? (
                  <p>
                    Nessuno da contattare
                    {consentCompletion.skippedAlreadyRequested > 0
                      ? `: ${consentCompletion.skippedAlreadyRequested} hanno già ricevuto la richiesta`
                      : ""}
                    .
                  </p>
                ) : (
                  <>
                    <p>
                      {consentCompletion.total} genitori riceverebbero la mail
                      {consentCompletion.skippedAlreadyRequested > 0
                        ? `, ${consentCompletion.skippedAlreadyRequested} già contattati saltati`
                        : ""}
                      {consentCompletion.skippedNoEmail > 0
                        ? `, ${consentCompletion.skippedNoEmail} senza email saltati`
                        : ""}
                      . Nessuna email è ancora partita.
                    </p>
                    <div className="consent-completion__list">
                      {consentCompletion.candidates.map(
                        (candidate: ConsentCompletionCandidate) => (
                          <div
                            className="consent-completion__row"
                            key={`${candidate.activityId}-${candidate.registrationId}`}
                          >
                            <strong>{candidate.participantName}</strong>
                            <span>
                              {candidate.parentEmail} - manca:{" "}
                              {candidate.missing.length === 2
                                ? "foto e social"
                                : candidate.missing[0] === "photo"
                                  ? "foto"
                                  : "social"}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                    {consentCompletion.preview ? (
                      <div className="consent-completion__preview">
                        <strong>{consentCompletion.preview.subject}</strong>
                        {consentCompletion.preview.paragraphs.map(
                          (paragraph, index) => (
                            <p key={index}>{paragraph}</p>
                          ),
                        )}
                      </div>
                    ) : null}
                    <div className="admin-section-actions">
                      <button
                        className="button button--primary button--small"
                        disabled={busy !== null}
                        onClick={() =>
                          showConfirm({
                            kind: "consentCompletion",
                            digest: consentCompletion.digest,
                            total: consentCompletion.total,
                          })
                        }
                        type="button"
                      >
                        <AppIcon name="mail" />
                        <span>
                          {busy === "consentCompletionSend"
                            ? "Invio..."
                            : `Invia ${consentCompletion.total} email`}
                        </span>
                      </button>
                    </div>
                  </>
                )
              ) : null}

              {consentCompletionOutcome ? (
                <div>
                  <p>
                    Inviate {consentCompletionOutcome.sent} email su{" "}
                    {consentCompletionOutcome.total}
                    {consentCompletionOutcome.simulated > 0
                      ? ` (${consentCompletionOutcome.simulated} simulate)`
                      : ""}
                    {consentCompletionOutcome.errors.length > 0
                      ? `, ${consentCompletionOutcome.errors.length} con errore`
                      : ""}
                    .
                  </p>
                  {consentCompletionOutcome.errors.length > 0 ? (
                    <ul className="consent-completion__errors">
                      {consentCompletionOutcome.errors.map((item) => (
                        <li key={`${item.activityId}-${item.registrationId}`}>
                          {item.registrationId}: {item.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </article>
          ) : null}

          {activeRegistrations.length === 0 ? (
            <EmptyState
              title="Nessuna iscrizione attiva"
              description="Quando arrivano le iscrizioni vedrai qui lo stato dei consensi."
            />
          ) : (
            <article className="surface-panel surface-panel--subtle admin-consent-list">
              <div className="section-head admin-roster__head">
                <div>
                  <h3>Elenco consensi</h3>
                  <p>
                    {signedParentAuthorizationCount > 0
                      ? `${signedParentAuthorizationCount} moduli firmati disponibili per il download.`
                      : "I moduli firmati appariranno qui appena i genitori completano il link."}
                  </p>
                </div>
                <div className="admin-section-actions">
                  <button
                    className="button button--ghost button--small"
                    disabled={
                      busy !== null ||
                      loading ||
                      legacyApprovedWithoutPdfCount === 0
                    }
                    onClick={() => showConfirm({ kind: "legacyApprovals" })}
                    type="button"
                  >
                    <AppIcon name="refresh" />
                    <span>
                      {busy === "backfillLegacyApprovals"
                        ? "Conversione..."
                        : `Fallback legacy${
                            legacyApprovedWithoutPdfCount > 0
                              ? ` (${legacyApprovedWithoutPdfCount})`
                              : ""
                          }`}
                    </span>
                  </button>
                  <button
                    className="button button--ghost button--small"
                    disabled={
                      busy !== null ||
                      loading ||
                      signedParentAuthorizationCount === 0
                    }
                    onClick={() => void handleDownloadSignedConsentsZip()}
                    type="button"
                  >
                    <AppIcon name="download" />
                    <span>
                      {busy === "downloadSignedConsentsZip"
                        ? "Preparazione..."
                        : "Scarica ZIP moduli firmati"}
                    </span>
                  </button>
                </div>
              </div>

              {activeRegistrations.map((registration) => {
                const authBadge = getParentAuthorizationBadge(
                  registration,
                  Boolean(resolvedEvent.requiresParentAuthorization),
                );
                const isSelected =
                  selectedConsentRegistrationId === registration.id;
                const isEmailEditing = parentEmailEditingId === registration.id;
                const isCurrentBusy = busyRegistrationId === registration.id;
                const parentEmail = getParentEmail(registration);
                const parentName = getParentName(registration);
                const parentalAccepted =
                  registration.answers.parentalConsentAccepted === true;
                const photoAccepted =
                  registration.answers.photoReleaseAccepted === true;
                const signerName =
                  typeof registration.answers.parentalConsentSignerName ===
                    "string" && registration.answers.parentalConsentSignerName
                    ? registration.answers.parentalConsentSignerName
                    : typeof registration.answers.photoReleaseSignerName ===
                        "string"
                      ? registration.answers.photoReleaseSignerName
                      : "";
                const parentAuthStatus =
                  registration.parentAuthorization?.status ?? "missing";
                const hasSignedParentAuthorizationPdf =
                  parentAuthStatus === "authorized" &&
                  Boolean(registration.parentAuthorization?.pdfPath);
                // Un'iscrizione annullata non riceve più mail: il server la rifiuta.
                const canResendParentEmail =
                  resolvedEvent.requiresParentAuthorization &&
                  registration.registrationStatus !== "cancelled" &&
                  parentAuthStatus !== "authorized" &&
                  parentAuthStatus !== "rejected_by_parent";

                return (
                  <article
                    className={
                      isSelected
                        ? "admin-consent-item admin-consent-item--open"
                        : "admin-consent-item"
                    }
                    key={`consent-${registration.id}`}
                  >
                    <button
                      aria-expanded={isSelected}
                      className="admin-consent-summary"
                      onClick={() =>
                        setSelectedConsentRegistrationId(
                          isSelected ? null : registration.id,
                        )
                      }
                      type="button"
                    >
                      <span className="admin-consent-summary__person">
                        <strong>
                          {getRegistrationDisplayName(registration)}
                        </strong>
                        <span>
                          {getUnitLabel(registration)} •{" "}
                          {getCategoryShortLabel(registration)}
                        </span>
                      </span>
                      <span className="chip-row admin-chip-row admin-consent-summary__badges">
                        {resolvedEvent.requiresParentAuthorization ? (
                          <StatusBadge
                            label={authBadge.label}
                            tone={authBadge.tone}
                          />
                        ) : null}
                        {resolvedEvent.requiresParentalConsent ? (
                          <StatusBadge
                            label={
                              parentalAccepted ? "Genitore OK" : "Genitore NO"
                            }
                            tone={parentalAccepted ? "success" : "warning"}
                          />
                        ) : null}
                        {resolvedEvent.requiresPhotoRelease &&
                        getPhotoConsentBadges(registration) === null ? (
                          <StatusBadge
                            label={photoAccepted ? "Foto OK" : "Foto NO"}
                            tone={photoAccepted ? "success" : "warning"}
                          />
                        ) : null}
                        <StatusBadge
                          label={
                            registration.consentSignatureUrl
                              ? "Firma"
                              : "No firma"
                          }
                          tone={
                            registration.consentSignatureUrl
                              ? "success"
                              : "warning"
                          }
                        />
                        <StatusBadge
                          label={
                            registration.parentIdDocumentUrl ? "ID" : "No ID"
                          }
                          tone={
                            registration.parentIdDocumentUrl
                              ? "success"
                              : "warning"
                          }
                        />
                        <PhotoConsentPills registration={registration} />
                        {isMinorRegistration(registration) ? (
                          <StatusBadge
                            label={
                              registration.parentConsentDocumentUrl ||
                              registration.parentAuthorization?.pdfPath
                                ? "Doc"
                                : "No doc"
                            }
                            tone={
                              registration.parentConsentDocumentUrl ||
                              registration.parentAuthorization?.pdfPath
                                ? "success"
                                : "warning"
                            }
                          />
                        ) : null}
                      </span>
                    </button>

                    {isSelected ? (
                      <div className="admin-consent-detail">
                        <dl className="summary-list admin-consent-detail__summary">
                          <div>
                            <dt>Email partecipante</dt>
                            <dd>{registration.email || "-"}</dd>
                          </div>
                          <div>
                            <dt>Genitore</dt>
                            <dd>{parentName || "-"}</dd>
                          </div>
                          <div>
                            <dt>Email genitore</dt>
                            <dd>{parentEmail || "-"}</dd>
                          </div>
                          <div>
                            <dt>Firmatario</dt>
                            <dd>{signerName || "-"}</dd>
                          </div>
                          {registration.parentAuthorization?.emailSentAt ? (
                            <div>
                              <dt>Ultimo invio</dt>
                              <dd>
                                {formatDateTime(
                                  registration.parentAuthorization.emailSentAt,
                                )}
                              </dd>
                            </div>
                          ) : null}
                        </dl>

                        {resolvedEvent.requiresParentAuthorization ? (
                          <div className="admin-consent-email-editor">
                            {isEmailEditing ? (
                              <>
                                <label className="field admin-consent-email-field">
                                  <span>Email genitore</span>
                                  <input
                                    className="input"
                                    onChange={(eventInput) =>
                                      setParentEmailDraft(
                                        eventInput.target.value,
                                      )
                                    }
                                    type="email"
                                    value={parentEmailDraft}
                                  />
                                </label>
                                <div className="inline-actions">
                                  <button
                                    className="button button--primary button--small"
                                    disabled={busy !== null}
                                    onClick={() =>
                                      void handleSaveParentEmail(registration)
                                    }
                                    type="button"
                                  >
                                    <AppIcon name="check" />
                                    <span>
                                      {isCurrentBusy &&
                                      busy === "saveParentEmail"
                                        ? "Salvataggio..."
                                        : "Salva email"}
                                    </span>
                                  </button>
                                  <button
                                    className="button button--ghost button--small"
                                    disabled={busy !== null}
                                    onClick={() => {
                                      setParentEmailEditingId(null);
                                      setParentEmailDraft("");
                                    }}
                                    type="button"
                                  >
                                    Annulla
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="inline-actions">
                                <button
                                  className="button button--ghost button--small"
                                  disabled={busy !== null}
                                  onClick={() =>
                                    handleStartParentEmailEdit(registration)
                                  }
                                  type="button"
                                >
                                  <AppIcon name="pencil" />
                                  <span>Modifica email genitore</span>
                                </button>
                                {canResendParentEmail ? (
                                  <button
                                    className="button button--ghost button--small"
                                    disabled={busy !== null || !parentEmail}
                                    onClick={() =>
                                      void handleResendParentAuthEmail(
                                        registration,
                                      )
                                    }
                                    type="button"
                                  >
                                    <AppIcon name="mail" />
                                    <span>
                                      {isCurrentBusy &&
                                      busy === "resendParentAuth"
                                        ? "Reinvio..."
                                        : "Reinvia email"}
                                    </span>
                                  </button>
                                ) : null}
                              </div>
                            )}
                            {registration.parentAuthorization
                              ?.emailLastError ? (
                              <p className="admin-consent-error">
                                {
                                  registration.parentAuthorization
                                    .emailLastError
                                }
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="admin-consent-actions">
                          {registration.consentSignatureUrl ? (
                            <a
                              className="button button--ghost button--small"
                              href={registration.consentSignatureUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <AppIcon name="eye" />
                              <span>Firma</span>
                            </a>
                          ) : null}
                          {registration.parentIdDocumentUrl ? (
                            <a
                              className="button button--ghost button--small"
                              href={registration.parentIdDocumentUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <AppIcon name="eye" />
                              <span>ID genitore</span>
                            </a>
                          ) : null}
                          {registration.parentConsentDocumentUrl ? (
                            <a
                              className="button button--ghost button--small"
                              href={registration.parentConsentDocumentUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <AppIcon name="eye" />
                              <span>Doc. genitore</span>
                            </a>
                          ) : null}
                          {hasSignedParentAuthorizationPdf ? (
                            <button
                              className="button button--ghost button--small"
                              disabled={busy !== null}
                              onClick={() =>
                                void handleDownloadSignedConsent(registration)
                              }
                              type="button"
                            >
                              <AppIcon name="download" />
                              <span>
                                {isCurrentBusy &&
                                busy === "downloadSignedConsent"
                                  ? "Apro..."
                                  : "Modulo firmato"}
                              </span>
                            </button>
                          ) : null}
                          {registration.parentAuthorization?.conductPdfPath ? (
                            <button
                              className="button button--ghost button--small"
                              disabled={busy !== null}
                              onClick={() =>
                                void handleDownloadSignedConsent(
                                  registration,
                                  "conduct",
                                )
                              }
                              type="button"
                            >
                              <AppIcon name="download" />
                              <span>Regolamento</span>
                            </button>
                          ) : null}
                          {resolvedEvent.requiresParentalConsent ? (
                            <button
                              className="button button--ghost button--small"
                              onClick={async () => {
                                try {
                                  const { downloadConsentPdf } =
                                    await import("@/utils/consentPdf");
                                  await downloadConsentPdf({
                                    event: resolvedEvent,
                                    registration,
                                    kind: "parental",
                                    signatureDataUrl:
                                      registration.consentSignatureUrl ?? null,
                                  });
                                } catch (caughtError) {
                                  setActionError(
                                    caughtError instanceof Error
                                      ? caughtError.message
                                      : "PDF non generato.",
                                  );
                                }
                              }}
                              type="button"
                            >
                              <AppIcon name="download" />
                              <span>PDF consenso</span>
                            </button>
                          ) : null}
                          {resolvedEvent.requiresPhotoRelease ? (
                            <button
                              className="button button--ghost button--small"
                              onClick={async () => {
                                try {
                                  const { downloadConsentPdf } =
                                    await import("@/utils/consentPdf");
                                  await downloadConsentPdf({
                                    event: resolvedEvent,
                                    registration,
                                    kind: "photo",
                                    signatureDataUrl:
                                      registration.consentSignatureUrl ?? null,
                                  });
                                } catch (caughtError) {
                                  setActionError(
                                    caughtError instanceof Error
                                      ? caughtError.message
                                      : "PDF non generato.",
                                  );
                                }
                              }}
                              type="button"
                            >
                              <AppIcon name="download" />
                              <span>PDF liberatoria</span>
                            </button>
                          ) : null}
                          <button
                            className="button button--ghost button--small"
                            onClick={() =>
                              openRegistrationModal(
                                registration.id,
                                "registration",
                              )
                            }
                            type="button"
                          >
                            Apri iscrizione
                          </button>
                          <button
                            className="button button--ghost button--small button--danger"
                            disabled={busy !== null}
                            onClick={() =>
                              showConfirm({
                                kind: "deleteRegistration",
                                registrationId: registration.id,
                              })
                            }
                            type="button"
                          >
                            <AppIcon name="trash" />
                            <span>
                              {isCurrentBusy && busy === "deleteRegistration"
                                ? "Eliminazione..."
                                : "Elimina"}
                            </span>
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </article>
          )}
        </section>
      ) : null}

      {activeTab === "overnight" && resolvedEvent.overnight ? (
        <><RoomManagementPanel
          stakeId={stakeId}
          activityId={resolvedEventId}
          registrations={sortedRegistrations}
          referenceDate={resolvedEvent.startDate}
        />
        <details className="surface-panel">
          <summary>Preferenze originali e note</summary>
          <div className="admin-section-actions">
            <button className="button button--secondary button--small" disabled={normalizingRoomPreferences || loading} onClick={() => void handleNormalizeRoomPreferences()} type="button">
              {normalizingRoomPreferences ? "Normalizzazione..." : "Normalizza richieste"}
            </button>
            <button className="button button--ghost button--small" disabled={downloadingExcel || loading} onClick={openExcelExportModal} type="button">Scarica Excel</button>
          </div>
          <div className="admin-roster__list">{activeRegistrations.map((registration) => <button key={registration.id} className="admin-roster-row" type="button" onClick={() => openRegistrationModal(registration.id, "overnight")}>
            <strong>{getRegistrationDisplayName(registration)}</strong>
            <small>{getRoomPreferenceEntries(registration).map((entry) => entry.value).join(" · ") || "Nessuna preferenza stanza"}</small>
          </button>)}</div>
        </details></>
      ) : null}

      {activeTab === "questions" && resolvedEvent.questionsEnabled ? (
        <section className="admin-detail-stack">
          <div className="admin-inline-metrics admin-inline-metrics--three">
            <article className="admin-inline-metric">
              <strong>{visibleQuestions.length}</strong>
              <span>Visibili</span>
            </article>
            <article className="admin-inline-metric">
              <strong>
                {
                  visibleQuestions.filter((question) => question.isAnonymous)
                    .length
                }
              </strong>
              <span>Anonime</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{hiddenQuestions.length}</strong>
              <span>Nascoste</span>
            </article>
          </div>

          {questionsError ? (
            <div className="notice notice--warning">
              <div>
                <h3>Domande non disponibili</h3>
                <p>{questionsError}</p>
              </div>
            </div>
          ) : null}

          {questionsLoading ? (
            <p className="subtle-text">Sto caricando le domande...</p>
          ) : sortedQuestions.length === 0 ? (
            <EmptyState
              title="Nessuna domanda inviata"
              description="Le domande dei partecipanti compariranno qui appena vengono inviate."
            />
          ) : (
            <article className="surface-panel surface-panel--subtle admin-roster">
              <div className="section-head admin-roster__head">
                <div>
                  <h3>Elenco domande</h3>
                  <p>
                    Le domande anonime non mostrano l'autore. Usa "Nascondi" per
                    escluderle dal riepilogo da girare al Settanta.
                  </p>
                </div>
                <div className="admin-section-actions">
                  <button
                    className="button button--ghost button--small"
                    disabled={visibleQuestions.length === 0}
                    onClick={() => void handleExportQuestionsPdf()}
                    type="button"
                  >
                    <AppIcon name="download" />
                    <span>Esporta PDF</span>
                  </button>
                </div>
              </div>

              <ul className="plain-list">
                {sortedQuestions.map((question) => {
                  const isHidden = question.status === "hidden";
                  const author = question.isAnonymous
                    ? "Anonima"
                    : question.authorName || "Senza nome";
                  const ownerRegistration = registrationLookupById.get(
                    question.registrationId,
                  );
                  const unitLabel =
                    !question.isAnonymous && ownerRegistration
                      ? getUnitLabel(ownerRegistration)
                      : "";

                  return (
                    <li
                      key={`question-${question.id}`}
                      className={isHidden ? "is-hidden" : undefined}
                    >
                      <strong>
                        {author}
                        {unitLabel ? ` • ${unitLabel}` : ""}
                        {isHidden ? " • Nascosta" : ""}
                      </strong>
                      <span>{question.text}</span>
                      <small>
                        Inviata il {formatDateTime(question.createdAt)}
                      </small>
                      <div className="inline-actions inline-actions--compact">
                        <button
                          className="button button--ghost button--small"
                          onClick={() =>
                            void handleToggleQuestionStatus(question)
                          }
                          type="button"
                        >
                          <AppIcon name={isHidden ? "eye" : "lock"} />
                          <span>{isHidden ? "Ripristina" : "Nascondi"}</span>
                        </button>
                        <button
                          className="button button--ghost button--small"
                          onClick={() =>
                            showConfirm({
                              kind: "deleteQuestion",
                              questionId: question.id,
                            })
                          }
                          type="button"
                        >
                          <AppIcon name="trash" />
                          <span>Elimina</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          )}
        </section>
      ) : null}

      {activeTab === "records" && resolvedEvent.recordsEnabled ? (
        <RecordNightAdminTab
          canManageStaff={session?.isAdmin === true}
          event={resolvedEvent}
          stakeId={stakeId}
        />
      ) : null}

      {activeTab === "surveys" ? (
        <section className="admin-detail-stack">
          <article className="surface-panel surface-panel--subtle">
            <h3>Domande del sondaggio</h3>
            <p className="subtle-text">
              Crea/modifica domande di feedback per questa attività. Le risposte
              degli utenti sono anonime: si vede solo la categoria.
            </p>
            <SurveyEditor stakeId={stakeId} eventId={resolvedEventId} />
          </article>
          <article className="surface-panel surface-panel--subtle">
            <h3>Risultati</h3>
            <SurveyResultsPanel stakeId={stakeId} eventId={resolvedEventId} />
          </article>
        </section>
      ) : null}

      {activeTab === "gallery" ? (
        <section className="admin-detail-stack">
          <GalleryAdminTab event={resolvedEvent} />
        </section>
      ) : null}

      {activeTab === "stats" ? (
        <section className="admin-detail-stack">
          <div className="admin-inline-metrics admin-inline-metrics--five">
            <article className="admin-inline-metric">
              <strong>{currentCount}</strong>
              <span>Attivi</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{authenticatedCount}</strong>
              <span>Con account</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{anonymousCount}</strong>
              <span>Ospiti</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{averageAge ?? "-"}</strong>
              <span>Età media</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{averageRegistrations}</strong>
              <span>Media</span>
            </article>
          </div>

          <div className="card-grid card-grid--three admin-stats-panels">
            <article className="surface-panel surface-panel--subtle">
              <h3>Unità</h3>
              <ul className="plain-list plain-list--compact">
                {unitDistribution.length > 0 ? (
                  unitDistribution.map((item) => (
                    <li key={`unit-${item.label}`}>
                      <strong>{item.label}</strong>
                      <span>
                        {item.count} • {item.percent}%
                      </span>
                    </li>
                  ))
                ) : (
                  <li>
                    <strong>Nessun dato</strong>
                    <span>-</span>
                  </li>
                )}
              </ul>
            </article>

            <article className="surface-panel surface-panel--subtle">
              <h3>Organizzazione</h3>
              <ul className="plain-list plain-list--compact">
                {organizationDistribution.length > 0 ? (
                  organizationDistribution.map((item) => (
                    <li key={`org-${item.label}`}>
                      <strong>{item.label}</strong>
                      <span>
                        {item.count} • {item.percent}%
                      </span>
                    </li>
                  ))
                ) : (
                  <li>
                    <strong>Nessun dato</strong>
                    <span>-</span>
                  </li>
                )}
              </ul>
            </article>

            <article className="surface-panel surface-panel--subtle">
              <h3>Città</h3>
              <ul className="plain-list plain-list--compact">
                {cityDistribution.length > 0 ? (
                  cityDistribution.map((item) => (
                    <li key={`city-${item.label}`}>
                      <strong>{item.label}</strong>
                      <span>
                        {item.count} • {item.percent}%
                      </span>
                    </li>
                  ))
                ) : (
                  <li>
                    <strong>Nessun dato</strong>
                    <span>-</span>
                  </li>
                )}
              </ul>
            </article>
          </div>
        </section>
      ) : null}

      {selectedCampCommittee ? (
        <AppModal
          title={`${selectedCampCommittee.emoji} ${selectedCampCommittee.title}`}
          subtitle="Dirigenti e giovani assegnati al comitato"
          size="wide"
          onClose={closeCampModal}
          footer={
            <>
              <ModalFeedback error={actionError} />
              <button
                className="button button--ghost"
                onClick={closeCampModal}
                type="button"
              >
                {campDraftDirty ? "Chiudi senza salvare" : "Chiudi"}
              </button>
              <button
                className="button button--primary"
                disabled={busy === "saveCampManagement" || loading}
                onClick={() =>
                  void handleSaveCampManagement({ closeModal: true })
                }
                type="button"
              >
                {busy === "saveCampManagement" ? "Salvataggio..." : "Salva e chiudi"}
              </button>
            </>
          }
        >
          <div className="camp-modal-stack">
            {campDraftDirty ? (
              <div className="camp-save-state camp-save-state--modal" role="status">
                <AppIcon name="bell" />
                <span>Modifiche non ancora salvate</span>
              </div>
            ) : null}

            <div className="camp-ios-summary">
              <article>
                <span>Dirigenti</span>
                <strong>
                  {selectedCampCommittee.leaderRegistrationIds.length +
                    selectedCampCommittee.manualLeaderIds.length}
                </strong>
              </article>
              <article>
                <span>Giovani</span>
                <strong>
                  {selectedCampCommittee.memberRegistrationIds.length}
                </strong>
              </article>
            </div>

            <section className="camp-modal-section">
              <h3>Dirigenti iscritti</h3>
              <div className="patrol-checkbox-list">
                {adultRegistrations.length === 0 ? (
                  <p className="subtle-text">
                    Nessun dirigente/accompagnatore iscritto.
                  </p>
                ) : (
                  adultRegistrations.map((registration) => {
                    const assignedCommittee =
                      committeeAssignmentByRegistrationId.get(registration.id);
                    const checked =
                      selectedCampCommittee.leaderRegistrationIds.includes(
                        registration.id,
                      );
                    const unavailable =
                      assignedCommittee !== undefined &&
                      assignedCommittee !== selectedCampCommittee.id &&
                      !checked;

                    return (
                      <label className="toggle-field" key={registration.id}>
                        <input
                          checked={checked}
                          disabled={unavailable}
                          onChange={() =>
                            updateCommitteeRegistration(
                              selectedCampCommittee.id,
                              registration.id,
                              "leader",
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          {getRegistrationDisplayName(registration)}
                          <small>{getRegistrationMeta(registration.id)}</small>
                          {unavailable ? (
                            <small>Già assegnato a un altro comitato</small>
                          ) : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>

            <section className="camp-modal-section">
              <h3>Dirigenti manuali</h3>
              <div className="patrol-checkbox-list">
                {campDraft.manualLeaders.length === 0 ? (
                  <p className="subtle-text">
                    Aggiungi i dirigenti manuali dalla schermata comitati.
                  </p>
                ) : (
                  campDraft.manualLeaders.map((leader) => {
                    const assignedCommittee =
                      committeeAssignmentByManualLeaderId.get(leader.id);
                    const checked =
                      selectedCampCommittee.manualLeaderIds.includes(leader.id);
                    const unavailable =
                      assignedCommittee !== undefined &&
                      assignedCommittee !== selectedCampCommittee.id &&
                      !checked;

                    return (
                      <label className="toggle-field" key={leader.id}>
                        <input
                          checked={checked}
                          disabled={unavailable}
                          onChange={() =>
                            toggleCommitteeManualLeader(
                              selectedCampCommittee.id,
                              leader.id,
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          {leader.fullName}
                          <small>
                            {leader.linkedRegistrationId
                              ? "Collegato"
                              : "Manuale"}
                          </small>
                          {unavailable ? (
                            <small>Già assegnato a un altro comitato</small>
                          ) : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>

            <section className="camp-modal-section">
              <h3>Giovani</h3>
              <div className="patrol-checkbox-list">
                {youthRegistrations.map((registration) => {
                  const assignedCommittee =
                    committeeAssignmentByRegistrationId.get(registration.id);
                  const checked =
                    selectedCampCommittee.memberRegistrationIds.includes(
                      registration.id,
                    );
                  const unavailable =
                    assignedCommittee !== undefined &&
                    assignedCommittee !== selectedCampCommittee.id &&
                    !checked;

                  return (
                    <label className="toggle-field" key={registration.id}>
                      <input
                        checked={checked}
                        disabled={unavailable}
                        onChange={() =>
                          updateCommitteeRegistration(
                            selectedCampCommittee.id,
                            registration.id,
                            "member",
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        {getRegistrationDisplayName(registration)}
                        <small>{getRegistrationMeta(registration.id)}</small>
                        {unavailable ? (
                          <small>Già assegnato a un altro comitato</small>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          </div>
        </AppModal>
      ) : null}

      {selectedCampPatrol ? (
        <AppModal
          title={selectedCampPatrol.name}
          subtitle="Capo pattuglia, supervisori e membri"
          size="wide"
          onClose={closeCampModal}
          footer={
            <>
              <ModalFeedback error={actionError} />
              <button
                className="button button--ghost"
                onClick={closeCampModal}
                type="button"
              >
                {campDraftDirty ? "Chiudi senza salvare" : "Chiudi"}
              </button>
              <button
                className="button button--ghost button--danger"
                disabled={busy === "saveCampManagement" || loading}
                onClick={() =>
                  showConfirm({
                    kind: "removePatrol",
                    patrolId: selectedCampPatrol.id,
                  })
                }
                type="button"
              >
                Elimina e salva
              </button>
              <button
                className="button button--primary"
                disabled={busy === "saveCampManagement" || loading}
                onClick={() =>
                  void handleSaveCampManagement({ closeModal: true })
                }
                type="button"
              >
                {busy === "saveCampManagement" ? "Salvataggio..." : "Salva e chiudi"}
              </button>
            </>
          }
        >
          <div className="camp-modal-stack">
            {campDraftDirty ? (
              <div className="camp-save-state camp-save-state--modal" role="status">
                <AppIcon name="bell" />
                <span>Modifiche non ancora salvate</span>
              </div>
            ) : null}

            <label className="field">
              <span className="field__label">Nome pattuglia</span>
              <input
                className="input"
                value={selectedCampPatrol.name}
                onChange={(eventInput) =>
                  updatePatrolField(
                    selectedCampPatrol.id,
                    "name",
                    eventInput.target.value,
                  )
                }
              />
            </label>

            <section className="camp-modal-section">
              <h3>Capo pattuglia</h3>
              <select
                className="input"
                value={selectedCampPatrol.leaderRegistrationId}
                onChange={(eventInput) =>
                  setPatrolLeader(
                    selectedCampPatrol.id,
                    eventInput.target.value,
                  )
                }
              >
                <option value="">Da assegnare</option>
                {youthRegistrations.map((registration) => {
                  const assignment = patrolAssignmentByRegistrationId.get(
                    registration.id,
                  );
                  const unavailable =
                    assignment !== undefined &&
                    assignment.patrolId !== selectedCampPatrol.id;

                  return (
                    <option
                      disabled={unavailable}
                      key={registration.id}
                      value={registration.id}
                    >
                      {getRegistrationDisplayName(registration)} ·{" "}
                      {getUnitLabel(registration)}
                      {unavailable ? ` · già in ${assignment.patrolName}` : ""}
                    </option>
                  );
                })}
              </select>
            </section>

            <section className="camp-modal-section">
              <h3>Supervisori</h3>
              <div className="patrol-checkbox-list">
                {adultRegistrations.map((registration) => {
                  const assignment = patrolAssignmentByRegistrationId.get(
                    registration.id,
                  );
                  const checked =
                    selectedCampPatrol.supervisorRegistrationIds.includes(
                      registration.id,
                    );
                  const unavailable =
                    assignment !== undefined &&
                    assignment.patrolId !== selectedCampPatrol.id &&
                    !checked;

                  return (
                    <label className="toggle-field" key={registration.id}>
                      <input
                        checked={checked}
                        disabled={unavailable}
                        onChange={() =>
                          togglePatrolAssignment(
                            selectedCampPatrol.id,
                            "supervisorRegistrationIds",
                            registration.id,
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        {getRegistrationDisplayName(registration)}
                        <small>{getRegistrationMeta(registration.id)}</small>
                        {unavailable ? (
                          <small>Già in {assignment.patrolName}</small>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="camp-modal-section">
              <h3>Supervisori manuali</h3>
              <div className="patrol-checkbox-list">
                {campDraft.manualLeaders.length === 0 ? (
                  <p className="subtle-text">
                    Aggiungi i dirigenti manuali dalla schermata comitati.
                  </p>
                ) : (
                  campDraft.manualLeaders.map((leader) => {
                    const assignment =
                      patrolAssignmentByManualSupervisorId.get(leader.id);
                    const checked =
                      selectedCampPatrol.manualSupervisorIds.includes(leader.id);
                    const unavailable =
                      assignment !== undefined &&
                      assignment.patrolId !== selectedCampPatrol.id &&
                      !checked;

                    return (
                      <label className="toggle-field" key={leader.id}>
                        <input
                          checked={checked}
                          disabled={unavailable}
                          onChange={() =>
                            togglePatrolManualSupervisor(
                              selectedCampPatrol.id,
                              leader.id,
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          {leader.fullName}
                          <small>
                            {leader.linkedRegistrationId ? "Collegato" : "Manuale"}
                          </small>
                          {unavailable ? (
                            <small>Già in {assignment.patrolName}</small>
                          ) : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </section>

            <section className="camp-modal-section">
              <h3>Membri</h3>
              <div className="patrol-checkbox-list">
                {youthRegistrations.map((registration) => {
                  const assignment = patrolAssignmentByRegistrationId.get(
                    registration.id,
                  );
                  const checked =
                    selectedCampPatrol.memberRegistrationIds.includes(
                      registration.id,
                    );
                  const isLeader =
                    selectedCampPatrol.leaderRegistrationId === registration.id;
                  const unavailable =
                    assignment !== undefined &&
                    assignment.patrolId !== selectedCampPatrol.id &&
                    !checked;

                  return (
                    <label className="toggle-field" key={registration.id}>
                      <input
                        checked={checked}
                        disabled={unavailable || isLeader}
                        onChange={() =>
                          togglePatrolAssignment(
                            selectedCampPatrol.id,
                            "memberRegistrationIds",
                            registration.id,
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        {getRegistrationDisplayName(registration)}
                        <small>{getRegistrationMeta(registration.id)}</small>
                        {isLeader ? <small>Capo pattuglia</small> : null}
                        {unavailable ? (
                          <small>Già in {assignment.patrolName}</small>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          </div>
        </AppModal>
      ) : null}

      {registrationModal ? (
        <AppModal
          onClose={closeRegistrationModal}
          size="compact"
          subtitle={modalSubtitle}
          title={getRegistrationDisplayName(registrationModal)}
        >
          <div className="admin-modal-stack">
            <div className="section-head">
              <div>
                <h3>{getCategoryLabel(registrationModal)}</h3>
                <p>{getUnitLabel(registrationModal)}</p>
              </div>
              <StatusBadge
                label={getRegistrationStatusLabel(
                  registrationModal.registrationStatus,
                )}
                tone={getRegistrationStatusTone(
                  registrationModal.registrationStatus,
                )}
              />
            </div>

            <PhotoConsentPills registration={registrationModal} />

            {isManualRegistration(registrationModal) ? (
              <p className="subtle-text">
                {modalCreatorName
                  ? fillCopy(ISCRITTI.aggiuntaDa, {
                      admin: modalCreatorName,
                      data: formatDateOnly(registrationModal.createdAt),
                    })
                  : fillCopy(ISCRITTI.aggiuntaIl, {
                      data: formatDateOnly(registrationModal.createdAt),
                    })}
              </p>
            ) : null}

            {session?.isAdmin && isMissingParentEmail(registrationModal) ? (
              <div className="admin-outcome admin-outcome--warning">
                <strong>{ISCRITTI.mancaEmailTitolo}</strong>{" "}
                {ISCRITTI.mancaEmailCorpo}
                <button
                  className="button button--primary button--small"
                  disabled={busy !== null}
                  onClick={() => {
                    setActionError(null);
                    setActionInfo(null);
                    setRequestAuthorizationId(registrationModal.id);
                  }}
                  type="button"
                >
                  <AppIcon name="mail" />
                  <span>{ISCRITTI.chiediAutorizzazione}</span>
                </button>
              </div>
            ) : null}

            {registrationModalHighlights.length > 0 ? (
              <div className="chip-row admin-chip-row">
                {registrationModalHighlights.map((highlight) => (
                  <StatusBadge
                    key={`modal-${highlight.label}`}
                    label={highlight.label}
                    tone={highlight.tone}
                  />
                ))}
              </div>
            ) : null}

            <div className="admin-key-facts">
              {[
                {
                  label: "Tipo",
                  value: getCategoryShortLabel(registrationModal),
                },
                {
                  label: "Stato",
                  value: getRegistrationStatusLabel(
                    registrationModal.registrationStatus,
                  ),
                },
                {
                  label: "Email",
                  value: registrationModal.email || "-",
                },
                {
                  label: "Telefono",
                  value: registrationModal.phone || "-",
                },
                {
                  label: "Canale",
                  value: isManualRegistration(registrationModal)
                    ? ISCRITTI.pillAMano
                    : registrationModal.submittedByMode === "anonymous"
                      ? "Ospite"
                      : "Con account",
                },
                ...(isMinorRegistration(registrationModal)
                  ? [
                      {
                        label: "Consenso genitore",
                        value:
                          registrationModal.parentConsentDocumentUrl ||
                          registrationModal.parentAuthorization?.pdfPath
                            ? "Caricato"
                            : "Mancante",
                      },
                    ]
                  : []),
                {
                  label: "Aggiornata",
                  value: formatDateTime(registrationModal.updatedAt),
                },
                ...(registrationModalMode === "overnight" ||
                registrationModalRoomEntries.length > 0
                  ? [
                      {
                        label: overnightUnitSingularTitle,
                        value:
                          registrationModal.assignedRoomId || "Da assegnare",
                      },
                    ]
                  : []),
              ].map((item) => (
                <article key={item.label} className="admin-key-fact">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </div>

            {registrationModalRoomEntries.length > 0 ? (
              <div className="registration-detail__answers">
                <h4>Preferenze {overnightUnitSingular}</h4>
                <div className="admin-answer-grid">
                  {registrationModalRoomEntries.map((entry) => (
                    <article
                      key={`${registrationModal.id}-${entry.key}`}
                      className="admin-answer-card"
                    >
                      <strong>{entry.label}</strong>
                      <span>{entry.value}</span>
                      {entry.key !== "roomNotes" ? (
                        <small>
                          {entry.isMatched
                            ? "Richiesta collegata"
                            : "Richiesta non collegata"}
                        </small>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {registrationModalAnswerEntries.length > 0 ? (
              <div className="registration-detail__answers">
                <h4>Risposte inviate</h4>
                <div className="admin-answer-grid">
                  {registrationModalAnswerEntries.map((entry) => (
                    <article
                      key={`${registrationModal.id}-${entry.key}`}
                      className="admin-answer-card"
                    >
                      <strong>{entry.label}</strong>
                      <span>{entry.value}</span>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="subtle-text">
                Nessun dettaglio aggiuntivo oltre ai dati principali.
              </p>
            )}

            <div className="inline-actions" style={{ flexWrap: "wrap" }}>
              {session?.isAdmin ? (
                <button
                  className="button button--ghost button--small"
                  disabled={busy !== null}
                  onClick={() => {
                    setActionError(null);
                    setActionInfo(null);
                    setEditRegistrationId(registrationModal.id);
                  }}
                  type="button"
                >
                  <AppIcon name="pencil" />
                  <span>{ISCRITTI.modificaDati}</span>
                </button>
              ) : null}
              {registrationModal.registrationStatus === "cancelled" ? (
                <button
                  className="button button--soft button--small"
                  disabled={busy !== null}
                  onClick={() => requestReactivateRegistration(registrationModal)}
                  type="button"
                >
                  <AppIcon name="check" />
                  <span>
                    {busyRegistrationId === registrationModal.id &&
                    busy === "reactivateRegistration"
                      ? "Riattivazione..."
                      : "Riattiva iscrizione"}
                  </span>
                </button>
              ) : (
                <button
                  className="button button--soft button--small"
                  disabled={busy !== null}
                  onClick={() =>
                    showConfirm({
                      kind: "cancelRegistration",
                      registrationId: registrationModal.id,
                    })
                  }
                  type="button"
                >
                  <AppIcon name="x" />
                  <span>
                    {busyRegistrationId === registrationModal.id &&
                    busy === "cancelRegistration"
                      ? ANNULLA.annullamento
                      : ANNULLA.annullaIscrizione}
                  </span>
                </button>
              )}
              <button
                className="button button--ghost button--small"
                disabled={busy !== null}
                onClick={() =>
                  showConfirm({
                    kind: "deleteRegistration",
                    registrationId: registrationModal.id,
                  })
                }
                type="button"
              >
                <AppIcon name="trash" />
                <span>
                  {busyRegistrationId === registrationModal.id &&
                  busy === "deleteRegistration"
                    ? "Eliminazione..."
                    : "Elimina iscrizione"}
                </span>
              </button>
            </div>
            <p className="subtle-text">
              "Annulla" sposta l'iscrizione tra le cancellate (reversibile).
              "Elimina" rimuove definitivamente il documento (irreversibile).
            </p>
            <ModalFeedback error={actionError} info={actionInfo} />
          </div>
        </AppModal>
      ) : null}

      {editModalOpen && data?.organization && session ? (
        <AdminEventEditorModal
          initialEvent={resolvedEvent}
          initialFormConfig={formConfig}
          organization={data.organization}
          sessionUid={session.firebaseUser.uid}
          stakeId={stakeId}
          onClose={() => setEditModalOpen(false)}
          onCompleted={() => {
            setRefreshKey((current) => current + 1);
            setEditModalOpen(false);
          }}
        />
      ) : null}

      {excelExportModalOpen ? (
        <RegistrationExcelExportModal
          totalRegistrations={activeRegistrations.length}
          busy={downloadingExcel}
          error={actionError}
          onClose={() => {
            if (downloadingExcel) return;
            setActionError(null);
            setExcelExportModalOpen(false);
          }}
          onConfirm={handleDownloadExcel}
        />
      ) : null}

      {addManualOpen && session ? (
        <AddManualRegistrationSheet
          eventId={resolvedEventId}
          onClose={() => setAddManualOpen(false)}
          onCreated={(registrationId, info) => {
            setAddManualOpen(false);
            setRefreshKey((current) => current + 1);
            openRegistrationModal(registrationId, "registration");
            setActionInfo(info);
          }}
          onOpenRegistration={(registrationId) => {
            setAddManualOpen(false);
            openRegistrationModal(registrationId, "registration");
          }}
          registrations={sortedRegistrations}
          requiresParentAuthorization={resolvedEvent.requiresParentAuthorization === true}
          sessionUid={session.firebaseUser.uid}
          stakeId={stakeId}
        />
      ) : null}

      {editRegistration ? (
        <EditRegistrationSheet
          eventId={resolvedEventId}
          key={editRegistration.id}
          onClose={() => setEditRegistrationId(null)}
          onSaved={(info) => {
            setEditRegistrationId(null);
            setActionInfo(info);
            setRefreshKey((current) => current + 1);
          }}
          registration={editRegistration}
          requiresParentAuthorization={resolvedEvent.requiresParentAuthorization === true}
          stakeId={stakeId}
        />
      ) : null}

      {requestAuthorizationRegistration ? (
        <RequestAuthorizationSheet
          eventId={resolvedEventId}
          key={requestAuthorizationRegistration.id}
          onClose={() => setRequestAuthorizationId(null)}
          onSent={(info) => {
            setRequestAuthorizationId(null);
            setActionInfo(info);
            setRefreshKey((current) => current + 1);
          }}
          registration={requestAuthorizationRegistration}
          stakeId={stakeId}
        />
      ) : null}

      {confirmView ? (
        <ConfirmSheet
          body={confirmView.body}
          busy={confirmView.busy}
          busyLabel={confirmView.busyLabel}
          cancelLabel={confirmView.cancelLabel}
          confirmLabel={confirmView.confirmLabel}
          error={confirmError}
          onCancel={() => showConfirm(null)}
          onConfirm={confirmView.onConfirm}
          title={confirmView.title}
          tone="danger"
        />
      ) : null}
    </div>
  );
}
