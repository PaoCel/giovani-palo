import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AppModal } from "@/components/AppModal";
import { AppIcon } from "@/components/AppIcon";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { EssentialEventForm } from "@/components/EssentialEventForm";
import { EventEditorForm } from "@/components/EventEditorForm";
import { EventFormConfigEditor } from "@/components/EventFormConfigEditor";
import { EventPublicationPreview } from "@/components/EventPublicationPreview";
import { EVENT_CREATION as COPY } from "@/copy/eventCreation";
import { storageService } from "@/services/firebase/storageService";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { eventsService } from "@/services/firestore/eventsService";
import type { Event, EventFormConfig, EventWriteInput, OrganizationProfile } from "@/types";
import { getAdminActionError } from "@/utils/adminErrors";
import { getPublicationIssues } from "@/utils/eventCreation";
import { getVisibleStandardFieldDefinitions } from "@/utils/formFields";
import { formatDateRange } from "@/utils/formatters";
import { isOffline, withWriteTimeout, WRITE_TIMEOUT_CODE } from "@/utils/writeTimeout";
import "@/styles/eventCreation.css";

interface AdminEventEditorModalProps {
  organization: OrganizationProfile;
  stakeId: string;
  sessionUid: string;
  initialEvent?: Event | null;
  initialFormConfig?: EventFormConfig | null;
  initialStep?: "overview" | "preview";
  onClose: () => void;
  onCompleted?: (eventId: string) => void;
}

type Step = "essentials" | "overview" | "options" | "form" | "preview";

// Account/activity changes dispose the previous editing context and its callbacks.
export function AdminEventEditorModal(props: AdminEventEditorModalProps) {
  return <EventEditorSession key={`${props.sessionUid}:${props.stakeId}:${props.initialEvent?.id ?? "new"}`} {...props} />;
}

function EventEditorSession({ organization, stakeId, sessionUid, initialEvent, initialFormConfig, initialStep, onClose, onCompleted }: AdminEventEditorModalProps) {
  const [step, setStep] = useState<Step>(initialEvent ? initialStep ?? "overview" : "essentials");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedEvent, setSavedEvent] = useState<Event | null>(initialEvent ? { ...initialEvent, ...(initialFormConfig ? { allowGuestRegistration: initialFormConfig.allowGuestRegistration, requireLoginForEdit: initialFormConfig.requireLoginForEdit } : {}) } : null);
  const [formConfig, setFormConfig] = useState<EventFormConfig | null>(initialFormConfig ?? null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discardAction, setDiscardAction] = useState<"close" | "back" | null>(null);
  const [waiting, setWaiting] = useState(false);
  const pending = useRef<{ promise: Promise<void>; completed: () => void; fallback: string } | null>(null);
  const runLock = useRef(false);
  const mounted = useRef(true);
  const content = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const creationId = useRef(crypto.randomUUID());
  const essentialFormId = useId();
  const stagedImages = useRef(new Set<string>());
  const committedImage = useRef(initialEvent?.heroImagePath ?? "");
  const pendingImage = useRef("");
  const standardFieldDefinitions = useMemo(() => getVisibleStandardFieldDefinitions(organization.registrationDefaults.fieldOverrides), [organization.registrationDefaults.fieldOverrides]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const path of stagedImages.current) { if (path !== committedImage.current && path !== pendingImage.current) void storageService.deleteFile(path).catch(() => undefined); } }; }, []);
  useEffect(() => {
    const heading = content.current?.closest(".app-modal")?.querySelector<HTMLElement>("h2");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    content.current?.closest(".app-modal__body")?.scrollTo(0, 0);
  }, [step]);
  useEffect(() => {
    if (initialEvent) {
      void run(() => refreshSavedEvent(initialEvent.id), () => undefined, COPY.saveError);
    }
  }, []);

  async function refreshSavedEvent(eventId: string) {
    // Read the activity first, then the form. A concurrent change can leave
    // an older revision (which the next write rejects), never a newer
    // revision paired with an older cached form.
    const event = await eventsService.getEventById(stakeId, eventId, true);
    if (!event) throw new Error("Attività non disponibile.");
    const config = await eventFormsService.getFormConfig(stakeId, eventId, true);
    if (mounted.current) {
      setSavedEvent({ ...event, allowGuestRegistration: config.allowGuestRegistration, requireLoginForEdit: config.requireLoginForEdit });
      setFormConfig(config);
    }
  }

  // A retry after a timeout awaits the SAME write. It cannot create another
  // activity, publish before an earlier save, or overwrite edits out of order.
  async function run(work: () => Promise<void>, completed: () => void, fallback: string) {
    if (runLock.current) return;
    if (isOffline() && !pending.current) { setError(getAdminActionError({ code: "unavailable" }, fallback)); return; }
    runLock.current = true;
    setBusy(true); setError(null); setFeedback(null);
    const action = pending.current ?? { promise: Promise.resolve().then(work), completed, fallback };
    pending.current = action;
    try {
      await withWriteTimeout(action.promise);
      if (!mounted.current) return;
      pending.current = null; setWaiting(false); setDirty(false);
      action.completed();
    } catch (caughtError) {
      if (!mounted.current) return;
      if ((caughtError as { code?: string })?.code === WRITE_TIMEOUT_CODE) setWaiting(true);
      else { pending.current = null; setWaiting(false); }
      setError(getAdminActionError(caughtError, action.fallback));
    } finally {
      runLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function finish() {
    if (savedEvent) onCompleted?.(savedEvent.id);
    // A queued creation has a stable id and already appears in the local list.
    else if (waiting) onCompleted?.(creationId.current);
    onClose();
  }
  function requestExit(action: "close" | "back") {
    if (runLock.current || uploading) return;
    if (dirty && !waiting) { setDiscardAction(action); return; }
    if (action === "close") finish();
    else { setDirty(false); setError(null); setFeedback(null); setStep("overview"); }
  }

  async function handleUploadImage(file: File) {
    setUploading(true);
    try {
      const image = await storageService.uploadEventImage({ file, uploadedBy: sessionUid, stakeId, eventId: savedEvent?.id });
      stagedImages.current.add(image.path);
      if (mounted.current) setDirty(true);
      else void storageService.deleteFile(image.path).catch(() => undefined);
      return image;
    } finally { if (mounted.current) setUploading(false); }
  }

  async function handleSave(input: EventWriteInput) {
    let event: Event | null = null;
    await run(async () => {
      pendingImage.current = input.heroImagePath ?? "";
      event = savedEvent
        ? await eventsService.updateEvent(stakeId, savedEvent.id, input, savedEvent.updatedAt)
        : await eventsService.createEvent(stakeId, { ...input, status: "draft", isPublic: false, isVisible: false }, sessionUid, creationId.current);
      if (!event) throw new Error("Impossibile rileggere l'attività aggiornata.");
      committedImage.current = event.heroImagePath;
      pendingImage.current = "";
      stagedImages.current.delete(event.heroImagePath);
      await refreshSavedEvent(event.id);
    }, () => { setStep("overview"); setFeedback(initialEvent ? COPY.savedChanges : COPY.saved); }, COPY.saveError);
  }
  async function handleSaveForm(config: EventFormConfig) {
    if (!savedEvent) return;
    await run(async () => {
      await eventFormsService.saveFormConfig(stakeId, savedEvent.id, config, standardFieldDefinitions, { expectedUpdatedAt: savedEvent.updatedAt });
      await refreshSavedEvent(savedEvent.id);
    }, () => { setStep("overview"); setFeedback(COPY.savedForm); }, COPY.formError);
  }
  async function openStep(next: Step) {
    if (!savedEvent || busy || waiting) return;
    if (next === "form" || next === "preview") {
      await run(async () => {
        const config = await eventFormsService.getFormConfig(stakeId, savedEvent.id, true);
        if (mounted.current) setFormConfig(config);
      }, () => setStep(next), COPY.formError);
    } else { setError(null); setFeedback(null); setStep(next); }
  }
  async function publish() {
    if (!savedEvent || !formConfig || getPublicationIssues(savedEvent).length || savedEvent.isPublic) return;
    await run(async () => { await eventsService.publishEvent(stakeId, savedEvent.id, savedEvent.updatedAt); }, finish, COPY.publishError);
  }

  const titles: Record<Step, string> = { essentials: savedEvent ? COPY.essentials : "Crea nuova attività", overview: savedEvent?.isPublic ? "Gestisci attività" : "La tua bozza", options: COPY.customize, form: COPY.registration, preview: COPY.preview };
  const locked = busy || waiting || uploading;
  return <>
    <AppModal title={titles[step]} subtitle={savedEvent?.isPublic ? "Attività pubblicata" : COPY.draft} onClose={() => requestExit("close")} size="wide"
      footer={step !== "overview" ? <div className="event-creation__actions event-creation__footer">
        {savedEvent ? <button type="button" className="button button--ghost" disabled={locked} onClick={() => requestExit("back")}>{savedEvent.isPublic ? "Torna alla gestione" : COPY.back}</button> : null}
        {step === "essentials" ? <button form={essentialFormId} type="submit" className="button button--primary" disabled={locked}>{busy ? "Salvataggio..." : savedEvent ? "Salva modifiche" : COPY.create}</button> : null}
        {step === "preview" ? <button type="button" className="button button--primary" disabled={locked || !savedEvent || !formConfig || getPublicationIssues(savedEvent).length > 0} onClick={() => void publish()}>{busy ? "Pubblicazione..." : COPY.publish}</button> : null}
      </div> : undefined}>
      <div className="event-creation" ref={content} onChangeCapture={() => setDirty(true)}>
        {error ? <div ref={errorRef} tabIndex={-1} className="form-error" role="alert">{error}</div> : null}
        {feedback ? <div className="form-success" role="status">{feedback}</div> : null}
        {waiting ? <button className="button button--primary" type="button" disabled={busy} onClick={() => void run(() => Promise.resolve(), () => undefined, COPY.saveError)}>{busy ? "Verifica in corso..." : "Verifica salvataggio"}</button> : null}
        {step === "essentials" ? <EssentialEventForm formId={essentialFormId} event={savedEvent} defaults={organization.registrationDefaults} busy={locked} onSave={handleSave} /> : null}
        {step === "options" ? <fieldset disabled={locked}><EventEditorForm compact busy={locked} initialEvent={savedEvent} onUploadImage={handleUploadImage} onSubmit={handleSave} onDirtyChange={() => setDirty(true)} statusMode="simplified" submitLabel="Salva modifiche" /></fieldset> : null}
        {step === "form" ? formConfig ? <fieldset disabled={locked}><EventFormConfigEditor busy={locked} eventAudience={savedEvent?.audience ?? "congiunta"} initialConfig={formConfig} allowRoomFields={savedEvent?.overnight ?? false} onSave={handleSaveForm} onDirtyChange={() => setDirty(true)} standardFieldDefinitions={standardFieldDefinitions} /></fieldset> : <p>Sto preparando il modulo...</p> : null}
        {step === "overview" && savedEvent ? <>
          <article className="event-creation__preview"><div><h3>{savedEvent.title}</h3><p>{formatDateRange(savedEvent.startDate, savedEvent.endDate)}</p><p>{savedEvent.location}</p></div></article>
          {!savedEvent.isPublic ? <p className="event-creation__hint">{COPY.findDraft}</p> : null}
          <div className="event-creation__options">
            {([
              ["essentials", COPY.essentials, "Nome, tipo, date, luogo e dettagli facoltativi."],
              ["options", COPY.customize, COPY.customizeBody],
              ["form", COPY.registration, COPY.registrationBody],
            ] as const).map(([next, title, body]) => <button key={next} type="button" className="event-creation__option" disabled={locked} onClick={() => void openStep(next)}><span><strong>{title}</strong><small>{body}</small></span><AppIcon name="arrow-right" /></button>)}
          </div>
          <div className="event-creation__actions"><button type="button" className="button button--ghost" disabled={busy} onClick={() => requestExit("close")}>{savedEvent.isPublic ? "Chiudi" : "Esci dalla bozza"}</button>{!savedEvent.isPublic ? <button type="button" className="button button--primary" disabled={locked || savedEvent.status === "cancelled" || savedEvent.status === "completed"} onClick={() => void openStep("preview")}>{COPY.preview}</button> : null}</div>
        </> : null}
        {step === "preview" && savedEvent ? <EventPublicationPreview event={savedEvent} config={formConfig} /> : null}
      </div>
    </AppModal>
    {discardAction ? <ConfirmSheet title={COPY.discardTitle} body={COPY.discardBody} cancelLabel={COPY.keepEditing} confirmLabel={COPY.discard} tone="danger" onCancel={() => setDiscardAction(null)} onConfirm={() => { const action = discardAction; setDiscardAction(null); setDirty(false); if (action === "close") finish(); else { setError(null); setStep("overview"); } }} /> : null}
  </>;
}
