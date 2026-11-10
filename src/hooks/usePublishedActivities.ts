import { useMemo } from "react";

import { usePublicStake } from "@/components/publicSite/PublicStakeProvider";
import { useAsyncData } from "@/hooks/useAsyncData";
import { eventsService } from "@/services/firestore/eventsService";

/** Attività pubblicate del palo scelto, oppure di tutti i pali se non c'è scelta. */
export function usePublishedActivities(stakeId: string) {
  const { stakes, ready } = usePublicStake();
  const ids = useMemo(() => {
    if (!ready) {
      return [];
    }

    return stakeId ? [stakeId] : stakes.map((stake) => stake.id);
  }, [ready, stakeId, stakes]);
  const key = ids.join("|");
  const result = useAsyncData(
    () => (ready ? eventsService.listPublicEventsForStakes(ids) : Promise.resolve([])),
    [key, ready],
    [],
  );

  return {
    events: result.data,
    error: result.error,
    loading: !ready || result.loading,
  };
}
