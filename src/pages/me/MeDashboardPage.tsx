import { Link } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { HomeFeed } from "@/components/feed/HomeFeed";
import { StatusBadge } from "@/components/StatusBadge";
import { UserPageIntro } from "@/components/UserPageIntro";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { surveysService } from "@/services/firestore/surveysService";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import { formatEventWindow } from "@/utils/formatters";
import {
  getEventAudienceLabel,
  getEventStatusLabel,
  getEventStatusTone,
  isPastEvent,
} from "@/utils/events";

export function MeDashboardPage() {
  const { session } = useAuth();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "none";

  const { data: feed, loading, error } = useAsyncData(
    () => userActivitiesService.listStakeActivityFeed(session),
    [sessionKey],
    [],
  );
  const featuredActivities = feed.filter(
    ({ event, registration }) =>
      Boolean(registration) &&
      registration?.registrationStatus !== "cancelled" &&
      !isPastEvent(event),
  );
  const pastEvents = feed.filter(({ event }) => isPastEvent(event)).slice(0, 6);
  const pastIdsKey = pastEvents.map(({ event }) => event.id).join(",");
  const stakeIdKey = session?.profile.stakeId ?? "";

  // Per ogni attività passata, controlla se ha almeno una domanda attiva.
  // Solo quelle col sondaggio compilato dall'admin compaiono in home.
  const { data: surveyableIds } = useAsyncData<Set<string>>(
    async () => {
      if (!stakeIdKey || pastEvents.length === 0) return new Set();
      const results = await Promise.all(
        pastEvents.map(({ event }) =>
          surveysService
            .listActiveQuestions(stakeIdKey, event.id)
            .then((questions) => ({ id: event.id, has: questions.length > 0 }))
            .catch(() => ({ id: event.id, has: false })),
        ),
      );
      return new Set(results.filter((entry) => entry.has).map((entry) => entry.id));
    },
    [pastIdsKey, stakeIdKey],
    new Set<string>(),
  );

  const surveyCandidates = pastEvents.filter(({ event }) => surveyableIds.has(event.id));

  return (
    <div className="page page--user-dashboard">
      <UserPageIntro />

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Impossibile leggere le attività</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {surveyCandidates.length > 0 ? (
        <section className="user-dashboard-section user-dashboard-section--priority">
          <div className="user-section-heading">
            <h2>Sondaggi delle attività passate</h2>
            <p className="subtle-text">
              Lasciaci un feedback anonimo: ci aiuta a migliorare le prossime attività.
            </p>
          </div>
          <div className="stack">
            {surveyCandidates.map(({ event }) => (
              <article key={event.id} className="surface-panel surface-panel--subtle">
                <strong>{event.title}</strong>
                <p className="subtle-text">{formatEventWindow(event)}</p>
                <div className="chip-row">
                  <Link
                    className="button button--primary button--small"
                    to={`/me/sondaggi/${event.id}`}
                  >
                    Compila sondaggio
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? (
        <section className="user-dashboard-section">
          <div className="user-section-heading">
            <h2>La prossima attività programmata a cui parteciperai</h2>
          </div>
          <p className="subtle-text">Sto caricando le prossime attività...</p>
        </section>
      ) : featuredActivities.length === 0 ? (
        <EmptyState
          title="Nessuna attività in evidenza"
          description="Quando avrai una prossima attività programmata la troverai qui."
          action={
            <Link className="button button--primary" to="/me/activities">
              Apri attività
            </Link>
          }
        />
      ) : (
        <section className="user-dashboard-section">
          <div className="user-section-heading">
            <h2>La prossima attività programmata a cui parteciperai</h2>
          </div>
          <div className="stack">
            {featuredActivities.slice(0, 2).map(({ event }) => (
              <article key={event.id} className="user-event-feature">
                <Link
                  aria-label={`Apri dettagli attività: ${event.title}`}
                  className="user-event-feature__media"
                  to={`/activities/${event.id}`}
                >
                  {event.heroImageUrl ? (
                    <div
                      className="user-event-feature__poster"
                      style={{ backgroundImage: `url(${event.heroImageUrl})` }}
                    />
                  ) : (
                    <div className="user-event-feature__poster user-event-feature__poster--fallback">
                      <AppIcon name="ticket" />
                    </div>
                  )}
                </Link>

                <div className="user-event-feature__body">
                  <div className="chip-row">
                    <StatusBadge
                      label={getEventStatusLabel(event.status)}
                      tone={getEventStatusTone(event.status)}
                    />
                    <span className="surface-chip">{getEventAudienceLabel(event.audience)}</span>
                    <span className="surface-chip">Iscritto</span>
                  </div>

                  <Link className="user-event-feature__title" to={`/activities/${event.id}`}>
                    <h3>{event.title}</h3>
                  </Link>

                  <p className="user-event-feature__meta">{formatEventWindow(event)}</p>
                  <p className="user-event-feature__meta">{event.location}</p>

                  <div className="user-event-feature__actions">
                    <Link className="button button--primary button--small" to={`/activities/${event.id}`}>
                      Dettagli attività
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="user-dashboard-section">
        <div className="user-section-heading">
          <h2>Dalle attività</h2>
          <p className="subtle-text">
            Ultime novità e gallerie dello stake.
          </p>
        </div>
        <HomeFeed />
      </section>
    </div>
  );
}
