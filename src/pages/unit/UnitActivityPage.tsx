import "@/styles/unitActivity.css";
import dirigenteUrl from "@/assets/flusso-genitore/dirigente.webp";
import giovaniUrl from "@/assets/flusso-genitore/giovani.webp";
import { ANNUNCIATA } from "@/copy/annunciata";
import { CAMP } from "@/copy/camp";
import { fillCopy } from "@/copy/parole";
import { getCampGroupLabels, getCommitteeInitials } from "@/utils/campGroups";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useParams } from "react-router-dom";

import type { AppIconName } from "@/components/AppIcon";
import { ActivityMediaCard } from "@/components/gallery/ActivityMediaCard";
import { AppModal } from "@/components/AppModal";
import { CampPackingChecklist } from "@/components/CampPackingChecklist";
import { PhotoConsentPills } from "@/components/PhotoConsentPills";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Icon,
  Notice,
  Pill,
  buttonClassName,
} from "@/components/ui";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { parentAuthorizationService } from "@/services/firestore/parentAuthorizationService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { unitLeaderService } from "@/services/firestore/unitLeaderService";
import { unitTransportNotesService } from "@/services/firestore/unitTransportNotesService";
import type { CampPatrolRole, CampPublicMember, Registration, UserProfile } from "@/types";
import { isMinorBirthDate } from "@/utils/age";
import { isCampEvent } from "@/utils/events";
import {
  getUnitActivityTabs,
  getVisibleUnitActivityTab,
  splitGroupsByMembers,
  type UnitActivityTab,
} from "@/utils/unitActivityView";
import {
  getParentAuthorizationBadge,
  getPhotoConsentBadges,
} from "@/utils/parentAuthorization";
import { getGenderRoleCategoryLabel } from "@/utils/profile";
import {
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";
import { DEFAULT_STAKE_ID } from "@/config/app";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatUnitDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) {
    return formatDate(startDate);
  }

  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function TransportBadge({
  registration,
  isResolved,
  onToggle,
}: {
  registration: Registration;
  isResolved: boolean;
  onToggle: () => void;
}) {
  const mode =
    typeof registration.answers.transportMode === "string"
      ? registration.answers.transportMode
      : "";

  const needsHelp = !mode || mode === "Da definire" || mode === "Passaggio";

  if (!needsHelp) {
    return (
      <Pill className="unit-activity-transport" tone="success" title={mode}>
        {mode}
      </Pill>
    );
  }

  if (isResolved) {
    return (
      <div className="unit-activity-cell">
        <Pill className="unit-activity-transport" icon="check" tone="success" title="Trasporto organizzato dall'unità">
          Risolto
        </Pill>
        <Button icon="x" onClick={onToggle} variant="ghost">
          Annulla risoluzione
        </Button>
      </div>
    );
  }

  return (
    <div className="unit-activity-cell">
      <Pill className="unit-activity-transport" tone="warning" title={mode || "Trasporto da definire"}>
        {mode || "Da definire"}
      </Pill>
      <Button icon="check" onClick={onToggle} variant="secondary">
        Segna come risolto
      </Button>
    </div>
  );
}

function ConsentCell({
  registration,
  requiresParentAuthorization,
  isResending,
  onResend,
}: {
  registration: Registration;
  requiresParentAuthorization: boolean;
  isResending: boolean;
  onResend: () => void;
}) {
  const hasPhoto = registration.answers.photoInternalConsent === true;
  // Per i minori vale la scelta del genitore, non la spunta nel modulo.
  const hasParentPhotoChoice = getPhotoConsentBadges(registration) !== null;
  const isMinor = isMinorBirthDate(registration.birthDate);
  const parentBadge = getParentAuthorizationBadge(registration, requiresParentAuthorization);
  const hasParent = parentBadge.tone === "success";
  const parentRequest = registration.answers.parentAuthorizationRequest;
  const requestEmail =
    parentRequest && typeof parentRequest === "object" && !Array.isArray(parentRequest)
      ? (parentRequest as unknown as Record<string, unknown>).parentEmail
      : null;
  const hasParentEmail = Boolean(
    registration.parentAuthorization?.parentEmail ||
      (typeof requestEmail === "string" && requestEmail.trim()),
  );
  const canResend =
    isMinor &&
    requiresParentAuthorization &&
    hasParentEmail &&
    registration.parentAuthorization?.status !== "authorized" &&
    registration.parentAuthorization?.status !== "rejected_by_parent";

  return (
    <div className="unit-activity-cell">
      {hasParentPhotoChoice ? (
        <PhotoConsentPills registration={registration} />
      ) : (
        <Pill
          icon={hasPhoto ? "check" : "x"}
          title={hasPhoto ? "Consenso foto OK" : "Consenso foto mancante"}
          tone={hasPhoto ? "success" : "danger"}
        >
          Foto
        </Pill>
      )}
      {isMinor && requiresParentAuthorization ? (
        <>
          <Pill
            icon={hasParent ? "check" : "x"}
            title={`Autorizzazione genitore: ${parentBadge.label}`}
            tone={hasParent ? "success" : "danger"}
          >
            Genitore
          </Pill>
          {registration.parentConsentDocumentUrl ? (
            <a
              className={buttonClassName({ variant: "ghost" })}
              href={registration.parentConsentDocumentUrl}
              onClick={(e) => e.stopPropagation()}
              rel="noreferrer"
              target="_blank"
            >
              <Icon name="download" />
              <span>Doc. genitore</span>
            </a>
          ) : null}
          {canResend ? (
            <Button
              busy={isResending}
              icon="mail"
              onClick={onResend}
              variant="secondary"
            >
              {isResending ? "Invio..." : "Reinvia email"}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

interface UnitCampAssignment {
  patrolId: string | null;
  patrolName: string | null;
  patrolRole: CampPatrolRole | null;
  committeeId: string | null;
  committeeTitle: string | null;
  committeeRole: "leader" | "member" | null;
}

function CampAssignmentCell({
  assignment,
  registration,
  groupName,
}: {
  assignment: UnitCampAssignment | null;
  registration: Registration;
  groupName: string;
}) {
  const fallbackCommittee = registration.assignedCommittees[0];
  const patrolName = assignment?.patrolName ?? registration.assignedPatrolName;
  const committeeTitle = assignment?.committeeTitle ?? fallbackCommittee?.title;

  if (!patrolName && !committeeTitle) {
    return <span className="unit-activity-person__none">-</span>;
  }

  return (
    <div className="unit-activity-cell">
      {patrolName ? (
        <Pill title={groupName} tone="info">
          {patrolName}
        </Pill>
      ) : null}
      {committeeTitle ? <Pill title="Comitato">{committeeTitle}</Pill> : null}
    </div>
  );
}

function RegistrationRow({
  registration,
  isTransportResolved,
  campAssignment,
  groupName,
  showCampAssignment,
  assignmentLabel,
  requiresParentAuthorization,
  onToggleTransport,
  isResending,
  onResendParentAuthorization,
}: {
  registration: Registration;
  isTransportResolved: boolean;
  campAssignment: UnitCampAssignment | null;
  groupName: string;
  showCampAssignment: boolean;
  assignmentLabel: string;
  requiresParentAuthorization: boolean;
  onToggleTransport: () => void;
  isResending: boolean;
  onResendParentAuthorization: () => void;
}) {
  const categoryLabel = getGenderRoleCategoryLabel(registration.genderRoleCategory);
  const statusTone = getRegistrationStatusTone(registration.registrationStatus);
  const statusLabel = getRegistrationStatusLabel(registration.registrationStatus);

  return (
    <li className="unit-activity-person">
      <div className="unit-activity-person__head">
        <span className="unit-activity-avatar" aria-hidden="true">
          {getCommitteeInitials(registration.fullName)}
        </span>
        <p className="unit-activity-person__name">
          <strong>{registration.fullName}</strong>{" "}
          <span>{categoryLabel}</span>
        </p>
        <Pill dot tone={statusTone}>
          {statusLabel}
        </Pill>
      </div>
      <dl className="unit-activity-person__facts">
        <div>
          <dt>Trasporto</dt>
          <dd>
            <TransportBadge
              registration={registration}
              isResolved={isTransportResolved}
              onToggle={onToggleTransport}
            />
          </dd>
        </div>
        <div>
          <dt>Consensi</dt>
          <dd>
            <ConsentCell
              registration={registration}
              requiresParentAuthorization={requiresParentAuthorization}
              isResending={isResending}
              onResend={onResendParentAuthorization}
            />
          </dd>
        </div>
        {showCampAssignment ? (
          <div>
            <dt>{assignmentLabel}</dt>
            <dd>
              <CampAssignmentCell registration={registration} assignment={campAssignment} groupName={groupName} />
            </dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}

function NotRegisteredRow({ youth }: { youth: UserProfile }) {
  return (
    <li className="unit-activity-person unit-activity-person--unregistered">
      <div className="unit-activity-person__head">
        <span className="unit-activity-avatar unit-activity-avatar--muted" aria-hidden="true">
          {getCommitteeInitials(youth.fullName)}
        </span>
        <p className="unit-activity-person__name">
          <strong>{youth.fullName}</strong>{" "}
          <span>
            {getGenderRoleCategoryLabel(youth.genderRoleCategory)} · Non iscritto/a
          </span>
        </p>
      </div>
    </li>
  );
}

const initialData = {
  event: null as Awaited<ReturnType<typeof unitLeaderService.getUnitActivityDetail>>["event"],
  registrations: [] as Registration[],
  unitYouth: [] as UserProfile[],
  campManagement: { groupLabel: "pattuglia" as const, committees: [], patrols: [], manualLeaders: [], updatedAt: "" },
  campManagementAvailable: false,
  stats: { total: 0, needsTransport: 0, missingPhotoConsent: 0, missingParentConsent: 0 },
};
// Stato senza dati: prima del primo esito e per un contesto che non ha ancora
// risposto (vedi `contextKey` nella pagina).
const initialState = { contextKey: "", ...initialData };

type CampGroup =
  | {
      kind: "patrol";
      id: string;
      title: string;
      responsibilities?: string;
      registrations: Registration[];
      roles: Record<string, CampPatrolRole>;
      manualLeaderNames: string[];
      publicMembers: CampPublicMember[];
    }
  | {
      kind: "committee";
      id: string;
      title: string;
      responsibilities?: string;
      registrations: Registration[];
      roles: Record<string, "leader" | "member">;
      manualLeaderNames: string[];
      publicMembers: CampPublicMember[];
    };

function getPatrolRoleShortLabel(role: CampPatrolRole | null) {
  switch (role) {
    case "leader":
      return "Capo";
    case "supervisor":
      return "Supervisore";
    case "member":
      return "Membro";
    default:
      return "Membro";
  }
}

function getCommitteeRoleShortLabel(role: "leader" | "member" | null) {
  return role === "leader" ? "Responsabile" : "Membro";
}

function getCampGroupMemberCount(group: CampGroup) {
  return group.publicMembers.length + group.manualLeaderNames.length;
}

function getCampGroupPreview(group: CampGroup) {
  return [
    ...group.manualLeaderNames,
    ...group.publicMembers.map((member) => member.fullName),
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

function getCampPublicMemberSubtitle(member: CampPublicMember) {
  return [
    getGenderRoleCategoryLabel(member.genderRoleCategory),
    member.unitName,
  ]
    .filter(Boolean)
    .join(" · ");
}

function getCampPublicMemberRoleLabel(member: CampPublicMember, kind: CampGroup["kind"]) {
  if (kind === "patrol") {
    return getPatrolRoleShortLabel(member.role as CampPatrolRole);
  }

  return getCommitteeRoleShortLabel(member.role === "leader" ? "leader" : "member");
}

export function UnitActivityPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? DEFAULT_STAKE_ID;
  const unitId = session?.profile.unitId ?? "";
  const [selectedCampGroupKey, setSelectedCampGroupKey] = useState<string | null>(null);
  const [resendingRegistrationId, setResendingRegistrationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<UnitActivityTab>("registrations");
  // Esiti legati al contesto (account|palo|unità|attività) in cui sono nati:
  // si filtrano durante il render, così non compaiono nemmeno nel primo
  // render dopo un cambio, prima dell'effetto di pulizia.
  const [actionInfo, setActionInfo] = useState<{ contextKey: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<{ contextKey: string; message: string } | null>(null);

  // I risultati appartengono al contesto per cui sono stati chiesti (account,
  // palo, unità, attività): useAsyncData conserva l'ultimo risultato durante
  // il nuovo caricamento e anche se fallisce, quindi si usano solo con la
  // chiave corrente. Altrimenti la pagina è in caricamento o in errore, senza
  // iscritti, comitati o gruppi del contesto precedente.
  const contextKey = `${session?.firebaseUser.uid ?? ""}|${stakeId}|${unitId}|${eventId}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  const { data: loadedData, loading: loadingAnyContext, error, reload } = useAsyncData(
    async () => ({
      ...(await unitLeaderService.getUnitActivityDetail(stakeId, eventId, unitId)),
      contextKey,
    }),
    [contextKey, stakeId, eventId, unitId],
    initialState,
  );
  const dataSettled = loadedData.contextKey === contextKey;
  const data: typeof loadedData = dataSettled ? loadedData : initialState;
  const loading = loadingAnyContext || (!dataSettled && !error);

  const { data: loadedResolved, setData: setLoadedResolved } = useAsyncData(
    async () => ({
      contextKey,
      ids: await unitTransportNotesService.listResolved(stakeId, eventId),
    }),
    [contextKey, stakeId, eventId],
    { contextKey: "", ids: [] as string[] },
  );
  const resolvedIds = loadedResolved.contextKey === contextKey ? loadedResolved.ids : [];

  // Lo zaino si legge e si salva solo con un'iscrizione propria all'attività
  // (firestore.rules, packingChecklists: hasOwnRegistration). Il dirigente
  // che non partecipa non vede la scheda invece di un errore dei permessi.
  const leaderUid = session?.firebaseUser.uid ?? "";
  const { data: loadedOwnRegistration } = useAsyncData(
    async () => ({
      contextKey,
      found: leaderUid
        ? Boolean(
            await registrationsService
              .getRegistrationByActor(stakeId, eventId, { userId: leaderUid })
              .catch(() => null),
          )
        : false,
    }),
    [contextKey, leaderUid, stakeId, eventId],
    { contextKey: "", found: false },
  );
  const hasOwnRegistration =
    loadedOwnRegistration.contextKey === contextKey && loadedOwnRegistration.found;
  function setResolvedIds(ids: string[]) {
    setLoadedResolved({ contextKey, ids });
  }

  // Cambio di account, palo o attività: niente foglio né esito dell'altro contesto.
  useEffect(() => {
    setSelectedCampGroupKey(null);
    setActiveTab("registrations");
    setActionInfo(null);
    setActionError(null);
  }, [contextKey]);

  const visibleActionInfo =
    actionInfo && actionInfo.contextKey === contextKey ? actionInfo.message : null;
  const visibleActionError =
    actionError && actionError.contextKey === contextKey ? actionError.message : null;

  const resolvedSet = useMemo(() => new Set(resolvedIds), [resolvedIds]);

  async function handleToggleTransport(registrationId: string) {
    const isResolved = resolvedSet.has(registrationId);

    if (isResolved) {
      setResolvedIds(resolvedIds.filter((id) => id !== registrationId));
      await unitTransportNotesService.clearResolved(stakeId, eventId, registrationId);
    } else {
      setResolvedIds([...resolvedIds, registrationId]);
      await unitTransportNotesService.markResolved(
        stakeId,
        eventId,
        registrationId,
        session?.firebaseUser.uid ?? "",
      );
    }
  }

  async function handleResendParentAuthorization(registration: Registration) {
    const startedFor = contextKey;
    setResendingRegistrationId(registration.id);
    setActionInfo(null);
    setActionError(null);

    try {
      const result = await parentAuthorizationService.resend({
        stakeId,
        activityId: eventId,
        registrationId: registration.id,
      });

      if (!result.sent) {
        throw new Error("L'email non è partita. Riprova o contatta la presidenza di palo.");
      }

      // Risposta arrivata dopo un cambio di account o di attività: niente esito.
      if (contextKeyRef.current !== startedFor) return;
      setActionInfo({
        contextKey: startedFor,
        message: `Email di autorizzazione reinviata per ${registration.fullName}.`,
      });
      reload();
    } catch (caughtError) {
      if (contextKeyRef.current !== startedFor) return;
      setActionError({
        contextKey: startedFor,
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "Impossibile reinviare l'email di autorizzazione.",
      });
    } finally {
      setResendingRegistrationId(null);
    }
  }

  const effectiveNeedsTransport = useMemo(
    () =>
      data.registrations.filter((r) => {
        const t = typeof r.answers.transportMode === "string" ? r.answers.transportMode : "";
        return (!t || t === "Da definire" || t === "Passaggio") && !resolvedSet.has(r.id);
      }).length,
    [data.registrations, resolvedSet],
  );

  const registeredUserIds = new Set(
    data.registrations.flatMap((r) => (r.userId ? [r.userId] : [])),
  );
  const notRegistered = data.unitYouth.filter((y) => !registeredUserIds.has(y.id));
  const registrationById = useMemo(
    () => new Map(data.registrations.map((registration) => [registration.id, registration])),
    [data.registrations],
  );
  const manualLeaderById = useMemo(
    () =>
      new Map(
        data.campManagement.manualLeaders.map((leader) => [
          leader.id,
          leader.fullName,
        ]),
      ),
    [data.campManagement.manualLeaders],
  );
  const campOrganization = useMemo(() => {
    const assignmentByRegistrationId = new Map<string, UnitCampAssignment>();
    const groups: CampGroup[] = [];

    function ensureAssignment(registrationId: string) {
      const fallback = data.registrations.find((registration) => registration.id === registrationId);
      const fallbackCommittee = fallback?.assignedCommittees[0];
      const current = assignmentByRegistrationId.get(registrationId);

      if (current) return current;

      const next: UnitCampAssignment = {
        patrolId: fallback?.assignedPatrolId ?? null,
        patrolName: fallback?.assignedPatrolName ?? null,
        patrolRole: fallback?.assignedPatrolRole ?? null,
        committeeId: fallbackCommittee?.id ?? null,
        committeeTitle: fallbackCommittee?.title ?? null,
        committeeRole: fallbackCommittee?.role ?? null,
      };
      assignmentByRegistrationId.set(registrationId, next);
      return next;
    }

    for (const registration of data.registrations) {
      ensureAssignment(registration.id);
    }

    for (const committee of data.campManagement.committees) {
      const roles: Record<string, "leader" | "member"> = {};
      const registrations: Registration[] = [];

      for (const registrationId of committee.leaderRegistrationIds) {
        const registration = registrationById.get(registrationId);
        if (!registration) continue;
        roles[registrationId] = "leader";
        registrations.push(registration);
        const assignment = ensureAssignment(registrationId);
        assignment.committeeId = committee.id;
        assignment.committeeTitle = committee.title;
        assignment.committeeRole = "leader";
      }

      for (const registrationId of committee.memberRegistrationIds) {
        const registration = registrationById.get(registrationId);
        if (!registration) continue;
        roles[registrationId] = "member";
        registrations.push(registration);
        const assignment = ensureAssignment(registrationId);
        assignment.committeeId = committee.id;
        assignment.committeeTitle = committee.title;
        assignment.committeeRole = "member";
      }

      const manualLeaderNames = committee.manualLeaderIds
        .map((leaderId) => manualLeaderById.get(leaderId))
        .filter((value): value is string => Boolean(value));

      groups.push({
        kind: "committee",
        id: committee.id,
        title: committee.title,
        responsibilities: committee.responsibilities,
        registrations,
        roles,
        manualLeaderNames,
        publicMembers: committee.publicMembers,
      });
    }

    for (const patrol of data.campManagement.patrols) {
      const roles: Record<string, CampPatrolRole> = {};
      const registrations: Registration[] = [];

      const orderedAssignments: Array<[string, CampPatrolRole]> = [
        ...(patrol.leaderRegistrationId
          ? ([[patrol.leaderRegistrationId, "leader"]] as Array<[string, CampPatrolRole]>)
          : []),
        ...patrol.supervisorRegistrationIds.map(
          (registrationId): [string, CampPatrolRole] => [registrationId, "supervisor"],
        ),
        ...patrol.memberRegistrationIds.map(
          (registrationId): [string, CampPatrolRole] => [registrationId, "member"],
        ),
      ];

      for (const [registrationId, role] of orderedAssignments) {
        const registration = registrationById.get(registrationId);
        if (!registration) continue;
        roles[registrationId] = role;
        registrations.push(registration);
        const assignment = ensureAssignment(registrationId);
        assignment.patrolId = patrol.id;
        assignment.patrolName = patrol.name;
        assignment.patrolRole = role;
      }

      groups.push({
        kind: "patrol",
        id: patrol.id,
        title: patrol.name,
        registrations,
        roles,
        manualLeaderNames: patrol.manualSupervisorIds
          .map((leaderId) => manualLeaderById.get(leaderId))
          .filter((value): value is string => Boolean(value)),
        publicMembers: patrol.publicMembers,
      });
    }

    return { groups, assignmentByRegistrationId };
  }, [data.campManagement, data.registrations, manualLeaderById, registrationById]);
  const campGroupLabels = getCampGroupLabels(data.campManagement.groupLabel);
  const campGroups = campOrganization.groups;
  const selectedCampGroup =
    selectedCampGroupKey !== null
      ? campGroups.find((group) => `${group.kind}:${group.id}` === selectedCampGroupKey) ?? null
      : null;
  // La checklist zaino esiste solo per i campeggi; comitati e gruppi valgono
  // per ogni tipo di attività (docs/ATTIVITA_MODULARI.md, quarto incremento):
  // la sezione Organizzazione c'è sempre, così "Gestisci" resta raggiungibile
  // anche con zero comitati e zero gruppi.
  const isCamp = Boolean(data.event && isCampEvent(data.event));
  const showOrganization = Boolean(data.event);
  const showAssignmentColumn =
    isCamp ||
    data.registrations.some((registration) => {
      const assignment = campOrganization.assignmentByRegistrationId.get(registration.id);
      return Boolean(assignment?.patrolName || assignment?.committeeTitle);
    });

  const tabDefinitions = getUnitActivityTabs({
    showOrganization,
    isCamp,
    hasUser: Boolean(leaderUid) && hasOwnRegistration,
  });
  const visibleTab = getVisibleUnitActivityTab(tabDefinitions, activeTab);
  const showTabs = Boolean(data.event) && tabDefinitions.length > 1;
  const { withPeople: peopleGroups, empty: emptyGroups } = splitGroupsByMembers(
    campGroups,
    getCampGroupMemberCount,
  );
  // Primo caricamento fallito: solo l'avviso, niente conteggi a zero né «nessun iscritto».
  const failedFirstLoad = Boolean(error) && !data.event;

  // Schede (WAI-ARIA): frecce, Inizio e Fine spostano scheda e focus.
  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabDefinitions.findIndex((tab) => tab.id === visibleTab);
    const last = tabDefinitions.length - 1;
    const next =
      event.key === "ArrowRight" ? (index + 1) % tabDefinitions.length
      : event.key === "ArrowLeft" ? (index - 1 + tabDefinitions.length) % tabDefinitions.length
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabDefinitions[next];
    setActiveTab(tab.id);
    document.getElementById(`unit-activity-tab-${tab.id}`)?.focus();
  }

  const stats: Array<{ label: string; value: number; icon: AppIconName; tone: "plain" | "warning" | "danger" }> = [
    { label: "Iscritti unità", value: data.stats.total, icon: "users", tone: "plain" },
    { label: "Trasporto", value: effectiveNeedsTransport, icon: "map-pin", tone: "warning" },
    { label: "Foto mancanti", value: data.stats.missingPhotoConsent, icon: "eye", tone: "warning" },
    { label: "Genitori", value: data.stats.missingParentConsent, icon: "lock", tone: "danger" },
  ];

  return (
    <div className="page unit-activity">
      <ButtonLink
        className="unit-activity__back"
        icon="arrow-left"
        to="/unit"
        variant="ghost"
      >
        Torna alla home
      </ButtonLink>

      {data.event ? (
        <section className="unit-activity-hero">
          <div
            className="unit-activity-hero__media"
            style={
              data.event.heroImageUrl ? { backgroundImage: `url(${data.event.heroImageUrl})` } : undefined
            }
          >
            {data.event.heroImageUrl ? null : (
              <svg
                aria-hidden="true"
                className="unit-activity-hero__scene"
                preserveAspectRatio="xMidYMax slice"
                viewBox="0 0 400 220"
              >
                <defs>
                  <linearGradient id="unit-activity-sky" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#9fb8cf" />
                    <stop offset="0.62" stopColor="#e9d3ae" />
                    <stop offset="1" stopColor="#f3dfbd" />
                  </linearGradient>
                </defs>
                <rect fill="url(#unit-activity-sky)" height="220" width="400" />
                <circle cx="300" cy="78" fill="#f6c77d" opacity="0.9" r="30" />
                <path
                  d="M0 160 C70 132 130 142 200 154 C270 166 330 142 400 150 V220 H0Z"
                  fill="#7f9bb4"
                />
                <path
                  d="M0 184 C90 166 160 180 240 188 C310 195 360 182 400 178 V220 H0Z"
                  fill="#1b3f67"
                />
              </svg>
            )}
          </div>
          <div className="unit-activity-hero__body">
            <div className="unit-activity-hero__pills">
              <Pill tone="info">La tua unità</Pill>
              {data.event.status === "planned" ? <Pill dot tone="info">{ANNUNCIATA.statoStaff}</Pill> : null}
              {data.event.overnight ? <Pill>Pernottamento</Pill> : null}
            </div>
            <h1 className="unit-activity-hero__title">{data.event.title}</h1>
            <div className="unit-activity-hero__meta">
              <p>
                <Icon name="calendar" />
                <span>{formatUnitDateRange(data.event.startDate, data.event.endDate)}</span>
              </p>
              {data.event.location || data.event.status === "planned" ? (
                <p>
                  <Icon name="map-pin" />
                  <span>{data.event.location || ANNUNCIATA.luogoDaDefinire}</span>
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : loading ? (
        <section className="unit-activity-hero unit-activity-hero--loading">
          <div className="unit-activity-hero__body">
            <h1 className="unit-activity-hero__title">Caricamento...</h1>
          </div>
        </section>
      ) : null}

      {error ? (
        <Notice tone="warning" title="Impossibile caricare i dati">
          <p>{error}</p>
        </Notice>
      ) : null}

      {visibleActionInfo ? (
        <Notice tone="success" title="Email inviata">
          <p>{visibleActionInfo}</p>
        </Notice>
      ) : null}

      {visibleActionError ? (
        <Notice tone="danger" title="Reinvio non riuscito">
          <p>{visibleActionError}</p>
        </Notice>
      ) : null}

      {!loading && !failedFirstLoad && (
        <section aria-label="Riepilogo" className="unit-activity-stats">
          {stats.map((stat) => (
            <article
              className={
                stat.tone !== "plain" && stat.value > 0
                  ? `unit-activity-stat unit-activity-stat--${stat.tone}`
                  : "unit-activity-stat"
              }
              key={stat.label}
            >
              <Icon name={stat.icon} />
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </article>
          ))}
        </section>
      )}

      {data.event ? <ActivityMediaCard stakeId={stakeId} event={data.event} /> : null}

      {showTabs ? (
        <div
          aria-label="Menu attività"
          className="unit-activity-tabs"
          onKeyDown={handleTabKeyDown}
          role="tablist"
        >
          {tabDefinitions.map((tab) => (
            <button
              aria-controls="unit-activity-panel"
              aria-selected={visibleTab === tab.id}
              className="unit-activity-tabs__tab"
              id={`unit-activity-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              tabIndex={visibleTab === tab.id ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <section
        aria-busy={loading || undefined}
        aria-labelledby={showTabs ? `unit-activity-tab-${visibleTab}` : undefined}
        className="unit-activity-panel"
        id="unit-activity-panel"
        role={showTabs ? "tabpanel" : undefined}
      >
        {visibleTab === "registrations" && !failedFirstLoad ? (
          <>
            <Card
              className="unit-activity-list-card"
              subtitle={`${data.registrations.length} iscrizioni attive`}
              title="Iscritti dalla tua unità"
            >
              {loading ? (
                <p className="unit-activity-muted" role="status">Caricamento...</p>
              ) : data.registrations.length === 0 ? (
                <EmptyState
                  action={null}
                  headingAs="h3"
                  illustration={giovaniUrl}
                  title="Nessun iscritto dalla tua unità per questa attività."
                />
              ) : (
                <ul className="unit-activity-people">
                  {data.registrations.map((r) => (
                    <RegistrationRow
                      key={r.id}
                      registration={r}
                      campAssignment={campOrganization.assignmentByRegistrationId.get(r.id) ?? null}
                      groupName={campGroupLabels.singular}
                      showCampAssignment={showAssignmentColumn}
                      assignmentLabel={isCamp ? "Campeggio" : "Organizzazione"}
                      requiresParentAuthorization={Boolean(data.event?.requiresParentAuthorization)}
                      isTransportResolved={resolvedSet.has(r.id)}
                      onToggleTransport={() => void handleToggleTransport(r.id)}
                      isResending={resendingRegistrationId === r.id}
                      onResendParentAuthorization={() =>
                        void handleResendParentAuthorization(r)
                      }
                    />
                  ))}
                </ul>
              )}
            </Card>

            {!loading && notRegistered.length > 0 && (
              <Card
                className="unit-activity-list-card unit-activity-list-card--unregistered"
                subtitle="Giovani con account nella tua unità che non risultano iscritti a questa attività"
                title="Non ancora iscritti"
              >
                <ul className="unit-activity-people">
                  {notRegistered.map((y) => (
                    <NotRegisteredRow key={y.id} youth={y} />
                  ))}
                </ul>
              </Card>
            )}
          </>
        ) : null}

        {visibleTab === "organization" ? (
          <Card
            headerAction={
              <ButtonLink to={`/admin/events/${eventId}/comitati`} variant="ghost">
                Gestisci
              </ButtonLink>
            }
            subtitle={`Comitati e ${campGroupLabels.plural.toLocaleLowerCase("it-IT")}`}
            title="Organizzazione"
          >
            {loading ? (
              <p className="unit-activity-muted" role="status">Caricamento...</p>
            ) : !data.campManagementAvailable ? (
              <Notice
                action={
                  <Button onClick={reload} variant="secondary">
                    {CAMP.riprova}
                  </Button>
                }
                tone="warning"
              >
                <p>{CAMP.organizzazioneErrore}</p>
              </Notice>
            ) : campGroups.length === 0 ? (
              <EmptyState
                action={null}
                className="unit-activity-empty"
                headingAs="h3"
                illustration={dirigenteUrl}
                title={fillCopy(CAMP.organizzazioneVuota, {
                  gruppi: campGroupLabels.empty.toLocaleLowerCase("it-IT"),
                })}
              />
            ) : (
              <div className="unit-activity-groups">
                {peopleGroups.length > 0 ? (
                  <div className="unit-activity-groups__grid">
                    {peopleGroups.map((group) => {
                      const memberCount = getCampGroupMemberCount(group);
                      const preview = getCampGroupPreview(group);

                      return (
                        <button
                          className={
                            group.kind === "committee"
                              ? "unit-activity-group"
                              : "unit-activity-group unit-activity-group--patrol"
                          }
                          key={`${group.kind}:${group.id}`}
                          onClick={() => setSelectedCampGroupKey(`${group.kind}:${group.id}`)}
                          type="button"
                        >
                          <span className="unit-activity-group__mark" aria-hidden="true">
                            {getCommitteeInitials(group.title)}
                          </span>
                          <span className="unit-activity-group__body">
                            <strong>{group.title}</strong>
                            <span className="unit-activity-group__meta">
                              {group.kind === "committee" ? "Comitato" : campGroupLabels.singular} ·{" "}
                              {memberCount} {memberCount === 1 ? "persona" : "persone"}
                            </span>
                            <span className="unit-activity-group__preview">{preview}</span>
                          </span>
                          <Icon name="arrow-right" className="unit-activity-group__arrow" />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {emptyGroups.length > 0 ? (
                  <div className="unit-activity-groups__empty">
                    <p>Nessuna persona assegnata</p>
                    <div className="unit-activity-groups__chips">
                      {emptyGroups.map((group) => (
                        <button
                          className="unit-activity-chip"
                          key={`${group.kind}:${group.id}`}
                          onClick={() => setSelectedCampGroupKey(`${group.kind}:${group.id}`)}
                          type="button"
                        >
                          <span>{group.title}</span>
                          {group.kind === "patrol" ? (
                            <span className="unit-activity-chip__kind">{campGroupLabels.singular}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        ) : null}

        {/* Sempre montata sul campeggio: il salvataggio parte 250 ms dopo il
            segno e smontarla al cambio di scheda lo cancellerebbe. Senza
            iscrizione propria le rules negano lettura e scrittura: non si monta. */}
        {data.event && session?.firebaseUser.uid && isCamp && hasOwnRegistration ? (
          <div className="unit-activity-packing" hidden={visibleTab !== "packing"}>
            <CampPackingChecklist event={data.event} userId={session.firebaseUser.uid} variant="unit" />
          </div>
        ) : null}
      </section>

      {selectedCampGroup ? (
        <AppModal
          title={selectedCampGroup.title}
          subtitle={selectedCampGroup.kind === "committee" ? "Comitato" : campGroupLabels.singular}
          size="compact"
          onClose={() => setSelectedCampGroupKey(null)}
        >
          <div className="unit-activity-sheet">
            {selectedCampGroup.responsibilities ? (
              <section className="unit-activity-sheet__duty">
                <h4>{CAMP.incarico}</h4>
                <p>{selectedCampGroup.responsibilities}</p>
              </section>
            ) : null}
            {getCampGroupMemberCount(selectedCampGroup) === 0 ? (
              <p className="unit-activity-muted">Nessuna persona assegnata</p>
            ) : (
              <ul className="unit-activity-people">
                {selectedCampGroup.manualLeaderNames.map((fullName) => (
                  <li className="unit-activity-person unit-activity-person--sheet" key={`manual-${fullName}`}>
                    <div className="unit-activity-person__head">
                      <span className="unit-activity-avatar" aria-hidden="true">
                        {getCommitteeInitials(fullName)}
                      </span>
                      <p className="unit-activity-person__name">
                        <strong>{fullName}</strong> <span>Dirigente manuale</span>
                      </p>
                      <Pill tone="info">Responsabile</Pill>
                    </div>
                  </li>
                ))}
                {selectedCampGroup.publicMembers.map((member) => (
                  <li className="unit-activity-person unit-activity-person--sheet" key={member.registrationId}>
                    <div className="unit-activity-person__head">
                      <span className="unit-activity-avatar" aria-hidden="true">
                        {getCommitteeInitials(member.fullName)}
                      </span>
                      <p className="unit-activity-person__name">
                        <strong>{member.fullName}</strong>{" "}
                        <span>{getCampPublicMemberSubtitle(member)}</span>
                      </p>
                      <Pill tone="info">
                        {getCampPublicMemberRoleLabel(member, selectedCampGroup.kind)}
                      </Pill>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </AppModal>
      ) : null}
    </div>
  );
}
