import { ShellLayout } from "@/layouts/ShellLayout";
import { useAsyncData } from "@/hooks/useAsyncData";
import { organizationService } from "@/services/firestore/organizationService";
import { resolvePublicStakeId } from "@/utils/stakeSelection";

export function PublicLayout() {
  const { data: organization } = useAsyncData(
    async () => {
      const stakeId = await resolvePublicStakeId();
      return organizationService.getProfile(stakeId);
    },
    [],
    null,
  );

  return (
    <ShellLayout
      area="public"
      brandLabel="Piattaforma per Attività GU e GD Italia"
      showDefaultAuthAction={false}
    />
  );
}
