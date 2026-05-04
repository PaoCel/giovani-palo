import type {
  EventFormConfig,
  Registration,
  RegistrationAnswerValue,
  RegistrationStatus,
} from "@/types";
import { isMinorBirthDate } from "@/utils/age";
import {
  normalizeStandardFieldKeys,
  visibleStandardFieldDefinitions,
} from "@/utils/formFields";

export interface RegistrationAnswerEntry {
  key: string;
  label: string;
  value: string;
}

export interface RegistrationHighlight {
  label: string;
  tone: "info" | "warning" | "danger";
}

function getStringAnswer(registration: Registration, key: string) {
  const value = registration.answers[key];
  return typeof value === "string" ? value.trim() : "";
}

function hasMeaningfulAnswer(value: RegistrationAnswerValue) {
  if (typeof value === "boolean" || typeof value === "number") {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== null && value !== undefined;
}

export function formatRegistrationAnswerValue(value: RegistrationAnswerValue) {
  if (typeof value === "boolean") {
    return value ? "Sì" : "No";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value === null || value === undefined) {
    return "-";
  }

  return String(value);
}

export function getRegistrationStatusLabel(status: RegistrationStatus) {
  switch (status) {
    case "confirmed":
      return "Confermata";
    case "cancelled":
      return "Annullata";
    case "waitlist":
      return "Lista d'attesa";
    case "submitted":
      return "Inviata";
    case "active":
      return "Attiva";
    default:
      return "Bozza";
  }
}

export function getRegistrationStatusTone(
  status: RegistrationStatus,
): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "confirmed":
    case "active":
      return "success";
    case "waitlist":
      return "warning";
    case "cancelled":
      return "danger";
    case "submitted":
      return "info";
    default:
      return "neutral";
  }
}

export function getRegistrationHighlights(
  registration: Registration,
): RegistrationHighlight[] {
  const transportMode = getStringAnswer(registration, "transportMode").toLowerCase();
  const highlights: RegistrationHighlight[] = [];

  if (!transportMode || transportMode === "da definire") {
    highlights.push({
      label: "Trasporto da definire",
      tone: "warning",
    });
  }

  if (getStringAnswer(registration, "allergies")) {
    highlights.push({
      label: "Allergie segnalate",
      tone: "danger",
    });
  }

  if (getStringAnswer(registration, "dietaryNotes")) {
    highlights.push({
      label: "Note alimentari",
      tone: "warning",
    });
  }

  if (getStringAnswer(registration, "medicalNotes")) {
    highlights.push({
      label: "Note mediche",
      tone: "danger",
    });
  }

  if (
    getStringAnswer(registration, "roomPreference1Name") ||
    getStringAnswer(registration, "roomPreference2Name")
  ) {
    highlights.push({
      label: "Preferenze stanza",
      tone: "info",
    });
  }

  if (isMinorBirthDate(registration.birthDate)) {
    // Nuovo flusso magic-link via email: priorita' a parentAuthorization.status.
    const parentAuthStatus = registration.parentAuthorization?.status;
    if (parentAuthStatus === "authorized") {
      highlights.push({ label: "Autorizzazione genitore confermata", tone: "info" });
    } else if (parentAuthStatus === "rejected_by_parent") {
      highlights.push({ label: "Genitore ha rifiutato", tone: "danger" });
    } else if (
      parentAuthStatus === "pending_parent_authorization" ||
      parentAuthStatus === "email_sent" ||
      parentAuthStatus === "pending_request"
    ) {
      highlights.push({ label: "In attesa autorizzazione genitore", tone: "warning" });
    } else if (parentAuthStatus === "email_error") {
      highlights.push({ label: "Errore invio email genitore", tone: "danger" });
    } else if (parentAuthStatus === "expired") {
      highlights.push({ label: "Link autorizzazione scaduto", tone: "warning" });
    } else if (registration.parentConsentDocumentUrl) {
      // Fallback flusso legacy upload PDF.
      highlights.push({ label: "Consenso genitore caricato", tone: "info" });
    } else {
      // Nessuno dei due flussi attivo per questa iscrizione.
      highlights.push({ label: "Consenso genitore mancante", tone: "warning" });
    }
  }

  return highlights;
}

export function getRegistrationAnswerEntries(
  formConfig: EventFormConfig,
  registration: Registration,
): RegistrationAnswerEntry[] {
  const entries: RegistrationAnswerEntry[] = [];
  const enabledStandardFields = normalizeStandardFieldKeys(formConfig.enabledStandardFields);

  for (const standardField of visibleStandardFieldDefinitions) {
    if (
      standardField.key === "phone" ||
      !enabledStandardFields.includes(standardField.key)
    ) {
      continue;
    }

    const value = registration.answers[standardField.key];

    if (!hasMeaningfulAnswer(value)) {
      continue;
    }

    entries.push({
      key: standardField.key,
      label: standardField.label,
      value: formatRegistrationAnswerValue(value),
    });
  }

  for (const customField of formConfig.customFields) {
    const value = registration.answers[customField.key];

    if (!hasMeaningfulAnswer(value)) {
      continue;
    }

    entries.push({
      key: customField.key,
      label: customField.label,
      value: formatRegistrationAnswerValue(value),
    });
  }

  return entries;
}
