// Bozza di «I tuoi dati» dentro un'iscrizione (docs/FLUSSO_GENITORE.md, D e
// G): "Cambia" e poi di nuovo "Partecipo io" ritrovano la data scritta prima.
// Solo in memoria, per account e attività: si cancella al salvataggio e a ogni
// uscita o cambio di account (AuthProvider), da qualunque pagina.

import type { GenderRoleCategory } from "@/types";

export interface ProfileDraftValues {
  firstName: string;
  lastName: string;
  birthDate: string;
  genderRoleCategory: GenderRoleCategory | "";
  unitName: string;
  city: string;
}

const drafts = new Map<string, ProfileDraftValues>();

export function getProfileDraftKey(uid: string, eventId: string) {
  return `${uid}|${eventId}`;
}

export function readProfileDraft(key: string) {
  return drafts.get(key);
}

export function writeProfileDraft(key: string, values: ProfileDraftValues) {
  drafts.set(key, values);
}

export function deleteProfileDraft(key: string) {
  drafts.delete(key);
}

export function clearProfileDrafts() {
  drafts.clear();
}
