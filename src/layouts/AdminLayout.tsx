import { TESTATA } from "@/copy/testata";
import { useAuth } from "@/hooks/useAuth";
import { usePendingRequestCount } from "@/hooks/useStakeMembership";
import { ShellLayout, type LayoutLink } from "@/layouts/ShellLayout";

export function AdminLayout() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  // Richieste di accesso in attesa (docs/APPARTENENZA_AL_PALO.md, «Client della fase 3»).
  const pending = usePendingRequestCount(stakeId, null, Boolean(session?.isAdmin && stakeId));

  const home: LayoutLink = { to: "/admin", label: "Home", end: true, icon: "home" };
  const events: LayoutLink = { to: "/admin/events", label: "Attività", icon: "ticket" };
  const people: LayoutLink = { to: "/admin/persone", label: "Persone", icon: "users", badge: pending };
  const calendar: LayoutLink = { to: "/admin/calendar", label: "Calendario", icon: "calendar" };
  const galleries: LayoutLink = { to: "/admin/galleries", label: "Gallerie", icon: "sparkles" };
  const feed: LayoutLink = { to: "/admin/feed", label: "Feed", icon: "bell" };
  const more: LayoutLink = { to: "/admin/settings", label: "Altro", icon: "menu" };

  // Scelta di Paolo del 3 novembre 2026 (docs/REDESIGN_BRIEF.md): su telefono
  // cinque voci con etichetta, Gallerie e Feed dentro Altro (che resta acceso
  // su quelle pagine); a desktop tutte e sette nella barra laterale.
  return (
    <ShellLayout
      area="admin"
      brandLabel={session?.profile.stakeName || TESTATA.ilMioPalo}
      links={[
        home,
        events,
        people,
        calendar,
        { ...more, alsoActive: ["/admin/galleries", "/admin/feed", "/admin/stats", "/admin/registrations"] },
      ]}
      railLinks={[home, events, people, calendar, galleries, feed, { ...more, alsoActive: ["/admin/stats", "/admin/registrations"] }]}
    />
  );
}
