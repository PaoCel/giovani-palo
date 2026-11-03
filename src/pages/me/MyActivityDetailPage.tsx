import "@/styles/myActivity.css";
import giovaniUrl from "@/assets/flusso-genitore/giovani.webp";
import { CAMP } from "@/copy/camp";
import { INVIATA } from "@/copy/inviata";
import { fillCopy } from "@/copy/parole";
import { getCampGroupLabels, getCommitteeInitials } from "@/utils/campGroups";
import { getSurveyHref } from "@/utils/surveyLinks";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { CampPackingChecklist } from "@/components/CampPackingChecklist";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { ANNULLA } from "@/copy/annulla";
import { ActivityProgram } from "@/components/activities/ActivityProgram";
import { ActivityMediaCard } from "@/components/gallery/ActivityMediaCard";
import { QuestionsSection } from "@/components/QuestionsSection";
import { ShareButton } from "@/components/ShareButton";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Icon,
  Notice,
  Pill,
} from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useStakeMembership } from "@/hooks/useStakeMembership";
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
import { getParentEmailAddress, getParentEmailOutcome } from "@/utils/childChoice";
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
  responsibilities: string;
  role: "leader" | "member";
  assignedCount: number;
  manualLeaderNames: string[];
  publicMembers: CampPublicMember[];
};

type YouthActivityTab =
  "registration" | "patrol" | "committees" | "gallery" | "survey";

function getPatrolRoleLabel(role: string | null, leaderLabel = "Capo pattuglia") {
  switch (role) {
    case "leader":
      return leaderLabel;
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
  leaderLabel?: string,
) {
  return context === "committee"
    ? getCommitteeRoleLabel(member.role)
    : getPatrolRoleLabel(member.role, leaderLabel);
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
  // Il conteggio dei record si legge solo da membro del palo.
  const { access: membershipAccess } = useStakeMembership(stakeId);
  const [busy, setBusy] = useState<null | "cancel">(null);
  // Esito legato al contesto (sessione|palo|attività) in cui è nato: dopo un
  // cambio non compare, nemmeno nel render prima dell'effetto di pulizia.
  const [feedback, setFeedback] = useState<{ contextKey: string; message: string } | null>(null);
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

  // Il risultato appartiene al contesto per cui è stato chiesto (account,
  // palo, attività): useAsyncData conserva l'ultimo risultato durante il nuovo
  // caricamento e anche se fallisce, quindi si usa solo con la chiave
  // corrente. Così iscrizione, comitati e gruppo di un altro account o di
  // un'altra attività non restano a schermo.
  const dataContextKey = `${sessionKey}|${stakeId}|${eventId ?? ""}`;
  const {
    data: loadedData,
    loading: loadingAnyContext,
    error,
    setData: setLoadedData,
  } = useAsyncData(
    async () => {
      const contextKey = dataContextKey;
      if (!eventId || !stakeId) {
        return { contextKey, payload: null };
      }

      const bundle = await userActivitiesService.getForSessionEvent(
        session,
        eventId,
      );

      if (!bundle) {
        return { contextKey, payload: null };
      }

      const formConfig = await eventFormsService.getFormConfig(
        stakeId,
        eventId,
      );

      return {
        contextKey,
        payload: {
          ...bundle,
          formConfig,
        },
      };
    },
    [dataContextKey, eventId, sessionKey, stakeId],
    { contextKey: "", payload: null },
  );
  const dataSettled = loadedData.contextKey === dataContextKey;
  const data = dataSettled ? loadedData.payload : null;
  const loading = loadingAnyContext || (!dataSettled && !error);

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
        responsibilities: committee.responsibilities,
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
        responsibilities: "",
        role: committee.role,
        assignedCount: 1,
        manualLeaderNames: [],
        publicMembers: [{ ...selfPublicMember, role: committee.role }],
      });
    }

    return { patrol, committees };
  }, [data]);

  // Cambio di account, palo o attività (Indietro/Avanti fra due schede) con
  // il foglio aperto: si chiude, nessun annullamento parte per l'altra.
  // Account, palo e attività di adesso (`dataContextKey`): l'esito di una
  // richiesta partita in un altro contesto non tocca la pagina.
  const contextKeyRef = useRef(dataContextKey);
  contextKeyRef.current = dataContextKey;
  useEffect(() => {
    setCancelSheetOpen(false);
    setCancelError(null);
    setFeedback(null);
  }, [dataContextKey]);
  const visibleFeedback =
    feedback && feedback.contextKey === dataContextKey ? feedback.message : null;
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

    const startedFor = dataContextKey;
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

      // Solo nel payload del contesto in cui l'annullamento è partito.
      setLoadedData((current) =>
        current.contextKey === startedFor && current.payload
          ? {
              ...current,
              payload: {
                ...current.payload,
                registration: cancelledRegistration,
              },
            }
          : current,
      );
      setCancelSheetOpen(false);
      setFeedback({ contextKey: startedFor, message: ANNULLA.annullata });
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
      <div className="page my-activity">
        <EmptyState
          title="Registrazione non trovata"
          description="Non esiste una registrazione collegata al tuo account per questa attività."
          illustration={giovaniUrl}
          action={
            <ButtonLink to="/me/activities" variant="primary">
              Torna alle attività
            </ButtonLink>
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
  // Solo un campeggio ha checklist zaino, galleria e sondaggio nelle schede
  // e area /campeggio: per un viaggio (es. tempio) o un'attività standard la
  // pagina mostra cosa portare e la stanza, se comunicate, e il riepilogo
  // iscrizione. Comitati e gruppo valgono per ogni tipo, ma fuori dal
  // campeggio compaiono solo se il piano è stato salvato: mai le schede con i
  // soli valori predefiniti.
  const isCamp = data ? isCampEvent(data.event) : false;
  const showOrganization = Boolean(data && (isCamp || data.campPlanSaved));
  const whatToBring = data?.event.whatToBring.trim() ?? "";
  const assignedRoomName =
    data && !isCancelled ? data.registration.assignedRoomName : null;
  // Le condizioni dell'alloggio stanno con la stanza, quando c'è.
  const roomsInfo = data?.event.roomsInfo?.trim() ?? "";
  const usefulInfoRoomsInfo = assignedRoomName ? "" : roomsInfo;
  const registrationStatusDisplay = data
    ? getRegistrationStatusDisplay(data.registration)
    : null;
  // Autorizzazione del genitore in attesa: stesse frasi di "Iscrizione
  // inviata", lette dall'iscrizione (mai promettere una mail non partita).
  const parentEmailOutcome =
    data && !isCancelled ? getParentEmailOutcome(data.registration) : "none";
  const parentEmail = data ? getParentEmailAddress(data.registration) : "";
  const parentPending =
    parentEmailOutcome !== "none" && parentEmailOutcome !== "authorized";
  const campGroupLabels = getCampGroupLabels(data?.campManagement?.groupLabel);
  const tabDefinitions: Array<{ id: YouthActivityTab; label: string }> = [
    { id: "registration" as const, label: "Iscrizione" },
    { id: "patrol" as const, label: campGroupLabels.singular },
    { id: "committees" as const, label: "Comitati" },
    { id: "gallery" as const, label: "Galleria" },
    { id: "survey" as const, label: "Sondaggio" },
  ].filter((tab) =>
    tab.id === "registration" ||
    (showOrganization && (tab.id === "patrol" || tab.id === "committees")) ||
    isCamp,
  );
  // Una scheda che qui non esiste (aperta su un'altra attività, piano non
  // salvato) torna all'iscrizione.
  const visibleTab: YouthActivityTab = tabDefinitions.some((tab) => tab.id === activeTab)
    ? activeTab
    : "registration";
  const currentPatrol = personalCampOrganization.patrol;
  const currentCommittees = personalCampOrganization.committees;
  const hasAside = Boolean(data && (parentPending || assignedRoomName));

  const parentNotice =
    data && parentPending ? (
      <Notice
        tone="warning"
        live="none"
        title={INVIATA.attesaGenitore}
        action={
          parentEmailOutcome === "failed" ? (
            <ButtonLink to={`/me/activities/${data.event.id}/edit`} variant="secondary">
              {INVIATA.modifica}
            </ButtonLink>
          ) : null
        }
      >
        {parentEmailOutcome === "failed" ? (
          <p>{INVIATA.genitoreMailFallita}</p>
        ) : parentEmail ? (
          <p>
            {fillCopy(
              parentEmailOutcome === "sent"
                ? INVIATA.genitoreScritto
                : INVIATA.genitoreInInvio,
              { email: parentEmail },
            )}
          </p>
        ) : null}
      </Notice>
    ) : null;

  const roomCard = assignedRoomName ? (
    <Card title="La tua stanza">
      <div className="my-activity-room">
        <span className="my-activity-room__number" aria-hidden="true">
          {assignedRoomName.match(/\d+/u)?.[0] ?? getCommitteeInitials(assignedRoomName)}
        </span>
        <p className="my-activity-room__name">{assignedRoomName}</p>
      </div>
      {roomsInfo ? (
        <dl className="my-activity-facts">
          <div>
            <dt>Alloggio</dt>
            <dd>{roomsInfo}</dd>
          </div>
        </dl>
      ) : null}
    </Card>
  ) : null;

  return (
    <div className="page my-activity">
      <div
        className={
          hasAside
            ? "my-activity__layout my-activity__layout--aside"
            : "my-activity__layout"
        }
      >
        <ButtonLink
          className="my-activity__back"
          icon="arrow-left"
          to="/me/activities"
          variant="ghost"
        >
          Torna alle attività
        </ButtonLink>

        {data ? (
          <section className="my-activity-hero">
            <div
              className="my-activity-hero__media"
              style={
                data.event.heroImageUrl
                  ? { backgroundImage: `url(${data.event.heroImageUrl})` }
                  : undefined
              }
            >
              {data.event.heroImageUrl ? null : (
                <svg
                  aria-hidden="true"
                  className="my-activity-hero__scene"
                  preserveAspectRatio="xMidYMax slice"
                  viewBox="0 0 400 220"
                >
                  <defs>
                    <linearGradient id="my-activity-sky" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor="#9fb8cf" />
                      <stop offset="0.62" stopColor="#e9d3ae" />
                      <stop offset="1" stopColor="#f3dfbd" />
                    </linearGradient>
                  </defs>
                  <rect fill="url(#my-activity-sky)" height="220" width="400" />
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
            <div className="my-activity-hero__body">
              <div className="my-activity-hero__pills">
                {registrationStatusDisplay ? (
                  <Pill dot tone={registrationStatusDisplay.tone}>
                    {registrationStatusDisplay.label}
                  </Pill>
                ) : null}
                <Pill>{getEventAudienceLabel(data.event.audience)}</Pill>
                {data.event.overnight ? <Pill>Pernottamento</Pill> : null}
              </div>
              <h1 className="my-activity-hero__title">{data.event.title}</h1>
              <div className="my-activity-hero__meta">
                <p>
                  <Icon name="calendar" />
                  <span>
                    {formatDateRange(data.event.startDate, data.event.endDate)}
                  </span>
                </p>
                {data.event.location ? (
                  <p>
                    <Icon name="map-pin" />
                    <span>{data.event.location}</span>
                  </p>
                ) : null}
              </div>
              <div className="my-activity-hero__actions">
                {!isCancelled ? (
                  <ButtonLink
                    icon="pencil"
                    size="lg"
                    to={`/me/activities/${data.event.id}/edit`}
                  >
                    Modifica iscrizione
                  </ButtonLink>
                ) : null}
                <ShareButton
                  className="my-activity-hero__share"
                  iconOnly
                  title={data.event.title}
                  text="Guarda questa attività e apri l'iscrizione."
                  url={getAbsoluteUrl(getActivityPath(data.event.id, stakeId))}
                />
              </div>
            </div>
          </section>
        ) : (
          <section className="my-activity-hero my-activity-hero--loading">
            <div className="my-activity-hero__body">
              <h1 className="my-activity-hero__title">Caricamento iscrizione...</h1>
            </div>
          </section>
        )}

        {hasAside ? (
          <div className="my-activity__aside">
            {parentNotice}
            {roomCard}
          </div>
        ) : null}

        <div className="my-activity__main">
          {error ? (
            <Notice tone="warning" title="Caricamento non riuscito">
              <p>{error}</p>
            </Notice>
          ) : null}

          {visibleFeedback ? (
            <Notice tone="success" title="Aggiornamento completato">
              <p>{visibleFeedback}</p>
            </Notice>
          ) : null}

          {data && offerChild ? (
            <ButtonLink
              className="my-activity__child"
              icon="plus"
              to={withRegisterFor(getActivityRegistrationPath(data.event.id, stakeId), "figlio")}
              variant="secondary"
            >
              {ATTIVITA.iscriviFiglio}
            </ButtonLink>
          ) : null}

          {data ? (
            <>
              <ActivityProgram stakeId={stakeId} activityId={data.event.id} />
              <ActivityMediaCard stakeId={stakeId} event={data.event} />
            </>
          ) : null}

          {data?.event.recordsEnabled ? (
            <Suspense fallback={null}>
              <RecordNightEntryCard
                canReadRecords={membershipAccess === "member"}
                event={data.event}
                stakeId={stakeId}
              />
            </Suspense>
          ) : null}

          {data ? (
            <>
              {tabDefinitions.length > 1 ? (
                <div aria-label="Menu attività" className="my-activity-tabs" role="tablist">
                  {tabDefinitions.map((tab) => (
                    <button
                      aria-selected={visibleTab === tab.id}
                      className="my-activity-tabs__tab"
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      role="tab"
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <section
                className="my-activity-panel"
                role={tabDefinitions.length > 1 ? "tabpanel" : undefined}
              >
                {visibleTab === "registration" ? (
                  <>
                    {session?.firebaseUser.uid && isCamp ? (
                      <CampPackingChecklist
                        event={data.event}
                        userId={session.firebaseUser.uid}
                      />
                    ) : null}

                    {!isCamp && whatToBring ? (
                      <Card title="Cosa portare">
                        <p className="my-activity-text">{whatToBring}</p>
                      </Card>
                    ) : null}

                    <Card
                      title="Dati iscrizione"
                      headerAction={
                        registrationStatusDisplay ? (
                          <Pill dot tone={registrationStatusDisplay.tone}>
                            {registrationStatusDisplay.label}
                          </Pill>
                        ) : null
                      }
                    >
                      <dl className="my-activity-facts">
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
                        <ul className="my-activity-facts my-activity-facts--answers">
                          {answerEntries.map((entry) => (
                            <li key={entry.key}>
                              <strong>{entry.label}</strong>
                              <span>{entry.value}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </Card>

                    {data.event.menuInfo?.trim() ||
                    usefulInfoRoomsInfo ||
                    data.event.allergiesInfo?.trim() ? (
                      <Card title={isCamp ? "Info campeggio" : "Informazioni utili"}>
                        <dl className="my-activity-facts">
                          {data.event.menuInfo?.trim() ? (
                            <div>
                              <dt>Menu</dt>
                              <dd>{data.event.menuInfo}</dd>
                            </div>
                          ) : null}
                          {usefulInfoRoomsInfo ? (
                            <div>
                              <dt>Alloggio</dt>
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
                      </Card>
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
                      <Button
                        busy={busy === "cancel"}
                        className="my-activity__cancel"
                        disabled={busy !== null}
                        onClick={openCancelSheet}
                        variant="ghost"
                      >
                        {busy === "cancel" ? ANNULLA.annullamento : ANNULLA.annullaIscrizione}
                      </Button>
                    ) : null}
                  </>
                ) : null}

                {visibleTab === "patrol" ? (
                  <>
                    <div className="my-activity-panel__head">
                      <h2 className="my-activity-panel__title">{campGroupLabels.your}</h2>
                      <p className="my-activity-panel__sub">
                        {isCamp
                          ? "Le persone con cui condividi turni, attività e vita di campo."
                          : CAMP.gruppoAttivitaSub}
                      </p>
                    </div>

                    {currentPatrol ? (
                      <>
                        <Card>
                          <div className="my-activity-team">
                            <span className="my-activity-team__mark" aria-hidden="true">
                              {getCommitteeInitials(currentPatrol.name)}
                            </span>
                            <div className="my-activity-team__text">
                              <h3 className="my-activity-team__name">{currentPatrol.name}</h3>
                              <p>
                                {isCamp
                                  ? "Con chi cammini durante il campeggio."
                                  : CAMP.gruppoAttivitaCard}
                              </p>
                            </div>
                          </div>
                          <dl className="my-activity-facts">
                            <div>
                              <dt>Ruolo</dt>
                              <dd>
                                {getPatrolRoleLabel(currentPatrol.role, campGroupLabels.leader) ||
                                  "Membro"}
                              </dd>
                            </div>
                            <div>
                              <dt>Membri</dt>
                              <dd>
                                {currentPatrol.assignedCount ||
                                  currentPatrol.publicMembers.length}
                              </dd>
                            </div>
                          </dl>
                        </Card>

                        <Card title="Componenti" titleAs="h3">
                          <ul className="my-activity-members">
                            {currentPatrol.publicMembers.map((member, index) => (
                              <li key={member.registrationId}>
                                <span
                                  aria-hidden="true"
                                  className={`my-activity-avatar my-activity-avatar--${getAvatarTone(index)}`}
                                >
                                  {getInitials(member.fullName)}
                                </span>
                                <span className="my-activity-members__name">
                                  <strong>{member.fullName}</strong>
                                  <small>
                                    {getPublicMemberLabel(member, "patrol", campGroupLabels.leader) ||
                                      "Componente"}
                                  </small>
                                </span>
                                {member.registrationId === data.registration.id ? (
                                  <Pill tone="sand">TU</Pill>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </Card>
                      </>
                    ) : (
                      <EmptyState
                        action={null}
                        description={CAMP.gruppoAttesa}
                        headingAs="h3"
                        illustration={giovaniUrl}
                        title={campGroupLabels.assigned}
                      />
                    )}
                  </>
                ) : null}

                {visibleTab === "committees" ? (
                  <>
                    <div className="my-activity-panel__head">
                      <h2 className="my-activity-panel__title">
                        {isCamp ? "Comitati del campeggio" : "Comitati"}
                      </h2>
                      <p className="my-activity-panel__sub">
                        Qui vedi il tuo comitato e le persone con cui lo prepari.
                      </p>
                    </div>

                    {currentCommittees.length > 0 ? (
                      currentCommittees.map((committee, committeeIndex) => {
                        const leaders = [
                          ...committee.manualLeaderNames,
                          ...committee.publicMembers
                            .filter((member) => member.role === "leader")
                            .map((member) => member.fullName),
                        ];

                        return (
                          <Card className="my-activity-committee" key={committee.id}>
                            <div className="my-activity-committee__head">
                              <span
                                aria-hidden="true"
                                className={`my-activity-avatar my-activity-avatar--${getAvatarTone(
                                  committeeIndex,
                                )}`}
                              >
                                {getCommitteeInitials(committee.title)}
                              </span>
                              <div>
                                <h3 className="my-activity-committee__title">{committee.title}</h3>
                                <p>
                                  Responsabile:{" "}
                                  {leaders.length ? leaders.join(", ") : "da definire"}
                                </p>
                              </div>
                            </div>
                            <p className="my-activity-committee__role">
                              {committee.role === "leader"
                                ? "Sei tra i responsabili di questo comitato."
                                : "Sei assegnato a questo comitato."}
                            </p>
                            {committee.responsibilities ? (
                              <section className="my-activity-committee__duty">
                                <h4>{CAMP.incarico}</h4>
                                <p>{committee.responsibilities}</p>
                              </section>
                            ) : null}
                            <ul className="my-activity-chips">
                              {committee.manualLeaderNames.map((leaderName, index) => (
                                <li key={leaderName}>
                                  <i
                                    aria-hidden="true"
                                    className={`my-activity-avatar my-activity-avatar--small my-activity-avatar--${getAvatarTone(index)}`}
                                  >
                                    {getInitials(leaderName)}
                                  </i>
                                  {leaderName}
                                </li>
                              ))}
                              {committee.publicMembers.map((member, index) => (
                                <li key={member.registrationId}>
                                  <i
                                    aria-hidden="true"
                                    className={`my-activity-avatar my-activity-avatar--small my-activity-avatar--${getAvatarTone(index + 2)}`}
                                  >
                                    {getInitials(member.fullName)}
                                  </i>
                                  {member.fullName}
                                </li>
                              ))}
                            </ul>
                            <div className="my-activity-committee__foot">
                              <span>{committee.assignedCount} persone</span>
                              <Pill icon="check" tone="success">
                                Assegnato
                              </Pill>
                            </div>
                          </Card>
                        );
                      })
                    ) : (
                      <EmptyState
                        action={null}
                        description="Quando sarai assegnato a un comitato, comparirà qui."
                        headingAs="h3"
                        illustration={giovaniUrl}
                        title="Nessun comitato assegnato"
                      />
                    )}
                  </>
                ) : null}

                {visibleTab === "gallery" ? (
                  <>
                    <div className="my-activity-panel__head">
                      <h2 className="my-activity-panel__title">Galleria foto e video</h2>
                      <p className="my-activity-panel__sub">
                        Foto e video del campeggio: guardali, mettici un like e carica
                        anche i tuoi. Filtra tra foto e video nella galleria.
                      </p>
                    </div>
                    <ButtonLink
                      block
                      icon="camera"
                      size="lg"
                      to={`/activities/${data.event.id}/foto`}
                    >
                      Apri foto e video
                    </ButtonLink>
                  </>
                ) : null}

                {visibleTab === "survey" ? (
                  <>
                    <div className="my-activity-panel__head">
                      <h2 className="my-activity-panel__title">Sondaggio</h2>
                      <p className="my-activity-panel__sub">
                        Lascia un feedback anonimo sul campeggio: ci aiuta a migliorare
                        le prossime edizioni.
                      </p>
                    </div>
                    <Card
                      footer={
                        <ButtonLink to={getSurveyHref(data.event.id)} variant="primary">
                          Vai al sondaggio
                        </ButtonLink>
                      }
                      subtitle="Il sondaggio è anonimo e si compila in un minuto."
                      title="Raccontaci com'è andata"
                      titleAs="h3"
                      variant="warm"
                    />
                  </>
                ) : null}
              </section>
            </>
          ) : null}
        </div>
      </div>

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
