import { useEffect, type ReactNode } from "react";

import { AppIcon } from "@/components/AppIcon";

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
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className={
        size === "compact"
          ? "app-modal-backdrop app-modal-backdrop--centered"
          : "app-modal-backdrop"
      }
      onClick={onClose}
    >
      <section
        aria-labelledby="app-modal-title"
        aria-modal="true"
        className={[
          "app-modal",
          size === "wide" ? "app-modal--wide" : "",
          size === "compact" ? "app-modal--compact" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(eventInput) => eventInput.stopPropagation()}
        role="dialog"
      >
        <header className="app-modal__header">
          <div>
            <h2 id="app-modal-title">{title}</h2>
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
}
