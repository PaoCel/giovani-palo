// Crea attività a sei step (docs/ATTIVITA_MODULARI.md, «Sesto incremento»).
// Logica pura del foglio: quali campi appartengono a ogni step, come si
// validano, come diventano il payload di sempre (stessi campi, stesse rules)
// e cosa dice l'indice degli step. Import relativi con estensione: i test di
// tests/ caricano questo file con Node.

import type {
  ActivityType,
  CustomField,
  Event,
  EventAudience,
  EventFormConfig,
  EventStatus,
  EventWriteInput,
  StandardFieldKey,
} from "../types/models.ts";
import { EVENT_CREATION as COPY } from "../copy/eventCreation.ts";
import { getPublicationIssues } from "./eventCreation.ts";
import { eventSpansMultipleCalendarDays } from "./events.ts";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "./formatters.ts";
import { isRecordsCloseAfterEnd } from "./recordNight.ts";
import { slugify } from "./slugify.ts";

export type WizardStepId = "what" | "when" | "poster" | "registrations" | "participants" | "review";

export const WIZARD_STEPS: readonly WizardStepId[] = ["what", "when", "poster", "registrations", "participants", "review"];

/** Step che si raggiungono solo quando la bozza esiste (nasce allo step 2). */
export function stepNeedsDraft(step: WizardStepId) {
  return WIZARD_STEPS.indexOf(step) >= 2;
}

export function stepNumber(step: WizardStepId) {
  return WIZARD_STEPS.indexOf(step) + 1;
}

export interface WizardValues {
  // 1 · Cos'è
  title: string;
  activityType: ActivityType;
  audience: EventAudience;
  // 2 · Quando e dove (valori datetime-local)
  startDate: string;
  endDate: string;
  location: string;
  /** Ora non ancora scelta (rapida): le ore 00:00/23:59 si mostrano vuote. */
  timeToBeDefined: boolean;
  // 3 · Locandina e descrizione
  heroImageUrl: string;
  heroImagePath: string;
  description: string;
  // 4 · Iscrizioni (anche il modulo)
  registrationOpen: string;
  registrationClose: string;
  maxParticipants: string;
  requiresAccount: boolean;
  allowGuestRegistration: boolean;
  requiresParentAuthorization: boolean;
  requiresEmergencyContacts: boolean;
  requiresMedicalNotes: boolean;
  requiresImageConsent: boolean;
  enabledStandardFields: StandardFieldKey[];
  customFields: CustomField[];
  // 5 · Per i partecipanti
  program: string;
  whatToBring: string;
  menuInfo: string;
  allergiesInfo: string;
  roomsInfo: string;
  organizerNotes: string;
  questionsEnabled: boolean;
  recordsEnabled: boolean;
  recordsCloseAt: string;
  recordsGuestEnabled: boolean;
}

export const STEP_FIELDS: Record<WizardStepId, readonly (keyof WizardValues)[]> = {
  what: ["title", "activityType", "audience"],
  when: ["startDate", "endDate", "location", "timeToBeDefined"],
  poster: ["heroImageUrl", "heroImagePath", "description"],
  registrations: [
    "registrationOpen", "registrationClose", "maxParticipants", "requiresAccount", "allowGuestRegistration",
    "requiresParentAuthorization", "requiresEmergencyContacts", "requiresMedicalNotes", "requiresImageConsent",
    "enabledStandardFields", "customFields",
  ],
  participants: [
    "program", "whatToBring", "menuInfo", "allergiesInfo", "roomsInfo", "organizerNotes",
    "questionsEnabled", "recordsEnabled", "recordsCloseAt", "recordsGuestEnabled",
  ],
  review: [],
};

/** Campi del modulo che servono ai flussi (età, unità, destinatari): si mostrano come «Sempre chiesti». */
export const ALWAYS_ASKED_FIELDS: readonly StandardFieldKey[] = ["birthDate", "genderRoleCategory", "unitName"];

export function isStrongActivity(type: ActivityType) {
  return type !== "standard";
}

function localValue(isoDate?: string | null) {
  if (!isoDate || Number.isNaN(new Date(isoDate).getTime())) return "";
  return toDatetimeLocalValue(isoDate);
}

export function getInitialWizardValues(event: Event | null, config: EventFormConfig | null, defaults?: {
  allowGuestRegistration?: boolean;
  enabledStandardFields?: StandardFieldKey[];
}): WizardValues {
  const activityType: ActivityType = event?.activityType ?? (event?.overnight ? "overnight" : "standard");
  const strong = isStrongActivity(activityType);
  return {
    title: event?.title ?? "",
    activityType,
    audience: event?.audience ?? "congiunta",
    startDate: localValue(event?.startDate),
    endDate: localValue(event?.endDate),
    location: event?.location ?? "",
    timeToBeDefined: event?.timeToBeDefined === true,
    heroImageUrl: event?.heroImageUrl ?? "",
    heroImagePath: event?.heroImagePath ?? "",
    description: event?.description ?? "",
    registrationOpen: localValue(event?.registrationOpen),
    registrationClose: localValue(event?.registrationClose),
    maxParticipants: typeof event?.maxParticipants === "number" ? String(event.maxParticipants) : "",
    requiresAccount: event?.requiresAccount ?? strong,
    allowGuestRegistration: config?.allowGuestRegistration ?? event?.allowGuestRegistration ?? defaults?.allowGuestRegistration ?? true,
    requiresParentAuthorization: event?.requiresParentAuthorization ?? strong,
    requiresEmergencyContacts: event?.requiresEmergencyContacts ?? strong,
    requiresMedicalNotes: event?.requiresMedicalNotes ?? strong,
    requiresImageConsent: event?.requiresImageConsent ?? event?.requiresPhotoRelease ?? false,
    enabledStandardFields: [...(config?.enabledStandardFields ?? defaults?.enabledStandardFields ?? [])],
    customFields: (config?.customFields ?? []).map(field => ({ ...field, options: [...(field.options ?? [])] })),
    program: event?.program ?? "",
    whatToBring: event?.whatToBring ?? "",
    menuInfo: event?.menuInfo ?? "",
    allergiesInfo: event?.allergiesInfo ?? "",
    roomsInfo: event?.roomsInfo ?? "",
    organizerNotes: event?.organizerNotes ?? "",
    questionsEnabled: event?.questionsEnabled ?? false,
    recordsEnabled: event?.recordsEnabled ?? false,
    recordsCloseAt: localValue(event?.recordsCloseAt),
    recordsGuestEnabled: event?.recordsGuestEnabled ?? false,
  };
}

const validDate = (value: string) => Boolean(value) && Number.isFinite(Date.parse(value));

/** Pernottamento effettivo: tipo rafforzato e date su due giorni di calendario. */
export function hasOvernight(values: Pick<WizardValues, "activityType" | "startDate" | "endDate">) {
  return isStrongActivity(values.activityType) && eventSpansMultipleCalendarDays(values.startDate, values.endDate);
}

export type FieldErrors = Partial<Record<keyof WizardValues | "recordsGuestReviewed" | `customField:${string}`, string>>;

export interface StepValidationContext {
  /** Record senza account accesi ora: serve la spunta «Ho controllato i titoli». */
  guestReviewMissing?: boolean;
  /**
   * L'attività esiste già (rapida): il luogo serve solo per aprire le
   * iscrizioni e sta nella lista «Da completare», non blocca Avanti.
   */
  locationOptional?: boolean;
}

/**
 * Fine «senza ora» della rapida: 23:59. Il passo 2 salvato con un'ora di fine
 * vera toglie `timeToBeDefined` (l'ora d'inizio da sola dice «dalle 19:00»).
 */
export function isOpenEndTime(localValue: string) {
  return splitLocalDateTime(localValue).time === "23:59";
}

/** Errori dei campi di uno step: vuoto vuol dire che lo step si può salvare. */
export function validateWizardStep(step: WizardStepId, values: WizardValues, context: StepValidationContext = {}): FieldErrors {
  const errors: FieldErrors = {};
  if (step === "what") {
    if (!values.title.trim()) errors.title = COPY.errors.title;
  }
  if (step === "when") {
    if (!validDate(values.startDate)) errors.startDate = COPY.errors.start;
    if (!validDate(values.endDate)) errors.endDate = COPY.errors.end;
    else if (validDate(values.startDate) && Date.parse(values.endDate) < Date.parse(values.startDate)) errors.endDate = COPY.errors.endBeforeStart;
    if (!values.location.trim() && !context.locationOptional) errors.location = COPY.errors.location;
  }
  if (step === "registrations") {
    if (values.registrationOpen && !validDate(values.registrationOpen)) errors.registrationOpen = COPY.errors.date;
    if (values.registrationClose && !validDate(values.registrationClose)) errors.registrationClose = COPY.errors.date;
    else if (validDate(values.registrationOpen) && validDate(values.registrationClose)
      && Date.parse(values.registrationClose) < Date.parse(values.registrationOpen)) errors.registrationClose = COPY.errors.closeBeforeOpen;
    const max = values.maxParticipants.trim();
    if (max && (!/^\d+$/u.test(max) || Number(max) < 1)) errors.maxParticipants = COPY.errors.maxParticipants;
    for (const field of values.customFields) {
      if (!field.label.trim()) errors[`customField:${field.id}`] = COPY.errors.questionLabel;
    }
  }
  if (step === "participants") {
    if (values.recordsEnabled && isRecordsCloseAfterEnd(values.recordsCloseAt, values.endDate)) errors.recordsCloseAt = COPY.errors.recordsClose;
    if (values.recordsEnabled && values.recordsGuestEnabled && context.guestReviewMissing) errors.recordsGuestReviewed = COPY.errors.guestReview;
  }
  return errors;
}

function statusAfterSave(saved: Event | null): Pick<EventWriteInput, "status" | "isPublic" | "isVisible"> {
  if (!saved || !saved.isPublic) {
    // A draft stays a draft; a cancelled draft keeps its state.
    const status: EventStatus = saved?.status === "cancelled" || saved?.status === "completed" ? saved.status : "draft";
    return { status, isPublic: false, isVisible: saved?.isVisible ?? false };
  }
  if (saved.status === "cancelled" || saved.status === "completed") return { status: saved.status, isPublic: true, isVisible: saved.isVisible };
  // Annunciata (settimo incremento): every step saved keeps it announced;
  // only «Apri le iscrizioni» (publishEvent) opens registrations.
  if (saved.status === "planned") return { status: "planned", isPublic: true, isVisible: saved.isVisible };
  // The existing rules accept registrations only with registrations_open,
  // also for a future publication: dates gate availability in the client.
  return { status: "registrations_open", isPublic: true, isVisible: saved.isVisible };
}

export interface WizardFormPayload {
  enabledStandardFields: StandardFieldKey[];
  customFields: CustomField[];
  allowGuestRegistration: boolean;
}

/**
 * Payload completo dell'attività. I campi degli step in `fromSteps` vengono da
 * `values`; gli altri restano quelli salvati, così uno step lasciato a metà
 * (Indietro su campi non validi) non finisce in un salvataggio di un altro step.
 */
export function buildWizardPayload(values: WizardValues, saved: Event | null, fromSteps: ReadonlySet<WizardStepId>, versions: {
  participation: string; privacy: string; photo: string;
}, defaults?: Parameters<typeof getInitialWizardValues>[2]): EventWriteInput {
  // A new draft takes the stake defaults for the steps not filled yet
  // (e.g. «Anche senza account» switched off for the whole stake).
  const base = getInitialWizardValues(saved, null, defaults);
  const pick = <K extends keyof WizardValues>(key: K): WizardValues[K] => {
    const owner = WIZARD_STEPS.find(step => STEP_FIELDS[step].includes(key));
    return owner && fromSteps.has(owner) ? values[key] : base[key];
  };
  const startDate = pick("startDate");
  const endDate = pick("endDate");
  const activityType = pick("activityType");
  const overnight = hasOvernight({ activityType, startDate, endDate });
  const requiresAccount = pick("requiresAccount");
  const recordsEnabled = pick("recordsEnabled");
  const recordsCloseAt = pick("recordsCloseAt");
  const maxParticipants = pick("maxParticipants").trim();
  const iso = (value: string) => (validDate(value) ? fromDatetimeLocalValue(value) : "");
  return {
    title: pick("title").trim(),
    description: pick("description").trim(),
    year: validDate(startDate) ? new Date(startDate).getFullYear() : saved?.year ?? new Date().getFullYear(),
    audience: pick("audience"),
    startDate: iso(startDate),
    endDate: iso(endDate),
    location: pick("location").trim(),
    timeToBeDefined: pick("timeToBeDefined") && isOpenEndTime(endDate),
    program: pick("program").trim(),
    publicNotes: saved?.publicNotes ?? "",
    organizerNotes: pick("organizerNotes").trim(),
    menuInfo: pick("menuInfo").trim(),
    allergiesInfo: pick("allergiesInfo").trim(),
    roomsInfo: overnight ? pick("roomsInfo").trim() : "",
    whatToBring: pick("whatToBring").trim(),
    heroImageUrl: pick("heroImageUrl").trim(),
    heroImagePath: pick("heroImagePath").trim(),
    ...statusAfterSave(saved),
    registrationOpen: iso(pick("registrationOpen")),
    registrationClose: iso(pick("registrationClose")),
    maxParticipants: maxParticipants ? Number(maxParticipants) : null,
    overnight,
    activityType,
    requiresAccount,
    requiresParentAuthorization: pick("requiresParentAuthorization"),
    requiresEmergencyContacts: pick("requiresEmergencyContacts"),
    requiresMedicalNotes: pick("requiresMedicalNotes"),
    requiresImageConsent: pick("requiresImageConsent"),
    consentVersionId: saved?.consentVersionId ?? versions.participation,
    privacyNoticeVersionId: saved?.privacyNoticeVersionId ?? versions.privacy,
    imageConsentVersionId: saved?.imageConsentVersionId ?? versions.photo,
    templateId: saved?.templateId ?? null,
    allowGuestRegistration: requiresAccount ? false : pick("allowGuestRegistration"),
    // Decisione 4 (5 novembre): non è più una scelta. Acceso sulle attività
    // nuove; le esistenti tengono il loro valore.
    requireLoginForEdit: saved ? saved.requireLoginForEdit !== false : true,
    questionsEnabled: pick("questionsEnabled"),
    recordsEnabled,
    // The date survives a switched-off module, so switching it on keeps it.
    recordsCloseAt: validDate(recordsCloseAt) ? fromDatetimeLocalValue(recordsCloseAt) : null,
    // Switched off with the module: switching it on again needs a new review.
    recordsGuestEnabled: recordsEnabled ? pick("recordsGuestEnabled") : false,
    // Legacy MVP flags: every save clears them (see the old editor).
    requiresParentalConsent: false,
    requiresPhotoRelease: false,
  };
}

export function buildWizardFormPayload(values: WizardValues): WizardFormPayload {
  // Answers live in registration.answers[key]: a new key must not collide with
  // a standard field or another question. Existing keys never change.
  const taken = new Set<string>([...values.enabledStandardFields, ...values.customFields.map(field => field.key).filter(Boolean)]);
  const newKey = (field: CustomField) => {
    const root = slugify(field.label) || field.id;
    let key = root;
    for (let n = 2; taken.has(key); n += 1) key = `${root}-${n}`;
    taken.add(key);
    return key;
  };
  return {
    enabledStandardFields: [...values.enabledStandardFields],
    customFields: values.customFields.map(field => ({
      ...field,
      key: field.key || newKey(field),
      label: field.label.trim(),
      helpText: field.helpText?.trim() ?? "",
      options: field.type === "select" ? (field.options ?? []).map(option => option.trim()).filter(Boolean) : [],
    })),
    allowGuestRegistration: values.requiresAccount ? false : values.allowGuestRegistration,
  };
}

/** Requisiti da accendere o spegnere al passaggio tra «In giornata» e un tipo rafforzato. */
export function getTypeChangeEffects(previous: ActivityType, next: ActivityType, values: Pick<WizardValues, "roomsInfo">) {
  const wasStrong = isStrongActivity(previous);
  const isStrong = isStrongActivity(next);
  if (wasStrong === isStrong) return null;
  return {
    turnsOn: isStrong,
    clearsRooms: !isStrong && values.roomsInfo.trim().length > 0,
    requirements: {
      requiresAccount: isStrong,
      requiresParentAuthorization: isStrong,
      requiresEmergencyContacts: isStrong,
      requiresMedicalNotes: isStrong,
      // Switching back to a same-day activity switches off the photo consent
      // too (it lives inside the parent authorization).
      ...(isStrong ? {} : { requiresImageConsent: false }),
    } satisfies Partial<WizardValues>,
  };
}

/**
 * Suggerimento dello step 2: «In giornata» che finisce il giorno dopo propone
 * il pernottamento; «Con pernottamento» in un giorno solo propone «In giornata».
 */
export function getDayTypeSuggestion(values: Pick<WizardValues, "activityType" | "startDate" | "endDate">): ActivityType | null {
  if (!validDate(values.startDate) || !validDate(values.endDate) || Date.parse(values.endDate) < Date.parse(values.startDate)) return null;
  const spans = eventSpansMultipleCalendarDays(values.startDate, values.endDate);
  if (values.activityType === "standard" && spans) return "overnight";
  if (values.activityType === "overnight" && !spans) return "standard";
  return null;
}

export interface PublicationCheck { step: WizardStepId; message: string }

type ChecklistEvent = Pick<Event, "title" | "description" | "startDate" | "endDate" | "location" | "registrationOpen" | "registrationClose" | "status">;

/**
 * Cosa manca per pubblicare, ogni voce con lo step che la risolve. Le voci sono
 * quelle di getPublicationIssues (stesse frasi, stesso controllo del servizio),
 * più la chiusura delle iscrizioni già passata, che blocca solo la pubblicazione.
 */
export function getPublicationChecklist(event: ChecklistEvent, now = Date.now()): PublicationCheck[] {
  const checks: PublicationCheck[] = [];
  const issues = getPublicationIssues(event);
  for (const message of issues) {
    const step: WizardStepId = message === COPY.cancelled
      ? "review"
      : /descrizione/u.test(message)
        ? "poster"
        : /iscrizion/u.test(message)
          ? "registrations"
          : /nome e luogo/u.test(message) && !event.title.trim()
            ? "what"
            : "when";
    checks.push({ step, message });
  }
  if (validDate(event.registrationClose) && Date.parse(event.registrationClose) < now
    && !issues.some(message => /iscrizion/u.test(message))) {
    checks.push({ step: "registrations", message: COPY.closePassed });
  }
  return checks;
}

export type StepState = "done" | "todo" | "optional" | "locked" | "current";

export interface StepSummary {
  step: WizardStepId;
  state: Exclude<StepState, "current">;
  label: string;
}

/** Stato di ogni step per l'indice e il riepilogo, calcolato dall'attività salvata. */
export function getStepSummaries(event: Event | null, now = Date.now()): StepSummary[] {
  const checks = event ? getPublicationChecklist(event, now) : [];
  return WIZARD_STEPS.map((step): StepSummary => {
    if (!event) {
      if (stepNeedsDraft(step)) return { step, state: "locked", label: COPY.index.locked };
      return { step, state: "todo", label: COPY.index.todo };
    }
    if (step === "review") {
      const open = event.isPublic && event.status !== "planned";
      return { step, state: open ? "done" : "todo", label: open ? COPY.index.published : "" };
    }
    if (step === "participants") {
      const filled = Boolean(event.program || event.whatToBring || event.menuInfo || event.allergiesInfo || event.roomsInfo
        || event.organizerNotes || event.questionsEnabled || event.recordsEnabled);
      return { step, state: filled ? "done" : "optional", label: filled ? COPY.index.done : COPY.index.optional };
    }
    const own = checks.filter(check => check.step === step);
    if (!own.length) return { step, state: "done", label: COPY.index.done };
    if (step === "poster") return { step, state: "todo", label: COPY.index.missingDescription };
    return { step, state: "todo", label: COPY.index.todo };
  });
}

/** Ha cambiato qualcosa nei campi dello step rispetto all'ultima versione salvata? */
export function isStepDirty(step: WizardStepId, values: WizardValues, savedValues: WizardValues) {
  return STEP_FIELDS[step].some(key => JSON.stringify(values[key]) !== JSON.stringify(savedValues[key]));
}

/** Iscrizioni attive per l'avviso della decisione 3. */
export function countActiveRegistrations(event: Pick<Event, "statsSummary"> | null) {
  const summary = event?.statsSummary;
  return summary?.totalActiveRegistrations ?? summary?.confirmedRegistrations ?? 0;
}

/** Valore datetime-local diviso in data e ora per i due campi dello step 2. */
export function splitLocalDateTime(value: string) {
  const [date = "", time = ""] = value.split("T");
  return { date, time: time.slice(0, 5) };
}

export function joinLocalDateTime(date: string, time: string, fallbackTime: string) {
  if (!date) return "";
  return `${date}T${time || fallbackTime}`;
}
