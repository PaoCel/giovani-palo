import type { ActivityType, Event, EventWriteInput } from "../types/models.ts";
import { eventSpansMultipleCalendarDays } from "./events.ts";
import { fromDatetimeLocalValue } from "./formatters.ts";
import { EVENT_CREATION } from "../copy/eventCreation.ts";

type RequirementChanges = Partial<Pick<EventWriteInput,
  "requiresAccount" | "requiresParentAuthorization" | "requiresEmergencyContacts" | "requiresMedicalNotes"
>>;

export function getActivityRequirementChanges(previousType: ActivityType, nextType: ActivityType): RequirementChanges {
  const wasStrong = previousType !== "standard";
  const isStrong = nextType !== "standard";
  if (wasStrong === isStrong) return {};
  return {
    requiresAccount: isStrong,
    requiresParentAuthorization: isStrong,
    requiresEmergencyContacts: isStrong,
    requiresMedicalNotes: isStrong,
  };
}

// Keep the existing ISO revision field strictly increasing, including two
// commits in the same millisecond and clients whose clock is behind.
export function nextEventRevision(previous?: string, now = Date.now()): string {
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now).toISOString();
}

export function assertEventRevision(current: unknown, expected?: string): void {
  if (expected && typeof current === "string" && current !== expected) {
    throw new Error(EVENT_CREATION.revisionConflict);
  }
}

export interface EssentialDraftValues {
  title: string;
  activityType: ActivityType;
  startDate: string;
  endDate: string;
  location: string;
}

const validDate = (value: string) => Boolean(value) && Number.isFinite(Date.parse(value));

export function validateEssentialDraft(values: EssentialDraftValues): string | null {
  if (!values.title.trim() || !values.location.trim()) return "Inserisci nome e luogo dell'attività.";
  if (!validDate(values.startDate) || !validDate(values.endDate)) return "Scegli inizio e fine dell'attività.";
  if (Date.parse(values.endDate) < Date.parse(values.startDate)) return "La data di fine deve essere successiva alla data di inizio.";
  return null;
}

export function buildEssentialDraft(
  values: EssentialDraftValues,
  defaults?: { allowGuestRegistration: boolean; requireLoginForEdit: boolean },
): EventWriteInput {
  const strong = values.activityType !== "standard";
  return {
    title: values.title.trim(), description: "", year: new Date(values.startDate).getFullYear(),
    audience: "congiunta", startDate: fromDatetimeLocalValue(values.startDate),
    endDate: fromDatetimeLocalValue(values.endDate), location: values.location.trim(),
    activityType: values.activityType, overnight: strong && eventSpansMultipleCalendarDays(values.startDate, values.endDate),
    program: "", heroImageUrl: "", status: "draft", isPublic: false, isVisible: false,
    registrationOpen: "", registrationClose: "", maxParticipants: null,
    requiresAccount: strong, requiresParentAuthorization: strong,
    requiresEmergencyContacts: strong, requiresMedicalNotes: strong,
    requiresParentalConsent: false, requiresPhotoRelease: false,
    allowGuestRegistration: defaults?.allowGuestRegistration ?? true,
    requireLoginForEdit: defaults?.requireLoginForEdit ?? true,
  };
}

type PublicationEvent = Pick<Event, "title" | "description" | "startDate" | "endDate" | "location" | "registrationOpen" | "registrationClose" | "status">;

export function getPublicationIssues(event: PublicationEvent): string[] {
  const issues: string[] = [];
  const essentialIssue = validateEssentialDraft({ ...event, activityType: "standard" });
  if (essentialIssue) issues.push(essentialIssue);
  if (!event.description.trim()) issues.push("Aggiungi una descrizione per chi legge l'attività.");
  if (!validDate(event.registrationOpen) || !validDate(event.registrationClose)) issues.push("Scegli apertura e chiusura delle iscrizioni.");
  else if (Date.parse(event.registrationClose) < Date.parse(event.registrationOpen)) issues.push("La chiusura iscrizioni deve essere successiva all'apertura.");
  if (event.status === "cancelled" || event.status === "completed") issues.push("Un'attività annullata o conclusa non può essere pubblicata da questo percorso.");
  return issues;
}
