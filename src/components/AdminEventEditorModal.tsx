import { useEffect, useMemo, useRef, useState } from "react";

import { AppModal } from "@/components/AppModal";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { BottomSheet } from "@/components/register/BottomSheet";
import { Icon } from "@/components/ui";
import { StepIndexList, StepParticipants, StepPoster, StepRegistrations, StepReview, StepWhat, StepWhen, type SetValue } from "@/components/activityWizard/WizardSteps";
import { LEGAL_DOC_VERSIONS } from "@/constants/legalDocs";
import { ANNUNCIATA } from "@/copy/annunciata";
import { ACTIVITY_TYPES, EVENT_CREATION as COPY } from "@/copy/eventCreation";
import { fillCopy } from "@/copy/parole";
import { storageService } from "@/services/firebase/storageService";
import { eventFormsService, getDefaultEventFormConfig } from "@/services/firestore/eventFormsService";
import { eventsService } from "@/services/firestore/eventsService";
import type { ActivityType, CustomField, Event, EventFormConfig, OrganizationProfile } from "@/types";
import {
  STEP_FIELDS,
  WIZARD_STEPS,
  buildWizardFormPayload,
  buildWizardPayload,
  countActiveRegistrations,
  getInitialWizardValues,
  getPublicationChecklist,
  getStepSummaries,
  getTypeChangeEffects,
  hasOvernight,
  isStepDirty,
  stepNeedsDraft,
  stepNumber,
  validateWizardStep,
  type FieldErrors,
  type WizardStepId,
  type WizardValues,
} from "@/utils/activityWizard";
import { getAdminActionError } from "@/utils/adminErrors";
import { getAnnouncementIssues, getPublicationIssues } from "@/utils/eventCreation";
import { isAnnouncedEvent } from "@/utils/events";
import { getVisibleStandardFieldDefinitions, isRoomRelatedStandardFieldKey } from "@/utils/formFields";
import { isOffline, withWriteTimeout, WRITE_TIMEOUT_CODE } from "@/utils/writeTimeout";
import "@/styles/activityWizard.css";

interface AdminEventEditorModalProps {
  organization: OrganizationProfile;
  stakeId: string;
  sessionUid: string;
  initialEvent?: Event | null;
  initialFormConfig?: EventFormConfig | null;
  /**
   * overview and preview open step 6; options opens step 5; firstTodo opens
   * the first step with something to complete (step 6 when none is left);
   * a step id opens that step.
   */
  initialStep?: "overview" | "options" | "preview" | "firstTodo" | WizardStepId;
  /** With initialStep "options": the field to focus (Alloggio). */
  focusField?: "roomsInfo";
  /** Active registrations, for the notices of decision 3 and of a draft with registrations. */
  activeRegistrations?: number;
  onClose: () => void;
  /** `notice`: what to tell after closing (Esci from an announced activity). */
  onCompleted?: (eventId: string, notice?: string) => void;
}

type Confirm =
  | { kind: "discardNew"; canCreate: boolean }
  | { kind: "leaveStep"; then: () => void }
  | { kind: "discardReturn" }
  | { kind: "unpublish" }
  | { kind: "announce" }
  | { kind: "cancel" };

const REQUIREMENT_KEYS = ["requiresAccount", "requiresParentAuthorization", "requiresEmergencyContacts", "requiresMedicalNotes", "requiresImageConsent"] as const;

// Account/activity changes dispose the previous editing context and its callbacks.
export function AdminEventEditorModal(props: AdminEventEditorModalProps) {
  return <ActivityWizardSession key={`${props.sessionUid}:${props.stakeId}:${props.initialEvent?.id ?? "new"}`} {...props} />;
}

function firstStep(initialEvent: Event | null | undefined, initialStep: AdminEventEditorModalProps["initialStep"]): WizardStepId {
  if (!initialEvent) return "what";
  if (initialStep === "options") return "participants";
  if (initialStep === "firstTodo") return getStepSummaries(initialEvent).find(item => item.state === "todo")?.step ?? "review";
  if (initialStep && (WIZARD_STEPS as readonly string[]).includes(initialStep)) return initialStep as WizardStepId;
  return "review";
}

function ActivityWizardSession({ organization, stakeId, sessionUid, initialEvent, initialFormConfig, initialStep, focusField, activeRegistrations, onClose, onCompleted }: AdminEventEditorModalProps) {
  const fieldDefinitions = useMemo(() => getVisibleStandardFieldDefinitions(organization.registrationDefaults.fieldOverrides), [organization.registrationDefaults.fieldOverrides]);
  const defaults = useMemo(() => ({
    allowGuestRegistration: organization.registrationDefaults.allowGuestRegistration,
    enabledStandardFields: getDefaultEventFormConfig(organization.registrationDefaults).enabledStandardFields,
  }), [organization.registrationDefaults]);
  const [savedEvent, setSavedEvent] = useState<Event | null>(initialEvent ?? null);
  const [formConfig, setFormConfig] = useState<EventFormConfig | null>(initialFormConfig ?? null);
  const savedValues = useMemo(() => getInitialWizardValues(savedEvent, formConfig, defaults), [savedEvent, formConfig, defaults]);
  const emptyValues = useMemo(() => getInitialWizardValues(null, null, defaults), [defaults]);
  const [values, setValues] = useState<WizardValues>(savedValues);
  const [step, setStep] = useState<WizardStepId>(firstStep(initialEvent, initialStep));
  const [returnToReview, setReturnToReview] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(!initialEvent);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [guestReviewed, setGuestReviewed] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null);
  const [typeSheet, setTypeSheet] = useState<{ next: ActivityType; effects: NonNullable<ReturnType<typeof getTypeChangeEffects>> } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [now] = useState(() => Date.now());
  const pending = useRef<{ promise: Promise<void>; completed: () => void; fallback: string } | null>(null);
  const runLock = useRef(false);
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const creationId = useRef(crypto.randomUUID());
  const stagedImages = useRef(new Set<string>());
  const committedImage = useRef(initialEvent?.heroImagePath ?? "");
  const pendingImage = useRef("");
  const uploadToken = useRef(0);
  const pendingFocus = useRef(initialStep === "options" ? focusField : undefined);
  const registrationsCount = activeRegistrations ?? countActiveRegistrations(savedEvent);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const path of stagedImages.current) {
        if (path !== committedImage.current && path !== pendingImage.current) void storageService.deleteFile(path).catch(() => undefined);
      }
    };
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    content.current?.closest(".app-modal__body")?.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    if (initialEvent) void run(() => refreshSavedEvent(initialEvent.id, "all"), () => setRefreshed(true), COPY.loadError);
  }, []);

  const locked = busy || waiting || !refreshed;
  useEffect(() => {
    if (!pendingFocus.current || step !== "participants" || locked) return;
    const field = content.current?.querySelector<HTMLElement>(`[data-focus-field="${pendingFocus.current}"]`);
    if (!field) return;
    pendingFocus.current = undefined;
    field.focus();
  }, [step, locked]);

  /**
   * Activity first, then the form, both from the server: a concurrent change
   * can leave an older revision (rejected by the next write), never a newer
   * revision paired with an older cached form. `sync` says which steps take
   * the saved values; the others keep what is being typed.
   */
  async function refreshSavedEvent(eventId: string, sync: "all" | ReadonlySet<WizardStepId>) {
    const event = await eventsService.getEventById(stakeId, eventId, true);
    if (!event) throw new Error("Attività non disponibile.");
    const config = await eventFormsService.getFormConfig(stakeId, eventId, true);
    if (!mounted.current) return;
    const merged = { ...event, allowGuestRegistration: config.allowGuestRegistration, requireLoginForEdit: config.requireLoginForEdit };
    setSavedEvent(merged);
    setFormConfig(config);
    const fresh = getInitialWizardValues(merged, config, defaults);
    setValues(current => {
      if (sync === "all") return fresh;
      const next = { ...current };
      for (const synced of sync) for (const key of STEP_FIELDS[synced]) (next as Record<string, unknown>)[key] = fresh[key];
      return next;
    });
  }

  // A retry after a timeout awaits the SAME write. It cannot create another
  // activity, publish before an earlier save, or overwrite edits out of order.
  async function run(work: () => Promise<void>, completed: () => void, fallback: string) {
    if (runLock.current) return;
    if (isOffline() && !pending.current) { setError(getAdminActionError({ code: "unavailable" }, fallback)); return; }
    runLock.current = true;
    setBusy(true); setError(null); setConflict(false); setFeedback(null);
    const action = pending.current ?? { promise: Promise.resolve().then(work), completed, fallback };
    pending.current = action;
    try {
      await withWriteTimeout(action.promise);
      if (!mounted.current) return;
      pending.current = null; setWaiting(false);
      action.completed();
    } catch (caughtError) {
      if (!mounted.current) return;
      if ((caughtError as { code?: string })?.code === WRITE_TIMEOUT_CODE) setWaiting(true);
      else { pending.current = null; setWaiting(false); }
      const message = getAdminActionError(caughtError, action.fallback);
      if (message === COPY.revisionConflict) { setConflict(true); setError(COPY.revisionConflictReload); } else setError(message);
    } finally {
      runLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const set: SetValue = (key, value) => {
    setValues(current => ({ ...current, [key]: value }));
    setErrors(current => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFeedback(null);
  };

  const guestReviewMissing = values.recordsEnabled && values.recordsGuestEnabled && savedEvent?.recordsGuestEnabled !== true && !guestReviewed;
  // An activity that exists already (announced from the quick sheet, or a
  // draft) needs the place only to open registrations: it is in the checklist.
  const validate = (target: WizardStepId) => validateWizardStep(target, values, { guestReviewMissing, locationOptional: Boolean(savedEvent) });
  const dirty = (target: WizardStepId) => savedEvent ? isStepDirty(target, values, savedValues) : isStepDirty(target, values, emptyValues);
  const stepDirty = dirty(step);
  const hasTyped = WIZARD_STEPS.some(target => dirty(target));

  function showErrors(found: FieldErrors) {
    setErrors(found);
    const first = Object.keys(found)[0];
    if (!first) return;
    requestAnimationFrame(() => {
      const field = content.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)
        ?? content.current?.querySelector<HTMLElement>("[aria-invalid='true'], .wz-error");
      field?.focus();
      field?.scrollIntoView({ block: "center" });
    });
  }

  function validSteps() {
    return new Set(WIZARD_STEPS.filter(target => Object.keys(validate(target)).length === 0));
  }

  function goTo(target: WizardStepId, options: { fromReview?: boolean } = {}) {
    setErrors({});
    setEditingQuestion(null);
    setReturnToReview(Boolean(options.fromReview));
    setStep(target);
  }

  /** Saves the steps that are valid (always including `target`), then `after`. */
  function save(target: WizardStepId, after: () => void) {
    const event = savedEvent;
    if (!event) return;
    const steps = validSteps();
    const payload = buildWizardPayload(values, event, steps, LEGAL_DOC_VERSIONS);
    if (event.isPublic && !isAnnouncedEvent(event)) {
      // A published activity must stay publishable: an emptied description or
      // window is refused here, on the step that holds it. An announced one is
      // completed step by step: what is missing stays in the checklist.
      const issues = getPublicationIssues({ ...payload, status: "draft" });
      if (issues.length) { setError(issues.join(" ")); return; }
    }
    const form = steps.has("registrations") && isStepDirty("registrations", values, savedValues)
      ? { ...buildWizardFormPayload(values), standardFieldDefinitions: fieldDefinitions }
      : { standardFieldDefinitions: fieldDefinitions };
    void run(async () => {
      pendingImage.current = payload.heroImagePath ?? "";
      const updated = await eventsService.updateEvent(stakeId, event.id, payload, event.updatedAt, form);
      if (!updated) throw new Error("Impossibile rileggere l'attività aggiornata.");
      committedImage.current = updated.heroImagePath;
      pendingImage.current = "";
      stagedImages.current.delete(updated.heroImagePath);
      await refreshSavedEvent(event.id, steps);
    }, () => { setGuestReviewed(false); after(); }, COPY.saveError);
  }

  function createDraft(after: (eventId: string) => void) {
    const whatErrors = validate("what");
    if (Object.keys(whatErrors).length) { goTo("what"); showErrors(whatErrors); return; }
    // Every valid step goes in: the requirements switched on by the type
    // (step 4) must be written with the draft, not only kept in memory.
    const payload = buildWizardPayload(values, null, validSteps(), LEGAL_DOC_VERSIONS, defaults);
    void run(async () => {
      // Stable id: a retry after a timeout reuses it and cannot create a second draft.
      await eventsService.createEvent(stakeId, payload, sessionUid, creationId.current);
      await refreshSavedEvent(creationId.current, "all");
    }, () => after(creationId.current), COPY.saveError);
  }

  function next() {
    const found = validate(step);
    if (Object.keys(found).length) { showErrors(found); return; }
    const index = WIZARD_STEPS.indexOf(step);
    const target = returnToReview ? "review" : WIZARD_STEPS[Math.min(index + 1, WIZARD_STEPS.length - 1)];
    if (!savedEvent) {
      if (step === "what") { goTo("when"); return; }
      createDraft(() => goTo("poster"));
      return;
    }
    if (stepDirty) save(step, () => goTo(target));
    else goTo(target);
  }

  function back() {
    if (returnToReview) {
      if (stepDirty) setConfirm({ kind: "discardReturn" });
      else goTo("review");
      return;
    }
    const index = WIZARD_STEPS.indexOf(step);
    if (index === 0) return;
    const target = WIZARD_STEPS[index - 1];
    // A valid step is saved on the way back; an invalid one keeps its fields
    // in memory and is left out of every save until it is fixed.
    if (savedEvent && stepDirty && Object.keys(validate(step)).length === 0) save(step, () => goTo(target));
    else goTo(target);
  }

  function resetStep(target: WizardStepId) {
    setValues(current => {
      const nextValues = { ...current };
      for (const key of STEP_FIELDS[target]) (nextValues as Record<string, unknown>)[key] = savedValues[key];
      return nextValues;
    });
    setErrors({});
  }

  function finish(notice?: string) {
    if (savedEvent) onCompleted?.(savedEvent.id, notice);
    // A queued creation has a stable id and already appears in the local list.
    else if (waiting) onCompleted?.(creationId.current);
    onClose();
  }

  function finishCreated(eventId: string) {
    onCompleted?.(eventId);
    onClose();
  }

  function requestExit() {
    if (runLock.current || uploading) return;
    if (waiting) { finish(); return; }
    if (!savedEvent) {
      if (!hasTyped) { onClose(); return; }
      const canCreate = Object.keys(validate("what")).length === 0 && Object.keys(validate("when")).length === 0;
      setConfirm({ kind: "discardNew", canCreate });
      return;
    }
    // A step left invalid with Indietro keeps its fields in memory: closing
    // asks before losing them, like the current step.
    const invalidDirty = WIZARD_STEPS.some(target => dirty(target) && Object.keys(validate(target)).length > 0);
    // Esci from an announced activity: what was saved is already visible.
    const notice = isAnnouncedEvent(savedEvent) ? ANNUNCIATA.esciSalvata : undefined;
    if (invalidDirty) { setConfirm({ kind: "leaveStep", then: () => finish(notice) }); return; }
    if (!stepDirty) { finish(notice); return; }
    save(step, () => finish(notice));
  }

  function jump(target: WizardStepId) {
    setIndexOpen(false);
    if (target === step) return;
    if (!savedEvent && stepNeedsDraft(target)) return;
    if (!savedEvent || !stepDirty) { goTo(target); return; }
    const found = validate(step);
    if (Object.keys(found).length) { setConfirm({ kind: "leaveStep", then: () => { resetStep(step); goTo(target); } }); return; }
    save(step, () => goTo(target));
  }

  function changeType(nextType: ActivityType) {
    if (nextType === values.activityType) return;
    const effects = getTypeChangeEffects(values.activityType, nextType, values);
    if (!effects) { set("activityType", nextType); return; }
    if (savedEvent) { setTypeSheet({ next: nextType, effects }); return; }
    applyType(nextType, effects);
  }

  function applyType(nextType: ActivityType, effects: NonNullable<ReturnType<typeof getTypeChangeEffects>>) {
    setValues(current => ({
      ...current,
      activityType: nextType,
      ...effects.requirements,
      allowGuestRegistration: effects.requirements.requiresAccount ? false : current.allowGuestRegistration,
      roomsInfo: effects.clearsRooms ? "" : current.roomsInfo,
    }));
  }

  async function handlePick(file: File) {
    const token = ++uploadToken.current;
    setUploading(true);
    setUploadError(null);
    try {
      // No previousPath: the saved poster stays until the step is saved.
      const image = await storageService.uploadEventImage({ file, uploadedBy: sessionUid, stakeId, eventId: savedEvent?.id });
      stagedImages.current.add(image.path);
      if (!mounted.current || token !== uploadToken.current) {
        if (image.path !== committedImage.current) void storageService.deleteFile(image.path).catch(() => undefined);
        return;
      }
      set("heroImageUrl", image.url);
      set("heroImagePath", image.path);
    } catch (caughtError) {
      if (mounted.current && token === uploadToken.current) setUploadError(caughtError instanceof Error && caughtError.message ? caughtError.message : COPY.posterError);
    } finally {
      if (mounted.current && token === uploadToken.current) setUploading(false);
    }
  }

  function cancelUpload() {
    uploadToken.current += 1;
    setUploading(false);
  }

  // «Apri le iscrizioni»: a draft or an announced activity becomes open.
  function publish() {
    if (!savedEvent || (savedEvent.isPublic && !isAnnouncedEvent(savedEvent)) || getPublicationChecklist(savedEvent, Date.now()).length) return;
    const event = savedEvent;
    void run(async () => { await eventsService.publishEvent(stakeId, event.id, event.updatedAt); }, () => finish(),
      isAnnouncedEvent(event) ? COPY.openRegistrationsError : COPY.publishError);
  }

  function unpublish() {
    if (!savedEvent) return;
    const event = savedEvent;
    setConfirm(null);
    void run(async () => {
      await eventsService.unpublishEvent(stakeId, event.id, event.updatedAt);
      await refreshSavedEvent(event.id, "all");
    }, () => setFeedback(isAnnouncedEvent(event) ? ANNUNCIATA.togliFatto : COPY.unpublished), COPY.unpublishError);
  }

  // «Annuncia», from a draft or back from open registrations (only without
  // registrations: the service counts them again and refuses otherwise).
  function announce() {
    if (!savedEvent) return;
    const event = savedEvent;
    setConfirm(null);
    void run(async () => {
      try {
        await eventsService.announceEvent(stakeId, event.id, event.updatedAt);
      } catch (caughtError) {
        // A refused announcement may have written and reverted (a registration
        // arrived meanwhile): read the new revision before the next tap.
        await refreshSavedEvent(event.id, "all").catch(() => undefined);
        throw caughtError;
      }
      await refreshSavedEvent(event.id, "all");
    }, () => setFeedback(ANNUNCIATA.annunciaFatto), COPY.announceError);
  }

  function setCancelled(cancelled: boolean) {
    if (!savedEvent) return;
    const event = savedEvent;
    setConfirm(null);
    void run(async () => {
      await eventsService.setEventCancelled(stakeId, event.id, cancelled, event.updatedAt);
      await refreshSavedEvent(event.id, "all");
    }, () => setFeedback(cancelled ? COPY.cancelledNotice : COPY.reopened), COPY.saveError);
  }

  function reload() {
    if (!savedEvent) return;
    const event = savedEvent;
    // Steps with something typed keep it (the open one and any left invalid);
    // the others take the server version.
    const untouched = new Set(WIZARD_STEPS.filter(target => target !== step && !dirty(target)));
    void run(() => refreshSavedEvent(event.id, untouched), () => undefined, COPY.loadError);
  }

  function retryOpen() {
    if (!initialEvent) return;
    void run(() => refreshSavedEvent(initialEvent.id, "all"), () => setRefreshed(true), COPY.loadError);
  }

  // Notices of decision 3 (new requirements apply to new registrations only)
  // and of a form changed after registrations started.
  const turnedOn = REQUIREMENT_KEYS.some(key => values[key] && !savedValues[key]);
  const requirementNotice = savedEvent && registrationsCount > 0 && turnedOn
    ? registrationsCount === 1 ? COPY.newRequirementsNoticeOne : fillCopy(COPY.newRequirementsNotice, { n: String(registrationsCount) })
    : null;
  const formChanged = JSON.stringify(values.enabledStandardFields) !== JSON.stringify(savedValues.enabledStandardFields)
    || JSON.stringify(values.customFields) !== JSON.stringify(savedValues.customFields);
  const registrationNotices = [requirementNotice, savedEvent && registrationsCount > 0 && formChanged ? COPY.existingAnswersNotice : null].filter((text): text is string => Boolean(text));

  const summaries = getStepSummaries(savedEvent, now);
  const checks = savedEvent ? getPublicationChecklist(savedEvent, Date.now()) : [];
  const questionCount = savedValues.customFields.length + savedValues.enabledStandardFields.filter(key => key !== "parentConfirmed").length;
  const announced = Boolean(savedEvent && isAnnouncedEvent(savedEvent));
  // Open, or cancelled/completed after being public: step 6 is «Gestisci».
  const managing = Boolean(savedEvent?.isPublic) && !announced;
  const kicker = !savedEvent ? COPY.kickerNew
    : fillCopy(announced ? ANNUNCIATA.passiKicker : savedEvent.isPublic ? COPY.kickerPublished : COPY.kickerDraft, { titolo: savedEvent.title });
  const stepLabel = (target: WizardStepId) => target !== "review" ? COPY.steps[target] : managing ? COPY.steps.manage : announced ? COPY.reviewAnnounced : COPY.steps.review;
  const overnight = hasOvernight(values);
  const addable = fieldDefinitions.filter(field => !values.enabledStandardFields.includes(field.key) && field.key !== "parentConfirmed"
    && (overnight || !isRoomRelatedStandardFieldKey(field.key))
    && !(field.key === "genderRoleCategory" && values.audience !== "congiunta"));
  const optionalEmpty = step === "participants" && !stepDirty && STEP_FIELDS.participants.every(key => !values[key]);

  function addCustomQuestion() {
    const field: CustomField = { id: `custom-${crypto.randomUUID()}`, key: "", label: "", type: "shortText", required: false, helpText: "", options: [] };
    set("customFields", [...values.customFields, field]);
    setEditingQuestion(field.id);
    setAddOpen(false);
  }

  const savedPill = savedEvent && !stepDirty && !busy ? <span className="wz-saved" role="status"><Icon name="check" />{COPY.saved}</span> : null;
  const stepper = <div className="wz-top">
    <div className="wz-top__row">
    <button type="button" className="wz-stepper" aria-haspopup="dialog" aria-label={`${fillCopy(COPY.stepOf, { n: String(stepNumber(step)) })} · ${stepLabel(step)}. ${COPY.openIndex}`}
      onClick={() => setIndexOpen(true)} disabled={busy}>
      <strong>{fillCopy(COPY.stepOf, { n: String(stepNumber(step)) })}</strong>
      <span>· {stepLabel(step)}</span>
      <Icon name="arrow-right" />
    </button>
    </div>
    <div className="wz-progress" aria-hidden="true">
      {WIZARD_STEPS.map((target, index) => {
        const summary = summaries[index];
        const current = WIZARD_STEPS.indexOf(step);
        const className = index === current ? "now" : index < current && summary.state === "optional" ? "skip" : index < current || summary.state === "done" && savedEvent ? "done" : "";
        return <i key={target} className={className} />;
      })}
    </div>
  </div>;

  const primaryLabel = busy ? (savedEvent ? COPY.saving : COPY.creating)
    : returnToReview ? COPY.saveAndReturn
      : !savedEvent && step === "when" ? COPY.createDraft
        : optionalEmpty ? COPY.skip : COPY.next;
  const footer = <div className="wz-foot">
    {step === "review"
      ? <>
        <button type="button" className={managing ? "wz-button wz-button--soft wz-button--block" : "wz-button wz-button--ghost"} disabled={locked}
          onClick={() => managing ? finish() : goTo("participants")}>
          {managing ? COPY.close : <><Icon name="arrow-left" />{COPY.back}</>}
        </button>
        {/* «Apri le iscrizioni», for a draft and for an announced activity:
            switched off, with the reasons above, until the checklist is empty. */}
        {!managing ? <button type="button" className="wz-button wz-button--primary" disabled={locked || checks.length > 0} onClick={publish}>
          {busy ? COPY.saving : ANNUNCIATA.apriIscrizioni}
        </button> : null}
      </>
      : <>
        {step !== "what" || returnToReview ? <button type="button" className="wz-button wz-button--ghost" disabled={locked || uploading} onClick={back}>
          {returnToReview ? COPY.backToReview : <><Icon name="arrow-left" />{COPY.back}</>}
        </button> : null}
        <button type="button" className="wz-button wz-button--primary" disabled={locked || uploading} onClick={next}>
          {primaryLabel}{!busy && !returnToReview && !(!savedEvent && step === "when") ? <Icon name="arrow-right" /> : null}
        </button>
      </>}
  </div>;

  const ended = savedEvent?.status === "cancelled" || savedEvent?.status === "completed";
  // «Annuncia»: from a draft (name and day are enough), or back from open
  // registrations only while nobody is registered.
  const canAnnounceDraft = Boolean(savedEvent && !savedEvent.isPublic && !ended && !getAnnouncementIssues(savedEvent).length);
  const openRegistrations = Boolean(savedEvent?.isPublic && savedEvent.status === "registrations_open");
  const manage = savedEvent && (savedEvent.isPublic || savedEvent.status === "cancelled" || canAnnounceDraft) ? <div className="wz-manage">
    {canAnnounceDraft || openRegistrations
      ? <button type="button" className="wz-button wz-button--soft" disabled={locked || (openRegistrations && registrationsCount > 0)}
        aria-describedby={openRegistrations && registrationsCount > 0 ? "wz-announce-blocked" : undefined}
        onClick={() => setConfirm({ kind: "announce" })}>{ANNUNCIATA.annuncia}</button> : null}
    {savedEvent.isPublic && savedEvent.status !== "cancelled" && savedEvent.status !== "completed"
      ? <button type="button" className="wz-button wz-button--soft" disabled={locked} onClick={() => setConfirm({ kind: "unpublish" })}>{COPY.unpublish}</button> : null}
    {savedEvent.status === "cancelled"
      ? <button type="button" className="wz-button wz-button--soft" disabled={locked} onClick={() => setCancelled(false)}>{COPY.reopen}</button>
      : savedEvent.isPublic && savedEvent.status !== "completed"
        ? <button type="button" className="wz-button wz-button--link wz-button--danger" disabled={locked} onClick={() => setConfirm({ kind: "cancel" })}>{COPY.cancelActivity}</button>
        : null}
    {openRegistrations && registrationsCount > 0 ? <small className="wz-manage__note" id="wz-announce-blocked">{ANNUNCIATA.annunciaConIscritti}</small> : null}
  </div> : null;

  return <>
    <AppModal title={kicker} onClose={requestExit} size="wide" className="app-modal--wizard" headerExtra={stepper} titleExtra={savedPill} footer={footer}>
      <div className="wz" ref={content}>
        {error ? <div ref={errorRef} tabIndex={-1} className="wz-alert" role="alert">
          <span>{error}</span>
          {conflict ? <button type="button" className="wz-button wz-button--soft" disabled={busy} onClick={reload}>{COPY.reload}</button> : null}
          {!refreshed && !waiting ? <button type="button" className="wz-button wz-button--soft" disabled={busy} onClick={retryOpen}>{COPY.retry}</button> : null}
        </div> : null}
        {feedback ? <div className="wz-success" role="status">{feedback}</div> : null}
        {waiting ? <button className="wz-button wz-button--primary" type="button" disabled={busy}
          onClick={() => void run(() => Promise.resolve(), () => undefined, COPY.saveError)}>{busy ? COPY.checking : COPY.checkSave}</button> : null}
        <fieldset className="wz-fieldset" disabled={locked}>
          {step === "what" ? <StepWhat values={values} set={set} errors={errors} headingRef={headingRef} onTypeChange={changeType} notice={requirementNotice} /> : null}
          {step === "when" ? <StepWhen values={values} set={set} errors={errors} headingRef={headingRef} hasDraft={Boolean(savedEvent)} onTypeSuggestion={changeType} /> : null}
          {step === "poster" ? <StepPoster values={values} set={set} errors={errors} headingRef={headingRef} uploading={uploading} uploadError={uploadError}
            disabled={locked} onPick={file => void handlePick(file)} onCancelUpload={cancelUpload} /> : null}
          {step === "registrations" ? <StepRegistrations values={values} set={set} errors={errors} headingRef={headingRef} fieldDefinitions={fieldDefinitions} stakeFields={defaults.enabledStandardFields}
            onAddQuestion={() => setAddOpen(true)} editingQuestion={editingQuestion} setEditingQuestion={setEditingQuestion} notices={registrationNotices} /> : null}
          {step === "participants" ? <StepParticipants values={values} set={set} errors={errors} headingRef={headingRef} event={savedEvent}
            focusRooms={focusField === "roomsInfo" && initialStep === "options"} guestReviewed={guestReviewed} onGuestReviewed={next => {
              setGuestReviewed(next);
              if (next) setErrors(current => { const copy = { ...current }; delete copy.recordsGuestReviewed; return copy; });
            }} /> : null}
          {step === "review" && savedEvent ? <StepReview event={savedEvent} headingRef={headingRef} checks={checks} now={Date.now()} questionCount={questionCount}
            onEdit={target => goTo(target, { fromReview: true })} manage={manage} returningCount={savedEvent.isPublic ? 0 : registrationsCount} /> : null}
          {announced && step !== "review" ? <p className="wz-announce">{ANNUNCIATA.passiAvviso}</p> : null}
        </fieldset>
      </div>
    </AppModal>

    {indexOpen ? <BottomSheet title={COPY.index.title} closeLabel={COPY.index.close} onClose={() => setIndexOpen(false)}
      footer={<button type="button" className="wz-button wz-button--ghost wz-button--block" onClick={() => setIndexOpen(false)}>{COPY.index.close}</button>}>
      <StepIndexList summaries={summaries} current={step} hasDraft={Boolean(savedEvent)} onPick={jump} labelOf={stepLabel} />
    </BottomSheet> : null}

    {addOpen ? <BottomSheet title={COPY.addQuestionTitle} lead={COPY.addQuestionLead} closeLabel={COPY.close} onClose={() => setAddOpen(false)}
      footer={<button type="button" className="wz-button wz-button--ghost wz-button--block" onClick={() => setAddOpen(false)}>{COPY.close}</button>}>
      <ul className="wz-plist">
        {addable.map(field => <li key={field.key}>
          <button type="button" className="wz-pitem" onClick={() => { set("enabledStandardFields", [...values.enabledStandardFields, field.key]); setAddOpen(false); }}>
            <span className="wz-pitem__n" aria-hidden="true"><Icon name="plus" /></span>
            <span><strong>{field.label}</strong>{field.helpText ? <small>{field.helpText}</small> : null}</span>
          </button>
        </li>)}
        <li><button type="button" className="wz-pitem" onClick={addCustomQuestion}>
          <span className="wz-pitem__n" aria-hidden="true"><Icon name="pencil" /></span>
          <span><strong>{COPY.ownQuestion}</strong><small>{COPY.ownQuestionHint}</small></span>
        </button></li>
      </ul>
    </BottomSheet> : null}

    {typeSheet ? <BottomSheet title={fillCopy(COPY.typeChangeTitle, { tipo: ACTIVITY_TYPES[typeSheet.next].label })} closeLabel={fillCopy(COPY.typeChangeKeep, { tipo: ACTIVITY_TYPES[values.activityType].label })}
      onClose={() => setTypeSheet(null)}
      footer={<div className="wz-sheet-buttons">
        <button type="button" className="wz-button wz-button--primary wz-button--block" onClick={() => setTypeSheet(null)}>{fillCopy(COPY.typeChangeKeep, { tipo: ACTIVITY_TYPES[values.activityType].label })}</button>
        <button type="button" className="wz-button wz-button--link wz-button--block" onClick={() => { applyType(typeSheet.next, typeSheet.effects); setTypeSheet(null); }}>{fillCopy(COPY.typeChangeConfirm, { tipo: ACTIVITY_TYPES[typeSheet.next].label })}</button>
      </div>}>
      <ul className="wz-changes">
        <li>{typeSheet.effects.turnsOn ? COPY.typeChangeOn : COPY.typeChangeOff}</li>
        {typeSheet.effects.clearsRooms ? <li>{COPY.typeChangeRooms}</li> : null}
        <li>{typeSheet.effects.turnsOn ? COPY.typeChangeManualOn : COPY.typeChangeManual}</li>
        {registrationsCount > 0 && typeSheet.effects.turnsOn ? <li>{registrationsCount === 1 ? COPY.newRequirementsNoticeOne : fillCopy(COPY.newRequirementsNotice, { n: String(registrationsCount) })}</li> : null}
      </ul>
    </BottomSheet> : null}

    {confirm?.kind === "discardNew" ? <ConfirmSheet title={COPY.discardNewTitle} body={COPY.discardNewBody} cancelLabel={COPY.keepEditing} confirmLabel={COPY.discardNew} tone="danger"
      onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); onClose(); }}>
      {confirm.canCreate ? <button type="button" className="wz-button wz-button--soft wz-button--block" onClick={() => { setConfirm(null); createDraft(finishCreated); }}>{COPY.createAndExit}</button> : null}
    </ConfirmSheet> : null}
    {confirm?.kind === "leaveStep" ? <ConfirmSheet title={COPY.leaveStepTitle} body={COPY.leaveStepBody} cancelLabel={COPY.keepEditing} confirmLabel={COPY.leaveStep} tone="danger"
      onCancel={() => setConfirm(null)} onConfirm={() => { const then = confirm.then; setConfirm(null); then(); }} /> : null}
    {confirm?.kind === "discardReturn" ? <ConfirmSheet title={COPY.discardReturnTitle} body={COPY.discardReturnBody} cancelLabel={COPY.keepEditing} confirmLabel={COPY.discardReturn} tone="danger"
      onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); resetStep(step); goTo("review"); }} /> : null}
    {confirm?.kind === "unpublish" ? <ConfirmSheet title={COPY.unpublishTitle} body={COPY.unpublishBody} cancelLabel={announced ? ANNUNCIATA.togliSceltaSicura : COPY.unpublishKeep}
      confirmLabel={COPY.unpublish} tone="danger" onCancel={() => setConfirm(null)} onConfirm={unpublish} /> : null}
    {/* Safe choice first; scrim and Indietro keep the activity as it is. */}
    {confirm?.kind === "announce" ? <ConfirmSheet title={openRegistrations ? ANNUNCIATA.annunciaDaAperteTitolo : ANNUNCIATA.annunciaDaBozzaTitolo}
      body={openRegistrations ? ANNUNCIATA.annunciaDaAperteTesto : ANNUNCIATA.annunciaDaBozzaTesto}
      cancelLabel={openRegistrations ? ANNUNCIATA.lasciaAperte : ANNUNCIATA.lasciaInBozza} confirmLabel={ANNUNCIATA.annuncia}
      onCancel={() => setConfirm(null)} onConfirm={announce} /> : null}
    {confirm?.kind === "cancel" ? <ConfirmSheet title={COPY.cancelTitle} body={COPY.cancelBody} cancelLabel={COPY.cancelKeep} confirmLabel={COPY.cancelActivity} tone="danger"
      onCancel={() => setConfirm(null)} onConfirm={() => setCancelled(true)} /> : null}
  </>;
}
