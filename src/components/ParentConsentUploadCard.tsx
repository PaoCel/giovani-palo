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

  return (
    <section className="surface-panel surface-panel--subtle parent-consent-card">
      <div className="section-head">
        <div>
          <h3>Consenso genitore o tutore</h3>
          <p>
            Carica una foto leggibile del foglio firmato. Non blocca l&apos;iscrizione, ma aiuta gli
            admin a verificare tutto prima dell&apos;attività.
          </p>
        </div>
      </div>

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Documento non aggiornato</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <div className="card-grid card-grid--two parent-consent-card__grid">
        <div className="upload-panel parent-consent-card__preview">
          {hasUploadedDocument ? (
            <div
              className="upload-preview"
              style={{
                backgroundImage: `url(${registration.parentConsentDocumentUrl})`,
              }}
            />
          ) : exampleImageUrl ? (
            <>
              <div
                className="upload-preview"
                style={{
                  backgroundImage: `url(${exampleImageUrl})`,
                }}
              />
              <small className="subtle-text">
                Esempio indicativo caricato dagli admin per mostrare come preparare il foglio.
              </small>
            </>
          ) : (
            <div className="upload-placeholder">
              Scatta una foto chiara del foglio firmato e caricala qui.
            </div>
          )}
        </div>

        <div className="stack">
          <div className="notice notice--info">
            <div>
              <h3>{hasUploadedDocument ? "Documento caricato" : "Documento facoltativo ma richiesto"}</h3>
              <p>
                {hasUploadedDocument
                  ? `Ultimo caricamento: ${formatDateTime(registration.parentConsentUploadedAt || registration.updatedAt)}.`
                  : "Se manca adesso, puoi aggiungerlo anche piu tardi da questa schermata."}
              </p>
            </div>
          </div>

          <label className="button button--primary button--small upload-button">
            <AppIcon name="plus" />
            <span>{busy === "upload" ? "Caricamento..." : hasUploadedDocument ? "Sostituisci foto" : "Carica foto"}</span>
            <input
              accept="image/*"
              hidden
              onChange={(eventInput) => void handleFileChange(eventInput)}
              type="file"
            />
          </label>

          {hasUploadedDocument ? (
            <div className="inline-actions">
              <a
                className="button button--ghost button--small"
                href={registration.parentConsentDocumentUrl || "#"}
                rel="noreferrer"
                target="_blank"
              >
                <AppIcon name="eye" />
                <span>Vedi</span>
              </a>
              <a
                className="button button--ghost button--small"
                download={registration.parentConsentDocumentName || "consenso-genitore.jpg"}
                href={registration.parentConsentDocumentUrl || "#"}
              >
                <AppIcon name="download" />
                <span>Scarica</span>
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
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
