import { Link, useParams } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";

export function AdminShiftsPage() {
  const { eventId } = useParams();

  return (
    <div className="page">
      <PageHero
        eyebrow="Temple shifts"
        title="Sezione turni del tempio in preparazione."
        description="Questa area e gia predisposta per ospitare turni, coperture e assegnazioni quando la gestione dedicata sara pronta."
        actions={
          <Link className="button button--ghost" to={`/admin/events/${eventId ?? ""}`}>
            Torna al dettaglio evento
          </Link>
        }
      />

      <SectionCard title="Stato attuale" description="Spazio gia previsto per la fase successiva.">
        <p className="subtle-text">
          Qui arriveranno definizione turni, assegnazioni e riepiloghi di copertura.
        </p>
      </SectionCard>
    </div>
  );
}
