import { Link } from "react-router-dom";

import "@/styles/homeSocial.css";
import giovani from "@/assets/flusso-genitore/giovani.webp";
import { AppIcon } from "@/components/AppIcon";
import { FamilyHomeSection } from "@/components/family/FamilyHomeSection";
import { MembershipBanner } from "@/components/membership/MembershipBanner";
import { ActivityMediaHighlight } from "@/components/gallery/ActivityMediaHighlight";
import { ActivityMediaCard } from "@/components/gallery/ActivityMediaCard";
import { HomeFeed } from "@/components/feed/HomeFeed";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useStakeMembership } from "@/hooks/useStakeMembership";
import { surveysService } from "@/services/firestore/surveysService";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import { getActivityPath, getActivityRegistrationPath, getMyActivityPath } from "@/utils/activityLinks";
import { getSurveyHref } from "@/utils/surveyLinks";
import { formatEventWindow } from "@/utils/formatters";
import { getEffectiveEventStatus, isPastEvent } from "@/utils/events";
import { getRegistrationStatusLabel, getRegistrationStatusTone } from "@/utils/registrations";
import { isGalleryUploadOpen } from "@/utils/galleryWindow";

function getFirstName(session: ReturnType<typeof useAuth>["session"]): string {
  const full = session?.profile.fullName?.trim();
  if (full && full !== "Partecipante" && full !== "Ospite anonimo") return full.split(/\s+/)[0];
  return session?.firebaseUser.displayName?.trim().split(/\s+/)[0] ?? "";
}

export function MeDashboardPage() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}:${stakeId}` : "none";
  // Key the result as well as the request: a context change cannot render the
  // previous person's registration while the next request is still loading.
  const { data: result, loading, error, reload } = useAsyncData(
    async () => ({ key: sessionKey, items: await userActivitiesService.listStakeActivityFeed(session) }),
    [sessionKey], { key: "", items: [] as Awaited<ReturnType<typeof userActivitiesService.listStakeActivityFeed>> },
  );
  const feed = result.key === sessionKey ? result.items : [];
  const upcoming = feed.find(({ event, registration }) => !isPastEvent(event) && event.status !== "cancelled" && event.status !== "completed" &&
    ((Boolean(registration) && registration?.registrationStatus !== "cancelled") || getEffectiveEventStatus(event) === "registrations_open"));
  const pastEvents = feed.filter(({ event }) => isPastEvent(event)).slice(0, 6);
  const { access } = useStakeMembership(stakeId);
  const isMember = access === "member";
  const pastIdsKey = pastEvents.map(({ event }) => event.id).join(",");
  const { data: surveyResult } = useAsyncData(
    async () => {
      if (!isMember || !stakeId) return { key: sessionKey, ids: [] as string[] };
      const results = await Promise.all(pastEvents.map(async ({ event }) => ({ id: event.id, has: (await surveysService.listActiveQuestions(stakeId, event.id)).length > 0 })));
      return { key: sessionKey, ids: results.filter(item => item.has).map(item => item.id) };
    }, [pastIdsKey, stakeId, isMember, sessionKey], { key: "", ids: [] as string[] },
  );
  const surveyCandidates = isMember && surveyResult.key === sessionKey ? pastEvents.filter(({ event }) => surveyResult.ids.includes(event.id)) : [];
  const firstName = getFirstName(session);
  const event = upcoming?.event;
  const registration = upcoming?.registration;
  const registered = Boolean(registration) && registration?.registrationStatus !== "cancelled";
  const opens = event ? getEffectiveEventStatus(event) === "registrations_open" : false;
  const primaryTo = event ? registered ? getMyActivityPath(event.id) : opens ? getActivityRegistrationPath(event.id, stakeId) : getActivityPath(event.id, stakeId) : "/me/activities";
  const primaryLabel = registered ? "Dettagli attività" : opens ? "Iscriviti" : "Dettagli attività";
  const mergedMedia = event && isGalleryUploadOpen(event, null) ? event : null;

  return <div className="page social-home">
    <nav className="social-home-nav" aria-label="Navigazione Home">
      <span className="social-eyebrow">Il tuo palo</span><h2>Ci vediamo qui.</h2>
      <Link className="is-active" to="/me" aria-current="page"><AppIcon name="home" />Home</Link>
      <Link to="/me/calendar"><AppIcon name="calendar" />Calendario</Link>
      <Link to="/me/activities"><AppIcon name="list" />Attività</Link>
      <Link to="/me/profile"><AppIcon name="user" />Profilo</Link>
      <img src={giovani} alt="" /><p>Le attività passano.<br />I ricordi restano.</p>
    </nav>

    <header className="social-home-intro">
      <span className="social-eyebrow">La tua area giovani</span>
      <h1>{firstName ? <>Ciao, <span>{firstName}</span>.</> : "La tua area"}</h1>
      <p>Le novità e i ricordi delle nostre attività.</p>
      <MembershipBanner />
    </header>

    <aside className="social-home-next" aria-label="La tua prossima attività">
      {error ? <div className="notice notice--warning" role="alert"><p>Non riesco a leggere le attività.</p><button className="button button--soft" type="button" onClick={reload}>Riprova</button></div> : null}
      {loading && !event ? <div className="social-skeleton" role="status" aria-label="Carico la prossima attività"><span /><span /></div> : event ? <>
        <article className="social-next-card">
          <div className="social-next-copy"><span className="social-eyebrow">La tua prossima attività</span>
            <h2>{event.title}</h2><p>{formatEventWindow(event)}</p><p>{event.location}</p>
            {registration ? <StatusBadge label={getRegistrationStatusLabel(registration.registrationStatus)} tone={getRegistrationStatusTone(registration.registrationStatus)} /> : <span className="social-next-status">Iscrizioni aperte</span>}
            <Link className="social-next-action" to={primaryTo}>{primaryLabel}<span aria-hidden="true">↗</span></Link>
          </div><img className="social-next-art" src={giovani} alt="" />
        </article>
        {mergedMedia ? <ActivityMediaCard key={`${sessionKey}:${event.id}`} stakeId={stakeId} event={event} className="social-next-media" /> : null}
      </> : !error ? <div className="social-next-empty"><h2>La prossima occasione per ritrovarci</h2><p>Quando ci sarà una nuova attività la troverai qui.</p><Link to="/me/activities">Apri attività <span aria-hidden="true">↗</span></Link></div> : null}
    </aside>

    <div className="social-home-stream">
      <FamilyHomeSection />
      <ActivityMediaHighlight excludeActivityId={mergedMedia?.id} />
      <section aria-labelledby="social-feed-title">
        <div className="social-section-heading"><div><span className="social-eyebrow">La vita del palo</span><h2 id="social-feed-title">Dalle attività</h2></div><span className="social-private"><AppIcon name="lock" />Nel tuo palo</span></div>
        <HomeFeed key={sessionKey} />
      </section>
    </div>

    <aside className="social-home-notes">
      {surveyCandidates.length > 0 ? <section className="social-feedback"><span className="social-eyebrow">Dopo l'attività</span><h2>Ci racconti com'è andata?</h2><p>Un feedback anonimo ci aiuta a migliorare le prossime.</p>
        {surveyCandidates.map(({ event: past }) => <Link key={past.id} to={getSurveyHref(past.id)}>{past.title}<span aria-hidden="true">↗</span></Link>)}
      </section> : <div className="social-quiet-note"><span className="social-eyebrow">Il tuo spazio</span><h2>Da una foto,<br />un altro ricordo.</h2><p>Apri la galleria dell'attività per vedere le foto, commentarle o aggiungere le tue.</p></div>}
    </aside>
  </div>;
}
