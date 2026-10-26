import { ShellLayout, type LayoutLink } from "@/layouts/ShellLayout";
import { useAuth } from "@/hooks/useAuth";
import { getAccountHomePath } from "@/utils/family";

export function FamilyLayout() {
  const { session } = useAuth();

  // Famiglia è la casa dell'account da genitore. Per gli altri account adulti
  // (G2: partecipanti, dirigenti, admin) è una pagina in più: la barra riporta
  // alla loro area, e il profilo resta quello della loro area.
  const links: LayoutLink[] = session && !session.isParent
    ? [
        { to: getAccountHomePath(session.profile.role), label: "Home", end: true, icon: "home" },
        { to: "/family", label: "Famiglia", end: true, icon: "users" },
      ]
    : [
        { to: "/family", label: "Famiglia", end: true, icon: "home" },
        { to: "/family/activities", label: "Attività", icon: "list" },
        { to: "/family/profile", label: "Profilo", icon: "user" },
      ];

  return (
    <ShellLayout
      area="family"
      brandLabel="Piattaforma per Attività GU e GD Italia"
      links={links}
    />
  );
}
