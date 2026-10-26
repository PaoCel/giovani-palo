import { PageHero } from "@/components/PageHero";
import { StakePeoplePanel } from "@/components/membership/StakePeoplePanel";
import { PALO } from "@/copy/palo";
import { fillCopy } from "@/copy/parole";
import { useAuth } from "@/hooks/useAuth";

// Persone della propria unità per il dirigente: solo chi ha dichiarato la sua
// unità (le rules negano il resto), il resto lo vedono gli admin.
export function UnitPeoplePage() {
  const { session } = useAuth();
  if (!session) return null;
  const unitName = session.profile.unitName;
  return (
    <div className="page">
      <PageHero
        description={unitName ? fillCopy(PALO.personeUnitaDescrizione, { unita: unitName }) : undefined}
        eyebrow={unitName || PALO.persone}
        title={PALO.persone}
      />
      <StakePeoplePanel
        isAdmin={false}
        stakeId={session.profile.stakeId}
        unitId={session.profile.unitId || null}
        viewerUid={session.firebaseUser.uid}
      />
    </div>
  );
}
