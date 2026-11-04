import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { PAROLE } from "@/copy/parole";
import { TESTATA } from "@/copy/testata";
import { getInitials } from "@/utils/shellNavigation";

interface AccountMenuProps {
  name: string;
  roleLabel: string;
  /** Cambio vista per gli admin: «Vista giovane» da /admin, «Vista admin» da /me. */
  viewSwitch?: { to: string; label: string } | null;
  refreshing: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
  /** `card` è la riga in fondo alla barra laterale: avatar, nome e ruolo, menu verso l'alto. */
  variant?: "avatar" | "card";
}

// Menu dell'account nella testata (fase 4 del restyling): al posto della riga
// nome/ruolo e dei tasti Aggiorna ed Esci. Disclosure semplice: un pulsante
// che apre un elenco di link e pulsanti, chiuso da Esc, da un tocco fuori e
// dal cambio pagina.
export function AccountMenu({
  name,
  roleLabel,
  viewSwitch,
  refreshing,
  onRefresh,
  onSignOut,
  variant = "avatar",
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const menuId = useId();
  const initials = getInitials(name);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    // Tab fuori dal menu lo chiude, come un tocco fuori.
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

  const avatar = (
    <span aria-hidden="true" className="shell-account__avatar">
      {initials || <AppIcon name="user" />}
    </span>
  );

  return (
    <div className={`shell-account shell-account--${variant}`} ref={shellRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-label={`${TESTATA.apriMenuAccount}: ${name}`}
        className="shell-account__button"
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        {avatar}
        {variant === "card" ? (
          <span className="shell-account__who">
            <strong>{name}</strong>
            <small>{roleLabel}</small>
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="shell-account__menu" id={menuId} ref={menuRef}>
          <div className="shell-account__head">
            {avatar}
            <span className="shell-account__who">
              <strong>{name}</strong>
              <small>{roleLabel}</small>
            </span>
          </div>
          <div className="shell-account__items">
            {viewSwitch ? (
              <Link className="shell-account__item" to={viewSwitch.to}>
                <AppIcon name="eye" />
                {viewSwitch.label}
              </Link>
            ) : null}
            <button
              className="shell-account__item"
              disabled={refreshing}
              onClick={onRefresh}
              type="button"
            >
              <AppIcon name="refresh" />
              {TESTATA.aggiornaApp}
            </button>
            <button
              className="shell-account__item shell-account__item--danger"
              onClick={onSignOut}
              type="button"
            >
              <AppIcon name="logout" />
              {PAROLE.esci}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
