import { httpsCallable } from "firebase/functions";

import { authService } from "@/services/auth/authService";
import { auth, functions } from "@/services/firebase/app";
import type {
  RecordNightEntry,
  RecordNightGuestContext,
  RecordNightGuestMine,
  RecordNightGuestState,
  RecordNightRecord,
  RecordNightStaffRequest,
} from "@/types";
import {
  MAX_BULK_REJECT_REQUESTS,
  RecordNightGuestClientError,
  buildGuestSubmitPayload,
  createAnonymousSessionGate,
  validateGuestDraft,
  type RecordNightGuestDraft,
  type RecordNightGuestRequestFields,
} from "@/utils/recordNightGuest";

import {
  mapGuestContext,
  mapGuestMine,
  mapStaffQueue,
  mapStaffRequest,
  type RecordNightRequestQueue,
} from "./recordNightGuestMappers";
import { mapRecordNightEntry, mapRecordNightRecord } from "./recordNightService";

// Notte dei Record, richieste senza account
// (docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md). Le richieste non si leggono né si
// scrivono dal client (rules `if false`): passano solo da due callable.
//
// - `recordNightGuest`: il telefono. `context` è pubblico, il resto vuole la
//   sessione anonima del telefono (`signInAnonymously`), che si crea SOLO in
//   `submit` e mai al posto di un account vero.
// - `recordNightAdmin`: lo staff (coda "Da collegare"). Sta qui e non in
//   recordNightService.ts per non toccare le chiamate che il test di contratto
//   di functions/tests/recordNightEmulator.test.mjs legge da quel file.

interface RawGuestResult {
  ok: boolean;
  action: string;
  requestId?: unknown;
  state?: unknown;
  [key: string]: unknown;
}

interface RawAdminResult {
  ok: boolean;
  action: string;
  entry?: (Record<string, unknown> & { id: string }) | null;
  record?: (Record<string, unknown> & { id: string }) | null;
  request?: Record<string, unknown> | null;
  requests?: unknown;
  rejectedCount?: unknown;
  [key: string]: unknown;
}

const guestCallable = httpsCallable<Record<string, unknown>, RawGuestResult>(
  functions,
  "recordNightGuest",
);

const staffCallable = httpsCallable<Record<string, unknown>, RawAdminResult>(
  functions,
  "recordNightAdmin",
);

async function callGuest(
  stakeId: string,
  activityId: string,
  action: string,
  payload: Record<string, unknown> = {},
) {
  const result = await guestCallable({ stakeId, activityId, action, ...payload });
  return result.data;
}

async function callStaff(
  stakeId: string,
  activityId: string,
  action: string,
  payload: Record<string, unknown> = {},
) {
  const result = await staffCallable({ stakeId, activityId, action, ...payload });
  return result.data;
}

// ---------------------------------------------------------------------------
// Sessione anonima del telefono
// ---------------------------------------------------------------------------

const phoneSession = createAnonymousSessionGate(auth, () => authService.signInAnonymously());

// ---------------------------------------------------------------------------
// Telefono (callable recordNightGuest)
// ---------------------------------------------------------------------------

export interface RecordNightGuestSubmitResult {
  requestId: string;
}

export interface RecordNightGuestChangeResult {
  requestId: string;
  state: RecordNightGuestState;
}

function requestIdOf(data: RawGuestResult) {
  const requestId = typeof data.requestId === "string" ? data.requestId : "";
  if (!requestId) throw new Error("Risposta senza richiesta.");
  return requestId;
}

export const recordNightGuestService = {
  // Modulo, scadenza, unità attive e record scritti dallo staff. Pubblico: si
  // chiama anche senza login e non crea nessuna sessione.
  async getContext(stakeId: string, activityId: string): Promise<RecordNightGuestContext> {
    return mapGuestContext(await callGuest(stakeId, activityId, "context"));
  },

  // Invia la richiesta. Controlla i campi PRIMA di ogni altra cosa (una richiesta
  // sbagliata non apre nessuna sessione), poi apre la sessione anonima se non
  // c'è, poi chiama. Con un account vero non crea nulla: errore "account".
  // `submissionId` è il token del foglio aperto (vedi createGuestSubmissionKeeper):
  // lo stesso token due volte restituisce la stessa richiesta.
  // `signIn` permette di usare il `signInAnonymously` dell'AuthProvider, che
  // aggiorna subito la sessione dell'app.
  async submit(
    stakeId: string,
    activityId: string,
    submissionId: string,
    fields: RecordNightGuestRequestFields,
    options: { signIn?: () => Promise<unknown> } = {},
  ): Promise<RecordNightGuestSubmitResult> {
    const checked = validateGuestDraft(fields as RecordNightGuestDraft);
    if (!checked.ok) {
      const first = Object.values(checked.errors)[0] ?? "Controlla i dati inseriti e riprova.";
      throw new RecordNightGuestClientError("invalid", first, checked.errors);
    }
    await phoneSession.ensure(options.signIn);
    const data = await callGuest(
      stakeId,
      activityId,
      "submit",
      buildGuestSubmitPayload(submissionId, checked.fields),
    );
    return { requestId: requestIdOf(data) };
  },

  // Le richieste di questo telefono con il loro stato. Funziona anche a finestra
  // chiusa e a interruttore spento.
  async mine(stakeId: string, activityId: string): Promise<RecordNightGuestMine> {
    await phoneSession.requireExisting();
    return mapGuestMine(await callGuest(stakeId, activityId, "mine"));
  },

  // Solo una richiesta ancora in coda, a finestra aperta. Poi c'è "Annulla"
  // (`restore`).
  async withdraw(
    stakeId: string,
    activityId: string,
    requestId: string,
  ): Promise<RecordNightGuestChangeResult> {
    await phoneSession.requireExisting();
    const data = await callGuest(stakeId, activityId, "withdraw", { requestId });
    return { requestId: requestIdOf(data), state: "withdrawn" };
  },

  // "Annulla" dopo il ritiro e "Ripristina": rimette in coda, con gli stessi
  // tetti dell'invio.
  async restore(
    stakeId: string,
    activityId: string,
    requestId: string,
  ): Promise<RecordNightGuestChangeResult> {
    await phoneSession.requireExisting();
    const data = await callGuest(stakeId, activityId, "restore", { requestId });
    return { requestId: requestIdOf(data), state: "received" };
  },
};

// ---------------------------------------------------------------------------
// Staff (callable recordNightAdmin)
// ---------------------------------------------------------------------------

export type { RecordNightRequestQueue } from "./recordNightGuestMappers";

// Esito di un'azione dello staff: il tentativo e il record toccati (null se non
// toccati) e la richiesta com'è ora. `requests` e `rejectedCount` solo per il
// rifiuto in blocco.
export interface RecordNightRequestActionResult {
  entry: RecordNightEntry | null;
  record: RecordNightRecord | null;
  request: RecordNightStaffRequest | null;
  requests: RecordNightStaffRequest[];
  rejectedCount: number;
}

// Errore nel formato delle callable, così getRecordNightErrorMessage mostra il
// testo senza passare dalla rete.
function staffInputError(message: string) {
  return Object.assign(new Error(message), { code: "functions/invalid-argument" });
}

function mapActionResult(raw: RawAdminResult): RecordNightRequestActionResult {
  const requests = Array.isArray(raw.requests)
    ? raw.requests
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map(mapStaffRequest)
    : [];
  return {
    entry: raw.entry ? mapRecordNightEntry(raw.entry.id, raw.entry) : null,
    record: raw.record ? mapRecordNightRecord(raw.record.id, raw.record) : null,
    request: raw.request ? mapStaffRequest(raw.request) : null,
    requests,
    rejectedCount:
      typeof raw.rejectedCount === "number" && raw.rejectedCount > 0
        ? Math.floor(raw.rejectedCount)
        : requests.length,
  };
}

export const recordNightRequestsService = {
  // La coda: tutte le richieste non scadute. Per ogni `open` i doppioni e fino a
  // 3 abbinamenti calcolati dal server (indizi, non prove).
  async list(stakeId: string, activityId: string): Promise<RecordNightRequestQueue> {
    return mapStaffQueue(await callStaff(stakeId, activityId, "listRequests"));
  },

  // Collega la richiesta a un'iscrizione (`user_`, `child_` o `manual_`) e crea il
  // tentativo. `verified` è la spunta "La persona mi ha confermato di aver inviato
  // questa richiesta": senza, non parte nulla (lo rifiuta anche il server).
  async link(
    stakeId: string,
    activityId: string,
    requestId: string,
    registrationId: string,
    verified: boolean,
  ): Promise<RecordNightRequestActionResult> {
    if (verified !== true) {
      throw staffInputError(
        "Serve la conferma della persona: spunta «La persona mi ha confermato di aver inviato questa richiesta».",
      );
    }
    return mapActionResult(
      await callStaff(stakeId, activityId, "linkRequest", {
        requestId,
        registrationId,
        verified: true,
      }),
    );
  },

  // "Non collegabile": solo una richiesta in coda. La nota resta interna.
  async reject(
    stakeId: string,
    activityId: string,
    requestId: string,
    note?: string,
  ): Promise<RecordNightRequestActionResult> {
    return mapActionResult(
      await callStaff(stakeId, activityId, "rejectRequest", {
        requestId,
        ...(note ? { note } : {}),
      }),
    );
  },

  // Rifiuto in blocco: da 1 a 50 richieste, tutto o niente. Per di più, a gruppi
  // (chunkRequestIds).
  async rejectMany(
    stakeId: string,
    activityId: string,
    requestIds: string[],
    note?: string,
  ): Promise<RecordNightRequestActionResult> {
    const ids = [...new Set(requestIds)];
    if (ids.length === 0) throw staffInputError("Scegli almeno una richiesta.");
    if (ids.length > MAX_BULK_REJECT_REQUESTS) {
      throw staffInputError(`Troppe richieste in una volta (massimo ${MAX_BULK_REJECT_REQUESTS}).`);
    }
    return mapActionResult(
      await callStaff(stakeId, activityId, "rejectRequests", {
        requestIds: ids,
        ...(note ? { note } : {}),
      }),
    );
  },

  // "Riapri": una richiesta non collegabile torna in coda.
  async reopen(
    stakeId: string,
    activityId: string,
    requestId: string,
  ): Promise<RecordNightRequestActionResult> {
    return mapActionResult(await callStaff(stakeId, activityId, "reopenRequest", { requestId }));
  },

  // "Scollega": il ritorno universale. Il tentativo collegato va a ritirato (senza
  // "Annulla"), la richiesta torna in coda. Per una proposta approvata che ha
  // creato un record serve prima "Riporta in attesa".
  async unlink(
    stakeId: string,
    activityId: string,
    requestId: string,
  ): Promise<RecordNightRequestActionResult> {
    return mapActionResult(await callStaff(stakeId, activityId, "unlinkRequest", { requestId }));
  },
};
