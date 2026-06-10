import { useSearchParams } from "react-router-dom";

import { AuthAccessPanel } from "@/components/AuthAccessPanel";
import { useAsyncData } from "@/hooks/useAsyncData";
import { organizationService } from "@/services/firestore/organizationService";
import { getStoredPublicStakeId } from "@/utils/stakeSelection";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");
  const { data: organization, error } = useAsyncData(
    // Niente read di validazione del palo prima del profilo: getProfile
    // gestisce già id mancanti/invalidi cadendo sul default. Era un round
    // trip in più che teneva nascosto il form di login.
    () => organizationService.getProfile(getStoredPublicStakeId() || undefined),
    [],
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

      {organization ? (
        <AuthAccessPanel
          organization={organization}
          redirect={redirect}
          description={description}
        />
      ) : (
        <section className="auth-screen">
          <p className="auth-screen__note">Sto preparando il login...</p>
        </section>
      )}
    </div>
  );
}
