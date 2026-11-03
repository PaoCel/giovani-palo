import type { ReactNode } from "react";
import { Link, type To } from "react-router-dom";

import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/cx";
import "@/styles/ui.css";

interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Pulsanti della pagina: scendono sotto il testo quando non c'è spazio. */
  actions?: ReactNode;
  back?: { to: To; label: string };
  className?: string;
}

// Al posto di PageHero, UserPageIntro e .hero, pagina per pagina. Nessuna
// altezza fissa: il titolo va a capo, mai troncato.
export function PageHeader({ title, eyebrow, description, actions, back, className }: PageHeaderProps) {
  return (
    <header className={cx("ui-page-header", className)}>
      <div className="ui-page-header__text">
        {back ? (
          <Link className="ui-page-header__back" to={back.to}>
            <Icon name="arrow-left" />
            <span>{back.label}</span>
          </Link>
        ) : null}
        {eyebrow ? <p className="ui-page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="ui-page-header__title">{title}</h1>
        {description ? <p className="ui-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}
