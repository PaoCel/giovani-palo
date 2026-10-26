import { Link, Navigate } from "react-router-dom";

import { AppLoader } from "@/components/AppLoader";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useStakeMembership } from "@/hooks/useStakeMembership";
import { resolveLatestCampWithGallery, type CampHighlight } from "@/utils/campHighlight";
import { DEFAULT_STAKE_ID } from "@/config/app";
import { lockedMessageOf } from "@/utils/stakeMembership";


/** /campeggio senza id: manda all'ultimo campeggio con galleria. */
export function CampIndexPage() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId || DEFAULT_STAKE_ID;
  // La galleria è dei membri: per gli altri la lettura non parte.
  const { access } = useStakeMembership(stakeId);
  const isMember = access === "member";

  const { data: highlight, loading } = useAsyncData<CampHighlight | null>(
    () => (isMember ? resolveLatestCampWithGallery(stakeId) : Promise.resolve(null)),
    [stakeId, isMember],
    null,
  );
  const locked = lockedMessageOf(access, "foto");

  if (locked) {
    return (
      <div className="page">
        <EmptyState title="Nessun campeggio disponibile" description={locked} />
      </div>
    );
  }

  if (access === "loading" || loading) {
    return <AppLoader label="Cerco il campeggio..." />;
  }

  if (highlight) {
    return <Navigate replace to={`/campeggio/${highlight.event.id}`} />;
  }

  return (
    <div className="page">
      <EmptyState
        title="Nessun campeggio disponibile"
        description="Quando ci saranno foto o un sondaggio del campeggio li troverai qui."
      />
    </div>
  );
}
