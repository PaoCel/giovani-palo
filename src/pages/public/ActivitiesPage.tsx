import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { EventCard } from "@/components/EventCard";
import { useAsyncData } from "@/hooks/useAsyncData";
import { eventsService } from "@/services/firestore/eventsService";
import { stakesService } from "@/services/firestore/stakesService";
import type { EventAudience, EventStatus } from "@/types";
import { getStoredPublicStakeId, storePublicStakeId } from "@/utils/stakeSelection";

type AudienceFilter = "all" | EventAudience;
type RegistrationFilter = "all" | "open" | "closed";

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

function isOpenStatus(status: EventStatus) {
  return status === "registrations_open";
}

export function ActivitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStakeId = searchParams.get("stake") ?? "";
  const requestedAudience = searchParams.get("audience");
  const requestedRegistration = searchParams.get("registrations");
  const audienceFilter = isAudienceFilter(requestedAudience) ? requestedAudience : "all";
  const registrationFilter = isRegistrationFilter(requestedRegistration)
    ? requestedRegistration
    : "all";
  const { data: stakes, loading: stakesLoading } = useAsyncData(
    () => stakesService.listActiveStakes(),
    [],
    [],
  );
  const selectedStakeId = useMemo(() => {
    if (requestedStakeId && stakes.some((stake) => stake.id === requestedStakeId)) {
      return requestedStakeId;
    }

    const storedStakeId = getStoredPublicStakeId();

    if (storedStakeId && stakes.some((stake) => stake.id === storedStakeId)) {
      return storedStakeId;
    }

    return stakes[0]?.id ?? "";
  }, [requestedStakeId, stakes]);
  const { data: events, loading, error } = useAsyncData(
    () => (selectedStakeId ? eventsService.listPublicEvents(selectedStakeId) : Promise.resolve([])),
    [selectedStakeId],
    [],
  );

  const filteredEvents = useMemo(() => {
    return [...events]
      .filter((event) => (audienceFilter === "all" ? true : event.audience === audienceFilter))
      .filter((event) => {
        if (registrationFilter === "all") {
          return true;
        }

        return registrationFilter === "open" ? isOpenStatus(event.status) : !isOpenStatus(event.status);
      })
      .sort((left, right) => {
        if (isOpenStatus(left.status) !== isOpenStatus(right.status)) {
          return isOpenStatus(left.status) ? -1 : 1;
        }

        return new Date(left.startDate).getTime() - new Date(right.startDate).getTime();
      });
  }, [audienceFilter, events, registrationFilter]);

  function updateSearchParam(
    key: "stake" | "audience" | "registrations",
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
        </div>

        {error ? (
          <div className="notice notice--warning">
            <div>
              <h3>Caricamento non riuscito</h3>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="activity-grid activity-grid--loading">
            <p className="subtle-text">Sto caricando le attività...</p>
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
                primaryTo={`/activities/${event.id}`}
                secondaryLabel="Iscriviti"
                secondaryTo={`/activities/${event.id}/register`}
                variant="poster"
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
