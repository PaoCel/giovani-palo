// Notte dei Record, richieste senza account
// (docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md, fonte di verità): logica pura del
// client. Validazione degli stessi vincoli del server, token di invio, sessione
// anonima, testi degli stati, mappatura degli errori, helper della coda dello
// staff.
//
// Questo file lo carica anche Node (tests/recordNightGuest.test.mjs): niente
// alias "@/" fra gli import di valori, niente enum né parameter properties.

import type {
  RecordNightGuestContext,
  RecordNightGuestRequest,
  RecordNightGuestState,
  RecordNightMeasure,
  RecordNightPublicRecord,
  RecordNightRequestKind,
  RecordNightStaffRequest,
  RecordNightWithdrawnBy,
} from "@/types";
import {
  RECORD_NIGHT_CATEGORIES,
  RECORD_NIGHT_DURATION_RANGE,
  RECORD_NIGHT_LIMITS,
  RECORD_NIGHT_MEASURES,
  measureNeedsDuration,
} from "./recordNight.ts";

// ---------------------------------------------------------------------------
// Limiti (applicati dal server: qui servono a non fare chiamate inutili)
// ---------------------------------------------------------------------------

export const GUEST_NAME_LIMITS = { min: 2, max: 40 } as const;

// Tetti di D4: un freno agli errori e ai dispetti, non una difesa.
export const RECORD_NIGHT_GUEST_LIMITS = {
  openPerPhone: 6,
  openPerPerson: 2,
  openPerActivity: 100,
} as const;

// `rejectRequests` accetta al massimo 50 id per chiamata.
export const MAX_BULK_REJECT_REQUESTS = 50;

// ---------------------------------------------------------------------------
// Testi fissi della spec
// ---------------------------------------------------------------------------

// Frasi usate in più punti: una sola formulazione.
const CLOSED_MESSAGE = "Le iscrizioni ai record sono chiuse.";
const SUBMIT_UNAVAILABLE = "Non riesco a riceverla ora. Parlane con il dirigente della tua unità.";

export const GUEST_COPY = {
  // Errore del server per chi ha già un account (stringa identica alla callable).
  account: "Hai un account: accedi",
  // Nota del foglio "Senza account", in fondo al corpo, sopra i tasti.
  sheetNote:
    "Un adulto controlla ogni richiesta. Finché non è approvata non conta e non la vede nessuno. La vedi e la ritiri solo da questo telefono.",
  // Sotto la nota del foglio, prima del link all'informativa: cosa si raccoglie.
  sheetPrivacy: "Raccogliamo nome, cognome, unità e testo della richiesta. Li vede solo lo staff.",
  // Chiusura del foglio con del testo scritto.
  closeConfirm: "Chiudere senza inviare? Quello che hai scritto non si salva.",
  // Sotto "Accedi" nel foglio: chi passa dall'accesso perde ciò che ha scritto.
  sheetLoginHint: "Dopo l'accesso torni a questa pagina. Quello che hai scritto qui non si salva.",
  // Sotto "Le tue richieste da questo telefono" (formulazione del mockup).
  phoneOnlyNote: "Se cambi telefono o cancelli i dati del sito, non le trovi più.",
  // Il telefono è al tetto di richieste in coda: lo si dice prima di compilare e
  // all'invio.
  phoneLimit:
    "Hai già inviato il massimo di richieste da questo telefono. Ritirane una per inviarne un'altra.",
  // "Annulla" o "Ripristina" con il tetto pieno: la richiesta resta ritirata.
  restoreAtLimit:
    "La richiesta resta ritirata. Per rimetterla ritira un'altra richiesta o parlane con un dirigente.",
  // Foglio aperto mentre le iscrizioni si chiudono o l'invio si spegne.
  intakeClosed: CLOSED_MESSAGE,
  intakeUnavailable: SUBMIT_UNAVAILABLE,
  // Spunta dello staff per collegare una richiesta.
  verifiedLabel:
    "La persona mi ha confermato di aver inviato questa richiesta (di persona o tramite il suo dirigente)",
  // Promemoria nell'"Approva": il titolo di un record è pubblico.
  publicTitleReminder: "Il titolo lo vedono tutti, anche senza account: niente nomi.",
} as const;

// ---------------------------------------------------------------------------
// Nome e cognome
// ---------------------------------------------------------------------------

// Lettere (anche accentate), spazio, apostrofo, trattino; i separatori solo fra
// lettere. Identica a NAME_PATTERN di functions/lib/recordNightGuest.js.
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:(?: ?['-] ?| )\p{L}[\p{L}\p{M}]*)*$/u;
// Caratteri di controllo (tab e a capo esclusi), come CONTROL_CHARS del server.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

export type GuestNameField = "firstName" | "lastName";
export type GuestNameProblem = "required" | "too_short" | "too_long" | "invalid";

export interface GuestNameCheck {
  // Il valore da mandare: spazi collassati, forma NFC, apostrofo ASCII.
  value: string;
  problem: GuestNameProblem | null;
  // Testo per l'utente; null se il nome va bene.
  message: string | null;
}

// Spazi collassati, forma NFC e apostrofo tipografico (la tastiera dell'iPhone
// scrive ’) reso ASCII: è il valore che il server confronta con il suo schema.
export function normalizeGuestName(value: string) {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .normalize("NFC")
    .replace(/[‘’ʼ]/gu, "'");
}

// Testo scritto da uno sconosciuto, senza i caratteri che cambiano il verso di
// lettura (U+202A-202E, U+2066-2069): il server li accetta nei testi liberi e
// uno solo basterebbe a rovesciare la riga e la virgoletta che le sta intorno.
// Stesso insieme di stripBidi del lato staff (components/admin/recordNight/helpers.ts).
export function stripBidi(value: string | null | undefined) {
  return (value ?? "").replace(/[\u202A-\u202E\u2066-\u2069]/gu, "");
}

const NAME_LABELS: Record<GuestNameField, string> = { firstName: "nome", lastName: "cognome" };

function nameMessage(field: GuestNameField, problem: GuestNameProblem) {
  const label = NAME_LABELS[field];
  switch (problem) {
    case "required":
      return `Scrivi il ${label}.`;
    case "too_short":
      return `Il ${label} è troppo corto: servono almeno ${GUEST_NAME_LIMITS.min} lettere.`;
    case "too_long":
      return `Il ${label} è troppo lungo: massimo ${GUEST_NAME_LIMITS.max} caratteri.`;
    default:
      return `Nel ${label} puoi usare solo lettere, spazio, apostrofo e trattino.`;
  }
}

// Stessi controlli, nello stesso ordine, di parsePersonName sul server.
export function checkGuestName(raw: string, field: GuestNameField): GuestNameCheck {
  const value = normalizeGuestName(typeof raw === "string" ? raw : "");
  const fail = (problem: GuestNameProblem): GuestNameCheck => ({
    value,
    problem,
    message: nameMessage(field, problem),
  });
  if (typeof raw !== "string" || CONTROL_CHARS.test(raw)) return fail("invalid");
  if (!value) return fail("required");
  if (value.length > GUEST_NAME_LIMITS.max) return fail("too_long");
  if (value.length < GUEST_NAME_LIMITS.min) return fail("too_short");
  if (!NAME_PATTERN.test(value)) return fail("invalid");
  return { value, problem: null, message: null };
}

// ---------------------------------------------------------------------------
// Richiesta: bozza, validazione, payload
// ---------------------------------------------------------------------------

// Ciò che tiene il foglio mentre l'utente scrive.
export interface RecordNightGuestDraft {
  kind: RecordNightRequestKind;
  firstName: string;
  lastName: string;
  unitId: string;
  // Solo proposta.
  text?: string;
  measure?: RecordNightMeasure | "" | null;
  durationSeconds?: number | null;
  needs?: string;
  // Solo sfida.
  recordId?: string | null;
}

// Ciò che parte, già pulito.
export type RecordNightGuestRequestFields =
  | {
      kind: "proposal";
      firstName: string;
      lastName: string;
      unitId: string;
      text: string;
      measure: RecordNightMeasure;
      durationSeconds: number | null;
      needs: string;
    }
  | {
      kind: "challenge";
      firstName: string;
      lastName: string;
      unitId: string;
      recordId: string;
    };

export type GuestFieldKey =
  | "kind"
  | "firstName"
  | "lastName"
  | "unitId"
  | "text"
  | "measure"
  | "durationSeconds"
  | "needs"
  | "recordId";
export type GuestFieldErrors = Partial<Record<GuestFieldKey, string>>;

export type GuestDraftValidation =
  | { ok: true; fields: RecordNightGuestRequestFields }
  | { ok: false; errors: GuestFieldErrors };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const MEASURE_VALUES: ReadonlyArray<string> = RECORD_NIGHT_MEASURES.map((item) => item.value);

function cleanTextLine(value: string | undefined | null) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function textMessage(value: string, max: number, raw: unknown) {
  if (typeof raw === "string" && CONTROL_CHARS.test(raw)) return "Il testo contiene caratteri non validi.";
  if (value.length > max) return `Scrivi al massimo ${max} caratteri.`;
  return null;
}

// Gli stessi vincoli di `submit` sul server. `units` e `records` (se passati)
// sono quelli del contesto pubblico: un'unità o un record che non c'è più si
// segnala subito, senza creare la sessione.
export function validateGuestDraft(
  draft: RecordNightGuestDraft,
  options: {
    units?: ReadonlyArray<{ id: string }>;
    records?: ReadonlyArray<{ id: string }>;
  } = {},
): GuestDraftValidation {
  const errors: GuestFieldErrors = {};

  const first = checkGuestName(draft.firstName, "firstName");
  if (first.message) errors.firstName = first.message;
  const last = checkGuestName(draft.lastName, "lastName");
  if (last.message) errors.lastName = last.message;

  const unitId = typeof draft.unitId === "string" ? draft.unitId.trim() : "";
  const unitKnown = options.units ? options.units.some((unit) => unit.id === unitId) : true;
  if (!unitId || !ID_PATTERN.test(unitId) || !unitKnown) errors.unitId = "Scegli la tua unità.";

  if (draft.kind === "challenge") {
    const recordId = typeof draft.recordId === "string" ? draft.recordId.trim() : "";
    if (!recordId || !ID_PATTERN.test(recordId)) {
      errors.recordId = "Scegli il record da sfidare.";
    } else if (options.records && !options.records.some((record) => record.id === recordId)) {
      errors.recordId = "Questo record non è più disponibile.";
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    return {
      ok: true,
      fields: {
        kind: "challenge",
        firstName: first.value,
        lastName: last.value,
        unitId,
        recordId,
      },
    };
  }

  if (draft.kind !== "proposal") {
    // Un tipo che non esiste non parte (il tipo TypeScript lo esclude già).
    return { ok: false, errors: { ...errors, kind: "Scegli cosa vuoi fare." } };
  }

  const text = cleanTextLine(draft.text);
  if (!text) errors.text = "Scrivi cosa fai.";
  else {
    const message = textMessage(text, RECORD_NIGHT_LIMITS.text, draft.text);
    if (message) errors.text = message;
  }

  const measure = typeof draft.measure === "string" ? draft.measure : "";
  if (!measure || !MEASURE_VALUES.includes(measure)) errors.measure = "Scegli come si misura.";

  const needs = cleanTextLine(draft.needs);
  const needsMessage = textMessage(needs, RECORD_NIGHT_LIMITS.needs, draft.needs);
  if (needsMessage) errors.needs = needsMessage;

  let durationSeconds: number | null = null;
  if (measure && MEASURE_VALUES.includes(measure) && measureNeedsDuration(measure as RecordNightMeasure)) {
    const { min, max } = RECORD_NIGHT_DURATION_RANGE;
    const value = draft.durationSeconds;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      errors.durationSeconds = `La durata va da ${min} a ${max} secondi.`;
    } else {
      durationSeconds = value;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      kind: "proposal",
      firstName: first.value,
      lastName: last.value,
      unitId,
      text,
      measure: measure as RecordNightMeasure,
      durationSeconds,
      needs,
    },
  };
}

// Corpo della callable `recordNightGuest` / `submit`: solo le chiavi che il
// server ammette per il tipo (una sfida non porta testo, misura, durata, serve).
export function buildGuestSubmitPayload(
  submissionId: string,
  fields: RecordNightGuestRequestFields,
): Record<string, unknown> {
  const base = {
    submissionId,
    kind: fields.kind,
    firstName: fields.firstName,
    lastName: fields.lastName,
    unitId: fields.unitId,
  };
  if (fields.kind === "challenge") return { ...base, recordId: fields.recordId };
  return {
    ...base,
    text: fields.text,
    measure: fields.measure,
    // La durata viaggia solo con "Quante volte in un tempo dato".
    durationSeconds: measureNeedsDuration(fields.measure) ? fields.durationSeconds : null,
    needs: fields.needs,
  };
}

// ---------------------------------------------------------------------------
// Token di invio (`submissionId`)
// ---------------------------------------------------------------------------

type RandomSource = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
};

const HEX = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

// UUID v4. `crypto.randomUUID` esiste solo in contesto sicuro (https): sul resto
// si ripiega su `getRandomValues`, e in ultimo su `Math.random`. L'id passa lo
// schema del server (lettere, cifre, trattino, massimo 128 caratteri).
export function createSubmissionId(
  source: RandomSource | undefined = (globalThis as { crypto?: RandomSource }).crypto,
) {
  if (source && typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => HEX[byte]);
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export interface GuestSubmissionKeeper {
  // Il token per questi campi. Stesso foglio e stessi campi (doppio tocco,
  // risposta persa) = stesso token = una sola richiesta sul server. Se i campi
  // sono cambiati dopo un invio non riuscito il token cambia: il server
  // restituirebbe la richiesta vecchia, con il testo vecchio.
  tokenFor: (fields: RecordNightGuestRequestFields) => string;
  // Un foglio nuovo = una richiesta nuova: da chiamare quando se ne apre uno.
  renew: () => void;
}

export function createGuestSubmissionKeeper(
  generate: () => string = createSubmissionId,
): GuestSubmissionKeeper {
  let current: { id: string; fingerprint: string | null } = { id: generate(), fingerprint: null };
  return {
    tokenFor(fields) {
      const fingerprint = JSON.stringify(buildGuestSubmitPayload("", fields));
      if (current.fingerprint !== null && current.fingerprint !== fingerprint) {
        current = { id: generate(), fingerprint };
      } else {
        current = { id: current.id, fingerprint };
      }
      return current.id;
    },
    renew() {
      current = { id: generate(), fingerprint: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Sessione anonima: solo all'invio, mai al posto di un account
// ---------------------------------------------------------------------------

export interface AnonymousSessionAuth {
  authStateReady(): Promise<void>;
  readonly currentUser: { readonly uid: string; readonly isAnonymous: boolean } | null;
}

export const GUEST_SESSION_MESSAGE =
  "Non riesco ad aprire la sessione su questo telefono. Riapri la pagina e riprova.";

// Sessione anonima del telefono:
// - `ensure`: restituisce l'uid; attende che Firebase abbia riletto la sessione
//   salvata (senza, un account vero verrebbe scambiato per "nessuna sessione" e
//   sostituito); con un account vero NON crea nulla e rifiuta con "Hai un
//   account: accedi"; con una sessione anonima già presente la riusa; altrimenti
//   la crea con `signIn`, una volta sola anche con chiamate ravvicinate. Per
//   l'invio, e solo per quello.
// - `requireExisting`: come `ensure` ma non crea mai nulla; senza sessione
//   rifiuta con errore "session". Per leggere, ritirare e ripristinare.
export function createAnonymousSessionGate(
  auth: AnonymousSessionAuth,
  defaultSignIn: () => Promise<unknown>,
) {
  let pending: Promise<string> | null = null;

  async function requireExisting(): Promise<string> {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (user && !user.isAnonymous) {
      throw new RecordNightGuestClientError("account", GUEST_COPY.account);
    }
    if (!user) throw new RecordNightGuestClientError("session", GUEST_SESSION_MESSAGE);
    return user.uid;
  }

  async function ensure(signIn?: () => Promise<unknown>): Promise<string> {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (user && !user.isAnonymous) {
      throw new RecordNightGuestClientError("account", GUEST_COPY.account);
    }
    if (user) return user.uid;
    if (pending) return pending;

    const run = signIn ?? defaultSignIn;
    const attempt = (async () => {
      await run();
      const created = auth.currentUser;
      if (!created) throw new RecordNightGuestClientError("session", GUEST_SESSION_MESSAGE);
      if (!created.isAnonymous) throw new RecordNightGuestClientError("account", GUEST_COPY.account);
      return created.uid;
    })();
    pending = attempt;
    const clear = () => {
      if (pending === attempt) pending = null;
    };
    attempt.then(clear, clear);
    return attempt;
  }

  return { ensure, requireExisting };
}

// ---------------------------------------------------------------------------
// Errori delle callable -> testi per l'utente
// ---------------------------------------------------------------------------

export type RecordNightGuestErrorKind =
  | "account" // c'è un account vero: serve l'accesso
  | "session" // sessione del telefono non valida o non apribile
  | "closed" // iscrizioni chiuse
  | "disabled" // modulo non attivo
  | "phone_limit" // tetti per telefono o per persona
  | "unavailable" // coda piena, interruttore spento, richiesta non gestibile
  | "record_gone" // il record da sfidare non c'è più: ricarica l'elenco
  | "invalid" // campi non validi
  | "busy" // troppe richieste
  | "network" // rete o server non raggiungibili
  | "unknown";

export type RecordNightGuestAction = "load" | "submit" | "withdraw" | "restore";

// Errore nato nel client (validazione, sessione): porta già il testo per l'utente.
export class RecordNightGuestClientError extends Error {
  kind: RecordNightGuestErrorKind;
  fieldErrors: GuestFieldErrors;

  constructor(kind: RecordNightGuestErrorKind, message: string, fieldErrors: GuestFieldErrors = {}) {
    super(message);
    this.name = "RecordNightGuestClientError";
    this.kind = kind;
    this.fieldErrors = fieldErrors;
  }
}

// Testi del server per gli errori `failed-precondition` (stesso codice per
// cause diverse: è l'unico caso in cui si guarda il messaggio). Una prova in
// tests/ li confronta con functions/lib/recordNightGuest.js.
export const SERVER_GUEST_MESSAGES = {
  closed: CLOSED_MESSAGE,
  disabled: "La Notte dei Record non è attiva per questa attività.",
  phoneCap: "Hai già inviato il massimo di richieste da questo telefono.",
  recordGone: "Questo record non è più disponibile.",
} as const;

export const GUEST_GENERIC_ERROR =
  "Non è stato possibile completare l'operazione. Controlla la connessione e riprova.";

const UNAVAILABLE_BY_ACTION: Record<RecordNightGuestAction, string> = {
  load: GUEST_GENERIC_ERROR,
  submit: SUBMIT_UNAVAILABLE,
  withdraw: "Non riesco a ritirarla ora. Parlane con il dirigente della tua unità.",
  restore: "Non riesco a ripristinarla ora. Parlane con il dirigente della tua unità.",
};

function readError(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return {
    code: typeof code === "string" ? code : "",
    message: typeof message === "string" ? message.trim() : "",
  };
}

export function classifyGuestError(error: unknown): RecordNightGuestErrorKind {
  if (error instanceof RecordNightGuestClientError) return error.kind;
  const { code, message } = readError(error);
  if (code.startsWith("auth/")) {
    switch (code) {
      case "auth/network-request-failed":
        return "network";
      case "auth/too-many-requests":
        return "busy";
      default:
        return "session";
    }
  }
  switch (code.replace(/^functions\//u, "")) {
    case "permission-denied":
      // Nella callable dei telefoni è l'unico motivo: c'è un account vero.
      return "account";
    case "unauthenticated":
      return "session";
    case "invalid-argument":
      return "invalid";
    case "not-found":
      return "unavailable";
    case "resource-exhausted":
      return "busy";
    case "unavailable":
    case "deadline-exceeded":
    case "internal":
    case "cancelled":
      return "network";
    case "failed-precondition":
      if (message === SERVER_GUEST_MESSAGES.closed) return "closed";
      if (message === SERVER_GUEST_MESSAGES.disabled) return "disabled";
      if (message === SERVER_GUEST_MESSAGES.phoneCap) return "phone_limit";
      if (message === SERVER_GUEST_MESSAGES.recordGone) return "record_gone";
      return "unavailable";
    default:
      return "unknown";
  }
}

// Testo per l'utente: sempre neutro e in italiano. Non mostra mai
// `error.message` di un errore che non conosciamo, e non dice perché una
// richiesta è stata rifiutata (coda piena, interruttore spento e richiesta
// altrui hanno lo stesso testo).
export function getRecordNightGuestErrorMessage(
  error: unknown,
  action: RecordNightGuestAction = "submit",
): string {
  if (error instanceof RecordNightGuestClientError) return error.message;
  switch (classifyGuestError(error)) {
    case "account":
      return GUEST_COPY.account;
    case "session":
      return GUEST_SESSION_MESSAGE;
    case "closed":
      return SERVER_GUEST_MESSAGES.closed;
    case "disabled":
      return SERVER_GUEST_MESSAGES.disabled;
    case "phone_limit":
      // Stesso errore del server, detto per ciò che si stava facendo: all'invio come
      // liberare un posto, nel ripristino che la richiesta resta ritirata.
      if (action === "restore") return GUEST_COPY.restoreAtLimit;
      return action === "submit" ? GUEST_COPY.phoneLimit : SERVER_GUEST_MESSAGES.phoneCap;
    case "record_gone":
      return SERVER_GUEST_MESSAGES.recordGone;
    case "unavailable":
      return UNAVAILABLE_BY_ACTION[action];
    case "invalid":
      return "Controlla i dati inseriti e riprova.";
    case "busy":
      return "Troppi tentativi. Aspetta un momento e riprova.";
    default:
      return GUEST_GENERIC_ERROR;
  }
}

// ---------------------------------------------------------------------------
// Stato mostrato a chi ha inviato la richiesta
// ---------------------------------------------------------------------------

export interface GuestStateText {
  title: string;
  description: string;
}

// Testi esatti della spec, stato -> titolo e descrizione. `closed` sostituisce
// il testo quando le iscrizioni sono chiuse. Per `rejected` il motivo (scritto
// dallo staff per il ragazzo) arriva dal server e si legge con
// getGuestStateText. Ritirata e "Annulla"/"Ripristina" sono azioni, non testo.
export const GUEST_STATE_TEXTS: Record<
  RecordNightGuestState,
  GuestStateText & { closed?: GuestStateText }
> = {
  received: {
    title: "Richiesta ricevuta",
    description: "La controlla un adulto.",
    closed: {
      title: "Le iscrizioni sono chiuse",
      description: "Se non vedi «Ci sei», parlane con il dirigente della tua unità.",
    },
  },
  withdrawn: { title: "Ritiro fatto", description: "" },
  not_linked: {
    title: "Non siamo riusciti a collegare la richiesta",
    description: "Se hai già l'iscrizione al viaggio, parlane con il dirigente della tua unità.",
  },
  pending: {
    title: "In attesa di approvazione",
    description: "Per ritirarti parlane con un dirigente.",
  },
  approved: { title: "Ci sei", description: "Per ritirarti parlane con un dirigente." },
  rejected: { title: "Non accettata", description: "" },
  removed: {
    title: "Non sei più in elenco",
    description: "Se non lo volevi, parlane con un dirigente.",
  },
};

export function getGuestStateText(
  state: RecordNightGuestState,
  options: { closed?: boolean; reason?: string } = {},
): GuestStateText {
  const entry = GUEST_STATE_TEXTS[state] ?? GUEST_STATE_TEXTS.received;
  if (options.closed && entry.closed) return { ...entry.closed };
  if (state === "rejected") {
    return { title: entry.title, description: stripBidi(options.reason).trim() };
  }
  return { title: entry.title, description: entry.description };
}

// ---------------------------------------------------------------------------
// Contesto pubblico e richieste del telefono
// ---------------------------------------------------------------------------

// Il tasto "Segnati senza account" si mostra solo se il server dice `intakeOpen`
// e la chiusura non è passata nel frattempo (la pagina ha un orologio al minuto).
export function isGuestIntakeOpen(
  context: Pick<RecordNightGuestContext, "intakeOpen" | "closeAt"> | null | undefined,
  now: Date = new Date(),
) {
  if (!context || context.intakeOpen !== true || !context.closeAt) return false;
  const closeAt = new Date(context.closeAt);
  return !Number.isNaN(closeAt.getTime()) && now.getTime() < closeAt.getTime();
}

// Record pubblici per categoria, nell'ordine fisso delle categorie e per titolo:
// niente conteggi, che al pubblico non si danno.
export function groupPublicRecordsByCategory(records: ReadonlyArray<RecordNightPublicRecord>) {
  return RECORD_NIGHT_CATEGORIES.map((category) => ({
    category: category.value,
    label: category.label,
    records: records
      .filter((record) => record.category === category.value)
      .sort((left, right) => left.title.localeCompare(right.title, "it-IT") || left.id.localeCompare(right.id)),
  })).filter((group) => group.records.length > 0);
}

// Richieste ancora in coda (`received`): sono quelle che contano per il tetto
// del telefono.
export function countOpenGuestRequests(requests: ReadonlyArray<Pick<RecordNightGuestRequest, "state">>) {
  return requests.filter((request) => request.state === "received").length;
}

export function isAtGuestPhoneLimit(requests: ReadonlyArray<Pick<RecordNightGuestRequest, "state">>) {
  return countOpenGuestRequests(requests) >= RECORD_NIGHT_GUEST_LIMITS.openPerPhone;
}

// Record che questo telefono ha già sfidato con una richiesta ancora valida (in
// coda, in attesa o approvata): su quei record "Sfida" non serve. Una richiesta
// ritirata, non collegata, non accettata o tolta dall'elenco non conta.
const ACTIVE_CHALLENGE_STATES: ReadonlyArray<RecordNightGuestState> = ["received", "pending", "approved"];

export function getChallengedRecordIds(
  requests: ReadonlyArray<Pick<RecordNightGuestRequest, "kind" | "state" | "recordId">>,
) {
  const ids = new Set<string>();
  for (const request of requests) {
    if (request.kind !== "challenge" || !request.recordId) continue;
    if (ACTIVE_CHALLENGE_STATES.includes(request.state)) ids.add(request.recordId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Coda dello staff
// ---------------------------------------------------------------------------

function foldText(value: string | null | undefined) {
  return (value ?? "")
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export interface StaffOwnUnit {
  unitId?: string | null;
  unitName?: string | null;
}

function isOwnUnit(request: Pick<RecordNightStaffRequest, "unitId" | "unitName">, own: StaffOwnUnit) {
  if (own.unitId && request.unitId === own.unitId) return true;
  const name = foldText(own.unitName);
  return name !== "" && name === foldText(request.unitName);
}

const byCreatedAsc = (left: RecordNightStaffRequest, right: RecordNightStaffRequest) =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
const byUpdatedDesc = (left: RecordNightStaffRequest, right: RecordNightStaffRequest) =>
  right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);

// Le richieste per sezione della pagina Gestisci: "Da collegare" (le più vecchie
// per prime), poi le sezioni chiuse "Non collegate" (con Riapri), "Richieste
// ritirate" (dal telefono; anche queste si possono riaprire) e le collegate, che
// groupLinkedRequests divide per stato del tentativo.
export function splitStaffRequests(requests: ReadonlyArray<RecordNightStaffRequest>) {
  return {
    open: requests.filter((request) => request.status === "open").sort(byCreatedAsc),
    notLinked: requests.filter((request) => request.status === "rejected").sort(byUpdatedDesc),
    withdrawn: requests.filter((request) => request.status === "withdrawn").sort(byUpdatedDesc),
    linked: requests.filter((request) => request.status === "linked").sort(byUpdatedDesc),
  };
}

export type StaffLinkedKey = "pending" | "approved" | "rejected" | "withdrawn" | "missing";

export interface StaffLinkedState {
  key: StaffLinkedKey;
  // Chi ha ritirato il tentativo, solo per `withdrawn`.
  withdrawnBy: RecordNightWithdrawnBy | null;
  // Testo breve per lo staff (stesso lessico delle schede dei tentativi).
  label: string;
  tone: "" | "ok" | "no" | "off";
}

// Stato leggibile di una richiesta collegata, dal tentativo (`entryStatus`,
// `withdrawnBy` di listRequests). Senza tentativo (cancellato) è "missing".
export function getStaffLinkedState(
  request: Pick<RecordNightStaffRequest, "entryStatus" | "withdrawnBy">,
): StaffLinkedState {
  const withdrawnBy = request.withdrawnBy ?? null;
  switch (request.entryStatus) {
    case "pending":
      return { key: "pending", withdrawnBy: null, label: "In attesa", tone: "" };
    case "approved":
      return { key: "approved", withdrawnBy: null, label: "Ci sei", tone: "ok" };
    case "rejected":
      return { key: "rejected", withdrawnBy: null, label: "Non accettata", tone: "no" };
    case "withdrawn":
      return {
        key: "withdrawn",
        withdrawnBy,
        label:
          withdrawnBy === "staff"
            ? "Ritirata da un adulto"
            : withdrawnBy === "system"
              ? "Iscrizione annullata"
              : withdrawnBy === "self"
                ? "Ritirata dalla persona"
                : "Ritirata",
        tone: "off",
      };
    default:
      return { key: "missing", withdrawnBy: null, label: "Tentativo non trovato", tone: "off" };
  }
}

export const STAFF_LINKED_GROUP_LABELS: Record<StaffLinkedKey, string> = {
  pending: "In attesa",
  approved: "Approvate",
  rejected: "Non accettate",
  withdrawn: "Ritirate",
  missing: "Tentativo non trovato",
};

export interface StaffLinkedGroup {
  key: StaffLinkedKey;
  label: string;
  requests: RecordNightStaffRequest[];
}

// Le richieste collegate divise per stato del tentativo, in ordine fisso (in
// attesa, approvate, non accettate, ritirate, senza tentativo) e senza gruppi
// vuoti. Dentro il gruppo l'ordine di ingresso; le altre richieste si ignorano.
export function groupLinkedRequests(requests: ReadonlyArray<RecordNightStaffRequest>): StaffLinkedGroup[] {
  const order: StaffLinkedKey[] = ["pending", "approved", "rejected", "withdrawn", "missing"];
  const groups = new Map<StaffLinkedKey, RecordNightStaffRequest[]>();
  for (const request of requests) {
    if (request.status !== "linked") continue;
    const { key } = getStaffLinkedState(request);
    groups.set(key, [...(groups.get(key) ?? []), request]);
  }
  return order
    .filter((key) => groups.has(key))
    .map((key) => ({ key, label: STAFF_LINKED_GROUP_LABELS[key], requests: groups.get(key) ?? [] }));
}

// Riga di esito del rifiuto in blocco: quante segnate e quante saltate perché
// non erano più in coda (collegate, ritirate o già gestite nel frattempo).
export function describeBulkRejectResult(result: { rejectedCount: number; skippedCount?: number }) {
  const rejected = Math.max(0, Math.floor(result.rejectedCount || 0));
  const skipped = Math.max(0, Math.floor(result.skippedCount || 0));
  const parts: string[] = [];
  if (rejected > 0) {
    parts.push(
      rejected === 1
        ? "1 richiesta segnata come non collegabile."
        : `${rejected} richieste segnate come non collegabili.`,
    );
  }
  if (skipped > 0) {
    parts.push(skipped === 1 ? "1 non era più in coda." : `${skipped} non erano più in coda.`);
  }
  return parts.length ? parts.join(" ") : "Nessuna richiesta da segnare.";
}

// "Senza abbinamento": nessun suggerimento calcolato dal server.
export function hasNoSuggestion(request: Pick<RecordNightStaffRequest, "suggestions">) {
  return request.suggestions.length === 0;
}

// Filtri della coda: per unità e "Senza abbinamento". La sua unità in alto.
export function filterStaffQueue(
  open: ReadonlyArray<RecordNightStaffRequest>,
  filters: { unitId?: string | null; unmatchedOnly?: boolean } = {},
  own: StaffOwnUnit = {},
) {
  return open
    .filter((request) => !filters.unitId || request.unitId === filters.unitId)
    .filter((request) => !filters.unmatchedOnly || hasNoSuggestion(request))
    .map((request, index) => ({ request, index, own: isOwnUnit(request, own) }))
    .sort((left, right) => Number(right.own) - Number(left.own) || left.index - right.index)
    .map((item) => item.request);
}

export interface StaffQueueUnitFilter {
  unitId: string;
  unitName: string;
  count: number;
  isOwn: boolean;
}

// Unità presenti nella coda con il numero di richieste: la sua in alto, poi per nome.
export function buildStaffQueueUnitFilters(
  open: ReadonlyArray<RecordNightStaffRequest>,
  own: StaffOwnUnit = {},
): StaffQueueUnitFilter[] {
  const byUnit = new Map<string, StaffQueueUnitFilter>();
  for (const request of open) {
    const current = byUnit.get(request.unitId);
    if (current) current.count += 1;
    else {
      byUnit.set(request.unitId, {
        unitId: request.unitId,
        unitName: request.unitName,
        count: 1,
        isOwn: isOwnUnit(request, own),
      });
    }
  }
  return [...byUnit.values()].sort(
    (left, right) =>
      Number(right.isOwn) - Number(left.isOwn) ||
      left.unitName.localeCompare(right.unitName, "it-IT") ||
      left.unitId.localeCompare(right.unitId),
  );
}

// Gli id divisi in gruppi da `size`, senza doppioni (rifiuto in blocco: 50 a chiamata).
export function chunkRequestIds(ids: ReadonlyArray<string>, size = MAX_BULK_REJECT_REQUESTS) {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Caricamento e azioni: l'ultima richiesta vince
// ---------------------------------------------------------------------------

export type LatestRead<T> =
  | { superseded: true }
  | { superseded: false; ok: true; value: T }
  | { superseded: false; ok: false; error: unknown };

// Ogni lettura riceve un numero; una risposta (o un errore) di una lettura che
// nel frattempo è stata superata da una più recente, o invalidata (cambio chiave,
// smontaggio), si scarta: non copre mai una lettura più nuova.
export function createLatestLoader<T>() {
  let latest = 0;
  return {
    async run(read: () => Promise<T>): Promise<LatestRead<T>> {
      latest += 1;
      const mine = latest;
      try {
        const value = await read();
        return mine === latest ? { superseded: false, ok: true, value } : { superseded: true };
      } catch (error) {
        return mine === latest ? { superseded: false, ok: false, error } : { superseded: true };
      }
    },
    invalidate() {
      latest += 1;
    },
  };
}

export type ActionRun<T> =
  | { status: "busy" }
  | { status: "done"; value: T; stale: boolean }
  | { status: "failed"; error: unknown };

// Un'azione per volta (niente doppio tocco), poi la rilettura. La rilettura si
// sceglie DOPO l'azione con `getReload()`: durante l'azione la pagina può cambiare
// (al primo invio nasce la sessione anonima e con lei la chiave di `mine`), e un
// riferimento preso al clic leggerebbe una chiave vuota senza fare nulla.
// `reload` restituisce false se la lettura non è riuscita (esito `stale`).
export function createActionRunner(options: {
  getReload: () => () => Promise<boolean>;
  setBusy?: (busy: boolean) => void;
  // Dopo un errore si rilegge, tranne dove non ha parlato col server (default sì).
  reloadOnError?: (error: unknown) => boolean;
}) {
  let busy = false;

  async function reload() {
    try {
      return await options.getReload()();
    } catch {
      return false;
    }
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<ActionRun<T>> {
      if (busy) return { status: "busy" };
      busy = true;
      options.setBusy?.(true);
      try {
        let value: T;
        try {
          value = await task();
        } catch (error) {
          if (!options.reloadOnError || options.reloadOnError(error)) await reload();
          return { status: "failed", error };
        }
        return { status: "done", value, stale: !(await reload()) };
      } finally {
        busy = false;
        options.setBusy?.(false);
      }
    },
  };
}
