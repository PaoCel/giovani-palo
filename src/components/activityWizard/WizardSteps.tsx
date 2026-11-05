import { useId, useState, type ReactNode, type Ref } from "react";

import { GuestRecordsToggle } from "@/components/admin/recordNight/GuestRecordsToggle";
import { Icon, Pill } from "@/components/ui";
import { ACTIVITY_TYPES, EVENT_CREATION as COPY } from "@/copy/eventCreation";
import { fillCopy } from "@/copy/parole";
import type { ActivityType, CustomField, Event, EventAudience, StandardFieldKey } from "@/types";
import {
  ALWAYS_ASKED_FIELDS,
  getDayTypeSuggestion,
  getStepSummaries,
  hasOvernight,
  stepNumber,
  type FieldErrors,
  type PublicationCheck,
  type WizardStepId,
  type WizardValues,
} from "@/utils/activityWizard";
import { getEventAudienceLabel } from "@/utils/events";
import { formatDateRange } from "@/utils/formatters";
import type { StandardFieldDefinition } from "@/utils/formFields";

import { DateTimeField, FieldError, OptionalRow, StepHead, Switch, Switches } from "./WizardFields";

export type SetValue = <K extends keyof WizardValues>(key: K, value: WizardValues[K]) => void;

interface StepProps {
  values: WizardValues;
  set: SetValue;
  errors: FieldErrors;
  headingRef: Ref<HTMLHeadingElement>;
}

const TYPE_ORDER: ActivityType[] = ["standard", "overnight", "trip", "camp", "multi_day"];
const AUDIENCES: [EventAudience, string][] = [["congiunta", COPY.audienceJoint], ["giovane_uomo", COPY.audienceGu], ["giovane_donna", COPY.audienceGd]];

export function StepWhat({ values, set, errors, headingRef, onTypeChange, notice }: StepProps & {
  onTypeChange: (next: ActivityType) => void; notice?: string | null;
}) {
  const ids = useId();
  return <>
    <StepHead headingRef={headingRef} title={COPY.whatTitle} lead={COPY.whatLead} />
    <label className="wz-field">
      <span>{COPY.name}</span>
      <input className={errors.title ? "wz-input wz-input--error" : "wz-input"} data-field="title" value={values.title}
        placeholder={COPY.namePlaceholder} aria-invalid={errors.title ? true : undefined} aria-describedby={errors.title ? `${ids}-title` : undefined}
        onChange={event => set("title", event.target.value)} />
      <FieldError id={`${ids}-title`} message={errors.title} />
    </label>
    <fieldset className="wz-field">
      <legend>{COPY.type}</legend>
      <div className="wz-choices">
        {TYPE_ORDER.map(type => {
          const on = values.activityType === type;
          return <label key={type} className={on ? "wz-choice wz-choice--on" : "wz-choice"}>
            <input className="sr-only" type="radio" name={`${ids}-type`} checked={on} onChange={() => onTypeChange(type)} />
            <strong>{ACTIVITY_TYPES[type].label}</strong>
            {on ? <small>{ACTIVITY_TYPES[type].description}</small> : null}
            <span className="wz-choice__radio" aria-hidden="true" />
          </label>;
        })}
      </div>
    </fieldset>
    <fieldset className="wz-field">
      <legend>{COPY.audience}</legend>
      <div className="wz-seg">
        {AUDIENCES.map(([value, label]) => <label key={value} className={values.audience === value ? "wz-seg__item wz-seg__item--on" : "wz-seg__item"}>
          <input className="sr-only" type="radio" name={`${ids}-audience`} checked={values.audience === value} onChange={() => set("audience", value)} />
          {label}
        </label>)}
      </div>
    </fieldset>
    {notice ? <p className="wz-notice wz-notice--warning" role="status">{notice}</p> : null}
  </>;
}

export function StepWhen({ values, set, errors, headingRef, hasDraft, onTypeSuggestion }: StepProps & {
  hasDraft: boolean; onTypeSuggestion: (type: ActivityType) => void;
}) {
  const ids = useId();
  const [dismissed, setDismissed] = useState("");
  const suggestion = getDayTypeSuggestion(values);
  const suggestionKey = `${values.activityType}|${values.startDate}|${values.endDate}`;
  return <>
    <StepHead headingRef={headingRef} title={COPY.whenTitle} lead={COPY.whenLead} />
    <DateTimeField id="startDate" label={COPY.start} value={values.startDate} error={errors.startDate} fallbackTime="19:00" onChange={next => set("startDate", next)} />
    <DateTimeField id="endDate" label={COPY.end} value={values.endDate} error={errors.endDate} fallbackTime="23:00" onChange={next => set("endDate", next)} />
    {suggestion && dismissed !== suggestionKey ? <div className="wz-ask" role="group" aria-labelledby={`${ids}-ask`}>
      <strong id={`${ids}-ask`}>{suggestion === "overnight" ? COPY.nextDayTitle : COPY.sameDayTitle}</strong>
      <span>{suggestion === "overnight" ? COPY.nextDayBody : COPY.sameDayBody}</span>
      <div className="wz-ask__buttons">
        <button type="button" className="wz-button wz-button--primary" onClick={() => onTypeSuggestion(suggestion)}>{suggestion === "overnight" ? COPY.nextDayYes : COPY.sameDayYes}</button>
        <button type="button" className="wz-button wz-button--link" onClick={() => setDismissed(suggestionKey)}>{suggestion === "overnight" ? COPY.nextDayNo : COPY.sameDayNo}</button>
      </div>
    </div> : null}
    <label className="wz-field">
      <span>{COPY.location}</span>
      <span className="wz-input-icon"><Icon name="map-pin" />
        <input className={errors.location ? "wz-input wz-input--error" : "wz-input"} data-field="location" value={values.location}
          placeholder={COPY.locationPlaceholder} aria-invalid={errors.location ? true : undefined}
          aria-describedby={`${ids}-location-hint`} onChange={event => set("location", event.target.value)} />
      </span>
      {errors.location ? <FieldError id={`${ids}-location`} message={errors.location} /> : <small id={`${ids}-location-hint`}>{COPY.locationHint}</small>}
    </label>
    {!hasDraft ? <p className="wz-notice"><Icon name="lock" /><span>{COPY.draftNotice}</span></p> : null}
  </>;
}

export function StepPoster({ values, set, headingRef, uploading, uploadError, disabled, onPick, onCancelUpload }: StepProps & {
  uploading: boolean; uploadError: string | null; disabled: boolean; onPick: (file: File) => void; onCancelUpload: () => void;
}) {
  const ids = useId();
  const hasImage = Boolean(values.heroImageUrl);
  return <>
    <StepHead headingRef={headingRef} title={COPY.posterTitle} lead={COPY.posterLead} />
    {/* Not a <label>: a wrapping label would forward every tap on the
        preview to the file input and reopen the picker. */}
    <div className="wz-field" role="group" aria-labelledby={`${ids}-poster`}>
      <span id={`${ids}-poster`}>{COPY.poster}</span>
      <div className="wz-poster">
        <div className="wz-poster__frame">
          {hasImage ? <img src={values.heroImageUrl} alt={COPY.posterAlt} /> : <span>{COPY.posterEmpty}</span>}
        </div>
        <div className="wz-poster__actions">
          <label className={uploading || disabled ? "wz-button wz-button--soft wz-upload wz-button--disabled" : "wz-button wz-button--soft wz-upload"}>
            <input accept="image/*" className="sr-only" type="file" disabled={uploading || disabled}
              onChange={event => {
                const input = event.currentTarget;
                const file = input.files?.[0] ?? null;
                // A focused hidden file input stays the "active" control:
                // mobile browsers keep scrolling back to it. Release it and
                // allow picking the same file again.
                input.value = "";
                input.blur();
                if (file) onPick(file);
              }} />
            {uploading ? COPY.posterUploading : hasImage ? COPY.posterChange : COPY.posterUpload}
          </label>
          {uploading ? <button type="button" className="wz-button wz-button--link" onClick={onCancelUpload}>{COPY.posterCancelUpload}</button> : null}
          {!uploading && (values.heroImageUrl || values.heroImagePath) ? <button type="button" className="wz-button wz-button--link" disabled={disabled}
            onClick={() => { set("heroImageUrl", ""); set("heroImagePath", ""); }}>{COPY.posterRemove}</button> : null}
          <small>{COPY.posterHint}</small>
        </div>
      </div>
      {uploadError ? <small className="wz-error" role="alert">{uploadError}</small> : null}
    </div>
    <label className="wz-field">
      <span>{COPY.description}</span>
      <textarea className="wz-input wz-input--area" rows={5} value={values.description} aria-describedby={`${ids}-description`}
        onChange={event => set("description", event.target.value)} />
      <small id={`${ids}-description`}>{COPY.descriptionHint}</small>
    </label>
  </>;
}

const REQUIREMENTS: { key: "requiresParentAuthorization" | "requiresEmergencyContacts" | "requiresMedicalNotes" | "requiresImageConsent"; label: string; hint: string }[] = [
  { key: "requiresParentAuthorization", label: COPY.parentAuthorization, hint: COPY.parentAuthorizationHint },
  { key: "requiresEmergencyContacts", label: COPY.emergencyContacts, hint: COPY.emergencyContactsHint },
  { key: "requiresMedicalNotes", label: COPY.medicalNotes, hint: COPY.medicalNotesHint },
  { key: "requiresImageConsent", label: COPY.imageConsent, hint: COPY.imageConsentHint },
];

export function StepRegistrations({ values, set, errors, headingRef, fieldDefinitions, onAddQuestion, editingQuestion, setEditingQuestion, notices }: StepProps & {
  fieldDefinitions: StandardFieldDefinition[];
  onAddQuestion: () => void;
  editingQuestion: string | null;
  setEditingQuestion: (id: string | null) => void;
  notices: string[];
}) {
  const ids = useId();
  const strong = values.activityType !== "standard";
  const labelOf = (key: StandardFieldKey) => fieldDefinitions.find(field => field.key === key)?.label ?? key;
  const forcedAudience = values.audience !== "congiunta";
  const enabled = values.enabledStandardFields;
  const always = ALWAYS_ASKED_FIELDS.filter(key => enabled.includes(key) || (key === "genderRoleCategory" && forcedAudience));
  const added = enabled.filter(key => !ALWAYS_ASKED_FIELDS.includes(key) && key !== "parentConfirmed");
  const updateField = (id: string, patch: Partial<CustomField>) => set("customFields", values.customFields.map(field => field.id === id ? { ...field, ...patch } : field));
  return <>
    <StepHead headingRef={headingRef} title={COPY.registrationsTitle} lead={COPY.registrationsLead} />
    <DateTimeField id="registrationOpen" label={COPY.opens} value={values.registrationOpen} error={errors.registrationOpen} fallbackTime="08:00" onChange={next => set("registrationOpen", next)} />
    <DateTimeField id="registrationClose" label={COPY.closes} value={values.registrationClose} error={errors.registrationClose} fallbackTime="23:59" onChange={next => set("registrationClose", next)} />
    <label className="wz-field wz-field--narrow">
      <span>{COPY.seats}</span>
      <input className={errors.maxParticipants ? "wz-input wz-input--error" : "wz-input"} data-field="maxParticipants" inputMode="numeric" value={values.maxParticipants}
        placeholder={COPY.seatsPlaceholder} aria-invalid={errors.maxParticipants ? true : undefined}
        onChange={event => set("maxParticipants", event.target.value)} />
      <FieldError id={`${ids}-max`} message={errors.maxParticipants} />
    </label>
    {strong ? <section className="wz-section" aria-labelledby={`${ids}-req`}>
      <h4 className="wz-sec-title" id={`${ids}-req`}>{COPY.requirementsFor[values.activityType as keyof typeof COPY.requirementsFor]}</h4>
      <Switches>
        {REQUIREMENTS.map(item => <Switch key={item.key} label={item.label} hint={item.hint} checked={values[item.key]} onChange={next => set(item.key, next)} />)}
      </Switches>
    </section> : null}
    <section className="wz-section" aria-labelledby={`${ids}-who`}>
      <h4 className="wz-sec-title" id={`${ids}-who`}>{COPY.whoCanRegister}</h4>
      <Switches>
        {strong || values.requiresAccount ? <Switch label={COPY.requiresAccount} hint={COPY.requiresAccountHint} checked={values.requiresAccount}
          onChange={next => set("requiresAccount", next)} /> : null}
        <Switch label={COPY.guest} hint={values.requiresAccount ? COPY.guestOffHint : COPY.guestHint} disabled={values.requiresAccount}
          checked={values.allowGuestRegistration && !values.requiresAccount} onChange={next => set("allowGuestRegistration", next)} />
      </Switches>
    </section>
    <section className="wz-section" aria-labelledby={`${ids}-ask`}>
      <h4 className="wz-sec-title" id={`${ids}-ask`}>{COPY.whatWeAsk}</h4>
      <ul className="wz-qlist">
        {always.length ? <li className="wz-q"><strong>{always.map(labelOf).join(", ")}</strong><Pill>{COPY.alwaysAsked}</Pill></li> : null}
        {added.map(key => <li className="wz-q" key={key}>
          <strong>{labelOf(key)}</strong><Pill tone="sand">{COPY.addedByYou}</Pill>
          <button type="button" className="wz-q__action" aria-label={`${COPY.questionRemove}: ${labelOf(key)}`}
            onClick={() => set("enabledStandardFields", enabled.filter(value => value !== key))}>{COPY.questionRemove}</button>
        </li>)}
        {values.customFields.map(field => {
          const error = errors[`customField:${field.id}`];
          const open = editingQuestion === field.id || Boolean(error);
          return <li className={open ? "wz-q wz-q--open" : "wz-q"} key={field.id}>
            {open ? <div className="wz-q__editor">
              <label className="wz-field"><span>{COPY.questionLabel}</span>
                <input className={error ? "wz-input wz-input--error" : "wz-input"} data-field={`customField:${field.id}`} value={field.label}
                  aria-invalid={error ? true : undefined} onChange={event => updateField(field.id, { label: event.target.value })} />
                <FieldError id={`${ids}-${field.id}`} message={error} />
              </label>
              <label className="wz-field"><span id={`${ids}-${field.id}-type`}>{COPY.questionType}</span>
                {/* The wrapping label would add the options to the accessible name. */}
                <select aria-labelledby={`${ids}-${field.id}-type`} className="wz-input" value={field.type} onChange={event => updateField(field.id, { type: event.target.value as CustomField["type"] })}>
                  {(Object.keys(COPY.questionTypes) as CustomField["type"][]).map(type => <option key={type} value={type}>{COPY.questionTypes[type as keyof typeof COPY.questionTypes]}</option>)}
                </select>
              </label>
              {field.type === "select" ? <label className="wz-field"><span>{COPY.questionOptions}</span>
                <input className="wz-input" value={(field.options ?? []).join(", ")} onChange={event => updateField(field.id, { options: event.target.value.split(",") })} />
              </label> : null}
              <label className="wz-field"><span>{COPY.questionHelp}</span>
                <input className="wz-input" value={field.helpText ?? ""} onChange={event => updateField(field.id, { helpText: event.target.value })} />
              </label>
              <Switches><Switch label={COPY.questionRequired} checked={field.required} onChange={next => updateField(field.id, { required: next })} /></Switches>
              <div className="wz-q__buttons">
                <button type="button" className="wz-button wz-button--link wz-button--danger" onClick={() => { setEditingQuestion(null); set("customFields", values.customFields.filter(item => item.id !== field.id)); }}>{COPY.questionRemove}</button>
                <button type="button" className="wz-button wz-button--soft" disabled={!field.label.trim()} onClick={() => setEditingQuestion(null)}>{COPY.questionDone}</button>
              </div>
            </div> : <>
              <strong>{field.label}</strong><Pill tone="sand">{COPY.addedByYou}</Pill>
              <button type="button" className="wz-q__action" aria-label={`${COPY.questionEdit}: ${field.label}`} onClick={() => setEditingQuestion(field.id)}>{COPY.questionEdit}</button>
            </>}
          </li>;
        })}
      </ul>
      <button type="button" className="wz-add" onClick={onAddQuestion}><Icon name="plus" /><span>{COPY.addQuestion}</span></button>
    </section>
    {notices.map(text => <p key={text} className="wz-notice wz-notice--warning" role="status">{text}</p>)}
  </>;
}

type OptionalSection = "program" | "whatToBring" | "menu" | "rooms" | "staff";

export function StepParticipants({ values, set, errors, headingRef, event, focusRooms, guestReviewed, onGuestReviewed }: StepProps & {
  event: Event | null; focusRooms: boolean; guestReviewed: boolean; onGuestReviewed: (next: boolean) => void;
}) {
  const ids = useId();
  const overnight = hasOvernight(values);
  const [open, setOpen] = useState<Record<OptionalSection, boolean>>(() => ({
    program: Boolean(values.program), whatToBring: Boolean(values.whatToBring), menu: Boolean(values.menuInfo || values.allergiesInfo),
    rooms: Boolean(values.roomsInfo) || focusRooms, staff: Boolean(values.organizerNotes),
  }));
  const toggle = (section: OptionalSection) => setOpen(current => ({ ...current, [section]: !current[section] }));
  const row = (section: OptionalSection, title: string, hint: string, body: ReactNode) => <OptionalRow key={section} title={title} hint={hint} open={open[section]}
    toggleLabel={fillCopy(open[section] ? COPY.closeSection : COPY.addSection, { sezione: title })} onToggle={() => toggle(section)}>{body}</OptionalRow>;
  const area = (key: "program" | "whatToBring" | "menuInfo" | "allergiesInfo" | "roomsInfo" | "organizerNotes", label: string, placeholder?: string) =>
    <label className="wz-field"><span className="sr-only">{label}</span>
      <textarea className="wz-input wz-input--area" rows={3} value={values[key]} placeholder={placeholder} data-focus-field={key === "roomsInfo" ? "roomsInfo" : undefined}
        aria-label={label} onChange={event => set(key, event.target.value)} />
    </label>;
  return <>
    <StepHead headingRef={headingRef} title={COPY.participantsTitle} lead={COPY.participantsLead} />
    <div className="wz-opt">
      {row("program", COPY.program, COPY.programHint, area("program", COPY.program))}
      {row("whatToBring", COPY.whatToBring, COPY.whatToBringHint, area("whatToBring", COPY.whatToBring, COPY.whatToBringPlaceholder))}
      {row("menu", COPY.menuAllergies, COPY.menuAllergiesHint, <>
        <label className="wz-field"><span>{COPY.menu}</span><textarea className="wz-input wz-input--area" rows={3} value={values.menuInfo} onChange={event => set("menuInfo", event.target.value)} /></label>
        <label className="wz-field"><span>{COPY.allergies}</span><textarea className="wz-input wz-input--area" rows={3} value={values.allergiesInfo} onChange={event => set("allergiesInfo", event.target.value)} /></label>
      </>)}
      {overnight ? row("rooms", COPY.rooms, COPY.roomsHint, area("roomsInfo", COPY.rooms)) : null}
      {row("staff", COPY.staffNotes, COPY.staffNotesHint, area("organizerNotes", COPY.staffNotes))}
    </div>
    <section className="wz-section" aria-labelledby={`${ids}-extra`}>
      <h4 className="wz-sec-title" id={`${ids}-extra`}>{COPY.extra}</h4>
      <Switches>
        <Switch label={COPY.questions} hint={COPY.questionsHint} checked={values.questionsEnabled} onChange={next => set("questionsEnabled", next)} />
        <Switch label={COPY.records} hint={COPY.recordsHint} checked={values.recordsEnabled} onChange={next => set("recordsEnabled", next)} />
      </Switches>
      {values.recordsEnabled ? <div className="wz-records">
        <DateTimeField id="recordsCloseAt" label={COPY.recordsClose} value={values.recordsCloseAt} error={errors.recordsCloseAt} fallbackTime="23:59" onChange={next => set("recordsCloseAt", next)} />
        {!errors.recordsCloseAt ? <small className="wz-hint">{COPY.recordsCloseHint}</small> : null}
        <GuestRecordsToggle activityId={event?.id ?? null} alreadyEnabled={event?.recordsGuestEnabled === true} enabled={values.recordsGuestEnabled}
          onEnabledChange={next => set("recordsGuestEnabled", next)} onReviewedChange={onGuestReviewed}
          reviewMissing={Boolean(errors.recordsGuestReviewed)} reviewed={guestReviewed} stakeId={event?.stakeId ?? null} />
      </div> : null}
    </section>
  </>;
}

export function StepReview({ event, headingRef, checks, now, onEdit, questionCount, manage, returningCount }: {
  event: Event; headingRef: Ref<HTMLHeadingElement>; checks: PublicationCheck[]; now: number;
  onEdit: (step: WizardStepId) => void; questionCount: number; manage: ReactNode; returningCount: number;
}) {
  const summaries = getStepSummaries(event, now);
  const short = (iso: string) => new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" }).format(new Date(iso));
  const validIso = (iso: string) => Boolean(iso) && Number.isFinite(Date.parse(iso));
  const descriptionLength = event.description.trim().length;
  const extras = [event.questionsEnabled ? COPY.questions : "", event.recordsEnabled ? COPY.records : ""].filter(Boolean);
  const filledParts = [event.program ? COPY.program : "", event.whatToBring ? COPY.whatToBring : "", event.menuInfo || event.allergiesInfo ? COPY.menuAllergies : "",
    event.roomsInfo ? COPY.rooms : "", event.organizerNotes ? COPY.staffNotes : ""].filter(Boolean);
  const lines: Record<Exclude<WizardStepId, "review">, string> = {
    what: fillCopy(COPY.summaryWhat, { tipo: ACTIVITY_TYPES[event.activityType ?? "standard"].label, per: getEventAudienceLabel(event.audience) }),
    when: [validIso(event.startDate) && validIso(event.endDate) ? formatDateRange(event.startDate, event.endDate) : "", event.location].filter(Boolean).join(" · "),
    poster: `${event.heroImageUrl ? COPY.summaryPosterYes : COPY.summaryPosterNo} · ${descriptionLength ? fillCopy(COPY.summaryDescription, { n: String(descriptionLength) }) : COPY.summaryNoDescription}`,
    registrations: [
      validIso(event.registrationOpen) && validIso(event.registrationClose) ? fillCopy(COPY.summaryWindow, { apre: short(event.registrationOpen), chiude: short(event.registrationClose) }) : COPY.summaryNoWindow,
      event.requiresAccount || !event.allowGuestRegistration ? COPY.summaryAccount : COPY.summaryGuest,
      questionCount === 1 ? COPY.summaryQuestionsOne : fillCopy(COPY.summaryQuestions, { n: String(questionCount) }),
    ].join(" · "),
    participants: [filledParts.join(", ") || COPY.summaryNothing, extras.join(", ") || COPY.summaryNoExtra].join(" · "),
  };
  const opens = validIso(event.registrationOpen) ? Date.parse(event.registrationOpen) : Number.NaN;
  const openWhen = Number.isFinite(opens) && opens > now
    ? `${new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" }).format(new Date(opens))} alle ${new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(opens))}`
    : "";
  return <>
    <StepHead headingRef={headingRef} title={event.isPublic ? COPY.steps.manage : COPY.steps.review} lead={event.isPublic ? COPY.manageLead : COPY.reviewLead} />
    <article className="wz-hero">
      <div className="wz-hero__poster">{event.heroImageUrl ? <img src={event.heroImageUrl} alt="" /> : <Icon name="sparkles" />}</div>
      <div><h4>{event.title}</h4>
        <p>{lines.when}</p>
      </div>
    </article>
    <ul className="wz-sum">
      {summaries.filter(item => item.step !== "review").map(item => {
        const step = item.step as Exclude<WizardStepId, "review">;
        const mark = item.state === "done" ? <Icon name="check" /> : item.state === "optional" ? "–" : "!";
        return <li className="wz-sum__row" key={step}>
          <span className={item.state === "done" ? "wz-sum__st" : item.state === "optional" ? "wz-sum__st wz-sum__st--skip" : "wz-sum__st wz-sum__st--warn"} aria-hidden="true">{mark}</span>
          <strong>{COPY.steps[step]}</strong>
          <small>{lines[step]}</small>
          <button type="button" className="wz-sum__edit" aria-label={`${COPY.edit}: ${COPY.steps[step]}`} onClick={() => onEdit(step)}>{COPY.edit}</button>
        </li>;
      })}
    </ul>
    {!event.isPublic && checks.length ? <div className="wz-issues" role="status">
      <strong>{COPY.missing}</strong>
      <ul>{checks.map(check => <li key={check.message}>
        <button type="button" className="wz-issues__link" onClick={() => onEdit(check.step)}>
          <span>{check.message}</span><small>{`${stepNumber(check.step)} · ${COPY.steps[check.step]}`}</small>
        </button>
      </li>)}</ul>
    </div> : null}
    {!event.isPublic && !checks.length ? <p className="wz-effect">{openWhen ? fillCopy(COPY.publishEffect, { apertura: openWhen }) : COPY.publishEffectOpen}</p> : null}
    {!event.isPublic && returningCount > 0 ? <p className="wz-notice">{returningCount === 1 ? COPY.returningRegistrationsOne : fillCopy(COPY.returningRegistrations, { n: String(returningCount) })}</p> : null}
    {manage}
  </>;
}

export function StepIndexList({ summaries, current, hasDraft, onPick }: {
  summaries: ReturnType<typeof getStepSummaries>; current: WizardStepId; hasDraft: boolean; onPick: (step: WizardStepId) => void;
}) {
  return <ol className="wz-plist">
    {summaries.map(item => {
      const locked = !hasDraft && item.state === "locked";
      const now = item.step === current;
      return <li key={item.step}>
        <button type="button" className={now ? "wz-pitem wz-pitem--now" : "wz-pitem"} disabled={locked} aria-current={now ? "step" : undefined} onClick={() => onPick(item.step)}>
          <span className={item.state === "done" && !now ? "wz-pitem__n wz-pitem__n--done" : "wz-pitem__n"} aria-hidden="true">
            {item.state === "done" && !now ? <Icon name="check" /> : stepNumber(item.step)}
          </span>
          <strong>{COPY.steps[item.step]}</strong>
          {item.label ? <Pill tone={item.state === "done" ? "success" : item.state === "todo" ? "warning" : "neutral"}>{item.label}</Pill> : null}
        </button>
      </li>;
    })}
  </ol>;
}
