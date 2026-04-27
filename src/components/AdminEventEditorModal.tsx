import { useMemo, useState } from "react";

import { AppModal } from "@/components/AppModal";
import { EventEditorForm } from "@/components/EventEditorForm";
import { EventFormConfigEditor } from "@/components/EventFormConfigEditor";
import { storageService } from "@/services/firebase/storageService";
import { eventFormsService } from "@/services/firestore/eventFormsService";
import { eventsService } from "@/services/firestore/eventsService";
import type { Event, EventFormConfig, EventWriteInput, OrganizationProfile } from "@/types";
import { getVisibleStandardFieldDefinitions } from "@/utils/formFields";

interface AdminEventEditorModalProps {
  organization: OrganizationProfile;
  stakeId: string;
  sessionUid: string;
  initialEvent?: Event | null;
  initialFormConfig?: EventFormConfig | null;
  onClose: () => void;
  onCompleted?: (eventId: string) => void;
}

export function AdminEventEditorModal({
  organization,
  stakeId,
  sessionUid,
  initialEvent,
  initialFormConfig,
  onClose,
  onCompleted,
}: AdminEventEditorModalProps) {
  const [step, setStep] = useState<"event" | "form">("event");
  const [busy, setBusy] = useState<null | "event" | "form">(null);
  const [savedEvent, setSavedEvent] = useState<Event | null>(initialEvent ?? null);
  const [formConfig, setFormConfig] = useState<EventFormConfig | null>(initialFormConfig ?? null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const standardFieldDefinitions = useMemo(
    () =>
      getVisibleStandardFieldDefinitions(
        organization.registrationDefaults.fieldOverrides,
      ),
    [organization.registrationDefaults.fieldOverrides],
  );

  async function handleUploadImage(file: File) {
    return storageService.uploadEventImage({
      file,
      uploadedBy: sessionUid,
      stakeId,
      eventId: savedEvent?.id ?? initialEvent?.id,
      previousPath: savedEvent?.heroImagePath ?? initialEvent?.heroImagePath,
    });
  }

  async function saveEvent(input: EventWriteInput) {
    if (savedEvent?.id || initialEvent?.id) {
      const eventId = savedEvent?.id ?? initialEvent?.id;

      if (!eventId) {
        throw new Error("Attività non disponibile.");
      }

      if (!input.heroImagePath && (savedEvent?.heroImagePath ?? initialEvent?.heroImagePath)) {
        await storageService
          .deleteFile(savedEvent?.heroImagePath ?? initialEvent?.heroImagePath ?? "")
          .catch(() => undefined);
      }

      await eventsService.updateEvent(stakeId, eventId, input);
      const updatedEvent = await eventsService.getEventById(stakeId, eventId);

      if (!updatedEvent) {
        throw new Error("Impossibile rileggere l'attività aggiornata.");
      }

      setSavedEvent(updatedEvent);
      return updatedEvent;
    }

    const createdEvent = await eventsService.createEvent(stakeId, input, sessionUid);

    if (!createdEvent) {
      throw new Error("Attività creata ma non riletta correttamente.");
    }

    setSavedEvent(createdEvent);
    return createdEvent;
  }

  async function handleContinueToForm(input: EventWriteInput) {
    setBusy("event");
    setError(null);
    setFeedback(null);

    try {
      const event = await saveEvent(input);
      const nextFormConfig = await eventFormsService.getFormConfig(stakeId, event.id);
      setFormConfig(nextFormConfig);
      setStep("form");
      setFeedback(initialEvent ? "Attività aggiornata. Ora puoi configurare il modulo." : "Bozza salvata. Ora puoi configurare il modulo.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Impossibile salvare l'attività.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveAndClose(input: EventWriteInput) {
    setBusy("event");
    setError(null);
    setFeedback(null);

    try {
      const event = await saveEvent(input);
      onCompleted?.(event.id);
      onClose();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Impossibile salvare l'attività.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveDraft(input: EventWriteInput) {
    await handleSaveAndClose(input);
  }

  async function handleSaveForm(nextConfig: EventFormConfig) {
    const eventId = savedEvent?.id ?? initialEvent?.id;

    if (!eventId) {
      setError("Salva prima i dati dell'attività.");
      return;
    }

    setBusy("form");
    setError(null);
    setFeedback(null);

    try {
      await eventFormsService.saveFormConfig(
        stakeId,
        eventId,
        nextConfig,
        standardFieldDefinitions,
      );
      onCompleted?.(eventId);
      onClose();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile salvare la configurazione del modulo.",
      );
    } finally {
      setBusy(null);
    }
  }

  const modalTitle = initialEvent ? "Modifica attività" : "Crea nuova attività";
  const footer =
    step === "form" ? (
      <>
        <button
          className="button button--ghost"
          disabled={busy !== null}
          onClick={() => setStep("event")}
          type="button"
        >
          Indietro
        </button>
      </>
    ) : null;

  return (
    <AppModal
      title={modalTitle}
      subtitle={step === "event" ? "Dati attività" : "Configurazione modulo"}
      footer={footer}
      onClose={onClose}
      size="wide"
    >
      <div className="admin-editor-modal__steps">
        <span className={step === "event" ? "surface-chip surface-chip--active" : "surface-chip"}>
          Attività
        </span>
        <span className={step === "form" ? "surface-chip surface-chip--active" : "surface-chip"}>
          Modulo
        </span>
      </div>

      {error ? <div className="form-error">{error}</div> : null}
      {feedback ? <div className="form-success">{feedback}</div> : null}

      {step === "event" ? (
        <EventEditorForm
          compact
          busy={busy === "event"}
          initialEvent={savedEvent ?? initialEvent}
          onUploadImage={handleUploadImage}
          onSubmit={handleContinueToForm}
          secondaryAction={{
            label: initialEvent ? "Salva modifiche" : "Salva bozza",
            busyLabel: "Salvataggio...",
            forceDraft: !initialEvent,
            onAction: initialEvent ? handleSaveAndClose : handleSaveDraft,
          }}
          statusMode="simplified"
          submitLabel="Configura modulo"
        />
      ) : formConfig ? (
        <EventFormConfigEditor
          busy={busy === "form"}
          eventAudience={(savedEvent ?? initialEvent)?.audience ?? "congiunta"}
          initialConfig={formConfig}
          allowRoomFields={(savedEvent ?? initialEvent)?.overnight ?? false}
          onSave={handleSaveForm}
          standardFieldDefinitions={standardFieldDefinitions}
        />
      ) : (
        <p className="subtle-text">Sto preparando il modulo...</p>
      )}
    </AppModal>
  );
}
