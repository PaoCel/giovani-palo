import { ShellLayout } from "@/layouts/ShellLayout";

export function AdminLayout() {
  return (
    <ShellLayout
      area="admin"
      links={[
        { to: "/admin", label: "Dashboard", end: true, icon: "home" },
        { to: "/admin/calendar", label: "Calendario", icon: "calendar" },
        { to: "/admin/galleries", label: "Gallerie", icon: "sparkles" },
        { to: "/admin/feed", label: "Feed", icon: "bell" },
        { to: "/admin/settings", label: "Altro", icon: "menu" },
      ]}
    />
  );
}
