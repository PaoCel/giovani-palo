import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import type { GuestActionOutcome } from "@/components/recordNight/hooks";
import { MEASURE_ICONS, RecordNightIcon } from "@/components/recordNight/RecordNightIcon";
import type {
  RecordNightGuestUnit,
  RecordNightMeasure,
  RecordNightPublicRecord,
} from "@/types";
import {
  RECORD_NIGHT_DURATION_RANGE,
  RECORD_NIGHT_LIMITS,
  RECORD_NIGHT_MEASURES,
  getRecordNightCategoryLabel,
  getRecordNightMeasureShortLabel,
  measureNeedsDuration,
} from "@/utils/recordNight";
import {
  GUEST_COPY,
  GUEST_NAME_LIMITS,
  validateGuestDraft,
  type GuestFieldErrors,
  type GuestFieldKey,
  type RecordNightGuestDraft,
  type RecordNightGuestRequestFields,
} from "@/utils/recordNightGuest";

const DURATION_STEP = 5;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Riga unica: niente a capo nel testo (il server li collassa comunque).
function oneLine(value: string) {
  return value.replace(/[\r\n]+/g, " ");
}

// Ordine in cui si cerca il primo campo da correggere.
const FIELD_ORDER: ReadonlyArray<GuestFieldKey> = [
  "firstName",
  "lastName",
  "unitId",
  "text",
  "measure",
  "durationSeconds",
  "needs",
];

interface GuestSheetProps {
  mode: "propose" | "challenge";
  // Solo "challenge": il record sfidato.
  record?: RecordNightPublicRecord | null;
  // Unità attive e record pubblici del contesto: un'unità o un record che non
  // c'è più si segnala subito, senza creare la sessione.
  units: ReadonlyArray<RecordNightGuestUnit>;
  records: ReadonlyArray<RecordNightPublicRecord>;
  loginPath: string;
  // Le iscrizioni si sono chiuse (o l'invio si è spento) a foglio aperto: "Invia
  // richiesta" resta spento e il foglio lo spiega, senza perdere ciò che si è scritto.
  blocked: "closed" | "unavailable" | null;
  // Il tasto che ha aperto il foglio: alla chiusura riprende il focus.
  opener: HTMLElement | null;
  onClose: () => void;
  // Invia e restituisce l'esito (il foglio mostra l'errore e resta aperto; con
  // l'esito positivo è la pagina a chiuderlo).
  onSubmit: (fields: RecordNightGuestRequestFields) => Promise<GuestActionOutcome<unknown>>;
}

// Foglio "Senza account" (proposta e sfida): nome, cognome, unità e poi i campi
// della proposta o il record sfidato. Chiuderlo senza inviare non salva nulla.
export function GuestSheet({
  mode,
  record = null,
  units,
  records,
  loginPath,
  blocked,
  opener,
  onClose,
  onSubmit,
}: GuestSheetProps) {
  const propose = mode === "propose";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [text, setText] = useState("");
  const [measure, setMeasure] = useState<RecordNightMeasure | null>(null);
  const [duration, setDuration] = useState<number>(RECORD_NIGHT_DURATION_RANGE.max);
  const [needs, setNeeds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<GuestFieldErrors>({});
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const ids = useId();
  const titleId = `${ids}-title`;
  const fieldId = (name: string) => `${ids}-${name}`;
  const errorId = (name: string) => `${ids}-${name}-error`;

  // Focus sul primo campo all'apertura, blocco dello scroll della pagina sotto e
  // ritorno del focus al tasto di partenza alla chiusura.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    firstRef.current?.focus();

    return () => {
      document.body.style.overflow = overflow;
      if (opener && opener.isConnected && !opener.hasAttribute("disabled")) {
        opener.focus({ preventScroll: true });
      }
    };
    // Solo all'apertura e alla chiusura: `opener` non cambia finché il foglio è aperto.
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

  function clearFieldError(key: GuestFieldKey) {
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: undefined }));
  }

  function focusField(key: GuestFieldKey) {
    const root = sheetRef.current;
    if (!root) return;
    if (key === "measure") {
      root.querySelector<HTMLInputElement>('input[name="rn-measure"]')?.focus();
    } else if (key === "durationSeconds") {
      root.querySelector<HTMLButtonElement>(".rn-stepper__btn:not([disabled])")?.focus();
    } else {
      root.querySelector<HTMLElement>(`[id="${fieldId(key)}"]`)?.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || blocked) return;

    const draft: RecordNightGuestDraft = propose
      ? { kind: "proposal", firstName, lastName, unitId, text, measure, durationSeconds: duration, needs }
      : { kind: "challenge", firstName, lastName, unitId, recordId: record?.id ?? null };
    const checked = validateGuestDraft(draft, { units, records });
    if (!checked.ok) {
      setFieldErrors(checked.errors);
      setError(null);
      const first = FIELD_ORDER.find((key) => checked.errors[key]);
      if (first) focusField(first);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const outcome = await onSubmit(checked.fields);
      if (outcome.ok) {
        // La pagina chiude il foglio.
        busyRef.current = false;
        return;
      }
      if (Object.keys(outcome.fieldErrors).length > 0) {
        setFieldErrors(outcome.fieldErrors);
        const first = FIELD_ORDER.find((key) => outcome.fieldErrors[key]);
        if (first) focusField(first);
      } else {
        setError(outcome.message);
      }
    } catch (caught) {
      // Non dovrebbe succedere (la pagina restituisce sempre un esito): messaggio neutro.
      console.error("Notte dei Record: invio senza account non riuscito.", caught);
      setError("Non è stato possibile completare l'operazione. Controlla la connessione e riprova.");
    }
    busyRef.current = false;
    setBusy(false);
  }

  const challengeRecord = !propose ? record : null;
  // Errori che non stanno sotto un campo: il record da sfidare non c'è più.
  const formError = error ?? fieldErrors.recordId ?? fieldErrors.kind ?? null;

  function renderFieldError(key: GuestFieldKey) {
    const message = fieldErrors[key];
    return (
      <div aria-live="polite">
        {message ? (
          <p className="rn-field-error" id={errorId(key)}>
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  const describedBy = (key: GuestFieldKey, extra?: string) =>
    [extra, fieldErrors[key] ? errorId(key) : ""].filter(Boolean).join(" ") || undefined;

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
        <form className="rn-sheet__form" noValidate onSubmit={(event) => void handleSubmit(event)}>
          <header className="rn-sheet__head">
            <span aria-hidden="true" className="rn-sheet__grabber" />
            <div className="rn-sheet__titles">
              <h2 className="rn-sheet__title" id={titleId}>
                {propose ? "Proponi un record" : "Sfida questo record"}
              </h2>
              <p className="rn-sheet__sub">Senza account</p>
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

          <div aria-live="polite" className="rn-sheet__banner">
            {blocked ? (
              <p className="rn-notice" id={fieldId("blocked")}>
                <RecordNightIcon name="lock" />
                <span>
                  {blocked === "closed" ? GUEST_COPY.intakeClosed : GUEST_COPY.intakeUnavailable}
                </span>
              </p>
            ) : null}
          </div>

          <div className="rn-sheet__body">
            {challengeRecord ? (
              <div className={`rn-req-record rn-cat--${challengeRecord.category}`}>
                <span className="rn-req-record__kind">
                  <RecordNightIcon name="bolt" />
                  Stai sfidando
                </span>
                <span className="rn-rec__measure">
                  {getRecordNightCategoryLabel(challengeRecord.category)} ·{" "}
                  {getRecordNightMeasureShortLabel(
                    challengeRecord.measure,
                    challengeRecord.durationSeconds,
                  )}
                </span>
                <strong>{challengeRecord.title}</strong>
              </div>
            ) : null}

            <div className="rn-g-login">
              <div className="rn-g-login__top">
                <span aria-hidden="true" className="rn-g-login__ico">
                  <RecordNightIcon name="user" />
                </span>
                <div>
                  <h3 className="rn-g-login__title">Hai un account? Accedi</h3>
                  <p className="rn-g-login__text">
                    Vedi subito i tuoi record e li gestisci anche per i figli.
                  </p>
                </div>
              </div>
              <Link className="rn-btn rn-btn--led" to={loginPath}>
                <RecordNightIcon name="user" />
                Accedi
              </Link>
              <p className="rn-g-login__hint">{GUEST_COPY.sheetLoginHint}</p>
            </div>
            <p className="rn-g-sep">Oppure segnati con nome e unità</p>

            <div className="rn-field-row">
              <div className="rn-field">
                <label className="rn-label" htmlFor={fieldId("firstName")}>
                  Nome
                </label>
                <input
                  aria-describedby={describedBy("firstName")}
                  aria-invalid={fieldErrors.firstName ? true : undefined}
                  autoCapitalize="words"
                  autoComplete="off"
                  className="rn-input"
                  id={fieldId("firstName")}
                  maxLength={GUEST_NAME_LIMITS.max}
                  onChange={(event) => {
                    setFirstName(event.target.value);
                    clearFieldError("firstName");
                  }}
                  ref={firstRef}
                  type="text"
                  value={firstName}
                />
                {renderFieldError("firstName")}
              </div>
              <div className="rn-field">
                <label className="rn-label" htmlFor={fieldId("lastName")}>
                  Cognome
                </label>
                <input
                  aria-describedby={describedBy("lastName")}
                  aria-invalid={fieldErrors.lastName ? true : undefined}
                  autoCapitalize="words"
                  autoComplete="off"
                  className="rn-input"
                  id={fieldId("lastName")}
                  maxLength={GUEST_NAME_LIMITS.max}
                  onChange={(event) => {
                    setLastName(event.target.value);
                    clearFieldError("lastName");
                  }}
                  type="text"
                  value={lastName}
                />
                {renderFieldError("lastName")}
              </div>
            </div>

            <div className="rn-field">
              <label className="rn-label" htmlFor={fieldId("unitId")}>
                La tua unità
              </label>
              <select
                aria-describedby={describedBy("unitId")}
                aria-invalid={fieldErrors.unitId ? true : undefined}
                className={
                  unitId
                    ? "rn-input rn-input--select"
                    : "rn-input rn-input--select rn-input--placeholder"
                }
                id={fieldId("unitId")}
                onChange={(event) => {
                  setUnitId(event.target.value);
                  clearFieldError("unitId");
                }}
                value={unitId}
              >
                <option value="">Scegli l'unità</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
              {renderFieldError("unitId")}
            </div>

            {propose ? (
              <>
                <div className="rn-field">
                  <div className="rn-field__row">
                    <label className="rn-label" htmlFor={fieldId("text")}>
                      Cosa fai?
                    </label>
                    <span aria-hidden="true" className="rn-count">
                      {text.length}/{RECORD_NIGHT_LIMITS.text}
                    </span>
                  </div>
                  <textarea
                    aria-describedby={describedBy("text", fieldId("text-help"))}
                    aria-invalid={fieldErrors.text ? true : undefined}
                    className="rn-input rn-input--area"
                    id={fieldId("text")}
                    maxLength={RECORD_NIGHT_LIMITS.text}
                    onChange={(event) => {
                      setText(oneLine(event.target.value));
                      clearFieldError("text");
                    }}
                    rows={3}
                    value={text}
                  />
                  <p className="rn-help" id={fieldId("text-help")}>
                    Scrivila come la diresti a voce.
                  </p>
                  {renderFieldError("text")}
                </div>

                <fieldset
                  aria-describedby={fieldErrors.measure ? errorId("measure") : undefined}
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
                            clearFieldError("measure");
                          }}
                          type="radio"
                          value={option.value}
                        />
                        <RecordNightIcon name={MEASURE_ICONS[option.value]} />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  {renderFieldError("measure")}
                </fieldset>

                {measure && measureNeedsDuration(measure) ? (
                  <div className="rn-field">
                    <span className="rn-label" id={fieldId("duration")}>
                      Quanti secondi?
                    </span>
                    <div aria-labelledby={fieldId("duration")} className="rn-stepper" role="group">
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
                    {renderFieldError("durationSeconds")}
                  </div>
                ) : null}

                <div className="rn-field">
                  <div className="rn-field__row">
                    <label className="rn-label" htmlFor={fieldId("needs")}>
                      Serve qualcosa?
                    </label>
                    <span className="rn-optional">Facoltativo</span>
                  </div>
                  <input
                    aria-describedby={describedBy("needs")}
                    aria-invalid={fieldErrors.needs ? true : undefined}
                    autoComplete="off"
                    className="rn-input"
                    id={fieldId("needs")}
                    maxLength={RECORD_NIGHT_LIMITS.needs}
                    onChange={(event) => {
                      setNeeds(event.target.value);
                      clearFieldError("needs");
                    }}
                    placeholder="Per esempio: una sedia, un cronometro"
                    type="text"
                    value={needs}
                  />
                  {renderFieldError("needs")}
                </div>
              </>
            ) : null}

            <p className="rn-sheet__note rn-sheet__note--strong rn-sheet__note--body">
              {GUEST_COPY.sheetNote}
            </p>
          </div>

          <footer className="rn-sheet__foot">
            {formError ? (
              <p className="rn-form-error" role="alert">
                <RecordNightIcon name="alert" />
                <span>{formError}</span>
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
              <button
                aria-busy={busy || undefined}
                aria-describedby={blocked ? fieldId("blocked") : undefined}
                className="rn-btn rn-btn--led"
                disabled={busy || blocked !== null}
                type="submit"
              >
                Invia richiesta
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
