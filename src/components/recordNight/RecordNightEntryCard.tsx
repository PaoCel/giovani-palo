import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import "@/styles/recordNight.css";

import type { Event } from "@/types";
import { RecordNightIcon } from "@/components/recordNight/RecordNightIcon";
import { recordNightService } from "@/services/firestore/recordNightService";
import { getRecordNightPath } from "@/utils/activityLinks";
import {
  formatRecordNightDeadline,
  getRecordNightCloseAt,
  getRecordNightWindow,
  isRecordVisibleToParticipants,
} from "@/utils/recordNight";

interface RecordNightEntryCardProps {
  event: Pick<Event, "id" | "recordsEnabled" | "recordsCloseAt" | "startDate">;
  stakeId: string;
  // Il conteggio dei record si legge solo con un account non anonimo del
  // palo: la rule nega gli altri, e senza login la card mostra solo l'invito.
  canReadRecords: boolean;
  // Classe in più per adattare la card al contenitore della pagina.
  className?: string;
}

// Ingresso alla Notte dei Record dalle pagine dell'attività (pubblica e del
// partecipante). Si mostra solo se l'attività ha `recordsEnabled`.
export function RecordNightEntryCard({
  event,
  stakeId,
  canReadRecords,
  className,
}: RecordNightEntryCardProps) {
  const [count, setCount] = useState<number | null>(null);
  const recordWindow = getRecordNightWindow(event);
  const closeAt = getRecordNightCloseAt(event);

  useEffect(() => {
    if (!canReadRecords || !stakeId || event.recordsEnabled !== true) {
      setCount(null);
      return;
    }
    let active = true;
    recordNightService
      .listRecords(stakeId, event.id)
      .then((records) => {
        if (active) setCount(records.filter(isRecordVisibleToParticipants).length);
      })
      .catch((error: unknown) => {
        // Il conteggio è un di più: senza, la card resta un invito alla pagina.
        console.warn("Notte dei Record: conteggio non disponibile.", error);
        if (active) setCount(null);
      });
    return () => {
      active = false;
    };
  }, [canReadRecords, event.id, event.recordsEnabled, stakeId]);

  if (recordWindow === "disabled") return null;

  const countText =
    count === null ? "" : count === 0 ? "Ancora nessun record" : `${count} record in gara`;
  const meta =
    recordWindow === "closed"
      ? [countText, "Iscrizioni chiuse"].filter(Boolean).join(" · ")
      : [countText, closeAt ? `chiude ${formatRecordNightDeadline(closeAt)}` : ""]
          .filter(Boolean)
          .join(" · ");
  const metaText = meta ? meta.charAt(0).toUpperCase() + meta.slice(1) : "";

  return (
    <section
      aria-labelledby={`rn-entry-${event.id}`}
      className={className ? `rn-entry ${className}` : "rn-entry"}
    >
      <div className="rn-entry__text">
        <h2 aria-label="Notte dei Record" className="rn-entry__title" id={`rn-entry-${event.id}`}>
          <span className="rn-entry__top">Notte dei</span>
          <span className="rn-title__big rn-entry__big" data-text="Record">
            <span>Record</span>
          </span>
        </h2>
        {metaText ? (
          <p className="rn-entry__meta">
            <i aria-hidden="true" className={recordWindow === "open" ? "rn-led" : "rn-led rn-led--off"} />
            {metaText}
          </p>
        ) : null}
      </div>
      <Link className="rn-entry__cta" to={getRecordNightPath(event.id, stakeId)}>
        Vai ai record
        <RecordNightIcon name="arrow" />
      </Link>
    </section>
  );
}
