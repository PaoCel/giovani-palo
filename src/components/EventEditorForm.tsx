import { useEffect, useState, type FormEvent } from "react";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import type { Event, EventAudience, EventStatus, EventWriteInput } from "@/types";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/utils/formatters";
import { eventSpansMultipleCalendarDays, getEventAudienceLabel } from "@/utils/events";

interface EventEditorFormProps {
  initialEvent?: Event | null;
  busy?: boolean;
  submitLabel: string;
  compact?: boolean;
  statusMode?: "full" | "simplified";
  secondaryAction?: {
    label: string;
    busyLabel?: string;
    forceDraft?: boolean;
    onAction: (input: EventWriteInput) => Promise<void>;
  };
  onSubmit: (input: EventWriteInput) => Promise<void>;
  onUploadImage?: (file: File) => Promise<{ path: string; url: string }>;
}

interface EventEditorValues {
  title: string;
  description: string;
  year: string;
  audience: EventAudience;
  startDate: string;
  endDate: string;
  location: string;
  program: string;
  heroImageUrl: string;
  heroImagePath: string;
  status: EventStatus;
  isPublic: boolean;
  registrationOpen: string;
  registrationClose: string;
  maxParticipants: string;
  overnight: boolean;
  organizerNotes: string;
  menuInfo: string;
  allergiesInfo: string;
  roomsInfo: string;
  allowGuestRegistration: boolean;
  requireLoginForEdit: boolean;
  questionsEnabled: boolean;
  requiresParentalConsent: boolean;
  requiresPhotoRelease: boolean;
}

interface EventEditorStep {
  id: "details" | "schedule" | "settings";
  title: string;
  description: string;
  icon: AppIconName;
}

type FieldErrors = Record<string, boolean>;

const eventEditorSteps: EventEditorStep[] = [
  {
    id: "details",
    title: "Dettagli",
    description: "Titolo, descrizione e destinatari.",
    icon: "ticket",
  },
  {
    id: "schedule",
    title: "Date",
    description: "Programmazione e finestra iscrizioni.",
    icon: "calendar",
  },
  {
    id: "settings",
    title: "Locandina",
    description: "Immagine, note e impostazioni finali.",
    icon: "sparkles",
  },
];

function getInitialValues(event?: Event | null): EventEditorValues {
  return {
    title: event?.title ?? "",
    description: event?.description ?? "",
    year: String(event?.year ?? new Date().getFullYear()),
    audience: event?.audience ?? "congiunta",
    startDate: toDatetimeLocalValue(event?.startDate),
    endDate: toDatetimeLocalValue(event?.endDate),
    location: event?.location ?? "",
    program: event?.program ?? "",
    heroImageUrl: event?.heroImageUrl ?? "",
    heroImagePath: event?.heroImagePath ?? "",
    status: event?.status ?? "draft",
    isPublic: event?.isPublic ?? false,
    registrationOpen: toDatetimeLocalValue(event?.registrationOpen),
    registrationClose: toDatetimeLocalValue(event?.registrationClose),
    maxParticipants:
      typeof event?.maxParticipants === "number" ? String(event.maxParticipants) : "",
    overnight: event?.overnight ?? false,
    organizerNotes: event?.organizerNotes ?? "",
    menuInfo: event?.menuInfo ?? "",
    allergiesInfo: event?.allergiesInfo ?? "",
    roomsInfo: event?.roomsInfo ?? "",
    allowGuestRegistration: event?.allowGuestRegistration ?? true,
    requireLoginForEdit: event?.requireLoginForEdit ?? true,
    questionsEnabled: event?.questionsEnabled ?? false,
    requiresParentalConsent: event?.requiresParentalConsent ?? false,
    requiresPhotoRelease: event?.requiresPhotoRelease ?? false,
  };
}

export function EventEditorForm({
  initialEvent,
  busy,
  submitLabel,
  compact = false,
  statusMode = "full",
  secondaryAction,
  onSubmit,
  onUploadImage,
}: EventEditorFormProps) {
  const [values, setValues] = useState<EventEditorValues>(getInitialValues(initialEvent));
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const canHaveOvernight = eventSpansMultipleCalendarDays(values.startDate, values.endDate);
  const effectiveOvernight = canHaveOvernight && values.overnight;
  const currentStep = eventEditorSteps[currentStepIndex];
  const isLastStep = currentStepIndex === eventEditorSteps.length - 1;
  const progress = ((currentStepIndex + 1) / eventEditorSteps.length) * 100;
  const isSimplifiedStatusMode = statusMode === "simplified";

  useEffect(() => {
    setValues(getInitialValues(initialEvent));
    setCurrentStepIndex(0);
    setFieldErrors({});
    setError(null);
  }, [initialEvent]);

  useEffect(() => {
    if (!canHaveOvernight && (values.overnight || values.roomsInfo)) {
      setValues((current) => ({
        ...current,
        overnight: false,
        roomsInfo: "",
      }));
    }
  }, [canHaveOvernight, values.overnight, values.roomsInfo]);

  function clearFieldError(key: string) {
    setFieldErrors((current) => {
      if (!current[key]) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateValue<Key extends keyof EventEditorValues>(
    key: Key,
    value: EventEditorValues[Key],
  ) {
    clearFieldError(key);
    setValues((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function getInputClass(key: string) {
    return fieldErrors[key] ? "input input--error" : "input";
  }

  function renderFieldLabel(label: string, key: string, required = false) {
    return (
      <span className={fieldErrors[key] ? "field__label field__label--error" : "field__label"}>
        {label}
        {required ? <em aria-hidden="true">*</em> : null}
      </span>
    );
  }

  function renderFieldHint(key: string, hint?: string) {
    if (fieldErrors[key]) {
      return <small className="field-error">Campo obbligatorio.</small>;
    }

    return hint ? <small>{hint}</small> : null;
  }

  function validateStep(stepId: EventEditorStep["id"]) {
    const errors: FieldErrors = {};

    if (stepId === "details") {
      if (!values.title.trim()) {
        errors.title = true;
      }

      if (!values.description.trim()) {
        errors.description = true;
      }

      if (!values.year.trim()) {
        errors.year = true;
      }
    }

    if (stepId === "schedule") {
      if (!values.startDate) {
        errors.startDate = true;
      }

      if (!values.endDate) {
        errors.endDate = true;
      }

      if (!values.location.trim()) {
        errors.location = true;
      }

      if (!values.registrationOpen) {
        errors.registrationOpen = true;
      }

      if (!values.registrationClose) {
        errors.registrationClose = true;
      }
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      return "Compila i campi obbligatori per continuare.";
    }

    if (stepId === "schedule") {
      const startDate = new Date(values.startDate);
      const endDate = new Date(values.endDate);
      const registrationOpen = new Date(values.registrationOpen);
      const registrationClose = new Date(values.registrationClose);

      if (startDate > endDate) {
        return "La data di fine deve essere successiva alla data di inizio.";
      }

      if (registrationOpen > registrationClose) {
        return "La chiusura iscrizioni deve essere successiva all'apertura.";
      }
    }

    const parsedYear = Number(values.year);

    if (stepId === "details" && (Number.isNaN(parsedYear) || parsedYear < 2000)) {
      setFieldErrors({ year: true });
      return "L'anno evento non è valido.";
    }

    return null;
  }

  async function handleImageSelection(file: File | null) {
    if (!file || !onUploadImage) {
      return;
    }

    setUploadingImage(true);
    setUploadError(null);

    try {
      const nextImage = await onUploadImage(file);
      updateValue("heroImageUrl", nextImage.url);
      updateValue("heroImagePath", nextImage.path);
    } catch (caughtError) {
      setUploadError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile caricare l'immagine.",
      );
    } finally {
      setUploadingImage(false);
    }
  }

  function buildPayload(forceDraft = false): EventWriteInput {
    let nextStatus = values.status;
    let nextIsPublic = values.isPublic;

    if (isSimplifiedStatusMode) {
      if (forceDraft) {
        nextStatus = "draft";
        nextIsPublic = false;
      } else if (values.status === "cancelled") {
        nextStatus = "cancelled";
        nextIsPublic = initialEvent?.isPublic ?? false;
      } else if (!(initialEvent?.isPublic ?? false)) {
        nextStatus = "draft";
        nextIsPublic = false;
      } else {
        const now = Date.now();
        const opensAt = new Date(fromDatetimeLocalValue(values.registrationOpen)).getTime();
        const closesAt = new Date(fromDatetimeLocalValue(values.registrationClose)).getTime();

        nextStatus =
          !Number.isNaN(opensAt) && !Number.isNaN(closesAt) && now >= opensAt && now <= closesAt
            ? "registrations_open"
            : "registrations_closed";
        nextIsPublic = true;
      }
    } else if (forceDraft) {
      nextStatus = "draft";
      nextIsPublic = false;
    }

    return {
      title: values.title.trim(),
      description: values.description.trim(),
      year: Number(values.year),
      audience: values.audience,
      startDate: fromDatetimeLocalValue(values.startDate),
      endDate: fromDatetimeLocalValue(values.endDate),
      location: values.location.trim(),
      program: values.program.trim(),
      publicNotes: values.program.trim(),
      organizerNotes: values.organizerNotes.trim(),
      menuInfo: values.menuInfo.trim(),
      allergiesInfo: values.allergiesInfo.trim(),
      roomsInfo: effectiveOvernight ? values.roomsInfo.trim() : "",
      heroImageUrl: values.heroImageUrl.trim(),
      heroImagePath: values.heroImagePath.trim(),
      status: nextStatus,
      isPublic: nextIsPublic,
      registrationOpen: fromDatetimeLocalValue(values.registrationOpen),
      registrationClose: fromDatetimeLocalValue(values.registrationClose),
      maxParticipants: values.maxParticipants ? Number(values.maxParticipants) : null,
      overnight: effectiveOvernight,
      templateId: initialEvent?.templateId ?? null,
      allowGuestRegistration: values.allowGuestRegistration,
      requireLoginForEdit: values.requireLoginForEdit,
      questionsEnabled: values.questionsEnabled,
      requiresParentalConsent: values.requiresParentalConsent,
      requiresPhotoRelease: values.requiresPhotoRelease,
    };
  }

  async function handleSubmission(
    action: (input: EventWriteInput) => Promise<void>,
    options?: { forceDraft?: boolean },
  ) {
    setError(null);

    const stepError = validateStep(currentStep.id);

    if (stepError) {
      setError(stepError);
      return;
    }

    if (!isLastStep) {
      setCurrentStepIndex((current) => Math.min(current + 1, eventEditorSteps.length - 1));
      return;
    }

    const payload = buildPayload(Boolean(options?.forceDraft));

    if (
      payload.maxParticipants !== null &&
      (Number.isNaN(payload.maxParticipants) || payload.maxParticipants < 1)
    ) {
      setFieldErrors({ maxParticipants: true });
      setError("Il numero massimo partecipanti non è valido.");
      return;
    }

    await action(payload);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleSubmission(onSubmit);
  }

  return (
    <form className={compact ? "form-stack form-stack--compact" : "form-stack"} onSubmit={handleSubmit}>
      <div className={compact ? "form-stepper form-stepper--compact" : "form-stepper"}>
        <div className="form-stepper__progress">
          <div className="form-stepper__track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="form-stepper__steps">
            {eventEditorSteps.map((step, index) => (
              <div
                key={step.id}
                className={
                  index === currentStepIndex
                    ? "form-stepper__step form-stepper__step--active"
                    : index < currentStepIndex
                      ? "form-stepper__step form-stepper__step--done"
                      : "form-stepper__step"
                }
              >
                <div className="form-stepper__step-icon">
                  <AppIcon name={index < currentStepIndex ? "check" : step.icon} />
                </div>
                <div>
                  <strong>{step.title}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error ? <div className="form-error">{error}</div> : null}

        <div className="form-stepper__panel">
          {currentStep.id === "details" ? (
            <>
              <div className="card-grid card-grid--two">
                <label className="field">
                  {renderFieldLabel("Titolo", "title", true)}
                  <input
                    className={getInputClass("title")}
                    value={values.title}
                    onChange={(event) => updateValue("title", event.target.value)}
                  />
                  {renderFieldHint("title")}
                </label>

                <label className="field">
                  {renderFieldLabel("Anno", "year", true)}
                  <input
                    className={getInputClass("year")}
                    max="2100"
                    min="2000"
                    type="number"
                    value={values.year}
                    onChange={(event) => updateValue("year", event.target.value)}
                  />
                  {renderFieldHint("year")}
                </label>
              </div>

              <label className="field">
                {renderFieldLabel("Organizzazione", "audience")}
                <select
                  className={getInputClass("audience")}
                  value={values.audience}
                  onChange={(event) => updateValue("audience", event.target.value as EventAudience)}
                >
                  <option value="congiunta">{getEventAudienceLabel("congiunta")}</option>
                  <option value="giovane_uomo">{getEventAudienceLabel("giovane_uomo")}</option>
                  <option value="giovane_donna">{getEventAudienceLabel("giovane_donna")}</option>
                </select>
              </label>

              <label className="field">
                {renderFieldLabel("Descrizione", "description", true)}
                <textarea
                  className={
                    fieldErrors.description ? "input input--textarea input--error" : "input input--textarea"
                  }
                  rows={5}
                  value={values.description}
                  onChange={(event) => updateValue("description", event.target.value)}
                />
                {renderFieldHint("description")}
              </label>
            </>
          ) : null}

          {currentStep.id === "schedule" ? (
            <>
              <div className="card-grid card-grid--two">
                <label className="field">
                  {renderFieldLabel("Data inizio", "startDate", true)}
                  <input
                    className={getInputClass("startDate")}
                    type="datetime-local"
                    value={values.startDate}
                    onChange={(event) => updateValue("startDate", event.target.value)}
                  />
                  {renderFieldHint("startDate")}
                </label>

                <label className="field">
                  {renderFieldLabel("Data fine", "endDate", true)}
                  <input
                    className={getInputClass("endDate")}
                    type="datetime-local"
                    value={values.endDate}
                    onChange={(event) => updateValue("endDate", event.target.value)}
                  />
                  {renderFieldHint("endDate")}
                </label>
              </div>

              <label className="field">
                {renderFieldLabel("Luogo", "location", true)}
                <input
                  className={getInputClass("location")}
                  value={values.location}
                  onChange={(event) => updateValue("location", event.target.value)}
                />
                {renderFieldHint("location")}
              </label>

              <div className="card-grid card-grid--two">
                <label className="field">
                  {renderFieldLabel("Apertura iscrizioni", "registrationOpen", true)}
                  <input
                    className={getInputClass("registrationOpen")}
                    type="datetime-local"
                    value={values.registrationOpen}
                    onChange={(event) => updateValue("registrationOpen", event.target.value)}
                  />
                  {renderFieldHint("registrationOpen")}
                </label>

                <label className="field">
                  {renderFieldLabel("Chiusura iscrizioni", "registrationClose", true)}
                  <input
                    className={getInputClass("registrationClose")}
                    type="datetime-local"
                    value={values.registrationClose}
                    onChange={(event) => updateValue("registrationClose", event.target.value)}
                  />
                  {renderFieldHint("registrationClose")}
                </label>
              </div>

              <div className="card-grid card-grid--two">
                {isSimplifiedStatusMode ? (
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={values.status === "cancelled"}
                      onChange={(event) =>
                        updateValue("status", event.target.checked ? "cancelled" : "draft")
                      }
                    />
                    <span>
                      <strong>Attività annullata</strong>
                    </span>
                  </label>
                ) : (
                  <label className="field">
                    {renderFieldLabel("Stato", "status")}
                    <select
                      className={getInputClass("status")}
                      value={values.status}
                      onChange={(event) =>
                        updateValue("status", event.target.value as EventStatus)
                      }
                    >
                      <option value="draft">Bozza</option>
                      <option value="planned">In pianificazione</option>
                      <option value="confirmed">Confermata</option>
                      <option value="registrations_open">Iscrizioni aperte</option>
                      <option value="registrations_closed">Iscrizioni chiuse</option>
                      <option value="completed">Conclusa</option>
                      <option value="cancelled">Annullata</option>
                    </select>
                  </label>
                )}

                <label className="field">
                  {renderFieldLabel("Max partecipanti", "maxParticipants")}
                  <input
                    className={getInputClass("maxParticipants")}
                    min="1"
                    placeholder="Lascia vuoto per nessun limite"
                    type="number"
                    value={values.maxParticipants}
                    onChange={(event) => updateValue("maxParticipants", event.target.value)}
                  />
                  {renderFieldHint("maxParticipants")}
                </label>
              </div>
            </>
          ) : null}

              {currentStep.id === "settings" ? (
            <>
              <label className="field">
                {renderFieldLabel("Locandina", "heroImageUrl")}
                <div className="upload-panel">
                  {values.heroImageUrl ? (
                    <div
                      className="upload-preview"
                      style={{ backgroundImage: `url(${values.heroImageUrl})` }}
                    />
                  ) : (
                    <div className="upload-placeholder">Carica una locandina verticale.</div>
                  )}

                  <div className="upload-actions">
                    <label className="button button--soft button--small upload-button">
                      <input
                        accept="image/*"
                        className="sr-only"
                        disabled={uploadingImage || busy || !onUploadImage}
                        onChange={(event) =>
                          void handleImageSelection(event.target.files?.[0] ?? null)
                        }
                        type="file"
                      />
                      {uploadingImage ? "Caricamento..." : "Carica immagine"}
                    </label>

                    <input
                      className="input"
                      placeholder="Oppure incolla un URL immagine"
                      type="url"
                      value={values.heroImageUrl}
                      onChange={(event) => updateValue("heroImageUrl", event.target.value)}
                    />

                    {values.heroImageUrl || values.heroImagePath ? (
                      <button
                        className="button button--ghost button--small"
                        onClick={() => {
                          updateValue("heroImageUrl", "");
                          updateValue("heroImagePath", "");
                        }}
                        type="button"
                      >
                        Rimuovi immagine
                      </button>
                    ) : null}
                  </div>
                </div>
                {uploadError ? <small className="field-error">{uploadError}</small> : null}
              </label>

              <label className="field">
                {renderFieldLabel("Programma / riepilogo", "program")}
                <textarea
                  className="input input--textarea"
                  rows={4}
                  value={values.program}
                  onChange={(event) => updateValue("program", event.target.value)}
                />
              </label>

              <div className="card-grid card-grid--two">
                <label className="field">
                  {renderFieldLabel("Menu", "menuInfo")}
                  <textarea
                    className="input input--textarea"
                    rows={3}
                    value={values.menuInfo}
                    onChange={(event) => updateValue("menuInfo", event.target.value)}
                  />
                </label>

                <label className="field">
                  {renderFieldLabel("Allergie e indicazioni", "allergiesInfo")}
                  <textarea
                    className="input input--textarea"
                    rows={3}
                    value={values.allergiesInfo}
                    onChange={(event) => updateValue("allergiesInfo", event.target.value)}
                  />
                </label>
              </div>

              {effectiveOvernight ? (
                <label className="field">
                  {renderFieldLabel("Stanze / logistica", "roomsInfo")}
                  <textarea
                    className="input input--textarea"
                    rows={3}
                    value={values.roomsInfo}
                    onChange={(event) => updateValue("roomsInfo", event.target.value)}
                  />
                </label>
              ) : null}

              <label className="field">
                {renderFieldLabel("Note organizzative", "organizerNotes")}
                <textarea
                  className="input input--textarea"
                  rows={3}
                  value={values.organizerNotes}
                  onChange={(event) => updateValue("organizerNotes", event.target.value)}
                />
              </label>

              <div className="checkbox-grid">
                {!isSimplifiedStatusMode ? (
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={values.isPublic}
                      onChange={(event) => updateValue("isPublic", event.target.checked)}
                    />
                    <span>Evento visibile pubblicamente</span>
                  </label>
                ) : null}

                {canHaveOvernight ? (
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={values.overnight}
                      onChange={(event) => updateValue("overnight", event.target.checked)}
                    />
                    <span>Evento con pernottamento</span>
                  </label>
                ) : null}

                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={values.allowGuestRegistration}
                    onChange={(event) => updateValue("allowGuestRegistration", event.target.checked)}
                  />
                  <span>Consenti iscrizione senza account</span>
                </label>

                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={values.requireLoginForEdit}
                    onChange={(event) => updateValue("requireLoginForEdit", event.target.checked)}
                  />
                  <span>Richiedi login per modificare l'iscrizione</span>
                </label>

                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={values.questionsEnabled}
                    onChange={(event) => updateValue("questionsEnabled", event.target.checked)}
                  />
                  <span>Abilita domande dei partecipanti (caminetto)</span>
                </label>

                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={values.requiresParentalConsent}
                    onChange={(event) => updateValue("requiresParentalConsent", event.target.checked)}
                  />
                  <span>Richiedi consenso genitore (per minorenni)</span>
                </label>

                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={values.requiresPhotoRelease}
                    onChange={(event) => updateValue("requiresPhotoRelease", event.target.checked)}
                  />
                  <span>Richiedi liberatoria immagini</span>
                </label>
              </div>
            </>
          ) : null}
        </div>

        <div className="form-stepper__actions">
          {currentStepIndex > 0 ? (
            <button
              className="button button--ghost"
              disabled={busy || uploadingImage}
              onClick={() => {
                setError(null);
                setFieldErrors({});
                setCurrentStepIndex((current) => Math.max(current - 1, 0));
              }}
              type="button"
            >
              <AppIcon name="arrow-left" />
              <span>Indietro</span>
            </button>
          ) : (
            <div />
          )}

          <div className="inline-actions inline-actions--compact">
            {secondaryAction && isLastStep ? (
              <button
                className="button button--ghost"
                disabled={busy || uploadingImage}
                onClick={() =>
                  void handleSubmission(secondaryAction.onAction, {
                    forceDraft: secondaryAction.forceDraft,
                  })
                }
                type="button"
              >
                {busy ? secondaryAction.busyLabel || "Salvataggio..." : secondaryAction.label}
              </button>
            ) : null}

            <button className="button button--primary" disabled={busy || uploadingImage} type="submit">
              {busy ? (
                "Salvataggio..."
              ) : isLastStep ? (
                <>
                  <AppIcon name="check" />
                  <span>{submitLabel}</span>
                </>
              ) : (
                <>
                  <span>Continua</span>
                  <AppIcon name="arrow-right" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
