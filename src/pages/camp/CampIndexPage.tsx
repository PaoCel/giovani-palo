import { Link, Navigate } from "react-router-dom";

import { AppLoader } from "@/components/AppLoader";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { resolveLatestCampWithGallery, type CampHighlight } from "@/utils/campHighlight";

const DEFAULT_STAKE_ID = "roma-est";

/** /campeggio senza id: manda all'ultimo campeggio con galleria. */
export function CampIndexPage() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId || DEFAULT_STAKE_ID;

  const { data: highlight, loading } = useAsyncData<CampHighlight | null>(
    () => resolveLatestCampWithGallery(stakeId),
    [stakeId],
    null,
  );

  if (loading) {
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
