import { Link } from "react-router-dom";

import { ActivityScene } from "@/components/activities/ActivityScene";
import { Icon, Pill } from "@/components/ui";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { ANNUNCIATA } from "@/copy/annunciata";
import { fillCopy } from "@/copy/parole";
import type { Event } from "@/types";
import { formatEventWhen } from "@/utils/formatters";
import {
  getEffectiveEventStatus,
  getEventAudienceLabel,
  getEventStatusLabel,
  getEventStatusTone,
} from "@/utils/events";
import "@/styles/adminPages.css";

interface AdminActivityCardProps {
  event: Event;
  to: string;
  registrationsCount?: number;
  /** Attività finita o annullata: foto spenta, come nel catalogo. */
  past?: boolean;
}

// Card delle attività negli elenchi admin (home e /admin/events): tutta
// cliccabile, porta alla scheda di gestione. Su telefono è una riga con la
// foto a sinistra, da 640 px la card con la foto sopra, come nel catalogo.
export function AdminActivityCard({ event, to, registrationsCount, past = false }: AdminActivityCardProps) {
  const status = getEffectiveEventStatus(event);

  return (
    <Link className={past ? "admin-card admin-card--past" : "admin-card"} to={to}>
      <div
        className="admin-card__media"
        style={event.heroImageUrl ? { backgroundImage: `url(${event.heroImageUrl})` } : undefined}
      >
        {event.heroImageUrl ? null : <ActivityScene className="admin-card__scene" />}
      </div>
      <div className="admin-card__body">
        <div className="admin-card__main">
          <div className="admin-card__pills">
            <Pill dot tone={getEventStatusTone(status)}>
              {getEventStatusLabel(status)}
            </Pill>
            <Pill>{getEventAudienceLabel(event.audience)}</Pill>
          </div>
          <h3 className="admin-card__title">{event.title}</h3>
          <div className="admin-card__meta">
            <p>
              <Icon name="calendar" />
              <span>{formatEventWhen(event)}</span>
            </p>
            <p>
              <Icon name="map-pin" />
              <span>{event.location.trim() || ANNUNCIATA.luogoDaDefinire}</span>
            </p>
          </div>
          {typeof registrationsCount === "number" || event.overnight ? (
            <div className="admin-card__pills">
              {typeof registrationsCount === "number" ? (
                <Pill tone="sand" icon="users">
                  {registrationsCount === 1
                    ? COPY.iscrittiUno
                    : fillCopy(COPY.iscritti, { n: String(registrationsCount) })}
                </Pill>
              ) : null}
              {event.overnight ? <Pill>{COPY.pernottamento}</Pill> : null}
            </div>
          ) : null}
        </div>
        <Icon name="arrow-right" className="admin-card__arrow" />
      </div>
    </Link>
  );
}
