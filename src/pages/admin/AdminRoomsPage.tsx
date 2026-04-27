import { Link, useParams } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";

export function AdminRoomsPage() {
  const { eventId } = useParams();

  return (
    <div className="page">
      <PageHero
        eyebrow="Rooms"
        title="Sezione stanze pronta per il prossimo passaggio."
        description="Qui arriveranno gestione camere, capienze e assegnazioni quando sara il momento di lavorare sull'ospitalita."
        actions={
          <Link className="button button--ghost" to={`/admin/events/${eventId ?? ""}`}>
            Torna al dettaglio evento
          </Link>
        }
      />

      <SectionCard
        title="Stato attuale"
        description="Spazio mantenuto per il lavoro operativo successivo."
      >
        <p className="subtle-text">
          Qui arriveranno creazione stanze, capienza e assegnazioni, mantenendo continuita con il
          resto della dashboard admin.
        </p>
      </SectionCard>
    </div>
  );
}
