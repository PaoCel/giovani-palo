import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { AdminActivityCard } from "@/components/AdminActivityCard";
import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { AppIcon } from "@/components/AppIcon";
import { AppModal } from "@/components/AppModal";
import { EmptyState } from "@/components/EmptyState";
import { RegistrationExcelExportModal } from "@/components/RegistrationExcelExportModal";
import { ShareButton } from "@/components/ShareButton";
import { StatusBadge } from "@/components/StatusBadge";
import { SurveyEditor } from "@/components/SurveyEditor";
import { SurveyResultsPanel } from "@/components/SurveyResultsPanel";
import { GalleryAdminTab } from "@/components/admin/gallery/GalleryAdminTab";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { storageService } from "@/services/firebase/storageService";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import { eventsService } from "@/services/firestore/eventsService";
import { organizationService } from "@/services/firestore/organizationService";
import { questionsService } from "@/services/firestore/questionsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { parentAuthorizationService } from "@/services/firestore/parentAuthorizationService";
import type { Question, Registration } from "@/types";
import { getAbsoluteUrl, getActivityPath } from "@/utils/activityLinks";
import { formatDateRange, formatDateTime } from "@/utils/formatters";
import { downloadRegistrationsExcel, type ExportOptions } from "@/utils/registrationExcel";
import {
  getRegistrationDisplayName,
  getRegistrationTextAnswer,
  getRoomPreferenceEntries,
  getRoomPreferenceResolvedName,
  roomPreferenceKeys,
} from "@/utils/roomPreferences";
import {
  getEffectiveEventStatus,
  getEventAudienceLabel,
  getEventStatusLabel,
  getEventStatusTone,
} from "@/utils/events";
import { getGenderRoleCategoryLabel } from "@/utils/profile";
import {
  getRegistrationAnswerEntries,
  getRegistrationHighlights,
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";

type AdminEventTab =
  | "details"
  | "registrations"
  | "consents"
  | "overnight"
  | "questions"
  | "surveys"
  | "gallery"
  | "stats";
type RegistrationModalMode = "registration" | "overnight";
type RegistrationCategoryFilter =
  | "giovane_uomo"
  | "giovane_donna"
  | "dirigente"
  | "accompagnatore";

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

const registrationCategoryFilterOptions: Array<{
  value: RegistrationCategoryFilter;
  label: string;
}> = [
  { value: "giovane_uomo", label: "GU" },
  { value: "giovane_donna", label: "GD" },
  { value: "dirigente", label: "Dirigenti" },
  { value: "accompagnatore", label: "Accompagnatori" },
];

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
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "it"))
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
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());

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
  return getGenderRoleCategoryLabel(registration.genderRoleCategory) || "Organizzazione non indicata";
}

function getCategoryShortLabel(registration: Registration) {
  switch (registration.genderRoleCategory) {
    case "giovane_uomo":
      return "GU";
    case "giovane_donna":
      return "GD";
    case "dirigente":
      return "DIR";
    default:
      return "--";
  }
}

function isMinorRegistration(registration: Registration) {
  const age = getAgeFromBirthDate(registration.birthDate);
  return age !== null && age < 18;
}

function isRegistrationCategoryFilter(
  value: Registration["genderRoleCategory"],
): value is RegistrationCategoryFilter {
  return (
    value === "giovane_uomo" ||
    value === "giovane_donna" ||
    value === "dirigente" ||
    value === "accompagnatore"
  );
}

function getUnitLabel(registration: Registration) {
  return (
    registration.unitNameSnapshot ||
    (typeof registration.answers.unitName === "string" ? registration.answers.unitName : "") ||
    "Unità non indicata"
  );
}

function getParentAuthorizationRequest(registration: Registration) {
  const request = (registration.answers as Record<string, unknown>).parentAuthorizationRequest;

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
    (typeof request?.parentFirstName === "string" ? request.parentFirstName : "");
  const lastName =
    registration.parentAuthorization?.parentLastName ||
    (typeof request?.parentLastName === "string" ? request.parentLastName : "");

  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function getParentAuthorizationBadge(
  registration: Registration,
  required: boolean,
): { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" } {
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

function getAdminEventTabFromPath(pathname: string): AdminEventTab {
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

  return "details";
}

function getAdminEventTabHref(eventId: string, tab: AdminEventTab) {
  switch (tab) {
    case "registrations":
      return `/admin/events/${eventId}/registrations`;
    case "consents":
      return `/admin/events/${eventId}/consents`;
    case "overnight":
      return `/admin/events/${eventId}/rooms`;
    case "questions":
      return `/admin/events/${eventId}/questions`;
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

export function AdminEventDetailPage() {
  const { eventId } = useParams();
  const location = useLocation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const stakeId = session?.profile.stakeId ?? "roma-est";
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
    | "deleteRegistration"
    | "cancelRegistration"
    | "reactivateRegistration"
  >(null);
  const [busyRegistrationId, setBusyRegistrationId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  // Link di download persistente: window.open dopo un await viene bloccato
  // dai popup blocker (Safari/iOS), quindi il link resta cliccabile qui.
  const [actionDownload, setActionDownload] = useState<{
    url: string;
    label: string;
  } | null>(null);
  const [registrationModalId, setRegistrationModalId] = useState<string | null>(null);
  const [registrationModalMode, setRegistrationModalMode] =
    useState<RegistrationModalMode>("registration");
  const [selectedConsentRegistrationId, setSelectedConsentRegistrationId] =
    useState<string | null>(null);
  const [parentEmailEditingId, setParentEmailEditingId] = useState<string | null>(null);
  const [parentEmailDraft, setParentEmailDraft] = useState("");
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [excelExportModalOpen, setExcelExportModalOpen] = useState(false);
  const [normalizingRoomPreferences, setNormalizingRoomPreferences] = useState(false);
  const [activeRegistrationFilters, setActiveRegistrationFilters] = useState<
    RegistrationCategoryFilter[]
  >(["giovane_uomo", "giovane_donna", "dirigente", "accompagnatore"]);
  const [selectedUnitFilter, setSelectedUnitFilter] = useState("all");
  const [nameSearch, setNameSearch] = useState("");

  const { data, loading, error } = useAsyncData(
    async () => {
      if (!eventId) {
        return null;
      }

      const [workspace, organization, allEvents] = await Promise.all([
        adminEventsService.getAdminEventWorkspace(stakeId, eventId),
        organizationService.getProfile(stakeId),
        adminEventsService.listAdminEvents(stakeId),
      ]);

      if (!workspace) {
        return null;
      }

      const registrationsPerEvent = await Promise.all(
        allEvents.map(async (event) => ({
          eventId: event.id,
          registrations: await registrationsService.listRegistrationsByEvent(stakeId, event.id),
        })),
      );

      return {
        workspace,
        organization,
        registrationsPerEvent,
      };
    },
    [eventId, refreshKey, stakeId],
    null,
  );

  const questionsEnabled = data?.workspace.event.questionsEnabled === true;
  const [questionsRefreshKey, setQuestionsRefreshKey] = useState(0);
  const { data: questions, loading: questionsLoading, error: questionsError } =
    useAsyncData<Question[]>(
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
  const routeTab = getAdminEventTabFromPath(location.pathname);

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
          registration.registrationStatus !== "cancelled" && registration.status !== "cancelled",
      ),
    [sortedRegistrations],
  );
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
          typeof registration.answers.city === "string" ? registration.answers.city : "",
        "Città non indicata",
      ),
    [activeRegistrations],
  );
  const roomRequestDistribution = useMemo(() => {
    const requests = activeRegistrations.flatMap((registration) =>
      roomPreferenceKeys.map((key) => getRoomPreferenceResolvedName(registration, key)),
    );
    const filteredRequests = requests.filter(Boolean);

    if (filteredRequests.length === 0) {
      return [];
    }

    return buildDistribution(filteredRequests, (request) => request, "");
  }, [activeRegistrations]);
  const registrationFilterCounts = useMemo(
    () =>
      registrationCategoryFilterOptions.reduce<Record<RegistrationCategoryFilter, number>>(
        (accumulator, option) => {
          accumulator[option.value] = sortedRegistrations.filter(
            (registration) =>
              registration.genderRoleCategory === option.value &&
              (selectedUnitFilter === "all" || getUnitLabel(registration) === selectedUnitFilter),
          ).length;
          return accumulator;
        },
        {
          giovane_uomo: 0,
          giovane_donna: 0,
          dirigente: 0,
          accompagnatore: 0,
        },
      ),
    [selectedUnitFilter, sortedRegistrations],
  );
  const registrationUnitOptions = useMemo(() => {
    const seen = new Set<string>();

    return sortedRegistrations.reduce<string[]>((accumulator, registration) => {
      const unitLabel = getUnitLabel(registration).trim();
      const normalizedLabel = unitLabel.toLocaleLowerCase("it-IT");

      if (!unitLabel || seen.has(normalizedLabel)) {
        return accumulator;
      }

      seen.add(normalizedLabel);
      accumulator.push(unitLabel);
      return accumulator;
    }, []);
  }, [sortedRegistrations]);
  const filteredRegistrations = useMemo(() => {
    const needle = nameSearch.trim().toLocaleLowerCase("it-IT");
    return sortedRegistrations.filter((registration) => {
      if (!isRegistrationCategoryFilter(registration.genderRoleCategory)) return false;
      if (!activeRegistrationFilters.includes(registration.genderRoleCategory)) return false;
      if (selectedUnitFilter !== "all" && getUnitLabel(registration) !== selectedUnitFilter) {
        return false;
      }
      if (needle) {
        const haystack = [
          registration.fullName,
          registration.firstName,
          registration.lastName,
          registration.email,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("it-IT");
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [activeRegistrationFilters, nameSearch, selectedUnitFilter, sortedRegistrations]);
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
  const waitlistCount = sortedRegistrations.filter(
    (registration) => registration.registrationStatus === "waitlist",
  ).length;
  const cancelledCount = sortedRegistrations.filter(
    (registration) => registration.registrationStatus === "cancelled",
  ).length;
  const minorRegistrations = activeRegistrations.filter((registration) =>
    isMinorRegistration(registration),
  );
  const uploadedMinorConsentCount = minorRegistrations.filter((registration) =>
    Boolean(registration.parentConsentDocumentUrl || registration.parentAuthorization?.pdfPath),
  ).length;
  const missingMinorConsentCount = minorRegistrations.length - uploadedMinorConsentCount;
  const signedParentAuthorizationCount = activeRegistrations.filter(
    (registration) =>
      registration.parentAuthorization?.status === "authorized" &&
      Boolean(registration.parentAuthorization?.pdfPath),
  ).length;
  const legacyApprovedWithoutPdfCount = activeRegistrations.filter((registration) => {
    if (registration.parentAuthorization?.pdfPath) return false;
    if (registration.parentAuthorization?.status === "rejected_by_parent") return false;
    return (
      registration.parentAuthorization?.status === "authorized" ||
      registration.answers.parentConfirmed === true ||
      registration.answers.parentalConsentAccepted === true
    );
  }).length;
  const withRoomPreferencesCount = activeRegistrations.filter(
    (registration) =>
      roomPreferenceKeys.some((key) => Boolean(getRegistrationTextAnswer(registration, key))),
  ).length;
  const normalizedRoomPreferencesCount = activeRegistrations.reduce((total, registration) => {
    return (
      total +
      roomPreferenceKeys.filter(
        (key) =>
          registration.roomPreferenceMatches[key]?.status === "matched" &&
          Boolean(registration.roomPreferenceMatches[key]?.matchedRegistrationId),
      ).length
    );
  }, 0);
  const withRoomNotesCount = activeRegistrations.filter((registration) =>
    Boolean(getRegistrationTextAnswer(registration, "roomNotes")),
  ).length;
  const assignedRoomCount = activeRegistrations.filter((registration) =>
    Boolean(registration.assignedRoomId),
  ).length;
  const averageAge = getAverageAge(activeRegistrations);
  const comparisonCounts = (data?.registrationsPerEvent ?? [])
    .map((item) => ({
      eventId: item.eventId,
      total: item.registrations.filter(
        (registration) => registration.registrationStatus !== "cancelled",
      ).length,
    }))
    .sort((left, right) => right.total - left.total);
  const eventRankIndex = comparisonCounts.findIndex((item) => item.eventId === resolvedEventId);
  const eventRank = eventRankIndex >= 0 ? eventRankIndex + 1 : null;
  const averageRegistrations =
    comparisonCounts.length > 0
      ? Math.round(
          (comparisonCounts.reduce((sum, item) => sum + item.total, 0) / comparisonCounts.length) *
            10,
        ) / 10
      : 0;
  const activeTab =
    (!resolvedEvent.overnight && routeTab === "overnight") ||
    (!resolvedEvent.questionsEnabled && routeTab === "questions")
      ? "details"
      : routeTab;
  const subtabsCountClass = (() => {
    let count = 4;
    if (resolvedEvent.overnight) count += 1;
    if (resolvedEvent.questionsEnabled) count += 1;
    if (count === 6) return "admin-subtabs admin-subtabs--six";
    if (count === 5) return "admin-subtabs admin-subtabs--five";
    return "admin-subtabs admin-subtabs--four";
  })();
  const visibleQuestions = sortedQuestions.filter((question) => question.status === "active");
  const hiddenQuestions = sortedQuestions.filter((question) => question.status === "hidden");
  const registrationModal =
    registrationModalId !== null
      ? sortedRegistrations.find((registration) => registration.id === registrationModalId) ?? null
      : null;
  const registrationModalHighlights = registrationModal
    ? getRegistrationHighlights(registrationModal)
    : [];
  const registrationModalRoomEntries = registrationModal
    ? getRoomPreferenceEntries(registrationModal)
    : [];
  const registrationModalAnswerEntries =
    formConfig && registrationModal
      ? getRegistrationAnswerEntries(formConfig, registrationModal).filter(
          (entry) =>
            !sharedRegistrationEntryKeys.has(entry.key) &&
            !roomRegistrationEntryKeys.has(entry.key),
        )
      : [];
  const modalSubtitle =
    registrationModalMode === "overnight"
      ? "Preferenze stanza e dati inviati"
      : "Dettaglio registrazione";

  function openTab(tab: AdminEventTab) {
    navigate(getAdminEventTabHref(resolvedEventId, tab));
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
      downloadQuestionsPdf({ event: resolvedEvent, questions: sortedQuestions });
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
    const confirmed = window.confirm("Eliminare definitivamente questa domanda?");

    if (!confirmed) {
      return;
    }

    setActionError(null);
    setActionInfo(null);

    try {
      await questionsService.adminDelete(
        stakeId,
        resolvedEventId,
        question.registrationId,
        question.id,
      );
      setQuestionsRefreshKey((current) => current + 1);
      setActionInfo("Domanda eliminata.");
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile eliminare la domanda.",
      );
    }
  }

  function toggleRegistrationFilter(filter: RegistrationCategoryFilter) {
    setActiveRegistrationFilters((current) =>
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter],
    );
  }

  function openRegistrationModal(registrationId: string, mode: RegistrationModalMode) {
    setRegistrationModalMode(mode);
    setRegistrationModalId(registrationId);
  }

  function closeRegistrationModal() {
    setRegistrationModalId(null);
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
        caughtError instanceof Error ? caughtError.message : "Impossibile pubblicare l'attività.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      "Vuoi davvero eliminare questa attività? L'azione rimuove anche modulo e registrazioni.",
    );

    if (!confirmed) {
      return;
    }

    setBusy("delete");
    setActionError(null);
    setActionInfo(null);

    try {
      if (resolvedEvent.heroImagePath) {
        await storageService.deleteFile(resolvedEvent.heroImagePath).catch(() => undefined);
      }

      await eventsService.deleteEvent(stakeId, resolvedEventId);
      navigate("/admin/events", { replace: true });
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : "Impossibile eliminare l'attività.",
      );
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
      const result = await parentAuthorizationService.resendByAdmin({
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
      const result = await parentAuthorizationService.getSignedConsentDownloadUrl({
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
      const result = await parentAuthorizationService.downloadSignedConsentsZip({
        stakeId,
        activityId: resolvedEventId,
      });
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
    const confirmed = window.confirm(
      "Generare il modulo ufficiale per le autorizzazioni già approvate col vecchio metodo e inviare una copia ai genitori?\n\n" +
        "Verranno saltati automaticamente gli iscritti che hanno già un modulo firmato.",
    );
    if (!confirmed) return;

    setBusy("backfillLegacyApprovals");
    setActionError(null);
    setActionInfo(null);

    try {
      const result = await parentAuthorizationService.backfillLegacyApprovals({
        stakeId,
        activityId: resolvedEventId,
      });
      setActionInfo(
        `Fallback completato: ${result.processed} moduli generati, ${result.emailed} email inviate` +
          (result.skipped ? `, ${result.skipped} saltati` : "") +
          (result.errors.length ? `, ${result.errors.length} avvisi` : "") +
          ".",
      );
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile generare i fallback legacy.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleAdminDeleteRegistration(registration: Registration) {
    const confirmed = window.confirm(
      `Eliminare definitivamente l'iscrizione di ${registration.fullName}?\n\n` +
        "L'iscrizione verra' rimossa dal database. Eventuali firme/PDF/documenti " +
        "associati su Storage NON vengono eliminati automaticamente (vanno rimossi a mano se serve).\n\n" +
        "Azione irreversibile.",
    );
    if (!confirmed) return;
    setBusy("deleteRegistration");
    setBusyRegistrationId(registration.id);
    setActionError(null);
    setActionInfo(null);
    try {
      await registrationsService.adminDeleteRegistration(
        stakeId,
        resolvedEventId,
        registration.id,
      );
      setActionInfo(`Iscrizione di ${registration.fullName} eliminata.`);
      closeRegistrationModal();
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile eliminare l'iscrizione.",
      );
    } finally {
      setBusy(null);
      setBusyRegistrationId(null);
    }
  }

  async function handleAdminCancelRegistration(registration: Registration) {
    const confirmed = window.confirm(
      `Annullare l'iscrizione di ${registration.fullName}?\n\n` +
        "L'iscrizione resta nel database con stato 'cancelled'. Puoi riattivarla " +
        "in qualsiasi momento dalla stessa scheda.",
    );
    if (!confirmed) return;
    setBusy("cancelRegistration");
    setBusyRegistrationId(registration.id);
    setActionError(null);
    setActionInfo(null);
    try {
      await registrationsService.adminSetRegistrationStatus(
        stakeId,
        resolvedEventId,
        registration.id,
        "cancelled",
      );
      setActionInfo(`Iscrizione di ${registration.fullName} annullata.`);
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile annullare l'iscrizione.",
      );
    } finally {
      setBusy(null);
      setBusyRegistrationId(null);
    }
  }

  async function handleAdminReactivateRegistration(registration: Registration) {
    setBusy("reactivateRegistration");
    setBusyRegistrationId(registration.id);
    setActionError(null);
    setActionInfo(null);
    try {
      await registrationsService.adminSetRegistrationStatus(
        stakeId,
        resolvedEventId,
        registration.id,
        "active",
      );
      setActionInfo(`Iscrizione di ${registration.fullName} riattivata.`);
      setRefreshKey((current) => current + 1);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile riattivare l'iscrizione.",
      );
    } finally {
      setBusy(null);
      setBusyRegistrationId(null);
    }
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
      await downloadRegistrationsExcel(resolvedEvent.title, activeRegistrations, options);
      setActionInfo(`Excel esportato con ${filtered.length} iscritti attivi.`);
      setExcelExportModalOpen(false);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : "Impossibile esportare l'Excel.",
      );
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
        setActionInfo("Nessuna richiesta stanza da normalizzare.");
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
          : "Impossibile normalizzare le richieste stanza.",
      );
    } finally {
      setNormalizingRoomPreferences(false);
    }
  }

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

      {actionInfo ? (
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
                <span className="subtle-text">Il link scade tra 15 minuti.</span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="notice notice--warning">
          <div>
            <h3>Azione non completata</h3>
            <p>{actionError}</p>
          </div>
        </div>
      ) : null}

      <section className="admin-detail-hero">
        <AdminActivityCard
          event={resolvedEvent}
          registrationsCount={currentCount}
          to={`/admin/events/${resolvedEvent.id}`}
          variant="feature"
        />

        <div className="surface-panel surface-panel--subtle admin-detail-hero__toolbar">
          <div className="admin-inline-metrics admin-inline-metrics--three admin-inline-metrics--hero">
            <article className="admin-inline-metric">
              <strong>{currentCount}</strong>
              <span>Attivi</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{sortedRegistrations.length}</strong>
              <span>Iscritti</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{resolvedEvent.overnight ? "Sì" : "No"}</strong>
              <span>Pernotto</span>
            </article>
          </div>

          <div className="admin-detail-hero__actions admin-detail-hero__actions--icons">
            {resolvedEvent.isPublic ? (
              <ShareButton
                className="icon-button icon-button--soft admin-detail-action"
                iconOnly
                text="Guarda questa attività e apri l'iscrizione."
                title={resolvedEvent.title}
                url={getAbsoluteUrl(getActivityPath(resolvedEvent.id, stakeId))}
              />
            ) : null}
            <button
              aria-label="Modifica attività"
              className="icon-button icon-button--soft admin-detail-action"
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
              className="icon-button icon-button--soft admin-detail-action"
              disabled={busy === "delete"}
              onClick={() => void handlePublish()}
              title="Pubblica"
              type="button"
            >
              <AppIcon name="globe" />
            </button>
            <button
              aria-label="Cancella attività"
              className="icon-button admin-detail-action admin-detail-action--danger"
              disabled={busy !== null}
              onClick={() => void handleDelete()}
              title="Cancella"
              type="button"
            >
              <AppIcon name="trash" />
            </button>
          </div>
        </div>
      </section>

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
            <span>Stanze</span>
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
                <dd>{formatDateRange(resolvedEvent.startDate, resolvedEvent.endDate)}</dd>
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
                <dd>{resolvedEvent.maxParticipants ? `${resolvedEvent.maxParticipants} posti` : "-"}</dd>
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
              <h3>Stanze e logistica</h3>
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

      {activeTab === "registrations" ? (
        <section className="admin-detail-stack">
          <div className="admin-inline-metrics admin-inline-metrics--three">
            <article className="admin-inline-metric">
              <strong>{currentCount}</strong>
              <span>Attivi</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{waitlistCount}</strong>
              <span>Attesa</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{cancelledCount}</strong>
              <span>Annullati</span>
            </article>
          </div>

          {sortedRegistrations.length === 0 ? (
            <EmptyState
              title="Nessun iscritto"
              description="Le registrazioni compariranno qui come elenco rapido."
            />
          ) : (
            <article className="surface-panel surface-panel--subtle admin-roster">
              <div className="section-head admin-roster__head">
                <div>
                  <h3>Elenco iscritti</h3>
                  <p>Tocca una riga per aprire tutti i dettagli della registrazione.</p>
                </div>
                <div className="admin-section-actions">
                  <button
                    className="button button--ghost button--small"
                    disabled={downloadingExcel || loading}
                    onClick={openExcelExportModal}
                    type="button"
                  >
                    <AppIcon name="download" />
                    <span>{downloadingExcel ? "Preparazione..." : "Scarica Excel"}</span>
                  </button>
                </div>
              </div>

              <div
                className="admin-filter-bar"
                aria-label="Filtri iscritti"
                role="group"
              >
                {registrationCategoryFilterOptions.map((option) => {
                  const active = activeRegistrationFilters.includes(option.value);

                  return (
                    <button
                      key={option.value}
                      aria-pressed={active}
                      className={
                        active
                          ? "admin-filter-toggle admin-filter-toggle--active"
                          : "admin-filter-toggle"
                      }
                      onClick={() => toggleRegistrationFilter(option.value)}
                      type="button"
                    >
                      <span className="admin-filter-toggle__box" aria-hidden="true">
                        {active ? <AppIcon name="check" /> : null}
                      </span>
                      <span className="admin-filter-toggle__label">{option.label}</span>
                      <small>{registrationFilterCounts[option.value]}</small>
                    </button>
                  );
                })}

                <label className="admin-filter-select">
                  <span>Unità</span>
                  <select
                    className="input"
                    value={selectedUnitFilter}
                    onChange={(eventInput) => setSelectedUnitFilter(eventInput.target.value)}
                  >
                    <option value="all">Tutte le unità</option>
                    {registrationUnitOptions.map((unitOption) => (
                      <option key={unitOption} value={unitOption}>
                        {unitOption}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-filter-select admin-filter-select--search">
                  <span>Cerca</span>
                  <input
                    className="input"
                    type="search"
                    placeholder="Nome, cognome o email"
                    value={nameSearch}
                    onChange={(eventInput) => setNameSearch(eventInput.target.value)}
                  />
                </label>
              </div>

              {filteredRegistrations.length === 0 ? (
                <EmptyState
                  title="Nessun iscritto con questi filtri"
                  description="Attiva almeno una categoria o cambia selezione."
                />
              ) : (
                <div className="admin-roster__list" role="list">
                  {filteredRegistrations.map((registration) => {
                    const days = registration.participatingDays ?? [];
                    const supportsDays =
                      resolvedEvent.activityType === "overnight" ||
                      resolvedEvent.activityType === "camp" ||
                      resolvedEvent.activityType === "multi_day" ||
                      resolvedEvent.activityType === "trip";
                    const showDays = supportsDays && days.length > 0;
                    return (
                      <button
                        key={registration.id}
                        className="admin-roster-row"
                        onClick={() => openRegistrationModal(registration.id, "registration")}
                        type="button"
                      >
                        <strong>{getRegistrationDisplayName(registration)}</strong>
                        <span className="admin-roster-row__type">
                          {getCategoryShortLabel(registration)}
                        </span>
                        {showDays ? (
                          <small className="admin-roster-row__days">
                            Giorni:{" "}
                            {days
                              .map((day) =>
                                new Date(day).toLocaleDateString("it-IT", {
                                  day: "2-digit",
                                  month: "2-digit",
                                }),
                              )
                              .join(", ")}
                          </small>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          )}
        </section>
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
                        getParentAuthorizationBadge(registration, true).tone !== "success") ||
                      (resolvedEvent.requiresParentalConsent &&
                        registration.answers.parentalConsentAccepted !== true) ||
                      (resolvedEvent.requiresPhotoRelease &&
                        registration.answers.photoReleaseAccepted !== true) ||
                      (isMinorRegistration(registration) && !registration.parentConsentDocumentUrl),
                  ).length
                }
              </strong>
              <span>Da verificare</span>
            </article>
          </div>

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
                    onClick={() => void handleBackfillLegacyApprovals()}
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
                const isSelected = selectedConsentRegistrationId === registration.id;
                const isEmailEditing = parentEmailEditingId === registration.id;
                const isCurrentBusy = busyRegistrationId === registration.id;
                const parentEmail = getParentEmail(registration);
                const parentName = getParentName(registration);
                const parentalAccepted = registration.answers.parentalConsentAccepted === true;
                const photoAccepted = registration.answers.photoReleaseAccepted === true;
                const signerName =
                  typeof registration.answers.parentalConsentSignerName === "string" &&
                  registration.answers.parentalConsentSignerName
                    ? registration.answers.parentalConsentSignerName
                    : typeof registration.answers.photoReleaseSignerName === "string"
                      ? registration.answers.photoReleaseSignerName
                      : "";
                const parentAuthStatus = registration.parentAuthorization?.status ?? "missing";
                const hasSignedParentAuthorizationPdf =
                  parentAuthStatus === "authorized" &&
                  Boolean(registration.parentAuthorization?.pdfPath);
                const canResendParentEmail =
                  resolvedEvent.requiresParentAuthorization &&
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
                        setSelectedConsentRegistrationId(isSelected ? null : registration.id)
                      }
                      type="button"
                    >
                      <span className="admin-consent-summary__person">
                        <strong>{getRegistrationDisplayName(registration)}</strong>
                        <span>
                          {getUnitLabel(registration)} • {getCategoryShortLabel(registration)}
                        </span>
                      </span>
                      <span className="chip-row admin-chip-row admin-consent-summary__badges">
                        {resolvedEvent.requiresParentAuthorization ? (
                          <StatusBadge label={authBadge.label} tone={authBadge.tone} />
                        ) : null}
                        {resolvedEvent.requiresParentalConsent ? (
                          <StatusBadge
                            label={parentalAccepted ? "Genitore OK" : "Genitore NO"}
                            tone={parentalAccepted ? "success" : "warning"}
                          />
                        ) : null}
                        {resolvedEvent.requiresPhotoRelease ? (
                          <StatusBadge
                            label={photoAccepted ? "Foto OK" : "Foto NO"}
                            tone={photoAccepted ? "success" : "warning"}
                          />
                        ) : null}
                        <StatusBadge
                          label={registration.consentSignatureUrl ? "Firma" : "No firma"}
                          tone={registration.consentSignatureUrl ? "success" : "warning"}
                        />
                        <StatusBadge
                          label={registration.parentIdDocumentUrl ? "ID" : "No ID"}
                          tone={registration.parentIdDocumentUrl ? "success" : "warning"}
                        />
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
                              <dd>{formatDateTime(registration.parentAuthorization.emailSentAt)}</dd>
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
                                      setParentEmailDraft(eventInput.target.value)
                                    }
                                    type="email"
                                    value={parentEmailDraft}
                                  />
                                </label>
                                <div className="inline-actions">
                                  <button
                                    className="button button--primary button--small"
                                    disabled={busy !== null}
                                    onClick={() => void handleSaveParentEmail(registration)}
                                    type="button"
                                  >
                                    <AppIcon name="check" />
                                    <span>
                                      {isCurrentBusy && busy === "saveParentEmail"
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
                                  onClick={() => handleStartParentEmailEdit(registration)}
                                  type="button"
                                >
                                  <AppIcon name="pencil" />
                                  <span>Modifica email genitore</span>
                                </button>
                                {canResendParentEmail ? (
                                  <button
                                    className="button button--ghost button--small"
                                    disabled={busy !== null || !parentEmail}
                                    onClick={() => void handleResendParentAuthEmail(registration)}
                                    type="button"
                                  >
                                    <AppIcon name="mail" />
                                    <span>
                                      {isCurrentBusy && busy === "resendParentAuth"
                                        ? "Reinvio..."
                                        : "Reinvia email"}
                                    </span>
                                  </button>
                                ) : null}
                              </div>
                            )}
                            {registration.parentAuthorization?.emailLastError ? (
                              <p className="admin-consent-error">
                                {registration.parentAuthorization.emailLastError}
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
                              onClick={() => void handleDownloadSignedConsent(registration)}
                              type="button"
                            >
                              <AppIcon name="download" />
                              <span>
                                {isCurrentBusy && busy === "downloadSignedConsent"
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
                                void handleDownloadSignedConsent(registration, "conduct")
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
                                  const { downloadConsentPdf } = await import(
                                    "@/utils/consentPdf"
                                  );
                                  downloadConsentPdf({
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
                                  const { downloadConsentPdf } = await import(
                                    "@/utils/consentPdf"
                                  );
                                  downloadConsentPdf({
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
                            onClick={() => openRegistrationModal(registration.id, "registration")}
                            type="button"
                          >
                            Apri iscrizione
                          </button>
                          <button
                            className="button button--ghost button--small button--danger"
                            disabled={busy !== null}
                            onClick={() => void handleAdminDeleteRegistration(registration)}
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
        <section className="admin-detail-stack">
          <div className="admin-inline-metrics admin-inline-metrics--five">
            <article className="admin-inline-metric">
              <strong>{withRoomPreferencesCount}</strong>
              <span>Preferenze</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{normalizedRoomPreferencesCount}</strong>
              <span>Abbinate</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{withRoomNotesCount}</strong>
              <span>Note</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{assignedRoomCount}</strong>
              <span>Assegnati</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{currentCount - assignedRoomCount}</strong>
              <span>Da fare</span>
            </article>
          </div>

          <div className="admin-overnight-stack">
            <article className="surface-panel surface-panel--subtle">
              <h3>Logistica pernottamento</h3>
              <p>
                {resolvedEvent.roomsInfo ||
                  "Nessuna nota logistica salvata per il pernottamento in questa attività."}
              </p>
            </article>

            <article className="surface-panel surface-panel--subtle">
              <h3>Compagni più richiesti</h3>
              {roomRequestDistribution.length === 0 ? (
                <p className="subtle-text">Ancora nessuna preferenza stanza raccolta.</p>
              ) : (
                <ul className="plain-list plain-list--compact">
                  {roomRequestDistribution.slice(0, 5).map((item) => (
                    <li key={`room-request-${item.label}`}>
                      <strong>{item.label}</strong>
                      <span>
                        {item.count} • {item.percent}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          {activeRegistrations.length === 0 ? (
            <EmptyState
              title="Nessun partecipante attivo"
              description="Le preferenze pernottamento appariranno qui appena arrivano iscrizioni valide."
            />
          ) : (
            <article className="surface-panel surface-panel--subtle admin-roster">
              <div className="section-head admin-roster__head">
                <div>
                  <h3>Riepilogo stanze</h3>
                  <p>Tocca una riga per vedere preferenze stanza e risposte complete.</p>
                </div>
                <div className="admin-section-actions">
                  <button
                    className="button button--ghost button--small"
                    disabled={downloadingExcel || loading}
                    onClick={openExcelExportModal}
                    type="button"
                  >
                    <AppIcon name="download" />
                    <span>{downloadingExcel ? "Preparazione..." : "Scarica Excel"}</span>
                  </button>
                  <button
                    className="button button--secondary button--small"
                    disabled={normalizingRoomPreferences || loading}
                    onClick={() => void handleNormalizeRoomPreferences()}
                    type="button"
                  >
                    <AppIcon name="sparkles" />
                    <span>
                      {normalizingRoomPreferences
                        ? "Normalizzazione..."
                        : "Normalizza richieste"}
                    </span>
                  </button>
                </div>
              </div>

              <div className="admin-roster__list" role="list">
                {activeRegistrations.map((registration) => {
                  const roomEntries = getRoomPreferenceEntries(registration);
                  const roomPreview =
                    roomEntries.find((entry) => entry.key !== "roomNotes") ?? roomEntries[0] ?? null;

                  return (
                    <button
                      key={registration.id}
                      className="admin-roster-row admin-roster-row--overnight"
                      onClick={() => openRegistrationModal(registration.id, "overnight")}
                      type="button"
                    >
                      <div className="admin-roster-row__content">
                        <strong>{getRegistrationDisplayName(registration)}</strong>
                        <small>
                          {roomPreview ? roomPreview.value : "Nessuna preferenza stanza"}
                        </small>
                      </div>
                      <div className="admin-roster-row__side">
                        <span className="admin-roster-row__type">
                          {getCategoryShortLabel(registration)}
                        </span>
                        <span
                          className={
                            registration.assignedRoomId
                              ? "admin-roster-row__flag admin-roster-row__flag--success"
                              : "admin-roster-row__flag"
                          }
                        >
                          {registration.assignedRoomId ? "OK" : "--"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </article>
          )}
        </section>
      ) : null}

      {activeTab === "questions" && resolvedEvent.questionsEnabled ? (
        <section className="admin-detail-stack">
          <div className="admin-inline-metrics admin-inline-metrics--three">
            <article className="admin-inline-metric">
              <strong>{visibleQuestions.length}</strong>
              <span>Visibili</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{visibleQuestions.filter((question) => question.isAnonymous).length}</strong>
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
                    Le domande anonime non mostrano l'autore. Usa "Nascondi" per escluderle dal
                    riepilogo da girare al Settanta.
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
                  const ownerRegistration = registrationLookupById.get(question.registrationId);
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
                      <small>Inviata il {formatDateTime(question.createdAt)}</small>
                      <div className="inline-actions inline-actions--compact">
                        <button
                          className="button button--ghost button--small"
                          onClick={() => void handleToggleQuestionStatus(question)}
                          type="button"
                        >
                          <AppIcon name={isHidden ? "eye" : "lock"} />
                          <span>{isHidden ? "Ripristina" : "Nascondi"}</span>
                        </button>
                        <button
                          className="button button--ghost button--small"
                          onClick={() => void handleDeleteQuestion(question)}
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
                label={getRegistrationStatusLabel(registrationModal.registrationStatus)}
                tone={getRegistrationStatusTone(registrationModal.registrationStatus)}
              />
            </div>

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
                  value: getRegistrationStatusLabel(registrationModal.registrationStatus),
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
                  value:
                    registrationModal.submittedByMode === "anonymous" ? "Ospite" : "Con account",
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
                ...(registrationModalMode === "overnight" || registrationModalRoomEntries.length > 0
                  ? [
                      {
                        label: "Stanza",
                        value: registrationModal.assignedRoomId || "Da assegnare",
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
                <h4>Preferenze stanza</h4>
                <div className="admin-answer-grid">
                  {registrationModalRoomEntries.map((entry) => (
                    <article
                      key={`${registrationModal.id}-${entry.key}`}
                      className="admin-answer-card"
                    >
                      <strong>{entry.label}</strong>
                      <span>{entry.value}</span>
                      {entry.key !== "roomNotes" ? (
                        <small>{entry.isMatched ? "Richiesta collegata" : "Richiesta non collegata"}</small>
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
                    <article key={`${registrationModal.id}-${entry.key}`} className="admin-answer-card">
                      <strong>{entry.label}</strong>
                      <span>{entry.value}</span>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <p className="subtle-text">Nessun dettaglio aggiuntivo oltre ai dati principali.</p>
            )}

            <div className="inline-actions" style={{ flexWrap: "wrap" }}>
              {registrationModal.registrationStatus === "cancelled" ? (
                <button
                  className="button button--soft button--small"
                  disabled={busy !== null}
                  onClick={() => void handleAdminReactivateRegistration(registrationModal)}
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
                  onClick={() => void handleAdminCancelRegistration(registrationModal)}
                  type="button"
                >
                  <AppIcon name="x" />
                  <span>
                    {busyRegistrationId === registrationModal.id &&
                    busy === "cancelRegistration"
                      ? "Annullamento..."
                      : "Annulla iscrizione"}
                  </span>
                </button>
              )}
              <button
                className="button button--ghost button--small"
                disabled={busy !== null}
                onClick={() => void handleAdminDeleteRegistration(registrationModal)}
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
              "Annulla" sposta l'iscrizione tra le cancellate (reversibile). "Elimina"
              rimuove definitivamente il documento (irreversibile).
            </p>
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
          onClose={() => {
            if (!downloadingExcel) setExcelExportModalOpen(false);
          }}
          onConfirm={handleDownloadExcel}
        />
      ) : null}
    </div>
  );
}
