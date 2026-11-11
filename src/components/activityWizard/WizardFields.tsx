import { useEffect, useId, useRef, type ReactNode, type Ref } from "react";

import { joinLocalDateTime, splitLocalDateTime } from "@/utils/activityWizard";

// Campi del foglio Crea attività (mockup v2): interruttori a riga, schede di
// scelta, data e ora separate, righe facoltative che si aprono.

export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <small className="wz-error" id={id}>{message}</small> : null;
}

export function Switch({ label, hint, checked, disabled, onChange }: {
  label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void;
}) {
  const id = useId();
  return <label className={disabled ? "wz-switch wz-switch--disabled" : "wz-switch"} htmlFor={id}>
    <span className="wz-switch__text"><strong>{label}</strong>{hint ? <small id={`${id}-hint`}>{hint}</small> : null}</span>
    <input id={id} type="checkbox" role="switch" className="wz-switch__input" checked={checked} disabled={disabled}
      aria-describedby={hint ? `${id}-hint` : undefined} onChange={event => onChange(event.target.checked)} />
  </label>;
}

export function Switches({ children }: { children: ReactNode }) {
  return <div className="wz-switches">{children}</div>;
}

export function DateTimeField({ label, value, error, fallbackTime, hiddenTime, onChange, id }: {
  label: string; value: string; error?: string; fallbackTime: string;
  /** A time that stands for «not chosen yet»: shown as an empty field. */
  hiddenTime?: string;
  onChange: (next: string) => void; id: string;
}) {
  const parts = splitLocalDateTime(value);
  const date = parts.date;
  const time = hiddenTime && parts.time === hiddenTime ? "" : parts.time;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : undefined;
  return <fieldset className="wz-when">
    <legend>{label}</legend>
    <div className="wz-when__line">
      {/* The browser draws its own calendar button: no second icon here. */}
      <input aria-label={`${label}: data`} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={error ? "wz-input wz-input--error" : "wz-input"}
        data-field={id} type="date" value={date} onChange={event => onChange(joinLocalDateTime(event.target.value, time, fallbackTime))} />
      <input aria-label={`${label}: ora`} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={error ? "wz-input wz-input--error" : "wz-input"}
        type="time" value={time} disabled={!date} onChange={event => onChange(joinLocalDateTime(date, event.target.value, fallbackTime))} />
    </div>
    <FieldError id={errorId} message={error} />
  </fieldset>;
}

export function OptionalRow({ title, hint, open, onToggle, toggleLabel, children }: {
  title: string; hint: string; open: boolean; onToggle: () => void; toggleLabel: string; children: ReactNode;
}) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const openedByTap = useRef(false);
  // Opened with a tap: the cursor goes to the first field, ready to type.
  useEffect(() => {
    if (!open || !openedByTap.current) return;
    openedByTap.current = false;
    body.current?.querySelector<HTMLElement>("textarea, input")?.focus();
  }, [open]);
  return <div className={open ? "wz-opt__row wz-opt__row--open" : "wz-opt__row"}>
    <button type="button" className="wz-opt__head" aria-expanded={open} aria-controls={id} onClick={() => { openedByTap.current = !open; onToggle(); }}>
      <span><strong>{title}</strong><small>{hint}</small></span>
      <span className="wz-opt__plus" aria-hidden="true">{open ? "−" : "+"}</span>
      <span className="sr-only">{toggleLabel}</span>
    </button>
    {open ? <div className="wz-opt__body" id={id} ref={body}>{children}</div> : null}
  </div>;
}

export function StepHead({ title, lead, headingRef }: { title: string; lead?: string; headingRef?: Ref<HTMLHeadingElement> }) {
  return <div className="wz-step-head"><h3 ref={headingRef} tabIndex={-1}>{title}</h3>{lead ? <p>{lead}</p> : null}</div>;
}
