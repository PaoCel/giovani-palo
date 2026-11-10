import { Link, useSearchParams } from "react-router-dom";

import { AuthAccessPanel } from "@/components/AuthAccessPanel";
import { usePublicStake } from "@/components/publicSite/PublicStakeProvider";
import { ACCEDI } from "@/copy/accedi";
import { HOME } from "@/copy/home";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import {
  getDefaultOrganizationProfile,
  organizationService,
} from "@/services/firestore/organizationService";
import { getActivitiesPath } from "@/utils/activityLinks";
import { getStoredPublicStakeId } from "@/utils/stakeSelection";
import { needsProfileCompletion } from "@/utils/profileCompletion";
import { canManageFamily } from "@/utils/family";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");
  // `?scheda=crea` apre "Crea un account" (link "Crea un account" dopo
  // un'iscrizione da ospite); senza, la pagina parte da "Accedi".
  const initialMode = searchParams.get("scheda") === "crea" ? "signup" : "login";
  const { session } = useAuth();
  const { stakeId } = usePublicStake();
  const canReturnToHome = session && !session.isAnonymous &&
    (session.profile.role === "participant" || session.profile.role === "parent") &&
    needsProfileCompletion(session.profile);
  const returnHome = session && canManageFamily(session) &&
    (session.isParent || redirect === "/family") ? "/family" : "/me";
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

  return (
    <main className="auth">
      <aside aria-hidden="true" className="auth-art">
        <div className="logo" />
        <p className="verse">
          {HOME.versettoBreve}
          <span>{HOME.versettoCitazione}</span>
        </p>
      </aside>
      <section className="auth-main">
        {canReturnToHome ? (
          <p className="auth-box">
            <Link className="small-link" to={returnHome}>
              {ACCEDI.vaiAllaTuaPagina}
            </Link>
          </p>
        ) : null}
        {error ? (
          <p className="pub-alert auth-box" role="alert">
            {error}
          </p>
        ) : null}
        <AuthAccessPanel
          appearance="public"
          description={ACCEDI.notaDati}
          guestHref={getActivitiesPath(stakeId || undefined)}
          initialMode={initialMode}
          key={initialMode}
          organization={organization ?? getDefaultOrganizationProfile()}
          redirect={redirect}
        />
      </section>
    </main>
  );
}
