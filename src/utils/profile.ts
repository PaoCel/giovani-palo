import type { GenderRoleCategory, YouthGroup } from "@/types";

const genderToLabelMap: Record<GenderRoleCategory, YouthGroup> = {
  giovane_uomo: "Giovani Uomini",
  giovane_donna: "Giovani Donne",
  dirigente: "Dirigente",
  accompagnatore: "Accompagnatore",
};

const labelToGenderMap: Record<YouthGroup, GenderRoleCategory> = {
  "Giovani Uomini": "giovane_uomo",
  "Giovani Donne": "giovane_donna",
  Dirigente: "dirigente",
  Accompagnatore: "accompagnatore",
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
  if (
    value === "giovane_uomo" ||
    value === "giovane_donna" ||
    value === "dirigente" ||
    value === "accompagnatore"
  ) {
    return value;
  }

  if (
    value === "Giovani Uomini" ||
    value === "Giovani Donne" ||
    value === "Dirigente" ||
    value === "Accompagnatore"
  ) {
    return labelToGenderMap[value];
  }

  return "";
}

export function getGenderRoleCategoryLabel(value: GenderRoleCategory | "") {
  if (!value) {
    return "";
  }

  switch (value) {
    case "dirigente":
      return "Dirigente";
    case "accompagnatore":
      return "Accompagnatore";
    case "giovane_uomo":
      return "Giovane uomo";
    case "giovane_donna":
      return "Giovane donna";
  }
}
