import { getSurveyHref } from "@/utils/surveyLinks";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { CampPackingChecklist } from "@/components/CampPackingChecklist";
import { AppIcon } from "@/components/AppIcon";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { ANNULLA } from "@/copy/annulla";
import { ActivityMediaCard } from "@/components/gallery/ActivityMediaCard";
import { QuestionsSection } from "@/components/QuestionsSection";
import { ShareButton } from "@/components/ShareButton";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { childrenService } from "@/services/firestore/childrenService";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import type { CampPublicMember, Registration } from "@/types";
import { isMinorBirthDate } from "@/utils/age";
import { ATTIVITA } from "@/copy/attivita";
import {
  getAbsoluteUrl,
  getActivityPath,
  getActivityRegistrationPath,
  withRegisterFor,
} from "@/utils/activityLinks";
import { canManageFamily, suggestsChildAfterOwn } from "@/utils/family";
import { formatDateRange, formatDateTime } from "@/utils/formatters";
import {
  getEventAudienceLabel,
  getRegistrationAvailability,
  isCampEvent,
} from "@/utils/events";
import { isParentAuthorizationAuthorized } from "@/utils/parentAuthorization";
import {
  getRegistrationAnswerEntries,
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";
import { getRegistrationLookupFromSession } from "@/utils/session";
import {
  getCancelErrorMessage,
  getOwnCancelRegistrationCopy,
  withCancelTimeout,
} from "@/utils/familyCancel";

// Card della Notte dei Record: caricata a parte (con il suo CSS) solo per le
// attività che hanno il modulo attivo.
const RecordNightEntryCard = lazy(async () => ({
  default: (await import("@/components/recordNight/RecordNightEntryCard")).RecordNightEntryCard,
}));

type PersonalCampPatrol = {
  id: string;
  name: string;
  role: string | null;
  assignedCount: number;
  publicMembers: CampPublicMember[];
};

type PersonalCampCommittee = {
  id: string;
  title: string;
  emoji: string;
  role: "leader" | "member";
  assignedCount: number;
  manualLeaderNames: string[];
  publicMembers: CampPublicMember[];
};

type YouthActivityTab =
  "registration" | "patrol" | "committees" | "gallery" | "survey";

function getPatrolRoleLabel(role: string | null) {
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

function getCommitteeRoleLabel(role: string) {
  return role === "leader" ? "Responsabile" : "Membro";
}

function getPublicMemberLabel(
  member: CampPublicMember,
  context: "committee" | "patrol",
) {
  return context === "committee"
    ? getCommitteeRoleLabel(member.role)
    : getPatrolRoleLabel(member.role);
}

function getMemberPreview(members: CampPublicMember[]) {
  return members
    .map((member) => member.fullName)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

function getRegistrationStatusDisplay(registration: Registration) {
  if (
    registration.registrationStatus === "draft" &&
    isMinorBirthDate(registration.birthDate) &&
    !isParentAuthorizationAuthorized(registration)
  ) {
    return {
      label: "Autorizzazione genitore mancante",
      tone: "warning" as const,
    };
  }

  return {
    label: getRegistrationStatusLabel(registration.registrationStatus),
    tone: getRegistrationStatusTone(registration.registrationStatus),
  };
}

function getInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${second}`.toUpperCase() || "•";
}

function getAvatarTone(index: number) {
  const tones = ["clay", "dusk", "sage", "amber", "ink"];
  return tones[index % tones.length];
}

export function MyActivityDetailPage() {
  const { eventId } = useParams();
  const { session } = useAuth();
  const sessionKey = session
    ? `${session.firebaseUser.uid}:${session.isAnonymous}`
    : "none";
  const stakeId = session?.profile.stakeId ?? "";
  const [busy, setBusy] = useState<null | "cancel">(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  // "Annulla l'iscrizione": prima il foglio, mai un dialogo del browser.
  const [cancelSheetOpen, setCancelSheetOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<YouthActivityTab>("registration");
  // Figli dell'account (G2): "Iscrivi tuo figlio o tua figlia" segue la regola
  // di "Iscrizione inviata". Prima di ogni return: è un hook.
  const familyUid = session && canManageFamily(session) ? session.firebaseUser.uid : "";
  const { data: family, error: familyError } = useAsyncData(
    async () => ({
      uid: familyUid,
      count: familyUid ? (await childrenService.listChildren(familyUid)).length : 0,
    }),
    [familyUid],
    { uid: "", count: 0 },
  );
  // Al cambio di account il primo render ha il conto di quello di prima.
  const childCount = family.uid === familyUid ? family.count : 0;

  const { data, loading, error, setData } = useAsyncData(
    async () => {
      if (!eventId || !stakeId) {
        return null;
      }

      const bundle = await userActivitiesService.getForSessionEvent(
        session,
        eventId,
      );

      if (!bundle) {
        return null;
      }

      const formConfig = await eventFormsService.getFormConfig(
        stakeId,
        eventId,
      );

      return {
        ...bundle,
        formConfig,
      };
    },
    [eventId, sessionKey, stakeId],
    null,
  );

  const personalCampOrganization = useMemo(() => {
    if (!data) {
      return {
        patrol: null as PersonalCampPatrol | null,
        committees: [] as PersonalCampCommittee[],
      };
    }

    const registrationId = data.registration.id;
    const management = data.campManagement;
    const manualLeaderById = new Map(
      (management?.manualLeaders ?? []).map((leader) => [
        leader.id,
        leader.fullName,
      ]),
    );
    const patrolFromPlan = management?.patrols.find(
      (patrol) =>
        patrol.leaderRegistrationId === registrationId ||
        patrol.supervisorRegistrationIds.includes(registrationId) ||
        patrol.memberRegistrationIds.includes(registrationId),
    );
    const patrolRole = patrolFromPlan
      ? patrolFromPlan.leaderRegistrationId === registrationId
        ? "leader"
        : patrolFromPlan.supervisorRegistrationIds.includes(registrationId)
          ? "supervisor"
          : "member"
      : data.registration.assignedPatrolRole;
    const selfPublicMember: CampPublicMember = {
      registrationId,
      fullName: data.registration.fullName,
      genderRoleCategory: data.registration.genderRoleCategory,
      unitName: data.registration.unitNameSnapshot,
      role: data.registration.assignedPatrolRole ?? "member",
    };
    const patrolPublicMembers = patrolFromPlan?.publicMembers.length
      ? patrolFromPlan.publicMembers
      : patrolFromPlan || data.registration.assignedPatrolName
        ? [{ ...selfPublicMember, role: patrolRole ?? "member" }]
        : [];
    const patrolManualSupervisors: CampPublicMember[] = (
      patrolFromPlan?.manualSupervisorIds ?? []
    ).flatMap((manualSupervisorId): CampPublicMember[] => {
      const fullName = manualLeaderById.get(manualSupervisorId);
      return fullName
        ? [
            {
              registrationId: `manual-supervisor-${manualSupervisorId}`,
              fullName,
              genderRoleCategory: "dirigente",
              unitName: "",
              role: "supervisor",
            },
          ]
        : [];
    });
    const patrolDisplayMembers = [
      ...patrolPublicMembers,
      ...patrolManualSupervisors,
    ];
    const patrol = patrolFromPlan
      ? {
          id: patrolFromPlan.id,
          name: patrolFromPlan.name,
          role: patrolRole,
          assignedCount:
            patrolFromPlan.memberRegistrationIds.length +
            patrolFromPlan.supervisorRegistrationIds.length +
            patrolFromPlan.manualSupervisorIds.length +
            (patrolFromPlan.leaderRegistrationId ? 1 : 0),
          publicMembers: patrolDisplayMembers,
        }
      : data.registration.assignedPatrolName
        ? {
            id: data.registration.assignedPatrolId ?? "assigned-patrol",
            name: data.registration.assignedPatrolName,
            role: data.registration.assignedPatrolRole,
            assignedCount: 1,
            publicMembers: patrolDisplayMembers,
          }
        : null;

    const committees: PersonalCampCommittee[] = [];

    for (const committee of management?.committees ?? []) {
      const role = committee.leaderRegistrationIds.includes(registrationId)
        ? "leader"
        : committee.memberRegistrationIds.includes(registrationId)
          ? "member"
          : null;

      if (!role) continue;

      committees.push({
        id: committee.id,
        title: committee.title,
        emoji: committee.emoji,
        role,
        assignedCount:
          committee.leaderRegistrationIds.length +
          committee.memberRegistrationIds.length +
          committee.manualLeaderIds.length,
        manualLeaderNames: committee.manualLeaderIds
          .map((leaderId) => manualLeaderById.get(leaderId))
          .filter((value): value is string => Boolean(value)),
        publicMembers: committee.publicMembers.length
          ? committee.publicMembers
          : [{ ...selfPublicMember, role }],
      });
    }

    const committeeIds = new Set(committees.map((committee) => committee.id));
    for (const committee of data.registration.assignedCommittees) {
      if (committeeIds.has(committee.id)) continue;
      committees.push({
        id: committee.id,
        title: committee.title,
        emoji: "◌",
        role: committee.role,
        assignedCount: 1,
        manualLeaderNames: [],
        publicMembers: [{ ...selfPublicMember, role: committee.role }],
      });
    }

    return { patrol, committees };
  }, [data]);

  // Cambio di account o di attività (Indietro/Avanti fra due schede) con il
  // foglio aperto: si chiude, nessun annullamento parte per l'altra.
  // Account e attività di adesso: l'esito di una richiesta partita con altri
  // non tocca la pagina.
  const contextKey = `${sessionKey}|${eventId ?? ""}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  useEffect(() => {
    setCancelSheetOpen(false);
    setCancelError(null);
    setFeedback(null);
  }, [sessionKey, eventId]);
  // I dati mostrati sono dell'attività nell'URL (durante un cambio di scheda
  // restano un attimo quelli di prima).
  const dataMatchesRoute = Boolean(data && data.event.id === eventId);

  function openCancelSheet() {
    if (!dataMatchesRoute) {
      return;
    }

    setFeedback(null);
    setCancelError(null);
    setCancelSheetOpen(true);
  }

  async function handleConfirmCancel() {
    if (!session || !eventId || !stakeId || busy !== null) {
      return;
    }

    if (!dataMatchesRoute) {
      setCancelSheetOpen(false);
      return;
    }

    const startedFor = contextKey;
    setBusy("cancel");
    setCancelError(null);

    try {
      const cancelledRegistration = await withCancelTimeout(
        registrationsService.cancelRegistration(
          stakeId,
          eventId,
          getRegistrationLookupFromSession(session),
        ),
      );

      if (!cancelledRegistration) {
        throw new Error(
          "Impossibile rileggere la registrazione dopo l'annullamento.",
        );
      }

      // Se nel frattempo scheda o account sono cambiati, la pagina nuova si
      // rilegge da sola: niente esito né dati dell'altra.
      if (contextKeyRef.current !== startedFor) {
        return;
      }

      setData((current) =>
        current
          ? {
              ...current,
              registration: cancelledRegistration,
            }
          : current,
      );
      setCancelSheetOpen(false);
      setFeedback(ANNULLA.annullata);
    } catch (caughtError) {
      if (contextKeyRef.current === startedFor) {
        setCancelError(getCancelErrorMessage(caughtError));
      }
    } finally {
      setBusy(null);
    }
  }

  if (!loading && !data) {
    return (
      <div className="page">
        <EmptyState
          title="Registrazione non trovata"
          description="Non esiste una registrazione collegata al tuo account per questa attività."
          action={
            <Link className="button button--primary" to="/me/activities">
              Torna alle attività
            </Link>
          }
        />
      </div>
    );
  }

  const answerEntries = data
    ? getRegistrationAnswerEntries(data.formConfig, data.registration)
    : [];
  const isCancelled = data?.registration.registrationStatus === "cancelled";
  // Adulto iscritto lui (dirigente, accompagnatore, o chi ha già figli: G2):
  // da qui iscrive anche un figlio, finché le iscrizioni sono aperte. Stessa
  // regola di "Iscrizione inviata".
  const offerChild = Boolean(
    data &&
      session &&
      data.formConfig &&
      suggestsChildAfterOwn({
        canManageFamily: Boolean(familyUid),
        role: session.profile.role,
        category: session.profile.genderRoleCategory,
        // Lettura dei figli fallita: meglio un invito in più che uno perso.
        hasChildren: childCount > 0 || Boolean(familyUid && familyError),
      }) &&
      getRegistrationAvailability(data.event, data.formConfig, session, { forChild: true }) ===
        "open",
  );
  // Solo un campeggio ha checklist zaino, pattuglie, comitati e area
  // /campeggio: per un viaggio (es. tempio) o un'attività standard la pagina
  // mostra cosa portare e la stanza, se comunicate, e il riepilogo iscrizione.
  const isCamp = data ? isCampEvent(data.event) : false;
  const whatToBring = data?.event.whatToBring.trim() ?? "";
  const assignedRoomName =
    data && !isCancelled ? data.registration.assignedRoomName : null;
  const registrationStatusDisplay = data
    ? getRegistrationStatusDisplay(data.registration)
    : null;
  const tabDefinitions: Array<{
    id: YouthActivityTab;
    label: string;
    icon: "badge" | "users" | "list" | "eye" | "check";
  }> = [
    { id: "registration", label: "Iscrizione", icon: "badge" },
    { id: "patrol", label: "Pattuglia", icon: "users" },
    { id: "committees", label: "Comitati", icon: "list" },
    { id: "gallery", label: "Galleria", icon: "eye" },
    { id: "survey", label: "Sondaggio", icon: "check" },
  ];
  const currentPatrol = personalCampOrganization.patrol;
  const currentCommittees = personalCampOrganization.committees;

  return (
    <div className="page page--activity-ios page--my-activity-detail">
      {data ? (
        <section className="camp-youth-hero">
          <div
            className="camp-youth-hero__art"
            style={
              data.event.heroImageUrl
                ? { backgroundImage: `url(${data.event.heroImageUrl})` }
                : undefined
            }
          >
            <span className="camp-youth-hero__sun" aria-hidden="true" />
          </div>
          <div className="camp-youth-hero__badges">
            {registrationStatusDisplay ? (
              <span className="camp-youth-badge camp-youth-badge--status">
                <StatusBadge
                  label={registrationStatusDisplay.label}
                  tone={registrationStatusDisplay.tone}
                />
              </span>
            ) : null}
            <span className="camp-youth-badge camp-youth-badge--blue">
              <span aria-hidden="true" />
              {getEventAudienceLabel(data.event.audience)}
            </span>
            {data.event.overnight ? (
              <span className="camp-youth-badge camp-youth-badge--amber">
                <span aria-hidden="true" />
                Pernottamento
              </span>
            ) : null}
          </div>
          <h1 className="camp-youth-title">{data.event.title}</h1>
          <p className="camp-youth-meta">
            <AppIcon name="calendar" />
            <span>
              {formatDateRange(data.event.startDate, data.event.endDate)}
            </span>
          </p>
          {data.event.location ? (
            <p className="camp-youth-meta">
              <AppIcon name="map-pin" />
              <span>{data.event.location}</span>
            </p>
          ) : null}
          <div className="camp-youth-hero__actions">
            {!isCancelled ? (
              <Link
                className="camp-youth-primary-action"
                to={`/me/activities/${data.event.id}/edit`}
              >
                <AppIcon name="pencil" />
                <span>Modifica iscrizione</span>
              </Link>
            ) : null}
            <ShareButton
              className="camp-youth-icon-action"
              iconOnly
              title={data.event.title}
              text="Guarda questa attività e apri l'iscrizione."
              url={getAbsoluteUrl(getActivityPath(data.event.id, stakeId))}
            />
            <Link
              className="camp-youth-icon-action"
              to="/me/activities"
              title="Torna alle attività"
            >
              <AppIcon name="arrow-left" />
            </Link>
          </div>
        </section>
      ) : (
        <section className="camp-youth-hero">
          <h1 className="camp-youth-title">Caricamento iscrizione...</h1>
        </section>
      )}

      {data && offerChild ? (
        <div className="my-activity-child">
          <Link
            className="button button--soft"
            to={withRegisterFor(getActivityRegistrationPath(data.event.id, stakeId), "figlio")}
          >
            <AppIcon name="plus" />
            <span>{ATTIVITA.iscriviFiglio}</span>
          </Link>
        </div>
      ) : null}

      {data ? (
        <ActivityMediaCard className="ag-card--inset" stakeId={stakeId} event={data.event} />
      ) : null}

      {data?.event.recordsEnabled ? (
        <Suspense fallback={null}>
          <RecordNightEntryCard
            canReadRecords={Boolean(session?.isAuthenticated && !session.isAnonymous)}
            className="rn-entry--inset"
            event={data.event}
            stakeId={stakeId}
          />
        </Suspense>
      ) : null}

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Caricamento non riuscito</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <div className="notice notice--info">
          <div>
            <h3>Aggiornamento completato</h3>
            <p>{feedback}</p>
          </div>
        </div>
      ) : null}

      {data ? (
        <>
          {isCamp ? (
          <section className="camp-trail-nav" aria-label="Menu attività">
            <div className="camp-trail-track" role="tablist">
              {tabDefinitions.map((tab) => (
                <button
                  aria-selected={activeTab === tab.id}
                  className={
                    activeTab === tab.id
                      ? "camp-trail-stop camp-trail-stop--active"
                      : "camp-trail-stop"
                  }
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <span className="camp-trail-stop__node">
                    <AppIcon name={tab.icon} />
                  </span>
                  <span className="camp-trail-stop__label">{tab.label}</span>
                </button>
              ))}
            </div>
          </section>
          ) : null}

          <section className="camp-youth-tab-panel" role="tabpanel">
            {activeTab === "registration" ? (
              <div className="camp-youth-stack">
                {session?.firebaseUser.uid && isCamp ? (
                  <CampPackingChecklist
                    event={data.event}
                    userId={session.firebaseUser.uid}
                  />
                ) : null}

                {!isCamp && whatToBring ? (
                  <section className="camp-cat-card camp-registration-card">
                    <div className="camp-cat-head">
                      <h3>Cosa portare</h3>
                    </div>
                    <p className="camp-registration-card__text">{whatToBring}</p>
                  </section>
                ) : null}

                {assignedRoomName ? (
                  <section className="camp-cat-card camp-registration-card">
                    <div className="camp-cat-head">
                      <h3>La tua stanza</h3>
                    </div>
                    <dl className="camp-youth-data-list">
                      <div>
                        <dt>Stanza</dt>
                        <dd>{assignedRoomName}</dd>
                      </div>
                    </dl>
                  </section>
                ) : null}

                <section className="camp-cat-card camp-registration-card">
                  <div className="camp-cat-head">
                    <h3>Dati iscrizione</h3>
                    {registrationStatusDisplay ? (
                      <StatusBadge
                        label={registrationStatusDisplay.label}
                        tone={registrationStatusDisplay.tone}
                      />
                    ) : null}
                  </div>
                  <dl className="camp-youth-data-list">
                    <div>
                      <dt>Nome</dt>
                      <dd>{data.registration.fullName}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{data.registration.email}</dd>
                    </div>
                    <div>
                      <dt>Telefono</dt>
                      <dd>{data.registration.phone || "-"}</dd>
                    </div>
                    <div>
                      <dt>Unità</dt>
                      <dd>
                        {data.registration.unitNameSnapshot ||
                          data.registration.unitName ||
                          "-"}
                      </dd>
                    </div>
                    <div>
                      <dt>Ultimo aggiornamento</dt>
                      <dd>{formatDateTime(data.registration.updatedAt)}</dd>
                    </div>
                    {data.registration.recoveryCode ||
                    data.registration.accessCode ? (
                      <div>
                        <dt>Codice iscrizione</dt>
                        <dd>
                          {data.registration.recoveryCode ||
                            data.registration.accessCode}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  {answerEntries.length > 0 ? (
                    <ul className="camp-youth-answer-list">
                      {answerEntries.map((entry) => (
                        <li key={entry.key}>
                          <strong>{entry.label}</strong>
                          <span>{entry.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>

                {data.event.menuInfo?.trim() ||
                data.event.roomsInfo?.trim() ||
                data.event.allergiesInfo?.trim() ? (
                  <section className="camp-cat-card camp-registration-card">
                    <div className="camp-cat-head">
                      <h3>{isCamp ? "Info campeggio" : "Informazioni utili"}</h3>
                    </div>
                    <dl className="camp-youth-data-list">
                      {data.event.menuInfo?.trim() ? (
                        <div>
                          <dt>Menu</dt>
                          <dd>{data.event.menuInfo}</dd>
                        </div>
                      ) : null}
                      {data.event.roomsInfo?.trim() ? (
                        <div>
                          <dt>Logistica</dt>
                          <dd>{data.event.roomsInfo}</dd>
                        </div>
                      ) : null}
                      {data.event.allergiesInfo?.trim() ? (
                        <div>
                          <dt>Allergie</dt>
                          <dd>{data.event.allergiesInfo}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </section>
                ) : null}

                {data.event.questionsEnabled ? (
                  <QuestionsSection
                    eventId={data.event.id}
                    registration={data.registration}
                    session={session}
                    stakeId={stakeId}
                  />
                ) : null}

                {!isCancelled ? (
                  <section className="activity-ios-danger-zone">
                    <button
                      className="button button--ghost button--danger"
                      disabled={busy !== null}
                      onClick={openCancelSheet}
                      type="button"
                    >
                      {busy === "cancel" ? ANNULLA.annullamento : ANNULLA.annullaIscrizione}
                    </button>
                  </section>
                ) : null}
              </div>
            ) : null}

            {activeTab === "patrol" ? (
              <div className="camp-youth-screen">
                <span className="camp-section-eyebrow">Il tuo gruppo</span>
                <h2 className="camp-section-title">La tua pattuglia</h2>
                <p className="camp-section-sub">
                  Le persone con cui condividi turni, attività e vita di campo.
                </p>

                {currentPatrol ? (
                  <>
                    <section className="camp-patrol-card">
                      <div
                        className="camp-patrol-card__emoji"
                        aria-hidden="true"
                      >
                        🧭
                      </div>
                      <h3>{currentPatrol.name}</h3>
                      <p>Con chi cammini durante il campeggio.</p>
                      <div className="camp-patrol-meta">
                        <div>
                          Ruolo
                          <b>
                            {getPatrolRoleLabel(currentPatrol.role) || "Membro"}
                          </b>
                        </div>
                        <div>
                          Membri
                          <b>
                            {currentPatrol.assignedCount ||
                              currentPatrol.publicMembers.length}
                          </b>
                        </div>
                      </div>
                    </section>

                    <span className="camp-list-label">Componenti</span>
                    <section className="camp-cat-card camp-member-card">
                      {currentPatrol.publicMembers.map((member, index) => (
                        <article
                          className="camp-member-row"
                          key={member.registrationId}
                        >
                          <span
                            className={`camp-avatar camp-avatar--${getAvatarTone(index)}`}
                          >
                            {getInitials(member.fullName)}
                          </span>
                          <span>
                            <strong>{member.fullName}</strong>
                            <small>
                              {getPublicMemberLabel(member, "patrol") ||
                                "Componente"}
                            </small>
                          </span>
                          {member.registrationId === data.registration.id ? (
                            <em className="camp-you-tag">TU</em>
                          ) : null}
                        </article>
                      ))}
                    </section>
                  </>
                ) : (
                  <EmptyState
                    title="Nessuna pattuglia assegnata"
                    description="Quando sarà assegnata, la vedrai qui."
                  />
                )}
              </div>
            ) : null}

            {activeTab === "committees" ? (
              <div className="camp-youth-screen">
                <span className="camp-section-eyebrow">Servizio</span>
                <h2 className="camp-section-title">Comitati del campeggio</h2>
                <p className="camp-section-sub">
                  Qui vedi il tuo comitato e le persone con cui lo prepari.
                </p>

                {currentCommittees.length > 0 ? (
                  currentCommittees.map((committee, committeeIndex) => {
                    const leaders = [
                      ...committee.manualLeaderNames,
                      ...committee.publicMembers
                        .filter((member) => member.role === "leader")
                        .map((member) => member.fullName),
                    ];

                    return (
                      <section
                        className="camp-committee-card"
                        key={committee.id}
                      >
                        <div className="camp-committee-card__head">
                          <span
                            className={`camp-committee-icon camp-committee-icon--${getAvatarTone(
                              committeeIndex,
                            )}`}
                          >
                            {committee.emoji}
                          </span>
                          <span>
                            <h3>{committee.title}</h3>
                            <small>
                              Responsabile:{" "}
                              {leaders.length
                                ? leaders.join(", ")
                                : "da definire"}
                            </small>
                          </span>
                        </div>
                        <p>
                          {committee.role === "leader"
                            ? "Sei tra i responsabili di questo comitato."
                            : "Sei assegnato a questo comitato."}
                        </p>
                        <div className="camp-committee-members">
                          {committee.manualLeaderNames.map(
                            (leaderName, index) => (
                              <span key={leaderName}>
                                <i
                                  className={`camp-avatar camp-avatar--${getAvatarTone(index)}`}
                                >
                                  {getInitials(leaderName)}
                                </i>
                                {leaderName}
                              </span>
                            ),
                          )}
                          {committee.publicMembers.map((member, index) => (
                            <span key={member.registrationId}>
                              <i
                                className={`camp-avatar camp-avatar--${getAvatarTone(index + 2)}`}
                              >
                                {getInitials(member.fullName)}
                              </i>
                              {member.fullName}
                            </span>
                          ))}
                        </div>
                        <div className="camp-spots-row">
                          <span>{committee.assignedCount} persone</span>
                          <button
                            className="camp-join-btn camp-join-btn--full"
                            type="button"
                          >
                            Assegnato
                          </button>
                        </div>
                      </section>
                    );
                  })
                ) : (
                  <EmptyState
                    title="Nessun comitato assegnato"
                    description="Quando sarai assegnato a un comitato, comparirà qui."
                  />
                )}
              </div>
            ) : null}

            {activeTab === "gallery" ? (
              <div className="camp-youth-screen">
                <span className="camp-section-eyebrow">Ricordi</span>
                <h2 className="camp-section-title">Galleria foto e video</h2>
                <p className="camp-section-sub">
                  Foto e video del campeggio: guardali, mettici un like e carica
                  anche i tuoi. Filtra tra foto e video nella galleria.
                </p>
                <div className="camp-filter-row" aria-hidden="true">
                  <span className="camp-filter-chip camp-filter-chip--active">
                    Tutti
                  </span>
                  <span className="camp-filter-chip">Foto</span>
                  <span className="camp-filter-chip">Video</span>
                </div>
                <div className="camp-masonry-preview" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <Link
                  className="camp-youth-primary-action camp-youth-primary-action--full"
                  to={`/activities/${data.event.id}/foto`}
                >
                  Apri foto e video
                </Link>
              </div>
            ) : null}

            {activeTab === "survey" ? (
              <div className="camp-youth-screen">
                <span className="camp-section-eyebrow">Post evento</span>
                <h2 className="camp-section-title">Sondaggio</h2>
                <p className="camp-section-sub">
                  Lascia un feedback anonimo sul campeggio: ci aiuta a migliorare
                  le prossime edizioni.
                </p>
                <div className="camp-survey-progress" aria-hidden="true">
                  <span className="camp-survey-progress__step camp-survey-progress__step--active" />
                  <span className="camp-survey-progress__step" />
                  <span className="camp-survey-progress__step" />
                </div>
                <section className="camp-question-card">
                  <span>Domande rapide</span>
                  <h3>Raccontaci com'è andata</h3>
                  <p>
                    Il sondaggio è anonimo e si compila in un minuto.
                  </p>
                  <Link
                    className="camp-join-btn"
                    to={getSurveyHref(data.event.id)}
                  >
                    Vai al sondaggio
                  </Link>
                </section>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {cancelSheetOpen && data && dataMatchesRoute ? (
        <ConfirmSheet
          {...getOwnCancelRegistrationCopy(data.event)}
          busy={busy === "cancel"}
          busyLabel={ANNULLA.annullamento}
          cancelLabel={ANNULLA.tieniIscrizione}
          confirmLabel={ANNULLA.confermaAnnulla}
          error={cancelError}
          onCancel={() => setCancelSheetOpen(false)}
          onConfirm={() => void handleConfirmCancel()}
          tone="danger"
        />
      ) : null}
    </div>
  );
}
