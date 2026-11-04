import { getSurveyHref, hasPublicSurvey } from "@/utils/surveyLinks";
import { Suspense, lazy } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { ActivityProgram } from "@/components/activities/ActivityProgram";
import { ActivityScene } from "@/components/activities/ActivityScene";
import { MOMENTI } from "@/copy/momenti";
import { ActivityMediaCard } from "@/components/gallery/ActivityMediaCard";
import { ShareButton } from "@/components/ShareButton";
import { Button, ButtonLink, Card, EmptyState, Icon, Notice, Pill } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useStakeMembership } from "@/hooks/useStakeMembership";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { eventsService } from "@/services/firestore/eventsService";
import { organizationService } from "@/services/firestore/organizationService";
import { registrationsService } from "@/services/firestore/registrationsService";
import {
  getVisibleStandardFieldDefinitions,
  normalizeStandardFieldKeys,
} from "@/utils/formFields";
import { ATTIVITA } from "@/copy/attivita";
import { formatDateRange, formatDateTime } from "@/utils/formatters";
import {
  getAudienceRestrictionMessage,
  getEventAudienceLabel,
  getRegistrationAvailability,
} from "@/utils/events";
import { getPublicEventState, getRegistrationCountdown } from "@/utils/publicEventState";
import { canManageFamily } from "@/utils/family";
import { getRegistrationLookupFromSession } from "@/utils/session";
import { resolvePublicStakeId } from "@/utils/stakeSelection";
import {
  getAbsoluteUrl,
  getActivityPath,
  getActivityRegistrationPath,
  withRegisterFor,
  getMyActivityPath,
} from "@/utils/activityLinks";
import "@/styles/publicActivity.css";

// Card della Notte dei Record: caricata a parte (con il suo CSS) solo per le
// attività che hanno il modulo attivo.
const RecordNightEntryCard = lazy(async () => ({
  default: (await import("@/components/recordNight/RecordNightEntryCard")).RecordNightEntryCard,
}));

interface ActivityDetailData {
  stakeId: string;
  organization: Awaited<ReturnType<typeof organizationService.getProfile>> | null;
  event: Awaited<ReturnType<typeof eventsService.getPublicEventById>>;
  formConfig: Awaited<ReturnType<typeof eventFormsService.getFormConfig>> | null;
  registration: Awaited<ReturnType<typeof registrationsService.getRegistrationById>>;
}

const initialData: ActivityDetailData = {
  stakeId: "",
  organization: null,
  event: null,
  formConfig: null,
  registration: null,
};

// Righe di «Dettagli utili»: solo quelle già scritte dallo staff.
function renderOptionalInfo(title: string, value: string) {
  if (!value.trim()) {
    return null;
  }

  return (
    <div key={title}>
      <dt>{title}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ActivityDetailPage() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const { session } = useAuth();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "public";
  const requestedStakeId = searchParams.get("stake") ?? "";

  const { data, loading, error } = useAsyncData(
    async () => {
      if (!eventId) {
        return initialData;
      }

      const stakeId = await resolvePublicStakeId(requestedStakeId || session?.profile.stakeId);
      const lookup = getRegistrationLookupFromSession(session);
      const hasLookup = Boolean(lookup.userId || lookup.anonymousUid);

      const [organization, event, formConfig, registration] = await Promise.all([
        organizationService.getProfile(stakeId),
        eventsService.getPublicEventById(stakeId, eventId),
        eventFormsService.getFormConfig(stakeId, eventId),
        hasLookup
          ? registrationsService.getRegistrationByActor(stakeId, eventId, lookup)
          : Promise.resolve(null),
      ]);

      if (!event) {
        return {
          ...initialData,
          stakeId,
          organization,
        };
      }

      return {
        stakeId,
        organization,
        event,
        formConfig,
        registration,
      };
    },
    [eventId, requestedStakeId, sessionKey],
    initialData,
  );
  // Il conteggio dei record si legge solo da membro del palo dell'attività.
  const { access: membershipAccess } = useStakeMembership(data.stakeId);

  if (!loading && !data.event) {
    return (
      <div className="page">
        <EmptyState
          title="Attività non trovata"
          description="L'attività richiesta non è pubblica oppure non esiste."
          action={<ButtonLink to="/activities">Torna alle attività</ButtonLink>}
        />
      </div>
    );
  }

  const event = data.event;
  const hasActiveRegistration =
    Boolean(data.registration) && data.registration?.registrationStatus !== "cancelled";

  if (
    !loading &&
    event &&
    hasActiveRegistration &&
    session?.isAuthenticated &&
    !session.isAnonymous
  ) {
    return <Navigate replace to={getMyActivityPath(event.id)} />;
  }

  const formConfig = data.formConfig;
  const standardFieldDefinitions = getVisibleStandardFieldDefinitions(
    data.organization?.registrationDefaults.fieldOverrides,
  );
  // Chi può avere figli (G2) entra nell'iscrizione anche se l'attività non è
  // per il suo gruppo: il pubblico si guarda su chi partecipa, nel modulo.
  const availability =
    event && formConfig
      ? getRegistrationAvailability(event, formConfig, session, {
          forChild: canManageFamily(session),
        })
      : null;
  const fieldLabels =
    formConfig
      ? normalizeStandardFieldKeys(formConfig.enabledStandardFields)
          .map((key) => standardFieldDefinitions.find((field) => field.key === key)?.label)
          .filter((label): label is string => Boolean(label))
      : [];
  const shareUrl = event ? getAbsoluteUrl(getActivityPath(event.id, data.stakeId)) : "";
  // Stessa regola del tasto: la pill non dice più «Iscrizioni aperte» su
  // un'attività finita (src/utils/publicEventState.ts).
  const publicState = event ? getPublicEventState(event) : null;
  const ended = publicState?.phase === "ended";
  // Solo i sondaggi aperti a tutti: quelli del campeggio stanno nell'area dei
  // partecipanti, che da iscritti arrivano alla loro scheda.
  const hasSurvey = Boolean(event && ended && hasPublicSurvey(event.id));
  // Un'attività finita non si iscrive più, anche se la chiusura è dopo la fine.
  const canRegister =
    !ended &&
    (availability === "open" || availability === "guest-allowed" || availability === "login-required");
  const registrationCountdown =
    event && canRegister ? getRegistrationCountdown(event.registrationClose) : null;
  const preparesTrip = Boolean(
    event && (event.activityType === "camp" || event.activityType === "overnight" || event.overnight),
  );

  // Il sondaggio post-evento ha senso solo ad attività finita: lì prende il
  // posto di «Iscriviti» (scelta di Paolo, 4 novembre 2026).
  function renderPrimaryAction(where: "hero" | "bar" | "aside") {
    if (!event || !formConfig) {
      return null;
    }

    const block = where !== "hero";
    const registrationPath = getActivityRegistrationPath(event.id, data.stakeId);

    if (data.registration) {
      return (
        <ButtonLink block={block} icon="ticket" size="lg" to={getMyActivityPath(event.id)}>
          La tua scheda
        </ButtonLink>
      );
    }

    if (ended) {
      return hasSurvey ? (
        <ButtonLink block={block} size="lg" to={getSurveyHref(event.id)}>
          Apri il sondaggio
        </ButtonLink>
      ) : null;
    }

    // Chi non è entrato si iscrive da qui anche quando serve un account: il
    // passo account è dentro l'iscrizione (docs/FLUSSO_GENITORE.md, A e C).
    if (canRegister) {
      const forChild = Boolean(session?.isParent);

      return (
        <ButtonLink
          block={block}
          icon="ticket"
          size="lg"
          state={{ fromActivity: true }}
          to={forChild ? withRegisterFor(registrationPath, "figlio") : registrationPath}
        >
          {forChild ? ATTIVITA.iscriviFiglio : ATTIVITA.iscriviti}
        </ButtonLink>
      );
    }

    return (
      <Button block={block} disabled size="lg" variant="secondary">
        {availability === "restricted-audience" ? "Iscrizione riservata" : "Iscrizioni non disponibili"}
      </Button>
    );
  }

  // Sotto "Iscriviti", per chi non è entrato (anche da ospite): la stessa
  // iscrizione con la scelta del figlio già fatta.
  function renderParentLine(className: string) {
    if (
      !event ||
      !formConfig ||
      data.registration ||
      (session?.isAuthenticated && !session.isAnonymous) ||
      !canRegister ||
      (availability !== "guest-allowed" && availability !== "login-required")
    ) {
      return null;
    }

    const [before, after = ""] = ATTIVITA.rigaGenitore.split("{link}");

    return (
      <p className={className}>
        {before}
        <Link
          state={{ fromActivity: true }}
          to={withRegisterFor(getActivityRegistrationPath(event.id, data.stakeId), "figlio")}
        >
          {ATTIVITA.iscriviFiglio}
        </Link>
        {after}
      </p>
    );
  }

  const parentLineBar = renderParentLine("public-cta-bar__parent");
  // Barra in basso solo se c'è un'azione: un'attività finita senza sondaggio non ne ha.
  const hasBar = Boolean(event && formConfig && (data.registration || !ended || hasSurvey));
  const usefulDetails = event
    ? [
        renderOptionalInfo("Menu", event.menuInfo),
        renderOptionalInfo("Allergie e alimentazione", event.allergiesInfo),
        event.overnight ? renderOptionalInfo("Alloggio", event.roomsInfo) : null,
        renderOptionalInfo("Note", event.publicNotes),
      ].filter(Boolean)
    : [];

  return (
    <div
      className={
        hasBar
          ? parentLineBar
            ? "page public-detail public-detail--bar public-detail--bar-parent"
            : "page public-detail public-detail--bar"
          : "page public-detail"
      }
    >
      {event ? (
        <section className="public-hero">
          <div
            className="public-hero__media"
            style={event.heroImageUrl ? { backgroundImage: `url(${event.heroImageUrl})` } : undefined}
          >
            {event.heroImageUrl ? null : <ActivityScene className="public-hero__scene" />}
          </div>
          <div className="public-hero__body">
            <div className="public-pills">
              {publicState ? (
                <Pill dot tone={publicState.tone}>
                  {publicState.label}
                </Pill>
              ) : null}
              <Pill>{getEventAudienceLabel(event.audience)}</Pill>
              {event.overnight ? <Pill>Pernottamento</Pill> : null}
            </div>
            <h1 className="public-hero__title">{event.title}</h1>
            <div className="public-meta">
              <p>
                <Icon name="calendar" />
                <span>{formatDateRange(event.startDate, event.endDate)}</span>
              </p>
              {event.location.trim() ? (
                <p>
                  <Icon name="map-pin" />
                  <span>{event.location}</span>
                </p>
              ) : null}
            </div>
            {event.description ? <p className="public-hero__description">{event.description}</p> : null}
            {registrationCountdown ? (
              <p className="public-hero__countdown">
                <Icon name="clock" />
                <span>{registrationCountdown}</span>
              </p>
            ) : null}
            {formConfig ? (
              <div className="public-hero__actions">
                {renderPrimaryAction("hero")}
                <ShareButton
                  className="public-share"
                  iconOnly
                  title={event.title}
                  text="Guarda questa attività e apri l'iscrizione."
                  url={shareUrl}
                />
              </div>
            ) : null}
            {hasSurvey && !data.registration ? (
              <p className="public-hero__note">Hai partecipato? Lasciaci un feedback (anonimo).</p>
            ) : null}
            {renderParentLine("public-hero__note public-hero__parent")}
          </div>
        </section>
      ) : (
        <section aria-busy="true" className="public-hero public-hero--loading">
          <div className="public-hero__body">
            <h1 className="public-hero__title">Caricamento attività...</h1>
          </div>
        </section>
      )}

      {error ? (
        <Notice title="Caricamento dettaglio non riuscito" tone="danger">
          {error}
        </Notice>
      ) : null}

      {event ? (
        <div className="public-detail__layout">
          <div className="public-detail__main">
            {event.recordsEnabled ? (
              <Suspense fallback={null}>
                <RecordNightEntryCard
                  canReadRecords={membershipAccess === "member"}
                  event={event}
                  stakeId={data.stakeId}
                />
              </Suspense>
            ) : null}

            <ActivityProgram stakeId={data.stakeId} activityId={event.id} />

            {event.program ? (
              <Card title={MOMENTI.programmaGenerale}>
                <p className="public-prose">{event.program}</p>
              </Card>
            ) : null}

            {event.whatToBring?.trim() ? (
              <Card
                subtitle={
                  preparesTrip
                    ? "Importante: leggi prima di partire."
                    : "Materiale consigliato per partecipare."
                }
                title="Cosa portare"
              >
                <p className="public-prose">{event.whatToBring}</p>
              </Card>
            ) : null}

            {usefulDetails.length > 0 ? (
              <Card title="Dettagli utili">
                <dl className="public-facts">{usefulDetails}</dl>
              </Card>
            ) : null}

            <ActivityMediaCard stakeId={data.stakeId} event={event} />
          </div>

          <aside className="public-detail__aside">
            {availability === "restricted-audience" ? (
              <Notice live="none" title="Iscrizione non disponibile per il tuo profilo" tone="warning">
                {getAudienceRestrictionMessage(event.audience)}
              </Notice>
            ) : null}

            <Card
              footer={
                formConfig ? <div className="public-detail__aside-action">{renderPrimaryAction("aside")}</div> : null
              }
              title="Iscrizione"
              variant="cool"
            >
              <dl className="public-facts">
                <div>
                  <dt>Apertura iscrizioni</dt>
                  <dd>{formatDateTime(event.registrationOpen)}</dd>
                </div>
                <div>
                  <dt>Chiusura iscrizioni</dt>
                  <dd>{formatDateTime(event.registrationClose)}</dd>
                </div>
                {formConfig && canRegister ? (
                  <div>
                    <dt>Campi principali</dt>
                    <dd>
                      {fieldLabels.length > 0
                        ? fieldLabels.join(", ")
                        : "Solo dati base e pochi dettagli essenziali."}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {formConfig && canRegister ? (
                <>
                  <Pill tone={formConfig.allowGuestRegistration ? "success" : "warning"}>
                    {formConfig.allowGuestRegistration
                      ? "Iscrizione senza account disponibile"
                      : "Serve un account"}
                  </Pill>
                  <p className="public-small">
                    Consensi foto e privacy: puoi leggere i dettagli prima di compilare su{" "}
                    <Link to="/privacy/photos">questa pagina</Link>.
                  </p>
                </>
              ) : null}
            </Card>
          </aside>
        </div>
      ) : null}

      {hasBar && event ? (
        <div className="public-cta-bar">
          <div className="public-cta-bar__inner">
            {renderPrimaryAction("bar")}
            <ShareButton
              className="public-share"
              iconOnly
              title={event.title}
              text="Guarda questa attività e apri l'iscrizione."
              url={shareUrl}
            />
          </div>
          {parentLineBar}
        </div>
      ) : null}
    </div>
  );
}
