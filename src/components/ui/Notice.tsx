import type { ReactNode } from "react";

import type { AppIconName } from "@/components/AppIcon";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/cx";
import "@/styles/ui.css";

export type NoticeTone = "info" | "success" | "warning" | "danger";

const TONE_ICON: Record<NoticeTone, AppIconName> = {
  info: "info",
  success: "check",
  warning: "alert",
  danger: "alert",
};

interface NoticeProps {
  /** Esplicito: il tono non si deduce dal titolo. */
  tone: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: AppIconName;
  /**
   * Di default "alert" per danger (lo screen reader interrompe) e "status"
   * per gli altri; "none" per un avviso fisso che c'è già all'apertura.
   */
  live?: "status" | "alert" | "none";
  className?: string;
}

export function Notice({ tone, title, children, action, icon, live, className }: NoticeProps) {
  const role = live ?? (tone === "danger" ? "alert" : "status");

  return (
    <div
      className={cx("ui-notice", tone !== "info" && `ui-notice--${tone}`, className)}
      role={role === "none" ? undefined : role}
    >
      <Icon name={icon ?? TONE_ICON[tone]} className="ui-notice__icon" />
      <div className="ui-notice__content">
        {title ? <p className="ui-notice__title">{title}</p> : null}
        {children ? <div className="ui-notice__body">{children}</div> : null}
        {action ? <div className="ui-notice__action">{action}</div> : null}
      </div>
    </div>
  );
}
