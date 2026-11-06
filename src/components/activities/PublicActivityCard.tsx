import { Link } from "react-router-dom";

import { ActivityScene } from "@/components/activities/ActivityScene";
import { Icon, Pill } from "@/components/ui";
import { ANNUNCIATA } from "@/copy/annunciata";
import type { Event } from "@/types";
import { getEventAudienceLabel } from "@/utils/events";
import { formatEventCardWhen } from "@/utils/eventCardWhen";
import {
  getPublicEventState,
  getRegistrationCountdown,
  type PublicEventTone,
} from "@/utils/publicEventState";
import "@/styles/publicActivity.css";

interface PublicActivityCardProps {
  event: Event;
  to: string;
  /** Al posto dello stato dell'attività, per chi è già iscritto (/me/activities). */
  status?: { label: string; tone: PublicEventTone };
}

// Card del catalogo (/activities e /me/activities): tutta cliccabile, porta al
// dettaglio, dove sta l'iscrizione. Niente controlli dentro.
export function PublicActivityCard({ event, to, status }: PublicActivityCardProps) {
  const state = getPublicEventState(event);
  const pill = status ?? state;
  const countdown =
    !status && state.phase === "open" ? getRegistrationCountdown(event.registrationClose) : null;
  const announced = state.phase === "announced";
  const finished = state.phase === "ended" || state.phase === "cancelled";

  return (
    <Link className={finished ? "public-card public-card--past" : "public-card"} to={to}>
      <div
        className="public-card__media"
        style={event.heroImageUrl ? { backgroundImage: `url(${event.heroImageUrl})` } : undefined}
      >
        {event.heroImageUrl ? null : <ActivityScene className="public-card__scene" />}
      </div>
      <div className="public-card__body">
        <div className="public-card__main">
          <div className="public-pills">
            <Pill className={announced && !status ? "public-pill--soon" : undefined} dot tone={pill.tone}>
              {pill.label}
            </Pill>
            <Pill>{getEventAudienceLabel(event.audience)}</Pill>
          </div>
          <h2 className="public-card__title">{event.title}</h2>
          <div className="public-meta">
            <p>
              <Icon name="calendar" />
              <span>{formatEventCardWhen(event)}</span>
            </p>
            {event.location.trim() || announced ? (
              <p>
                <Icon name="map-pin" />
                <span>{event.location.trim() || ANNUNCIATA.luogoDaDefinire}</span>
              </p>
            ) : null}
          </div>
          {countdown ? <p className="public-card__hint">{countdown}</p> : null}
        </div>
        <Icon name="arrow-right" className="public-card__arrow" />
      </div>
    </Link>
  );
}
