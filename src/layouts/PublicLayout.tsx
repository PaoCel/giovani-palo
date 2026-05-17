import { ShellLayout } from "@/layouts/ShellLayout";

export function PublicLayout() {
  return (
    <ShellLayout
      area="public"
      brandLabel="Piattaforma per Attività GU e GD Italia"
      showDefaultAuthAction={false}
    />
  );
}
