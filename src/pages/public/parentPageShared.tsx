import { useEffect, type ReactNode } from "react";

import { AppIcon } from "@/components/AppIcon";

// Pezzi comuni alle pagine pubbliche del genitore (firma e scelte su foto e
// social): stesso guscio, stesso pannello di stato, stessa data.

export function useNoIndex(title: string) {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow, noarchive";
    document.head.appendChild(meta);
    const previousTitle = document.title;
    document.title = title;
    return () => {
      document.head.removeChild(meta);
      document.title = previousTitle;
    };
  }, [title]);
}

export function formatDateRange(startIso?: string, endIso?: string) {
  if (!startIso) return "Data da definire";
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "Data da definire";

  const formatter = new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  if (endIso) {
    const end = new Date(endIso);
    if (
      !Number.isNaN(end.getTime()) &&
      formatter.format(start) !== formatter.format(end)
    ) {
      return `${formatter.format(start)} → ${formatter.format(end)}`;
    }
  }

  return formatter.format(start);
}

export function StatusPanel({
  tone,
  title,
  icon,
  spinner = false,
  children,
}: {
  tone: "neutral" | "info" | "success" | "error";
  title: string;
  icon?: "check" | "bell";
  spinner?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`pc-status pc-status--${tone}`}>
      {spinner ? (
        <div className="spinner" aria-hidden="true" />
      ) : icon ? (
        <div className="pc-status__icon" aria-hidden="true">
          <AppIcon name={icon} />
        </div>
      ) : null}
      <h1>{title}</h1>
      {children}
    </div>
  );
}
