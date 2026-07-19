import { Link } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { ShareButton } from "@/components/ShareButton";
import { CampHighlightCard } from "@/components/camp/CampHighlightCard";
import { HomeFeed } from "@/components/feed/HomeFeed";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { surveysService } from "@/services/firestore/surveysService";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import {
  getAbsoluteUrl,
  getActivitiesPath,
  getActivityRegistrationPath,
  getMyActivityPath,
} from "@/utils/activityLinks";
import { formatEventWindow } from "@/utils/formatters";
import {
  getEventAudienceLabel,
  getEventStatusLabel,
  getEventStatusTone,
  isPastEvent,
} from "@/utils/events";

function getFirstName(session: ReturnType<typeof useAuth>["session"]): string {
  const full = session?.profile.fullName?.trim();
  if (full && full !== "Partecipante" && full !== "Ospite anonimo") {
    return full.split(/\s+/)[0];
  }
  const display = session?.firebaseUser.displayName?.trim();
  if (display) return display.split(/\s+/)[0];
  const email = session?.firebaseUser.email || session?.profile.email;
  if (email) return email.split("@")[0];
  return "";
}

export function MeDashboardPage() {
  const { session } = useAuth();
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "none";

  const { data: feed, loading, error } = useAsyncData(
    () => userActivitiesService.listStakeActivityFeed(session),
    [sessionKey],
    [],
  );
  const featuredActivities = feed.filter(({ event, registration }) => {
    if (isPastEvent(event)) {
      return false;
    }

    if (registration && registration.registrationStatus !== "cancelled") {
      return true;
    }

    return event.status === "registrations_open";
  });
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
  const firstName = getFirstName(session);

  return (
    <div className="page dash">
      <header className="dash-head">
        <div className="dash-head__text">
          <span className="dash-head__eyebrow">La tua area giovani</span>
          <h1 className="dash-head__title">
            {firstName ? (
              <>
                Ciao, <span className="dash-head__name">{firstName}</span>
              </>
            ) : (
              "La tua area"
            )}
          </h1>
          <p className="dash-head__sub">Le tue attività, i ricordi e i sondaggi — tutto qui.</p>
        </div>
        <ShareButton
          iconOnly
          className="dash-head__share"
          label="Condividi il sito"
          text="Apri il sito delle attività giovani."
          title="Attività giovani"
          url={getAbsoluteUrl(getActivitiesPath(session?.profile.stakeId))}
        />
      </header>

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Impossibile leggere le attività</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {/* Focus principale: la prossima attività (un solo hero immersivo). */}
      <section className="dash-section">
        <div className="dash-section__head">
          <span className="dash-section__eyebrow">In evidenza</span>
          <h2 className="dash-section__title">La tua prossima attività</h2>
        </div>

        {loading ? (
          <div className="dash-card dash-card--placeholder">
            <p className="subtle-text">Sto caricando le prossime attività…</p>
          </div>
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
          <div className="dash-feature-stack">
            {featuredActivities.slice(0, 2).map(({ event, registration }, index) => {
              const hasActiveRegistration =
                Boolean(registration) && registration?.registrationStatus !== "cancelled";
              const primaryTo = hasActiveRegistration
                ? getMyActivityPath(event.id)
                : getActivityRegistrationPath(event.id, session?.profile.stakeId);
              const primaryLabel = hasActiveRegistration ? "Dettagli attività" : "Iscriviti";

              return (
                <article
                  key={event.id}
                  className={
                    index === 0
                      ? "user-event-feature user-event-feature--hero"
                      : "user-event-feature"
                  }
                >
                  <Link
                    aria-label={`${primaryLabel}: ${event.title}`}
                    className="user-event-feature__media"
                    to={primaryTo}
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
                      <span className="surface-chip">
                        {hasActiveRegistration ? "Iscritto" : "Da iscrivere"}
                      </span>
                    </div>

                    <Link className="user-event-feature__title" to={primaryTo}>
                      <h3>{event.title}</h3>
                    </Link>

                    <p className="user-event-feature__meta">{formatEventWindow(event)}</p>
                    <p className="user-event-feature__meta">{event.location}</p>

                    <div className="user-event-feature__actions">
                      <Link className="button button--primary button--small" to={primaryTo}>
                        {primaryLabel}
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Campeggio (foto/video) — card calma, gestisce da sé la visibilità. */}
      <CampHighlightCard />

      {surveyCandidates.length > 0 ? (
        <section className="dash-section">
          <div className="dash-section__head">
            <span className="dash-section__eyebrow">Feedback</span>
            <h2 className="dash-section__title">Sondaggi delle attività passate</h2>
            <p className="dash-section__sub">Un feedback anonimo ci aiuta a migliorare le prossime.</p>
          </div>
          <div className="dash-list">
            {surveyCandidates.map(({ event }) => (
              <article key={event.id} className="dash-list-row">
                <div className="dash-list-row__text">
                  <strong>{event.title}</strong>
                  <span className="subtle-text">{formatEventWindow(event)}</span>
                </div>
                <Link
                  className="button button--soft button--small"
                  to={`/me/sondaggi/${event.id}`}
                >
                  Compila
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="dash-section">
        <div className="dash-section__head">
          <span className="dash-section__eyebrow">Novità</span>
          <h2 className="dash-section__title">Dalle attività</h2>
          <p className="dash-section__sub">Ultime novità e gallerie dello stake.</p>
        </div>
        <HomeFeed />
      </section>
    </div>
  );
}
