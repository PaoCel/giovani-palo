import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import {
  MAX_BULK_REJECT_REQUESTS,
  buildStaffQueueUnitFilters,
  filterStaffQueue,
  hasNoSuggestion,
  splitStaffRequests,
} from "@/utils/recordNightGuest";
import type { RecordNightStaffRequest } from "@/types";

import { REQUESTS_EMPTY, REQUESTS_INTRO, UNDO_REJECT_REQUEST_HINT } from "./copy";
import { describeRequest, formatShortDateTime, groupRequestsByPerson } from "./helpers";
import { RnaIcon } from "./icons";
import { useFocusReturn } from "./parts";
import { RequestCard } from "./RequestCard";
import type { RnaContext } from "./types";

type QueueFilter = { kind: "all" } | { kind: "unit"; unitId: string } | { kind: "loose" };

interface RequestQueueProps {
  ctx: RnaContext;
  // Unità di chi gestisce: le sue richieste stanno in alto.
  ownUnitId: string;
  ownUnitName: string;
  // Id del titolo della sezione (per `aria-labelledby`).
  titleId: string;
}

// Sezione "Da collegare": le richieste di chi non ha un account, da collegare a
// mano a un'iscrizione. Sta sopra "Proposte in attesa". Nulla qui conta finché
// lo staff non collega: il tentativo nasce solo da "Collega", con la spunta.
export function RequestQueue({ ctx, ownUnitId, ownUnitName, titleId }: RequestQueueProps) {
  const { requests } = ctx;
  const [filter, setFilter] = useState<QueueFilter>({ kind: "all" });
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkButton = useRef<HTMLButtonElement>(null);
  const selectToggle = useRef<HTMLButtonElement>(null);
  const cancelBulkButton = useRef<HTMLButtonElement>(null);
  const focusBulk = useFocusReturn(bulkButton);

  const own = useMemo(
    () => ({ unitId: ownUnitId, unitName: ownUnitName }),
    [ownUnitId, ownUnitName],
  );
  const open = useMemo(() => splitStaffRequests(requests.list).open, [requests.list]);
  const unitFilters = useMemo(() => buildStaffQueueUnitFilters(open, own), [open, own]);
  const ownFilter = unitFilters.find((item) => item.isOwn) ?? null;
  const otherFilters = unitFilters.filter((item) => !item.isOwn);
  const unmatchedCount = useMemo(() => open.filter(hasNoSuggestion).length, [open]);

  // Un filtro su un'unità che non ha più richieste torna a "Tutte".
  const activeFilter: QueueFilter =
    filter.kind === "unit" && !unitFilters.some((item) => item.unitId === filter.unitId)
      ? { kind: "all" }
      : filter;

  const activeUnitId = activeFilter.kind === "unit" ? activeFilter.unitId : null;
  const unmatchedOnly = activeFilter.kind === "loose";
  const visible = useMemo(
    () => filterStaffQueue(open, { unitId: activeUnitId, unmatchedOnly }, own),
    [open, own, activeUnitId, unmatchedOnly],
  );
  const groups = useMemo(() => groupRequestsByPerson(visible), [visible]);
  const sameNameCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of groups) for (const request of group) counts.set(request.id, group.length);
    return counts;
  }, [groups]);

  const selecting = selectMode && open.length > 0;
  // Si rifiuta solo ciò che si vede: una richiesta scelta e poi nascosta da un
  // filtro non entra nel blocco.
  const chosen = useMemo(
    () => (selecting ? visible.filter((request) => selected.has(request.id)) : []),
    [selecting, selected, visible],
  );
  const atCap = chosen.length >= MAX_BULK_REJECT_REQUESTS;

  useEffect(() => {
    if (confirmBulk) cancelBulkButton.current?.focus();
  }, [confirmBulk]);

  function changeFilter(next: QueueFilter) {
    setFilter(next);
    setSelected(new Set());
    setConfirmBulk(false);
    setBulkError(null);
  }

  function toggleSelected(id: string) {
    setConfirmBulk(false);
    setBulkError(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setConfirmBulk(false);
    setBulkError(null);
    setSelected(new Set(visible.slice(0, MAX_BULK_REJECT_REQUESTS).map((request) => request.id)));
  }

  function leaveSelection() {
    setSelectMode(false);
    setSelected(new Set());
    setConfirmBulk(false);
    setBulkError(null);
  }

  function focusAfterBulkReject() {
    // Due frame: dopo il render che toglie carte, barra ed eventuale "Fine".
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const toggle = selectToggle.current;
        if (toggle && toggle.isConnected) toggle.focus();
        else document.getElementById(titleId)?.focus();
      }),
    );
  }

  async function rejectChosen() {
    setBulkError(null);
    const result = await requests.rejectMany(chosen);
    if (result.ok) {
      setSelected(new Set());
      setConfirmBulk(false);
      // La barra e le carte scelte spariscono. Il focus torna sul tasto "Fine"; se la
      // coda è rimasta vuota sparisce anche quello e si va al titolo della sezione.
      focusAfterBulkReject();
    } else {
      setBulkError(result.message);
    }
  }

  const limit = requests.openLimit;
  const queueFull = limit > 0 && requests.openCount >= limit;
  const queueNearlyFull = limit > 0 && !queueFull && requests.openCount >= Math.ceil(limit * 0.8);

  let barText = "";
  if (selecting) {
    barText = `Scegli le richieste da segnare «Non collegabile». Fino a ${MAX_BULK_REJECT_REQUESTS} alla volta.`;
  } else if (activeFilter.kind === "loose") {
    barText = `${unmatchedCount} ${
      unmatchedCount === 1 ? "richiesta" : "richieste"
    } senza nessuna iscrizione che somiglia al nome.`;
  } else if (ownFilter) {
    barText = "La tua unità è in alto.";
  }

  const countLabel = `${chosen.length} ${chosen.length === 1 ? "selezionata" : "selezionate"}`;

  return (
    <section aria-labelledby={titleId} className="rna-section">
      <div className="rna-section__head">
        <h3 id={titleId} tabIndex={-1}>
          Da collegare ({open.length})
        </h3>
      </div>
      <p className="rna-empty-inline">{REQUESTS_INTRO}</p>

      {queueFull ? (
        <div className="rna-notice rna-notice--error" role="status">
          <p>
            La coda è piena ({requests.openCount} su {limit}): i telefoni non riescono più a inviare
            finché non si libera posto. Segna «Non collegabile» ciò che non serve, anche in blocco.
          </p>
        </div>
      ) : queueNearlyFull ? (
        <div className="rna-notice" role="status">
          <p>
            La coda si sta riempiendo ({requests.openCount} su {limit}). Quando è piena i telefoni
            non possono più inviare.
          </p>
        </div>
      ) : null}

      {open.length === 0 ? (
        <p className="rna-empty">{REQUESTS_EMPTY}</p>
      ) : (
        <>
          <div className="rna-queue-tools">
            <div aria-label="Filtra le richieste" className="rna-filters" role="group">
              <FilterChip
                count={open.length}
                label="Tutte"
                on={activeFilter.kind === "all"}
                onClick={() => changeFilter({ kind: "all" })}
              />
              {ownFilter ? (
                <FilterChip
                  count={ownFilter.count}
                  label={ownFilter.unitName}
                  on={activeFilter.kind === "unit" && activeFilter.unitId === ownFilter.unitId}
                  onClick={() => changeFilter({ kind: "unit", unitId: ownFilter.unitId })}
                  tag="la tua"
                />
              ) : null}
              <FilterChip
                count={unmatchedCount}
                label="Senza abbinamento"
                loose
                on={activeFilter.kind === "loose"}
                onClick={() => changeFilter({ kind: "loose" })}
              />
              {otherFilters.map((item) => (
                <FilterChip
                  count={item.count}
                  key={item.unitId}
                  label={item.unitName}
                  on={activeFilter.kind === "unit" && activeFilter.unitId === item.unitId}
                  onClick={() => changeFilter({ kind: "unit", unitId: item.unitId })}
                />
              ))}
            </div>

            <div className="rna-queue-bar">
              {barText ? <p>{barText}</p> : null}
              <button
                aria-pressed={selecting}
                className="button button--ghost button--small"
                disabled={ctx.busy}
                onClick={() => (selecting ? leaveSelection() : setSelectMode(true))}
                ref={selectToggle}
                type="button"
              >
                {selecting ? <AppIcon name="check" /> : <RnaIcon name="select" />}
                <span>{selecting ? "Fine" : "Seleziona"}</span>
              </button>
            </div>

            {selecting && visible.length > 1 ? (
              <button
                className="rna-linkbtn rna-linkbtn--primary rna-queue-all"
                disabled={ctx.busy}
                onClick={selectAllVisible}
                type="button"
              >
                {visible.length > MAX_BULK_REJECT_REQUESTS
                  ? `Seleziona le prime ${MAX_BULK_REJECT_REQUESTS}`
                  : `Seleziona tutte (${visible.length})`}
              </button>
            ) : null}
          </div>

          {visible.length === 0 ? (
            <p className="rna-empty">Nessuna richiesta con questo filtro.</p>
          ) : (
            <div className="rna-proposals">
              {selecting
                ? visible.map((request) => (
                    <RequestCard
                      ctx={ctx}
                      key={request.id}
                      onToggleSelect={() => toggleSelected(request.id)}
                      request={request}
                      sameNameCount={sameNameCount.get(request.id) ?? 1}
                      selectDisabled={atCap}
                      selectMode
                      selected={selected.has(request.id)}
                    />
                  ))
                : groups.map((group) =>
                    group.length === 1 ? (
                      <RequestCard ctx={ctx} key={group[0].id} request={group[0]} />
                    ) : (
                      <DupGroup ctx={ctx} group={group} key={group[0].id} />
                    ),
                  )}
            </div>
          )}
        </>
      )}

      {selecting && chosen.length > 0 ? (
        <div
          aria-label="Rifiuta in blocco"
          className={confirmBulk ? "rna-bulk rna-bulk--confirm" : "rna-bulk"}
          role="region"
        >
          {confirmBulk ? (
            <>
              <p className="rna-bulk__count" id={`${titleId}-bulk-confirm`}>
                Segnare {chosen.length} {chosen.length === 1 ? "richiesta" : "richieste"} come non
                collegabili?
                <small>
                  Il telefono vede un testo neutro, qualunque sia il motivo.{" "}
                  {UNDO_REJECT_REQUEST_HINT}
                </small>
              </p>
              {bulkError ? (
                <p className="rna-bulk__error" role="alert">
                  {bulkError}
                </p>
              ) : null}
              <div className="rna-bulk__buttons">
                <button
                  className="button button--ghost button--small"
                  disabled={ctx.busy}
                  onClick={() => {
                    setConfirmBulk(false);
                    setBulkError(null);
                    focusBulk();
                  }}
                  ref={cancelBulkButton}
                  type="button"
                >
                  Annulla
                </button>
                <button
                  aria-describedby={`${titleId}-bulk-confirm`}
                  className="button button--primary button--small"
                  disabled={ctx.busy}
                  onClick={() => void rejectChosen()}
                  type="button"
                >
                  {ctx.busyKey === "req-rejectMany"
                    ? "Sto segnando..."
                    : `Segna ${chosen.length} non ${chosen.length === 1 ? "collegabile" : "collegabili"}`}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="rna-bulk__count">
                {countLabel}
                {atCap ? <small>Massimo {MAX_BULK_REJECT_REQUESTS} alla volta</small> : null}
              </p>
              <button
                aria-label="Annulla la selezione"
                className="button button--ghost button--small rna-bulk__x"
                disabled={ctx.busy}
                onClick={() => setSelected(new Set())}
                type="button"
              >
                <AppIcon name="x" />
              </button>
              <button
                className="button button--primary button--small"
                disabled={ctx.busy}
                onClick={() => setConfirmBulk(true)}
                ref={bulkButton}
                type="button"
              >
                <span>Non collegabili</span>
              </button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Filtri
// ---------------------------------------------------------------------------

function FilterChip({
  label,
  count,
  on,
  tag,
  loose = false,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  tag?: string;
  loose?: boolean;
  onClick: () => void;
}) {
  const className = ["rna-filter", on ? "rna-filter--on" : "", loose ? "rna-filter--loose" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button aria-pressed={on} className={className} onClick={onClick} type="button">
      {label}
      {tag ? <small>{tag}</small> : null}
      <b>{count}</b>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Omonimi
// ---------------------------------------------------------------------------

// Stesso nome e stessa unità: restano richieste separate (nessuna si rifiuta da
// sola, potrebbero essere due persone o due telefoni della stessa persona), ma
// stanno insieme. La più vecchia è aperta; le altre si aprono con un tocco.
function DupGroup({ ctx, group }: { ctx: RnaContext; group: RecordNightStaffRequest[] }) {
  const [first, ...more] = group;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rna-dupgroup">
      <span className="rna-dup">
        <AppIcon name="users" />
        {group.length} richieste con lo stesso nome
      </span>
      <RequestCard ctx={ctx} grouped request={first} />
      {more.map((request) => {
        const isOpen = expanded.has(request.id);
        const date = formatShortDateTime(request.createdAt);
        return (
          <Fragment key={request.id}>
            <button
              aria-expanded={isOpen}
              className="rna-dupmore"
              onClick={() => toggle(request.id)}
              type="button"
            >
              <span>
                {describeRequest(request)}
                {date ? <small>{date}</small> : null}
              </span>
              <AppIcon name="arrow-right" />
            </button>
            {isOpen ? <RequestCard ctx={ctx} grouped request={request} /> : null}
          </Fragment>
        );
      })}
    </div>
  );
}
