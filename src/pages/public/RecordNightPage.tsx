import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";

import "@/styles/recordNight.css";

import { MyRecords, getEntryLabel, getJoinedLabel } from "@/components/recordNight/MyRecords";
import { OpenRecords } from "@/components/recordNight/OpenRecords";
import { PersonPicker } from "@/components/recordNight/PersonPicker";
import { ProposalSheet } from "@/components/recordNight/ProposalSheet";
import {
  RecordNightBoard,
  RecordNightHero,
  RecordNightRules,
} from "@/components/recordNight/RecordNightHero";
import { RecordNightIcon } from "@/components/recordNight/RecordNightIcon";
import {
  RecordNightGate,
  RecordNightLoading,
  RecordNightState,
} from "@/components/recordNight/RecordNightStates";
import {
  RecordNightToast,
  type RecordNightToastState,
} from "@/components/recordNight/RecordNightToast";
import { useMinuteClock, useRecordNightSkin } from "@/components/recordNight/hooks";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { eventsService } from "@/services/firestore/eventsService";
import {
  getRecordNightErrorMessage,
  recordNightService,
  type RecordNightContext,
  type RecordNightPerson,
  type RecordNightProposalInput,
} from "@/services/firestore/recordNightService";
import type { Event, RecordNightEntry, RecordNightRecord } from "@/types";
import {
  getActivityPath,
  getActivityRegistrationPath,
  getMyActivityPath,
} from "@/utils/activityLinks";
import {
  RECORD_NIGHT_MAX_ENTRIES,
  countActiveEntries,
  formatRecordNightDay,
  formatRecordNightWeekday,
  getRecordNightCloseAt,
  getRecordNightWindow,
  isPermissionDenied,
  isRecordVisibleToParticipants,
} from "@/utils/recordNight";
import { resolvePublicStakeId } from "@/utils/stakeSelection";

interface BaseData {
  // false finché non c'è stata una lettura vera (anche durante l'avvio
  // dell'autenticazione): evita di mostrare "Attività non trovata" per un attimo.
  loaded: boolean;
  stakeId: string;
  event: Event | null;
}

const initialBase: BaseData = { loaded: false, stakeId: "", event: null };

interface RecordsState {
  key: string;
  records: RecordNightRecord[];
  entries: RecordNightEntry[];
  // Dal server: per chi l'account può agire (la propria iscrizione `user_` e i
  // figli `child_` attivi) e se gestisce i record.
  context: RecordNightContext | null;
  // Elenco e tentativi non letti: la sezione record non si mostra.
  error: string | null;
  // Solo il contesto non letto: l'elenco si mostra lo stesso, senza azioni.
  contextError: string | null;
  // Elenco letto almeno una volta: senza, la sezione record non si mostra.
  listsLoaded: boolean;
}

type SheetState = { mode: "propose" } | { mode: "edit"; entry: RecordNightEntry } | null;

function readStoredPerson(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storePerson(key: string, registrationId: string) {
  try {
    window.sessionStorage.setItem(key, registrationId);
  } catch {
    // sessionStorage non disponibile: la scelta vale finché la pagina resta aperta.
  }
}

// Pagina partecipante della Notte dei Record (docs/NOTTE_DEI_RECORD.md), link
// da condividere su WhatsApp. Route pubblica: gli stati di accesso (senza
// login, ospite, senza iscrizione, iscritto, genitore, staff, chiuso) li
// gestisce la pagina.
export function RecordNightPage() {
  useRecordNightSkin();
  const { eventId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { session, loading: authLoading } = useAuth();
  const now = useMinuteClock();
  const requestedStakeId = searchParams.get("stake") ?? "";
  const uid =
    session?.isAuthenticated && !session.isAnonymous ? session.firebaseUser.uid : null;
  const sessionKey = session ? `${session.firebaseUser.uid}:${session.isAnonymous}` : "public";

  const base = useAsyncData<BaseData>(
    async () => {
      if (!eventId || authLoading) return initialBase;
      const stakeId = await resolvePublicStakeId(requestedStakeId || session?.profile.stakeId);
      // Da loggati prima la lettura autenticata: un'attività non pubblica la
      // vede chi ne ha diritto. Poi quella pubblica. Un'attività che non esiste
      // (o non si può leggere) risponde permission-denied: "Attività non
      // trovata", non un errore di rete.
      let event: Event | null = null;
      if (uid) {
        event = await eventsService.getEventById(stakeId, eventId).catch(() => null);
      }
      if (!event) {
        event = await eventsService.getPublicEventById(stakeId, eventId).catch((error) => {
          if (isPermissionDenied(error)) return null;
          throw error;
        });
      }
      return { loaded: true, stakeId, event };
    },
    [eventId, requestedStakeId, sessionKey, authLoading],
    initialBase,
  );

  const { stakeId, event } = base.data;
  const enabled = event?.recordsEnabled === true;
  const recordsKey = enabled && uid && stakeId ? `${stakeId}/${eventId}/${uid}` : "";

  // Record, tentativi (propri e dei figli) e contesto: letture server-first,
  // rifatte dopo ogni azione.
  const [recordsState, setRecordsState] = useState<RecordsState | null>(null);
  const requestRef = useRef(0);

  const loadRecords = useCallback(async () => {
    if (!recordsKey || !uid) return;
    const request = ++requestRef.current;
    // Il contesto (per chi si agisce) è una callable a parte: se non risponde,
    // l'elenco dei record si mostra lo stesso.
    const [lists, contextResult] = await Promise.allSettled([
      Promise.all([
        recordNightService.listRecords(stakeId, eventId),
        recordNightService.listOwnEntries(stakeId, eventId, uid),
      ]),
      recordNightService.getContext(stakeId, eventId),
    ]);
    if (request !== requestRef.current) return;
    if (lists.status === "rejected") {
      console.error("Notte dei Record: lettura non riuscita.", lists.reason);
    }
    if (contextResult.status === "rejected") {
      console.error("Notte dei Record: contesto non disponibile.", contextResult.reason);
    }
    setRecordsState((current) => {
      const previous = current?.key === recordsKey ? current : null;
      return {
        key: recordsKey,
        records: lists.status === "fulfilled" ? lists.value[0] : (previous?.records ?? []),
        entries: lists.status === "fulfilled" ? lists.value[1] : (previous?.entries ?? []),
        context:
          contextResult.status === "fulfilled" ? contextResult.value : (previous?.context ?? null),
        error:
          lists.status === "rejected"
            ? "Non riesco a caricare i record. Controlla la connessione e riprova."
            : null,
        contextError:
          contextResult.status === "rejected"
            ? "Non riesco a caricare le tue iscrizioni. Riprova."
            : null,
        listsLoaded: lists.status === "fulfilled" || previous?.listsLoaded === true,
      };
    });
  }, [eventId, recordsKey, stakeId, uid]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const current = recordsState?.key === recordsKey ? recordsState : null;
  const context = current?.context ?? null;
  const records = useMemo(() => current?.records ?? [], [current]);
  const recordsById = useMemo(
    () => new Map(records.map((record) => [record.id, record] as const)),
    [records],
  );
  const visibleRecords = useMemo(() => records.filter(isRecordVisibleToParticipants), [records]);
  const people = useMemo<RecordNightPerson[]>(() => context?.people ?? [], [context]);
  const isStaff = context?.isStaff === true;

  // "Per chi?": la scelta resta per la sessione del browser.
  const personStorageKey = recordsKey ? `gugd-record-night-person:${stakeId}/${eventId}` : "";
  const [chosenId, setChosenId] = useState<string | null>(null);
  useEffect(() => {
    setChosenId(personStorageKey ? readStoredPerson(personStorageKey) : null);
  }, [personStorageKey]);
  const person =
    people.find((item) => item.registrationId === chosenId) ??
    people.find((item) => item.isSelf) ??
    people[0] ??
    null;
  const personName = person && !person.isSelf ? person.displayName : null;

  function choosePerson(registrationId: string) {
    setChosenId(registrationId);
    if (personStorageKey) storePerson(personStorageKey, registrationId);
  }

  // Tentativi della persona scelta: limite, "Ci sei" e azioni sono suoi.
  const personEntries = useMemo(
    () =>
      person
        ? (current?.entries ?? []).filter((entry) => entry.registrationId === person.registrationId)
        : [],
    [current, person],
  );
  const joinedRecordIds = useMemo(
    () =>
      new Set(
        personEntries
          .filter((entry) => entry.status === "approved" && entry.recordId)
          .map((entry) => entry.recordId as string),
      ),
    [personEntries],
  );

  const recordWindow = event ? getRecordNightWindow(event, now) : "disabled";
  const closed = recordWindow === "closed";
  const closeAt = event ? getRecordNightCloseAt(event) : null;
  const canAct = Boolean(person) && recordWindow === "open";
  const activeCount = countActiveEntries(personEntries);
  const atLimit = activeCount >= RECORD_NIGHT_MAX_ENTRIES;

  // Staff: numero di proposte in attesa per il tasto "Gestisci". Se la lettura
  // non riesce il tasto resta, senza numero.
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  useEffect(() => {
    if (!isStaff || !recordsKey) {
      setPendingCount(null);
      return;
    }
    let active = true;
    recordNightService
      .listAllEntries(stakeId, eventId)
      .then((all) => {
        if (active) setPendingCount(all.filter((entry) => entry.status === "pending").length);
      })
      .catch((error: unknown) => {
        console.warn("Notte dei Record: proposte in attesa non disponibili.", error);
        if (active) setPendingCount(null);
      });
    return () => {
      active = false;
    };
  }, [eventId, isStaff, recordsKey, stakeId]);

  // Azioni: un'azione per volta (niente doppio tocco), poi rilettura dal server.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [toast, setToast] = useState<RecordNightToastState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [sheet, setSheet] = useState<SheetState>(null);
  const toastIdRef = useRef(0);

  const dismissToast = useCallback(() => setToast(null), []);

  function showToast(next: Omit<RecordNightToastState, "id">) {
    toastIdRef.current += 1;
    setToast({ ...next, id: toastIdRef.current });
  }

  async function runAction(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showToast({ kind: "error", message: getRecordNightErrorMessage(error) });
      await loadRecords();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleChallenge(record: RecordNightRecord) {
    if (!person) return;
    const { registrationId } = person;
    void runAction(async () => {
      await recordNightService.challenge(stakeId, eventId, record.id, registrationId);
      await loadRecords();
      setAnnouncement(`${getJoinedLabel(personName)}: ${record.title}`);
    });
  }

  function handleWithdraw(entry: RecordNightEntry) {
    const label = getEntryLabel(entry, recordsById);
    void runAction(async () => {
      await recordNightService.withdraw(stakeId, eventId, entry.id);
      await loadRecords();
      showToast({ kind: "undo", message: `Ritiro fatto: ${label}`, entryId: entry.id });
    });
  }

  function handleRestore(entryId: string) {
    const entry = current?.entries.find((item) => item.id === entryId);
    const label = entry ? getEntryLabel(entry, recordsById) : "";
    void runAction(async () => {
      await recordNightService.restore(stakeId, eventId, entryId);
      setToast(null);
      await loadRecords();
      setAnnouncement(label ? `Ripristino fatto: ${label}` : "Ripristino fatto.");
    });
  }

  // Dal foglio: gli errori tornano al foglio, che li mostra e resta aperto.
  async function submitProposal(input: RecordNightProposalInput) {
    if (busyRef.current || !person) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (sheet?.mode === "edit") {
        await recordNightService.edit(stakeId, eventId, sheet.entry.id, input);
      } else {
        await recordNightService.propose(stakeId, eventId, {
          ...input,
          registrationId: person.registrationId,
        });
      }
      await loadRecords();
      setAnnouncement(sheet?.mode === "edit" ? "Proposta salvata." : "Proposta inviata.");
      setSheet(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function challengeFromSheet(record: RecordNightRecord) {
    if (busyRef.current || !person) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await recordNightService.challenge(stakeId, eventId, record.id, person.registrationId);
      await loadRecords();
      setAnnouncement(`${getJoinedLabel(personName)}: ${record.title}`);
      setSheet(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Il foglio non si chiude da solo all'ora di chiusura: perderebbe il testo.
  // Resta aperto e all'invio mostra l'errore del server.

  const loginPath = `/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
  const dayLabel = formatRecordNightDay(event?.startDate);
  const weekday = formatRecordNightWeekday(event?.startDate);
  const loadingBase = authLoading || base.loading;

  if (!base.error && (!base.data.loaded || (loadingBase && !event))) {
    return (
      <div className="rn">
        <RecordNightLoading label="Sto caricando i record..." />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="rn">
        <RecordNightState
          action={
            base.error ? (
              <button className="rn-btn rn-btn--led" onClick={base.reload} type="button">
                Riprova
              </button>
            ) : (
              <Link className="rn-btn rn-btn--led" to="/activities">
                Torna alle attività
              </Link>
            )
          }
          text={
            base.error
              ? "Non riesco a caricare la pagina. Controlla la connessione e riprova."
              : "L'attività richiesta non è pubblica oppure non esiste."
          }
          title={base.error ? "Caricamento non riuscito" : "Attività non trovata"}
        />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="rn">
        <RecordNightState
          action={
            <Link className="rn-btn rn-btn--led" to={getActivityPath(event.id, stakeId)}>
              Vai all'attività
              <RecordNightIcon name="arrow" />
            </Link>
          }
          text="Per questa attività la Notte dei Record non è attiva."
          title="Non è in programma"
        />
      </div>
    );
  }

  const recordsLoading = Boolean(uid) && !current;
  const activityNoun = event.activityType === "trip" ? "al viaggio" : "all'attività";
  const registrationPath = getActivityRegistrationPath(event.id, stakeId);
  const managePath = `/activities/${event.id}/record/gestisci${stakeId ? `?stake=${encodeURIComponent(stakeId)}` : ""}`;
  const hasSelf = people.some((item) => item.isSelf);

  function renderJoinInvite() {
    // Nessuna persona per cui agire. Dopo la chiusura non serve; lo staff
    // senza iscrizioni ha "Gestisci le proposte" al posto dell'invito.
    if (closed || isStaff || !event) return null;
    if (session?.isParent) {
      return (
        <RecordNightGate
          action={
            <Link className="rn-btn rn-btn--led" to={registrationPath}>
              <RecordNightIcon name="ticket" />
              Vai all'iscrizione
            </Link>
          }
          icon="ticket"
          text="Intanto puoi guardare quelli già in gara."
          title={`Iscrivi i tuoi figli ${activityNoun} per proporre o sfidare un record`}
        />
      );
    }
    return (
      <RecordNightGate
        action={
          <Link className="rn-btn rn-btn--led" to={registrationPath}>
            <RecordNightIcon name="ticket" />
            Vai all'iscrizione
          </Link>
        }
        icon="ticket"
        text="Se un genitore ha già fatto la tua iscrizione, non ne serve un'altra: chiedi al genitore o a un dirigente di inserirti."
        title={`Iscriviti ${activityNoun} per proporre o sfidare un record`}
      />
    );
  }

  return (
    <div className="rn">
      <RecordNightHero dayLabel={dayLabel} eventTitle={event.title} weekday={weekday} />
      <RecordNightBoard closeAt={closeAt} closed={closed} now={now} weekday={weekday} />

      {isStaff ? (
        <Link className="rn-manage" to={managePath}>
          <RecordNightIcon name="list" />
          <span className="rn-manage__text">
            <span className="rn-manage__label">Gestisci le proposte</span>
            {pendingCount ? (
              <span className="rn-manage__count">
                <i aria-hidden="true" className="rn-led" />
                {pendingCount === 1 ? "1 in attesa" : `${pendingCount} in attesa`}
              </span>
            ) : null}
          </span>
          <RecordNightIcon name="arrow" />
        </Link>
      ) : null}

      {!uid ? (
        <RecordNightGate
          action={
            <Link className="rn-btn rn-btn--led" to={loginPath}>
              <RecordNightIcon name="user" />
              Accedi
            </Link>
          }
          icon="lock"
          text={
            session?.isAnonymous
              ? "Accedi con il tuo account per vedere i record."
              : "Dopo l'accesso torni a questa pagina."
          }
          title="Accedi per vedere i record"
        />
      ) : null}

      <RecordNightRules />

      {uid && current?.error ? (
        <div className="rn-notice rn-notice--error" role="alert">
          <RecordNightIcon name="alert" />
          <span>{current.error}</span>
          <button className="rn-btn rn-btn--sm" onClick={() => void loadRecords()} type="button">
            Riprova
          </button>
        </div>
      ) : null}

      {uid && current && !current.error && current.contextError ? (
        <div className="rn-notice rn-notice--error" role="alert">
          <RecordNightIcon name="alert" />
          <span>{current.contextError}</span>
          <button
            className="rn-btn rn-btn--sm"
            disabled={busy}
            onClick={() => void loadRecords()}
            type="button"
          >
            Riprova
          </button>
        </div>
      ) : null}

      {uid && recordsLoading ? <RecordNightLoading label="Sto caricando i record..." /> : null}

      {uid && current?.listsLoaded ? (
        <>
          {person ? (
            <MyRecords
              activeCount={activeCount}
              busy={busy}
              canAct={canAct}
              closed={closed}
              entries={personEntries}
              onEdit={(entry) => setSheet({ mode: "edit", entry })}
              onPropose={() => setSheet({ mode: "propose" })}
              onRestore={(entry) => handleRestore(entry.id)}
              onWithdraw={handleWithdraw}
              personName={personName}
              picker={
                people.length > 1 ? (
                  <PersonPicker
                    disabled={busy}
                    onSelect={choosePerson}
                    people={people}
                    selectedId={person.registrationId}
                  />
                ) : null
              }
              recordsById={recordsById}
            />
          ) : context ? (
            renderJoinInvite()
          ) : null}

          <OpenRecords
            atLimit={atLimit}
            busy={busy}
            canAct={canAct}
            closed={closed}
            joinedRecordIds={joinedRecordIds}
            onChallenge={handleChallenge}
            personName={personName}
            records={visibleRecords}
          />
        </>
      ) : null}

      <p className="rn-back">
        <Link
          className="rn-link"
          to={hasSelf ? getMyActivityPath(event.id) : getActivityPath(event.id, stakeId)}
        >
          <RecordNightIcon name="back" />
          Torna all'attività
        </Link>
      </p>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <RecordNightToast
        busy={busy}
        onDismiss={dismissToast}
        onUndo={handleRestore}
        toast={toast}
      />

      {sheet && person ? (
        <ProposalSheet
          entry={sheet.mode === "edit" ? sheet.entry : null}
          getErrorMessage={getRecordNightErrorMessage}
          joinedRecordIds={joinedRecordIds}
          onChallenge={challengeFromSheet}
          onClose={() => setSheet(null)}
          onSubmit={submitProposal}
          personName={personName}
          records={visibleRecords}
          slotNumber={Math.min(activeCount + 1, RECORD_NIGHT_MAX_ENTRIES)}
        />
      ) : null}
    </div>
  );
}
