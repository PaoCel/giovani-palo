import "@/styles/userNavigation.css";

import { ShellLayout } from "@/layouts/ShellLayout";

export function UserLayout() {
  return (
    <ShellLayout
      area="user"
      brandLabel="GUGD Italia"
      links={[
        { to: "/me", label: "Home", end: true, icon: "home" },
        { to: "/me/calendar", label: "Calendario", icon: "calendar" },
        { to: "/me/activities", label: "Attività", icon: "list" },
        { to: "/me/profile", label: "Profilo", icon: "user" },
      ]}
    />
  );
}
