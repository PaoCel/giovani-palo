import { MiniScore } from "@/components/recordNight/MyRecords";
import { CATEGORY_ICONS, RecordNightIcon } from "@/components/recordNight/RecordNightIcon";
import type { RecordNightPublicRecord } from "@/types";
import { getRecordNightMeasureShortLabel } from "@/utils/recordNight";
import { groupPublicRecordsByCategory } from "@/utils/recordNightGuest";

interface GuestOpenRecordsProps {
  // Quello che scrive lo staff: titolo, categoria, come si misura. Mai numeri,
  // note o nomi (D1 della spec).
  records: ReadonlyArray<RecordNightPublicRecord>;
  // false dopo la chiusura: sola lettura, niente "Sfida".
  canAct: boolean;
  busy: boolean;
  // Il tasto premuto: il foglio gli restituisce il focus alla chiusura.
  onChallenge: (record: RecordNightPublicRecord, trigger: HTMLElement) => void;
}

// Elenco dei record aperti per chi non ha un account: sola lettura, con "Sfida"
// che apre il foglio "Senza account".
export function GuestOpenRecords({ records, canAct, busy, onChallenge }: GuestOpenRecordsProps) {
  const groups = groupPublicRecordsByCategory(records);

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
      <p className="rn-sub">
        {canAct ? "Scegli un record e tocca Sfida per segnarti." : "Le iscrizioni ai record sono chiuse."}
      </p>

      {groups.length === 0 ? (
        <div className="rn-empty">
          <span aria-hidden="true" className="rn-open-dash rn-open-dash--empty">
            <i />
            <i />
          </span>
          <p>
            {canAct
              ? "Ancora nessun record. Inizia tu: proponi il primo."
              : "Nessun record in gara."}
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
              {group.records.map((record) => (
                <article className="rn-rec rn-rec--read" key={record.id}>
                  <div aria-hidden="true" className="rn-rec__score rn-rec__score--glyph">
                    <RecordNightIcon name={CATEGORY_ICONS[record.category]} />
                  </div>
                  <div className="rn-rec__body">
                    <span className="rn-rec__measure">
                      {getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}
                    </span>
                    <h4 className="rn-rec__title">{record.title}</h4>
                    {canAct ? (
                      <div className="rn-rec__action">
                        <button
                          aria-label={`Sfida: ${record.title}`}
                          className="rn-btn-sfida"
                          disabled={busy}
                          onClick={(event) => onChallenge(record, event.currentTarget)}
                          type="button"
                        >
                          <RecordNightIcon name="plus" />
                          Sfida
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
