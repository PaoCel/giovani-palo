import { AppIcon } from "@/components/AppIcon";

interface UnofficialDisclaimerProps {
  className?: string;
  compact?: boolean;
}

export function UnofficialDisclaimer({
  className = "",
  compact = false,
}: UnofficialDisclaimerProps) {
  const classes = [
    "unofficial-disclaimer",
    compact ? "unofficial-disclaimer--compact" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={classes} aria-label="Avviso sito non ufficiale">
      <span className="unofficial-disclaimer__icon" aria-hidden="true">
        <AppIcon name="badge" />
      </span>
      <p>
        <strong>Questa piattaforma non è un sito ufficiale</strong> de La Chiesa
        di Gesù Cristo dei Santi degli Ultimi Giorni. È uno strumento locale
        creato per facilitare informazioni, iscrizioni e coordinamento delle
        attivita.
      </p>
    </aside>
  );
}
