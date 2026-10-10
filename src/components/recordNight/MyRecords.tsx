import type { ReactNode } from "react";

import type { RecordNightEntry, RecordNightRecord } from "@/types";
import {
  CATEGORY_ICONS,
  MEASURE_ICONS,
  RecordNightIcon,
} from "@/components/recordNight/RecordNightIcon";
import {
  RECORD_NIGHT_MAX_ENTRIES,
  getRecordChallengerLabel,
  getRecordNightCategoryLabel,
  getRecordNightMeasureShortLabel,
} from "@/utils/recordNight";

// Testo con cui un tentativo si riconosce negli avvisi ("Ritiro fatto: ..."):
// il titolo ufficiale del record se c'è, altrimenti le parole del ragazzo.
export function getEntryLabel(
  entry: RecordNightEntry,
  recordsById: ReadonlyMap<string, RecordNightRecord>,
) {
  const record = entry.recordId ? recordsById.get(entry.recordId) : undefined;
  return record?.title || entry.proposedText || "Un record";
}

const STATUS_ORDER: Record<RecordNightEntry["status"], number> = {
  approved: 0,
  pending: 1,
  rejected: 2,
  withdrawn: 3,
};

export function MiniScore({ value, of }: { value: number; of?: number }) {
  return (
    <span className="rn-mini-score">
      <span className="rn-mini-flap">{value}</span>
      {of !== undefined ? (
        <>
          di<span className="rn-mini-flap">{of}</span>
        </>
      ) : (
        "record"
      )}
    </span>
  );
}

// Blocco del punteggio: "Record da stabilire" con un solo iscritto (palette
// vuote), altrimenti la cifra degli sfidanti. Il testo per gli screen reader
// è la stessa etichetta dell'elenco.
export function ChallengerScore({
  count,
  variant,
}: {
  count: number;
  variant: "mine" | "list";
}) {
  const label = getRecordChallengerLabel(Math.max(count, 1));
  const open = count < 2;

  if (variant === "list") {
    return (
      <div className={open ? "rn-rec__score rn-rec__score--open" : "rn-rec__score"}>
        <span className="sr-only">{label}</span>
        {open ? (
          <>
            <span aria-hidden="true" className="rn-open-dash">
              <i />
              <i />
            </span>
            <span aria-hidden="true">Record da stabilire</span>
          </>
        ) : (
          <>
            <small aria-hidden="true">Sfida</small>
            <b aria-hidden="true">{count}</b>
            <span aria-hidden="true">sfidanti</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rn-score">
      <span className="sr-only">{label}</span>
      {open ? (
        <span aria-hidden="true" className="rn-open-dash rn-open-dash--mine">
          <i />
          <i />
        </span>
      ) : (
        <span aria-hidden="true" className="rn-flap rn-flap--score">
          <span>{count}</span>
        </span>
      )}
      <span aria-hidden="true" className="rn-score__lbl">
        <small>{open ? "Record" : "Sfida"}</small>
        <span>{open ? "da stabilire" : "sfidanti"}</span>
      </span>
    </div>
  );
}

// "Ci sei" per chi guarda, "C'è Marco" per un figlio.
export function getJoinedLabel(personName: string | null) {
  return personName ? `C'è ${personName}` : "Ci sei";
}

// Avviso del limite di 2: stessa frase del server, giusta sia per il ragazzo
// sia per il genitore che agisce per un figlio.
export const RECORD_NIGHT_LIMIT_NOTICE =
  "Limite di 2 record raggiunto: ritirane uno per sceglierne un altro.";

// Un tentativo approvato conta su un record aperto che si legge ancora; se il
// record è sparito o nascosto la card dice "Tolto dall'elenco".
function openRecordOf(
  entry: RecordNightEntry,
  recordsById: ReadonlyMap<string, RecordNightRecord>,
) {
  const record = entry.recordId ? recordsById.get(entry.recordId) : undefined;
  return record && record.status === "open" ? record : undefined;
}

type WithdrawnRow =
  | { entry: RecordNightEntry; kind: "restore" }
  | { entry: RecordNightEntry; kind: "staff" }
  | { entry: RecordNightEntry; kind: "gone" };

// Ritirati: Ripristina solo per un ritiro fatto da sé, con lo stato di prima e
// (se era approvato) il record ancora in elenco. Un ritiro di un adulto o
// d'ufficio non si annulla da qui. `withdrawnBy` assente (tentativi scritti
// prima del campo): con lo stato di prima è un ritiro proprio.
function getWithdrawnRows(
  entries: RecordNightEntry[],
  recordsById: ReadonlyMap<string, RecordNightRecord>,
): WithdrawnRow[] {
  const rows: WithdrawnRow[] = [];
  for (const entry of entries) {
    if (entry.status !== "withdrawn") continue;
    const by = entry.withdrawnBy ?? (entry.statusBeforeWithdraw ? "self" : "system");
    if (by !== "self") {
      rows.push({ entry, kind: "staff" });
    } else if (entry.statusBeforeWithdraw === "approved" && !openRecordOf(entry, recordsById)) {
      rows.push({ entry, kind: "gone" });
    } else if (entry.statusBeforeWithdraw) {
      rows.push({ entry, kind: "restore" });
    }
  }
  return rows.sort((left, right) => right.entry.updatedAt.localeCompare(left.entry.updatedAt));
}

interface MyRecordsProps {
  // Tentativi della sola persona scelta.
  entries: RecordNightEntry[];
  recordsById: ReadonlyMap<string, RecordNightRecord>;
  activeCount: number;
  // null = chi guarda; il nome = un figlio scelto dal genitore.
  personName: string | null;
  // Selettore "Per chi?" (solo con più persone).
  picker?: ReactNode;
  // Persona valida e finestra aperta: si può agire.
  canAct: boolean;
  closed: boolean;
  busy: boolean;
  onPropose: () => void;
  onEdit: (entry: RecordNightEntry) => void;
  onWithdraw: (entry: RecordNightEntry) => void;
  onRestore: (entry: RecordNightEntry) => void;
}

export function MyRecords({
  entries,
  recordsById,
  activeCount,
  personName,
  picker,
  canAct,
  closed,
  busy,
  onPropose,
  onEdit,
  onWithdraw,
  onRestore,
}: MyRecordsProps) {
  const canAdd = canAct && activeCount < RECORD_NIGHT_MAX_ENTRIES;
  const visible = entries
    .filter((entry) => entry.status !== "withdrawn")
    .sort(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        left.createdAt.localeCompare(right.createdAt),
    );
  // Dopo la chiusura i ritirati non si mostrano più (spec: "niente").
  const withdrawn = canAct ? getWithdrawnRows(entries, recordsById) : [];
  const emptyText = closed
    ? personName
      ? `${personName} non ha record in gara.`
      : "Non hai record in gara."
    : personName
      ? `${personName} non ne ha ancora: proponi un record o sfidane uno qui sotto.`
      : "Non ne hai ancora: proponi un record o sfidane uno qui sotto.";

  return (
    <section aria-labelledby="rn-mine-title" className="rn-section">
      {picker}
      <div className="rn-section__head">
        <h2 className="rn-h2" id="rn-mine-title" tabIndex={-1}>
          {personName ? `I record di ${personName}` : "I tuoi record"}
        </h2>
        <span className="sr-only">
          {activeCount} di {RECORD_NIGHT_MAX_ENTRIES}
        </span>
        <span aria-hidden="true">
          <MiniScore of={RECORD_NIGHT_MAX_ENTRIES} value={activeCount} />
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="rn-sub">{emptyText}</p>
      ) : (
        <div className="rn-mine-list">
          {visible.map((entry) => {
            if (entry.status === "approved") {
              const record = openRecordOf(entry, recordsById);
              return record ? (
                <ApprovedCard
                  busy={busy}
                  canAct={canAct}
                  entry={entry}
                  key={entry.id}
                  onWithdraw={onWithdraw}
                  personName={personName}
                  record={record}
                />
              ) : (
                <GoneCard entry={entry} key={entry.id} />
              );
            }
            if (entry.status === "pending") {
              return (
                <PendingCard
                  busy={busy}
                  canAct={canAct}
                  closed={closed}
                  entry={entry}
                  key={entry.id}
                  onEdit={onEdit}
                  onWithdraw={onWithdraw}
                />
              );
            }
            return (
              <RejectedCard
                busy={busy}
                canAdd={canAdd}
                entry={entry}
                key={entry.id}
                onPropose={onPropose}
                personName={personName}
              />
            );
          })}
        </div>
      )}

      {canAct ? (
        canAdd ? (
          <button className="rn-propose" disabled={busy} onClick={onPropose} type="button">
            <RecordNightIcon name="plus" />
            Proponi un record
            <span className="rn-propose__count">
              <RecordNightIcon name="arrow" />
            </span>
          </button>
        ) : (
          <button
            aria-describedby="rn-limit-notice"
            className="rn-propose rn-propose--locked"
            disabled
            type="button"
          >
            <RecordNightIcon name="lock" />
            Proponi un record
            <span className="rn-propose__count">
              {activeCount} di {RECORD_NIGHT_MAX_ENTRIES}
            </span>
          </button>
        )
      ) : null}

      {withdrawn.length > 0 ? (
        <div className="rn-withdrawn">
          <h3 className="rn-h3">Ritirati</h3>
          <ul>
            {withdrawn.map(({ entry, kind }) => (
              <li className="rn-withdrawn__row" key={entry.id}>
                <span className="rn-withdrawn__label">{getEntryLabel(entry, recordsById)}</span>
                {kind === "restore" ? (
                  <button
                    className="rn-btn rn-btn--sm"
                    disabled={busy}
                    onClick={() => onRestore(entry)}
                    type="button"
                  >
                    <RecordNightIcon name="undo" />
                    Ripristina
                  </button>
                ) : (
                  <span className="rn-withdrawn__state">
                    {kind === "staff" ? "Tolto da un adulto" : "Il record non è più in elenco"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ApprovedCard({
  entry,
  record,
  personName,
  canAct,
  busy,
  onWithdraw,
}: {
  entry: RecordNightEntry;
  record: RecordNightRecord;
  personName: string | null;
  canAct: boolean;
  busy: boolean;
  onWithdraw: (entry: RecordNightEntry) => void;
}) {
  return (
    <article className={`rn-mine rn-mine--in rn-cat--${record.category}`}>
      <div className="rn-mine__top">
        <span className="rn-tag">
          <RecordNightIcon name={CATEGORY_ICONS[record.category]} />
          {getRecordNightCategoryLabel(record.category)} ·{" "}
          {getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}
        </span>
        <span className="rn-stamp">
          <RecordNightIcon name="check" />
          {getJoinedLabel(personName)}
        </span>
      </div>
      <h3 className="rn-mine__title">{record.title}</h3>
      {record.notes ? <p className="rn-mine__notes">{record.notes}</p> : null}
      <div className="rn-mine__bottom">
        <ChallengerScore count={record.challengerCount} variant="mine" />
        {canAct ? (
          <button
            className="rn-btn"
            disabled={busy}
            onClick={() => onWithdraw(entry)}
            type="button"
          >
            <RecordNightIcon name="out" />
            {personName ? "Ritira" : "Ritirati"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

// Tentativo approvato su un record che non si legge più (nascosto o tolto
// mentre la pagina era aperta): niente azioni, ne risponde un adulto.
function GoneCard({ entry }: { entry: RecordNightEntry }) {
  return (
    <article className="rn-mine rn-mine--no rn-mine--gone">
      <span className="rn-wait-label">
        <i aria-hidden="true" className="rn-led rn-led--off" />
        Tolto dall'elenco
      </span>
      {entry.proposedText ? (
        <p className="rn-quote rn-quote--muted">{entry.proposedText}</p>
      ) : (
        <p className="rn-private">Questo record non è più in elenco.</p>
      )}
    </article>
  );
}

function ProposalPills({ entry }: { entry: RecordNightEntry }) {
  const measure = entry.proposedMeasure ?? "other";
  return (
    <div className="rn-pills">
      <span className="rn-pill">
        <RecordNightIcon name={MEASURE_ICONS[measure]} />
        {getRecordNightMeasureShortLabel(measure, entry.proposedDurationSeconds)}
      </span>
      {entry.proposedNeeds ? (
        <span className="rn-pill">
          <RecordNightIcon name="bag" />
          Serve: {entry.proposedNeeds}
        </span>
      ) : null}
    </div>
  );
}

function PendingCard({
  entry,
  canAct,
  closed,
  busy,
  onEdit,
  onWithdraw,
}: {
  entry: RecordNightEntry;
  canAct: boolean;
  closed: boolean;
  busy: boolean;
  onEdit: (entry: RecordNightEntry) => void;
  onWithdraw: (entry: RecordNightEntry) => void;
}) {
  return (
    <article className={closed ? "rn-mine rn-mine--wait rn-mine--late" : "rn-mine rn-mine--wait"}>
      <span className="rn-wait-label">
        <i aria-hidden="true" className={closed ? "rn-led rn-led--off" : "rn-led"} />
        {closed ? "Non controllata in tempo" : "In attesa di approvazione"}
      </span>
      <p className="rn-quote">{entry.proposedText}</p>
      <ProposalPills entry={entry} />
      <p className="rn-private">
        <RecordNightIcon name={closed ? "clock" : "eye-off"} />
        {closed
          ? "Un adulto non l'ha controllata prima della chiusura."
          : "Per ora la vedi solo tu."}
      </p>
      {canAct ? (
        <div className="rn-actions">
          <button className="rn-btn" disabled={busy} onClick={() => onEdit(entry)} type="button">
            <RecordNightIcon name="pencil" />
            Modifica
          </button>
          <button
            className="rn-btn"
            disabled={busy}
            onClick={() => onWithdraw(entry)}
            type="button"
          >
            <RecordNightIcon name="x" />
            Ritira
          </button>
        </div>
      ) : null}
    </article>
  );
}

function RejectedCard({
  entry,
  personName,
  canAdd,
  busy,
  onPropose,
}: {
  entry: RecordNightEntry;
  personName: string | null;
  canAdd: boolean;
  busy: boolean;
  onPropose: () => void;
}) {
  return (
    <article className="rn-mine rn-mine--no">
      <span className="rn-no-label">
        <RecordNightIcon name="x" />
        Non accettata
      </span>
      {entry.proposedText ? <p className="rn-quote rn-quote--muted">{entry.proposedText}</p> : null}
      {entry.rejectionReason ? (
        <div className="rn-reason">
          <span className="rn-reason__lbl">Il motivo</span>
          <p>{entry.rejectionReason}</p>
        </div>
      ) : null}
      {canAdd ? (
        <div className="rn-actions">
          <button className="rn-btn" disabled={busy} onClick={onPropose} type="button">
            <RecordNightIcon name="plus" />
            Proponi un altro record
          </button>
        </div>
      ) : null}
      <p className="rn-note">
        {personName ? `Non conta nei 2 record di ${personName}.` : "Non conta nei tuoi 2 record."}
      </p>
    </article>
  );
}
