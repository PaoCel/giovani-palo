import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AdminEventEditorModal } from "@/components/AdminEventEditorModal";
import { AppModal } from "@/components/AppModal";
import { BottomSheet } from "@/components/register/BottomSheet";
import { FieldError } from "@/components/activityWizard/WizardFields";
import { Icon } from "@/components/ui";
import { ANNUNCIATA as COPY } from "@/copy/annunciata";
import { ACTIVITY_TYPES } from "@/copy/eventCreation";
import { fillCopy } from "@/copy/parole";
import { eventsService } from "@/services/firestore/eventsService";
import type { ActivityType, Event, EventWriteInput, OrganizationProfile } from "@/types";
import { getAdminActionError } from "@/utils/adminErrors";
import { getActivityRequirementChanges } from "@/utils/eventCreation";
import { isAnnouncedEvent } from "@/utils/events";
import { formatEventWhen } from "@/utils/formatters";
import {
  EMPTY_QUICK_VALUES,
  buildQuickPayload,
  findQuickDuplicate,
  getQuickLocalRange,
  hasQuickInput,
  isQuickDatePast,
  needsEndDate,
  quickValuesFromEvent,
  validateQuick,
  type QuickErrors,
  type QuickValues,
} from "@/utils/quickActivity";
import { isConnectionError, isOffline, withWriteTimeout } from "@/utils/writeTimeout";
import inviataUrl from "@/assets/flusso-genitore/inviata.webp";
import "@/styles/activityWizard.css";
import "@/styles/quickActivity.css";

// «Nuova attività» in modalità rapida (docs/ATTIVITA_MODULARI.md, «La
// schermata rapida»): un foglio solo che mette in calendario un'attività
// annunciata, poi resta aperto per il giro successivo.

interface QuickActivitySheetProps {
  organization: OrganizationProfile;
  stakeId: string;
  sessionUid: string;
  /** AAAA-MM-GG: day prefilled for the whole round («Aggiungi in <mese>»). */
  initialDate?: string;
  /** `changed`: something was written, the page reloads its list. */
  onClose: (changed: boolean) => void;
}

type Action = "save" | "details" | "saveExit";

interface RoundItem {
  event: Event;
  deleted: boolean;
  error: string | null;
}

const TYPE_ORDER: ActivityType[] = ["standard", "overnight", "trip", "camp", "multi_day"];
const FIELD_ORDER = ["title", "date", "endDate"] as const;

function blankValues(activityType: ActivityType, date: string): QuickValues {
  return { ...EMPTY_QUICK_VALUES, activityType, date };
}

function sameValues(left: QuickValues, right: QuickValues) {
  return left.title.trim() === right.title.trim() && left.activityType === right.activityType
    && left.date === right.date && left.time === right.time && left.location.trim() === right.location.trim()
    && (!needsEndDate(left.activityType) || left.endDate === right.endDate);
}

/**
 * «Correggi»: updateEvent rewrites every field of the payload, so the payload
 * is the saved activity with only what the sheet shows changed. Unchanged
 * dates keep the saved ones (hours set in the steps stay).
 */
function buildCorrection(event: Event, values: QuickValues, defaults: Parameters<typeof buildQuickPayload>[1]): EventWriteInput {
  const quick = buildQuickPayload(values, defaults);
  const original = quickValuesFromEvent(event);
  const before = getQuickLocalRange(original);
  const after = getQuickLocalRange(values);
  const sameWhen = before.start === after.start && before.end === after.end;
  return {
    ...event,
    title: quick.title,
    activityType: values.activityType,
    location: quick.location,
    ...(sameWhen ? {} : { startDate: quick.startDate, endDate: quick.endDate, year: quick.year, timeToBeDefined: true }),
    ...getActivityRequirementChanges(event.activityType ?? "standard", values.activityType),
  };
}

function writeError(error: unknown) {
  return isConnectionError(error) || isOffline() ? COPY.erroreRete : getAdminActionError(error, COPY.erroreRete);
}

function dayBadge(event: Event) {
  const start = new Date(event.startDate);
  const end = new Date(event.endDate || event.startDate);
  const month = start.toLocaleDateString("it-IT", { month: "short" }).replace(".", "");
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const day = start.toDateString() !== end.toDateString() && sameMonth ? `${start.getDate()}-${end.getDate()}` : String(start.getDate());
  return { month, day };
}

export function QuickActivitySheet({ organization, stakeId, sessionUid, initialDate = "", onClose }: QuickActivitySheetProps) {
  const ids = useId();
  const defaults = useMemo(() => ({
    allowGuestRegistration: organization.registrationDefaults.allowGuestRegistration,
    requireLoginForEdit: organization.registrationDefaults.requireLoginForEdit,
  }), [organization.registrationDefaults]);
  const [values, setValues] = useState<QuickValues>(() => blankValues("standard", initialDate));
  const [errors, setErrors] = useState<QuickErrors>({});
  const [round, setRound] = useState<RoundItem[]>([]);
  const [view, setView] = useState<"form" | "saved">("form");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<Action>("save");
  const [exitOpen, setExitOpen] = useState(false);
  const [stepsEvent, setStepsEvent] = useState<Event | null>(null);
  const [existing, setExisting] = useState<Event[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  const changed = useRef(false);
  const closeAfterWrite = useRef(false);
  const creationId = useRef(crypto.randomUUID());
  const stepsReturned = useRef(false);
  const pendingFocus = useRef<"name" | "saved" | "alert" | null>("name");
  const body = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    // The list behind the duplicate notice: a failed read only hides a
    // notice that never blocks, the sheet works the same.
    eventsService.listAllEvents(stakeId)
      .then(list => { if (mounted.current) setExisting(list); })
      .catch(() => undefined);
    return () => { mounted.current = false; };
  }, [stakeId]);

  // Runs after AppModal's own focus on the dialog (parent effects run last).
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || stepsEvent) return;
    pendingFocus.current = null;
    if (target === "name") nameRef.current?.focus({ preventScroll: true });
    if (target === "saved") savedRef.current?.focus({ preventScroll: true });
    if (target === "alert") alertRef.current?.focus({ preventScroll: true });
  });

  const editingItem = editingId ? round.find(item => item.event.id === editingId) ?? null : null;
  const dirty = editingItem
    ? !sameValues(values, quickValuesFromEvent(editingItem.event))
    : hasQuickInput({ ...values, date: values.date === initialDate ? "" : values.date });
  const canSave = Object.keys(validateQuick(values)).length === 0;
  const known = useMemo(() => {
    const roundIds = new Set(round.map(item => item.event.id));
    return [...existing.filter(event => !roundIds.has(event.id)), ...round.filter(item => !item.deleted).map(item => item.event)];
  }, [existing, round]);
  const duplicate = view === "form" ? findQuickDuplicate(values, known, editingId ?? undefined) : null;
  const past = view === "form" && isQuickDatePast(values);
  const strong = needsEndDate(values.activityType);
  const last = round.length ? round[round.length - 1] : null;
  const listed = view === "saved" && last ? round.slice(0, -1) : round.filter(item => item.event.id !== editingId);

  function scrollTop() {
    body.current?.closest(".app-modal__body")?.scrollTo(0, 0);
  }

  function finish() {
    onClose(changed.current);
  }

  /** One write at a time; the error goes to `onError` (the top alert or a row). */
  async function write<T>(work: () => Promise<T>, onError: (message: string) => void): Promise<T | undefined> {
    if (lock.current) return undefined;
    if (isOffline()) { onError(COPY.erroreRete); return undefined; }
    lock.current = true;
    setBusy(true);
    try {
      const result = await withWriteTimeout(work());
      changed.current = true;
      return result;
    } catch (caughtError) {
      closeAfterWrite.current = false;
      if (mounted.current) onError(writeError(caughtError));
      return undefined;
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function set<K extends keyof QuickValues>(key: K, value: QuickValues[K]) {
    setValues(current => ({ ...current, [key]: value }));
    setErrors(current => {
      if (!(key in current)) return current;
      const next: Record<string, string | undefined> = { ...current };
      delete next[key];
      return next as QuickErrors;
    });
  }

  function changeType(next: ActivityType) {
    setValues(current => ({ ...current, activityType: next, endDate: needsEndDate(next) ? current.endDate : "" }));
    setErrors(current => {
      if (!current.endDate) return current;
      const copy = { ...current };
      delete copy.endDate;
      return copy;
    });
  }

  function showErrors(found: QuickErrors) {
    setErrors(found);
    const first = FIELD_ORDER.find(key => found[key]);
    if (!first) return;
    requestAnimationFrame(() => {
      const field = body.current?.querySelector<HTMLElement>(`[data-field="${first}"]`);
      field?.focus();
      field?.scrollIntoView({ block: "center" });
    });
  }

  function afterSaved(event: Event, action: Action) {
    setAnnouncement(`${COPY.salvataTitolo}: ${event.title}`);
    setValues(current => blankValues(current.activityType, initialDate));
    setErrors({});
    setEditingId(null);
    setView("saved");
    if (closeAfterWrite.current || action === "saveExit") { finish(); return; }
    if (action === "details") { openSteps(event); return; }
    pendingFocus.current = "saved";
    scrollTop();
  }

  function submit(action: Action) {
    if (lock.current) return;
    const found = validateQuick(values);
    if (Object.keys(found).length) { setAlert(null); showErrors(found); return; }
    setLastAction(action);
    setAlert(null);
    const onError = (message: string) => { setAlert(message); pendingFocus.current = "alert"; };
    if (editingItem) {
      const item = editingItem;
      const payload = buildCorrection(item.event, values, defaults);
      void write(async () => {
        const updated = await eventsService.updateEvent(stakeId, item.event.id, payload, item.event.updatedAt);
        if (!updated) throw new Error(COPY.cambiataNelFrattempo);
        return updated;
      }, onError).then(updated => {
        if (!updated || !mounted.current) return;
        setRound(current => current.filter(entry => entry.event.id !== updated.id).concat({ event: updated, deleted: false, error: null }));
        afterSaved(updated, action);
      });
      return;
    }
    const payload = buildQuickPayload(values, defaults);
    // Stable id per attempt: «Riprova» after a timeout cannot add a second one.
    const id = creationId.current;
    void write(() => eventsService.createEvent(stakeId, payload, sessionUid, id), onError).then(created => {
      if (!created || !mounted.current) return;
      creationId.current = crypto.randomUUID();
      setRound(current => current.filter(entry => entry.event.id !== created.id).concat({ event: created, deleted: false, error: null }));
      afterSaved(created, action);
    });
  }

  function updateItem(id: string, patch: Partial<RoundItem>) {
    setRound(current => current.map(item => item.event.id === id ? { ...item, ...patch } : item));
  }

  function remove(item: RoundItem) {
    updateItem(item.event.id, { error: null });
    void write(() => eventsService.deleteAnnouncedEvent(stakeId, item.event.id, item.event.updatedAt).then(() => true),
      message => updateItem(item.event.id, { error: message })).then(done => {
      if (!done || !mounted.current) return;
      if (closeAfterWrite.current) { finish(); return; }
      updateItem(item.event.id, { deleted: true, error: null });
      setAnnouncement(`${item.event.title}: ${COPY.eliminata}`);
    });
  }

  function restore(item: RoundItem) {
    updateItem(item.event.id, { error: null });
    // Same id and same fields: the activity comes back as it was.
    void write(() => eventsService.createEvent(stakeId, item.event, sessionUid, item.event.id),
      message => updateItem(item.event.id, { error: message })).then(created => {
      if (!created || !mounted.current) return;
      if (closeAfterWrite.current) { finish(); return; }
      updateItem(item.event.id, { event: created, deleted: false, error: null });
      setAnnouncement(`${COPY.salvataTitolo}: ${created.title}`);
    });
  }

  function correct(item: RoundItem) {
    setEditingId(item.event.id);
    setValues(quickValuesFromEvent(item.event));
    setErrors({});
    setAlert(null);
    setView("form");
    pendingFocus.current = "name";
    scrollTop();
  }

  function addAnother() {
    setValues(current => blankValues(current.activityType, initialDate));
    setErrors({});
    setAlert(null);
    setEditingId(null);
    setView("form");
    pendingFocus.current = "name";
    scrollTop();
  }

  function openSteps(event: Event) {
    stepsReturned.current = false;
    setStepsEvent(event);
  }

  // The steps close with onClose, onCompleted or both: back once, round intact.
  function returnFromSteps() {
    if (stepsReturned.current || !stepsEvent) return;
    stepsReturned.current = true;
    const id = stepsEvent.id;
    changed.current = true;
    setStepsEvent(null);
    setView("saved");
    pendingFocus.current = "saved";
    // New revision for Elimina and Correggi; a failed read keeps the old one
    // (Elimina then says it changed, and writes nothing).
    eventsService.getEventById(stakeId, id, true).then(fresh => {
      if (!mounted.current) return;
      if (fresh) updateItem(id, { event: fresh, error: null });
      else setRound(current => current.filter(item => item.event.id !== id));
    }).catch(() => undefined);
  }

  function requestClose() {
    if (exitOpen) return;
    if (lock.current) { closeAfterWrite.current = true; return; }
    if (view === "form" && dirty) { setExitOpen(true); return; }
    finish();
  }

  function discardFields() {
    setExitOpen(false);
    setValues(current => blankValues(current.activityType, initialDate));
    setErrors({});
    setAlert(null);
    setEditingId(null);
    if (!round.length) { finish(); return; }
    setView("saved");
    pendingFocus.current = "saved";
    scrollTop();
  }

  if (stepsEvent) {
    return <AdminEventEditorModal organization={organization} stakeId={stakeId} sessionUid={sessionUid}
      initialEvent={stepsEvent} initialStep="firstTodo" onClose={returnFromSteps} onCompleted={returnFromSteps} />;
  }

  const savedCount = round.filter(item => !item.deleted).length;
  const primaryLabel = busy ? COPY.salvataggio : alert ? COPY.riprova : editingItem ? COPY.correzioneSalva : COPY.salva;
  const errorId = (key: keyof QuickErrors) => `${ids}-${key}-error`;
  const describe = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ") || undefined;
  const inputClass = (key: keyof QuickErrors) => errors[key] ? "wz-input wz-input--error" : "wz-input";

  const row = (item: RoundItem) => {
    const badge = dayBadge(item.event);
    const announced = isAnnouncedEvent(item.event);
    return <li key={item.event.id} className={item.deleted ? "qa-row qa-row--gone" : "qa-row"}>
      <b className="qa-row__day" aria-hidden="true">{badge.month}<em>{badge.day}</em></b>
      <div className="qa-row__text">
        <strong>{item.event.title}</strong>
        <small>{item.deleted ? COPY.eliminata
          : `${ACTIVITY_TYPES[item.event.activityType ?? "standard"].label} · ${formatEventWhen(item.event)}`}</small>
        {item.error ? <small className="wz-error" role="alert">{item.error}</small> : null}
      </div>
      {item.deleted
        ? <button type="button" className="wz-button wz-button--link" disabled={busy} onClick={() => restore(item)}>{COPY.rimetti}</button>
        : announced ? <button type="button" className="wz-button wz-button--link" disabled={busy} onClick={() => remove(item)}
          aria-label={`${COPY.elimina}: ${item.event.title}`}>{COPY.elimina}</button> : null}
    </li>;
  };

  const batch = listed.length ? <section className="qa-batch" aria-labelledby={`${ids}-batch`}>
    <h3 className="qa-batch__head" id={`${ids}-batch`}>{COPY.aggiunteAdesso} · {listed.length}</h3>
    <ul className="qa-batch__list">{listed.map(row)}</ul>
  </section> : null;

  const savedCard = last ? <div className="qa-saved">
    <img src={inviataUrl} alt="" />
    <div className="qa-saved__text">
      <h3 ref={savedRef} tabIndex={-1}>{last.deleted ? last.event.title : COPY.salvataTitolo}</h3>
      {last.deleted ? <p>{COPY.eliminata}</p> : <>
        <p><strong>{last.event.title}</strong> · {formatEventWhen(last.event)}</p>
        <p>{isAnnouncedEvent(last.event) ? COPY.salvataTesto : last.event.location || COPY.luogoDaDefinire}</p>
      </>}
      {last.error ? <p className="wz-error" role="alert">{last.error}</p> : null}
    </div>
    {last.deleted
      ? <div className="qa-saved__buttons"><button type="button" className="wz-button wz-button--soft" disabled={busy} onClick={() => restore(last)}>{COPY.rimetti}</button></div>
      : <>
        {isAnnouncedEvent(last.event) ? <div className="qa-saved__buttons">
          <button type="button" className="wz-button wz-button--soft" disabled={busy} onClick={() => correct(last)}>{COPY.correggi}</button>
          <button type="button" className="wz-button wz-button--soft" disabled={busy} onClick={() => remove(last)}>{COPY.elimina}</button>
        </div> : null}
        <button type="button" className="wz-button wz-button--link qa-saved__more" disabled={busy} onClick={() => openSteps(last.event)}>{COPY.completaDettagli}</button>
      </>}
  </div> : null;

  const form = <fieldset className="wz-fieldset qa-form" disabled={busy}>
    {alert ? <div ref={alertRef} tabIndex={-1} className="wz-alert" role="alert">{alert}</div> : null}
    {!editingItem ? <div className="qa-head">
      <h3>{COPY.rapidaTesta}</h3>
      <p>{COPY.rapidaTestaTesto}</p>
    </div> : null}
    <label className="wz-field">
      <span>{COPY.nome}</span>
      <input ref={nameRef} className={inputClass("title")} data-field="title" value={values.title} placeholder={COPY.nomePlaceholder}
        autoComplete="off" enterKeyHint="next" aria-invalid={errors.title ? true : undefined}
        aria-describedby={describe(errors.title && errorId("title"), duplicate && `${ids}-dup`)}
        onChange={event => set("title", event.target.value)} />
      <FieldError id={errorId("title")} message={errors.title} />
      {duplicate && !errors.title ? <small className="qa-warn" id={`${ids}-dup`}>{fillCopy(COPY.doppione, { titolo: duplicate.title })}</small> : null}
    </label>
    <fieldset className="wz-field">
      <legend>{COPY.tipo}</legend>
      <div className="qa-chips">
        {TYPE_ORDER.map(type => {
          const on = values.activityType === type;
          return <label key={type} className={on ? "qa-chip qa-chip--on" : "qa-chip"}>
            <input className="sr-only" type="radio" name={`${ids}-type`} checked={on} onChange={() => changeType(type)} />
            {ACTIVITY_TYPES[type].label}
          </label>;
        })}
      </div>
    </fieldset>
    <fieldset className="wz-when">
      <legend>{strong ? COPY.dal : COPY.quando}</legend>
      <div className="wz-when__line">
        <input className={inputClass("date")} data-field="date" type="date" value={values.date} aria-label={COPY.data}
          aria-invalid={errors.date ? true : undefined}
          aria-describedby={describe(errors.date && errorId("date"), past && `${ids}-past`, !strong && `${ids}-hour`)}
          onChange={event => set("date", event.target.value)} />
        <input className="wz-input" type="time" value={values.time} aria-label={`${COPY.ora} (${COPY.oraFacoltativa})`}
          aria-describedby={!strong ? `${ids}-hour` : undefined} onChange={event => set("time", event.target.value)} />
      </div>
      <FieldError id={errorId("date")} message={errors.date} />
      {past && !errors.date ? <small className="qa-warn" id={`${ids}-past`}>{COPY.dataPassata}</small> : null}
      {!strong ? <small className="wz-hint" id={`${ids}-hour`}>{COPY.oraSuggerimento}</small> : null}
    </fieldset>
    {strong ? <label className="wz-field">
      <span>{COPY.finoAl}</span>
      <input className={inputClass("endDate")} data-field="endDate" type="date" value={values.endDate} min={values.date || undefined}
        aria-invalid={errors.endDate ? true : undefined} aria-describedby={describe(errors.endDate && errorId("endDate"))}
        onChange={event => set("endDate", event.target.value)} />
      <FieldError id={errorId("endDate")} message={errors.endDate} />
    </label> : null}
    <label className="wz-field">
      <span>{COPY.luogo} <span className="qa-opt">{COPY.luogoFacoltativo}</span></span>
      <span className="wz-input-icon"><Icon name="map-pin" />
        <input className="wz-input" value={values.location} placeholder={COPY.luogoPlaceholder} autoComplete="off"
          onChange={event => set("location", event.target.value)} />
      </span>
    </label>
  </fieldset>;

  const footer = view === "form"
    ? <div className="qa-foot">
      <p className="qa-announce">{COPY.piedeAnnuncio}</p>
      <div className="qa-foot__buttons">
        <button type="button" className="wz-button wz-button--primary" disabled={busy} aria-busy={busy || undefined}
          onClick={() => submit(alert ? lastAction : "save")}>{primaryLabel}</button>
        {!editingItem ? <button type="button" className="wz-button wz-button--link" disabled={busy}
          onClick={() => submit("details")}>{COPY.aggiungiDettagli}</button> : null}
      </div>
    </div>
    : <div className="qa-foot">
      <div className="qa-foot__buttons">
        <button type="button" className="wz-button wz-button--primary" disabled={busy} onClick={addAnother}>{COPY.aggiungineUnAltra}</button>
        <button type="button" className="wz-button wz-button--link" disabled={busy} onClick={requestClose}>{COPY.fatto}</button>
      </div>
    </div>;

  return <>
    <AppModal title={COPY.rapidaTitolo} onClose={requestClose} className="app-modal--wizard app-modal--quick" footer={footer}>
      <div className="wz qa" ref={body}>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
        {view === "saved" && last ? savedCard : form}
        {batch}
      </div>
    </AppModal>

    {exitOpen ? <BottomSheet title={COPY.uscitaTitolo} lead={COPY.uscitaTesto} closeLabel={COPY.continuaCompilare} onClose={() => setExitOpen(false)}
      footer={<div className="wz-sheet-buttons">
        <button type="button" className="wz-button wz-button--primary wz-button--block" onClick={() => setExitOpen(false)}>{COPY.continuaCompilare}</button>
        {canSave ? <button type="button" className="wz-button wz-button--soft wz-button--block" onClick={() => { setExitOpen(false); submit("saveExit"); }}>
          {COPY.salvaEdEsci}</button> : null}
        <button type="button" className="wz-button wz-button--link wz-button--block" onClick={discardFields}>{COPY.scartaCampi}</button>
      </div>}>
      <ul className="wz-changes">
        {savedCount > 0 ? <li>{savedCount === 1 ? COPY.uscitaGiroUna : fillCopy(COPY.uscitaGiro, { n: String(savedCount) })}</li> : null}
        {canSave && !editingItem ? <li>{COPY.piedeAnnuncio}</li> : null}
      </ul>
    </BottomSheet> : null}
  </>;
}
