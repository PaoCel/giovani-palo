import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { ConsentSection } from "@/components/ConsentSection";
import { CampPackingChecklist } from "@/components/CampPackingChecklist";
import { ParentConsentUploadCard } from "@/components/ParentConsentUploadCard";
import { AppIcon } from "@/components/AppIcon";
import { AppModal } from "@/components/AppModal";
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
import { isMinorBirthDate } from "@/utils/age";
import { getAbsoluteUrl, getActivityPath } from "@/utils/activityLinks";
import { isCampPackingActivity } from "@/utils/campPacking";
import { formatDateRange, formatDateTime } from "@/utils/formatters";
import { getEventAudienceLabel } from "@/utils/events";
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
};

type PersonalCampCommittee = {
  id: string;
  title: string;
  emoji: string;
  role: "leader" | "member";
  assignedCount: number;
  manualLeaderNames: string[];
};

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

export function MyActivityDetailPage() {
  const { eventId } = useParams();
  const { session } = useAuth();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "none";
  const stakeId = session?.profile.stakeId ?? "";
  const [busy, setBusy] = useState<null | "cancel">(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedCampItem, setSelectedCampItem] = useState<string | null>(null);
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
    const patrol = patrolFromPlan
      ? {
          id: patrolFromPlan.id,
          name: patrolFromPlan.name,
          role: patrolRole,
          assignedCount:
            patrolFromPlan.memberRegistrationIds.length +
            patrolFromPlan.supervisorRegistrationIds.length +
            (patrolFromPlan.leaderRegistrationId ? 1 : 0),
        }
      : data.registration.assignedPatrolName
        ? {
            id: data.registration.assignedPatrolId ?? "assigned-patrol",
            name: data.registration.assignedPatrolName,
            role: data.registration.assignedPatrolRole,
            assignedCount: 1,
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
              <StatusBadge
                label={getRegistrationStatusLabel(data.registration.registrationStatus)}
                tone={getRegistrationStatusTone(data.registration.registrationStatus)}
              />
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
          <section className="activity-ios-metrics">
            <article className="activity-ios-metric">
              <span><AppIcon name="check" /></span>
              <strong>{getRegistrationStatusLabel(data.registration.registrationStatus)}</strong>
              <small>Iscrizione</small>
            </article>
            <article className="activity-ios-metric">
              <span><AppIcon name="users" /></span>
              <strong>{personalCampOrganization.patrol ? "Sì" : "-"}</strong>
              <small>Pattuglia</small>
            </article>
            <article className="activity-ios-metric">
              <span><AppIcon name="badge" /></span>
              <strong>{personalCampOrganization.committees.length || "-"}</strong>
              <small>Comitati</small>
            </article>
          </section>

          <SectionCard title="Riepilogo evento" description="Contesto dell'attività a cui sei iscritto.">
            <dl className="summary-list">
              <div>
                <dt>Date</dt>
                <dd>{formatDateRange(data.event.startDate, data.event.endDate)}</dd>
              </div>
              <div>
                <dt>Luogo</dt>
                <dd>{data.event.location}</dd>
              </div>
              <div>
                <dt>Destinatari</dt>
                <dd>{getEventAudienceLabel(data.event.audience)}</dd>
              </div>
              <div>
                <dt>Stato iscrizione</dt>
                <dd>
                  <StatusBadge
                    label={getRegistrationStatusLabel(data.registration.registrationStatus)}
                    tone={getRegistrationStatusTone(data.registration.registrationStatus)}
                  />
                </dd>
              </div>
              {personalCampOrganization.patrol ? (
                <div>
                  <dt>Pattuglia</dt>
                  <dd>
                    {personalCampOrganization.patrol.name}
                    {personalCampOrganization.patrol.role
                      ? ` · ${getPatrolRoleLabel(personalCampOrganization.patrol.role)}`
                      : ""}
                  </dd>
                </div>
              ) : null}
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
          </SectionCard>

          {personalCampOrganization.patrol ||
          personalCampOrganization.committees.length > 0 ? (
            <SectionCard
              title="La tua organizzazione campeggio"
              description="Pattuglia e comitato a cui sei assegnato."
            >
              <div className="camp-ios-grid">
                {personalCampOrganization.patrol ? (
                  <button
                    className="camp-ios-card camp-ios-card--patrol"
                    onClick={() => setSelectedCampItem("patrol")}
                    type="button"
                  >
                    <span className="camp-ios-card__icon" aria-hidden="true">
                      🧭
                    </span>
                    <span className="camp-ios-card__body">
                      <strong>Pattuglia</strong>
                      <small>
                        {personalCampOrganization.patrol.name}
                        {personalCampOrganization.patrol.role
                          ? ` · ${getPatrolRoleLabel(personalCampOrganization.patrol.role)}`
                          : ""}
                      </small>
                      <span className="camp-ios-card__preview">
                        {personalCampOrganization.patrol.assignedCount > 1
                          ? `${personalCampOrganization.patrol.assignedCount} persone assegnate`
                          : "Tocca per vedere il dettaglio"}
                      </span>
                    </span>
                  </button>
                ) : null}
                {personalCampOrganization.committees.map((committee) => (
                  <button
                    className="camp-ios-card camp-ios-card--committee"
                    key={committee.id}
                    onClick={() => setSelectedCampItem(`committee:${committee.id}`)}
                    type="button"
                  >
                    <span className="camp-ios-card__icon" aria-hidden="true">
                      {committee.emoji}
                    </span>
                    <span className="camp-ios-card__body">
                      <strong>{committee.title}</strong>
                      <small>{getCommitteeRoleLabel(committee.role)}</small>
                      <span className="camp-ios-card__preview">
                        {committee.manualLeaderNames.length > 0
                          ? `Responsabili: ${committee.manualLeaderNames.slice(0, 2).join(", ")}`
                          : `${committee.assignedCount} persone assegnate`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {session?.firebaseUser.uid && isCampPackingActivity(data.event) ? (
            <CampPackingChecklist event={data.event} userId={session.firebaseUser.uid} />
          ) : null}

          <SectionCard
            title="Sondaggio post-evento"
            description="Compila il modulo per dare un feedback sull'attività. Anonimo."
          >
            <Link
              className="button button--primary"
              to={`/me/sondaggi/${data.event.id}`}
            >
              Vai al sondaggio
            </Link>
          </SectionCard>

          <SectionCard
            title="Galleria foto e video"
            description="Vedi le gallerie associate a questa attività."
          >
            <Link
              className="button button--ghost"
              to={`/me/galleria/per-attivita/${data.event.id}`}
            >
              Apri galleria attività
            </Link>
          </SectionCard>

          {data.event.menuInfo?.trim() ||
          data.event.roomsInfo?.trim() ||
          data.event.allergiesInfo?.trim() ? (
            <SectionCard
              title="Info utili campeggio"
              description="Menu, logistica e indicazioni importanti quando disponibili."
            >
              <dl className="summary-list">
                {data.event.menuInfo?.trim() ? (
                  <div>
                    <dt>Menu</dt>
                    <dd>{data.event.menuInfo}</dd>
                  </div>
                ) : null}
                {data.event.roomsInfo?.trim() ? (
                  <div>
                    <dt>Logistica e stanze</dt>
                    <dd>{data.event.roomsInfo}</dd>
                  </div>
                ) : null}
                {data.event.allergiesInfo?.trim() ? (
                  <div>
                    <dt>Allergie e indicazioni</dt>
                    <dd>{data.event.allergiesInfo}</dd>
                  </div>
                ) : null}
              </dl>
            </SectionCard>
          ) : null}

          {data.event.whatToBring?.trim() ? (
            <SectionCard
              title="Cosa portare"
              description={
                data.event.activityType === "camp" ||
                data.event.activityType === "overnight" ||
                data.event.overnight
                  ? "Importante: leggi prima di partire."
                  : "Materiale consigliato per partecipare."
              }
            >
              <div className="what-to-bring-card">
                {data.event.activityType === "camp" ||
                data.event.activityType === "overnight" ||
                data.event.overnight ? (
                  <span className="what-to-bring-badge">⚠️ Consigliato leggere</span>
                ) : null}
                <p className="what-to-bring-text">{data.event.whatToBring}</p>
              </div>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Dati inviati"
            description="Valori principali e risposte raccolte dal modulo."
          >
            <dl className="summary-list">
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
            ) : (
              <p className="subtle-text">Nessuna risposta aggiuntiva oltre ai dati base.</p>
            )}
          </SectionCard>

          {(data.event.requiresParentalConsent || data.event.requiresPhotoRelease) && session ? (
            <SectionCard
              title="Autorizzazioni e firma"
              description="Completa o aggiorna i consensi richiesti per questa attivita. Tutto e visibile solo agli admin."
            >
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

          {selectedCampItem === "patrol" && personalCampOrganization.patrol ? (
            <AppModal
              title={personalCampOrganization.patrol.name}
              subtitle="La tua pattuglia"
              size="compact"
              onClose={() => setSelectedCampItem(null)}
            >
              <div className="camp-person-list">
                <article className="camp-person-row">
                  <span>
                    <strong>{data.registration.fullName}</strong>
                    <small>
                      {personalCampOrganization.patrol.role
                        ? getPatrolRoleLabel(personalCampOrganization.patrol.role)
                        : "Membro"}
                    </small>
                  </span>
                </article>
                {personalCampOrganization.patrol.assignedCount > 1 ? (
                  <p className="subtle-text">
                    {personalCampOrganization.patrol.assignedCount} persone risultano assegnate a
                    questa pattuglia.
                  </p>
                ) : null}
              </div>
            </AppModal>
          ) : null}

          {selectedCampItem?.startsWith("committee:") ? (
            (() => {
              const committee = personalCampOrganization.committees.find(
                (item) => `committee:${item.id}` === selectedCampItem,
              );

              return committee ? (
                <AppModal
                  title={committee.title}
                  subtitle="Il tuo comitato"
                  size="compact"
                  onClose={() => setSelectedCampItem(null)}
                >
                  <div className="camp-person-list">
                    {committee.manualLeaderNames.map((leaderName) => (
                      <article className="camp-person-row" key={leaderName}>
                        <span>
                          <strong>{leaderName}</strong>
                          <small>Responsabile</small>
                        </span>
                      </article>
                    ))}
                    <article className="camp-person-row">
                      <span>
                        <strong>{data.registration.fullName}</strong>
                        <small>{getCommitteeRoleLabel(committee.role)}</small>
                      </span>
                    </article>
                    {committee.assignedCount > committee.manualLeaderNames.length + 1 ? (
                      <p className="subtle-text">
                        {committee.assignedCount} persone risultano assegnate a questo comitato.
                      </p>
                    ) : null}
                  </div>
                </AppModal>
              ) : null;
            })()
          ) : null}
        </>
      ) : null}
    </div>
  );
}
