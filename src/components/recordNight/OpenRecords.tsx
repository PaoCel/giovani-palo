import type { RecordNightRecord } from "@/types";
import {
  ChallengerScore,
  MiniScore,
  RECORD_NIGHT_LIMIT_NOTICE,
  getJoinedLabel,
} from "@/components/recordNight/MyRecords";
import { CATEGORY_ICONS, RecordNightIcon } from "@/components/recordNight/RecordNightIcon";
import {
  getRecordNightMeasureShortLabel,
  groupRecordsByCategory,
} from "@/utils/recordNight";

interface OpenRecordsProps {
  // Già filtrati: solo `open` con almeno un iscritto.
  records: RecordNightRecord[];
  // Record su cui la persona scelta ha un tentativo approvato ("Ci sei").
  joinedRecordIds: ReadonlySet<string>;
  // null = chi guarda; il nome = un figlio scelto dal genitore.
  personName: string | null;
  // Iscrizione valida e finestra aperta: compaiono i tasti Sfida.
  canAct: boolean;
  atLimit: boolean;
  closed: boolean;
  busy: boolean;
  onChallenge: (record: RecordNightRecord) => void;
}

export function OpenRecords({
  records,
  joinedRecordIds,
  personName,
  canAct,
  atLimit,
  closed,
  busy,
  onChallenge,
}: OpenRecordsProps) {
  const groups = groupRecordsByCategory(records);
  const sfidaLabel = (title: string) =>
    personName ? `Sfida per ${personName}: ${title}` : `Sfida: ${title}`;

  return (
    <section aria-labelledby="rn-open-title" className="rn-section">
      <div className="rn-section__head">
        <h2 className="rn-h2" id="rn-open-title">
          Record aperti
        </h2>
        <span className="sr-only">{records.length} record</span>
        <span aria-hidden="true">
          <MiniScore value={records.length} />
        </span>
      </div>
      <p className="rn-sub">Si vede solo quanti sono gli sfidanti, mai i nomi.</p>

      {canAct && atLimit ? (
        <div className="rn-notice" id="rn-limit-notice">
          <RecordNightIcon name="lock" />
          <span>{RECORD_NIGHT_LIMIT_NOTICE}</span>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="rn-empty">
          <span aria-hidden="true" className="rn-open-dash rn-open-dash--empty">
            <i />
            <i />
          </span>
          <p>
            {closed
              ? "Nessun record in gara."
              : "Ancora nessun record. Inizia tu: proponi il primo."}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div className={`rn-cat rn-cat--${group.category}`} key={group.category}>
            <h3 className="rn-cat__head">
              <span aria-hidden="true" className="rn-cat__ico">
                <RecordNightIcon name={CATEGORY_ICONS[group.category]} />
              </span>
              {group.label}
            </h3>
            <div className="rn-recs">
              {group.records.map((record) => {
                const joined = joinedRecordIds.has(record.id);
                return (
                  <article className={joined ? "rn-rec rn-rec--in" : "rn-rec"} key={record.id}>
                    <ChallengerScore count={record.challengerCount} variant="list" />
                    <div className="rn-rec__body">
                      <span className="rn-rec__measure">
                        {getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}
                      </span>
                      <h4 className="rn-rec__title">{record.title}</h4>
                      {record.notes ? <p className="rn-rec__notes">{record.notes}</p> : null}
                      {joined ? (
                        <div className="rn-rec__action">
                          <span className="rn-pill-in">
                            <RecordNightIcon name="check" />
                            {getJoinedLabel(personName)}
                          </span>
                        </div>
                      ) : canAct ? (
                        <div className="rn-rec__action">
                          {atLimit ? (
                            <button
                              aria-describedby="rn-limit-notice"
                              aria-label={sfidaLabel(record.title)}
                              className="rn-btn-locked"
                              disabled
                              type="button"
                            >
                              <RecordNightIcon name="lock" />
                              Sfida
                            </button>
                          ) : (
                            <button
                              aria-label={sfidaLabel(record.title)}
                              className="rn-btn-sfida"
                              disabled={busy}
                              onClick={() => onChallenge(record)}
                              type="button"
                            >
                              <RecordNightIcon name="plus" />
                              Sfida
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
