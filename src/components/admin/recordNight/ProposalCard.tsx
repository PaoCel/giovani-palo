import { useId, useMemo, useRef, useState, type FormEvent } from "react";

import { AppIcon } from "@/components/AppIcon";
import {
  recordNightService,
  type RecordNightRecordInput,
} from "@/services/firestore/recordNightService";
import type { RecordNightEntry, RecordNightRecord } from "@/types";
import {
  RECORD_NIGHT_LIMITS,
  findSimilarRecords,
  getRecordNightMeasureShortLabel,
} from "@/utils/recordNight";

import {
  STRONG_SIMILARITY,
  asVisibleForSimilarity,
  formatRecordersCount,
  formatShortDateTime,
  getMeasureFullLabel,
  suggestCategory,
  suggestRecordTitle,
} from "./helpers";
import { Avatar, CategoryPill, useFocusReturn } from "./parts";
import { RecordForm } from "./RecordForm";
import { OriginLine } from "./RequestParts";
import { UNDO_DECISION_HINT } from "./copy";
import type { RnaContext } from "./types";

// Motivi pronti: un clic riempie il campo, poi l'admin può ritoccarlo.
const QUICK_REJECTION_REASONS = [
  "Niente cibo o bevande a gara.",
  "È troppo rischioso: proponi un'altra prova.",
  "Esiste già: sfida quel record dall'elenco.",
] as const;

type ProposalMode = "approve" | "merge" | "reject" | null;

interface ProposalCardProps {
  ctx: RnaContext;
  entry: RecordNightEntry;
  // Record aperti (anche ancora vuoti) a cui si può unire la proposta.
  openRecords: ReadonlyArray<RecordNightRecord>;
}

export function ProposalCard({ ctx, entry, openRecords }: ProposalCardProps) {
  const [mode, setMode] = useState<ProposalMode>(null);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();
  const approveButton = useRef<HTMLButtonElement>(null);
  const mergeButton = useRef<HTMLButtonElement>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const focusApprove = useFocusReturn(approveButton);
  const focusMerge = useFocusReturn(mergeButton);
  const focusReject = useFocusReturn(rejectButton);

  const name = entry.participantName || "Senza nome";
  const text = entry.proposedText ?? "";
  const busyHere = ctx.busy;

  const similar = useMemo(() => {
    const byId = new Map(openRecords.map((record) => [record.id, record]));
    return findSimilarRecords(text, asVisibleForSimilarity(openRecords), { limit: 3 })
      .map((item) => {
        const record = byId.get(item.record.id);
        return record ? { record, score: item.score } : null;
      })
      .filter((item): item is { record: RecordNightRecord; score: number } => item !== null);
  }, [openRecords, text]);
  const strong = similar[0] && similar[0].score >= STRONG_SIMILARITY ? similar[0].record : null;

  function toggle(next: Exclude<ProposalMode, null>) {
    setError(null);
    setMode((current) => (current === next ? null : next));
  }

  function close(returnFocus: () => void) {
    setMode(null);
    setError(null);
    returnFocus();
  }

  async function approve(input: RecordNightRecordInput) {
    const result = await ctx.run(
      `approve:${entry.id}`,
      () => recordNightService.approve(ctx.stakeId, ctx.activityId, entry.id, input),
      `Proposta approvata: «${input.title}».`,
    );
    if (result.ok) setMode(null);
    else setError(result.message);
  }

  async function merge(record: RecordNightRecord) {
    const result = await ctx.run(
      `merge:${entry.id}`,
      () => recordNightService.merge(ctx.stakeId, ctx.activityId, entry.id, record.id),
      `${name} ora è su «${record.title}».`,
    );
    if (result.ok) setMode(null);
    else setError(result.message);
  }

  async function reject(reason: string) {
    const result = await ctx.run(
      `reject:${entry.id}`,
      () => recordNightService.reject(ctx.stakeId, ctx.activityId, entry.id, reason),
      "Proposta rifiutata.",
    );
    if (result.ok) setMode(null);
    else setError(result.message);
  }

  const panelId = `${baseId}-panel`;

  return (
    <article
      aria-label={`Proposta di ${name}`}
      className={entry.fromGuestRequest ? "rna-proposal rna-proposal--origin" : "rna-proposal"}
    >
      <header className="rna-proposal__head">
        <Avatar name={name} />
        <div className="rna-proposal__who">
          <h4>{name}</h4>
          {entry.createdAt ? <small>Proposta del {formatShortDateTime(entry.createdAt)}</small> : null}
        </div>
      </header>

      <OriginLine ctx={ctx} entry={entry} />

      <blockquote className="rna-quote">
        <span aria-hidden="true">“</span>
        {text || "Nessun testo"}
        <span aria-hidden="true">”</span>
      </blockquote>

      <dl className="rna-facts">
        <div>
          <dt>Misura proposta</dt>
          <dd>{getMeasureFullLabel(entry.proposedMeasure, entry.proposedDurationSeconds)}</dd>
        </div>
        <div>
          <dt>Serve</dt>
          <dd className={entry.proposedNeeds ? undefined : "rna-muted"}>
            {entry.proposedNeeds || "Niente"}
          </dd>
        </div>
      </dl>

      {strong ? (
        <div className="rna-similar" role="note">
          <p>
            Forse è lo stesso di <strong>{strong.title}</strong>, con{" "}
            {formatRecordersCount(strong.challengerCount)}.
          </p>
          <button
            className="button button--soft button--small"
            disabled={busyHere}
            onClick={() => void merge(strong)}
            type="button"
          >
            {ctx.busyKey === `merge:${entry.id}` ? "Sto unendo..." : "Unisci a questo"}
          </button>
        </div>
      ) : null}

      <div className="rna-actions">
        <button
          aria-controls={mode === "approve" ? panelId : undefined}
          aria-expanded={mode === "approve"}
          className="button button--primary button--small"
          disabled={busyHere}
          onClick={() => toggle("approve")}
          ref={approveButton}
          type="button"
        >
          <AppIcon name="check" />
          <span>Approva</span>
        </button>
        <button
          aria-controls={mode === "merge" ? panelId : undefined}
          aria-expanded={mode === "merge"}
          className="button button--ghost button--small"
          disabled={busyHere}
          onClick={() => toggle("merge")}
          ref={mergeButton}
          type="button"
        >
          <AppIcon name="users" />
          <span>Unisci a…</span>
        </button>
        <button
          aria-controls={mode === "reject" ? panelId : undefined}
          aria-expanded={mode === "reject"}
          className="button button--ghost button--small rna-danger"
          disabled={busyHere}
          onClick={() => toggle("reject")}
          ref={rejectButton}
          type="button"
        >
          <AppIcon name="x" />
          <span>Rifiuta</span>
        </button>
      </div>

      {mode ? (
        <div className="rna-panel-wrap" id={panelId}>
          {mode === "approve" ? (
            <RecordForm
              busy={ctx.busyKey === `approve:${entry.id}`}
              busyLabel="Sto creando..."
              error={error}
              footnote={`Compare a tutti come “Record da stabilire”. ${UNDO_DECISION_HINT}`}
              heading="Approva e crea il record"
              headingNote="Il testo del ragazzo resta com'è: il titolo vale solo per il record"
              idPrefix={`${baseId}-approve`}
              initial={{
                title: suggestRecordTitle(entry.proposedText),
                category: suggestCategory(entry.proposedMeasure),
                measure: entry.proposedMeasure ?? "other",
                durationSeconds: entry.proposedDurationSeconds,
                notes: "",
              }}
              onCancel={() => close(focusApprove)}
              onSubmit={(input) => void approve(input)}
              submitLabel="Approva e crea il record"
            />
          ) : null}
          {mode === "merge" ? (
            <MergePanel
              busy={ctx.busy}
              busyKey={ctx.busyKey}
              entryId={entry.id}
              error={error}
              name={name}
              onCancel={() => close(focusMerge)}
              onMerge={(record) => void merge(record)}
              records={openRecords}
              similar={similar.map((item) => item.record)}
            />
          ) : null}
          {mode === "reject" ? (
            <RejectPanel
              busy={ctx.busyKey === `reject:${entry.id}`}
              disabled={ctx.busy}
              error={error}
              idPrefix={`${baseId}-reject`}
              onCancel={() => close(focusReject)}
              onReject={(reason) => void reject(reason)}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Unisci a…
// ---------------------------------------------------------------------------

interface MergePanelProps {
  busy: boolean;
  busyKey: string | null;
  entryId: string;
  error: string | null;
  name: string;
  records: ReadonlyArray<RecordNightRecord>;
  // Record simili al testo, in ordine di somiglianza: stanno in cima.
  similar: ReadonlyArray<RecordNightRecord>;
  onCancel: () => void;
  onMerge: (record: RecordNightRecord) => void;
}

function MergePanel({
  busy,
  busyKey,
  entryId,
  error,
  name,
  records,
  similar,
  onCancel,
  onMerge,
}: MergePanelProps) {
  const [selectedId, setSelectedId] = useState("");
  const groupId = useId();
  const similarIds = new Set(similar.map((record) => record.id));
  const others = records.filter((record) => !similarIds.has(record.id));
  const selected = records.find((record) => record.id === selectedId) ?? null;
  const headingId = `${groupId}-heading`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected && !busy) onMerge(selected);
  }

  function renderOption(record: RecordNightRecord) {
    return (
      <label className="rna-choice" key={record.id}>
        <input
          checked={selectedId === record.id}
          disabled={busy}
          name={`${groupId}-record`}
          onChange={() => setSelectedId(record.id)}
          type="radio"
          value={record.id}
        />
        <span className="rna-choice__body">
          <strong>{record.title}</strong>
          <span className="rna-choice__meta">
            <CategoryPill category={record.category} />
            <span>{getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}</span>
            <span>{formatRecordersCount(record.challengerCount)}</span>
          </span>
        </span>
      </label>
    );
  }

  return (
    <form aria-labelledby={headingId} className="rna-panel" onSubmit={handleSubmit}>
      <div className="rna-panel__head">
        <h5 id={headingId}>Unisci a un record aperto</h5>
        <p className="rna-panel__note">
          {name} entra nel record scelto. Il testo resta com'è.
        </p>
      </div>

      {records.length === 0 ? (
        <p className="rna-empty-inline">
          Non ci sono ancora record aperti. Con Approva ne crei uno nuovo.
        </p>
      ) : (
        <fieldset className="rna-choices">
          <legend className="sr-only">Record aperti</legend>
          {similar.length > 0 ? (
            <>
              <p className="rna-choices__label">Simili a questa proposta</p>
              {similar.map(renderOption)}
              {others.length > 0 ? <p className="rna-choices__label">Altri record aperti</p> : null}
            </>
          ) : null}
          {others.map(renderOption)}
        </fieldset>
      )}

      <p className="rna-panel__footnote">{UNDO_DECISION_HINT}</p>

      {error ? (
        <p className="rna-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rna-panel__actions">
        <button
          className="button button--ghost button--small"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Annulla
        </button>
        <button
          className="button button--primary button--small"
          disabled={busy || !selected}
          type="submit"
        >
          {busyKey === `merge:${entryId}` ? "Sto unendo..." : "Unisci"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Rifiuta
// ---------------------------------------------------------------------------

interface RejectPanelProps {
  idPrefix: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onCancel: () => void;
  onReject: (reason: string) => void;
}

function RejectPanel({ idPrefix, busy, disabled, error, onCancel, onReject }: RejectPanelProps) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = `${idPrefix}-reason`;
  const errorId = `${idPrefix}-reason-error`;
  const missing = touched && !reason.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const clean = reason.replace(/\s+/gu, " ").trim();
    if (!clean) {
      setTouched(true);
      fieldRef.current?.focus();
      return;
    }
    onReject(clean);
  }

  return (
    <form aria-labelledby={`${idPrefix}-heading`} className="rna-panel" noValidate onSubmit={handleSubmit}>
      <div className="rna-panel__head">
        <h5 id={`${idPrefix}-heading`}>Rifiuta la proposta</h5>
        <p className="rna-panel__note">Il motivo lo legge il ragazzo.</p>
      </div>

      <div className="rna-field rna-field--wide">
        <div className="rna-field__top">
          <label htmlFor={fieldId}>Motivo</label>
          <span className="rna-counter" aria-hidden="true">
            {Array.from(reason).length}/{RECORD_NIGHT_LIMITS.reason}
          </span>
        </div>
        <textarea
          aria-describedby={missing ? errorId : undefined}
          aria-invalid={missing ? true : undefined}
          aria-required="true"
          className="rna-input rna-input--area"
          id={fieldId}
          maxLength={RECORD_NIGHT_LIMITS.reason}
          onChange={(event) => setReason(event.target.value)}
          ref={fieldRef}
          rows={3}
          value={reason}
        />
        {missing ? (
          <p className="rna-field__error" id={errorId}>
            Scrivi il motivo del rifiuto.
          </p>
        ) : null}
      </div>

      <div className="rna-quick" role="group" aria-label="Motivi rapidi">
        <span className="rna-quick__label">Motivi rapidi</span>
        {QUICK_REJECTION_REASONS.map((quick) => (
          <button
            className="rna-chip-button"
            disabled={disabled}
            key={quick}
            onClick={() => {
              setReason(quick);
              fieldRef.current?.focus();
            }}
            type="button"
          >
            {quick}
          </button>
        ))}
      </div>

      <p className="rna-panel__footnote">{UNDO_DECISION_HINT}</p>

      {error ? (
        <p className="rna-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rna-panel__actions">
        <button
          className="button button--ghost button--small"
          disabled={disabled}
          onClick={onCancel}
          type="button"
        >
          Annulla
        </button>
        <button
          className="button button--primary button--small rna-danger-solid"
          disabled={disabled}
          type="submit"
        >
          {busy ? "Sto rifiutando..." : "Rifiuta la proposta"}
        </button>
      </div>
    </form>
  );
}
