import { ShellLayout } from "@/layouts/ShellLayout";
import { useAuth } from "@/hooks/useAuth";

export function UnitLeaderLayout() {
  const { session } = useAuth();
  const unitName = session?.profile.unitName || "La mia unità";

  return (
    <ShellLayout
      area="unit"
      eyebrow={unitName}
      links={[
        { to: "/unit", label: "Dashboard", end: true, icon: "home" },
      ]}
    />
  );
}
