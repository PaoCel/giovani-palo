// Schede della scheda attività admin (/admin/events/:id): quale scheda apre una
// rotta, quale rotta apre una scheda, e quali schede si vedono. Estratte da
// AdminEventDetailPage nel restyling (fase 6c) senza cambiare rotte né deep link.
//
// Questo file lo carica anche Node (tests/): niente alias "@/" sui valori.

import { MOMENTI } from "../copy/momenti.ts";

export type AdminEventTab =
  | "details"
  | "program"
  | "committees"
  | "registrations"
  | "consents"
  | "overnight"
  | "questions"
  | "records"
  | "surveys"
  | "gallery"
  | "stats";

export interface AdminEventTabsOptions {
  isAdmin: boolean;
  overnight: boolean;
  /** «Stanze» o «Tende», secondo il tipo di pernottamento. */
  overnightLabel: string;
  questionsEnabled: boolean;
  recordsEnabled: boolean;
}

/** Le schede visibili, nell'ordine della barra. */
export function getAdminEventTabs({
  isAdmin,
  overnight,
  overnightLabel,
  questionsEnabled,
  recordsEnabled,
}: AdminEventTabsOptions): { id: AdminEventTab; label: string }[] {
  return [
    { id: "details", label: "Dettagli" },
    ...(isAdmin ? [{ id: "program" as const, label: MOMENTI.programma }] : []),
    { id: "committees", label: "Comitati" },
    { id: "registrations", label: "Iscritti" },
    { id: "consents", label: "Consensi" },
    ...(overnight ? [{ id: "overnight" as const, label: overnightLabel }] : []),
    ...(questionsEnabled ? [{ id: "questions" as const, label: "Domande" }] : []),
    ...(recordsEnabled ? [{ id: "records" as const, label: "Record" }] : []),
    { id: "surveys", label: "Sondaggi" },
    { id: "gallery", label: "Galleria" },
    { id: "stats", label: "Statistiche" },
  ];
}

export function getAdminEventTabFromPath(pathname: string, search = ""): AdminEventTab {
  if (pathname.endsWith("/committees") || pathname.endsWith("/comitati")) {
    return "committees";
  }

  if (pathname.endsWith("/registrations")) {
    return "registrations";
  }

  if (pathname.endsWith("/consents")) {
    return "consents";
  }

  if (pathname.endsWith("/rooms")) {
    return "overnight";
  }

  if (pathname.endsWith("/questions")) {
    return "questions";
  }

  if (pathname.endsWith("/surveys") || pathname.endsWith("/sondaggi")) {
    return "surveys";
  }

  // `/galleria` è registrata nel router come `/gallery`: prima del restyling
  // apriva Dettagli.
  if (pathname.endsWith("/gallery") || pathname.endsWith("/galleria")) {
    return "gallery";
  }

  if (pathname.endsWith("/stats")) {
    return "stats";
  }

  if (new URLSearchParams(search).get("tab") === "program") return "program";

  // La scheda Record vive sulla rotta di base con `?tab=records` (nessuna
  // rotta nuova da registrare); `/records` è riconosciuto se la si aggiunge.
  if (
    pathname.endsWith("/records") ||
    new URLSearchParams(search).get("tab") === "records"
  ) {
    return "records";
  }

  return "details";
}

export function getAdminEventTabHref(eventId: string, tab: AdminEventTab) {
  switch (tab) {
    case "program":
      return `/admin/events/${eventId}?tab=program`;
    case "committees":
      return `/admin/events/${eventId}/comitati`;
    case "registrations":
      return `/admin/events/${eventId}/registrations`;
    case "consents":
      return `/admin/events/${eventId}/consents`;
    case "overnight":
      return `/admin/events/${eventId}/rooms`;
    case "questions":
      return `/admin/events/${eventId}/questions`;
    case "records":
      return `/admin/events/${eventId}?tab=records`;
    case "surveys":
      return `/admin/events/${eventId}/surveys`;
    case "gallery":
      return `/admin/events/${eventId}/gallery`;
    case "stats":
      return `/admin/events/${eventId}/stats`;
    default:
      return `/admin/events/${eventId}`;
  }
}
