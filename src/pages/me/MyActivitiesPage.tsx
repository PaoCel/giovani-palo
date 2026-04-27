import { EmptyState } from "@/components/EmptyState";
import { EventCard } from "@/components/EventCard";
import { UserPageIntro } from "@/components/UserPageIntro";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import { isPastEvent } from "@/utils/events";

export function MyActivitiesPage() {
  const { session } = useAuth();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "none";
  const { data: feed, loading, error } = useAsyncData(
    () => userActivitiesService.listStakeActivityFeed(session),
    [sessionKey],
    [],
  );

  return (
    <div className="page">
      <UserPageIntro />

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Caricamento attività non riuscito</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="activity-grid activity-grid--loading">
          <p className="subtle-text">Sto caricando le attività...</p>
        </div>
      ) : feed.length === 0 ? (
        <section className="card">
          <EmptyState
            title="Nessuna attività disponibile"
            description="Quando saranno disponibili nuove attività, compariranno qui."
          />
        </section>
      ) : (
        <section className="activity-catalog activity-catalog--user">
          <div className="activity-grid">
            {feed.map(({ event, registration }) => {
              const hasActiveRegistration =
                Boolean(registration) && registration?.registrationStatus !== "cancelled";
              const canJoin =
                !hasActiveRegistration &&
                event.status === "registrations_open" &&
                !isPastEvent(event);

              return (
                <EventCard
                  key={event.id}
                  event={event}
                  primaryLabel="Dettagli attività"
                  primaryTo={`/activities/${event.id}`}
                  secondaryLabel={
                    hasActiveRegistration
                      ? "La tua iscrizione"
                      : canJoin
                        ? "Iscriviti"
                        : undefined
                  }
                  secondaryTo={
                    hasActiveRegistration
                      ? `/me/activities/${event.id}`
                      : canJoin
                        ? `/activities/${event.id}/register`
                        : undefined
                  }
                  variant="poster"
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
