import { useState, type ReactNode } from "react";

import { AppIcon } from "@/components/AppIcon";
import { recordNightService } from "@/services/firestore/recordNightService";
import type { RecordNightEntry, RecordNightRecord } from "@/types";
import { getRecordNightMeasureShortLabel } from "@/utils/recordNight";

import {
  formatRecordersCount,
  formatShortDateTime,
  getWithdrawalLabel,
  isWithdrawnWithRecord,
} from "./helpers";
import { Avatar, CategoryPill } from "./parts";
import { OriginLine } from "./RequestParts";
import type { RnaContext } from "./types";

// Sezioni chiuse in fondo alla scheda: servono a tornare indietro (riportare
// in attesa, mostrare di nuovo) o a ritrovare chi ha ritirato.

interface ClosedSectionProps {
  title: string;
  // Assente = niente numero accanto al titolo.
  count?: number;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  hint?: string;
  children: ReactNode;
}

export function ClosedSection({ title, count, open, onToggle, hint, children }: ClosedSectionProps) {
  return (
    <details
      className="rna-closed"
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
      open={open}
    >
      <summary>
        <span className="rna-closed__title">
          {count === undefined ? title : `${title} (${count})`}
        </span>
        <AppIcon name="arrow-right" />
      </summary>
      <div className="rna-closed__body">
        {hint ? <p className="rna-closed__hint">{hint}</p> : null}
        {children}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Non accettate
// ---------------------------------------------------------------------------

export function RejectedList({
  ctx,
  entries,
}: {
  ctx: RnaContext;
  entries: ReadonlyArray<RecordNightEntry>;
}) {
  return (
    <ul className="rna-list">
      {entries.map((entry) => (
        <RejectedRow ctx={ctx} entry={entry} key={entry.id} />
      ))}
    </ul>
  );
}

function RejectedRow({ ctx, entry }: { ctx: RnaContext; entry: RecordNightEntry }) {
  const [error, setError] = useState<string | null>(null);
  const name = entry.participantName || "Senza nome";

  async function reopen() {
    setError(null);
    const result = await ctx.run(
      `reopen:${entry.id}`,
      () => recordNightService.reopen(ctx.stakeId, ctx.activityId, entry.id),
      `La proposta di ${name} è tornata in attesa.`,
    );
    if (!result.ok) setError(result.message);
  }

  return (
    <li className="rna-list__item">
      <Avatar name={name} />
      <div className="rna-list__body">
        <strong>{name}</strong>
        {entry.proposedText ? <p className="rna-list__quote">“{entry.proposedText}”</p> : null}
        <OriginLine ctx={ctx} entry={entry} />
        <p className="rna-list__reason">
          <span>Motivo</span> {entry.rejectionReason || "Non indicato"}
        </p>
        {error ? (
          <p className="rna-panel__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button
        aria-label={`Riporta in attesa la proposta di ${name}`}
        className="button button--ghost button--small"
        disabled={ctx.busy}
        onClick={() => void reopen()}
        type="button"
      >
        <AppIcon name="refresh" />
        <span>{ctx.busyKey === `reopen:${entry.id}` ? "Un momento..." : "Riporta in attesa"}</span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Record nascosti
// ---------------------------------------------------------------------------

export function HiddenList({
  ctx,
  records,
  entries,
}: {
  ctx: RnaContext;
  records: ReadonlyArray<RecordNightRecord>;
  entries: ReadonlyArray<RecordNightEntry>;
}) {
  return (
    <ul className="rna-list">
      {records.map((record) => (
        <HiddenRow
          ctx={ctx}
          key={record.id}
          record={record}
          withdrawn={entries.filter((entry) => isWithdrawnWithRecord(entry, record))}
        />
      ))}
    </ul>
  );
}

function HiddenRow({
  ctx,
  record,
  withdrawn,
}: {
  ctx: RnaContext;
  record: RecordNightRecord;
  // Chi è stato ritirato insieme al record.
  withdrawn: ReadonlyArray<RecordNightEntry>;
}) {
  const [error, setError] = useState<string | null>(null);
  const names = withdrawn.map((entry) => entry.participantName || "Senza nome");

  async function show() {
    setError(null);
    const result = await ctx.run(
      `show:${record.id}`,
      () =>
        recordNightService.updateRecord(ctx.stakeId, ctx.activityId, record.id, {
          title: record.title,
          category: record.category,
          measure: record.measure,
          durationSeconds: record.durationSeconds,
          notes: record.notes,
          status: "open",
        }),
      // Il server rimette dentro chi ha ancora posto e dice quanti.
      (value) => {
        const back = value.restoredCount;
        const left = value.notRestoredCount;
        const base = `«${record.title}» è di nuovo nell'elenco.`;
        if (back === 0 && left === 0) return base;
        if (left === 0) {
          return `${base} ${back === 1 ? "È rientrata 1 persona." : `Sono rientrate ${back} persone.`}`;
        }
        if (back === 0) return `${base} Nessuno è rientrato: non hanno più posto.`;
        return `${base} Rientrano ${back} su ${back + left}: gli altri non hanno più posto.`;
      },
    );
    if (!result.ok) setError(result.message);
  }

  return (
    <li className="rna-list__item">
      <div className="rna-list__body">
        <strong>{record.title}</strong>
        <p className="rna-record__meta">
          <CategoryPill category={record.category} />
          <span>{getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}</span>
          {record.challengerCount > 0 ? (
            <span className="rna-record__count">{formatRecordersCount(record.challengerCount)}</span>
          ) : null}
        </p>
        {names.length > 0 ? (
          <p className="rna-list__reason">
            <span>Ritirati con il record</span> {names.join(", ")}
          </p>
        ) : null}
        {error ? (
          <p className="rna-panel__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button
        aria-label={`Mostra di nuovo ${record.title}`}
        className="button button--ghost button--small"
        disabled={ctx.busy}
        onClick={() => void show()}
        type="button"
      >
        <AppIcon name="eye" />
        <span>{ctx.busyKey === `show:${record.id}` ? "Un momento..." : "Mostra di nuovo"}</span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Ritirati (sola lettura, tranne "Scollega" sui tentativi nati da una richiesta)
// ---------------------------------------------------------------------------

export function WithdrawnList({
  ctx,
  entries,
  recordsById,
}: {
  ctx: RnaContext;
  entries: ReadonlyArray<RecordNightEntry>;
  recordsById: ReadonlyMap<string, RecordNightRecord>;
}) {
  return (
    <ul className="rna-list">
      {entries.map((entry) => {
        const name = entry.participantName || "Senza nome";
        const record = entry.recordId ? recordsById.get(entry.recordId) : undefined;
        const date = formatShortDateTime(entry.updatedAt);
        return (
          <li className="rna-list__item" key={entry.id}>
            <Avatar name={name} />
            <div className="rna-list__body">
              <strong>{name}</strong>
              <p className="rna-list__quote">
                {record
                  ? record.title
                  : entry.proposedText
                    ? `“${entry.proposedText}”`
                    : "Record non più disponibile"}
              </p>
              <OriginLine ctx={ctx} entry={entry} />
            </div>
            <small className="rna-list__date">
              <span>{getWithdrawalLabel(entry.withdrawnBy)}</span>
              {date ? <span>{date}</span> : null}
            </small>
          </li>
        );
      })}
    </ul>
  );
}
