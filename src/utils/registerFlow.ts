// Passi dell'iscrizione a un'attività (docs/FLUSSO_GENITORE.md, "Navigazione"
// e schermate B-F). Lo stato vive nell'URL: `?per=io|figlio&passo=…`. Ogni
// combinazione porta a un passo valido, mai a un errore: un passo senza i suoi
// prerequisiti (per esempio `passo=modulo` senza account) diventa il primo
// passo valido. Funzioni pure: le caricano anche i test Node.

export type RegisterFor = "io" | "figlio";
export type RegisterPasso = "chi" | "account" | "dati" | "figlio" | "modulo" | "inviata";

// Le schermate sono i passi, più due schede che (fino alle fasi 5 e 6 della
// spec) dicono quale account serve:
// - "serve-genitore": figlio scelto da un account che non è da genitore
//   (ragazzo, adulto partecipante, dirigente, admin);
// - "solo-figli": "Partecipo io" scelto da un account da genitore già completo.
export type RegisterScreen = RegisterPasso | "serve-genitore" | "solo-figli";

export type RegisterAccountKind = "none" | "guest" | "user";
export type RegisterRole = "participant" | "parent" | "staff";

export interface RegisterFlowState {
  per: RegisterFor | null;
  passo: RegisterPasso | null;
  account: RegisterAccountKind;
  // Solo per account veri: profilo completato (nome, unità, …).
  profileComplete: boolean;
  role: RegisterRole;
  // Account di un minore con il profilo completo: niente "Chi partecipa?".
  isMinor: boolean;
  // L'attività accetta iscrizioni senza account (G6: solo per "Partecipo io").
  guestAllowed: boolean;
  // `?child=` punta a un figlio dell'account da genitore.
  childSelected: boolean;
  // C'è un'iscrizione non annullata per chi partecipa (te o il figlio scelto):
  // solo allora "Iscrizione inviata" (H) è un passo valido.
  submitted?: boolean;
}

export interface RegisterFlowResult {
  screen: RegisterScreen;
  // Valori canonici per l'URL: se diversi da quelli letti, si sostituisce
  // la voce di cronologia (mai una nuova).
  per: RegisterFor | null;
  passo: RegisterPasso | null;
}

const PASSI: readonly RegisterPasso[] = ["chi", "account", "dati", "figlio", "modulo", "inviata"];

export function parseRegisterFor(value: string | null | undefined): RegisterFor | null {
  return value === "io" || value === "figlio" ? value : null;
}

export function parseRegisterPasso(value: string | null | undefined): RegisterPasso | null {
  return PASSI.includes(value as RegisterPasso) ? (value as RegisterPasso) : null;
}

// Scelta da usare quando l'URL non dice `per`: chi arriva con un figlio già
// scelto ("Gestisci" in Famiglia, link vecchi con `child`) va al suo modulo,
// chi ha già la sua iscrizione (account o ospite) al proprio. Con `per`
// nell'URL vale l'URL.
export function getRequestedRegisterChoice(input: {
  per: RegisterFor | null;
  passo: RegisterPasso | null;
  childSelected: boolean;
  hasOwnRegistration: boolean;
}): { per: RegisterFor | null; passo: RegisterPasso | null } {
  if (input.per) {
    return { per: input.per, passo: input.passo };
  }

  if (input.childSelected) {
    return { per: "figlio", passo: "modulo" };
  }

  if (input.hasOwnRegistration) {
    return { per: "io", passo: "modulo" };
  }

  return { per: null, passo: input.passo };
}

export function getRegisterRole(role: string): RegisterRole {
  if (role === "parent") {
    return "parent";
  }

  return role === "participant" ? "participant" : "staff";
}

function result(screen: RegisterScreen, per: RegisterFor | null): RegisterFlowResult {
  const passo: RegisterPasso | null =
    screen === "serve-genitore" || screen === "solo-figli"
      ? null
      : screen === "chi"
        ? per
          ? "chi"
          : null
        : screen;

  return { screen, per, passo };
}

// "Iscrizione inviata" (H) vale dove vale il modulo, per un account vero con
// l'iscrizione già salvata; altrimenti si torna al primo passo valido.
export function resolveRegisterFlow(state: RegisterFlowState): RegisterFlowResult {
  if (state.passo !== "inviata") {
    return resolveSteps(state);
  }

  const asForm = resolveSteps({ ...state, passo: "modulo" });

  if (asForm.screen === "modulo" && state.account === "user" && state.submitted) {
    return { screen: "inviata", per: asForm.per, passo: "inviata" };
  }

  return asForm;
}

function resolveSteps(state: RegisterFlowState): RegisterFlowResult {
  const { per, passo, account } = state;
  const user = account === "user";

  // Account di un minore: dritto al modulo, "Chi partecipa?" non compare.
  // Arrivato con la scelta del figlio (telefono del ragazzo usato dal
  // genitore): la scheda dice che serve l'account di un genitore.
  if (user && state.profileComplete && state.isMinor && state.role === "participant") {
    return per === "figlio" ? result("serve-genitore", "figlio") : result("modulo", "io");
  }

  if (!per || passo === "chi") {
    return result("chi", per);
  }

  if (account === "none") {
    return result("account", per);
  }

  if (account === "guest") {
    // Un figlio non si iscrive senza account (G6); un'attività che chiede
    // l'account non accetta la sessione anonima.
    if (per === "figlio" || !state.guestAllowed) {
      return result("account", per);
    }

    // L'ospite passa da "Il tuo account" (può ancora crearlo, e lo collega
    // alla sessione); prosegue solo dopo "Continua senza account".
    return passo === "modulo" ? result("modulo", per) : result("account", per);
  }

  // Il passo account, una volta entrati, non torna più.
  if (!state.profileComplete) {
    return result("dati", per);
  }

  if (per === "io") {
    return state.role === "parent" ? result("solo-figli", per) : result("modulo", per);
  }

  if (state.role !== "parent") {
    return result("serve-genitore", per);
  }

  if (state.childSelected && passo !== "figlio") {
    return result("modulo", per);
  }

  return result("figlio", per);
}

export type RegisterBackTarget =
  | { kind: "activity" }
  | { kind: "step"; per: RegisterFor | null; passo: RegisterPasso | null };

// Dove porta la freccia in alto. "Chi partecipa?" torna all'attività; da un
// passo dopo si torna a "Chi partecipa?" (o a "Chi iscrivi?" dal modulo del
// figlio). L'account di un minore non vede mai "Chi partecipa?".
export function getRegisterBackTarget(
  screen: RegisterScreen,
  per: RegisterFor | null,
  isMinorAccount: boolean,
): RegisterBackTarget {
  if (screen === "chi" || screen === "inviata" || isMinorAccount) {
    return { kind: "activity" };
  }

  if (screen === "modulo" && per === "figlio") {
    return { kind: "step", per, passo: "figlio" };
  }

  return { kind: "step", per, passo: "chi" };
}

// Percorso "Il tuo account · Tuo figlio · Iscrizione" (o "I tuoi dati" per
// chi partecipa): il segmento attivo, oppure null dove non si mostra.
export function getRegisterProgressIndex(screen: RegisterScreen, per: RegisterFor | null) {
  if (screen === "account") {
    return 0;
  }

  if (screen === "dati") {
    return per === "figlio" ? 0 : 1;
  }

  if (screen === "figlio") {
    return 1;
  }

  return null;
}

// Query dell'iscrizione con per/passo/child aggiornati; gli altri parametri
// (stake, …) restano.
export function buildRegisterSearch(
  current: URLSearchParams,
  next: { per: RegisterFor | null; passo: RegisterPasso | null; child?: string | null },
) {
  const params = new URLSearchParams(current);

  for (const [key, value] of [
    ["per", next.per],
    ["passo", next.passo],
  ] as const) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  if (next.child !== undefined) {
    if (next.child) {
      params.set("child", next.child);
    } else {
      params.delete("child");
    }
  }

  return params.toString();
}

// La scelta "per chi" in sessionStorage è solo un aiuto: ricorda quale scheda
// evidenziare tornando a "Chi partecipa?" nella stessa attività. Mai una
// promessa: si cancella cambiando attività, uscendo o a iscrizione inviata.
const STORAGE_KEY = "gugd-iscrizione-per";

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

export function readStoredRegisterFor(eventId: string, storage = getSessionStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { eventId?: unknown; per?: unknown }) : null;
    return parsed && parsed.eventId === eventId && typeof parsed.per === "string"
      ? parseRegisterFor(parsed.per)
      : null;
  } catch {
    return null;
  }
}

export function writeStoredRegisterFor(
  eventId: string,
  per: RegisterFor,
  storage = getSessionStorage(),
) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ eventId, per }));
  } catch {
    // Storage pieno o bloccato: è solo un aiuto.
  }
}

export function clearStoredRegisterFor(storage = getSessionStorage()) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Come sopra.
  }
}
