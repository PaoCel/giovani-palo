import { EmptyState } from "@/components/EmptyState";
import { PublicActivityCard } from "@/components/activities/PublicActivityCard";
import { UserPageIntro } from "@/components/UserPageIntro";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import { getActivityPath, getMyActivityPath } from "@/utils/activityLinks";
import { getPublicEventPhase } from "@/utils/publicEventState";
import { getRegistrationStatusLabel, getRegistrationStatusTone } from "@/utils/registrations";

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
          <div className="public-grid">
            {feed.map(({ event, registration }) => {
              const activeRegistration =
                registration && registration.registrationStatus !== "cancelled" ? registration : null;

              // Iscritto: la card porta alla sua scheda e dice lo stato dell'iscrizione
              // (ma un'attività annullata resta «Annullata»); altrimenti al dettaglio,
              // dove sta «Iscriviti».
              const showRegistration =
                activeRegistration && getPublicEventPhase(event) !== "cancelled";
              return (
                <PublicActivityCard
                  event={event}
                  key={event.id}
                  status={
                    showRegistration && activeRegistration
                      ? {
                          label: getRegistrationStatusLabel(activeRegistration.registrationStatus),
                          tone: getRegistrationStatusTone(activeRegistration.registrationStatus),
                        }
                      : undefined
                  }
                  to={
                    activeRegistration
                      ? getMyActivityPath(event.id)
                      : getActivityPath(event.id, session?.profile.stakeId)
                  }
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
