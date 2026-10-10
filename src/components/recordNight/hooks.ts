import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import {
  recordNightGuestService,
  recordNightRequestsService,
  type RecordNightGuestChangeResult,
  type RecordNightGuestSubmitResult,
  type RecordNightRequestActionResult,
  type RecordNightRequestQueue,
} from "@/services/firestore/recordNightGuestService";
import { getRecordNightErrorMessage } from "@/services/firestore/recordNightService";
import type {
  RecordNightGuestContext,
  RecordNightGuestRequest,
} from "@/types";
import {
  RecordNightGuestClientError,
  chunkRequestIds,
  classifyGuestError,
  createGuestSubmissionKeeper,
  getRecordNightGuestErrorMessage,
  splitStaffRequests,
  type GuestFieldErrors,
  type RecordNightGuestAction,
  type RecordNightGuestErrorKind,
  type RecordNightGuestRequestFields,
} from "@/utils/recordNightGuest";

// Pelle "Tabellone" su tutta la finestra mentre la pagina dei record è aperta:
// la classe su <html> scurisce sfondo, barra in alto e avvisi della shell
// (regole in src/styles/recordNight.css, tutte sotto `html.rn-skin`). Si toglie
// all'uscita, così il resto dell'app resta com'è.
export function useRecordNightSkin() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousTheme = themeMeta?.getAttribute("content") ?? null;

    root.classList.add("rn-skin");
    themeMeta?.setAttribute("content", "#0b0d12");

    return () => {
      root.classList.remove("rn-skin");
      if (themeMeta && previousTheme !== null) {
        themeMeta.setAttribute("content", previousTheme);
      }
    };
  }, []);
}

// Ora corrente che avanza allo scoccare di ogni minuto: basta per il conto alla
// rovescia (giorni/ore/minuti) e per chiudere la pagina all'ora di chiusura.
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const untilNextMinute = 60_000 - (Date.now() % 60_000) + 50;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, untilNextMinute);

    // Tornando sulla scheda dopo ore il timer del browser può essere rimasto
    // indietro: si riallinea subito.
    function handleVisibility() {
      if (document.visibilityState === "visible") setNow(new Date());
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return now;
}

// ---------------------------------------------------------------------------
// Richieste senza account: hook di dati (docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md)
// ---------------------------------------------------------------------------
// Stesso schema di RecordNightPage: letture dal server, la richiesta più recente
// vince (una risposta vecchia non copre una nuova), un solo comando per volta e
// rilettura dopo ogni azione. Nessun JSX: i componenti leggono lo stato e
// chiamano le azioni, che non lanciano errori ma restituiscono un esito.

export type RecordNightLoadStatus = "idle" | "loading" | "ready" | "error";

// Esito di un'azione di un telefono. `message` è già il testo per l'utente.
// `stale`: l'azione è riuscita ma la rilettura no, l'elenco può essere vecchio.
export type GuestActionOutcome<T> =
  | { ok: true; value: T; stale: boolean }
  | { ok: false; kind: RecordNightGuestErrorKind; message: string; fieldErrors: GuestFieldErrors };

export type StaffActionOutcome<T> =
  | { ok: true; value: T; stale: boolean }
  | { ok: false; message: string };

const BUSY_MESSAGE = "Un'altra operazione è ancora in corso. Aspetta un momento.";

// --- Contesto pubblico --------------------------------------------------------

interface GuestContextState {
  key: string;
  context: RecordNightGuestContext | null;
  error: string | null;
}

// Modulo, scadenza, unità e record pubblici. Non vuole login e non crea nessuna
// sessione. `error` con `context` presente = la rilettura non è riuscita e i dati
// possono essere vecchi.
export function useRecordNightGuestContext(stakeId: string, activityId: string, enabled = true) {
  const key = enabled && stakeId && activityId ? `${stakeId}/${activityId}` : "";
  const [state, setState] = useState<GuestContextState | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!key) return;
    const request = ++requestRef.current;
    try {
      const context = await recordNightGuestService.getContext(stakeId, activityId);
      if (request !== requestRef.current) return;
      setState({ key, context, error: null });
    } catch (error) {
      if (request !== requestRef.current) return;
      console.error("Notte dei Record: contesto pubblico non disponibile.", error);
      setState((current) => ({
        key,
        context: current?.key === key ? current.context : null,
        error: getRecordNightGuestErrorMessage(error, "load"),
      }));
    }
  }, [activityId, key, stakeId]);

  useEffect(() => {
    void load();
    return () => {
      // Una risposta in volo di una chiave vecchia (o dopo lo smontaggio) non conta.
      requestRef.current += 1;
    };
  }, [load]);

  const current = state?.key === key ? state : null;
  const context = current?.context ?? null;
  const status: RecordNightLoadStatus = !key
    ? "idle"
    : context
      ? "ready"
      : current?.error
        ? "error"
        : "loading";
  return { context, status, error: current?.error ?? null, reload: load };
}

// --- Le mie richieste da questo telefono -------------------------------------

// Chi guarda la pagina:
// - "loading": l'autenticazione si sta avviando;
// - "none": nessuna sessione (si crea solo all'invio): nessuna richiesta;
// - "account": c'è un account vero, che qui non usa le richieste senza account;
// - "phone": sessione anonima, le richieste si leggono.
export type GuestPhoneMode = "loading" | "none" | "account" | "phone";

interface GuestMineState {
  key: string;
  open: boolean;
  closeAt: string | null;
  requests: RecordNightGuestRequest[];
  loaded: boolean;
  error: string | null;
}

export function useRecordNightGuestRequests(stakeId: string, activityId: string, enabled = true) {
  const { session, loading: authLoading, signInAnonymously } = useAuth();
  const mode: GuestPhoneMode = authLoading
    ? "loading"
    : !session
      ? "none"
      : session.isAnonymous
        ? "phone"
        : "account";
  const uid = mode === "phone" && session ? session.firebaseUser.uid : "";
  const key = enabled && uid && stakeId && activityId ? `${stakeId}/${activityId}/${uid}` : "";

  const [state, setState] = useState<GuestMineState | null>(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  // Un token per foglio: vedi createGuestSubmissionKeeper.
  const [keeper] = useState(() => createGuestSubmissionKeeper());
  // L'AuthProvider cambia funzione a ogni render: si usa sempre l'ultima.
  const signInRef = useRef(signInAnonymously);
  useEffect(() => {
    signInRef.current = signInAnonymously;
  });

  // true se la lettura è riuscita (o non c'era nulla da leggere).
  const load = useCallback(async () => {
    if (!key) return true;
    const request = ++requestRef.current;
    try {
      const mine = await recordNightGuestService.mine(stakeId, activityId);
      if (request !== requestRef.current) return true;
      setState({
        key,
        open: mine.open,
        closeAt: mine.closeAt,
        requests: mine.requests,
        loaded: true,
        error: null,
      });
      return true;
    } catch (error) {
      if (request !== requestRef.current) return true;
      console.error("Notte dei Record: richieste del telefono non disponibili.", error);
      setState((current) => {
        const previous = current?.key === key ? current : null;
        return {
          key,
          open: previous?.open ?? false,
          closeAt: previous?.closeAt ?? null,
          requests: previous?.requests ?? [],
          loaded: previous?.loaded === true,
          error: getRecordNightGuestErrorMessage(error, "load"),
        };
      });
      return false;
    }
  }, [activityId, key, stakeId]);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  // Un comando per volta. Dopo l'azione rilegge `mine`; dopo un errore del
  // server o della rete rilegge lo stesso: una risposta persa può aver creato la
  // richiesta, una richiesta può essere stata collegata nel frattempo.
  const run = useCallback(
    async <T,>(
      action: RecordNightGuestAction,
      task: () => Promise<T>,
    ): Promise<GuestActionOutcome<T>> => {
      if (busyRef.current) {
        return { ok: false, kind: "busy", message: BUSY_MESSAGE, fieldErrors: {} };
      }
      busyRef.current = true;
      setBusy(true);
      try {
        let value: T;
        try {
          value = await task();
        } catch (error) {
          if (!(error instanceof RecordNightGuestClientError)) await load();
          return {
            ok: false,
            kind: classifyGuestError(error),
            message: getRecordNightGuestErrorMessage(error, action),
            fieldErrors: error instanceof RecordNightGuestClientError ? error.fieldErrors : {},
          };
        }
        const fresh = await load();
        return { ok: true, value, stale: !fresh };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [load],
  );

  // Invia la richiesta. La sessione anonima si crea qui, e solo qui; con un
  // account vero l'esito è `kind: "account"` ("Hai un account: accedi"). Il token
  // è quello del foglio aperto: stessi campi = stessa richiesta.
  const submit = useCallback(
    async (fields: RecordNightGuestRequestFields): Promise<GuestActionOutcome<RecordNightGuestSubmitResult>> => {
      const token = keeper.tokenFor(fields);
      const outcome = await run("submit", () =>
        recordNightGuestService.submit(stakeId, activityId, token, fields, {
          signIn: () => signInRef.current(),
        }),
      );
      if (outcome.ok) keeper.renew();
      return outcome;
    },
    [activityId, keeper, run, stakeId],
  );

  const withdraw = useCallback(
    (requestId: string): Promise<GuestActionOutcome<RecordNightGuestChangeResult>> =>
      run("withdraw", () => recordNightGuestService.withdraw(stakeId, activityId, requestId)),
    [activityId, run, stakeId],
  );

  // "Annulla" subito dopo un ritiro e "Ripristina" dalla sezione "Ritirate".
  const restore = useCallback(
    (requestId: string): Promise<GuestActionOutcome<RecordNightGuestChangeResult>> =>
      run("restore", () => recordNightGuestService.restore(stakeId, activityId, requestId)),
    [activityId, run, stakeId],
  );

  // Da chiamare quando si apre un foglio nuovo: una richiesta nuova, non il
  // rinvio dell'ultima.
  const startRequest = useCallback(() => keeper.renew(), [keeper]);

  const current = state?.key === key ? state : null;
  const requests = useMemo(() => current?.requests ?? [], [current]);
  const status: RecordNightLoadStatus = !key
    ? "idle"
    : current?.loaded
      ? "ready"
      : current?.error
        ? "error"
        : "loading";
  return {
    mode,
    status,
    // Con `status: "ready"` e un errore la rilettura non è riuscita: i dati possono essere vecchi.
    error: current?.error ?? null,
    requests,
    // Finestra delle iscrizioni, come la vede il server alla lettura.
    open: current?.open ?? false,
    closeAt: current?.closeAt ?? null,
    busy,
    reload: load,
    submit,
    withdraw,
    restore,
    startRequest,
  };
}

// --- Coda dello staff ---------------------------------------------------------

interface QueueState {
  key: string;
  queue: RecordNightRequestQueue | null;
  error: string | null;
}

const EMPTY_QUEUE: RecordNightRequestQueue = { requests: [], openCount: 0, openLimit: 0 };

// Coda "Da collegare" per chi gestisce i record. `enabled` = il server ha detto
// `isStaff` (senza, la callable rifiuta). Le sezioni sono già divise e ordinate.
export function useRecordNightRequestQueue(stakeId: string, activityId: string, enabled = true) {
  const key = enabled && stakeId && activityId ? `${stakeId}/${activityId}` : "";
  const [state, setState] = useState<QueueState | null>(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  // true se la lettura è riuscita (o non c'era nulla da leggere).
  const load = useCallback(async () => {
    if (!key) return true;
    const request = ++requestRef.current;
    try {
      const queue = await recordNightRequestsService.list(stakeId, activityId);
      if (request !== requestRef.current) return true;
      setState({ key, queue, error: null });
      return true;
    } catch (error) {
      if (request !== requestRef.current) return true;
      console.error("Notte dei Record: coda delle richieste non disponibile.", error);
      setState((current) => ({
        key,
        queue: current?.key === key ? current.queue : null,
        error: "Non riesco a caricare le richieste. Controlla la connessione e riprova.",
      }));
      return false;
    }
  }, [activityId, key, stakeId]);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const run = useCallback(
    async <T,>(task: () => Promise<T>): Promise<StaffActionOutcome<T>> => {
      if (busyRef.current) return { ok: false, message: BUSY_MESSAGE };
      busyRef.current = true;
      setBusy(true);
      try {
        let value: T;
        try {
          value = await task();
        } catch (error) {
          // La richiesta può essere cambiata sotto i piedi (collegata, ritirata): si rilegge.
          await load();
          return { ok: false, message: getRecordNightErrorMessage(error) };
        }
        const fresh = await load();
        return { ok: true, value, stale: !fresh };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [load],
  );

  // Collega a un'iscrizione. `verified` è la spunta dello staff: senza, nessuna chiamata.
  const link = useCallback(
    (requestId: string, registrationId: string, verified: boolean) =>
      run<RecordNightRequestActionResult>(() =>
        recordNightRequestsService.link(stakeId, activityId, requestId, registrationId, verified),
      ),
    [activityId, run, stakeId],
  );

  const reject = useCallback(
    (requestId: string, note?: string) =>
      run<RecordNightRequestActionResult>(() =>
        recordNightRequestsService.reject(stakeId, activityId, requestId, note),
      ),
    [activityId, run, stakeId],
  );

  // Rifiuto in blocco, a gruppi da 50. Se un gruppo fallisce i precedenti restano
  // rifiutati e il messaggio dice quanti.
  const rejectMany = useCallback(
    (requestIds: string[], note?: string) =>
      run<{ rejectedCount: number }>(async () => {
        const total = new Set(requestIds).size;
        let rejectedCount = 0;
        for (const chunk of chunkRequestIds(requestIds)) {
          try {
            const result = await recordNightRequestsService.rejectMany(stakeId, activityId, chunk, note);
            rejectedCount += result.rejectedCount;
          } catch (error) {
            if (rejectedCount === 0) throw error;
            throw Object.assign(
              new Error(
                `${getRecordNightErrorMessage(error)} Ne ho segnate ${rejectedCount} su ${total} come non collegabili: aggiorna l'elenco.`,
              ),
              { code: "functions/failed-precondition" },
            );
          }
        }
        return { rejectedCount };
      }),
    [activityId, run, stakeId],
  );

  const reopen = useCallback(
    (requestId: string) =>
      run<RecordNightRequestActionResult>(() =>
        recordNightRequestsService.reopen(stakeId, activityId, requestId),
      ),
    [activityId, run, stakeId],
  );

  const unlink = useCallback(
    (requestId: string) =>
      run<RecordNightRequestActionResult>(() =>
        recordNightRequestsService.unlink(stakeId, activityId, requestId),
      ),
    [activityId, run, stakeId],
  );

  const current = state?.key === key ? state : null;
  const queue = current?.queue ?? null;
  const requests = queue?.requests ?? EMPTY_QUEUE.requests;
  const sections = useMemo(() => splitStaffRequests(requests), [requests]);
  const status: RecordNightLoadStatus = !key
    ? "idle"
    : queue
      ? "ready"
      : current?.error
        ? "error"
        : "loading";
  return {
    status,
    // Con `status: "ready"` e un errore la rilettura non è riuscita: i dati possono essere vecchi.
    error: current?.error ?? null,
    requests,
    // open = "Da collegare"; notLinked = "Non collegate"; withdrawn = "Ritirate";
    // linked = già collegate.
    sections,
    openCount: queue?.openCount ?? 0,
    openLimit: queue?.openLimit ?? 0,
    busy,
    reload: load,
    link,
    reject,
    rejectMany,
    reopen,
    unlink,
  };
}
