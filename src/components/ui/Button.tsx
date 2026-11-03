import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

import type { AppIconName } from "@/components/AppIcon";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/cx";
import "@/styles/ui.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonLookProps {
  variant?: ButtonVariant;
  /** "lg" per l'azione principale (48 px); "md" non scende mai sotto 44 px. */
  size?: "md" | "lg";
  /** Larghezza piena, per le azioni principali su telefono. */
  block?: boolean;
  icon?: AppIconName;
  iconPosition?: "start" | "end";
}

export function buttonClassName({
  variant = "primary",
  size = "md",
  block = false,
}: Pick<ButtonLookProps, "variant" | "size" | "block"> = {}) {
  return cx(
    "ui-button",
    `ui-button--${variant}`,
    size === "lg" && "ui-button--lg",
    block && "ui-button--block",
  );
}

function ButtonContent({
  children,
  icon,
  iconPosition = "start",
  busy = false,
}: {
  children: ReactNode;
  icon?: AppIconName;
  iconPosition?: "start" | "end";
  busy?: boolean;
}) {
  const start = busy ? (
    <span className="ui-button__spinner" aria-hidden="true" />
  ) : icon && iconPosition === "start" ? (
    <Icon name={icon} />
  ) : null;
  const end = !busy && icon && iconPosition === "end" ? <Icon name={icon} /> : null;

  return (
    <>
      {start}
      <span>{children}</span>
      {end}
    </>
  );
}

interface ButtonProps
  extends ButtonLookProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  /** Operazione in corso: disabilita il tasto e mostra la rotella. */
  busy?: boolean;
}

export function Button({
  variant,
  size,
  block,
  icon,
  iconPosition,
  busy = false,
  disabled,
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(buttonClassName({ variant, size, block }), className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      <ButtonContent icon={icon} iconPosition={iconPosition} busy={busy}>
        {children}
      </ButtonContent>
    </button>
  );
}

interface ButtonLinkProps extends ButtonLookProps, Omit<LinkProps, "children"> {
  children: ReactNode;
}

/** Stesso aspetto di Button per i link di navigazione interna. */
export function ButtonLink({
  variant,
  size,
  block,
  icon,
  iconPosition,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={cx(buttonClassName({ variant, size, block }), className)} {...props}>
      <ButtonContent icon={icon} iconPosition={iconPosition}>
        {children}
      </ButtonContent>
    </Link>
  );
}
