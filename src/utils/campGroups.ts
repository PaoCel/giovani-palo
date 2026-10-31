import { CAMP_GROUPS } from "../copy/camp.ts";

export type CampGroupLabel = keyof typeof CAMP_GROUPS;

// Senza denominazione salvata: Pattuglie nel campeggio (e nei piani storici,
// tutti di campeggi), Gruppi negli altri tipi di attività.
export function getDefaultCampGroupLabel(activityType?: string | null): CampGroupLabel {
  return activityType && activityType !== "camp" ? "gruppo" : "pattuglia";
}

export function normalizeCampGroupLabel(value: unknown, fallback: CampGroupLabel = "pattuglia"): CampGroupLabel {
  return typeof value === "string" && Object.hasOwn(CAMP_GROUPS, value)
    ? value as CampGroupLabel : fallback;
}

export function getCampGroupLabels(value: unknown) {
  return CAMP_GROUPS[normalizeCampGroupLabel(value)];
}

export function getCommitteeInitials(title: string) {
  return title.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("it-IT");
}

// Comitati (docs/ATTIVITA_MODULARI.md, quarto incremento): i cinque storici
// oppure `c_` più 8–32 caratteri [a-z0-9], scelti dal client e stabili.
export const HISTORIC_COMMITTEE_IDS = ["logistics", "wellbeing", "kitchen", "games", "spiritual"] as const;
export const MAX_COMMITTEES = 20;
export const MAX_COMMITTEE_TITLE = 80;
export const MAX_COMMITTEE_RESPONSIBILITIES = 600;
const CUSTOM_COMMITTEE_ID = /^c_[a-z0-9]{8,32}$/;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function isValidCommitteeId(value: unknown): value is string {
  return typeof value === "string" &&
    ((HISTORIC_COMMITTEE_IDS as readonly string[]).includes(value) || CUSTOM_COMMITTEE_ID.test(value));
}

// `c_` + 16 caratteri da crypto.getRandomValues, senza sbilanciare l'alfabeto
// (si scartano i byte oltre l'ultimo multiplo di 36).
export function createCommitteeId(taken: Iterable<string> = []) {
  const used = new Set(taken);
  for (;;) {
    let suffix = "";
    while (suffix.length < 16) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      for (const byte of bytes) {
        if (byte >= 252 || suffix.length === 16) continue;
        suffix += ID_ALPHABET[byte % 36];
      }
    }
    const id = `c_${suffix}`;
    if (!used.has(id)) return id;
  }
}
