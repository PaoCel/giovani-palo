// Profilo utente completo o da completare, età e date di nascita accettabili.
// Funzioni pure: le caricano anche i test Node, quindi niente alias "@/".

export interface ProfileCompletionFields {
  role: string;
  fullName: string;
  birthDate: string;
  genderRoleCategory: string;
  unitName: string;
  stakeId: string;
  city: string;
}

// "Partecipante" è il nome provvisorio dei profili creati senza nome.
export function isPlaceholderName(value: string | null | undefined) {
  return !value || value === "Partecipante";
}

// Un account creato con email e password nasce con la parte prima della @
// come nome (usersService, buildDisplayName): non è un nome da proporre né da
// mostrare come "chi sei".
export function isEmailDerivedName(fullName: string | null | undefined, email: string | null | undefined) {
  const name = (fullName ?? "").trim();
  const local = (email ?? "").split("@")[0]?.trim() ?? "";
  return Boolean(name) && Boolean(local) && name === local;
}

// Per i genitori i dati anagrafici (data di nascita, gruppo, unità) vivono sui
// profili dei figli: per l'account bastano nome, unità e comune.
export function needsProfileCompletion(profile: ProfileCompletionFields) {
  if (profile.role === "parent") {
    return (
      isPlaceholderName(profile.fullName) ||
      !profile.unitName ||
      !profile.stakeId ||
      !profile.city
    );
  }

  return (
    isPlaceholderName(profile.fullName) ||
    !profile.birthDate ||
    !profile.genderRoleCategory ||
    !profile.unitName ||
    !profile.stakeId
  );
}

// Solo questi due ruoli cambiano tipo di account da soli (rules,
// canUpdateOwnUser): dirigenti e admin restano quello che sono.
export function canChooseAccountType(role: string) {
  return role === "participant" || role === "parent";
}

// Il tipo scelto nell'iscrizione ("per chi") si scrive all'accesso solo su un
// account appena creato, col profilo da completare e un ruolo che può
// sceglierlo. Un account esistente non cambia mai tipo entrando.
export function shouldApplyAccountType(input: {
  accountType: "participant" | "parent" | undefined;
  isNewAccount: boolean;
  profile: ProfileCompletionFields;
}) {
  return Boolean(
    input.accountType &&
      input.isNewAccount &&
      input.profile.role !== input.accountType &&
      canChooseAccountType(input.profile.role) &&
      needsProfileCompletion(input.profile),
  );
}

// Può diventare un account da genitore salvando "I tuoi dati": solo
// partecipanti e genitori, e mai chi ha già una data di nascita da minore
// (anche col profilo da completare).
export function canBecomeParent(role: string, birthDate: string | null | undefined, today: Date) {
  return canChooseAccountType(role) && !isMinorOn(birthDate, today);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

// "YYYY-MM-DD" come giorno di calendario locale, mai UTC.
export function parseCalendarDate(value: string | null | undefined) {
  const match = typeof value === "string" ? ISO_DATE.exec(value) : null;

  if (!match) {
    return null;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

export function toCalendarDateValue(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Anni compiuti il giorno `on`; null se la data non è valida o è nel futuro.
export function getAgeOn(birthDate: string | null | undefined, on: Date) {
  const birth = parseCalendarDate(birthDate);

  if (!birth) {
    return null;
  }

  let age = on.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    on.getMonth() < birth.getMonth() ||
    (on.getMonth() === birth.getMonth() && on.getDate() < birth.getDate());

  if (beforeBirthday) {
    age -= 1;
  }

  return age < 0 ? null : age;
}

// Account di un minore: meno di 18 anni oggi (docs/FLUSSO_GENITORE.md, B).
export function isMinorOn(birthDate: string | null | undefined, on: Date) {
  const age = getAgeOn(birthDate, on);
  return age !== null && age < 18;
}

// Il campo data di nascita non accetta date future né prima del 1920.
export const BIRTH_DATE_MIN = "1920-01-01";

export function isAcceptableBirthDate(value: string | null | undefined, today: Date) {
  const birth = parseCalendarDate(value);

  if (!birth) {
    return false;
  }

  const min = parseCalendarDate(BIRTH_DATE_MIN) as Date;
  const max = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return birth >= min && birth <= max;
}
