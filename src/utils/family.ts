// Famiglia indipendente dal ruolo (docs/FLUSSO_GENITORE.md, scelta G2 = a e
// fase 6): qualunque account adulto può avere figli e iscriverli, e il ruolo
// resta quello che è. Il ruolo dice solo se l'account partecipa lui stesso
// (`participant`, `unit_leader`, `admin`) o è solo genitore (`parent`).
// Le rules di `users/{uid}/children` e delle iscrizioni `child_` non guardano
// il ruolo: questo è il vincolo del client. Funzioni pure: le caricano anche
// i test Node, quindi niente alias "@/" negli import di valori.

import { getAgeOn } from "./profileCompletion.ts";

export interface FamilySessionLike {
  isAuthenticated: boolean;
  isAnonymous: boolean;
  profile: {
    role: string;
    birthDate?: string | null;
  };
}

// Età da cui un partecipante può avere figli nel suo account: la stessa
// soglia che separa l'account di un minore (isMinorOn).
export const FAMILY_MIN_AGE = 18;

const STAFF_ROLES = new Set(["unit_leader", "admin", "super_admin"]);

// Può avere figli, vederli in Famiglia e iscriverli: un account vero (non
// ospite), da genitore, dello staff, o un partecipante con almeno 18 anni oggi.
// Un partecipante senza data di nascita (profilo da completare) non ancora:
// prima completa i suoi dati.
export function canManageFamily(
  session: FamilySessionLike | null | undefined,
  today: Date = new Date(),
) {
  if (!session || !session.isAuthenticated || session.isAnonymous) {
    return false;
  }

  const { role } = session.profile;

  if (role === "parent" || STAFF_ROLES.has(role)) {
    return true;
  }

  if (role !== "participant") {
    return false;
  }

  const age = getAgeOn(session.profile.birthDate, today);
  return age !== null && age >= FAMILY_MIN_AGE;
}

// La pagina iniziale dell'account: l'area del suo ruolo. Famiglia è la casa
// solo dell'account da genitore; per gli altri è una pagina in più.
export function getAccountHomePath(role: string) {
  if (role === "admin" || role === "super_admin") {
    return "/admin";
  }

  if (role === "unit_leader") {
    return "/unit";
  }

  return role === "parent" ? "/family" : "/me";
}

// Dopo la propria iscrizione, «Iscrivi tuo figlio o tua figlia» (H e la tua
// scheda) per un adulto che può avere figli e ha l'aria di un genitore: staff,
// dirigente o accompagnatore, o chi ha già figli salvati. A un partecipante
// di 18-19 anni iscritto come giovane non lo proponiamo: per lui è rumore.
export function suggestsChildAfterOwn(input: {
  canManageFamily: boolean;
  role: string;
  category: string;
  hasChildren: boolean;
}) {
  if (!input.canManageFamily) {
    return false;
  }

  return (
    STAFF_ROLES.has(input.role) ||
    input.role === "parent" ||
    input.category === "dirigente" ||
    input.category === "accompagnatore" ||
    input.hasChildren
  );
}
