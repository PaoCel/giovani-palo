import { AppIcon } from "@/components/AppIcon";
import { lockedMessageOf, type MemberAccess } from "@/utils/stakeMembership";

import "@/styles/membership.css";

interface MemberLockedNoteProps {
  access: MemberAccess;
  kind: "foto" | "record" | "sondaggi";
  className?: string;
}

/**
 * Riga al posto di una superficie dei membri chiusa: "Si sbloccano dopo la
 * verifica." per chi è in coda, "… solo ai membri del palo." per chi è fuori.
 * Niente per gli ospiti (hanno il loro invito ad accedere) e mentre il
 * documento members non è ancora arrivato.
 */
export function MemberLockedNote({ access, kind, className }: MemberLockedNoteProps) {
  const message = lockedMessageOf(access, kind);
  if (!message) return null;
  return (
    <p className={className ? `mship-locked ${className}` : "mship-locked"}>
      <span aria-hidden="true" className="mship-locked__icon">
        <AppIcon name="lock" />
      </span>
      {message}
    </p>
  );
}
