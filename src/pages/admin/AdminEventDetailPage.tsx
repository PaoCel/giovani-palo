import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { AdminActivityCard } from "@/components/AdminActivityCard";
import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { AppIcon } from "@/components/AppIcon";
import { AppModal } from "@/components/AppModal";
import { EmptyState } from "@/components/EmptyState";
import { RegistrationExcelExportModal } from "@/components/RegistrationExcelExportModal";
import { StatusBadge } from "@/components/StatusBadge";
import { SurveyEditor } from "@/components/SurveyEditor";
import { SurveyResultsPanel } from "@/components/SurveyResultsPanel";
import { AdminGalleryEditor } from "@/components/AdminGalleryEditor";
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

  if (pathname.endsWith("/surveys")) {
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
    null | "publish" | "delete" | "resendParentAuth" | "deleteRegistration"
  >(null);
  const [busyRegistrationId, setBusyRegistrationId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [registrationModalId, setRegistrationModalId] = useState<string | null>(null);
  const [registrationModalMode, setRegistrationModalMode] =
    useState<RegistrationModalMode>("registration");
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [excelExportModalOpen, setExcelExportModalOpen] = useState(false);
  const [normalizingRoomPreferences, setNormalizingRoomPreferences] = useState(false);
  const [activeRegistrationFilters, setActiveRegistrationFilters] = useState<
    RegistrationCategoryFilter[]
  >(["giovane_uomo", "giovane_donna", "dirigente", "accompagnatore"]);
  const [selectedUnitFilter, setSelectedUnitFilter] = useState("all");

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
  const filteredRegistrations = useMemo(
    () =>
      sortedRegistrations.filter(
        (registration) =>
          isRegistrationCategoryFilter(registration.genderRoleCategory) &&
          activeRegistrationFilters.includes(registration.genderRoleCategory) &&
          (selectedUnitFilter === "all" || getUnitLabel(registration) === selectedUnitFilter),
      ),
    [activeRegistrationFilters, selectedUnitFilter, sortedRegistrations],
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
    Boolean(registration.parentConsentDocumentUrl),
  ).length;
  const missingMinorConsentCount = minorRegistrations.length - uploadedMinorConsentCount;
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
          `Email di autorizzazione reinviata a ${registration.parentAuthorization?.parentEmail || "genitore"}.`,
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
          {resolvedEvent.requiresParentAuthorization ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Autorizzazione genitoriale via email (magic link)</h3>
              <p className="subtle-text">
                Stato del flusso email Brevo per ogni iscritto. Il sistema invia
                automaticamente il link al genitore alla prima iscrizione. Da qui puoi
                reinviare l&apos;email (invalida il vecchio link e crea uno nuovo) o
                eliminare un&apos;iscrizione di test.
              </p>
              {sortedRegistrations.length === 0 ? (
                <EmptyState
                  title="Nessuna iscrizione"
                  description="Quando arrivano iscrizioni vedrai qui lo stato dell'autorizzazione genitore."
                />
              ) : (
                <div className="stack">
                  {sortedRegistrations.map((registration) => {
                    const auth = registration.parentAuthorization;
                    const status = auth?.status ?? "not_required";
                    const tone =
                      status === "authorized"
                        ? "success"
                        : status === "rejected_by_parent" || status === "email_error"
                          ? "danger"
                          : status === "expired"
                            ? "warning"
                            : status === "email_sent" ||
                                status === "pending_parent_authorization"
                              ? "warning"
                              : "info";
                    const label =
                      status === "authorized"
                        ? "Autorizzata dal genitore"
                        : status === "rejected_by_parent"
                          ? "Rifiutata dal genitore"
                          : status === "email_error"
                            ? "Errore invio email"
                            : status === "expired"
                              ? "Link scaduto"
                              : status === "email_sent"
                                ? "Email inviata, in attesa"
                                : status === "pending_parent_authorization"
                                  ? "In attesa primo invio"
                                  : "Non richiesta";
                    const isCurrentBusy = busyRegistrationId === registration.id;
                    return (
                      <article
                        key={`parentauth-${registration.id}`}
                        className="surface-panel surface-panel--subtle admin-registration-row"
                      >
                        <div>
                          <strong>{getRegistrationDisplayName(registration)}</strong>
                          <p>{getUnitLabel(registration)}</p>
                          {auth?.parentEmail ? (
                            <p>
                              Email genitore: <code>{auth.parentEmail}</code>
                            </p>
                          ) : null}
                          {auth?.emailSentAt ? (
                            <p>
                              Ultimo invio: {formatDateTime(auth.emailSentAt)}
                            </p>
                          ) : null}
                          {auth?.emailLastError ? (
                            <p style={{ color: "#b14e44" }}>
                              Errore: {auth.emailLastError}
                            </p>
                          ) : null}
                          <div className="chip-row admin-chip-row" style={{ marginTop: "0.4rem" }}>
                            <StatusBadge label={label} tone={tone} />
                          </div>
                        </div>

                        <div className="admin-registration-row__meta">
                          {status === "authorized" || status === "rejected_by_parent" ? null : (
                            <button
                              className="button button--ghost button--small"
                              disabled={busy !== null}
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
                          )}
                          <button
                            className="button button--ghost button--small"
                            disabled={busy !== null}
                            onClick={() => void handleAdminDeleteRegistration(registration)}
                            type="button"
                          >
                            <AppIcon name="trash" />
                            <span>
                              {isCurrentBusy && busy === "deleteRegistration"
                                ? "Eliminazione..."
                                : "Elimina iscrizione"}
                            </span>
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </article>
          ) : null}

          {resolvedEvent.requiresParentalConsent || resolvedEvent.requiresPhotoRelease ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Autorizzazioni digitali</h3>
              <p className="subtle-text">
                Stato per ogni iscritto: spunte accettate, firma digitale, documento d&apos;identita
                del genitore. Scarica il PDF compilato per consegnarlo o archiviarlo.
              </p>
              {activeRegistrations.length === 0 ? (
                <EmptyState
                  title="Nessuna iscrizione attiva"
                  description="Quando arrivano le iscrizioni vedrai lo stato dei consensi qui."
                />
              ) : (
                <div className="stack">
                  {activeRegistrations.map((registration) => {
                    const parentalAccepted =
                      registration.answers.parentalConsentAccepted === true;
                    const photoAccepted =
                      registration.answers.photoReleaseAccepted === true;
                    const signerName =
                      typeof registration.answers.parentalConsentSignerName === "string" &&
                      registration.answers.parentalConsentSignerName
                        ? registration.answers.parentalConsentSignerName
                        : typeof registration.answers.photoReleaseSignerName === "string"
                          ? registration.answers.photoReleaseSignerName
                          : "";
                    return (
                      <article
                        key={`consent-new-${registration.id}`}
                        className="surface-panel surface-panel--subtle admin-registration-row"
                      >
                        <div>
                          <strong>{getRegistrationDisplayName(registration)}</strong>
                          <p>{getUnitLabel(registration)}</p>
                          {signerName ? <p>Firmatario: {signerName}</p> : null}
                          <div className="chip-row admin-chip-row" style={{ marginTop: "0.4rem" }}>
                            {resolvedEvent.requiresParentalConsent ? (
                              <StatusBadge
                                label={parentalAccepted ? "Consenso genitore" : "Consenso mancante"}
                                tone={parentalAccepted ? "success" : "warning"}
                              />
                            ) : null}
                            {resolvedEvent.requiresPhotoRelease ? (
                              <StatusBadge
                                label={photoAccepted ? "Liberatoria foto" : "Liberatoria mancante"}
                                tone={photoAccepted ? "success" : "warning"}
                              />
                            ) : null}
                            <StatusBadge
                              label={
                                registration.consentSignatureUrl ? "Firma digitale" : "Senza firma"
                              }
                              tone={registration.consentSignatureUrl ? "success" : "warning"}
                            />
                            <StatusBadge
                              label={
                                registration.parentIdDocumentUrl ? "ID genitore" : "ID assente"
                              }
                              tone={registration.parentIdDocumentUrl ? "success" : "warning"}
                            />
                          </div>
                        </div>

                        <div className="admin-registration-row__meta">
                          {registration.consentSignatureUrl ? (
                            <a
                              className="button button--ghost button--small"
                              href={registration.consentSignatureUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <AppIcon name="eye" />
                              <span>Vedi firma</span>
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
                              <span>Vedi ID</span>
                            </a>
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
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </article>
          ) : null}

          <div className="admin-inline-metrics admin-inline-metrics--three">
            <article className="admin-inline-metric">
              <strong>{minorRegistrations.length}</strong>
              <span>Minori</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{uploadedMinorConsentCount}</strong>
              <span>Caricati</span>
            </article>
            <article className="admin-inline-metric">
              <strong>{missingMinorConsentCount}</strong>
              <span>Da richiedere</span>
            </article>
          </div>

          {data?.organization?.minorConsentExampleImageUrl ? (
            <article className="surface-panel surface-panel--subtle">
              <h3>Esempio mostrato ai partecipanti</h3>
              <div
                className="upload-preview admin-consent-example"
                style={{
                  backgroundImage: `url(${data.organization.minorConsentExampleImageUrl})`,
                }}
              />
            </article>
          ) : null}

          {minorRegistrations.length === 0 ? (
            <EmptyState
              title="Nessun minore da verificare"
              description="I consensi genitori compariranno qui solo per le registrazioni minorenni attive."
            />
          ) : (
            <div className="stack">
              {minorRegistrations.map((registration) => (
                <article
                  key={`consent-${registration.id}`}
                  className="surface-panel surface-panel--subtle admin-registration-row admin-consent-row"
                >
                  <div>
                    <strong>{getRegistrationDisplayName(registration)}</strong>
                    <p>{getUnitLabel(registration)}</p>
                    <p>
                      {registration.submittedByMode === "anonymous" ? "Ospite" : "Con account"}
                      {" • "}
                      {registration.parentConsentDocumentUrl
                        ? "Documento caricato"
                        : registration.submittedByMode === "anonymous"
                          ? "Manca: chiedere creazione account"
                          : "Manca: da caricare"}
                    </p>
                  </div>

                  <div className="admin-registration-row__meta">
                    <StatusBadge
                      label={
                        registration.parentConsentDocumentUrl ? "Documento presente" : "Documento mancante"
                      }
                      tone={registration.parentConsentDocumentUrl ? "success" : "warning"}
                    />
                    {registration.parentConsentDocumentUrl ? (
                      <div className="inline-actions inline-actions--compact">
                        <a
                          className="button button--ghost button--small"
                          href={registration.parentConsentDocumentUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <AppIcon name="eye" />
                          <span>Vedi</span>
                        </a>
                        <a
                          className="button button--ghost button--small"
                          download={
                            registration.parentConsentDocumentName || "consenso-genitore.jpg"
                          }
                          href={registration.parentConsentDocumentUrl}
                        >
                          <AppIcon name="download" />
                          <span>Scarica</span>
                        </a>
                      </div>
                    ) : null}
                    <button
                      className="button button--ghost button--small"
                      onClick={() => openRegistrationModal(registration.id, "registration")}
                      type="button"
                    >
                      Apri iscrizione
                    </button>
                  </div>
                </article>
              ))}
            </div>
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
          <article className="surface-panel surface-panel--subtle">
            <h3>Galleria foto e video</h3>
            <p className="subtle-text">
              Carica foto e video dell'attività. I partecipanti potranno vederli
              dopo aver inserito il codice galleria.
            </p>
            <AdminGalleryEditor
              stakeId={stakeId}
              eventId={resolvedEventId}
              uploadedBy={session?.firebaseUser.uid ?? ""}
              galleryAccessCode={resolvedEvent.galleryAccessCode ?? ""}
            />
          </article>
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
                        value: registrationModal.parentConsentDocumentUrl
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
