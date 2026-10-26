import { CAMP_GROUPS } from "../copy/camp.ts";

export type CampGroupLabel = keyof typeof CAMP_GROUPS;

export function normalizeCampGroupLabel(value: unknown): CampGroupLabel {
  return typeof value === "string" && Object.hasOwn(CAMP_GROUPS, value)
    ? value as CampGroupLabel : "pattuglia";
}

export function getCampGroupLabels(value: unknown) {
  return CAMP_GROUPS[normalizeCampGroupLabel(value)];
}

export function getCommitteeInitials(title: string) {
  return title.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("it-IT");
}
