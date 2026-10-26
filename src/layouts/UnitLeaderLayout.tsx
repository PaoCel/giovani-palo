import { ShellLayout } from "@/layouts/ShellLayout";
import { useAuth } from "@/hooks/useAuth";
import { usePendingRequestCount } from "@/hooks/useStakeMembership";

export function UnitLeaderLayout() {
  const { session } = useAuth();
  const unitName = session?.profile.unitName || "La mia unità";
  const stakeId = session?.profile.stakeId ?? "";
  const unitId = session?.profile.unitId ?? "";
  // Richieste di chi ha dichiarato la sua unità (le rules negano le altre).
  const pending = usePendingRequestCount(stakeId, unitId, Boolean(session?.isUnitLeader && stakeId && unitId));

  return (
    <ShellLayout
      area="unit"
      eyebrow={unitName}
      links={[
        { to: "/unit", label: "Dashboard", end: true, icon: "home" },
        { to: "/unit/persone", label: "Persone", icon: "users", badge: pending },
      ]}
    />
  );
}
