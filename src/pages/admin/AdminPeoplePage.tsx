import { PageHero } from "@/components/PageHero";
import { StakePeoplePanel } from "@/components/membership/StakePeoplePanel";
import { PALO } from "@/copy/palo";
import { useAuth } from "@/hooks/useAuth";

// Persone del palo per l'admin (docs/APPARTENENZA_AL_PALO.md, «Client della
// fase 3»): richieste di accesso, da confermare, rifiutate. S4 aggiunge
// membri, staff e rimossi.
export function AdminPeoplePage() {
  const { session } = useAuth();
  if (!session) return null;
  return (
    <div className="page">
      <PageHero
        description={PALO.personeAdminDescrizione}
        eyebrow={session.profile.stakeName || PALO.persone}
        title={PALO.persone}
      />
      <StakePeoplePanel isAdmin stakeId={session.profile.stakeId} unitId={null} viewerUid={session.firebaseUser.uid} />
    </div>
  );
}
