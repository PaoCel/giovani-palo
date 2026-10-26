import { useEffect, useRef, useState, type FormEvent } from "react";

import { EVENT_CREATION as COPY } from "@/copy/eventCreation";
import type { ActivityType, Event, EventAudience, EventWriteInput, OrganizationRegistrationDefaults } from "@/types";
import { buildEssentialDraft, getActivityRequirementChanges, getPublicationIssues, validateEssentialDraft } from "@/utils/eventCreation";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/utils/formatters";

interface Props {
  event: Event | null;
  formId: string;
  defaults: OrganizationRegistrationDefaults;
  busy: boolean;
  onSave: (input: EventWriteInput) => Promise<void>;
}

export function EssentialEventForm({ event, formId, defaults, busy, onSave }: Props) {
  const [values, setValues] = useState({
    title: event?.title ?? "", activityType: event?.activityType ?? "standard" as ActivityType,
    startDate: toDatetimeLocalValue(event?.startDate), endDate: toDatetimeLocalValue(event?.endDate),
    location: event?.location ?? "", description: event?.description ?? "",
    audience: event?.audience ?? "congiunta" as EventAudience,
    registrationOpen: toDatetimeLocalValue(event?.registrationOpen),
    registrationClose: toDatetimeLocalValue(event?.registrationClose),
    program: event?.program ?? "", whatToBring: event?.whatToBring ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function change(key: keyof typeof values, value: string) { setValues(current => ({ ...current, [key]: value })); }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const issue = validateEssentialDraft(values);
    setError(issue);
    if (issue) return;
    const draft = buildEssentialDraft(values, defaults);
    const next: EventWriteInput = {
      ...draft, ...event,
      title: draft.title, activityType: draft.activityType, year: draft.year,
      startDate: draft.startDate, endDate: draft.endDate, location: draft.location, overnight: draft.overnight,
      description: values.description.trim(), audience: values.audience,
      registrationOpen: values.registrationOpen ? fromDatetimeLocalValue(values.registrationOpen) : "",
      registrationClose: values.registrationClose ? fromDatetimeLocalValue(values.registrationClose) : "",
      program: values.program.trim(), publicNotes: event?.publicNotes ?? "", whatToBring: values.whatToBring.trim(),
      ...(event ? getActivityRequirementChanges(event.activityType ?? "standard", values.activityType) : {}),
    };
    if (!draft.overnight) next.roomsInfo = "";
    if (event?.isPublic) {
      const issues = getPublicationIssues({ ...next, status: "draft" });
      if (issues.length) { setError(issues.join(" ")); return; }
      if (event.status !== "cancelled" && event.status !== "completed") next.status = "registrations_open";
    }
    await onSave(next);
  }

  return <form id={formId} className="event-creation" onSubmit={submit}>
    {!event ? <div className="event-creation__intro"><img src="/brand-logo.png" alt="" /><div><strong>{COPY.intro}</strong><p>{COPY.introBody}</p></div></div> : null}
    {error ? <p ref={errorRef} tabIndex={-1} className="form-error" role="alert">{error}</p> : null}
    <fieldset disabled={busy}>
      <label className="field"><span>Nome dell'attività</span><input required className="input" value={values.title} placeholder="Es. Una serata insieme" onChange={e => change("title", e.target.value)} /></label>
      <label className="field"><span>Tipo di attività</span><select className="input" value={values.activityType} onChange={e => change("activityType", e.target.value)}>
        <option value="standard">Standard</option><option value="overnight">Con pernottamento</option><option value="trip">Viaggio / trasferta</option><option value="camp">Campeggio</option><option value="multi_day">Su più giorni</option>
      </select>{values.activityType !== "standard" ? <small>Per chi ha meno di 18 anni, l'autorizzazione del genitore parte attiva. Puoi controllare i requisiti nelle altre opzioni.</small> : null}</label>
      <div className="event-creation__dates">
        <label className="field"><span>Inizio</span><input required className="input" type="datetime-local" value={values.startDate} onChange={e => change("startDate", e.target.value)} /></label>
        <label className="field"><span>Fine</span><input required className="input" type="datetime-local" value={values.endDate} onChange={e => change("endDate", e.target.value)} /></label>
      </div>
      <label className="field"><span>Luogo</span><input required className="input" value={values.location} placeholder="Dove ci incontriamo?" onChange={e => change("location", e.target.value)} /></label>
      <details className="event-creation__optional"><summary>{COPY.optional}</summary>
        <label className="field"><span>Descrizione</span><textarea className="input input--textarea" value={values.description} rows={3} onChange={e => change("description", e.target.value)} /></label>
        <label className="field"><span>Destinatari</span><select className="input" value={values.audience} onChange={e => change("audience", e.target.value)}><option value="congiunta">Congiunta</option><option value="giovane_uomo">Solo GU</option><option value="giovane_donna">Solo GD</option></select></label>
        <label className="field"><span>Apertura iscrizioni</span><input className="input" type="datetime-local" value={values.registrationOpen} onChange={e => change("registrationOpen", e.target.value)} /></label>
        <label className="field"><span>Chiusura iscrizioni</span><input className="input" type="datetime-local" value={values.registrationClose} onChange={e => change("registrationClose", e.target.value)} /></label>
        <label className="field"><span>Programma / riepilogo</span><textarea className="input input--textarea" value={values.program} rows={3} onChange={e => change("program", e.target.value)} /></label>
        <label className="field"><span>Cosa portare</span><textarea className="input input--textarea" value={values.whatToBring} rows={3} onChange={e => change("whatToBring", e.target.value)} /></label>
      </details>
    </fieldset>
    {!event?.isPublic ? <p className="event-creation__hint">{COPY.findDraft}</p> : null}
  </form>;
}
