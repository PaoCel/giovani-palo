import { Link, useParams, useSearchParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { AppLoader } from "@/components/AppLoader";
import { EmptyState } from "@/components/EmptyState";
import { SectionCard } from "@/components/SectionCard";
import { ShareButton } from "@/components/ShareButton";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { eventsService } from "@/services/firestore/eventsService";
import { organizationService } from "@/services/firestore/organizationService";
import { registrationsService } from "@/services/firestore/registrationsService";
import {
  getVisibleStandardFieldDefinitions,
  normalizeStandardFieldKeys,
} from "@/utils/formFields";
import { formatDateRange, formatDateTime } from "@/utils/formatters";
import {
  getAudienceRestrictionMessage,
  getEventAudienceLabel,
  getEventStatusLabel,
  getEventStatusTone,
  getRegistrationAvailability,
} from "@/utils/events";
import { getRegistrationLookupFromSession } from "@/utils/session";
import { resolvePublicStakeId } from "@/utils/stakeSelection";
import {
  getAbsoluteUrl,
  getActivityPath,
  getActivityRegistrationPath,
} from "@/utils/activityLinks";

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

function getRegistrationCountdown(registrationClose: string): string | null {
  const closesAt = new Date(registrationClose).getTime();
  if (Number.isNaN(closesAt)) {
    return null;
  }

  const remaining = closesAt - Date.now();
  if (remaining <= 0) {
    return null;
  }

  const days = Math.floor(remaining / 86_400_000);
  if (days >= 7) {
    return null;
  }

  if (days >= 1) {
    return days === 1 ? "tra 1 giorno" : `tra ${days} giorni`;
  }

  const hours = Math.floor(remaining / 3_600_000);
  if (hours >= 1) {
    return hours === 1 ? "tra 1 ora" : `tra ${hours} ore`;
  }

  const minutes = Math.max(1, Math.floor(remaining / 60_000));
  return minutes === 1 ? "tra 1 minuto" : `tra ${minutes} minuti`;
}

function renderOptionalInfo(title: string, value: string) {
  if (!value.trim()) {
    return null;
  }

  return (
    <div className="surface-panel surface-panel--subtle">
      <h3>{title}</h3>
      <p>{value}</p>
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

  if (!loading && !data.event) {
    return (
      <div className="page">
        <EmptyState
          title="Attività non trovata"
          description="L'attività richiesta non è pubblica oppure non esiste."
          action={
            <Link className="button button--primary" to="/activities">
              Torna alle attività
            </Link>
          }
        />
      </div>
    );
  }

  const event = data.event;
  const formConfig = data.formConfig;
  const standardFieldDefinitions = getVisibleStandardFieldDefinitions(
    data.organization?.registrationDefaults.fieldOverrides,
  );
  const availability =
    event && formConfig ? getRegistrationAvailability(event, formConfig, session) : null;
  const fieldLabels =
    formConfig
      ? normalizeStandardFieldKeys(formConfig.enabledStandardFields)
          .map((key) => standardFieldDefinitions.find((field) => field.key === key)?.label)
          .filter((label): label is string => Boolean(label))
      : [];
  const shareUrl = event ? getAbsoluteUrl(getActivityPath(event.id, data.stakeId)) : "";
  const registrationCountdown =
    event &&
    (availability === "open" ||
      availability === "guest-allowed" ||
      availability === "login-required")
      ? getRegistrationCountdown(event.registrationClose)
      : null;

  function renderPrimaryAction(variant: "hero" | "bar" = "hero") {
    if (!event || !formConfig) {
      return null;
    }

    const primaryClass = variant === "hero" ? "button button--inverse" : "button button--primary";
    const disabledClass =
      variant === "hero" ? "button button--outline-light" : "button button--ghost";
    const registrationPath = getActivityRegistrationPath(event.id, data.stakeId);

    if (data.registration) {
      return (
        <Link className={primaryClass} to={registrationPath}>
          <AppIcon name="ticket" />
          <span>Iscrizione</span>
        </Link>
      );
    }

    if (availability === "open" || availability === "guest-allowed") {
      return (
        <Link className={primaryClass} to={registrationPath}>
          <AppIcon name="ticket" />
          <span>Iscriviti</span>
        </Link>
      );
    }

    if (availability === "login-required") {
      return (
        <Link
          className={primaryClass}
          to={`/login?redirect=${encodeURIComponent(registrationPath)}`}
        >
          <AppIcon name="user" />
          <span>Accedi</span>
        </Link>
      );
    }

    if (availability === "restricted-audience") {
      return (
        <button className={disabledClass} disabled type="button">
          Iscrizione riservata
        </button>
      );
    }

    return (
      <button className={disabledClass} disabled type="button">
        Iscrizioni non disponibili
      </button>
    );
  }

  return (
    <div className="page page--activity-detail">
      <section className="activity-hero">
        {event?.heroImageUrl ? (
          <div
            aria-hidden="true"
            className="activity-hero__media"
            style={{ backgroundImage: `url(${event.heroImageUrl})` }}
          />
        ) : null}
        <div className="activity-hero__content">
          <span className="activity-hero__eyebrow">Dettaglio attività</span>
          <h1 className="activity-hero__title">{event?.title ?? "Caricamento attività..."}</h1>
          {event?.description ? (
            <p className="activity-hero__description">{event.description}</p>
          ) : null}
          {event ? (
            <div className="activity-hero__chips">
              <span className={`activity-chip activity-chip--${getEventStatusTone(event.status)}`}>
                <span aria-hidden="true" className="activity-chip__dot" />
                {getEventStatusLabel(event.status)}
              </span>
              <span className="activity-chip">
                <AppIcon name="calendar" />
                {formatDateRange(event.startDate, event.endDate)}
              </span>
              {event.location.trim() ? (
                <span className="activity-chip">
                  <AppIcon name="map-pin" />
                  {event.location}
                </span>
              ) : null}
              <span className="activity-chip">
                <AppIcon name="users" />
                {getEventAudienceLabel(event.audience)}
              </span>
            </div>
          ) : null}
          {registrationCountdown ? (
            <p className="activity-hero__countdown">
              <AppIcon name="clock" />
              <span>Le iscrizioni chiudono {registrationCountdown}</span>
            </p>
          ) : null}
          {event ? (
            <div className="activity-hero__actions">
              {renderPrimaryAction("hero")}
              <ShareButton
                className="button button--outline-light"
                title={event.title}
                text="Guarda questa attività e apri l'iscrizione."
                url={shareUrl}
              />
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Caricamento dettaglio non riuscito</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {loading ? <AppLoader label="Sto caricando l'attività..." /> : null}

      {event && availability === "restricted-audience" ? (
        <div className="notice notice--warning">
          <div>
            <h3>Iscrizione non disponibile per il tuo profilo</h3>
            <p>{getAudienceRestrictionMessage(event.audience)}</p>
          </div>
        </div>
      ) : null}

      {event ? (
        <SectionCard
          title="Informazioni principali"
          description="Le informazioni essenziali per decidere e completare l'iscrizione."
        >
          <dl className="summary-list">
            <div>
              <dt>Luogo</dt>
              <dd>{event.location || "-"}</dd>
            </div>
            <div>
              <dt>Apertura iscrizioni</dt>
              <dd>{formatDateTime(event.registrationOpen)}</dd>
            </div>
            <div>
              <dt>Chiusura iscrizioni</dt>
              <dd>{formatDateTime(event.registrationClose)}</dd>
            </div>
            <div>
              <dt>Pernottamento</dt>
              <dd>{event.overnight ? "Sì" : "No"}</dd>
            </div>
          </dl>
        </SectionCard>
      ) : null}

      {event?.program ? (
        <SectionCard
          title="Programma"
          description="Panoramica rapida dell'attività."
        >
          <div className="surface-panel surface-panel--subtle">
            <p>{event.program}</p>
          </div>
        </SectionCard>
      ) : null}

      {event ? (
        <SectionCard
          title="Sondaggio post-evento"
          description="Hai partecipato? Lasciaci un feedback (anonimo)."
        >
          <Link className="button button--ghost" to={`/me/sondaggi/${event.id}`}>
            Apri il sondaggio
          </Link>
        </SectionCard>
      ) : null}

      {event ? (
        <SectionCard
          title="Galleria foto e video"
          description="Inserisci il codice ricevuto per accedere ai contenuti."
        >
          <Link className="button button--ghost" to={`/me/galleria/per-attivita/${event.id}`}>
            Apri galleria attività
          </Link>
        </SectionCard>
      ) : null}

      {event?.whatToBring?.trim() ? (
        <SectionCard
          title="Cosa portare"
          description={
            event.activityType === "camp" ||
            event.activityType === "overnight" ||
            event.overnight
              ? "Importante: leggi prima di partire."
              : "Materiale consigliato per partecipare."
          }
        >
          <div className="what-to-bring-card">
            {event.activityType === "camp" ||
            event.activityType === "overnight" ||
            event.overnight ? (
              <span className="what-to-bring-badge">⚠️ Consigliato leggere</span>
            ) : null}
            <p className="what-to-bring-text">{event.whatToBring}</p>
          </div>
        </SectionCard>
      ) : null}

      {event &&
      [
        event.menuInfo,
        event.allergiesInfo,
        event.overnight ? event.roomsInfo : "",
        event.publicNotes,
      ].some((value) =>
        value.trim(),
      ) ? (
        <SectionCard title="Dettagli utili" description="Mostriamo solo ciò che è già disponibile.">
          <div className="stack">
            {renderOptionalInfo("Menu", event.menuInfo)}
            {renderOptionalInfo("Allergie e alimentazione", event.allergiesInfo)}
            {event.overnight ? renderOptionalInfo("Camere o posti letto", event.roomsInfo) : null}
            {renderOptionalInfo("Note", event.publicNotes)}
          </div>
        </SectionCard>
      ) : null}

      {formConfig ? (
        <SectionCard
          title="Prima di compilare"
          description="Così sai già quali dati ti verranno chiesti."
        >
          <div className="stack">
            <div className="chip-row">
              <StatusBadge
                label={
                  formConfig.allowGuestRegistration
                    ? "Iscrizione senza account disponibile"
                    : "Serve un account"
                }
                tone={formConfig.allowGuestRegistration ? "success" : "warning"}
              />
            </div>

            <div className="surface-panel surface-panel--subtle">
              <h3>Campi principali</h3>
              <p>
                {fieldLabels.length > 0
                  ? fieldLabels.join(", ")
                  : "Solo dati base e pochi dettagli essenziali."}
              </p>
              <p className="subtle-text">
                Consensi foto e privacy: puoi leggere i dettagli prima di compilare su{" "}
                <Link to="/privacy/photos">questa pagina</Link>.
              </p>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {event && formConfig ? (
        <div className="activity-cta-bar">
          <div className="activity-cta-bar__inner">
            {renderPrimaryAction("bar")}
            <ShareButton
              className="button button--ghost activity-cta-bar__share"
              iconOnly
              title={event.title}
              text="Guarda questa attività e apri l'iscrizione."
              url={shareUrl}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
