import type { GenderRoleCategory, YouthGroup } from "@/types";

const genderToLabelMap: Record<GenderRoleCategory, YouthGroup> = {
  giovane_uomo: "Giovani Uomini",
  giovane_donna: "Giovani Donne",
  dirigente: "Dirigente",
};

const labelToGenderMap: Record<YouthGroup, GenderRoleCategory> = {
  "Giovani Uomini": "giovane_uomo",
  "Giovani Donne": "giovane_donna",
  Dirigente: "dirigente",
};

export function getYouthGroupLabel(
  genderRoleCategory: GenderRoleCategory | "",
): YouthGroup | "" {
  if (!genderRoleCategory) {
    return "";
  }

  return genderToLabelMap[genderRoleCategory];
}

export function getGenderRoleCategory(value: string): GenderRoleCategory | "" {
  if (value === "giovane_uomo" || value === "giovane_donna" || value === "dirigente") {
    return value;
  }

  if (value === "Giovani Uomini" || value === "Giovani Donne" || value === "Dirigente") {
    return labelToGenderMap[value];
  }

  return "";
}

export function getGenderRoleCategoryLabel(value: GenderRoleCategory | "") {
  if (!value) {
    return "";
  }

  if (value === "dirigente") {
    return "Dirigente";
  }

  return value === "giovane_uomo" ? "Giovane uomo" : "Giovane donna";
}
