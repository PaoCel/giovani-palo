import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import {
  PARENT_CONSENT_CHECKBOXES,
  PHOTO_CONSENT_OPTIONS,
  SUPPORT_CONTACT_TEXT,
  LEGAL_DOCS,
} from "@/constants/legalDocs";
import {
  parentAuthorizationService,
  type ParentAuthorizationContext,
  type ParentTokenStatus,
} from "@/services/firestore/parentAuthorizationService";
import type {
  ParentAuthorizationConsents,
  PhotoConsentDecision,
} from "@/types";

type ViewState =
  | { stage: "loading" }
  | { stage: "context_error"; message: string }
  | {
      stage: "ready";
      status: ParentTokenStatus;
      context: ParentAuthorizationContext;
    }
  | { stage: "submitting" }
  | { stage: "confirmed" }
  | { stage: "rejected" }
  | { stage: "submit_error"; message: string };

const INITIAL_CONSENTS: ParentAuthorizationConsents = {
  isParentOrGuardian: false,
  authorizesParticipation: false,
  confirmsDataAccuracy: false,
  authorizesEmergencyContact: false,
  readPrivacyNotice: false,
};

function formatDateRange(startIso?: string, endIso?: string) {
  if (!startIso) return "Data da definire";
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "Data da definire";

  const formatter = new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  if (endIso) {
    const end = new Date(endIso);
    if (
      !Number.isNaN(end.getTime()) &&
      formatter.format(start) !== formatter.format(end)
    ) {
      return `${formatter.format(start)} → ${formatter.format(end)}`;
    }
  }

  return formatter.format(start);
}

function formatExpiry(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow, noarchive";
    document.head.appendChild(meta);
    const previousTitle = document.title;
    document.title = "Autorizzazione genitore";
    return () => {
      document.head.removeChild(meta);
      document.title = previousTitle;
    };
  }, []);
}

export function ParentConfirmPage() {
  useNoIndex();

  const { token } = useParams();
  const [view, setView] = useState<ViewState>({ stage: "loading" });
  const [consents, setConsents] = useState<ParentAuthorizationConsents>(INITIAL_CONSENTS);
  const [photoConsent, setPhotoConsent] = useState<PhotoConsentDecision>("not_answered");
  const [socialPublicationConsent, setSocialPublicationConsent] =
    useState<PhotoConsentDecision>("not_answered");
  const [hasSignature, setHasSignature] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const signatureRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (!token) {
      setView({ stage: "context_error", message: "Link non valido (token mancante)." });
      return;
    }

    let cancelled = false;
    parentAuthorizationService
      .getContext(token)
      .then((context) => {
        if (cancelled) return;
        setView({ stage: "ready", status: context.status, context });
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "Impossibile verificare il link di autorizzazione.";
        setView({ stage: "context_error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const allRequiredConsentsChecked = useMemo(
    () =>
      PARENT_CONSENT_CHECKBOXES.every(
        (item) => consents[item.key as keyof ParentAuthorizationConsents],
      ),
    [consents],
  );

  const canSubmit = allRequiredConsentsChecked && hasSignature;

  function toggleConsent(key: keyof ParentAuthorizationConsents) {
    setConsents((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleConfirm() {
    if (!token || !canSubmit) return;

    setView({ stage: "submitting" });

    try {
      const signatureBlob = await signatureRef.current?.toBlob();
      const signatureDataUrl = signatureBlob
        ? await blobToDataUrl(signatureBlob)
        : null;

      await parentAuthorizationService.confirm({
        token,
        consents,
        photoConsent,
        socialPublicationConsent,
        signatureDataUrl,
      });

      setView({ stage: "confirmed" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Si e' verificato un errore durante la conferma.";
      setView({ stage: "submit_error", message });
    }
  }

  async function handleReject() {
    if (!token) return;
    setShowRejectModal(false);
    setView({ stage: "submitting" });

    try {
      await parentAuthorizationService.reject({
        token,
        reason: rejectReason.trim() || undefined,
      });
      setView({ stage: "rejected" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Si e' verificato un errore durante il rifiuto.";
      setView({ stage: "submit_error", message });
    }
  }

  return (
    <div className="parent-confirm-page">
      <div className="parent-confirm-container">
        <header className="parent-confirm-header">
          <h1>Autorizzazione genitoriale</h1>
          <p>
            Stai gestendo un'autorizzazione per la partecipazione di un minore a
            un'attivita'. Procedi con calma, ci vorranno circa 2 minuti.
          </p>
        </header>

        {view.stage === "loading" ? <LoadingState /> : null}

        {view.stage === "context_error" ? (
          <ErrorCard
            title="Impossibile verificare il link"
            message={view.message}
          />
        ) : null}

        {view.stage === "ready" && view.status !== "valid" ? (
          <TokenInvalidCard status={view.status} context={view.context} />
        ) : null}

        {view.stage === "ready" && view.status === "valid" ? (
          <ConfirmationForm
            context={view.context}
            consents={consents}
            photoConsent={photoConsent}
            socialPublicationConsent={socialPublicationConsent}
            hasSignature={hasSignature}
            canSubmit={canSubmit}
            signatureRef={signatureRef}
            onToggleConsent={toggleConsent}
            onPhotoConsentChange={setPhotoConsent}
            onSocialConsentChange={setSocialPublicationConsent}
            onSignatureChange={setHasSignature}
            onConfirm={handleConfirm}
            onOpenReject={() => setShowRejectModal(true)}
          />
        ) : null}

        {view.stage === "submitting" ? <LoadingState message="Salvataggio in corso..." /> : null}

        {view.stage === "confirmed" ? <ConfirmedCard /> : null}

        {view.stage === "rejected" ? <RejectedCard /> : null}

        {view.stage === "submit_error" ? (
          <ErrorCard title="Operazione non riuscita" message={view.message}>
            <button
              className="button button--primary"
              onClick={() => window.location.reload()}
              type="button"
            >
              Riprova
            </button>
          </ErrorCard>
        ) : null}

        <footer className="parent-confirm-footer">
          <p>{SUPPORT_CONTACT_TEXT}</p>
        </footer>
      </div>

      {showRejectModal ? (
        <RejectModal
          reason={rejectReason}
          onReasonChange={setRejectReason}
          onCancel={() => setShowRejectModal(false)}
          onConfirm={handleReject}
        />
      ) : null}
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function LoadingState({ message = "Verifica del link in corso..." }: { message?: string }) {
  return (
    <div className="parent-confirm-loading">
      <div className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

function ErrorCard({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="parent-confirm-card parent-confirm-card--error">
      <div className="parent-confirm-card__icon" aria-hidden="true">
        <AppIcon name="bell" />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {children ? <div className="parent-confirm-card__actions">{children}</div> : null}
      </div>
    </section>
  );
}

function TokenInvalidCard({
  status,
  context,
}: {
  status: ParentTokenStatus;
  context: ParentAuthorizationContext;
}) {
  const messages: Record<Exclude<ParentTokenStatus, "valid">, { title: string; body: string }> = {
    not_found: {
      title: "Link non valido",
      body:
        "Questo link di autorizzazione non risulta nei nostri sistemi. Verifica di aver aperto l'ultimo link ricevuto via email. Se il problema persiste contatta il dirigente della tua unita'.",
    },
    expired: {
      title: "Link scaduto",
      body:
        "Questo link di autorizzazione e' scaduto. Per ricevere un nuovo link contatta il dirigente della tua unita' che potra' rigenerarne uno valido.",
    },
    used: {
      title: "Autorizzazione gia' confermata",
      body:
        "Hai gia' completato la procedura di autorizzazione con questo link. Non e' necessario ripeterla. Se ricevi questo messaggio per errore contatta il dirigente.",
    },
    invalidated: {
      title: "Link non piu' valido",
      body:
        "Questo link e' stato sostituito da uno nuovo. Controlla l'email piu' recente che hai ricevuto e usa quel link al posto di questo.",
    },
  };

  const info = messages[status as Exclude<ParentTokenStatus, "valid">];

  return (
    <section className="parent-confirm-card parent-confirm-card--info">
      <div className="parent-confirm-card__icon" aria-hidden="true">
        <AppIcon name="bell" />
      </div>
      <div>
        <h2>{info.title}</h2>
        <p>{info.body}</p>
        {context.activityTitle || context.participantName ? (
          <p className="parent-confirm-card__hint">
            <strong>Riferimento:</strong>{" "}
            {context.activityTitle || ""}
            {context.activityTitle && context.participantName ? " - " : ""}
            {context.participantName || ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface ConfirmationFormProps {
  context: ParentAuthorizationContext;
  consents: ParentAuthorizationConsents;
  photoConsent: PhotoConsentDecision;
  socialPublicationConsent: PhotoConsentDecision;
  hasSignature: boolean;
  canSubmit: boolean;
  signatureRef: React.RefObject<SignaturePadHandle | null>;
  onToggleConsent: (key: keyof ParentAuthorizationConsents) => void;
  onPhotoConsentChange: (value: PhotoConsentDecision) => void;
  onSocialConsentChange: (value: PhotoConsentDecision) => void;
  onSignatureChange: (hasSignature: boolean) => void;
  onConfirm: () => void;
  onOpenReject: () => void;
}

function ConfirmationForm({
  context,
  consents,
  photoConsent,
  socialPublicationConsent,
  hasSignature,
  canSubmit,
  signatureRef,
  onToggleConsent,
  onPhotoConsentChange,
  onSocialConsentChange,
  onSignatureChange,
  onConfirm,
  onOpenReject,
}: ConfirmationFormProps) {
  return (
    <div className="parent-confirm-flow">
      <ActivitySummaryCard context={context} />

      <LegalSummaryCard />

      <ConsentsSection
        consents={consents}
        onToggleConsent={onToggleConsent}
      />

      <PhotoConsentSection
        photoConsent={photoConsent}
        socialPublicationConsent={socialPublicationConsent}
        onPhotoConsentChange={onPhotoConsentChange}
        onSocialConsentChange={onSocialConsentChange}
      />

      <SignatureSection
        signatureRef={signatureRef}
        onSignatureChange={onSignatureChange}
      />

      <section className="parent-confirm-card parent-confirm-card--actions">
        <p>
          {canSubmit
            ? "Tutto pronto. Conferma l'autorizzazione cliccando il pulsante qui sotto."
            : "Per confermare devi accettare tutti i consensi obbligatori e apporre una firma."}
        </p>
        <div className="parent-confirm-actions">
          <button
            className="button button--primary parent-confirm-confirm-button"
            disabled={!canSubmit}
            onClick={onConfirm}
            type="button"
          >
            <AppIcon name="check" />
            <span>Confermo l'autorizzazione</span>
          </button>
          <button
            className="button button--ghost parent-confirm-reject-button"
            onClick={onOpenReject}
            type="button"
          >
            Non autorizzo la partecipazione
          </button>
        </div>
        <p className="parent-confirm-fineprint">
          Cliccando "Confermo" dichiari di essere il genitore o tutore legale del minore e
          accetti i consensi sopra. Il consenso e' raccolto tramite procedura elettronica con
          link unico inviato all'indirizzo email che ci hai fornito.
        </p>
      </section>
    </div>
  );
}

function ActivitySummaryCard({ context }: { context: ParentAuthorizationContext }) {
  return (
    <section className="parent-confirm-card parent-confirm-card--summary">
      <div className="parent-confirm-summary-header">
        <h2>Dati dell'attivita'</h2>
        {context.expiresAt ? (
          <span className="parent-confirm-expiry">
            Scadenza link: {formatExpiry(context.expiresAt)}
          </span>
        ) : null}
      </div>
      <dl className="parent-confirm-summary-grid">
        <div>
          <dt>Attivita'</dt>
          <dd>
            <strong>{context.activityTitle || "-"}</strong>
          </dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatDateRange(context.activityStartDate, context.activityEndDate)}</dd>
        </div>
        <div>
          <dt>Partecipante</dt>
          <dd>
            <strong>{context.participantName || "-"}</strong>
          </dd>
        </div>
        <div>
          <dt>Email destinataria</dt>
          <dd>{context.parentEmail || "-"}</dd>
        </div>
      </dl>
    </section>
  );
}

function LegalSummaryCard() {
  return (
    <section className="parent-confirm-card">
      <h2>Documenti che stai accettando</h2>
      <details className="parent-confirm-document">
        <summary>{LEGAL_DOCS.participation.title}</summary>
        <p>{LEGAL_DOCS.participation.body}</p>
      </details>
      <details className="parent-confirm-document">
        <summary>{LEGAL_DOCS.privacy.title}</summary>
        <p>{LEGAL_DOCS.privacy.body}</p>
      </details>
      <details className="parent-confirm-document">
        <summary>{LEGAL_DOCS.photo.title}</summary>
        <p>{LEGAL_DOCS.photo.body}</p>
      </details>
      <p className="parent-confirm-fineprint">
        I testi sono in fase di revisione legale. Per chiarimenti contatta il dirigente
        della tua unita'.
      </p>
    </section>
  );
}

function ConsentsSection({
  consents,
  onToggleConsent,
}: {
  consents: ParentAuthorizationConsents;
  onToggleConsent: (key: keyof ParentAuthorizationConsents) => void;
}) {
  return (
    <section className="parent-confirm-card">
      <h2>Consensi obbligatori</h2>
      <p className="parent-confirm-section-hint">
        Tutti questi consensi sono richiesti per autorizzare la partecipazione.
      </p>
      <div className="parent-confirm-checkbox-list">
        {PARENT_CONSENT_CHECKBOXES.map((item) => (
          <label
            key={item.key}
            className={`parent-confirm-checkbox ${consents[item.key] ? "is-checked" : ""}`}
          >
            <input
              type="checkbox"
              checked={consents[item.key]}
              onChange={() => onToggleConsent(item.key)}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function PhotoConsentSection({
  photoConsent,
  socialPublicationConsent,
  onPhotoConsentChange,
  onSocialConsentChange,
}: {
  photoConsent: PhotoConsentDecision;
  socialPublicationConsent: PhotoConsentDecision;
  onPhotoConsentChange: (value: PhotoConsentDecision) => void;
  onSocialConsentChange: (value: PhotoConsentDecision) => void;
}) {
  return (
    <section className="parent-confirm-card">
      <h2>Foto e video (consensi facoltativi)</h2>
      <p className="parent-confirm-section-hint">
        Questi consensi sono <strong>facoltativi e separati</strong>. Il rifiuto non
        impedisce la partecipazione del minore all'attivita'.
      </p>

      <div className="parent-confirm-photo-block">
        <h3>{PHOTO_CONSENT_OPTIONS[0].label}</h3>
        <p className="parent-confirm-fineprint">{PHOTO_CONSENT_OPTIONS[0].helpText}</p>
        <PhotoChoice value={photoConsent} onChange={onPhotoConsentChange} />
      </div>

      <div className="parent-confirm-photo-block">
        <h3>{PHOTO_CONSENT_OPTIONS[1].label}</h3>
        <p className="parent-confirm-fineprint">{PHOTO_CONSENT_OPTIONS[1].helpText}</p>
        <PhotoChoice value={socialPublicationConsent} onChange={onSocialConsentChange} />
      </div>
    </section>
  );
}

function PhotoChoice({
  value,
  onChange,
}: {
  value: PhotoConsentDecision;
  onChange: (value: PhotoConsentDecision) => void;
}) {
  return (
    <div className="parent-confirm-photo-choice">
      <label className={value === "accepted" ? "is-active is-accept" : ""}>
        <input
          type="radio"
          checked={value === "accepted"}
          onChange={() => onChange("accepted")}
        />
        <span>Acconsento</span>
      </label>
      <label className={value === "refused" ? "is-active is-refuse" : ""}>
        <input
          type="radio"
          checked={value === "refused"}
          onChange={() => onChange("refused")}
        />
        <span>Non acconsento</span>
      </label>
      <label className={value === "not_answered" ? "is-active" : ""}>
        <input
          type="radio"
          checked={value === "not_answered"}
          onChange={() => onChange("not_answered")}
        />
        <span>Decido dopo</span>
      </label>
    </div>
  );
}

function SignatureSection({
  signatureRef,
  onSignatureChange,
}: {
  signatureRef: React.RefObject<SignaturePadHandle | null>;
  onSignatureChange: (hasSignature: boolean) => void;
}) {
  return (
    <section className="parent-confirm-card">
      <h2>Firma elettronica</h2>
      <p className="parent-confirm-section-hint">
        Disegna qui la tua firma con il dito (su mobile/tablet) o con il mouse. Non e'
        una firma digitale qualificata: e' una firma elettronica semplice che attesta
        la tua dichiarazione.
      </p>
      <div className="parent-confirm-signature-wrapper">
        <SignaturePad
          ref={signatureRef}
          onChange={(hasContent) => onSignatureChange(hasContent)}
        />
      </div>
    </section>
  );
}

function ConfirmedCard() {
  return (
    <section className="parent-confirm-card parent-confirm-card--success">
      <div className="parent-confirm-card__icon" aria-hidden="true">
        <AppIcon name="check" />
      </div>
      <div>
        <h2>Autorizzazione confermata</h2>
        <p>
          Grazie. L'autorizzazione e' stata registrata correttamente. Gli organizzatori
          dell'attivita' riceveranno una notifica e l'iscrizione del minore risulta ora
          autorizzata. Puoi chiudere questa pagina.
        </p>
        <p className="parent-confirm-fineprint">
          Una copia PDF dell'autorizzazione viene conservata in modo sicuro dagli admin.
          Se vuoi una copia per i tuoi archivi, contatta il dirigente della tua unita'.
        </p>
      </div>
    </section>
  );
}

function RejectedCard() {
  return (
    <section className="parent-confirm-card parent-confirm-card--info">
      <div className="parent-confirm-card__icon" aria-hidden="true">
        <AppIcon name="bell" />
      </div>
      <div>
        <h2>Autorizzazione rifiutata</h2>
        <p>
          Abbiamo registrato il tuo rifiuto. Gli organizzatori dell'attivita' verranno
          notificati e l'iscrizione del minore risulta non autorizzata. Puoi chiudere
          questa pagina.
        </p>
        <p className="parent-confirm-fineprint">
          Se cambi idea, contatta il dirigente della tua unita': potra' inviarti un
          nuovo link di autorizzazione.
        </p>
      </div>
    </section>
  );
}

function RejectModal({
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  reason: string;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="parent-confirm-modal-backdrop" role="dialog" aria-modal="true">
      <div className="parent-confirm-modal">
        <h2>Confermi il rifiuto?</h2>
        <p>
          L'iscrizione del minore verra' marcata come <strong>non autorizzata</strong>.
          Gli organizzatori riceveranno una notifica.
        </p>
        <label className="parent-confirm-modal-field">
          <span>Motivo (facoltativo)</span>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Es. ho un conflitto di date, preferisco un'altra attivita', ecc."
            rows={3}
          />
        </label>
        <div className="parent-confirm-modal-actions">
          <button
            className="button button--ghost"
            onClick={onCancel}
            type="button"
          >
            Annulla
          </button>
          <button
            className="button button--primary parent-confirm-reject-confirm"
            onClick={onConfirm}
            type="button"
          >
            Conferma rifiuto
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
