import { useMemo } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { ShareButton } from "@/components/ShareButton";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { stakesService } from "@/services/firestore/stakesService";
import { getAbsoluteUrl, getActivitiesPath } from "@/utils/activityLinks";
import { getStoredPublicStakeId, storePublicStakeId } from "@/utils/stakeSelection";

const STEPS: { icon: "calendar" | "ticket" | "sparkles"; title: string; body: string }[] = [
  {
    icon: "calendar",
    title: "Scopri",
    body: "Il calendario e i dettagli di ogni attività del tuo palo, sempre aggiornati.",
  },
  {
    icon: "ticket",
    title: "Iscriviti",
    body: "In pochi minuti, anche senza account. Per i minori il consenso è integrato.",
  },
  {
    icon: "sparkles",
    title: "Ritrova",
    body: "Con un profilo ritrovi iscrizioni, foto del campeggio e sondaggi in un posto solo.",
  },
];

export function HomePage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { data: stakes } = useAsyncData(() => stakesService.listActiveStakes(), [], []);
  const selectedStakeId = useMemo(() => {
    const storedStakeId = getStoredPublicStakeId();

    if (storedStakeId && stakes.some((stake) => stake.id === storedStakeId)) {
      return storedStakeId;
    }

    return stakes[0]?.id ?? "";
  }, [stakes]);

  if (session?.isAuthenticated && !session.isAnonymous) {
    return (
      <Navigate
        replace
        to={
          session.profile.mustChangePassword
            ? "/password-reset"
            : session.isAdmin
              ? "/admin"
              : "/me"
        }
      />
    );
  }

  function handleExploreActivities() {
    if (selectedStakeId) {
      storePublicStakeId(selectedStakeId);
      navigate(getActivitiesPath(selectedStakeId));
      return;
    }

    navigate("/activities");
  }

  return (
    <div className="page landing">
      <section className="landing-hero">
        <span className="landing-hero__eyebrow">Giovani Uomini &amp; Giovani Donne · Italia</span>
        <h1 className="landing-hero__title">
          Le attività dei giovani,
          <span className="landing-hero__title-accent"> in un unico posto.</span>
        </h1>
        <p className="landing-hero__sub">
          Scopri le prossime attività del tuo palo e iscriviti in pochi minuti.
          Funziona anche senza account — con un profilo ritrovi tutto più in fretta.
        </p>

        <div className="landing-hero__actions">
          <button
            className="button button--primary button--large"
            onClick={handleExploreActivities}
            type="button"
          >
            <AppIcon name="ticket" />
            <span>Scopri le attività</span>
          </button>
          <Link className="button button--soft button--large" to="/login">
            <AppIcon name="user" />
            <span>Accedi o crea un account</span>
          </Link>
        </div>
      </section>

      <section className="landing-steps" aria-label="Come funziona">
        {STEPS.map((step, index) => (
          <article key={step.title} className="landing-step">
            <span className="landing-step__index">{String(index + 1).padStart(2, "0")}</span>
            <span className="landing-step__icon" aria-hidden="true">
              <AppIcon name={step.icon} />
            </span>
            <h2 className="landing-step__title">{step.title}</h2>
            <p className="landing-step__body">{step.body}</p>
          </article>
        ))}
      </section>

      <footer className="landing-foot">
        <div className="landing-foot__actions">
          <ShareButton
            className="button button--ghost button--small"
            label="Condividi il sito"
            text="Apri il sito delle attività giovani."
            title="Attività giovani"
            url={getAbsoluteUrl(getActivitiesPath(selectedStakeId))}
          />
          <Link className="button button--ghost button--small" to="/privacy">
            <AppIcon name="lock" />
            <span>Informativa privacy</span>
          </Link>
        </div>
        <p className="landing-foot__note">
          I dati richiesti vengono usati solo per gestire iscrizioni, presenze e
          comunicazioni legate all&apos;attività scelta.
        </p>
      </footer>
    </div>
  );
}
