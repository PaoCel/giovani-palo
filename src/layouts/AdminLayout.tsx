import { useAuth } from "@/hooks/useAuth";
import { usePendingRequestCount } from "@/hooks/useStakeMembership";
import { ShellLayout } from "@/layouts/ShellLayout";

export function AdminLayout() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  // Richieste di accesso in attesa (docs/APPARTENENZA_AL_PALO.md, «Client della fase 3»).
  const pending = usePendingRequestCount(stakeId, null, Boolean(session?.isAdmin && stakeId));

  return (
    <ShellLayout
      area="admin"
      links={[
        { to: "/admin", label: "Dashboard", end: true, icon: "home" },
        { to: "/admin/events", label: "Attività", icon: "ticket" },
        { to: "/admin/persone", label: "Persone", icon: "users", badge: pending },
        { to: "/admin/calendar", label: "Calendario", icon: "calendar" },
        { to: "/admin/galleries", label: "Gallerie", icon: "sparkles" },
        { to: "/admin/feed", label: "Feed", icon: "bell" },
        { to: "/admin/settings", label: "Altro", icon: "menu" },
      ]}
    />
  );
}
