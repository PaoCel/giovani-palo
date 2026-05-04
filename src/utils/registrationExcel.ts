import type { GenderRoleCategory, Registration } from "@/types";
import { formatDateOnly, formatDateTime } from "@/utils/formatters";
import { getRegistrationStatusLabel } from "@/utils/registrations";
import { formatRoomPreferenceValue, getRegistrationTextAnswer } from "@/utils/roomPreferences";
import { slugify } from "@/utils/slugify";

export type ExportCategory =
  | "giovane_uomo"
  | "giovane_donna"
  | "dirigente"
  | "accompagnatore";

export type ExportFieldKey =
  | "categoria"
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "birthDate"
  | "youthGroup"
  | "unit"
  | "city"
  | "transportMode"
  | "allergies"
  | "dietaryNotes"
  | "medicalNotes"
  | "roomPreference1Name"
  | "roomPreference2Name"
  | "roomNotes"
  | "parentConfirmed"
  | "photoInternalConsent"
  | "photoPublicConsent"
  | "participatingDays"
  | "registrationStatus"
  | "submittedByMode"
  | "createdAt";

export interface ExportFieldOption {
  key: ExportFieldKey;
  label: string;
  group: "anagrafica" | "contatti" | "logistica" | "consensi" | "meta";
}

export const EXCEL_EXPORT_FIELDS: ExportFieldOption[] = [
  { key: "categoria", label: "Categoria (GU/GD/DIR)", group: "anagrafica" },
  { key: "firstName", label: "Nome", group: "anagrafica" },
  { key: "lastName", label: "Cognome", group: "anagrafica" },
  { key: "fullName", label: "Nome completo", group: "anagrafica" },
  { key: "birthDate", label: "Data di nascita", group: "anagrafica" },
  { key: "youthGroup", label: "Quorum / Classe", group: "anagrafica" },
  { key: "email", label: "Email", group: "contatti" },
  { key: "phone", label: "Telefono", group: "contatti" },
  { key: "unit", label: "Unità / Rione-Ramo", group: "logistica" },
  { key: "city", label: "Città", group: "logistica" },
  { key: "transportMode", label: "Trasporto", group: "logistica" },
  { key: "allergies", label: "Allergie", group: "logistica" },
  { key: "dietaryNotes", label: "Note alimentari", group: "logistica" },
  { key: "medicalNotes", label: "Note mediche", group: "logistica" },
  { key: "roomPreference1Name", label: "Preferenza stanza 1", group: "logistica" },
  { key: "roomPreference2Name", label: "Preferenza stanza 2", group: "logistica" },
  { key: "roomNotes", label: "Note stanza", group: "logistica" },
  { key: "parentConfirmed", label: "Consenso genitore", group: "consensi" },
  { key: "photoInternalConsent", label: "Foto uso interno", group: "consensi" },
  { key: "photoPublicConsent", label: "Foto uso pubblico", group: "consensi" },
  { key: "participatingDays", label: "Giorni di partecipazione", group: "logistica" },
  { key: "registrationStatus", label: "Stato iscrizione", group: "meta" },
  { key: "submittedByMode", label: "Modalità invio", group: "meta" },
  { key: "createdAt", label: "Data iscrizione", group: "meta" },
];

export const DEFAULT_EXPORT_FIELDS: ExportFieldKey[] = [
  "categoria",
  "firstName",
  "lastName",
  "unit",
  "roomPreference1Name",
  "roomPreference2Name",
  "roomNotes",
];

export const DEFAULT_EXPORT_CATEGORIES: ExportCategory[] = [
  "giovane_uomo",
  "giovane_donna",
  "dirigente",
  "accompagnatore",
];

export interface ExportOptions {
  categories: ExportCategory[];
  fields: ExportFieldKey[];
  includeOverallSheet: boolean;
}

const fieldHeaderLabels: Record<ExportFieldKey, string> = {
  categoria: "Categoria",
  firstName: "Nome",
  lastName: "Cognome",
  fullName: "Nome completo",
  email: "Email",
  phone: "Telefono",
  birthDate: "Data di nascita",
  youthGroup: "Quorum/Classe",
  unit: "Unità",
  city: "Città",
  transportMode: "Trasporto",
  allergies: "Allergie",
  dietaryNotes: "Note alimentari",
  medicalNotes: "Note mediche",
  roomPreference1Name: "Preferenza stanza 1",
  roomPreference2Name: "Preferenza stanza 2",
  roomNotes: "Note stanza",
  parentConfirmed: "Consenso genitore",
  photoInternalConsent: "Foto uso interno",
  photoPublicConsent: "Foto uso pubblico",
  participatingDays: "Giorni di partecipazione",
  registrationStatus: "Stato iscrizione",
  submittedByMode: "Modalità invio",
  createdAt: "Data iscrizione",
};

const categorySheetMeta: Record<ExportCategory, { sheetName: string; shortLabel: string }> = {
  giovane_uomo: { sheetName: "GU", shortLabel: "GU" },
  giovane_donna: { sheetName: "GD", shortLabel: "GD" },
  dirigente: { sheetName: "Dirigenti", shortLabel: "DIR" },
  accompagnatore: { sheetName: "Accompagnatori", shortLabel: "ACC" },
};

function getCategoryShortLabel(category: GenderRoleCategory | "") {
  if (
    category === "giovane_uomo" ||
    category === "giovane_donna" ||
    category === "dirigente" ||
    category === "accompagnatore"
  ) {
    return categorySheetMeta[category].shortLabel;
  }
  return "";
}

function formatParticipatingDays(days: string[] | undefined) {
  if (!Array.isArray(days) || days.length === 0) return "";
  return days
    .filter((day) => typeof day === "string" && day)
    .map((day) => safeFormatDate(day, "date"))
    .join(", ");
}

function getUnitLabel(registration: Registration) {
  return (
    registration.unitNameSnapshot ||
    (typeof registration.answers.unitName === "string" ? registration.answers.unitName : "") ||
    ""
  );
}

function formatBoolean(value: unknown) {
  if (value === true) return "Sì";
  if (value === false) return "No";
  if (typeof value === "string" && value.length > 0) return value;
  return "";
}

function safeFormatDate(value: string, kind: "date" | "datetime") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return kind === "date" ? formatDateOnly(value) : formatDateTime(value);
}

function getFieldValue(registration: Registration, field: ExportFieldKey): string {
  switch (field) {
    case "categoria":
      return getCategoryShortLabel(registration.genderRoleCategory);
    case "firstName":
      return registration.firstName || "";
    case "lastName":
      return registration.lastName || "";
    case "fullName":
      return (
        registration.fullName ||
        `${registration.firstName || ""} ${registration.lastName || ""}`.trim()
      );
    case "email":
      return registration.email || "";
    case "phone":
      return registration.phone || "";
    case "birthDate":
      return safeFormatDate(registration.birthDate || "", "date");
    case "youthGroup":
      return registration.youthGroup || "";
    case "unit":
      return getUnitLabel(registration);
    case "city":
    case "transportMode":
    case "allergies":
    case "dietaryNotes":
    case "medicalNotes":
      return getRegistrationTextAnswer(registration, field);
    case "roomPreference1Name":
    case "roomPreference2Name":
      return formatRoomPreferenceValue(registration, field);
    case "roomNotes":
      return getRegistrationTextAnswer(registration, "roomNotes");
    case "parentConfirmed":
    case "photoInternalConsent":
    case "photoPublicConsent":
      return formatBoolean(registration.answers[field]);
    case "participatingDays":
      return formatParticipatingDays(registration.participatingDays);
    case "registrationStatus":
      return getRegistrationStatusLabel(registration.registrationStatus);
    case "submittedByMode":
      return registration.submittedByMode === "anonymous" ? "Anonimo" : "Autenticato";
    case "createdAt":
      return safeFormatDate(registration.createdAt || "", "datetime");
    default:
      return "";
  }
}

function buildSheetRows(registrations: Registration[], fields: ExportFieldKey[]) {
  return registrations.map((registration) => {
    const row: Record<string, string> = {};
    for (const field of fields) {
      row[fieldHeaderLabels[field]] = getFieldValue(registration, field);
    }
    return row;
  });
}

function autosizeColumns(rows: Array<Record<string, string>>, headers: string[]) {
  return headers.map((key) => {
    const contentWidth = rows.reduce((maxWidth, row) => {
      return Math.max(maxWidth, String(row[key] ?? "").length);
    }, key.length);

    return {
      wch: Math.min(Math.max(contentWidth + 2, 12), 38),
    };
  });
}

export async function downloadRegistrationsExcel(
  eventTitle: string,
  registrations: Registration[],
  options?: Partial<ExportOptions>,
) {
  const resolved: ExportOptions = {
    categories:
      options?.categories && options.categories.length > 0
        ? options.categories
        : DEFAULT_EXPORT_CATEGORIES,
    fields:
      options?.fields && options.fields.length > 0 ? options.fields : DEFAULT_EXPORT_FIELDS,
    includeOverallSheet: options?.includeOverallSheet ?? true,
  };

  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const sortedRegistrations = [...registrations].sort(
    (left, right) =>
      left.lastName.localeCompare(right.lastName, "it-IT") ||
      left.firstName.localeCompare(right.firstName, "it-IT"),
  );

  const headers = resolved.fields.map((field) => fieldHeaderLabels[field]);
  const sheets: Array<{ name: string; registrations: Registration[] }> = [];

  if (resolved.includeOverallSheet) {
    const overallRegistrations = sortedRegistrations.filter((registration) =>
      resolved.categories.includes(registration.genderRoleCategory as ExportCategory),
    );
    sheets.push({ name: "Elenco generale", registrations: overallRegistrations });
  }

  for (const category of resolved.categories) {
    sheets.push({
      name: categorySheetMeta[category].sheetName,
      registrations: sortedRegistrations.filter(
        (registration) => registration.genderRoleCategory === category,
      ),
    });
  }

  if (sheets.length === 0) {
    sheets.push({ name: "Elenco generale", registrations: sortedRegistrations });
  }

  const emptyRow = headers.reduce<Record<string, string>>((accumulator, header) => {
    accumulator[header] = "";
    return accumulator;
  }, {});

  for (const sheet of sheets) {
    const rows = buildSheetRows(sheet.registrations, resolved.fields);
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    worksheet["!cols"] = autosizeColumns(rows.length > 0 ? rows : [emptyRow], headers);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }

  XLSX.writeFile(
    workbook,
    `${slugify(eventTitle || "iscritti-evento") || "iscritti-evento"}.xlsx`,
  );
}
