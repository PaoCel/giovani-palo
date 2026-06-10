import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { EventCard } from "@/components/EventCard";
import { useAsyncData } from "@/hooks/useAsyncData";
import { eventsService } from "@/services/firestore/eventsService";
import { stakesService } from "@/services/firestore/stakesService";
import type { EventAudience, EventStatus } from "@/types";
import { getActivityPath, getActivityRegistrationPath } from "@/utils/activityLinks";
import { getStoredPublicStakeId, storePublicStakeId } from "@/utils/stakeSelection";

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

function isOpenStatus(status: EventStatus) {
  return status === "registrations_open";
}

function isEventPast(event: { endDate: string; startDate: string }) {
  const reference = event.endDate || event.startDate;
  if (!reference) {
    return false;
  }
  const time = new Date(reference).getTime();
  return Number.isFinite(time) && time < Date.now();
}

export function ActivitiesPage() {
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

        return registrationFilter === "open" ? isOpenStatus(event.status) : !isOpenStatus(event.status);
      })
      .filter((event) => {
        if (timeFilter === "all") {
          return true;
        }

        const past = isEventPast(event);
        return timeFilter === "past" ? past : !past;
      })
      .sort((left, right) => {
        const leftPast = isEventPast(left);
        const rightPast = isEventPast(right);

        if (leftPast !== rightPast) {
          return leftPast ? 1 : -1;
        }

        if (leftPast) {
          return new Date(right.startDate).getTime() - new Date(left.startDate).getTime();
        }

        if (isOpenStatus(left.status) !== isOpenStatus(right.status)) {
          return isOpenStatus(left.status) ? -1 : 1;
        }

        return new Date(left.startDate).getTime() - new Date(right.startDate).getTime();
      });
  }, [audienceFilter, events, registrationFilter, timeFilter]);

  function updateSearchParam(
    key: "stake" | "audience" | "registrations" | "time",
    value: string,
  ) {
    const nextParams = new URLSearchParams(searchParams);

    nextParams.set(key, value);
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <div className="page page--activities">
      <section className="activity-catalog">
        <div className="activity-catalog__filters">
          <label className="field">
            <span>Palo</span>
            <select
              className="input"
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

          <label className="field">
            <span>Organizzazione</span>
            <select
              className="input"
              value={audienceFilter}
              onChange={(eventInput) => updateSearchParam("audience", eventInput.target.value)}
            >
              <option value="all">Tutte</option>
              <option value="giovane_uomo">GU</option>
              <option value="giovane_donna">GD</option>
              <option value="congiunta">Congiunta</option>
            </select>
          </label>

          <label className="field">
            <span>Iscrizioni</span>
            <select
              className="input"
              value={registrationFilter}
              onChange={(eventInput) =>
                updateSearchParam("registrations", eventInput.target.value)
              }
            >
              <option value="all">Tutte</option>
              <option value="open">Iscrizioni aperte</option>
              <option value="closed">Iscrizioni chiuse</option>
            </select>
          </label>

          <label className="field">
            <span>Periodo</span>
            <select
              className="input"
              value={timeFilter}
              onChange={(eventInput) => updateSearchParam("time", eventInput.target.value)}
            >
              <option value="upcoming">In programma</option>
              <option value="past">Passate</option>
              <option value="all">Tutte (anche passate)</option>
            </select>
          </label>
        </div>

        {error ? (
          <div className="notice notice--warning">
            <div>
              <h3>Caricamento non riuscito</h3>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {showSkeleton ? (
          <div className="activity-grid" aria-busy="true" aria-label="Caricamento attività">
            {[0, 1, 2].map((index) => (
              <div key={index} className="skeleton-card" aria-hidden="true">
                <div className="skeleton-card__media" />
                <div className="skeleton-card__line skeleton-card__line--wide" />
                <div className="skeleton-card__line" />
              </div>
            ))}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="activity-grid activity-grid--loading">
            <p className="subtle-text">Nessuna attività disponibile con questi filtri.</p>
          </div>
        ) : (
          <div className="activity-grid">
            {filteredEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                primaryLabel="Dettagli"
                primaryTo={getActivityPath(event.id, selectedStakeId)}
                secondaryLabel="Iscriviti"
                secondaryTo={getActivityRegistrationPath(event.id, selectedStakeId)}
                variant="poster"
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
