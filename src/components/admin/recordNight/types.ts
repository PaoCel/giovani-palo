// Contesto condiviso dalle parti della scheda admin "Record".

import type { RecordNightParticipantOption } from "@/services/firestore/recordNightService";
import type { RecordNightEntry, RecordNightRecord } from "@/types";

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

export interface RnaContext {
  stakeId: string;
  activityId: string;
  // Un'azione è in corso: tutti i tasti restano fermi finché non finisce
  // (due azioni insieme sullo stesso record si pesterebbero i contatori).
  busy: boolean;
  busyKey: string | null;
  participants: RnaParticipants;
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
