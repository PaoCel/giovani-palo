import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { AppLoader } from "@/components/AppLoader";
import { AuthCredentialsForm } from "@/components/auth/AuthCredentialsForm";
import { SurveyAnswerView } from "@/components/survey/SurveyAnswerView";
import { SONDAGGIO } from "@/copy/sondaggio";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { eventsService } from "@/services/firestore/eventsService";
import { toUserFacingAuthError } from "@/services/firebase/debug";
import { getSurveyBySlug } from "@/utils/surveyLinks";
import "@/styles/survey.css";

export function SurveyPage() {
  const { surveySlug = "" } = useParams();
  const survey = getSurveyBySlug(surveySlug);
  const { loading, session, signInAnonymously } = useAuth();
  const [params, setParams] = useSearchParams();
  const [guestBusy, setGuestBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: event, loading: eventLoading, error: eventError, reload } = useAsyncData(
    () => survey ? eventsService.getPublicEventById(survey.stakeId, survey.eventId) : Promise.resolve(null),
    [survey?.eventId], null,
  );
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.append(meta);
    return () => meta.remove();
  }, []);
  const canAnswer = Boolean(session?.isAuthenticated ||
    (session?.isAnonymous && params.get("accesso") === "ospite" && event?.surveyGuestEnabled));
  const activityHref = survey ? `/activities/${survey.eventId}` : "/activities";

  async function enterAsGuest() {
    if (guestBusy || authBusy || !event?.surveyGuestEnabled || session?.isAuthenticated) return;
    setGuestBusy(true);
    setError(null);
    try {
      if (!session?.isAnonymous) await signInAnonymously();
      setParams({ accesso: "ospite" });
    } catch (caught) {
      setError(toUserFacingAuthError(caught));
    } finally {
      setGuestBusy(false);
    }
  }

  if (session?.isAuthenticated && session.profile.mustChangePassword) {
    return <Navigate replace to="/password-reset" />;
  }

  return <main className="survey-page">
    <Link className="survey-brand" to="/"><img src="/brand-logo.png" alt="" />{SONDAGGIO.marchio}</Link>
    <header className="survey-intro">
      <span className="survey-eyebrow">{SONDAGGIO.occhiello}</span>
      <h1>{SONDAGGIO.titolo}</h1>
      <p>{SONDAGGIO.attivita}</p>
      <span className="survey-anonymous">{SONDAGGIO.anonimato}</span>
    </header>
    {loading || eventLoading ? <AppLoader label={SONDAGGIO.attendi} /> : eventError ? (
      <section className="survey-card"><p role="alert">{SONDAGGIO.erroreCaricamento}</p><button className="button" onClick={reload}>Riprova</button></section>
    ) : !survey || !event ? (
      <section className="survey-card"><h2>{SONDAGGIO.nonTrovato}</h2><p>{SONDAGGIO.nonTrovatoDescrizione}</p></section>
    ) : canAnswer ? (
      <SurveyAnswerView stakeId={survey.stakeId} eventId={survey.eventId} showHero={false}
        backHref={activityHref} backLabel={SONDAGGIO.tornaAttivita} />
    ) : <>
      <div className="survey-card">
        <AuthCredentialsForm compactLogin initialMode="login" disabled={guestBusy} onBusyChange={setAuthBusy}
          titles={{ login: SONDAGGIO.accountTitolo, signup: SONDAGGIO.accountTitolo }}
          leads={{ login: SONDAGGIO.accountDescrizione, signup: SONDAGGIO.accountDescrizione }} />
      </div>
      {event.surveyGuestEnabled ? <section className="survey-card survey-guest">
        <h2>{SONDAGGIO.ospiteTitolo}</h2><p>{SONDAGGIO.ospiteDescrizione}</p>
        <button className="survey-guest-choice" disabled={guestBusy || authBusy} onClick={() => void enterAsGuest()}>
          {guestBusy ? SONDAGGIO.attendi : SONDAGGIO.ospiteAzione}
        </button>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </section> : null}
    </>}
    <Link className="survey-back" to={activityHref}>
      {survey ? SONDAGGIO.tornaAttivita : SONDAGGIO.tornaAttivitaElenco}
    </Link>
  </main>;
}
