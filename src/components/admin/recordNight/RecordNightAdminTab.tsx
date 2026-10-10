import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import {
  getRecordNightErrorMessage,
  recordNightService,
  type RecordNightParticipantOption,
  type RecordNightRecordInput,
} from "@/services/firestore/recordNightService";
import type { Event, RecordNightEntry, RecordNightRecord } from "@/types";
import {
  formatRecordNightDeadline,
  getRecordNightCloseAt,
  getRecordNightWindow,
} from "@/utils/recordNight";

import "@/styles/recordNightAdmin.css";

import { ClosedSection, HiddenList, RejectedList, WithdrawnList } from "./ClosedSections";
import { EMPTY_RECORD_EFFECT, HIDE_RECORD_EFFECT, SHOW_RECORD_EFFECT } from "./copy";
import { isWithdrawnWithRecord } from "./helpers";
import { OpenRecordRow, type RecordRowPanel } from "./OpenRecordRow";
import { ProposalCard } from "./ProposalCard";
import { StaffSection } from "./StaffSection";
import { RecordForm } from "./RecordForm";
import type { RnaContext, RnaFreshData, RnaParticipants, RnaRunResult } from "./types";

interface RecordNightAdminTabProps {
  event: Event;
  stakeId: string;
  // Nella pagina di gestione il titolo sta già nell'intestazione della pagina.
  hideTitle?: boolean;
  // Solo gli admin del palo scelgono chi altro gestisce le proposte.
  canManageStaff?: boolean;
}

interface Flash {
  id: number;
  text: string;
}

const byMostEntries = (left: RecordNightRecord, right: RecordNightRecord) =>
  right.challengerCount - left.challengerCount || left.title.localeCompare(right.title, "it-IT");

const byMostRecentUpdate = (left: RecordNightEntry, right: RecordNightEntry) =>
  (right.decidedAt ?? right.updatedAt).localeCompare(left.decidedAt ?? left.updatedAt);

// Scheda "Record" del dettaglio attività (solo con `recordsEnabled`) e pagina
// di gestione per chi organizza la serata: proposte da approvare, record aperti
// con i loro iscritti, e le sezioni per tornare indietro. Dati sempre dal
// server, ricaricati dopo ogni azione.
export function RecordNightAdminTab({
  event,
  stakeId,
  hideTitle = false,
  canManageStaff = false,
}: RecordNightAdminTabProps) {
  const activityId = event.id;
  const [records, setRecords] = useState<RecordNightRecord[]>([]);
  const [entries, setEntries] = useState<RecordNightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [participantList, setParticipantList] = useState<RecordNightParticipantOption[]>([]);
  const [participantStatus, setParticipantStatus] = useState<RnaParticipants["status"]>("loading");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [panel, setPanel] = useState<{ recordId: string; mode: RecordRowPanel } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const requestSeq = useRef(0);
  const flashSeq = useRef(0);
  const newButton = useRef<HTMLButtonElement>(null);
  const baseId = useId();

  const load = useCallback(async (): Promise<RnaFreshData> => {
    const seq = (requestSeq.current += 1);
    const [nextRecords, nextEntries] = await Promise.all([
      recordNightService.listAllRecords(stakeId, activityId),
      recordNightService.listAllEntries(stakeId, activityId),
    ]);
    // Una risposta vecchia non deve coprire una più recente.
    if (seq === requestSeq.current) {
      setRecords(nextRecords);
      setEntries(nextEntries);
    }
    return { records: nextRecords, entries: nextEntries };
  }, [stakeId, activityId]);

  // Le persone da iscrivere: le dà il server, e un errore qui non deve fermare
  // il resto della scheda.
  const loadParticipants = useCallback(async () => {
    setParticipantStatus("loading");
    try {
      setParticipantList(await recordNightService.listParticipants(stakeId, activityId));
      setParticipantStatus("ready");
    } catch {
      setParticipantStatus("error");
    }
  }, [stakeId, activityId]);

  useEffect(() => {
    void loadParticipants();
  }, [loadParticipants]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setStaleNotice(null);
    try {
      await load();
    } catch {
      setLoadError("Non riesco a caricare i record. Controlla la connessione e riprova.");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!flash) return undefined;
    const timer = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  async function run<T>(
    key: string,
    task: () => Promise<T>,
    doneMessage?: string | ((value: T, fresh: RnaFreshData) => string),
  ): Promise<RnaRunResult<T>> {
    if (busyKey !== null) {
      return { ok: false, message: "Un'altra operazione è ancora in corso. Aspetta un momento." };
    }
    setBusyKey(key);
    setStaleNotice(null);
    try {
      let value: T;
      try {
        value = await task();
      } catch (caught) {
        return { ok: false, message: getRecordNightErrorMessage(caught) };
      }
      let fresh: RnaFreshData | null = null;
      try {
        fresh = await load();
      } catch {
        setStaleNotice(
          "L'operazione è andata a buon fine, ma non riesco ad aggiornare l'elenco. Premi Aggiorna.",
        );
      }
      if (doneMessage) {
        const text =
          typeof doneMessage === "function"
            ? doneMessage(value, fresh ?? { records, entries })
            : doneMessage;
        flashSeq.current += 1;
        setFlash({ id: flashSeq.current, text });
      }
      return { ok: true, value };
    } finally {
      setBusyKey(null);
    }
  }

  function notify(text: string) {
    flashSeq.current += 1;
    setFlash({ id: flashSeq.current, text });
  }

  const ctx: RnaContext = {
    stakeId,
    activityId,
    busy: busyKey !== null,
    busyKey,
    participants: {
      status: participantStatus,
      list: participantList,
      reload: () => void loadParticipants(),
    },
    notify,
    run,
  };

  const model = useMemo(() => {
    const recordsById = new Map(records.map((record) => [record.id, record]));
    const pending = entries.filter((entry) => entry.status === "pending");
    const rejected = entries.filter((entry) => entry.status === "rejected").sort(byMostRecentUpdate);
    // Chi è stato ritirato insieme a un record nascosto compare nella riga del
    // record, non anche qui.
    const withdrawn = entries
      .filter((entry) => entry.status === "withdrawn")
      .filter((entry) => {
        const record = entry.recordId ? recordsById.get(entry.recordId) : undefined;
        return !(record?.status === "hidden" && isWithdrawnWithRecord(entry, record));
      })
      .sort(byMostRecentUpdate);

    const approvedByRecord = new Map<string, RecordNightEntry[]>();
    const takenByRecord = new Map<string, Set<string>>();
    const activeCounts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.status !== "pending" && entry.status !== "approved") continue;
      activeCounts.set(entry.registrationId, (activeCounts.get(entry.registrationId) ?? 0) + 1);
      if (entry.status === "approved" && entry.recordId) {
        approvedByRecord.set(entry.recordId, [...(approvedByRecord.get(entry.recordId) ?? []), entry]);
        const taken = takenByRecord.get(entry.recordId) ?? new Set<string>();
        taken.add(entry.registrationId);
        takenByRecord.set(entry.recordId, taken);
      }
    }
    for (const list of approvedByRecord.values()) {
      list.sort((left, right) =>
        left.participantName.localeCompare(right.participantName, "it-IT"),
      );
    }

    const open = records.filter((record) => record.status === "open").sort(byMostEntries);
    const withEntries = open.filter((record) => record.challengerCount > 0);
    const withoutEntries = open.filter((record) => record.challengerCount === 0);
    const hidden = records.filter((record) => record.status === "hidden").sort(byMostEntries);

    // Persone e iscrizioni che oggi compaiono nell'elenco: tentativi approvati
    // su record aperti.
    const countedEntries = entries.filter(
      (entry) =>
        entry.status === "approved" &&
        entry.recordId !== null &&
        recordsById.get(entry.recordId)?.status === "open",
    );
    const people = new Set(countedEntries.map((entry) => entry.registrationId)).size;

    return {
      recordsById,
      pending,
      rejected,
      withdrawn,
      approvedByRecord,
      takenByRecord,
      activeCounts,
      open,
      withEntries,
      withoutEntries,
      hidden,
      people,
      enrollments: countedEntries.length,
    };
  }, [entries, records]);

  async function createRecord(input: RecordNightRecordInput) {
    setNewError(null);
    const result = await ctx.run(
      "create",
      () => recordNightService.createRecord(stakeId, activityId, input),
      "Record creato. Ora iscrivi chi lo fa.",
    );
    if (!result.ok) {
      setNewError(result.message);
      return;
    }
    setNewOpen(false);
    // Un record senza iscritti non sta nell'elenco: lo porto davanti a chi l'ha
    // creato con il pannello per iscrivere già aperto.
    const created = result.value.record;
    if (created) {
      setEmptyOpen(true);
      setPanel({ recordId: created.id, mode: "add" });
    }
  }

  function renderRow(record: RecordNightRecord) {
    return (
      <OpenRecordRow
        activeEntryCounts={model.activeCounts}
        ctx={ctx}
        entries={model.approvedByRecord.get(record.id) ?? []}
        key={record.id}
        onPanelChange={(mode) => setPanel(mode ? { recordId: record.id, mode } : null)}
        panel={panel?.recordId === record.id ? panel.mode : null}
        record={record}
        takenRegistrationIds={model.takenByRecord.get(record.id) ?? EMPTY_SET}
      />
    );
  }

  // La data si cambia dall'attività: lo dico solo a chi può modificarla (admin).
  const closeNote = [
    event.recordsCloseAt ? "" : "Come l'inizio dell'attività.",
    canManageStaff ? "Si cambia dall'attività" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const closeAt = getRecordNightCloseAt(event);
  const windowState = getRecordNightWindow(event);
  const titleId = `${baseId}-title`;
  const pendingTitleId = `${baseId}-pending`;
  const openTitleId = `${baseId}-open`;
  const newPanelId = `${baseId}-new`;

  return (
    <section aria-labelledby={titleId} className="rna">
      <header className="rna-head">
        <div>
          <h2 className={hideTitle ? "sr-only" : undefined} id={titleId}>
            Notte dei Record
          </h2>
          <p>Controlla le proposte dei ragazzi e tieni in ordine l'elenco.</p>
        </div>
        <button
          className="button button--ghost button--small"
          disabled={loading || ctx.busy}
          onClick={() => void reload()}
          type="button"
        >
          <AppIcon name="refresh" />
          <span>Aggiorna</span>
        </button>
      </header>

      <div className="rna-tiles">
        <div className="rna-tile">
          <span className="rna-tile__label">
            Iscrizioni chiudono
            {windowState === "closed" ? <span className="rna-tile__tag">Chiuse</span> : null}
          </span>
          <strong className="rna-tile__value rna-tile__value--text">
            {closeAt ? formatRecordNightDeadline(closeAt) : "Data non valida"}
          </strong>
          {closeNote ? <small>{closeNote}</small> : null}
        </div>
        <div className="rna-tile">
          <span className="rna-tile__label">Record</span>
          <strong className="rna-tile__value">
            {model.withEntries.length} <span>aperti</span>
          </strong>
        </div>
        <div className="rna-tile">
          <span className="rna-tile__label">Iscritti</span>
          <strong className="rna-tile__value">
            {model.people} <span>{model.people === 1 ? "persona" : "persone"}</span>
          </strong>
          <small>
            {model.enrollments} {model.enrollments === 1 ? "iscrizione" : "iscrizioni"}
          </small>
        </div>
      </div>

      {loadError ? (
        <div className="rna-notice rna-notice--error" role="alert">
          <p>{loadError}</p>
          <button
            className="button button--ghost button--small"
            onClick={() => void reload()}
            type="button"
          >
            Riprova
          </button>
        </div>
      ) : null}

      {staleNotice ? (
        <div className="rna-notice" role="status">
          <p>{staleNotice}</p>
        </div>
      ) : null}

      {loading && records.length === 0 && entries.length === 0 && !loadError ? (
        <p className="rna-loading" role="status">
          Sto caricando i record...
        </p>
      ) : null}

      {!loadError && !(loading && records.length === 0 && entries.length === 0) ? (
        <>
          <section aria-labelledby={pendingTitleId} className="rna-section">
            <div className="rna-section__head">
              <h3 id={pendingTitleId}>Proposte in attesa ({model.pending.length})</h3>
            </div>
            {model.pending.length === 0 ? (
              <p className="rna-empty">
                Nessuna proposta da controllare. Quando un ragazzo ne manda una, la trovi qui.
              </p>
            ) : (
              <div className="rna-proposals">
                {model.pending.map((entry) => (
                  <ProposalCard ctx={ctx} entry={entry} key={entry.id} openRecords={model.open} />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby={openTitleId} className="rna-section">
            <div className="rna-section__head">
              <h3 id={openTitleId}>Record aperti ({model.withEntries.length})</h3>
              <button
                aria-controls={newOpen ? newPanelId : undefined}
                aria-expanded={newOpen}
                className="button button--primary button--small"
                disabled={ctx.busy}
                onClick={() => {
                  setNewError(null);
                  setNewOpen((current) => !current);
                }}
                ref={newButton}
                type="button"
              >
                <AppIcon name="plus" />
                <span>Nuovo record</span>
              </button>
            </div>

            {newOpen ? (
              <div className="rna-panel-wrap" id={newPanelId}>
                <RecordForm
                  busy={ctx.busyKey === "create"}
                  busyLabel="Sto creando..."
                  error={newError}
                  footnote={EMPTY_RECORD_EFFECT}
                  heading="Nuovo record"
                  headingNote="Per chi non ha un account o propone qualcosa di nuovo"
                  idPrefix={`${baseId}-new-form`}
                  initial={{
                    title: "",
                    category: "",
                    measure: "count_in_time",
                    durationSeconds: null,
                    notes: "",
                  }}
                  onCancel={() => {
                    setNewOpen(false);
                    setNewError(null);
                    window.requestAnimationFrame(() => newButton.current?.focus());
                  }}
                  onSubmit={(input) => void createRecord(input)}
                  submitLabel="Crea il record"
                />
              </div>
            ) : null}

            {model.withEntries.length === 0 ? (
              <p className="rna-empty">
                Ancora nessun record con iscritti. Compaiono quando approvi una proposta o iscrivi
                qualcuno.
              </p>
            ) : (
              <div className="rna-records">{model.withEntries.map(renderRow)}</div>
            )}
          </section>

          <div className="rna-closed-group">
            {model.withoutEntries.length > 0 ? (
              <ClosedSection
                count={model.withoutEntries.length}
                hint={EMPTY_RECORD_EFFECT}
                onToggle={setEmptyOpen}
                open={emptyOpen}
                title="Senza iscritti"
              >
                <div className="rna-records">{model.withoutEntries.map(renderRow)}</div>
              </ClosedSection>
            ) : null}

            {model.rejected.length > 0 ? (
              <ClosedSection
                count={model.rejected.length}
                hint="Il ragazzo vede il motivo. Con “Riporta in attesa” la proposta torna da controllare."
                title="Non accettate"
              >
                <RejectedList ctx={ctx} entries={model.rejected} />
              </ClosedSection>
            ) : null}

            {model.hidden.length > 0 ? (
              <ClosedSection
                count={model.hidden.length}
                hint={`${HIDE_RECORD_EFFECT} ${SHOW_RECORD_EFFECT}`}
                title="Record nascosti"
              >
                <HiddenList ctx={ctx} entries={entries} records={model.hidden} />
              </ClosedSection>
            ) : null}

            {model.withdrawn.length > 0 ? (
              <ClosedSection count={model.withdrawn.length} title="Ritirati">
                <WithdrawnList entries={model.withdrawn} recordsById={model.recordsById} />
              </ClosedSection>
            ) : null}

            {canManageStaff ? <StaffSection ctx={ctx} /> : null}
          </div>
        </>
      ) : null}

      <div aria-live="polite" className="rna-toast-region" role="status">
        {flash ? (
          <p className="rna-toast" key={flash.id}>
            {flash.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}

const EMPTY_SET: ReadonlySet<string> = new Set();
