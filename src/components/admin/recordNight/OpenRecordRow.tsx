import { useId, useRef, useState, type KeyboardEvent } from "react";

import { AppIcon } from "@/components/AppIcon";
import {
  recordNightService,
  type RecordNightRecordInput,
} from "@/services/firestore/recordNightService";
import type { RecordNightEntry, RecordNightRecord } from "@/types";
import { getRecordNightMeasureShortLabel } from "@/utils/recordNight";

import { AddParticipantPanel } from "./AddParticipantPanel";
import { HIDE_RECORD_EFFECT, SHOW_RECORD_EFFECT } from "./copy";
import { formatPeopleCount, formatRecordersCount } from "./helpers";
import { CategoryPill, useFocusReturn } from "./parts";
import { RecordForm } from "./RecordForm";
import type { RnaContext } from "./types";

export type RecordRowPanel = "add" | "edit" | "hide";

// Oltre questo numero i nomi si raccolgono dietro "Mostra tutti".
const COLLAPSED_CHIPS = 8;

interface OpenRecordRowProps {
  ctx: RnaContext;
  record: RecordNightRecord;
  // Tentativi approvati su questo record (con i nomi).
  entries: ReadonlyArray<RecordNightEntry>;
  takenRegistrationIds: ReadonlySet<string>;
  activeEntryCounts: ReadonlyMap<string, number>;
  panel: RecordRowPanel | null;
  onPanelChange: (panel: RecordRowPanel | null) => void;
}

// Una riga della scheda: record aperto con i suoi iscritti, oppure aperto ma
// ancora vuoto (sezione "Senza iscritti").
export function OpenRecordRow({
  ctx,
  record,
  entries,
  takenRegistrationIds,
  activeEntryCounts,
  panel,
  onPanelChange,
}: OpenRecordRowProps) {
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const hideButton = useRef<HTMLButtonElement>(null);
  const focusAdd = useFocusReturn(addButton);
  const focusEdit = useFocusReturn(editButton);
  const focusHide = useFocusReturn(hideButton);
  const panelId = `${baseId}-panel`;

  function toggle(next: RecordRowPanel) {
    setError(null);
    onPanelChange(panel === next ? null : next);
  }

  function close(returnFocus: () => void) {
    setError(null);
    onPanelChange(null);
    returnFocus();
  }

  async function save(input: RecordNightRecordInput) {
    const result = await ctx.run(
      `update:${record.id}`,
      () =>
        recordNightService.updateRecord(ctx.stakeId, ctx.activityId, record.id, {
          ...input,
          status: record.status,
        }),
      "Record aggiornato.",
    );
    if (result.ok) onPanelChange(null);
    else setError(result.message);
  }

  async function hide() {
    const result = await ctx.run(
      `hide:${record.id}`,
      () =>
        recordNightService.updateRecord(ctx.stakeId, ctx.activityId, record.id, {
          title: record.title,
          category: record.category,
          measure: record.measure,
          durationSeconds: record.durationSeconds,
          notes: record.notes,
          status: "hidden",
        }),
      (value) =>
        value.withdrawnCount > 0
          ? `«${record.title}» è nascosto. Ritirati: ${formatPeopleCount(value.withdrawnCount)}.`
          : `«${record.title}» è nascosto.`,
    );
    if (result.ok) onPanelChange(null);
    else setError(result.message);
  }

  return (
    <article className="rna-record" aria-label={record.title}>
      <div className="rna-record__top">
        <div className="rna-record__main">
          <h4>{record.title}</h4>
          <p className="rna-record__meta">
            <CategoryPill category={record.category} />
            <span>{getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}</span>
            <span className="rna-record__count">{formatRecordersCount(record.challengerCount)}</span>
          </p>
          {record.notes ? <p className="rna-record__notes">{record.notes}</p> : null}
        </div>

        <div className="rna-record__actions">
          <button
            aria-controls={panel === "add" ? panelId : undefined}
            aria-expanded={panel === "add"}
            className="button button--soft button--small"
            disabled={ctx.busy}
            onClick={() => toggle("add")}
            ref={addButton}
            type="button"
          >
            <AppIcon name="plus" />
            <span>Iscrivi qualcuno</span>
          </button>
          <button
            aria-controls={panel === "edit" ? panelId : undefined}
            aria-expanded={panel === "edit"}
            className="button button--ghost button--small"
            disabled={ctx.busy}
            onClick={() => toggle("edit")}
            ref={editButton}
            type="button"
          >
            <AppIcon name="pencil" />
            <span>Modifica</span>
          </button>
          <button
            aria-controls={panel === "hide" ? panelId : undefined}
            aria-expanded={panel === "hide"}
            className="button button--ghost button--small"
            disabled={ctx.busy}
            onClick={() => toggle("hide")}
            ref={hideButton}
            type="button"
          >
            <AppIcon name="lock" />
            <span>Nascondi</span>
          </button>
        </div>
      </div>

      {entries.length > 0 ? <EntryChips ctx={ctx} entries={entries} recordTitle={record.title} /> : null}

      {panel ? (
        <div className="rna-panel-wrap" id={panelId}>
          {panel === "add" ? (
            <AddParticipantPanel
              activeEntryCounts={activeEntryCounts}
              ctx={ctx}
              onClose={() => close(focusAdd)}
              record={record}
              takenRegistrationIds={takenRegistrationIds}
            />
          ) : null}

          {panel === "edit" ? (
            <RecordForm
              busy={ctx.busyKey === `update:${record.id}`}
              busyLabel="Sto salvando..."
              error={error}
              heading="Modifica il record"
              headingNote="Gli iscritti restano dove sono"
              idPrefix={`${baseId}-edit`}
              initial={{
                title: record.title,
                category: record.category,
                measure: record.measure,
                durationSeconds: record.durationSeconds,
                notes: record.notes,
              }}
              onCancel={() => close(focusEdit)}
              onSubmit={(input) => void save(input)}
              submitLabel="Salva le modifiche"
            />
          ) : null}

          {panel === "hide" ? (
            <div className="rna-confirm" role="group" aria-label={`Nascondere ${record.title}`}>
              <p>
                {HIDE_RECORD_EFFECT} {SHOW_RECORD_EFFECT}
              </p>
              {error ? (
                <p className="rna-panel__error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="rna-panel__actions">
                <button
                  className="button button--ghost button--small"
                  disabled={ctx.busy}
                  onClick={() => close(focusHide)}
                  type="button"
                >
                  Annulla
                </button>
                <button
                  className="button button--primary button--small"
                  disabled={ctx.busy}
                  onClick={() => void hide()}
                  type="button"
                >
                  {ctx.busyKey === `hide:${record.id}` ? "Sto nascondendo..." : "Nascondi il record"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Nomi degli iscritti, ognuno con il suo menu
// ---------------------------------------------------------------------------

interface EntryChipsProps {
  ctx: RnaContext;
  entries: ReadonlyArray<RecordNightEntry>;
  recordTitle: string;
}

function EntryChips({ ctx, entries, recordTitle }: EntryChipsProps) {
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());

  const collapsible = entries.length > COLLAPSED_CHIPS;
  // Il chip con il menu aperto non sparisce mai dietro "Mostra tutti".
  const visibleEntries =
    collapsible && !expanded
      ? entries.filter((entry, index) => index < COLLAPSED_CHIPS || entry.id === openId)
      : entries;
  const openEntry = entries.find((entry) => entry.id === openId) ?? null;
  const menuId = `${baseId}-menu`;

  function closeMenu() {
    const id = openId;
    setOpenId(null);
    setConfirmId(null);
    setError(null);
    if (id) window.requestAnimationFrame(() => chipRefs.current.get(id)?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && openId) {
      event.stopPropagation();
      closeMenu();
    }
  }

  async function withdraw(entry: RecordNightEntry) {
    const result = await ctx.run(
      `withdraw:${entry.id}`,
      () => recordNightService.withdrawEntry(ctx.stakeId, ctx.activityId, entry.id),
      `Ritiro fatto: ${entry.participantName || "la persona"} non è più su «${recordTitle}».`,
    );
    if (result.ok) {
      setOpenId(null);
      setConfirmId(null);
    } else {
      setError(result.message);
    }
  }

  async function reopen(entry: RecordNightEntry) {
    const result = await ctx.run(
      `reopen:${entry.id}`,
      () => recordNightService.reopen(ctx.stakeId, ctx.activityId, entry.id),
      (_value, fresh) => {
        // Se il record nato da questa approvazione resta senza iscritti, il
        // server lo nasconde: lo dico, altrimenti sparirebbe senza spiegazione.
        const record = fresh.records.find((item) => item.id === entry.recordId);
        return record?.status === "hidden"
          ? `La proposta è tornata in attesa. «${record.title}» è rimasto senza iscritti ed è nascosto.`
          : "La proposta è tornata in attesa.";
      },
    );
    if (result.ok) {
      setOpenId(null);
      setConfirmId(null);
    } else {
      setError(result.message);
    }
  }

  return (
    <div className="rna-entries" onKeyDown={handleKeyDown}>
      <ul aria-label={`Iscritti a ${recordTitle}`} className="rna-chips">
        {visibleEntries.map((entry) => {
          const name = entry.participantName || "Senza nome";
          const isOpen = openId === entry.id;
          return (
            <li key={entry.id}>
              <button
                aria-controls={isOpen ? menuId : undefined}
                aria-expanded={isOpen}
                aria-label={`${name}: azioni`}
                className={isOpen ? "rna-chip rna-chip--open" : "rna-chip"}
                onClick={() => {
                  setError(null);
                  setConfirmId(null);
                  setOpenId(isOpen ? null : entry.id);
                }}
                ref={(node) => {
                  if (node) chipRefs.current.set(entry.id, node);
                  else chipRefs.current.delete(entry.id);
                }}
                type="button"
              >
                <span>{name}</span>
                <AppIcon name="ellipsis" />
              </button>
            </li>
          );
        })}
        {collapsible ? (
          <li>
            <button
              aria-expanded={expanded}
              className="rna-chip rna-chip--more"
              onClick={() => setExpanded((current) => !current)}
              type="button"
            >
              {expanded ? "Mostra meno" : `Mostra tutti (${entries.length})`}
            </button>
          </li>
        ) : null}
      </ul>

      {openEntry ? (
        <div
          aria-label={`Azioni per ${openEntry.participantName || "questa persona"}`}
          className="rna-chip-menu"
          id={menuId}
          role="group"
        >
          {confirmId === openEntry.id ? (
            <>
              <p>
                Ritirare {openEntry.participantName || "questa persona"} da questo record? Per
                tornare indietro usa “Iscrivi qualcuno”.
              </p>
              <div className="rna-chip-menu__actions">
                <button
                  className="button button--ghost button--small"
                  disabled={ctx.busy}
                  onClick={() => setConfirmId(null)}
                  type="button"
                >
                  Annulla
                </button>
                <button
                  className="button button--primary button--small"
                  disabled={ctx.busy}
                  onClick={() => void withdraw(openEntry)}
                  type="button"
                >
                  {ctx.busyKey === `withdraw:${openEntry.id}` ? "Sto ritirando..." : "Ritira"}
                </button>
              </div>
            </>
          ) : (
            <div className="rna-chip-menu__actions">
              {openEntry.kind === "proposal" ? (
                <button
                  className="button button--soft button--small"
                  disabled={ctx.busy}
                  onClick={() => void reopen(openEntry)}
                  type="button"
                >
                  <AppIcon name="refresh" />
                  <span>
                    {ctx.busyKey === `reopen:${openEntry.id}` ? "Un momento..." : "Riporta in attesa"}
                  </span>
                </button>
              ) : null}
              <button
                className="button button--ghost button--small"
                disabled={ctx.busy}
                onClick={() => setConfirmId(openEntry.id)}
                type="button"
              >
                <AppIcon name="logout" />
                <span>Ritira</span>
              </button>
              <button
                className="button button--ghost button--small"
                disabled={ctx.busy}
                onClick={closeMenu}
                type="button"
              >
                Chiudi
              </button>
            </div>
          )}
          {error ? (
            <p className="rna-panel__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
