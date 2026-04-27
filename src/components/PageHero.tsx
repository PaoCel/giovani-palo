import type { ReactNode } from "react";

interface PageHeroProps {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  aside?: ReactNode;
  className?: string;
}

export function PageHero({
  eyebrow,
  title,
  description,
  actions,
  aside,
  className,
}: PageHeroProps) {
  return (
    <section className={["hero", className].filter(Boolean).join(" ")}>
      <div className="hero__content">
        <span className="hero__eyebrow">{eyebrow}</span>
        <h1 className="hero__title">{title}</h1>
        {description ? <p className="hero__description">{description}</p> : null}
        {actions ? <div className="hero__actions">{actions}</div> : null}
      </div>
      {aside ? <div className="hero__aside">{aside}</div> : null}
    </section>
  );
}
