import type { ReactNode } from "react";
import { Link, type To } from "react-router-dom";

import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/cx";
import "@/styles/ui.css";

export type CardVariant = "default" | "cool" | "warm" | "ink";

interface CardProps {
  variant?: CardVariant;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Livello del titolo nella pagina (h2 sotto il PageHeader). */
  titleAs?: "h2" | "h3";
  /** Azione accanto al titolo (link «Vedi tutto», pill di stato). */
  headerAction?: ReactNode;
  footer?: ReactNode;
  /** Card tutta cliccabile con la freccia a destra: niente controlli dentro. */
  to?: To;
  className?: string;
  children?: ReactNode;
}

export function Card({
  variant = "default",
  title,
  subtitle,
  titleAs: Title = "h2",
  headerAction,
  footer,
  to,
  className,
  children,
}: CardProps) {
  const classes = cx(
    "ui-card",
    variant !== "default" && `ui-card--${variant}`,
    to !== undefined && "ui-card--link",
    className,
  );
  const head =
    title || subtitle || headerAction ? (
      <div className="ui-card__head">
        {title || subtitle ? (
          <div className="ui-card__titles">
            {title ? <Title className="ui-card__title">{title}</Title> : null}
            {subtitle ? <p className="ui-card__subtitle">{subtitle}</p> : null}
          </div>
        ) : null}
        {headerAction}
      </div>
    ) : null;
  const body = children ? <div className="ui-card__body">{children}</div> : null;
  const foot = footer ? <div className="ui-card__foot">{footer}</div> : null;

  if (to !== undefined) {
    return (
      <Link className={classes} to={to}>
        <div className="ui-card__content">
          {head}
          {body}
          {foot}
        </div>
        <Icon name="arrow-right" className="ui-card__arrow" />
      </Link>
    );
  }

  return (
    <section className={classes}>
      {head}
      {body}
      {foot}
    </section>
  );
}
