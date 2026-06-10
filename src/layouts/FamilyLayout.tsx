import { ShellLayout } from "@/layouts/ShellLayout";

export function FamilyLayout() {
  return (
    <ShellLayout
      area="family"
      brandLabel="Piattaforma per Attività GU e GD Italia"
      links={[
        { to: "/family", label: "Famiglia", end: true, icon: "home" },
        { to: "/family/activities", label: "Attività", icon: "list" },
        { to: "/family/profile", label: "Profilo", icon: "user" },
      ]}
    />
  );
}
