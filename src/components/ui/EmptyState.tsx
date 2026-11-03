import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import "@/styles/ui.css";

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * Azione principale, obbligatoria: uno stato vuoto dice cosa fare dopo.
   * `null` solo quando davvero non c'è niente da fare, scritto apposta.
   */
  action: ReactNode | null;
  secondaryAction?: ReactNode;
  /** Illustrazione propria (src/assets/flusso-genitore/), mai un'icona di libreria. */
  illustration?: string;
  headingAs?: "h2" | "h3";
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  illustration,
  headingAs: Heading = "h2",
  className,
}: EmptyStateProps) {
  return (
    <div className={cx("ui-empty", className)}>
      {illustration ? <img className="ui-empty__art" src={illustration} alt="" /> : null}
      <Heading className="ui-empty__title">{title}</Heading>
      {description ? <p className="ui-empty__description">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="ui-empty__actions">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
