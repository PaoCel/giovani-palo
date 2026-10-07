import { useSearchParams } from "react-router-dom";

import { AuthAccessPanel } from "@/components/AuthAccessPanel";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import {
  getDefaultOrganizationProfile,
  organizationService,
} from "@/services/firestore/organizationService";
import { getStoredPublicStakeId } from "@/utils/stakeSelection";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");
  const { session } = useAuth();
  // Chi ha già un profilo resta nel suo palo: il completamento profilo scrive
  // `stakeId` dell'organizzazione mostrata, e per un admin/dirigente le rules
  // rifiutano ogni cambio di palo (con più pali restava bloccato; un
  // partecipante finiva invece spostato nel palo pubblico dell'ultima visita).
  const profileStakeId = session?.profile.stakeId || "";
  const { data: organization, error } = useAsyncData(
    // Niente read di validazione del palo prima del profilo: getProfile
    // gestisce già id mancanti/invalidi cadendo sul default. Era un round
    // trip in più che teneva nascosto il form di login.
    () => organizationService.getProfile(profileStakeId || getStoredPublicStakeId() || undefined),
    [profileStakeId],
    null,
  );
  const description =
    "Creare un account ti aiuta a velocizzare le prossime iscrizioni. I dati restano usati solo per attività, presenze e comunicazioni collegate.";

  return (
    <div className="page page--auth">
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Impossibile preparare l&apos;accesso</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {/* Il form non dipende dai dati dell'organizzazione (servono solo per
          testi di aiuto e completamento profilo): si mostra subito con i
          default e si aggiorna quando il profilo arriva. */}
      <AuthAccessPanel
        organization={organization ?? getDefaultOrganizationProfile()}
        redirect={redirect}
        description={description}
      />
    </div>
  );
}
