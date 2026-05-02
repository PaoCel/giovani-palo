import { useRef, useState, type ChangeEvent } from "react";

import { AppIcon } from "@/components/AppIcon";
import { ConsentTextModal, type ConsentKind } from "@/components/ConsentTextModal";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { storageService } from "@/services/firebase/storageService";
import { registrationsService } from "@/services/firestore/registrationsService";
import type { Event, Registration } from "@/types";
import { formatDateOnly } from "@/utils/formatters";

interface ConsentSectionProps {
  event: Event;
  registration: Registration;
  stakeId: string;
  sessionUid: string;
  onRegistrationUpdated: (registration: Registration) => void;
  // values shared with the registration form (when used inline);
  // when undefined, controls own internal state (when used post-submit)
  signerName?: string;
  parentalAccepted?: boolean;
  photoAccepted?: boolean;
  onSignerNameChange?: (value: string) => void;
  onParentalAcceptedChange?: (value: boolean) => void;
  onPhotoAcceptedChange?: (value: boolean) => void;
  // when true, the signature pad and uploads operate immediately (post-submit mode)
  // when false, the parent form is responsible for collecting signature later
  persistImmediately?: boolean;
  isMinor: boolean;
}

export function ConsentSection({
  event,
  registration,
  stakeId,
  sessionUid,
  onRegistrationUpdated,
  signerName,
  parentalAccepted,
  photoAccepted,
  onSignerNameChange,
  onParentalAcceptedChange,
  onPhotoAcceptedChange,
  persistImmediately,
  isMinor,
}: ConsentSectionProps) {
  const [internalSignerName, setInternalSignerName] = useState(
    typeof registration.answers.parentalConsentSignerName === "string"
      ? registration.answers.parentalConsentSignerName
      : typeof registration.answers.photoReleaseSignerName === "string"
        ? registration.answers.photoReleaseSignerName
        : "",
  );
  const [internalParental, setInternalParental] = useState(
    registration.answers.parentalConsentAccepted === true,
  );
  const [internalPhoto, setInternalPhoto] = useState(
    registration.answers.photoReleaseAccepted === true,
  );
  const [openModal, setOpenModal] = useState<ConsentKind | null>(null);
  const [busy, setBusy] = useState<null | "signature" | "id-upload" | "id-remove" | "pdf">(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const signaturePadRef = useRef<SignaturePadHandle>(null);
  const [signatureDirty, setSignatureDirty] = useState(false);

  const effectiveSignerName = signerName ?? internalSignerName;
  const effectiveParental = parentalAccepted ?? internalParental;
  const effectivePhoto = photoAccepted ?? internalPhoto;

  const showParental = event.requiresParentalConsent && isMinor;
  const showPhoto = event.requiresPhotoRelease;

  function setSignerName(value: string) {
    setInternalSignerName(value);
    onSignerNameChange?.(value);
  }

  function setParental(value: boolean) {
    setInternalParental(value);
    onParentalAcceptedChange?.(value);
  }

  function setPhoto(value: boolean) {
    setInternalPhoto(value);
    onPhotoAcceptedChange?.(value);
  }

  async function handleSaveSignature() {
    setError(null);
    setInfo(null);

    const blob = await signaturePadRef.current?.toBlob();

    if (!blob) {
      setError("Disegna una firma prima di salvare.");
      return;
    }

    setBusy("signature");

    try {
      const upload = await storageService.uploadConsentSignature({
        blob,
        uploadedBy: sessionUid,
        stakeId,
        eventId: event.id,
        registrationId: registration.id,
        previousPath: registration.consentSignaturePath ?? undefined,
      });

      const updated = await registrationsService.saveConsentSignature(
        stakeId,
        event.id,
        registration.id,
        upload,
      );

      if (!updated) {
        throw new Error("Firma caricata ma registrazione non aggiornata.");
      }

      onRegistrationUpdated(updated);
      setSignatureDirty(false);
      setInfo("Firma salvata.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile salvare la firma.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleClearSignature() {
    if (!registration.consentSignatureUrl) {
      signaturePadRef.current?.clear();
      setSignatureDirty(false);
      return;
    }

    const confirmed = window.confirm("Vuoi rimuovere la firma salvata?");
    if (!confirmed) return;

    setError(null);
    setInfo(null);
    setBusy("signature");

    try {
      if (registration.consentSignaturePath) {
        await storageService.deleteFile(registration.consentSignaturePath).catch(() => undefined);
      }

      const updated = await registrationsService.clearConsentSignature(
        stakeId,
        event.id,
        registration.id,
      );

      if (updated) {
        onRegistrationUpdated(updated);
      }

      signaturePadRef.current?.clear();
      setSignatureDirty(false);
      setInfo("Firma rimossa.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile rimuovere la firma.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleParentIdUpload(eventInput: ChangeEvent<HTMLInputElement>) {
    const file = eventInput.target.files?.[0];
    eventInput.target.value = "";
    if (!file) return;

    setError(null);
    setInfo(null);
    setBusy("id-upload");

    try {
      const upload = await storageService.uploadParentIdDocument({
        file,
        uploadedBy: sessionUid,
        stakeId,
        eventId: event.id,
        registrationId: registration.id,
        previousPath: registration.parentIdDocumentPath ?? undefined,
      });

      const updated = await registrationsService.saveParentIdDocument(
        stakeId,
        event.id,
        registration.id,
        upload,
      );

      if (!updated) {
        throw new Error("Documento caricato ma registrazione non aggiornata.");
      }

      onRegistrationUpdated(updated);
      setInfo("Documento del genitore caricato.");
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

  async function handleParentIdRemove() {
    const confirmed = window.confirm("Vuoi rimuovere il documento del genitore?");
    if (!confirmed) return;

    setError(null);
    setInfo(null);
    setBusy("id-remove");

    try {
      if (registration.parentIdDocumentPath) {
        await storageService.deleteFile(registration.parentIdDocumentPath).catch(() => undefined);
      }

      const updated = await registrationsService.clearParentIdDocument(
        stakeId,
        event.id,
        registration.id,
      );

      if (updated) {
        onRegistrationUpdated(updated);
      }

      setInfo("Documento rimosso.");
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

  async function handleDownloadPdf(kind: ConsentKind) {
    setBusy("pdf");
    setError(null);
    try {
      const { downloadConsentPdf } = await import("@/utils/consentPdf");
      downloadConsentPdf({
        event,
        registration,
        kind,
        signatureDataUrl: registration.consentSignatureUrl ?? null,
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile generare il PDF.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!showParental && !showPhoto) {
    return null;
  }

  const hasSignature = Boolean(registration.consentSignatureUrl);
  const showSignatureSaveButton = persistImmediately === true;

  return (
    <div className="stack">
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Azione non completata</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}
      {info ? (
        <div className="notice notice--info">
          <div>
            <h3>Aggiornamento</h3>
            <p>{info}</p>
          </div>
        </div>
      ) : null}

      {showParental ? (
        <article className="consent-card">
          <div className="consent-card__head">
            <strong>Consenso del genitore o tutore</strong>
            <small>
              Richiesto per il/la partecipante minorenne. Non blocca
              l'iscrizione: puoi completare anche dopo dal tuo account.
            </small>
            <span
              className={
                effectiveParental
                  ? "consent-card__status consent-card__status--ok"
                  : "consent-card__status consent-card__status--missing"
              }
            >
              <AppIcon name={effectiveParental ? "check" : "bell"} />
              <span>{effectiveParental ? "Accettato" : "In sospeso"}</span>
            </span>
          </div>

          <label className="toggle-field">
            <input
              checked={effectiveParental}
              onChange={(eventInput) => setParental(eventInput.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Accetto il consenso a nome del genitore o tutore</strong>
            </span>
          </label>

          <div className="consent-card__actions">
            <button
              className="button button--ghost button--small"
              onClick={() => setOpenModal("parental")}
              type="button"
            >
              <AppIcon name="eye" />
              <span>Leggi il documento</span>
            </button>
            <button
              className="button button--ghost button--small"
              disabled={busy === "pdf"}
              onClick={() => void handleDownloadPdf("parental")}
              type="button"
            >
              <AppIcon name="download" />
              <span>Scarica PDF</span>
            </button>
          </div>
        </article>
      ) : null}

      {showPhoto ? (
        <article className="consent-card">
          <div className="consent-card__head">
            <strong>Liberatoria per l'uso delle immagini</strong>
            <small>
              Per l'uso delle foto del partecipante in materiali della Chiesa. Per
              i minori firma il genitore o tutore.
            </small>
            <span
              className={
                effectivePhoto
                  ? "consent-card__status consent-card__status--ok"
                  : "consent-card__status consent-card__status--missing"
              }
            >
              <AppIcon name={effectivePhoto ? "check" : "bell"} />
              <span>{effectivePhoto ? "Accettato" : "In sospeso"}</span>
            </span>
          </div>

          <label className="toggle-field">
            <input
              checked={effectivePhoto}
              onChange={(eventInput) => setPhoto(eventInput.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Accetto la liberatoria immagini</strong>
            </span>
          </label>

          <div className="consent-card__actions">
            <button
              className="button button--ghost button--small"
              onClick={() => setOpenModal("photo")}
              type="button"
            >
              <AppIcon name="eye" />
              <span>Leggi il documento</span>
            </button>
            <button
              className="button button--ghost button--small"
              disabled={busy === "pdf"}
              onClick={() => void handleDownloadPdf("photo")}
              type="button"
            >
              <AppIcon name="download" />
              <span>Scarica PDF</span>
            </button>
          </div>
        </article>
      ) : null}

      {showParental || showPhoto ? (
        <article className="consent-card">
          <div className="consent-card__head">
            <strong>Nome del firmatario</strong>
            <small>
              {showParental
                ? "Genitore o tutore che firma per il minore."
                : "Persona che accetta la liberatoria."}
            </small>
          </div>
          <label className="field">
            <span className="field__label">Nome e cognome</span>
            <input
              className="input"
              onChange={(eventInput) => setSignerName(eventInput.target.value)}
              placeholder="Es. Mario Rossi"
              type="text"
              value={effectiveSignerName}
            />
          </label>
        </article>
      ) : null}

      <article className="consent-card">
        <div className="consent-card__head">
          <strong>Firma digitale</strong>
          <small>
            Firma una sola volta - vale per i consensi accettati qui sopra. Da
            telefono usa il dito, da computer il mouse.
          </small>
          {hasSignature ? (
            <span className="consent-card__status consent-card__status--ok">
              <AppIcon name="check" />
              <span>
                Firmato il{" "}
                {registration.consentSignatureSetAt
                  ? formatDateOnly(registration.consentSignatureSetAt)
                  : ""}
              </span>
            </span>
          ) : null}
        </div>

        <SignaturePad
          initialDataUrl={registration.consentSignatureUrl ?? null}
          onChange={(hasContent) => setSignatureDirty(hasContent)}
          ref={signaturePadRef}
        />

        {showSignatureSaveButton ? (
          <div className="consent-card__actions">
            <button
              className="button button--primary button--small"
              disabled={busy === "signature" || !signatureDirty}
              onClick={() => void handleSaveSignature()}
              type="button"
            >
              <AppIcon name="check" />
              <span>{busy === "signature" ? "Salvataggio..." : "Salva firma"}</span>
            </button>
            {hasSignature ? (
              <button
                className="button button--ghost button--small"
                disabled={busy === "signature"}
                onClick={() => void handleClearSignature()}
                type="button"
              >
                <AppIcon name="trash" />
                <span>Rimuovi firma salvata</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </article>

      <article className="consent-card">
        <div className="consent-card__head">
          <strong>Documento d'identita del genitore (opzionale)</strong>
          <small>
            Carica una foto o PDF del documento d'identita del genitore o
            tutore. Visibile solo agli admin.
          </small>
          {registration.parentIdDocumentUrl ? (
            <span className="consent-card__status consent-card__status--ok">
              <AppIcon name="check" />
              <span>
                Caricato
                {registration.parentIdUploadedAt
                  ? ` il ${formatDateOnly(registration.parentIdUploadedAt)}`
                  : ""}
              </span>
            </span>
          ) : null}
        </div>

        <div className="consent-card__actions">
          <label className="button button--ghost button--small upload-button">
            <AppIcon name="plus" />
            <span>
              {busy === "id-upload"
                ? "Caricamento..."
                : registration.parentIdDocumentUrl
                  ? "Sostituisci documento"
                  : "Carica documento"}
            </span>
            <input
              accept="image/*,application/pdf"
              hidden
              onChange={(eventInput) => void handleParentIdUpload(eventInput)}
              type="file"
            />
          </label>

          {registration.parentIdDocumentUrl ? (
            <>
              <a
                className="button button--ghost button--small"
                href={registration.parentIdDocumentUrl}
                rel="noreferrer"
                target="_blank"
              >
                <AppIcon name="eye" />
                <span>Vedi</span>
              </a>
              <button
                className="button button--ghost button--small"
                disabled={busy === "id-remove"}
                onClick={() => void handleParentIdRemove()}
                type="button"
              >
                <AppIcon name="trash" />
                <span>{busy === "id-remove" ? "Rimozione..." : "Rimuovi"}</span>
              </button>
            </>
          ) : null}
        </div>
      </article>

      {openModal ? (
        <ConsentTextModal
          downloadBusy={busy === "pdf"}
          kind={openModal}
          onClose={() => setOpenModal(null)}
          onDownload={() => void handleDownloadPdf(openModal)}
        />
      ) : null}
    </div>
  );
}
