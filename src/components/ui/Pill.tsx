import type { HTMLAttributes, ReactNode } from "react";

import type { AppIconName } from "@/components/AppIcon";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/cx";
import "@/styles/ui.css";

export type PillTone = "neutral" | "info" | "success" | "warning" | "danger" | "sand";

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  icon?: AppIconName;
  /** Pallino colorato al posto dell'icona, per gli stati. */
  dot?: boolean;
  children: ReactNode;
}

// Stato e conteggi, non si tocca: alta 28 px. Un filtro toccabile è un
// Button, perché deve arrivare a 44 px.
export function Pill({ tone = "neutral", icon, dot = false, className, children, ...props }: PillProps) {
  return (
    <span className={cx("ui-pill", tone !== "neutral" && `ui-pill--${tone}`, className)} {...props}>
      {dot ? <span className="ui-pill__dot" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}
