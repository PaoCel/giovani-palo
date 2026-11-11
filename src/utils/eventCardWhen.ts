import type { Event } from "@/types";

import { formatEventStart, formatEventWhen, isMidnight } from "./formatters";

type CardWhenEvent = Pick<Event, "startDate" | "endDate"> & { timeToBeDefined?: boolean };

/**
 * «Quando» per le card (catalogo, /me): con l'ora ancora da scegliere solo il
 * giorno, senza «ora da definire» (docs/ATTIVITA_MODULARI.md, resa con dati
 * mancanti). In tutti gli altri casi è `formatEventWhen`.
 */
export function formatEventCardWhen(event: CardWhenEvent) {
  const sameDay = new Date(event.startDate).toDateString() === new Date(event.endDate || event.startDate).toDateString();
  if (event.timeToBeDefined && sameDay && isMidnight(event.startDate)) {
    return formatEventStart(event);
  }
  return formatEventWhen(event);
}
