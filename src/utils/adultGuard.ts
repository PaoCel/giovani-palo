// Guardia adulto (docs/FLUSSO_GENITORE.md, G e scelta G1): chi si iscrive da sé
// a un'attività per i giovani con almeno 19 anni il primo giorno sceglie chi
// partecipa davvero. Scatta al «Continua» della data in «I tuoi dati» (D) e in
// cima al modulo (F) per un partecipante già entrato. Funzioni pure: le
// caricano anche i test Node, quindi niente alias "@/" negli import di valori.

import type { GenderRoleCategory } from "@/types";
import { fillCopy } from "../copy/parole.ts";
import { GUARDIA } from "../copy/guardia.ts";
import { ADULT_GUARD_AGE } from "./childChoice.ts";
import { getAgeOn } from "./profileCompletion.ts";

// Età il primo giorno dell'attività, solo se fa scattare la guardia.
export function getAdultGuardAge(birthDate: string | null | undefined, firstDay: Date) {
  const age = getAgeOn(birthDate, firstDay);
  return age !== null && age >= ADULT_GUARD_AGE ? age : null;
}

// Dirigenti e accompagnatori sono adulti per definizione: niente guardia.
export function isAdultCategory(category: GenderRoleCategory | "" | null | undefined) {
  return category === "dirigente" || category === "accompagnatore";
}

// In cima al modulo (F): solo un account partecipante col profilo completo,
// iscritto come giovane, senza un'iscrizione già fatta (quella si modifica) e
// che non ha già confermato per questa data di nascita.
export function needsExistingAccountGuard(input: {
  role: string;
  profileComplete: boolean;
  category: GenderRoleCategory | "" | null | undefined;
  birthDate: string | null | undefined;
  firstDay: Date;
  hasOwnRegistration: boolean;
  confirmed: boolean;
}) {
  return (
    input.role === "participant" &&
    input.profileComplete &&
    !input.hasOwnRegistration &&
    !input.confirmed &&
    !isAdultCategory(input.category) &&
    getAdultGuardAge(input.birthDate, input.firstDay) !== null
  );
}

const DAY_FORMATTER = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

// "Il 24 aprile 2027 avrai 47 anni.", diviso dove va il grassetto.
export function getAdultGuardSentence(age: number, firstDay: Date) {
  const anni = fillCopy(GUARDIA.anni, { eta: String(age) });
  const [before, after = ""] = fillCopy(GUARDIA.avrai, {
    giorno: DAY_FORMATTER.format(firstDay),
  }).split("{anni}");
  return { before, anni, after, text: `${before}${anni}${after}` };
}

// "Confermo, partecipo io come giovane" vale per account, attività e data di
// nascita: cambiando la data la guardia torna. `sessionStorage` è solo un
// aiuto: senza, la guardia si ripresenta e basta.
const STORAGE_KEY = "gugd-guardia-adulto";
const MAX_ENTRIES = 20;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getSessionStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getAdultGuardKey(input: { uid: string; eventId: string; birthDate: string }) {
  return [input.uid, input.eventId, input.birthDate].join("|");
}

function readEntries(storage: StorageLike | null) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function readAdultGuardConfirmations(storage = getSessionStorage()) {
  return new Set(readEntries(storage));
}

export function writeAdultGuardConfirmation(key: string, storage = getSessionStorage()) {
  try {
    const entries = readEntries(storage).filter((entry) => entry !== key);
    entries.push(key);
    storage?.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Storage pieno o bloccato: è solo un aiuto.
  }
}

export function clearAdultGuardConfirmations(storage = getSessionStorage()) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Come sopra.
  }
}
