import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import type { Alert } from "@/types";

interface AdminAlertsProps {
  alerts: Alert[];
  unreadCount: number;
  /** Chiamata all'apertura: segna lette le notifiche non lette. */
  onOpen: () => void;
}

// Campanella delle notifiche admin. Vive nella testata su telefono e nella
// barra laterale a desktop: ogni copia ha il suo stato aperto/chiuso.
export function AdminAlerts({ alerts, unreadCount, onOpen }: AdminAlertsProps) {
  const [open, setOpen] = useState(false);
  // Su telefono la tendina è fissa sotto la testata: la sua altezza cambia
  // con il nome del palo, quindi si misura all'apertura.
  const [top, setTop] = useState<number | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    // Tab fuori dalla tendina la chiude, come un tocco fuori.
    function handleFocusIn(event: FocusEvent) {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [open]);

  useEffect(() => {
    if (open && unreadCount > 0) onOpen();
  }, [open, unreadCount, onOpen]);

  return (
    <div className="topbar__alert-shell" ref={shellRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unreadCount > 0 ? `Apri notifiche admin (${unreadCount})` : "Apri notifiche admin"}
        className="topbar__alert-link"
        onClick={() => {
          const header = shellRef.current?.closest("header");
          setTop(header ? Math.round(header.getBoundingClientRect().bottom + 8) : null);
          setOpen((current) => !current);
        }}
        ref={buttonRef}
        title="Notifiche admin"
        type="button"
      >
        <AppIcon name="bell" />
        {unreadCount > 0 ? (
          <span className="topbar__alert-count">{unreadCount > 9 ? "9+" : unreadCount}</span>
        ) : null}
      </button>

      {open ? (
        <div
          aria-label="Notifiche admin"
          className="topbar__alert-dropdown"
          role="dialog"
          style={top !== null ? ({ "--alerts-top": `${top}px` } as CSSProperties) : undefined}
        >
          <div className="topbar__alert-dropdown-head">
            <strong>Notifiche</strong>
            <small>{unreadCount > 0 ? `${unreadCount} nuove` : "Tutte lette"}</small>
          </div>

          {alerts.length === 0 ? (
            <p className="topbar__alert-empty">Nessuna notifica recente.</p>
          ) : (
            <div className="topbar__alert-list">
              {alerts.slice(0, 8).map((alert) => (
                <Link
                  key={alert.id}
                  className="topbar__alert-item"
                  onClick={() => setOpen(false)}
                  to={alert.eventId ? `/admin/events/${alert.eventId}` : "/admin"}
                >
                  <strong>{alert.participantName || alert.title}</strong>
                  <span>{alert.eventTitle || alert.message}</span>
                  <small>
                    {alert.submittedByMode === "anonymous"
                      ? "Ospite"
                      : alert.submittedByMode === "parent"
                        ? "Iscritto dal genitore"
                        : "Con account"}
                  </small>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
