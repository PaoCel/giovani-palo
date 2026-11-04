import { useId, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import giovaniArt from "@/assets/flusso-genitore/giovani.webp";
import { PublicActivityCard } from "@/components/activities/PublicActivityCard";
import { Button, EmptyState, Notice, PageHeader } from "@/components/ui";
import { CATALOGO } from "@/copy/catalogo";
import { MOMENTI } from "@/copy/momenti";
import { fillCopy } from "@/copy/parole";
import { useAsyncData } from "@/hooks/useAsyncData";
import { eventsService } from "@/services/firestore/eventsService";
import { stakesService } from "@/services/firestore/stakesService";
import type { Event, EventAudience } from "@/types";
import { getActivityPath } from "@/utils/activityLinks";
import { getPublicEventPhase, hasEventEnded } from "@/utils/publicEventState";
import { getStoredPublicStakeId, storePublicStakeId } from "@/utils/stakeSelection";
import "@/styles/publicActivity.css";

type AudienceFilter = "all" | EventAudience;
type RegistrationFilter = "all" | "open" | "closed";
type TimeFilter = "upcoming" | "past" | "all";

function isAudienceFilter(value: string | null): value is AudienceFilter {
  return (
    value === "all" ||
    value === "congiunta" ||
    value === "giovane_uomo" ||
    value === "giovane_donna"
  );
}

function isRegistrationFilter(value: string | null): value is RegistrationFilter {
  return value === "all" || value === "open" || value === "closed";
}

function isTimeFilter(value: string | null): value is TimeFilter {
  return value === "upcoming" || value === "past" || value === "all";
}

// Stessa regola della pill di stato e del tasto d'iscrizione: prima il filtro
// leggeva solo event.status e teneva fra le aperte le attività finite.
function isOpen(event: Event) {
  return getPublicEventPhase(event) === "open";
}

const TIME_OPTIONS: Array<{ value: TimeFilter; label: string }> = [
  { value: "upcoming", label: CATALOGO.inProgramma },
  { value: "past", label: CATALOGO.passate },
  { value: "all", label: CATALOGO.tutte },
];

export function ActivitiesPage() {
  const filterIds = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStakeId = searchParams.get("stake") ?? "";
  const requestedAudience = searchParams.get("audience");
  const requestedRegistration = searchParams.get("registrations");
  const requestedTime = searchParams.get("time");
  const audienceFilter = isAudienceFilter(requestedAudience) ? requestedAudience : "all";
  const registrationFilter = isRegistrationFilter(requestedRegistration)
    ? requestedRegistration
    : "all";
  const timeFilter: TimeFilter = isTimeFilter(requestedTime) ? requestedTime : "upcoming";
  const { data: stakes, loading: stakesLoading } = useAsyncData(
    () => stakesService.listActiveStakes(),
    [],
    [],
  );
  const selectedStakeId = useMemo(() => {
    // Ottimistico: finché la lista pali non è arrivata ci fidiamo del palo
    // richiesto/memorizzato, così la query attività parte SUBITO in parallelo
    // invece di aspettare la lista (prima era un waterfall di due query).
    const stakesReady = stakes.length > 0;

    if (requestedStakeId && (!stakesReady || stakes.some((stake) => stake.id === requestedStakeId))) {
      return requestedStakeId;
    }

    const storedStakeId = getStoredPublicStakeId();

    if (storedStakeId && (!stakesReady || stakes.some((stake) => stake.id === storedStakeId))) {
      return storedStakeId;
    }

    return stakes[0]?.id ?? "";
  }, [requestedStakeId, stakes]);
  const { data: events, loading, error } = useAsyncData(
    () => (selectedStakeId ? eventsService.listPublicEvents(selectedStakeId) : Promise.resolve([])),
    [selectedStakeId],
    [],
  );
  // Non dichiarare "nessuna attività" finché non abbiamo davvero interrogato
  // un palo: prima questo stato compariva durante il caricamento e l'utente
  // pensava che le attività non esistessero.
  const resolvingStake = stakesLoading && !selectedStakeId;
  const showSkeleton = loading || resolvingStake;

  const filteredEvents = useMemo(() => {
    return [...events]
      .filter((event) => (audienceFilter === "all" ? true : event.audience === audienceFilter))
      .filter((event) => {
        if (registrationFilter === "all") {
          return true;
        }

        return registrationFilter === "open" ? isOpen(event) : !isOpen(event);
      })
      .filter((event) => {
        if (timeFilter === "all") {
          return true;
        }

        const past = hasEventEnded(event);
        return timeFilter === "past" ? past : !past;
      })
      .sort((left, right) => {
        const leftPast = hasEventEnded(left);
        const rightPast = hasEventEnded(right);

        if (leftPast !== rightPast) {
          return leftPast ? 1 : -1;
        }

        if (leftPast) {
          return new Date(right.startDate).getTime() - new Date(left.startDate).getTime();
        }

        if (isOpen(left) !== isOpen(right)) {
          return isOpen(left) ? -1 : 1;
        }

        return new Date(left.startDate).getTime() - new Date(right.startDate).getTime();
      });
  }, [audienceFilter, events, registrationFilter, timeFilter]);

  function updateSearchParams(values: Partial<Record<"stake" | "audience" | "registrations" | "time", string>>) {
    const nextParams = new URLSearchParams(searchParams);

    for (const [key, value] of Object.entries(values)) {
      nextParams.set(key, value);
    }
    setSearchParams(nextParams, { replace: true });
  }

  function updateSearchParam(key: "stake" | "audience" | "registrations" | "time", value: string) {
    updateSearchParams({ [key]: value });
  }

  const selectedStakeName = stakes.find((stake) => stake.id === selectedStakeId)?.name;
  const hasNarrowingFilters = audienceFilter !== "all" || registrationFilter !== "all";
  const emptyState = events.length === 0 ? (
    <EmptyState
      action={null}
      description={CATALOGO.vuotoPaloTesto}
      illustration={giovaniArt}
      title={CATALOGO.vuotoPalo}
    />
  ) : hasNarrowingFilters ? (
    <EmptyState
      action={
        <Button onClick={() => updateSearchParams({ audience: "all", registrations: "all" })}>
          {CATALOGO.togliFiltri}
        </Button>
      }
      description={CATALOGO.vuotoFiltriTesto}
      illustration={giovaniArt}
      title={CATALOGO.vuotoFiltri}
    />
  ) : timeFilter === "upcoming" ? (
    <EmptyState
      action={<Button onClick={() => updateSearchParam("time", "past")}>{CATALOGO.mostraPassate}</Button>}
      description={CATALOGO.vuotoInProgrammaTesto}
      illustration={giovaniArt}
      title={CATALOGO.vuotoInProgramma}
    />
  ) : (
    <EmptyState
      action={
        <Button onClick={() => updateSearchParam("time", "upcoming")}>{CATALOGO.mostraInProgramma}</Button>
      }
      description={CATALOGO.vuotoPassateTesto}
      illustration={giovaniArt}
      title={CATALOGO.vuotoPassate}
    />
  );

  return (
    <div className="page public-catalog">
      <PageHeader
        description={CATALOGO.descrizione}
        eyebrow={selectedStakeName}
        title={CATALOGO.titolo}
      />

      <div className="public-filters">
        <div aria-label={CATALOGO.periodo} className="public-filters__time" role="group">
          {TIME_OPTIONS.map((option) => (
            <Button
              aria-pressed={timeFilter === option.value}
              className="public-filters__toggle"
              key={option.value}
              onClick={() => updateSearchParam("time", option.value)}
              variant="secondary"
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="public-filters__selects">
          <label className="public-field public-field--stake">
            <span className="public-field__label" id={`${filterIds}-palo`}>Palo</span>
            {/* The wrapping label would add the options to the accessible name. */}
            <select
              aria-labelledby={`${filterIds}-palo`}
              className="public-field__select"
              disabled={stakesLoading || stakes.length === 0}
              value={selectedStakeId}
              onChange={(eventInput) => {
                const nextStakeId = eventInput.target.value;

                storePublicStakeId(nextStakeId);
                updateSearchParam("stake", nextStakeId);
              }}
            >
              {stakes.length === 0 ? <option value="">Sto caricando i pali...</option> : null}
              {stakes.map((stake) => (
                <option key={stake.id} value={stake.id}>
                  {stake.name}
                </option>
              ))}
            </select>
          </label>

          <label className="public-field">
            <span className="public-field__label" id={`${filterIds}-organizzazione`}>Organizzazione</span>
            <select
              aria-labelledby={`${filterIds}-organizzazione`}
              className="public-field__select"
              value={audienceFilter}
              onChange={(eventInput) => updateSearchParam("audience", eventInput.target.value)}
            >
              <option value="all">Tutte</option>
              <option value="giovane_uomo">GU</option>
              <option value="giovane_donna">GD</option>
              <option value="congiunta">Congiunta</option>
            </select>
          </label>

          <label className="public-field">
            <span className="public-field__label" id={`${filterIds}-iscrizioni`}>Iscrizioni</span>
            <select
              aria-labelledby={`${filterIds}-iscrizioni`}
              className="public-field__select"
              value={registrationFilter}
              onChange={(eventInput) =>
                updateSearchParam("registrations", eventInput.target.value)
              }
            >
              <option value="all">Tutte</option>
              <option value="open">{CATALOGO.iscrizioniAperte}</option>
              <option value="closed">{MOMENTI.iscrizioniChiuse}</option>
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <Notice live="alert" title="Caricamento non riuscito" tone="danger">
          {error}
        </Notice>
      ) : null}

      {showSkeleton ? (
        <div className="public-grid" aria-busy="true" aria-label="Caricamento attività">
          {[0, 1, 2].map((index) => (
            <div key={index} className="public-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : error ? null : filteredEvents.length === 0 ? (
        emptyState
      ) : (
        <>
          <p className="public-count">
            {filteredEvents.length === 1
              ? CATALOGO.conteggioUna
              : fillCopy(CATALOGO.conteggio, { numero: String(filteredEvents.length) })}
          </p>
          <div className="public-grid">
            {filteredEvents.map((event) => (
              <PublicActivityCard
                event={event}
                key={event.id}
                to={getActivityPath(event.id, selectedStakeId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
