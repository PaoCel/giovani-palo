import { StatusBadge } from "@/components/StatusBadge";
import type { Registration } from "@/types";
import { getPhotoConsentBadges } from "@/utils/parentAuthorization";
import "@/styles/consentStaff.css";

interface PhotoConsentPillsProps {
  registration: Registration;
  className?: string;
}

/**
 * Scelte del genitore su foto e social, in forma compatta (`Foto: sì` +
 * `Social: no`). Non mostra nulla per gli adulti senza firma del genitore.
 */
export function PhotoConsentPills({
  registration,
  className,
}: PhotoConsentPillsProps) {
  const badges = getPhotoConsentBadges(registration);

  if (!badges) {
    return null;
  }

  return (
    <span
      className={`photo-consent-pills${className ? ` ${className}` : ""}`}
    >
      <StatusBadge label={badges.photo.label} tone={badges.photo.tone} />
      <StatusBadge label={badges.social.label} tone={badges.social.tone} />
    </span>
  );
}
