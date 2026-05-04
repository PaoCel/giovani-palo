import { useMemo } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { HomeFeed } from "@/components/HomeFeed";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { stakesService } from "@/services/firestore/stakesService";
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
      navigate(`/activities?stake=${encodeURIComponent(selectedStakeId)}`);
      return;
    }

    navigate("/activities");
  }

  return (
    <div className="page page--home">
      <section className="home-screen">
        <div className="home-screen__copy">
          <h1 className="home-screen__title">Benvenuto</h1>
          <p className="home-screen__description">
            Puoi iscriverti anche senza creare un account, ma avere un profilo ti aiuta a
            velocizzare il processo e ritrovare più facilmente le attività.
          </p>
        </div>

        <div className="home-screen__actions">
          <button className="button button--primary button--large" onClick={handleExploreActivities} type="button">
            <AppIcon name="ticket" />
            <span>Iscriviti a un&apos;attività</span>
          </button>

          <Link className="button button--ghost button--large" to="/login">
            <AppIcon name="user" />
            <span>Accedi o crea un&apos;account</span>
          </Link>
        </div>

        <p className="home-screen__privacy">
          <AppIcon name="lock" />
          <span>
            <Link to="/privacy">Informativa privacy</Link>: i dati richiesti vengono usati solo
            per gestire iscrizioni, presenze e comunicazioni legate all&apos;attivita scelta.
          </span>
        </p>
      </section>

      {selectedStakeId ? (
        <section className="card">
          <h2>Dalle attività</h2>
          <HomeFeed stakeId={selectedStakeId} signedIn={false} />
        </section>
      ) : null}
    </div>
  );
}
