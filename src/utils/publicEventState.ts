// Stato di un'attività per chi non è iscritto: pill del catalogo, del
// dettaglio pubblico e di /me/activities. Segue la stessa regola del tasto
// d'iscrizione (getRegistrationAvailability in ./events.ts), più la fine
// dell'attività. Prima la pill leggeva solo `event.status`: il 4 novembre 2026
// tre attività finite su cinque dicevano «Iscrizioni aperte» mentre il tasto
// diceva «Iscrizioni non disponibili».
//
// Questo file lo carica anche Node (tests/): niente alias "@/" sui valori.

import type { Event } from "@/types";

import { CATALOGO } from "../copy/catalogo.ts";
import { MOMENTI } from "../copy/momenti.ts";
import { fillCopy } from "../copy/parole.ts";

export type PublicEventPhase = "draft" | "open" | "upcoming" | "closed" | "ended" | "cancelled";
export type PublicEventTone = "success" | "info" | "warning" | "neutral" | "danger";

export interface PublicEventState {
  phase: PublicEventPhase;
  label: string;
  tone: PublicEventTone;
}

type StateEvent = Pick<
  Event,
  "status" | "startDate" | "endDate" | "registrationOpen" | "registrationClose"
>;

function toTime(value: string) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

/** Finita quando è passata la fine (o l'inizio, se la fine manca). */
export function hasEventEnded(event: Pick<Event, "startDate" | "endDate">, now = Date.now()) {
  const end = toTime(event.endDate) ?? toTime(event.startDate);
  return end !== null && end < now;
}

function formatOpeningDay(value: string, now: number) {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

export function getPublicEventPhase(event: StateEvent, now = Date.now()): PublicEventPhase {
  if (event.status === "cancelled") {
    return "cancelled";
  }

  if (event.status === "draft") {
    return "draft";
  }

  if (event.status === "completed" || hasEventEnded(event, now)) {
    return "ended";
  }

  const opensAt = toTime(event.registrationOpen);
  const closesAt = toTime(event.registrationClose);
  const beforeOpening = opensAt !== null && now < opensAt;

  if (event.status !== "registrations_open") {
    return beforeOpening ? "upcoming" : "closed";
  }

  if (beforeOpening) {
    return "upcoming";
  }

  return closesAt !== null && now > closesAt ? "closed" : "open";
}

export function getPublicEventState(event: StateEvent, now = Date.now()): PublicEventState {
  const phase = getPublicEventPhase(event, now);

  switch (phase) {
    case "open":
      return { phase, label: CATALOGO.iscrizioniAperte, tone: "success" };
    case "upcoming":
      return {
        phase,
        label: fillCopy(MOMENTI.apreIl, { data: formatOpeningDay(event.registrationOpen, now) }),
        tone: "info",
      };
    case "closed":
      return { phase, label: MOMENTI.iscrizioniChiuse, tone: "warning" };
    case "cancelled":
      return { phase, label: CATALOGO.annullata, tone: "danger" };
    case "draft":
      return { phase, label: CATALOGO.bozza, tone: "neutral" };
    default:
      return { phase, label: CATALOGO.conclusa, tone: "neutral" };
  }
}

/** «Le iscrizioni chiudono tra 3 giorni» quando mancano meno di 7 giorni, altrimenti null. */
export function getRegistrationCountdown(registrationClose: string, now = Date.now()) {
  const closesAt = toTime(registrationClose);
  if (closesAt === null || closesAt <= now) {
    return null;
  }

  const remaining = closesAt - now;
  const days = Math.floor(remaining / 86_400_000);
  if (days >= 7) {
    return null;
  }

  let when: string;
  if (days >= 1) {
    when = days === 1 ? CATALOGO.traUnGiorno : fillCopy(CATALOGO.traGiorni, { numero: String(days) });
  } else {
    const hours = Math.floor(remaining / 3_600_000);
    if (hours >= 1) {
      when = hours === 1 ? CATALOGO.traUnOra : fillCopy(CATALOGO.traOre, { numero: String(hours) });
    } else {
      const minutes = Math.max(1, Math.floor(remaining / 60_000));
      when =
        minutes === 1
          ? CATALOGO.traUnMinuto
          : fillCopy(CATALOGO.traMinuti, { numero: String(minutes) });
    }
  }

  return fillCopy(CATALOGO.chiudonoTra, { quando: when });
}
