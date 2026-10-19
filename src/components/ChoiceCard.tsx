import { AppIcon } from "@/components/AppIcon";
import dirigenteUrl from "@/assets/flusso-genitore/dirigente.webp";
import genitoreUrl from "@/assets/flusso-genitore/genitore.webp";
import giovaniUrl from "@/assets/flusso-genitore/giovani.webp";
import ioUrl from "@/assets/flusso-genitore/io.webp";

import "@/styles/registerFlow.css";

// Illustrazioni nostre, persone e non un'attività (docs/FLUSSO_GENITORE.md,
// "Illustrazioni"): WebP a 2× della misura mostrata, 240 px di larghezza.
const ILLUSTRATIONS = {
  io: { src: ioUrl, height: 342 },
  genitore: { src: genitoreUrl, height: 345 },
  giovani: { src: giovaniUrl, height: 342 },
  dirigente: { src: dirigenteUrl, height: 351 },
} as const;

export type ChoiceIllustration = keyof typeof ILLUSTRATIONS;

interface ChoiceCardProps {
  title: string;
  detail: string;
  illustration: ChoiceIllustration;
  onSelect: () => void;
  // La scelta fatta prima, ritrovata tornando indietro.
  selected?: boolean;
  compact?: boolean;
  disabled?: boolean;
}

// Scheda illustrata che è essa stessa il pulsante: niente "Continua".
export function ChoiceCard({
  title,
  detail,
  illustration,
  onSelect,
  selected = false,
  compact = false,
  disabled = false,
}: ChoiceCardProps) {
  const image = ILLUSTRATIONS[illustration];

  return (
    <button
      aria-pressed={selected}
      className={[
        "choice-card",
        compact ? "choice-card--compact" : "",
        selected ? "choice-card--selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span className="choice-card__text">
        <span className="choice-card__title">{title}</span>
        <span className="choice-card__detail">{detail}</span>
        <span aria-hidden="true" className="choice-card__go">
          <AppIcon name="arrow-right" />
        </span>
      </span>
      <img
        alt=""
        className="choice-card__image"
        decoding="async"
        height={image.height}
        src={image.src}
        width={240}
      />
    </button>
  );
}
