import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { ConsentSection } from "@/components/ConsentSection";
import { CampPackingChecklist } from "@/components/CampPackingChecklist";
import { ParentConsentUploadCard } from "@/components/ParentConsentUploadCard";
import { AppIcon } from "@/components/AppIcon";
import { QuestionsSection } from "@/components/QuestionsSection";
import { SectionCard } from "@/components/SectionCard";
import { ShareButton } from "@/components/ShareButton";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { organizationService } from "@/services/firestore/organizationService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import type { CampPublicMember, Registration } from "@/types";
import { isMinorBirthDate } from "@/utils/age";
import { getAbsoluteUrl, getActivityPath } from "@/utils/activityLinks";
import { isCampPackingActivity } from "@/utils/campPacking";
import { formatDateRange, formatDateTime } from "@/utils/formatters";
import { getEventAudienceLabel } from "@/utils/events";
import { hasConfirmedParentConsent } from "@/utils/registrationConsents";
import {
  getRegistrationAnswerEntries,
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";
import { getRegistrationLookupFromSession } from "@/utils/session";

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

type YouthActivityTab = "registration" | "patrol" | "committees" | "gallery" | "survey";

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

function getPublicMemberLabel(member: CampPublicMember, context: "committee" | "patrol") {
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
    !hasConfirmedParentConsent(registration)
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

export function MyActivityDetailPage() {
  const { eventId } = useParams();
  const { session } = useAuth();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "none";
  const stakeId = session?.profile.stakeId ?? "";
  const [busy, setBusy] = useState<null | "cancel">(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<YouthActivityTab>("registration");
  const { data: organization } = useAsyncData(
    () => organizationService.getProfile(stakeId),
    [stakeId],
    null,
  );

  const { data, loading, error, setData } = useAsyncData(
    async () => {
      if (!eventId || !stakeId) {
        return null;
      }

      const bundle = await userActivitiesService.getForSessionEvent(session, eventId);

      if (!bundle) {
        return null;
      }

      const formConfig = await eventFormsService.getFormConfig(stakeId, eventId);

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
      (management?.manualLeaders ?? []).map((leader) => [leader.id, leader.fullName]),
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
    const patrolPublicMembers =
      patrolFromPlan?.publicMembers.length
        ? patrolFromPlan.publicMembers
        : patrolFromPlan || data.registration.assignedPatrolName
          ? [{ ...selfPublicMember, role: patrolRole ?? "member" }]
          : [];
    const patrol = patrolFromPlan
      ? {
          id: patrolFromPlan.id,
          name: patrolFromPlan.name,
          role: patrolRole,
          assignedCount:
            patrolFromPlan.memberRegistrationIds.length +
            patrolFromPlan.supervisorRegistrationIds.length +
            (patrolFromPlan.leaderRegistrationId ? 1 : 0),
          publicMembers: patrolPublicMembers,
        }
      : data.registration.assignedPatrolName
        ? {
            id: data.registration.assignedPatrolId ?? "assigned-patrol",
            name: data.registration.assignedPatrolName,
            role: data.registration.assignedPatrolRole,
            assignedCount: 1,
            publicMembers: patrolPublicMembers,
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

  async function handleCancelRegistration() {
    if (!session || !eventId || !stakeId) {
      return;
    }

    const confirmed = window.confirm("Vuoi annullare questa iscrizione?");

    if (!confirmed) {
      return;
    }

    setBusy("cancel");
    setFeedback(null);
    setActionError(null);

    try {
      const cancelledRegistration = await registrationsService.cancelRegistration(
        stakeId,
        eventId,
        getRegistrationLookupFromSession(session),
      );

      if (!cancelledRegistration) {
        throw new Error("Impossibile rileggere la registrazione dopo l'annullamento.");
      }

      setData((current) =>
        current
          ? {
              ...current,
              registration: cancelledRegistration,
            }
          : current,
      );
      setFeedback("Iscrizione annullata correttamente.");
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile annullare l'iscrizione.",
      );
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

  const answerEntries =
    data ? getRegistrationAnswerEntries(data.formConfig, data.registration) : [];
  const isCancelled = data?.registration.registrationStatus === "cancelled";
  const showParentConsentCard =
    Boolean(
      data &&
        session?.isAuthenticated &&
        !session.isAnonymous &&
        data.formConfig.enabledStandardFields.includes("parentConfirmed") &&
        isMinorBirthDate(data.registration.birthDate),
    );
  const registrationStatusDisplay = data
    ? getRegistrationStatusDisplay(data.registration)
    : null;
  const tabDefinitions: Array<{
    id: YouthActivityTab;
    label: string;
    icon: "badge" | "users" | "list" | "eye" | "check";
    value?: string;
  }> = [
    { id: "registration", label: "Iscrizione", icon: "badge" },
    {
      id: "patrol",
      label: "Pattuglia",
      icon: "users",
      value: personalCampOrganization.patrol?.name,
    },
    {
      id: "committees",
      label: "Comitati",
      icon: "list",
      value: personalCampOrganization.committees.length
        ? String(personalCampOrganization.committees.length)
        : undefined,
    },
    { id: "gallery", label: "Galleria", icon: "eye" },
    { id: "survey", label: "Sondaggio", icon: "check" },
  ];

  return (
    <div className="page page--activity-ios page--my-activity-detail">
      {data ? (
        <section className="activity-ios-hero activity-ios-hero--personal">
          <div
            className="activity-ios-hero__image"
            style={
              data.event.heroImageUrl ? { backgroundImage: `url(${data.event.heroImageUrl})` } : undefined
            }
          >
            {!data.event.heroImageUrl ? <AppIcon name="ticket" /> : null}
          </div>
          <div className="activity-ios-hero__content">
            <div className="activity-ios-chip-row">
              {registrationStatusDisplay ? (
                <StatusBadge
                  label={registrationStatusDisplay.label}
                  tone={registrationStatusDisplay.tone}
                />
              ) : null}
              <span className="activity-ios-chip activity-ios-chip--blue">
                {getEventAudienceLabel(data.event.audience)}
              </span>
              {data.event.overnight ? (
                <span className="activity-ios-chip activity-ios-chip--violet">Pernottamento</span>
              ) : null}
            </div>
            <h1>{data.event.title}</h1>
            <p className="activity-ios-meta">
              <AppIcon name="calendar" />
              <span>{formatDateRange(data.event.startDate, data.event.endDate)}</span>
            </p>
            {data.event.location ? (
              <p className="activity-ios-meta">
                <AppIcon name="map-pin" />
                <span>{data.event.location}</span>
              </p>
            ) : null}
          </div>
          <div className="activity-ios-actions activity-ios-actions--personal">
            {!isCancelled ? (
              <Link className="activity-ios-action activity-ios-action--wide" to={`/me/activities/${data.event.id}/edit`}>
                <AppIcon name="pencil" />
                <span>Modifica</span>
              </Link>
            ) : null}
            <ShareButton
              className="activity-ios-action"
              iconOnly
              title={data.event.title}
              text="Guarda questa attività e apri l'iscrizione."
              url={getAbsoluteUrl(getActivityPath(data.event.id, stakeId))}
            />
            <Link className="activity-ios-action" to="/me/activities" title="Torna alle attività">
              <AppIcon name="arrow-left" />
            </Link>
          </div>
        </section>
      ) : (
        <section className="activity-ios-hero activity-ios-hero--personal">
          <div className="activity-ios-hero__content">
            <h1>Caricamento iscrizione...</h1>
          </div>
        </section>
      )}

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Caricamento non riuscito</h3>
            <p>{error}</p>
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
          <section className="personal-event-strip">
            <span>
              <AppIcon name="calendar" />
              {formatDateRange(data.event.startDate, data.event.endDate)}
            </span>
            {data.event.location ? (
              <span>
                <AppIcon name="map-pin" />
                {data.event.location}
              </span>
            ) : null}
            {registrationStatusDisplay ? (
              <StatusBadge
                label={registrationStatusDisplay.label}
                tone={registrationStatusDisplay.tone}
              />
            ) : null}
          </section>

          <section className="personal-action-grid" aria-label="Menu attività">
            {tabDefinitions.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className={
                  activeTab === tab.id
                    ? "personal-action-tile personal-action-tile--active"
                    : "personal-action-tile"
                }
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                <span>
                  <AppIcon name={tab.icon} />
                </span>
                <strong>{tab.label}</strong>
                {tab.value ? <small>{tab.value}</small> : null}
              </button>
            ))}
          </section>

          {session?.firebaseUser.uid && isCampPackingActivity(data.event) ? (
            <CampPackingChecklist event={data.event} userId={session.firebaseUser.uid} />
          ) : null}

          <section className="personal-tab-panel" role="tabpanel">
            {activeTab === "registration" ? (
              <div className="personal-tab-stack">
                <SectionCard title="Informazioni iscrizione">
                  <dl className="summary-list personal-summary-list">
                    <div>
                      <dt>Nome completo</dt>
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
                      <dt>Stato</dt>
                      <dd>
                        {registrationStatusDisplay ? (
                          <StatusBadge
                            label={registrationStatusDisplay.label}
                            tone={registrationStatusDisplay.tone}
                          />
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt>Ultimo aggiornamento</dt>
                      <dd>{formatDateTime(data.registration.updatedAt)}</dd>
                    </div>
                    {data.registration.recoveryCode || data.registration.accessCode ? (
                      <div>
                        <dt>Codice iscrizione</dt>
                        <dd>{data.registration.recoveryCode || data.registration.accessCode}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {answerEntries.length > 0 ? (
                    <ul className="plain-list">
                      {answerEntries.map((entry) => (
                        <li key={entry.key}>
                          <strong>{entry.label}</strong>
                          <span>{entry.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </SectionCard>

                {data.event.menuInfo?.trim() ||
                data.event.roomsInfo?.trim() ||
                data.event.allergiesInfo?.trim() ? (
                  <SectionCard title="Info campeggio">
                    <dl className="summary-list personal-summary-list">
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
                  </SectionCard>
                ) : null}

                {(data.event.requiresParentalConsent || data.event.requiresPhotoRelease) &&
                session ? (
                  <SectionCard title="Autorizzazioni e firma">
                    <ConsentSection
                      event={data.event}
                      isMinor={isMinorBirthDate(data.registration.birthDate)}
                      onRegistrationUpdated={(updated) =>
                        setData((current) =>
                          current
                            ? {
                                ...current,
                                registration: updated,
                              }
                            : current,
                        )
                      }
                      persistImmediately
                      registration={data.registration}
                      sessionUid={session.firebaseUser.uid}
                      stakeId={stakeId}
                    />
                  </SectionCard>
                ) : null}

                {showParentConsentCard && session ? (
                  <ParentConsentUploadCard
                    eventId={data.event.id}
                    exampleImageUrl={organization?.minorConsentExampleImageUrl}
                    onRegistrationUpdated={(updatedRegistration) =>
                      setData((current) =>
                        current
                          ? {
                              ...current,
                              registration: updatedRegistration,
                            }
                          : current,
                      )
                    }
                    registration={data.registration}
                    sessionUid={session.firebaseUser.uid}
                    stakeId={stakeId}
                  />
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
                      onClick={() => void handleCancelRegistration()}
                      type="button"
                    >
                      {busy === "cancel" ? "Annullamento..." : "Annulla iscrizione"}
                    </button>
                  </section>
                ) : null}
              </div>
            ) : null}

            {activeTab === "patrol" ? (
              <SectionCard title={personalCampOrganization.patrol?.name ?? "Pattuglia"}>
                {personalCampOrganization.patrol ? (
                  <div className="camp-person-list">
                    {personalCampOrganization.patrol.publicMembers.map((member) => (
                      <article className="camp-person-row" key={member.registrationId}>
                        <span>
                          <strong>{member.fullName}</strong>
                          <small>{getPublicMemberLabel(member, "patrol")}</small>
                        </span>
                        {member.unitName ? <small>{member.unitName}</small> : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Nessuna pattuglia assegnata"
                    description="Quando sara' assegnata, la vedrai qui."
                  />
                )}
              </SectionCard>
            ) : null}

            {activeTab === "committees" ? (
              <div className="personal-tab-stack">
                {personalCampOrganization.committees.length > 0 ? (
                  personalCampOrganization.committees.map((committee) => (
                    <SectionCard key={committee.id} title={`${committee.emoji} ${committee.title}`}>
                      <div className="camp-person-list">
                        {committee.manualLeaderNames.map((leaderName) => (
                          <article className="camp-person-row" key={leaderName}>
                            <span>
                              <strong>{leaderName}</strong>
                              <small>Responsabile</small>
                            </span>
                          </article>
                        ))}
                        {committee.publicMembers.map((member) => (
                          <article className="camp-person-row" key={member.registrationId}>
                            <span>
                              <strong>{member.fullName}</strong>
                              <small>{getPublicMemberLabel(member, "committee")}</small>
                            </span>
                            {member.unitName ? <small>{member.unitName}</small> : null}
                          </article>
                        ))}
                      </div>
                    </SectionCard>
                  ))
                ) : (
                  <SectionCard title="Comitati">
                    <EmptyState
                      title="Nessun comitato assegnato"
                      description="Quando sarai assegnato a un comitato, comparira' qui."
                    />
                  </SectionCard>
                )}
              </div>
            ) : null}

            {activeTab === "gallery" ? (
              <SectionCard title="Galleria foto e video">
                <Link
                  className="button button--primary"
                  to={`/me/galleria/per-attivita/${data.event.id}`}
                >
                  Apri galleria attività
                </Link>
              </SectionCard>
            ) : null}

            {activeTab === "survey" ? (
              <SectionCard title="Sondaggio post-evento">
                <Link className="button button--primary" to={`/me/sondaggi/${data.event.id}`}>
                  Vai al sondaggio
                </Link>
              </SectionCard>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
