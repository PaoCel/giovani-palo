import { useMemo } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { ShareButton } from "@/components/ShareButton";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { stakesService } from "@/services/firestore/stakesService";
import { getAbsoluteUrl, getActivitiesPath } from "@/utils/activityLinks";
import { getStoredPublicStakeId, storePublicStakeId } from "@/utils/stakeSelection";

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
    <div className="page page--home">
      <section className="home-hero">
        <p className="home-hero__eyebrow">Giovani Uomini &amp; Giovani Donne · Italia</p>
        <h1 className="home-hero__title">Le attività dei giovani, in un unico posto</h1>
        <p className="home-hero__subtitle">
          Scopri le prossime attività del tuo palo e iscriviti in pochi minuti.
          Funziona anche senza account: con un profilo ritrovi tutto più in fretta.
        </p>

        <div className="home-hero__actions">
          <button
            className="button button--inverse button--large"
            onClick={handleExploreActivities}
            type="button"
          >
            <AppIcon name="ticket" />
            <span>Scopri le attività</span>
          </button>

          <Link className="button button--outline-light button--large" to="/login">
            <AppIcon name="user" />
            <span>Accedi o crea un account</span>
          </Link>
        </div>
      </section>

      <section className="home-screen">
        <div className="home-quicklinks">
          <ShareButton
            className="button button--soft button--small"
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

        <p className="home-screen__privacy">
          I dati richiesti vengono usati solo per gestire iscrizioni, presenze e
          comunicazioni legate all&apos;attività scelta.
        </p>
      </section>
    </div>
  );
}
