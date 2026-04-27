import { Link } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { StatusBadge } from "@/components/StatusBadge";
import type { Event } from "@/types";
import { formatEventWindow } from "@/utils/formatters";
import {
  getEventAudienceLabel,
  getEventStatusLabel,
  getEventStatusTone,
} from "@/utils/events";

interface EventCardProps {
  event: Event;
  primaryTo: string;
  primaryLabel: string;
  secondaryTo?: string;
  secondaryLabel?: string;
  variant?: "default" | "compact" | "poster";
}

export function EventCard({
  event,
  primaryTo,
  primaryLabel,
  secondaryTo,
  secondaryLabel,
  variant = "default",
}: EventCardProps) {
  if (variant === "poster") {
    return (
      <article className="event-card event-card--poster">
        <Link
          aria-label={`${primaryLabel}: ${event.title}`}
          className="event-card__poster-link"
          to={primaryTo}
        >
          {event.heroImageUrl ? (
            <div
              className="event-card__media event-card__media--poster"
              style={{ backgroundImage: `url(${event.heroImageUrl})` }}
            />
          ) : (
            <div className="event-card__poster-fallback">
              <AppIcon name="ticket" />
            </div>
          )}

          <div className="event-card__poster-badges">
            <StatusBadge
              label={getEventStatusLabel(event.status)}
              tone={getEventStatusTone(event.status)}
            />
            <span className="surface-chip">{getEventAudienceLabel(event.audience)}</span>
          </div>
        </Link>

        <div className="event-card__poster-content">
          <Link className="event-card__poster-title" to={primaryTo}>
            <h3>{event.title}</h3>
            <p>{event.location || formatEventWindow(event)}</p>
          </Link>
        </div>

        <div className="event-card__poster-actions">
          {secondaryTo && secondaryLabel ? (
            <Link
              className="event-card__poster-cta"
              to={secondaryTo}
            >
              {secondaryLabel}
            </Link>
          ) : <span />}
        </div>
      </article>
    );
  }

  if (variant === "compact") {
    return (
      <article className="event-card event-card--compact">
        {event.heroImageUrl ? (
          <div
            className="event-card__media event-card__media--compact"
            style={{ backgroundImage: `url(${event.heroImageUrl})` }}
          />
        ) : null}

        <div className="event-card__compact-main">
          <div className="chip-row">
            <StatusBadge
              label={getEventStatusLabel(event.status)}
              tone={getEventStatusTone(event.status)}
            />
            <span className="surface-chip">{getEventAudienceLabel(event.audience)}</span>
          </div>

          <div className="event-card__header">
            <h3>{event.title}</h3>
            <p className="event-card__excerpt">{event.description}</p>
          </div>

          <div className="event-card__meta">
            <span>
              <AppIcon name="calendar" />
              <strong>{formatEventWindow(event)}</strong>
            </span>
            <span>
              <AppIcon name="map-pin" />
              <strong>{event.location}</strong>
            </span>
          </div>
        </div>

        <div className="event-card__quick-actions">
          <Link
            aria-label={`${primaryLabel}: ${event.title}`}
            className="icon-button icon-button--soft"
            to={primaryTo}
          >
            <AppIcon name="eye" />
          </Link>

          {secondaryTo && secondaryLabel ? (
            <Link
              aria-label={`${secondaryLabel}: ${event.title}`}
              className="icon-button icon-button--primary"
              to={secondaryTo}
            >
              <AppIcon name="ticket" />
            </Link>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className="event-card">
      {event.heroImageUrl ? (
        <div
          className="event-card__media"
          style={{ backgroundImage: `url(${event.heroImageUrl})` }}
        />
      ) : null}
      <div className="event-card__header">
        <div className="chip-row">
          <StatusBadge
            label={getEventStatusLabel(event.status)}
            tone={getEventStatusTone(event.status)}
          />
          <span className="surface-chip">{getEventAudienceLabel(event.audience)}</span>
          <span className="surface-chip">{event.year}</span>
          <span className="surface-chip">{event.isPublic ? "Pubblico" : "Privato"}</span>
        </div>
        <h3>{event.title}</h3>
        <p>{event.description}</p>
      </div>
      <dl className="summary-list">
        <div>
          <dt>Dove</dt>
          <dd>{event.location}</dd>
        </div>
        <div>
          <dt>Quando</dt>
          <dd>{formatEventWindow(event)}</dd>
        </div>
        <div>
          <dt>Iscrizioni</dt>
          <dd>
            {event.registrationOpen.slice(0, 10)} → {event.registrationClose.slice(0, 10)}
          </dd>
        </div>
        {event.program ? (
          <div>
            <dt>Programma</dt>
            <dd>{event.program}</dd>
          </div>
        ) : null}
      </dl>
      <div className="event-card__footer">
        <Link className="button button--primary" to={primaryTo}>
          {primaryLabel}
        </Link>
        {secondaryTo && secondaryLabel ? (
          <Link className="button button--ghost" to={secondaryTo}>
            {secondaryLabel}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
