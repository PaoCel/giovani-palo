import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { useAsyncData } from "@/hooks/useAsyncData";
import { stakesService } from "@/services/firestore/stakesService";
import type { StakeSummary } from "@/types";
import { resolvePublicCatalogStakeId } from "@/utils/publicCatalog";
import { getStoredPublicStakeId, storePublicStakeId } from "@/utils/stakeSelection";

interface PublicStakeContextValue {
  stakes: StakeSummary[];
  ready: boolean;
  /** Stringa vuota: tutta Italia. */
  stakeId: string;
  stakeName: string;
  /** Ricorda la scelta. Su /activities aggiorna anche l'indirizzo. */
  selectStake: (stakeId: string, extraDeletes?: readonly string[]) => void;
}

const PublicStakeContext = createContext<PublicStakeContextValue | null>(null);

export function PublicStakeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: stakes, loading } = useAsyncData(() => stakesService.listActiveStakes(), [], []);
  const [override, setOverride] = useState<string | null>(null);
  const ready = !loading;
  const onActivities = location.pathname === "/activities";
  const requested = onActivities ? searchParams.get("stake") : null;
  const stored = override ?? getStoredPublicStakeId();
  const activeIds = useMemo(() => stakes.map((stake) => stake.id), [stakes]);
  const stakeId = resolvePublicCatalogStakeId(requested, stored, ready ? activeIds : null);
  const stakeName = stakes.find((stake) => stake.id === stakeId)?.name ?? "";

  useEffect(() => {
    if (getStoredPublicStakeId() === stakeId) {
      return;
    }

    storePublicStakeId(stakeId);
  }, [stakeId]);

  const value = useMemo<PublicStakeContextValue>(
    () => ({
      stakes,
      ready,
      stakeId,
      stakeName,
      selectStake: (nextStakeId, extraDeletes = []) => {
        storePublicStakeId(nextStakeId);
        setOverride(nextStakeId);

        if (location.pathname !== "/activities") {
          return;
        }

        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);

            if (nextStakeId) {
              next.set("stake", nextStakeId);
            } else {
              next.delete("stake");
            }

            for (const key of extraDeletes) {
              next.delete(key);
            }

            return next;
          },
          { replace: true },
        );
      },
    }),
    [location.pathname, ready, setSearchParams, stakeId, stakeName, stakes],
  );

  return <PublicStakeContext.Provider value={value}>{children}</PublicStakeContext.Provider>;
}

export function usePublicStake() {
  const value = useContext(PublicStakeContext);

  if (!value) {
    throw new Error("usePublicStake va usato dentro PublicStakeProvider.");
  }

  return value;
}
