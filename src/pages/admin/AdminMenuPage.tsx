import { Link, useParams } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";

export function AdminMenuPage() {
  const { eventId } = useParams();

  return (
    <div className="page">
      <PageHero
        eyebrow="Menu"
        title="Sezione menu pronta per essere completata."
        description="Qui troverai in seguito pasti, note alimentari e organizzazione pratica collegata all'attivita."
        actions={
          <Link className="button button--ghost" to={`/admin/events/${eventId ?? ""}`}>
            Torna al dettaglio evento
          </Link>
        }
      />

      <SectionCard title="Stato attuale" description="Spazio mantenuto per la fase successiva.">
        <p className="subtle-text">
          Per ora la sezione e pronta a livello di navigazione, mentre il catalogo menu verra
          aggiunto in un passaggio dedicato.
        </p>
      </SectionCard>
    </div>
  );
}
