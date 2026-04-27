import { Link } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAsyncData } from "@/hooks/useAsyncData";
import { organizationService } from "@/services/firestore/organizationService";
import { resolvePublicStakeId } from "@/utils/stakeSelection";

export function PhotoConsentPage() {
  const { data: organization } = useAsyncData(
    async () => {
      const stakeId = await resolvePublicStakeId();
      return organizationService.getProfile(stakeId);
    },
    [],
    null,
  );

  return (
    <div className="page">
      <PageHero
        className="hero--compact"
        eyebrow="Consenso foto"
        title="Comunicazione sull'uso delle fotografie"
        description="Questa pagina spiega a cosa si riferiscono i consensi foto presenti nel modulo di iscrizione."
        actions={
          <Link className="button button--soft" to="/privacy">
            Privacy generale
          </Link>
        }
      />

      <SectionCard
        title="Uso interno"
        description="Serve per materiale organizzativo e di vita del palo."
      >
        <div className="surface-panel surface-panel--subtle">
          <p>
            Il consenso per uso interno copre fotografie e immagini impiegate in comunicazioni
            riservate all&apos;organizzazione, riepiloghi delle attivita, condivisioni interne,
            documentazione logistica e archivi operativi collegati all&apos;evento.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Uso pubblico"
        description="Riguarda solo eventuali pubblicazioni esterne che gli organizzatori decidono di fare."
      >
        <div className="surface-panel surface-panel--subtle">
          <p>
            Il consenso per uso pubblico riguarda l&apos;eventuale pubblicazione di immagini
            selezionate su canali aperti come siti, locandine, social o altri materiali pubblici
            dell&apos;organizzazione. Il mancato consenso non blocca l&apos;iscrizione
            all&apos;attivita.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Attenzione particolare ai minori"
        description="Per i minori abbiamo aggiunto anche un caricamento dedicato del consenso del genitore o tutore."
      >
        <div className="stack">
          <div className="surface-panel surface-panel--subtle">
            <p>
              Per i partecipanti minorenni gli admin possono richiedere anche una foto del foglio
              firmato dal genitore o tutore. Questo documento viene gestito separatamente
              dall&apos;iscrizione e puo essere caricato anche in un secondo momento da chi ha un
              account.
            </p>
          </div>

          <div className="surface-panel surface-panel--subtle">
            <h3>Contatto organizzativo</h3>
            <p>
              {organization?.supportContact ||
                "Configura un contatto di supporto nelle impostazioni admin per completare questa sezione."}
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
