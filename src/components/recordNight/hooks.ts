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
  RecordNightGuestMine,
  RecordNightGuestRequest,
} from "@/types";
import {
  RecordNightGuestClientError,
  chunkRequestIds,
  classifyGuestError,
  createActionRunner,
  createGuestSubmissionKeeper,
  createLatestLoader,
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
//
// L'ordine delle letture e la rilettura dopo l'azione stanno in due helper puri
// (createLatestLoader, createActionRunner di utils/recordNightGuest.ts, provati in
// tests/recordNightGuest.test.mjs). La rilettura usa SEMPRE il `load` più recente
// (un ref aggiornato a ogni render): le azioni si creano al clic, ma durante
// l'azione la pagina può cambiare (al primo invio nasce la sessione anonima e con
// lei la chiave di `mine`).

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
  const [loader] = useState(() => createLatestLoader<RecordNightGuestContext>());

  const load = useCallback(async () => {
    if (!key) return;
    const read = await loader.run(() => recordNightGuestService.getContext(stakeId, activityId));
    if (read.superseded) return;
    if (read.ok) {
      setState({ key, context: read.value, error: null });
      return;
    }
    console.error("Notte dei Record: contesto pubblico non disponibile.", read.error);
    setState((current) => ({
      key,
      context: current?.key === key ? current.context : null,
      error: getRecordNightGuestErrorMessage(read.error, "load"),
    }));
  }, [activityId, key, loader, stakeId]);

  useEffect(() => {
    void load();
    // Una risposta in volo di una chiave vecchia (o dopo lo smontaggio) non conta.
    return () => loader.invalidate();
  }, [load, loader]);

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
  const [busy, setBusy] = useState(false);
  const [loader] = useState(() => createLatestLoader<RecordNightGuestMine>());
  // Un token per foglio: vedi createGuestSubmissionKeeper.
  const [keeper] = useState(() => createGuestSubmissionKeeper());
  // L'AuthProvider cambia funzione a ogni render: si usa sempre l'ultima.
  const signInRef = useRef(signInAnonymously);
  useEffect(() => {
    signInRef.current = signInAnonymously;
  });

  // true se la lettura è riuscita (o non c'era nulla da leggere o è stata superata
  // da una più recente).
  const load = useCallback(async () => {
    if (!key) return true;
    const read = await loader.run(() => recordNightGuestService.mine(stakeId, activityId));
    if (read.superseded) return true;
    if (read.ok) {
      setState({
        key,
        open: read.value.open,
        closeAt: read.value.closeAt,
        requests: read.value.requests,
        loaded: true,
        error: null,
      });
      return true;
    }
    console.error("Notte dei Record: richieste del telefono non disponibili.", read.error);
    setState((current) => {
      const previous = current?.key === key ? current : null;
      return {
        key,
        open: previous?.open ?? false,
        closeAt: previous?.closeAt ?? null,
        requests: previous?.requests ?? [],
        loaded: previous?.loaded === true,
        error: getRecordNightGuestErrorMessage(read.error, "load"),
      };
    });
    return false;
  }, [activityId, key, loader, stakeId]);

  // Il `load` più recente, aggiornato nello stesso commit che cambia la chiave e
  // prima dell'effetto che legge: la rilettura dopo un'azione non usa mai quello
  // del momento del clic.
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void load();
    return () => loader.invalidate();
  }, [load, loader]);

  // Un comando per volta. Dopo l'azione rilegge `mine`; dopo un errore del
  // server o della rete rilegge lo stesso: una risposta persa può aver creato la
  // richiesta, una richiesta può essere stata collegata nel frattempo.
  const [runner] = useState(() =>
    createActionRunner({
      getReload: () => loadRef.current,
      setBusy,
      reloadOnError: (error) => !(error instanceof RecordNightGuestClientError),
    }),
  );

  const run = useCallback(
    async <T,>(
      action: RecordNightGuestAction,
      task: () => Promise<T>,
    ): Promise<GuestActionOutcome<T>> => {
      const result = await runner.run(task);
      if (result.status === "busy") {
        return { ok: false, kind: "busy", message: BUSY_MESSAGE, fieldErrors: {} };
      }
      if (result.status === "failed") {
        return {
          ok: false,
          kind: classifyGuestError(result.error),
          message: getRecordNightGuestErrorMessage(result.error, action),
          fieldErrors: result.error instanceof RecordNightGuestClientError ? result.error.fieldErrors : {},
        };
      }
      return { ok: true, value: result.value, stale: result.stale };
    },
    [runner],
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
  const [busy, setBusy] = useState(false);
  const [loader] = useState(() => createLatestLoader<RecordNightRequestQueue>());

  // true se la lettura è riuscita (o non c'era nulla da leggere o è stata superata
  // da una più recente).
  const load = useCallback(async () => {
    if (!key) return true;
    const read = await loader.run(() => recordNightRequestsService.list(stakeId, activityId));
    if (read.superseded) return true;
    if (read.ok) {
      setState({ key, queue: read.value, error: null });
      return true;
    }
    console.error("Notte dei Record: coda delle richieste non disponibile.", read.error);
    setState((current) => ({
      key,
      queue: current?.key === key ? current.queue : null,
      error: "Non riesco a caricare le richieste. Controlla la connessione e riprova.",
    }));
    return false;
  }, [activityId, key, loader, stakeId]);

  // Il `load` più recente: la rilettura dopo un'azione non usa quello del clic.
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void load();
    return () => loader.invalidate();
  }, [load, loader]);

  // La richiesta può essere cambiata sotto i piedi (collegata, ritirata): dopo
  // un errore si rilegge sempre.
  const [runner] = useState(() => createActionRunner({ getReload: () => loadRef.current, setBusy }));

  const run = useCallback(
    async <T,>(task: () => Promise<T>): Promise<StaffActionOutcome<T>> => {
      const result = await runner.run(task);
      if (result.status === "busy") return { ok: false, message: BUSY_MESSAGE };
      if (result.status === "failed") return { ok: false, message: getRecordNightErrorMessage(result.error) };
      return { ok: true, value: result.value, stale: result.stale };
    },
    [runner],
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

  // Rifiuto in blocco, a gruppi da 50. Le richieste non più in coda (collegate o
  // ritirate nel frattempo) si saltano senza errore e si contano in `skippedCount`
  // (descrivi l'esito con describeBulkRejectResult). Se un gruppo fallisce i
  // precedenti restano rifiutati e il messaggio dice quanti.
  const rejectMany = useCallback(
    (requestIds: string[], note?: string) =>
      run<{ rejectedCount: number; skippedCount: number }>(async () => {
        const total = new Set(requestIds).size;
        let rejectedCount = 0;
        let skippedCount = 0;
        for (const chunk of chunkRequestIds(requestIds)) {
          try {
            const result = await recordNightRequestsService.rejectMany(stakeId, activityId, chunk, note);
            rejectedCount += result.rejectedCount;
            skippedCount += result.skippedCount;
          } catch (error) {
            if (rejectedCount === 0 && skippedCount === 0) throw error;
            throw Object.assign(
              new Error(
                `${getRecordNightErrorMessage(error)} Ne ho segnate ${rejectedCount} su ${total} come non collegabili: aggiorna l'elenco.`,
              ),
              { code: "functions/failed-precondition" },
            );
          }
        }
        return { rejectedCount, skippedCount };
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
    // open = "Da collegare"; notLinked = "Non collegate" (si riaprono); withdrawn =
    // "Richieste ritirate" dal telefono (si riaprono); linked = collegate (dividile
    // per stato con groupLinkedRequests).
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
