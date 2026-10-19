import { useEffect, useRef } from "react";

import { AppIcon } from "@/components/AppIcon";
import { ChoiceCard, type ChoiceIllustration } from "@/components/ChoiceCard";
import { CHI_PARTECIPA } from "@/copy/chiPartecipa";
import type { RegisterFor } from "@/utils/registerFlow";

import "@/styles/registerFlow.css";

interface ChiPartecipaStepProps {
  // La scelta di prima, evidenziata tornando qui con "Cambia" o indietro.
  selected: RegisterFor | null;
  // Riga sotto "Partecipo io" e illustrazione, per chi è già entrato.
  partecipoIoDetail: string;
  partecipoIoIllustration: ChoiceIllustration;
  iscrivoFiglioDetail: string;
  onChoose: (per: RegisterFor) => void;
}

// "Chi partecipa?" (docs/FLUSSO_GENITORE.md, B): le schede sono i pulsanti,
// niente "Continua". Nessuna scrittura: la scelta vive nell'URL.
export function ChiPartecipaStep({
  selected,
  partecipoIoDetail,
  partecipoIoIllustration,
  iscrivoFiglioDetail,
  onChoose,
}: ChiPartecipaStepProps) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="flow-step">
      <div className="auth-screen__copy">
        <h1 className="auth-screen__title" ref={titleRef} tabIndex={-1}>
          {CHI_PARTECIPA.titolo}
        </h1>
        <p className="auth-screen__lead">{CHI_PARTECIPA.lead}</p>
      </div>

      <div className="choice-list">
        <ChoiceCard
          detail={partecipoIoDetail}
          illustration={partecipoIoIllustration}
          onSelect={() => onChoose("io")}
          selected={selected === "io"}
          title={CHI_PARTECIPA.partecipoIo}
        />
        <ChoiceCard
          detail={iscrivoFiglioDetail}
          illustration="genitore"
          onSelect={() => onChoose("figlio")}
          selected={selected === "figlio"}
          title={CHI_PARTECIPA.iscrivoFiglio}
        />
      </div>

      <p className="flow-note">
        <AppIcon name="users" />
        <span>{CHI_PARTECIPA.piuFigli}</span>
      </p>
    </section>
  );
}
