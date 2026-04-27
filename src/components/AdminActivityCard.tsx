import { Link } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { StatusBadge } from "@/components/StatusBadge";
import type { Event } from "@/types";
import { formatDateRange } from "@/utils/formatters";
import {
  getEffectiveEventStatus,
  getEventAudienceLabel,
  getEventStatusLabel,
  getEventStatusTone,
} from "@/utils/events";

interface AdminActivityCardProps {
  event: Event;
  to: string;
  variant?: "grid" | "feature";
  registrationsCount?: number;
}

export function AdminActivityCard({
  event,
  to,
  variant = "grid",
  registrationsCount,
}: AdminActivityCardProps) {
  const effectiveStatus = getEffectiveEventStatus(event);

  if (variant === "feature") {
    return (
      <article className="admin-activity-card admin-activity-card--feature">
        <Link className="admin-activity-card__poster-link" to={to}>
          {event.heroImageUrl ? (
            <div
              className="admin-activity-card__poster"
              style={{ backgroundImage: `url(${event.heroImageUrl})` }}
            />
          ) : (
            <div className="admin-activity-card__poster admin-activity-card__poster--fallback">
              <AppIcon name="ticket" />
            </div>
          )}
        </Link>

        <div className="admin-activity-card__content">
          <div className="chip-row">
            <StatusBadge
              label={getEventStatusLabel(effectiveStatus)}
              tone={getEventStatusTone(effectiveStatus)}
            />
            <span className="surface-chip">{getEventAudienceLabel(event.audience)}</span>
            {event.overnight ? <span className="surface-chip">Pernottamento</span> : null}
            {typeof registrationsCount === "number" ? (
              <span className="surface-chip">{registrationsCount} iscritti</span>
            ) : null}
          </div>

          <Link className="admin-activity-card__title-link" to={to}>
            <h3>{event.title}</h3>
          </Link>

          <p>{formatDateRange(event.startDate, event.endDate)}</p>
          <p>{event.location}</p>

          <Link className="admin-activity-card__link" to={to}>
            Dettagli attività
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className="admin-activity-card">
      <Link className="admin-activity-card__poster-link" to={to}>
        {event.heroImageUrl ? (
          <div
            className="admin-activity-card__poster"
            style={{ backgroundImage: `url(${event.heroImageUrl})` }}
          />
        ) : (
          <div className="admin-activity-card__poster admin-activity-card__poster--fallback">
            <AppIcon name="ticket" />
          </div>
        )}

        <div className="admin-activity-card__badges">
          <StatusBadge
            label={getEventStatusLabel(effectiveStatus)}
            tone={getEventStatusTone(effectiveStatus)}
          />
          <span className="surface-chip">{getEventAudienceLabel(event.audience)}</span>
        </div>
      </Link>

      <div className="admin-activity-card__meta">
        <Link className="admin-activity-card__title-link" to={to}>
          <h3>{event.title}</h3>
        </Link>
        <p>{formatDateRange(event.startDate, event.endDate)}</p>
        {event.location ? <p>{event.location}</p> : null}
        {typeof registrationsCount === "number" || event.overnight ? (
          <div className="admin-activity-card__meta-chips">
            {typeof registrationsCount === "number" ? (
              <span className="surface-chip admin-activity-card__count">
                {registrationsCount} iscritti
              </span>
            ) : null}
            {event.overnight ? (
              <span className="surface-chip admin-activity-card__count">Pernottamento</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
