// Etichette e filtri delle iscrizioni nell'admin, condivisi fra la tab Iscritti
// e la scheda dell'iscrizione (AdminEventDetailPage).

import type { Registration } from "@/types";

export type RegistrationCategoryFilter =
  "giovane_uomo" | "giovane_donna" | "dirigente" | "accompagnatore";

export const registrationCategoryFilterOptions: Array<{
  value: RegistrationCategoryFilter;
  label: string;
}> = [
  { value: "giovane_uomo", label: "GU" },
  { value: "giovane_donna", label: "GD" },
  { value: "dirigente", label: "Dirigenti" },
  { value: "accompagnatore", label: "Accompagnatori" },
];

export function isRegistrationCategoryFilter(
  value: Registration["genderRoleCategory"],
): value is RegistrationCategoryFilter {
  return (
    value === "giovane_uomo" ||
    value === "giovane_donna" ||
    value === "dirigente" ||
    value === "accompagnatore"
  );
}

export function getUnitLabel(registration: Registration) {
  return (
    registration.unitNameSnapshot ||
    (typeof registration.answers.unitName === "string"
      ? registration.answers.unitName
      : "") ||
    "Unità non indicata"
  );
}

export function getCategoryShortLabel(registration: Registration) {
  switch (registration.genderRoleCategory) {
    case "giovane_uomo":
      return "GU";
    case "giovane_donna":
      return "GD";
    case "dirigente":
      return "DIR";
    default:
      return "--";
  }
}
