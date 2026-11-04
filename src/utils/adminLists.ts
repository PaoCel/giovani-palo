// Regole degli elenchi admin (fase 6b del restyling): divisione delle attività
// in /admin/events e nome dei mesi del calendario per i lettori di schermo.
//
// Questo file lo carica anche Node (tests/): niente alias "@/" sui valori.

import type { Event } from "@/types";

import { ADMIN_ELENCHI } from "../copy/adminElenchi.ts";
import { fillCopy } from "../copy/parole.ts";

type ListedEvent = Pick<Event, "status" | "startDate" | "endDate">;

/** Finita (data di fine passata), conclusa o annullata: va tra le «Concluse». */
export function isPastAdminEvent(event: ListedEvent, now = Date.now()) {
  if (event.status === "cancelled" || event.status === "completed") return true;
  // Senza data di fine (anche null da un documento vecchio) non è passata:
  // new Date(null) sarebbe il 1° gennaio 1970.
  if (!event.endDate) return false;
  const end = new Date(event.endDate).getTime();
  return Number.isFinite(end) && end < now;
}

function startOf(event: ListedEvent) {
  if (!event.startDate) return 0;
  const start = new Date(event.startDate).getTime();
  return Number.isFinite(start) ? start : 0;
}

/**
 * Prima le attività da fare, la più vicina in alto; poi quelle finite o
 * annullate, la più recente in alto: l'admin non scorre il passato per
 * arrivare alle prossime.
 */
export function splitAdminEvents<T extends ListedEvent>(events: T[], now = Date.now()) {
  const upcoming = events.filter((event) => !isPastAdminEvent(event, now));
  const past = events.filter((event) => isPastAdminEvent(event, now));
  upcoming.sort((left, right) => startOf(left) - startOf(right));
  past.sort((left, right) => startOf(right) - startOf(left));
  return { upcoming, past };
}

/** Nome del riquadro del mese per i lettori di schermo: «Novembre, 3 attività». */
export function getMonthAriaLabel(monthLabel: string, count: number) {
  if (count === 0) return fillCopy(ADMIN_ELENCHI.meseSenzaAttivita, { mese: monthLabel });
  if (count === 1) return fillCopy(ADMIN_ELENCHI.meseConUnaAttivita, { mese: monthLabel });
  return fillCopy(ADMIN_ELENCHI.meseConAttivita, { mese: monthLabel, n: String(count) });
}
