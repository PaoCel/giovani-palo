import { Link, useParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
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
  const { session } = useAuth();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "public";

  const { data, loading, error } = useAsyncData(
    async () => {
      if (!eventId) {
        return initialData;
      }

      const stakeId = await resolvePublicStakeId(session?.profile.stakeId);
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
    [eventId, sessionKey],
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

  function renderPrimaryAction() {
    if (!event || !formConfig) {
      return null;
    }

    if (data.registration) {
      return (
        <Link className="button button--primary" to={`/activities/${event.id}/register`}>
          <AppIcon name="ticket" />
          <span>Iscrizione</span>
        </Link>
      );
    }

    if (availability === "open" || availability === "guest-allowed") {
      return (
        <Link className="button button--primary" to={`/activities/${event.id}/register`}>
          <AppIcon name="ticket" />
          <span>Iscriviti</span>
        </Link>
      );
    }

    if (availability === "login-required") {
      return (
        <Link
          className="button button--primary"
          to={`/login?redirect=${encodeURIComponent(`/activities/${event.id}/register`)}`}
        >
          <AppIcon name="user" />
          <span>Accedi</span>
        </Link>
      );
    }

    if (availability === "restricted-audience") {
      return (
        <button className="button button--ghost" disabled type="button">
          Iscrizione riservata
        </button>
      );
    }

    return (
      <button className="button button--ghost" disabled type="button">
        Iscrizioni non disponibili
      </button>
    );
  }

  return (
    <div className="page">
      <PageHero
        className="hero--compact"
        eyebrow="Dettaglio attività"
        title={event?.title ?? "Caricamento attività..."}
        description={
          event?.description ||
          "Leggi data, luogo e dettagli utili prima di aprire il modulo di iscrizione."
        }
        actions={renderPrimaryAction()}
        aside={
          event ? (
            <div className="info-stack">
              <div className="chip-row">
                <StatusBadge
                  label={getEventStatusLabel(event.status)}
                  tone={getEventStatusTone(event.status)}
                />
                <span className="surface-chip">{getEventAudienceLabel(event.audience)}</span>
                <span className="surface-chip">
                  {formatDateRange(event.startDate, event.endDate)}
                </span>
              </div>
              {event.heroImageUrl ? (
                <div
                  className="preview-image"
                  style={{
                    backgroundImage: `url(${event.heroImageUrl})`,
                  }}
                />
              ) : null}
            </div>
          ) : null
        }
      />

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Caricamento dettaglio non riuscito</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

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
              <dt>Date</dt>
              <dd>{formatDateRange(event.startDate, event.endDate)}</dd>
            </div>
            <div>
              <dt>Luogo</dt>
              <dd>{event.location || "-"}</dd>
            </div>
            <div>
              <dt>Destinatari</dt>
              <dd>{getEventAudienceLabel(event.audience)}</dd>
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
    </div>
  );
}
