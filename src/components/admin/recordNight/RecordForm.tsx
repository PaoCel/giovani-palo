import { useEffect, useRef, useState, type FormEvent } from "react";

import { AppIcon } from "@/components/AppIcon";
import type { RecordNightCategory, RecordNightMeasure } from "@/types";
import type { RecordNightRecordInput } from "@/services/firestore/recordNightService";
import {
  RECORD_NIGHT_CATEGORIES,
  RECORD_NIGHT_DURATION_RANGE,
  RECORD_NIGHT_LIMITS,
  RECORD_NIGHT_MEASURES,
  measureNeedsDuration,
} from "@/utils/recordNight";
import { GUEST_COPY } from "@/utils/recordNightGuest";

export interface RecordFormValues {
  title: string;
  category: RecordNightCategory | "";
  measure: RecordNightMeasure;
  durationSeconds: number | null;
  notes: string;
}

interface RecordFormProps {
  // Prefisso per gli id dei campi: più pannelli possono essere aperti insieme.
  idPrefix: string;
  heading: string;
  // Riga in alto a destra, sotto il titolo su schermi stretti.
  headingNote?: string;
  initial: RecordFormValues;
  submitLabel: string;
  busyLabel: string;
  // Riga di spiegazione sopra i tasti ("Compare a tutti come ...").
  footnote?: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: RecordNightRecordInput) => void;
}

// Come nel foglio dei ragazzi: scegliendo una misura a tempo i secondi partono
// dal massimo (60), così il primo invio non si ferma su un campo vuoto.
const DEFAULT_DURATION = String(RECORD_NIGHT_DURATION_RANGE.max);

interface FieldErrors {
  title?: string;
  category?: string;
  duration?: string;
}

// Pannello inline per Approva, Nuovo record e Modifica: stessi campi, stesse
// regole del server (titolo 80, note 200, secondi 10-60 solo a tempo).
export function RecordForm({
  idPrefix,
  heading,
  headingNote,
  initial,
  submitLabel,
  busyLabel,
  footnote,
  busy,
  error,
  onCancel,
  onSubmit,
}: RecordFormProps) {
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState<RecordNightCategory | "">(initial.category);
  const [measure, setMeasure] = useState<RecordNightMeasure>(initial.measure);
  const [duration, setDuration] = useState(
    initial.durationSeconds !== null
      ? String(initial.durationSeconds)
      : measureNeedsDuration(initial.measure)
        ? DEFAULT_DURATION
        : "",
  );
  const [notes, setNotes] = useState(initial.notes);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const needsDuration = measureNeedsDuration(measure);
  const ids = {
    heading: `${idPrefix}-heading`,
    title: `${idPrefix}-title`,
    titleError: `${idPrefix}-title-error`,
    category: `${idPrefix}-category`,
    categoryError: `${idPrefix}-category-error`,
    measure: `${idPrefix}-measure`,
    duration: `${idPrefix}-duration`,
    durationError: `${idPrefix}-duration-error`,
    notes: `${idPrefix}-notes`,
    notesHint: `${idPrefix}-notes-hint`,
    footnote: `${idPrefix}-footnote`,
    error: `${idPrefix}-error`,
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const nextErrors: FieldErrors = {};
    const cleanTitle = title.replace(/\s+/gu, " ").trim();
    if (!cleanTitle) nextErrors.title = "Scrivi il titolo del record.";
    if (!category) nextErrors.category = "Scegli una categoria.";

    let durationSeconds: number | null = null;
    if (needsDuration) {
      const parsed = Number(duration);
      const { min, max } = RECORD_NIGHT_DURATION_RANGE;
      if (!duration.trim() || !Number.isInteger(parsed) || parsed < min || parsed > max) {
        nextErrors.duration = `Indica i secondi, da ${min} a ${max}.`;
      } else {
        durationSeconds = parsed;
      }
    }

    setFieldErrors(nextErrors);
    if (nextErrors.title || nextErrors.category || nextErrors.duration || !category) {
      return;
    }

    onSubmit({
      title: cleanTitle,
      category,
      measure,
      durationSeconds,
      notes: notes.trim(),
    });
  }

  return (
    <form
      aria-labelledby={ids.heading}
      className="rna-panel"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="rna-panel__head">
        <h5 id={ids.heading}>{heading}</h5>
        {headingNote ? <p className="rna-panel__note">{headingNote}</p> : null}
      </div>

      <div className="rna-field rna-field--wide">
        <div className="rna-field__top">
          <label htmlFor={ids.title}>Titolo ufficiale</label>
          <span className="rna-counter" aria-hidden="true">
            {Array.from(title).length}/{RECORD_NIGHT_LIMITS.title}
          </span>
        </div>
        <input
          aria-describedby={fieldErrors.title ? ids.titleError : undefined}
          aria-invalid={fieldErrors.title ? true : undefined}
          className="rna-input"
          id={ids.title}
          maxLength={RECORD_NIGHT_LIMITS.title}
          onChange={(event) => setTitle(event.target.value)}
          ref={titleRef}
          type="text"
          value={title}
        />
        {fieldErrors.title ? (
          <p className="rna-field__error" id={ids.titleError}>
            {fieldErrors.title}
          </p>
        ) : null}
      </div>

      <div className="rna-field-row">
        <div className="rna-field">
          <label htmlFor={ids.category}>Categoria</label>
          <select
            aria-describedby={fieldErrors.category ? ids.categoryError : undefined}
            aria-invalid={fieldErrors.category ? true : undefined}
            className="rna-input rna-input--select"
            id={ids.category}
            onChange={(event) =>
              setCategory(event.target.value as RecordNightCategory | "")
            }
            value={category}
          >
            <option value="">Scegli la categoria</option>
            {RECORD_NIGHT_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          {fieldErrors.category ? (
            <p className="rna-field__error" id={ids.categoryError}>
              {fieldErrors.category}
            </p>
          ) : null}
        </div>

        <div className="rna-field">
          <label htmlFor={ids.measure}>Come si misura</label>
          <select
            className="rna-input rna-input--select"
            id={ids.measure}
            onChange={(event) => {
              const next = event.target.value as RecordNightMeasure;
              setMeasure(next);
              if (!measureNeedsDuration(next)) {
                setFieldErrors((current) => ({ ...current, duration: undefined }));
              } else if (!duration.trim()) {
                setDuration(DEFAULT_DURATION);
              }
            }}
            value={measure}
          >
            {RECORD_NIGHT_MEASURES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {needsDuration ? (
          <div className="rna-field rna-field--narrow">
            <label htmlFor={ids.duration}>Secondi</label>
            <input
              aria-describedby={fieldErrors.duration ? ids.durationError : undefined}
              aria-invalid={fieldErrors.duration ? true : undefined}
              className="rna-input"
              id={ids.duration}
              inputMode="numeric"
              max={RECORD_NIGHT_DURATION_RANGE.max}
              min={RECORD_NIGHT_DURATION_RANGE.min}
              onChange={(event) => setDuration(event.target.value)}
              type="number"
              value={duration}
            />
            {fieldErrors.duration ? (
              <p className="rna-field__error" id={ids.durationError}>
                {fieldErrors.duration}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rna-field rna-field--wide">
        <div className="rna-field__top">
          <label htmlFor={ids.notes}>Note per la serata</label>
          <span className="rna-counter" aria-hidden="true">
            {Array.from(notes).length}/{RECORD_NIGHT_LIMITS.notes}
          </span>
        </div>
        <textarea
          aria-describedby={ids.notesHint}
          className="rna-input rna-input--area"
          id={ids.notes}
          maxLength={RECORD_NIGHT_LIMITS.notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          value={notes}
        />
        <p className="rna-field__hint" id={ids.notesHint}>
          Regole e materiale. Possono restare vuote.
        </p>
      </div>

      {/* Il titolo di un record lo vede chiunque apra l'elenco, anche senza account. */}
      <p className="rna-panel__warn" role="note">
        <AppIcon name="eye" />
        <span>{GUEST_COPY.publicTitleReminder}</span>
      </p>

      {footnote ? (
        <p className="rna-panel__footnote" id={ids.footnote}>
          {footnote}
        </p>
      ) : null}

      {error ? (
        <p className="rna-panel__error" id={ids.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className="rna-panel__actions">
        <button
          className="button button--ghost button--small"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Annulla
        </button>
        <button
          className="button button--primary button--small"
          disabled={busy}
          type="submit"
        >
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
