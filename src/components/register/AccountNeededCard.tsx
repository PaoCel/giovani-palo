import { useEffect, useRef } from "react";

import { AppIcon, type AppIconName } from "@/components/AppIcon";

import "@/styles/registerFlow.css";

interface CardAction {
  label: string;
  icon?: AppIconName;
  onClick: () => void;
}

interface AccountNeededCardProps {
  // L'account con cui si è entrati, in evidenza (telefono del ragazzo).
  identity?: { name: string; initials: string; detail?: string; label: string } | null;
  title: string;
  body: string;
  primary: CardAction;
  secondary: CardAction;
  busy?: boolean;
}

// Scelta che questo account non può fare: dice quale account serve, con le due
// uscite (cambiare account o tornare alla scelta che si può fare). Nessun
// account viene trasformato (docs/FLUSSO_GENITORE.md, "Account già esistente").
export function AccountNeededCard({
  identity,
  title,
  body,
  primary,
  secondary,
  busy = false,
}: AccountNeededCardProps) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="flow-step account-needed">
      {identity ? (
        <div className="account-needed__identity">
          <span aria-hidden="true" className="auth-identity__avatar">
            {identity.initials}
          </span>
          <span className="account-needed__who">
            <span className="account-needed__label">{identity.label}</span>
            <strong>{identity.name}</strong>
            {identity.detail ? <span>{identity.detail}</span> : null}
          </span>
        </div>
      ) : null}

      <div className="auth-screen__copy">
        <h1 className="auth-screen__title" ref={titleRef} tabIndex={-1}>
          {title}
        </h1>
        <p className="auth-screen__lead">{body}</p>
      </div>

      <div className="account-needed__actions">
        <button
          className="button button--primary button--large"
          disabled={busy}
          onClick={primary.onClick}
          type="button"
        >
          {primary.icon ? <AppIcon name={primary.icon} /> : null}
          <span>{primary.label}</span>
        </button>
        <button
          className="button button--ghost button--large"
          disabled={busy}
          onClick={secondary.onClick}
          type="button"
        >
          {secondary.icon ? <AppIcon name={secondary.icon} /> : null}
          <span>{secondary.label}</span>
        </button>
      </div>
    </section>
  );
}
