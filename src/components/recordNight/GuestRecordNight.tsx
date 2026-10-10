import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { GuestGate } from "@/components/recordNight/GuestGate";
import { GuestOpenRecords } from "@/components/recordNight/GuestOpenRecords";
import { GuestRequests, getGuestRequestLabel } from "@/components/recordNight/GuestRequests";
import { GuestSheet } from "@/components/recordNight/GuestSheet";
import {
  RecordNightBoard,
  RecordNightHero,
  RecordNightRules,
} from "@/components/recordNight/RecordNightHero";
import { RecordNightIcon } from "@/components/recordNight/RecordNightIcon";
import {
  RecordNightGate,
  RecordNightLoading,
} from "@/components/recordNight/RecordNightStates";
import {
  RecordNightToast,
  type RecordNightToastState,
} from "@/components/recordNight/RecordNightToast";
import {
  useRecordNightGuestContext,
  useRecordNightGuestRequests,
} from "@/components/recordNight/hooks";
import type { RecordNightGuestRequest, RecordNightPublicRecord } from "@/types";
import {
  isGuestIntakeOpen,
  type RecordNightGuestRequestFields,
} from "@/utils/recordNightGuest";

type SheetState = { mode: "propose" } | { mode: "challenge"; record: RecordNightPublicRecord } | null;

interface RecordNightGuestViewProps {
  stakeId: string;
  eventId: string;
  eventTitle: string;
  // "venerdì 16 ottobre" e "venerdì", dall'inizio dell'attività.
  dayLabel: string;
  weekday: string;
  closeAt: Date | null;
  now: Date;
  // Chiusura letta dall'attività sul telefono (il server ha l'ultima parola).
  clientClosed: boolean;
  // Sessione anonima del telefono (false = nessuna sessione).
  isAnonymous: boolean;
  loginPath: string;
  backPath: string;
}

// Pagina dei record per chi non ha un account vero (nessuna sessione, oppure la
// sessione anonima del telefono). Ordine: intestazione, "Hai un account? Accedi"
// sempre per prima, "Le tue richieste da questo telefono" se ce ne sono,
// tabellone, regole, elenco in sola lettura (docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md).
// La sessione anonima non si crea alla visita: la apre solo l'invio di una richiesta.
export function RecordNightGuestView({
  stakeId,
  eventId,
  eventTitle,
  dayLabel,
  weekday,
  closeAt,
  now,
  clientClosed,
  isAnonymous,
  loginPath,
  backPath,
}: RecordNightGuestViewProps) {
  const {
    context,
    status: contextStatus,
    error: contextError,
    reload: reloadContext,
  } = useRecordNightGuestContext(stakeId, eventId);
  const guest = useRecordNightGuestRequests(stakeId, eventId);

  // Dopo il primo invio la sessione anonima nasce a metà dell'azione: la rilettura
  // che il hook fa da sé usa ancora la chiave di prima. Si rilegge con l'ultima
  // `reload`, letta da qui.
  const reloadGuestRef = useRef(guest.reload);
  useEffect(() => {
    reloadGuestRef.current = guest.reload;
  });

  const [sheet, setSheet] = useState<SheetState>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [toast, setToast] = useState<RecordNightToastState | null>(null);
  const toastIdRef = useRef(0);
  const [announcement, setAnnouncement] = useState("");
  const [scrollToRequests, setScrollToRequests] = useState(false);
  const requestsHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const dismissToast = useCallback(() => setToast(null), []);

  function showToast(next: Omit<RecordNightToastState, "id">) {
    toastIdRef.current += 1;
    setToast({ ...next, id: toastIdRef.current });
  }

  const recordsById = useMemo(
    () => new Map((context?.records ?? []).map((record) => [record.id, record] as const)),
    [context],
  );

  // Il server ha l'ultima parola: `context.open` è la finestra, `intakeOpen` anche
  // l'interruttore "Record senza account".
  const serverIntake = context?.intakeOpen === true;
  const closed =
    clientClosed || context?.open === false || (serverIntake && !isGuestIntakeOpen(context, now));
  const intakeOpen = !closed && serverIntake;
  // Finestra aperta con l'interruttore spento: resta il gate di oggi, senza elenco.
  const switchOff = Boolean(context) && !closed && !serverIntake;
  const phoneMode = guest.mode === "phone";

  // Dopo l'invio: scroll alla sezione "Le tue richieste da questo telefono" e
  // focus sul suo titolo, appena la rilettura l'ha portata in pagina.
  useEffect(() => {
    if (!scrollToRequests || sheet) return;
    const heading = requestsHeadingRef.current;
    if (!heading) {
      // Rilettura finita senza la sezione: niente scroll in ritardo più tardi.
      if (guest.status !== "loading") setScrollToRequests(false);
      return;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    heading.focus({ preventScroll: true });
    setScrollToRequests(false);
  }, [guest.requests, guest.status, scrollToRequests, sheet]);

  function openSheet(next: Exclude<SheetState, null>, trigger: HTMLElement) {
    openerRef.current = trigger;
    // Un foglio nuovo = una richiesta nuova (un solo token per foglio).
    guest.startRequest();
    setSheet(next);
  }

  async function handleSubmit(fields: RecordNightGuestRequestFields) {
    const outcome = await guest.submit(fields);
    if (outcome.ok) {
      await reloadGuestRef.current();
      setSheet(null);
      showToast({ kind: "undo", message: "Richiesta inviata." });
      setScrollToRequests(true);
    } else if (
      outcome.kind === "closed" ||
      outcome.kind === "disabled" ||
      outcome.kind === "record_gone"
    ) {
      // Finestra chiusa, modulo spento o record tolto: l'elenco sotto va aggiornato.
      void reloadContext();
    }
    return outcome;
  }

  async function handleWithdraw(request: RecordNightGuestRequest) {
    const label = getGuestRequestLabel(request);
    const outcome = await guest.withdraw(request.requestId);
    if (!outcome.ok) {
      showToast({ kind: "error", message: outcome.message });
      return;
    }
    showToast({ kind: "undo", message: `Ritiro fatto: ${label}`, entryId: request.requestId });
  }

  // "Annulla" nell'avviso e "Ripristina" nella riga "Ritirate": stessa azione.
  async function handleRestore(requestId: string) {
    const request = guest.requests.find((item) => item.requestId === requestId);
    const label = request ? getGuestRequestLabel(request) : "";
    const outcome = await guest.restore(requestId);
    if (!outcome.ok) {
      showToast({ kind: "error", message: outcome.message });
      return;
    }
    setToast(null);
    setAnnouncement(label ? `Ripristino fatto: ${label}` : "Ripristino fatto.");
  }

  const board = <RecordNightBoard closeAt={closeAt} closed={closed} now={now} weekday={weekday} />;

  // Il gate di oggi: l'elenco si vede solo con l'account.
  const accountGate = (
    <RecordNightGate
      action={
        <Link className="rn-btn rn-btn--led" to={loginPath}>
          <RecordNightIcon name="user" />
          Accedi
        </Link>
      }
      icon="lock"
      text={
        isAnonymous
          ? "Accedi con il tuo account per vedere i record."
          : "Dopo l'accesso torni a questa pagina."
      }
      title="Accedi per vedere i record"
    />
  );

  const phoneNotice =
    phoneMode && guest.error ? (
      <div className="rn-notice rn-notice--error" role="alert">
        <RecordNightIcon name="alert" />
        <span>{guest.error}</span>
        <button
          className="rn-btn rn-btn--sm"
          disabled={guest.busy}
          onClick={() => void guest.reload()}
          type="button"
        >
          Riprova
        </button>
      </div>
    ) : null;

  const requestsSection = phoneMode ? (
    <GuestRequests
      busy={guest.busy}
      closed={closed}
      headingRef={requestsHeadingRef}
      onRestore={(request) => void handleRestore(request.requestId)}
      onWithdraw={(request) => void handleWithdraw(request)}
      recordsById={recordsById}
      requests={guest.requests}
    />
  ) : null;

  const records = context?.records ?? [];

  return (
    <div className="rn">
      <RecordNightHero dayLabel={dayLabel} eventTitle={eventTitle} weekday={weekday} />

      {!context && contextStatus === "error" ? (
        <>
          {board}
          {accountGate}
          <div className="rn-notice rn-notice--error" role="alert">
            <RecordNightIcon name="alert" />
            <span>{contextError}</span>
            <button className="rn-btn rn-btn--sm" onClick={() => void reloadContext()} type="button">
              Riprova
            </button>
          </div>
          <RecordNightRules />
        </>
      ) : !context ? (
        <>
          {board}
          <RecordNightLoading label="Sto caricando i record..." />
        </>
      ) : switchOff ? (
        <>
          {board}
          {accountGate}
          {phoneNotice}
          {requestsSection}
          <RecordNightRules />
        </>
      ) : (
        <>
          <GuestGate
            busy={guest.busy}
            canSignUp={intakeOpen}
            loginPath={loginPath}
            onSignUp={(trigger) => openSheet({ mode: "propose" }, trigger)}
          />
          {phoneNotice}
          {requestsSection}
          {board}
          <RecordNightRules />
          {!closed || records.length > 0 ? (
            <GuestOpenRecords
              busy={guest.busy}
              canAct={intakeOpen}
              onChallenge={(record, trigger) => openSheet({ mode: "challenge", record }, trigger)}
              records={records}
            />
          ) : null}
        </>
      )}

      <p className="rn-back">
        <Link className="rn-link" to={backPath}>
          <RecordNightIcon name="back" />
          Torna all'attività
        </Link>
      </p>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <RecordNightToast
        busy={guest.busy}
        onDismiss={dismissToast}
        onUndo={(requestId) => void handleRestore(requestId)}
        toast={toast}
      />

      {sheet && context ? (
        <GuestSheet
          loginPath={loginPath}
          mode={sheet.mode}
          onClose={() => setSheet(null)}
          onSubmit={handleSubmit}
          opener={openerRef.current}
          record={sheet.mode === "challenge" ? sheet.record : null}
          records={context.records}
          units={context.units}
        />
      ) : null}
    </div>
  );
}
