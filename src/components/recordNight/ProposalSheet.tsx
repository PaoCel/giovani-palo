import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import type { RecordNightEntry, RecordNightMeasure, RecordNightRecord } from "@/types";
import { getJoinedLabel } from "@/components/recordNight/MyRecords";
import { MEASURE_ICONS, RecordNightIcon } from "@/components/recordNight/RecordNightIcon";
import type { RecordNightProposalInput } from "@/services/firestore/recordNightService";
import {
  RECORD_NIGHT_DURATION_RANGE,
  RECORD_NIGHT_LIMITS,
  RECORD_NIGHT_MAX_ENTRIES,
  RECORD_NIGHT_MEASURES,
  findSimilarRecords,
  getRecordNightMeasureShortLabel,
  measureNeedsDuration,
} from "@/utils/recordNight";

const DURATION_STEP = 5;

interface ProposalSheetProps {
  // Assente = nuova proposta; presente = "Modifica la proposta" (solo pending).
  entry?: RecordNightEntry | null;
  // Posto che occuperà la proposta nuova ("il tuo record 1 di 2").
  slotNumber: number;
  // Record aperti e visibili, per "Forse esiste già".
  records: RecordNightRecord[];
  joinedRecordIds: ReadonlySet<string>;
  // null = chi guarda; il nome = un figlio scelto dal genitore.
  personName: string | null;
  onClose: () => void;
  // Rifiutano con l'errore della callable: il foglio lo mostra e resta aperto.
  onSubmit: (input: RecordNightProposalInput) => Promise<void>;
  onChallenge: (record: RecordNightRecord) => Promise<void>;
  getErrorMessage: (error: unknown) => string;
}

// Riga unica: niente a capo nel testo (il server li collassa comunque).
function oneLine(value: string) {
  return value.replace(/[\r\n]+/g, " ");
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ProposalSheet({
  entry,
  slotNumber,
  records,
  joinedRecordIds,
  personName,
  onClose,
  onSubmit,
  onChallenge,
  getErrorMessage,
}: ProposalSheetProps) {
  const editing = Boolean(entry);
  const [text, setText] = useState(entry?.proposedText ?? "");
  const [measure, setMeasure] = useState<RecordNightMeasure | null>(entry?.proposedMeasure ?? null);
  const [duration, setDuration] = useState<number>(
    entry?.proposedDurationSeconds ?? RECORD_NIGHT_DURATION_RANGE.max,
  );
  const [needs, setNeeds] = useState(entry?.proposedNeeds ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ text?: string; measure?: string }>({});
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const busyRef = useRef(false);
  const ids = useId();
  const titleId = `${ids}-title`;
  const textId = `${ids}-text`;
  const textHelpId = `${ids}-text-help`;
  const textCountId = `${ids}-text-count`;
  const textErrorId = `${ids}-text-error`;
  const measureErrorId = `${ids}-measure-error`;
  const durationId = `${ids}-duration`;
  const needsId = `${ids}-needs`;

  // Proposte simili solo per una proposta nuova: in modifica la sfida a un
  // altro record occuperebbe un posto in più.
  const similar = useMemo(
    () => (editing ? [] : findSimilarRecords(text, records, { limit: 2 })),
    [editing, records, text],
  );

  // Focus nel foglio all'apertura, blocco dello scroll della pagina sotto e
  // ritorno del focus a chi l'ha aperto alla chiusura.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    textRef.current?.focus();

    return () => {
      document.body.style.overflow = overflow;
      if (opener && opener.isConnected && !opener.hasAttribute("disabled")) {
        opener.focus();
      } else {
        document.getElementById("rn-mine-title")?.focus();
      }
    };
  }, []);

  function requestClose() {
    if (!busyRef.current) onClose();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== "Tab" || !sheetRef.current) return;
    const focusable = Array.from(
      sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((element) => element.offsetParent !== null || element === document.activeElement);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      busyRef.current = false;
      setBusy(false);
      return;
    }
    busyRef.current = false;
    // Il genitore chiude il foglio dopo l'esito positivo.
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanText = text.replace(/\s+/g, " ").trim();
    const nextFieldError: { text?: string; measure?: string } = {};
    if (!cleanText) nextFieldError.text = "Scrivi cosa fai.";
    if (!measure) nextFieldError.measure = "Scegli come si misura.";
    setFieldError(nextFieldError);
    if (nextFieldError.text) {
      textRef.current?.focus();
      return;
    }
    if (nextFieldError.measure || !measure) {
      sheetRef.current?.querySelector<HTMLInputElement>('input[name="rn-measure"]')?.focus();
      return;
    }
    void run(() =>
      onSubmit({
        text: cleanText,
        measure,
        durationSeconds: measureNeedsDuration(measure) ? duration : null,
        needs: needs.replace(/\s+/g, " ").trim(),
      }),
    );
  }

  const textLength = text.length;

  const sheet = (
    <div
      className="rn-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="rn-sheet"
        onKeyDown={handleKeyDown}
        ref={sheetRef}
        role="dialog"
      >
        <form className="rn-sheet__form" noValidate onSubmit={handleSubmit}>
          <header className="rn-sheet__head">
            <span aria-hidden="true" className="rn-sheet__grabber" />
            <div className="rn-sheet__titles">
              <h2 className="rn-sheet__title" id={titleId}>
                {editing ? "Modifica la proposta" : "Proponi un record"}
              </h2>
              {!editing ? (
                <p className="rn-sheet__sub">
                  {personName
                    ? `Questo sarà il record ${slotNumber} di ${RECORD_NIGHT_MAX_ENTRIES} per ${personName}.`
                    : `Questo sarà il tuo record ${slotNumber} di ${RECORD_NIGHT_MAX_ENTRIES}.`}
                </p>
              ) : null}
            </div>
            <button
              aria-label="Chiudi"
              className="rn-icon-btn"
              disabled={busy}
              onClick={requestClose}
              type="button"
            >
              <RecordNightIcon name="x" />
            </button>
          </header>

          <div className="rn-sheet__body">
            <div className="rn-field">
              <div className="rn-field__row">
                <label className="rn-label" htmlFor={textId}>
                  {personName ? `Cosa fa ${personName}?` : "Cosa fai?"}
                </label>
                <span aria-hidden="true" className="rn-count" id={textCountId}>
                  {textLength}/{RECORD_NIGHT_LIMITS.text}
                </span>
              </div>
              <textarea
                aria-describedby={[textHelpId, fieldError.text ? textErrorId : ""]
                  .filter(Boolean)
                  .join(" ")}
                aria-invalid={fieldError.text ? true : undefined}
                className="rn-input rn-input--area"
                id={textId}
                maxLength={RECORD_NIGHT_LIMITS.text}
                onChange={(event) => {
                  setText(oneLine(event.target.value));
                  if (fieldError.text) setFieldError((current) => ({ ...current, text: undefined }));
                }}
                ref={textRef}
                rows={3}
                value={text}
              />
              <p className="rn-help" id={textHelpId}>
                Scrivila come la diresti a voce.
              </p>
              {fieldError.text ? (
                <p className="rn-field-error" id={textErrorId}>
                  {fieldError.text}
                </p>
              ) : null}
            </div>

            <div aria-live="polite">
              {similar.length > 0 ? (
                <div className="rn-similar">
                  <p className="rn-similar__title">
                    <RecordNightIcon name="alert" />
                    Forse esiste già
                  </p>
                  <p className="rn-similar__text">
                    Se è la stessa prova, sfida quel record invece di proporne uno nuovo.
                  </p>
                  <ul className="rn-similar__list">
                    {similar.map(({ record }) => (
                      <li className={`rn-similar__item rn-cat--${record.category}`} key={record.id}>
                        <span className="rn-similar__body">
                          <span className="rn-rec__measure">
                            {getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}
                          </span>
                          <strong>{record.title}</strong>
                        </span>
                        {joinedRecordIds.has(record.id) ? (
                          <span className="rn-pill-in rn-pill-in--sm">
                            <RecordNightIcon name="check" />
                            {getJoinedLabel(personName)}
                          </span>
                        ) : (
                          <button
                            className="rn-btn rn-btn--sm"
                            disabled={busy}
                            onClick={() => void run(() => onChallenge(record))}
                            type="button"
                          >
                            È questo: sfidalo
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <fieldset
              aria-describedby={fieldError.measure ? measureErrorId : undefined}
              className="rn-field rn-fieldset"
            >
              <legend className="rn-label">Come si misura?</legend>
              <div className="rn-tiles">
                {RECORD_NIGHT_MEASURES.map((option) => (
                  <label
                    className={measure === option.value ? "rn-tile rn-tile--on" : "rn-tile"}
                    key={option.value}
                  >
                    <input
                      checked={measure === option.value}
                      className="rn-tile__input"
                      name="rn-measure"
                      onChange={() => {
                        setMeasure(option.value);
                        if (fieldError.measure) {
                          setFieldError((current) => ({ ...current, measure: undefined }));
                        }
                      }}
                      type="radio"
                      value={option.value}
                    />
                    <RecordNightIcon name={MEASURE_ICONS[option.value]} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              {fieldError.measure ? (
                <p className="rn-field-error" id={measureErrorId}>
                  {fieldError.measure}
                </p>
              ) : null}
            </fieldset>

            {measure && measureNeedsDuration(measure) ? (
              <div className="rn-field">
                <span className="rn-label" id={durationId}>
                  Quanti secondi?
                </span>
                <div aria-labelledby={durationId} className="rn-stepper" role="group">
                  <button
                    aria-label={`Meno ${DURATION_STEP} secondi`}
                    className="rn-stepper__btn"
                    disabled={busy || duration <= RECORD_NIGHT_DURATION_RANGE.min}
                    onClick={() =>
                      setDuration((current) =>
                        Math.max(RECORD_NIGHT_DURATION_RANGE.min, current - DURATION_STEP),
                      )
                    }
                    type="button"
                  >
                    <svg aria-hidden="true" className="rn-ico" viewBox="0 0 24 24">
                      <path d="M5.25 12h13.5" />
                    </svg>
                  </button>
                  <output aria-live="polite" className="rn-stepper__value">
                    <span className="rn-flap rn-flap--step">
                      <span>{duration}</span>
                    </span>
                    <span className="rn-stepper__unit">secondi</span>
                  </output>
                  <button
                    aria-label={`Più ${DURATION_STEP} secondi`}
                    className="rn-stepper__btn"
                    disabled={busy || duration >= RECORD_NIGHT_DURATION_RANGE.max}
                    onClick={() =>
                      setDuration((current) =>
                        Math.min(RECORD_NIGHT_DURATION_RANGE.max, current + DURATION_STEP),
                      )
                    }
                    type="button"
                  >
                    <RecordNightIcon name="plus" />
                  </button>
                </div>
                <p className="rn-help">Da 10 a 60. Una prova dura al massimo un minuto.</p>
              </div>
            ) : null}

            <div className="rn-field">
              <div className="rn-field__row">
                <label className="rn-label" htmlFor={needsId}>
                  Serve qualcosa?
                </label>
                <span className="rn-optional">Facoltativo</span>
              </div>
              <input
                autoComplete="off"
                className="rn-input"
                id={needsId}
                maxLength={RECORD_NIGHT_LIMITS.needs}
                onChange={(event) => setNeeds(event.target.value)}
                placeholder="Per esempio: una sedia, un cronometro"
                type="text"
                value={needs}
              />
            </div>
          </div>

          <footer className="rn-sheet__foot">
            {error ? (
              <p className="rn-form-error" role="alert">
                <RecordNightIcon name="alert" />
                <span>{error}</span>
              </p>
            ) : null}
            <div className="rn-sheet__buttons">
              <button
                className="rn-btn rn-btn--ghost"
                disabled={busy}
                onClick={requestClose}
                type="button"
              >
                Annulla
              </button>
              <button aria-busy={busy || undefined} className="rn-btn rn-btn--led" disabled={busy} type="submit">
                {editing ? "Salva" : "Invia proposta"}
              </button>
            </div>
            <p className="rn-sheet__note">Un adulto la controlla prima che compaia nell'elenco.</p>
          </footer>
        </form>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
