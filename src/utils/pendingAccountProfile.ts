import type { GenderRoleCategory } from "@/types";

const STORAGE_KEY = "pending_account_profile";

export interface PendingAccountProfile {
  firstName: string;
  lastName: string;
  birthDate: string;
  genderRoleCategory: GenderRoleCategory | "";
  unitName: string;
}

export function readPendingAccountProfile(): PendingAccountProfile | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<PendingAccountProfile>;

    return {
      firstName: typeof parsed.firstName === "string" ? parsed.firstName : "",
      lastName: typeof parsed.lastName === "string" ? parsed.lastName : "",
      birthDate: typeof parsed.birthDate === "string" ? parsed.birthDate : "",
      genderRoleCategory:
        parsed.genderRoleCategory === "giovane_uomo" ||
        parsed.genderRoleCategory === "giovane_donna" ||
        parsed.genderRoleCategory === "dirigente"
          ? parsed.genderRoleCategory
          : "",
      unitName: typeof parsed.unitName === "string" ? parsed.unitName : "",
    };
  } catch {
    return null;
  }
}

export function writePendingAccountProfile(value: PendingAccountProfile) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function clearPendingAccountProfile() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(STORAGE_KEY);
}
