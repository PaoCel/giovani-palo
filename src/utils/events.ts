import type { AuthSession, Event, EventAudience, EventFormConfig, GenderRoleCategory } from "@/types";

export type EventTone = "neutral" | "success" | "warning" | "danger" | "info";
export type RegistrationAvailability =
  | "open"
  | "login-required"
  | "guest-allowed"
  | "not-open-yet"
  | "closed"
  | "restricted-audience";

export function sanitizeEventAudience(value: unknown): EventAudience {
  switch (value) {
    case "giovane_uomo":
    case "giovane_donna":
      return value;
    default:
      return "congiunta";
  }
}

export function getEventAudienceLabel(audience: EventAudience) {
  switch (audience) {
    case "giovane_uomo":
      return "Solo GU";
    case "giovane_donna":
      return "Solo GD";
    default:
      return "Congiunta";
  }
}

export function getAudienceRestrictionMessage(audience: EventAudience) {
  if (audience === "giovane_uomo") {
    return "Questa attività è riservata ai giovani uomini e ai dirigenti.";
  }

  if (audience === "giovane_donna") {
    return "Questa attività è riservata alle giovani donne e ai dirigenti.";
  }

  return "";
}

export function getAllowedCategoriesForAudience(audience: EventAudience): GenderRoleCategory[] {
  if (audience === "congiunta") {
    return ["giovane_uomo", "giovane_donna", "dirigente"];
  }

  return [audience, "dirigente"];
}

export function isEventAudienceEligible(
  event: Pick<Event, "audience">,
  category: GenderRoleCategory | "",
) {
  if (!category) {
    return event.audience === "congiunta";
  }

  if (category === "dirigente" || event.audience === "congiunta") {
    return true;
  }

  return category === event.audience;
}

export function eventSpansMultipleCalendarDays(startDate: string, endDate: string) {
  if (!startDate || !endDate) {
    return false;
  }

  return new Date(startDate).toDateString() !== new Date(endDate).toDateString();
}

export function getEventStatusTone(status: Event["status"]): EventTone {
  switch (status) {
    case "registrations_open":
      return "success";
    case "confirmed":
      return "info";
    case "planned":
    case "draft":
      return "warning";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export function getEventStatusLabel(status: Event["status"]) {
  switch (status) {
    case "planned":
      return "In programma";
    case "confirmed":
      return "Confermata";
    case "registrations_open":
      return "Iscrizioni aperte";
    case "registrations_closed":
      return "Iscrizioni chiuse";
    case "completed":
      return "Conclusa";
    case "cancelled":
      return "Annullata";
    default:
      return "Bozza";
  }
}

export function getEffectiveEventStatus(
  event: Pick<Event, "status" | "isPublic" | "registrationOpen" | "registrationClose">,
): Extract<Event["status"], "draft" | "registrations_open" | "registrations_closed" | "cancelled"> {
  if (event.status === "cancelled") {
    return "cancelled";
  }

  if (!event.isPublic || event.status === "draft") {
    return "draft";
  }

  const now = Date.now();
  const opensAt = new Date(event.registrationOpen).getTime();
  const closesAt = new Date(event.registrationClose).getTime();

  if (Number.isNaN(opensAt) || Number.isNaN(closesAt)) {
    return "registrations_closed";
  }

  return now >= opensAt && now <= closesAt
    ? "registrations_open"
    : "registrations_closed";
}

export function getRegistrationAvailability(
  event: Event,
  formConfig: EventFormConfig,
  session: AuthSession | null,
): RegistrationAvailability {
  const now = Date.now();
  const opensAt = new Date(event.registrationOpen).getTime();
  const closesAt = new Date(event.registrationClose).getTime();

  if (event.status === "cancelled" || event.status === "completed") {
    return "closed";
  }

  if (event.status !== "registrations_open") {
    return now < opensAt ? "not-open-yet" : "closed";
  }

  if (now < opensAt) {
    return "not-open-yet";
  }

  if (now > closesAt) {
    return "closed";
  }

  if (session?.isAuthenticated && !session.isAnonymous) {
    if (!isEventAudienceEligible(event, session.profile.genderRoleCategory)) {
      return "restricted-audience";
    }

    return "open";
  }

  return formConfig.allowGuestRegistration ? "guest-allowed" : "login-required";
}

export function isPastEvent(event: Event) {
  return new Date(event.endDate).getTime() < Date.now();
}
