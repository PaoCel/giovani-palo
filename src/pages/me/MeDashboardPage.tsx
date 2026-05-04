import { Link } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { UserPageIntro } from "@/components/UserPageIntro";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
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
  const surveyCandidates = feed
    .filter(({ event }) => isPastEvent(event))
    .slice(0, 6);

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

      <section className="card user-spotlight">
        <div className="user-section-heading">
          <h2>La prossima attività programmata a cui parteciperai</h2>
        </div>

        {loading ? (
          <p className="subtle-text">Sto caricando le prossime attività...</p>
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
        )}
      </section>

      {surveyCandidates.length > 0 ? (
        <section className="card">
          <div className="user-section-heading">
            <h2>Sondaggi e galleria</h2>
            <p className="subtle-text">
              Lasciaci un feedback (anonimo) o sblocca le foto delle attività passate.
            </p>
          </div>
          <div className="stack">
            {surveyCandidates.map(({ event }) => (
              <article key={event.id} className="surface-panel surface-panel--subtle">
                <strong>{event.title}</strong>
                <p className="subtle-text">{formatEventWindow(event)}</p>
                <div className="chip-row">
                  <Link
                    className="button button--ghost button--small"
                    to={`/me/sondaggi/${event.id}`}
                  >
                    Sondaggio
                  </Link>
                  {event.galleryAccessCode ? (
                    <Link
                      className="button button--ghost button--small"
                      to={`/me/galleria/${event.id}`}
                    >
                      Galleria
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
