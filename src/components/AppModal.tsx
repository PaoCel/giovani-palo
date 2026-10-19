import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { AppIcon } from "@/components/AppIcon";
import { keepTabInside, useInertBackground } from "@/hooks/useModalLayer";

interface AppModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "default" | "wide" | "compact";
}

export function AppModal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = "default",
}: AppModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  // Id unico: due modali aperti insieme non condividono il titolo.
  const titleId = `${useId()}-title`;
  useInertBackground(backdropRef);

  // All'apertura il focus va al dialogo (chi usa tastiera o lettore di schermo
  // parte dal titolo); alla chiusura torna al pulsante che l'ha aperto.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const modal = (
    <div
      className={
        size === "compact"
          ? "app-modal-backdrop app-modal-backdrop--centered"
          : "app-modal-backdrop"
      }
      onClick={onClose}
      ref={backdropRef}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={[
          "app-modal",
          size === "wide" ? "app-modal--wide" : "",
          size === "compact" ? "app-modal--compact" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(eventInput) => eventInput.stopPropagation()}
        onKeyDown={(eventInput) => keepTabInside(eventInput, dialogRef.current)}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="app-modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            aria-label="Chiudi"
            className="icon-button icon-button--soft"
            onClick={onClose}
            type="button"
          >
            <AppIcon name="x" />
          </button>
        </header>

        <div className="app-modal__body">{children}</div>

        {footer ? <footer className="app-modal__footer">{footer}</footer> : null}
      </section>
    </div>
  );

  // Portale su <body>: fuori dal sottoalbero della pagina, così il modale
  // (position: fixed, z-index alto) resta sempre sopra la bottom-nav fissa
  // e non finisce mai intrappolato in uno stacking context della pagina.
  if (typeof document === "undefined") {
    return modal;
  }

  return createPortal(modal, document.body);
}
