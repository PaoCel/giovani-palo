import type { RecordNightRecord } from "@/types";
import { formatRecordNightResult } from "@/utils/recordNightResults";

export function RecordNightResults({ records }: { records: RecordNightRecord[] }) {
  return (
    <section aria-labelledby="rn-results-title" className="rn-section">
      <h2 className="rn-h2" id="rn-results-title">Albo dei record</h2>
      <p className="rn-sub">Le prove disputate e chi le ha vinte.</p>
      <div className="rn-results">
        {records.map((record) => record.result ? (
          <article className="rn-result" key={record.id}>
            <span className="rn-result__label">Record della serata</span>
            <h3 className="rn-result__title">{record.title}</h3>
            <p className="rn-result__value">{formatRecordNightResult(record.result.value, record.measure)}</p>
            <p className="rn-result__winner">{record.result.winnerName}</p>
          </article>
        ) : null)}
      </div>
    </section>
  );
}
