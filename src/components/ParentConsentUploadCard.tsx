import { useState, type ChangeEvent } from "react";

import { AppIcon } from "@/components/AppIcon";
import { registrationsService } from "@/services/firestore/registrationsService";
import { storageService } from "@/services/firebase/storageService";
import type { Registration } from "@/types";
import { formatDateTime } from "@/utils/formatters";

interface ParentConsentUploadCardProps {
  stakeId: string;
  eventId: string;
  registration: Registration;
  sessionUid: string;
  exampleImageUrl?: string;
  onRegistrationUpdated: (registration: Registration) => void;
}

export function ParentConsentUploadCard({
  stakeId,
  eventId,
  registration,
  sessionUid,
  exampleImageUrl,
  onRegistrationUpdated,
}: ParentConsentUploadCardProps) {
  const [busy, setBusy] = useState<null | "upload" | "remove">(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(eventInput: ChangeEvent<HTMLInputElement>) {
    const file = eventInput.target.files?.[0];
    eventInput.target.value = "";

    if (!file) {
      return;
    }

    setBusy("upload");
    setError(null);

    try {
      const uploadedFile = await storageService.uploadParentConsentDocument({
        file,
        uploadedBy: sessionUid,
        stakeId,
        eventId,
        registrationId: registration.id,
        previousPath: registration.parentConsentDocumentPath ?? undefined,
      });
      const updatedRegistration = await registrationsService.saveParentConsentDocument(
        stakeId,
        eventId,
        registration.id,
        uploadedFile,
      );

      if (!updatedRegistration) {
        throw new Error("Documento caricato ma registrazione non aggiornata.");
      }

      onRegistrationUpdated(updatedRegistration);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile caricare il documento.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    const confirmed = window.confirm(
      "Vuoi davvero rimuovere il consenso del genitore o tutore?",
    );

    if (!confirmed) {
      return;
    }

    setBusy("remove");
    setError(null);

    try {
      if (registration.parentConsentDocumentPath) {
        await storageService
          .deleteFile(registration.parentConsentDocumentPath)
          .catch(() => undefined);
      }

      const updatedRegistration = await registrationsService.clearParentConsentDocument(
        stakeId,
        eventId,
        registration.id,
      );

      if (!updatedRegistration) {
        throw new Error("Documento rimosso ma registrazione non aggiornata.");
      }

      onRegistrationUpdated(updatedRegistration);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile rimuovere il documento.",
      );
    } finally {
      setBusy(null);
    }
  }

  const hasUploadedDocument = Boolean(registration.parentConsentDocumentUrl);
  // Se l'attivita usa il flusso con email al genitore, il modulo arriva
  // gia compilato nella sua casella: qui il caricamento manuale e solo
  // un'alternativa.
  const emailFlowActive = Boolean(
    registration.parentAuthorization &&
      registration.parentAuthorization.status !== "not_required",
  );

  return (
    <section className="surface-panel surface-panel--subtle parent-consent-card">
      <div className="section-head">
        <div>
          <h3>Modulo consenso genitore o tutore</h3>
          <p>
            {hasUploadedDocument
              ? `Modulo firmato caricato il ${formatDateTime(registration.parentConsentUploadedAt || registration.updatedAt)}.`
              : "Scarica il modulo ufficiale, fallo firmare e caricane una foto leggibile."}
          </p>
        </div>
      </div>

      {emailFlowActive && !hasUploadedDocument ? (
        <div className="notice notice--info">
          <div>
            <p>
              Lo stesso modulo è stato inviato <strong>via email al genitore</strong>: può
              firmarlo direttamente dal link nella mail. In quel caso qui non serve caricare
              nulla.
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Documento non aggiornato</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <div className="inline-actions">
        {!hasUploadedDocument ? (
          <a
            className="button button--ghost button--small"
            download="consenso-e-informazioni-mediche.pdf"
            href="/moduli/consenso-e-informazioni-mediche.pdf"
          >
            <AppIcon name="download" />
            <span>Scarica modulo da firmare</span>
          </a>
        ) : null}

        <label className="button button--primary button--small upload-button">
          <AppIcon name="plus" />
          <span>
            {busy === "upload"
              ? "Caricamento..."
              : hasUploadedDocument
                ? "Sostituisci foto"
                : "Carica foto del modulo firmato"}
          </span>
          <input
            accept="image/*"
            hidden
            onChange={(eventInput) => void handleFileChange(eventInput)}
            type="file"
          />
        </label>

        {hasUploadedDocument ? (
          <>
            <a
              className="button button--ghost button--small"
              href={registration.parentConsentDocumentUrl || "#"}
              rel="noreferrer"
              target="_blank"
            >
              <AppIcon name="eye" />
              <span>Vedi</span>
            </a>
            <button
              className="button button--ghost button--small"
              disabled={busy === "remove"}
              onClick={() => void handleRemove()}
              type="button"
            >
              <AppIcon name="trash" />
              <span>{busy === "remove" ? "Rimozione..." : "Rimuovi"}</span>
            </button>
          </>
        ) : null}
      </div>

      {hasUploadedDocument ? (
        <div
          aria-label="Anteprima del modulo caricato"
          className="upload-preview parent-consent-card__thumb"
          role="img"
          style={{ backgroundImage: `url(${registration.parentConsentDocumentUrl})` }}
        />
      ) : exampleImageUrl ? (
        <details className="parent-consent-card__example">
          <summary className="subtle-text">Vedi un esempio di foto ben riuscita</summary>
          <div
            className="upload-preview parent-consent-card__thumb"
            style={{ backgroundImage: `url(${exampleImageUrl})` }}
          />
        </details>
      ) : null}
    </section>
  );
}
