import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import "@/styles/recordCertificate.css";

import { AppIcon } from "@/components/AppIcon";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { eventsService } from "@/services/firestore/eventsService";
import { recordNightService } from "@/services/firestore/recordNightService";
import type { Event, RecordNightEntry, RecordNightRecord } from "@/types";
import { getRecordNightPath } from "@/utils/activityLinks";
import {
  formatCertificateDate,
  getCertificateUnit,
  getCertificateValuePlaceholder,
  getRecordChallengerNames,
  pickCertificateEvent,
  sortRecordsByTitle,
  splitCertificateTiles,
  todayIsoDate,
} from "@/utils/recordCertificate";
import { getRecordNightMeasureShortLabel } from "@/utils/recordNight";
import { resolvePublicStakeId } from "@/utils/stakeSelection";

interface CertificateData {
  stakeId: string;
  event: Event | null;
  records: RecordNightRecord[];
  // false = elenco dei record non leggibile (senza login o fuori dal palo).
  recordsAvailable: boolean;
  // Tentativi con i nomi: li legge solo lo staff, per gli altri resta vuoto.
  entries: RecordNightEntry[];
}

const OTHER_RECORD = "__other__";
// A4 orizzontale a 96 dpi: la stessa misura del foglio in CSS (297mm).
const SHEET_WIDTH_PX = (297 / 25.4) * 96;

// Il foglio si stampa sempre in A4 orizzontale senza margini; la regola vive
// solo finché la pagina è aperta, così non cambia la stampa del resto del sito.
function usePrintSetup() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const style = document.createElement("style");
    style.dataset.recordCertificate = "true";
    style.textContent = "@page { size: A4 landscape; margin: 0; }";
    document.head.appendChild(style);
    root.classList.add("rc-skin");

    return () => {
      style.remove();
      root.classList.remove("rc-skin");
    };
  }, []);
}

function useSheetScale() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.5);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setScale(Math.min(1, frame.clientWidth / SHEET_WIDTH_PX));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return { frameRef, scale };
}

function PrintIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24">
      <path d="M6.75 9V3.75h10.5V9" />
      <path d="M6.75 17.25h-1.5a1.5 1.5 0 0 1-1.5-1.5v-5.25a1.5 1.5 0 0 1 1.5-1.5h13.5a1.5 1.5 0 0 1 1.5 1.5v5.25a1.5 1.5 0 0 1-1.5 1.5h-1.5" />
      <path d="M6.75 14.25h10.5v6H6.75z" />
    </svg>
  );
}

// Sigillo a soli tratti: in bianco e nero resta leggibile come a colori.
function CertificateSeal({ year }: { year: string }) {
  return (
    <svg aria-hidden="true" className="rc-seal" viewBox="0 0 120 120">
      <defs>
        {/* Arco alto da sinistra a destra, arco basso percorso in senso
            antiorario: entrambe le scritte si leggono dritte. */}
        <path d="M18 60 A42 42 0 0 1 102 60" id="rc-seal-top" />
        <path d="M11 60 A49 49 0 0 0 109 60" id="rc-seal-bottom" />
      </defs>
      <circle className="rc-seal__outer" cx="60" cy="60" r="56" />
      <circle className="rc-seal__dash" cx="60" cy="60" r="51.5" />
      <circle className="rc-seal__inner" cx="60" cy="60" r="33" />
      <text className="rc-seal__text" textAnchor="middle">
        <textPath href="#rc-seal-top" startOffset="50%">
          NOTTE DEI RECORD
        </textPath>
      </text>
      <text className="rc-seal__text" textAnchor="middle">
        <textPath href="#rc-seal-bottom" startOffset="50%">
          {`· ${year} ·`}
        </textPath>
      </text>
      <path
        className="rc-seal__star"
        d="M60 39.5l5.6 12.2 13.3 1.5-9.9 9 2.8 13.1L60 68.6l-11.8 6.7 2.8-13.1-9.9-9 13.3-1.5z"
      />
    </svg>
  );
}

interface CertificateSheetProps {
  name: string;
  unitName: string;
  recordTitle: string;
  value: string;
  measure: string;
  previous: string;
  dateLabel: string;
  eventTitle: string;
  year: string;
}

function CertificateSheet({
  name,
  unitName,
  recordTitle,
  value,
  measure,
  previous,
  dateLabel,
  eventTitle,
  year,
}: CertificateSheetProps) {
  const tiles = splitCertificateTiles(value);
  const hasPrevious = previous.trim().length > 0;
  const nameClass =
    name.length > 34 ? "rc-sheet__name rc-sheet__name--xs" : name.length > 24 ? "rc-sheet__name rc-sheet__name--sm" : "rc-sheet__name";
  const titleClass = recordTitle.length > 48 ? "rc-sheet__record rc-sheet__record--sm" : "rc-sheet__record";

  return (
    <article className="rc-sheet" aria-label="Anteprima del certificato">
      <div className="rc-sheet__frame" aria-hidden="true">
        <span className="rc-corner rc-corner--tl" />
        <span className="rc-corner rc-corner--tr" />
        <span className="rc-corner rc-corner--bl" />
        <span className="rc-corner rc-corner--br" />
      </div>

      <header className="rc-sheet__head">
        <img alt="" className="rc-sheet__logo" src="/brand-logo.png" />
        <p className="rc-sheet__eyebrow">Notte dei Record</p>
        <h2 className="rc-sheet__title">Nuovo record</h2>
      </header>

      <div className="rc-sheet__body">
        <p className="rc-sheet__lead">Si certifica che</p>
        <p className={name ? nameClass : `${nameClass} rc-empty`}>{name || "Nome e cognome"}</p>
        <p className="rc-sheet__unit">{unitName}</p>
        <p className="rc-sheet__lead">{hasPrevious ? "ha superato il record" : "ha stabilito il record"}</p>
        <p className={recordTitle ? titleClass : `${titleClass} rc-empty`}>
          {recordTitle || "Titolo del record"}
        </p>

        <div className="rc-sheet__result">
          {tiles ? (
            <span className="rc-tiles">
              {tiles.map((char, index) => (
                <span className={char === " " ? "rc-tile rc-tile--gap" : "rc-tile"} key={`${index}-${char}`}>
                  {char}
                </span>
              ))}
            </span>
          ) : (
            <span className={value ? "rc-sheet__value" : "rc-sheet__value rc-empty"}>
              {value || "Risultato"}
            </span>
          )}
          {measure ? <span className="rc-sheet__measure">{measure}</span> : null}
        </div>
        {hasPrevious ? (
          <p className="rc-sheet__previous">Record precedente: {previous.trim()}</p>
        ) : null}
      </div>

      <footer className="rc-sheet__foot">
        <div className="rc-sheet__sign">
          <span className="rc-sheet__sign-value">{dateLabel}</span>
          <span className="rc-sheet__sign-label">{eventTitle || "Data"}</span>
        </div>
        <CertificateSeal year={year} />
        <div className="rc-sheet__sign">
          <span className="rc-sheet__sign-line" />
          <span className="rc-sheet__sign-label">Per lo staff</span>
        </div>
      </footer>
    </article>
  );
}

// Certificato da stampare per chi stabilisce un record alla Notte dei Record:
// si sceglie il record, si scrive chi e con quale risultato, si stampa. Nessun
// dato viene salvato: il foglio vive solo nel browser.
export function RecordCertificatePage() {
  usePrintSetup();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { session, loading: authLoading } = useAuth();
  const requestedStakeId = searchParams.get("stake") ?? "";
  const requestedActivityId = searchParams.get("activity") ?? "";
  const profileStakeId = session?.profile.stakeId ?? "";
  const signedIn = Boolean(session?.isAuthenticated && !session.isAnonymous);
  const loginPath = `/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`;

  const { data, loading } = useAsyncData<CertificateData | null>(
    async () => {
      if (authLoading) return null;
      const stakeId = await resolvePublicStakeId(requestedStakeId || profileStakeId || undefined);
      const events = await eventsService.listPublicEvents(stakeId);
      const event =
        events.find((item) => item.id === requestedActivityId && item.recordsEnabled === true) ??
        pickCertificateEvent(events);
      if (!event || !signedIn) {
        return { stakeId, event, records: [], recordsAvailable: false, entries: [] };
      }

      // Senza i permessi giusti le letture falliscono: il modulo resta usabile
      // scrivendo il record a mano, e la pagina lo dice.
      const [records, entries] = await Promise.all([
        recordNightService.listRecords(stakeId, event.id).catch(() => null),
        recordNightService.listAllEntries(stakeId, event.id).catch(() => [] as RecordNightEntry[]),
      ]);
      return {
        stakeId,
        event,
        records: records ? sortRecordsByTitle(records) : [],
        recordsAvailable: records !== null,
        entries,
      };
    },
    [requestedStakeId, requestedActivityId, profileStakeId, authLoading, signedIn],
    null,
  );

  const records = useMemo(() => data?.records ?? [], [data]);
  const [recordChoice, setRecordChoice] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [value, setValue] = useState("");
  const [measure, setMeasure] = useState("");
  const [measureTouched, setMeasureTouched] = useState(false);
  const [name, setName] = useState("");
  const [unitName, setUnitName] = useState("");
  const [previous, setPrevious] = useState("");
  const [date, setDate] = useState(() => todayIsoDate());
  const [eventTitle, setEventTitle] = useState("");
  const [eventTitleTouched, setEventTitleTouched] = useState(false);

  const selectedRecord = records.find((record) => record.id === recordChoice) ?? null;
  const usesCustomTitle = records.length === 0 || recordChoice === OTHER_RECORD;
  const recordTitle = (usesCustomTitle ? customTitle : selectedRecord?.title ?? "").trim();
  const challengers = selectedRecord
    ? getRecordChallengerNames(data?.entries ?? [], selectedRecord.id)
    : [];
  const canPrint = Boolean(recordTitle && value.trim() && name.trim());

  useEffect(() => {
    if (!eventTitleTouched && data?.event) setEventTitle(data.event.title);
  }, [data, eventTitleTouched]);

  function chooseRecord(choice: string) {
    setRecordChoice(choice);
    const record = records.find((item) => item.id === choice);
    if (!measureTouched) {
      setMeasure(record ? getCertificateUnit(record.measure, record.durationSeconds) : "");
    }
  }

  function startNew() {
    setValue("");
    setName("");
    setUnitName("");
    setPrevious("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function print() {
    // I font del certificato devono essere pronti, altrimenti il primo foglio
    // esce con quelli di sistema.
    await document.fonts?.ready;
    window.print();
  }

  const { frameRef, scale } = useSheetScale();
  const year = date.slice(0, 4) || String(new Date().getFullYear());

  return (
    <div className="rc-page">
      <section className="rc-panel">
        <div className="rc-panel__head">
          {data?.event ? (
            <Link className="rc-back" to={getRecordNightPath(data.event.id, data.stakeId)}>
              <AppIcon name="arrow-left" />
              <span>Notte dei Record</span>
            </Link>
          ) : null}
          <h1>Certificato di record</h1>
          <p>
            Scegli il record, scrivi chi l'ha stabilito e con quale risultato, poi stampa. Il foglio è
            bianco: viene bene anche in bianco e nero.
          </p>
        </div>

        <form
          className="rc-form"
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            if (canPrint) void print();
          }}
        >
          <label className="rc-field">
            <span>Record</span>
            {records.length > 0 ? (
              <select onChange={(change) => chooseRecord(change.target.value)} value={recordChoice}>
                <option disabled value="">
                  Scegli il record
                </option>
                {records.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.title} ({getRecordNightMeasureShortLabel(record.measure, record.durationSeconds).toLowerCase()})
                  </option>
                ))}
                <option value={OTHER_RECORD}>Altro record, lo scrivo io</option>
              </select>
            ) : null}
            {usesCustomTitle ? (
              <input
                maxLength={90}
                onChange={(change) => setCustomTitle(change.target.value)}
                placeholder="es. Piegamenti in 60 secondi"
                value={customTitle}
              />
            ) : null}
          </label>

          {!loading && data && !data.recordsAvailable ? (
            <p className="rc-note">
              {signedIn ? (
                "Elenco dei record non disponibile: scrivi il record a mano."
              ) : (
                <>
                  Per scegliere dall'elenco dei record <Link to={loginPath}>accedi</Link>, oppure scrivilo a
                  mano.
                </>
              )}
            </p>
          ) : null}

          <div className="rc-row">
            <label className="rc-field rc-field--value">
              <span>Risultato</span>
              <input
                inputMode="decimal"
                maxLength={24}
                onChange={(change) => setValue(change.target.value)}
                placeholder={getCertificateValuePlaceholder(selectedRecord?.measure ?? null)}
                value={value}
              />
            </label>
            <label className="rc-field">
              <span>Misura</span>
              <input
                maxLength={30}
                onChange={(change) => {
                  setMeasureTouched(true);
                  setMeasure(change.target.value);
                }}
                placeholder="secondi, metri, di fila..."
                value={measure}
              />
            </label>
          </div>

          <label className="rc-field">
            <span>Chi l'ha stabilito</span>
            <input
              autoComplete="off"
              maxLength={60}
              onChange={(change) => setName(change.target.value)}
              placeholder="Nome e cognome"
              value={name}
            />
          </label>
          {challengers.length > 0 ? (
            <div className="rc-chips" aria-label="Sfidanti iscritti a questo record">
              {challengers.map((challenger) => (
                <button
                  aria-pressed={name === challenger}
                  className="rc-chip"
                  key={challenger}
                  onClick={() => setName(challenger)}
                  type="button"
                >
                  {challenger}
                </button>
              ))}
            </div>
          ) : null}

          <label className="rc-field">
            <span>Unità (facoltativa)</span>
            <input maxLength={50} onChange={(change) => setUnitName(change.target.value)} value={unitName} />
          </label>

          <label className="rc-field">
            <span>Record precedente (facoltativo)</span>
            <input
              maxLength={40}
              onChange={(change) => setPrevious(change.target.value)}
              placeholder="es. 38 secondi"
              value={previous}
            />
          </label>

          <div className="rc-row rc-row--date">
            <label className="rc-field rc-field--date">
              <span>Data</span>
              <input onChange={(change) => setDate(change.target.value)} type="date" value={date} />
            </label>
            <label className="rc-field">
              <span>Evento</span>
              <input
                maxLength={60}
                onChange={(change) => {
                  setEventTitleTouched(true);
                  setEventTitle(change.target.value);
                }}
                value={eventTitle}
              />
            </label>
          </div>

          <div className="rc-actions">
            <button className="rc-btn rc-btn--primary" disabled={!canPrint} type="submit">
              <PrintIcon />
              <span>Stampa</span>
            </button>
            <button className="rc-btn" onClick={startNew} type="button">
              Nuovo certificato
            </button>
          </div>
          {!canPrint ? <p className="rc-hint">Per stampare servono record, risultato e nome.</p> : null}
        </form>
      </section>

      <section className="rc-preview" aria-label="Anteprima">
        <div className="rc-preview__frame" ref={frameRef} style={{ height: `calc(210mm * ${scale})` }}>
          <div className="rc-preview__scale" style={{ transform: `scale(${scale})` }}>
            <CertificateSheet
              dateLabel={formatCertificateDate(date)}
              eventTitle={eventTitle.trim()}
              measure={measure.trim()}
              name={name.trim()}
              previous={previous}
              recordTitle={recordTitle}
              unitName={unitName.trim()}
              value={value.trim()}
              year={year}
            />
          </div>
        </div>
        <p className="rc-hint">
          Foglio A4 orizzontale. Se la stampante taglia i bordi, scegli "Adatta alla pagina".
        </p>
      </section>
    </div>
  );
}

export default RecordCertificatePage;
