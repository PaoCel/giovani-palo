// Contesto condiviso dalle parti della scheda admin "Record".

import type { RecordNightRequestActionResult } from "@/services/firestore/recordNightGuestService";
import type { RecordNightParticipantOption } from "@/services/firestore/recordNightService";
import type { RecordNightEntry, RecordNightRecord, RecordNightStaffRequest } from "@/types";

export type RnaRunResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

// Dati appena riletti dal server, dopo l'azione.
export interface RnaFreshData {
  records: RecordNightRecord[];
  entries: RecordNightEntry[];
}

// Persone che si possono iscrivere a un record (solo per chi organizza).
export interface RnaParticipants {
  status: "loading" | "ready" | "error";
  list: ReadonlyArray<RecordNightParticipantOption>;
  reload: () => void;
}

// Richieste senza account (coda "Da collegare"). Le azioni passano dallo stesso
// blocco delle altre (un'azione per volta, poi rilettura di record e tentativi) e
// restituiscono già il testo d'errore per l'utente, mai quello grezzo del server.
export interface RnaRequests {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  list: ReadonlyArray<RecordNightStaffRequest>;
  byId: ReadonlyMap<string, RecordNightStaffRequest>;
  // Richieste `open` in coda e tetto per telefono (lo staff può superarlo).
  openCount: number;
  openLimit: number;
  // Record dell'attività (per mostrare categoria e misura di una sfida).
  recordsById: ReadonlyMap<string, RecordNightRecord>;
  // Tentativi attivi per iscrizione e iscritti ai record (per la ricerca per nome).
  activeEntryCounts: ReadonlyMap<string, number>;
  takenByRecord: ReadonlyMap<string, ReadonlySet<string>>;
  reload: () => void;
  // `verified` è la spunta dello staff: senza, non parte nulla.
  link: (
    request: RecordNightStaffRequest,
    person: { registrationId: string; name: string },
    verified: boolean,
  ) => Promise<RnaRunResult<RecordNightRequestActionResult>>;
  reject: (
    request: RecordNightStaffRequest,
    note: string,
  ) => Promise<RnaRunResult<RecordNightRequestActionResult>>;
  rejectMany: (
    requests: ReadonlyArray<RecordNightStaffRequest>,
  ) => Promise<RnaRunResult<{ rejectedCount: number }>>;
  reopen: (
    request: RecordNightStaffRequest,
  ) => Promise<RnaRunResult<RecordNightRequestActionResult>>;
  unlink: (
    request: RecordNightStaffRequest,
  ) => Promise<RnaRunResult<RecordNightRequestActionResult>>;
}

export interface RnaContext {
  stakeId: string;
  activityId: string;
  // Un'azione è in corso: tutti i tasti restano fermi finché non finisce
  // (due azioni insieme sullo stesso record si pesterebbero i contatori).
  busy: boolean;
  busyKey: string | null;
  participants: RnaParticipants;
  requests: RnaRequests;
  // Mostra un avviso in basso senza passare da `run` (nessuna rilettura).
  notify: (text: string) => void;
  // Esegue l'azione e ricarica i dati dal server. Se fallisce restituisce il
  // messaggio d'errore da mostrare dove si è cliccato. `doneMessage` compare
  // come avviso in basso; se è una funzione riceve l'esito e i dati riletti
  // (per dire quanti sono rientrati, quanti ritirati).
  run: <T>(
    key: string,
    task: () => Promise<T>,
    doneMessage?: string | ((value: T, fresh: RnaFreshData) => string),
  ) => Promise<RnaRunResult<T>>;
}
