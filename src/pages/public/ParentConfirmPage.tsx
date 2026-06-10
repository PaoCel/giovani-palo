import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { UnofficialDisclaimer } from "@/components/UnofficialDisclaimer";
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

const WIZARD_STEPS = [
  { id: "conditions", label: "Condizioni" },
  { id: "photos", label: "Foto e video" },
  { id: "signature", label: "Firma" },
] as const;

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
  const [stepIndex, setStepIndex] = useState(0);
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

  const hasReusableSignature =
    view.stage === "ready" &&
    view.status === "valid" &&
    Boolean(view.context.hasReusableSignature);
  const canSubmit = allRequiredConsentsChecked && (hasSignature || hasReusableSignature);

  function toggleConsent(key: keyof ParentAuthorizationConsents) {
    setConsents((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleConfirm() {
    if (!token || !canSubmit) return;

    // Esporta la firma PRIMA di cambiare stage: se l'export fallisce (es.
    // race del resize che svuota il canvas) restiamo sul modulo senza
    // perdere consensi e firma, invece di finire in submit_error.
    let signatureDataUrl: string | null = null;
    if (hasSignature) {
      const signatureBlob = await signatureRef.current?.toBlob();
      const exported = signatureBlob ? await blobToDataUrl(signatureBlob) : "";
      signatureDataUrl = exported || null;
    }

    const shouldUseStoredSignature = hasReusableSignature && !signatureDataUrl;

    if (!signatureDataUrl && !shouldUseStoredSignature) {
      window.alert(
        "Non sono riuscito a leggere la firma disegnata. Ridisegna la firma e riprova.",
      );
      return;
    }

    setView({ stage: "submitting" });

    try {
      await parentAuthorizationService.confirm({
        token,
        consents,
        photoConsent,
        socialPublicationConsent,
        signatureDataUrl,
        useStoredSignature: shouldUseStoredSignature,
      });

      setView({ stage: "confirmed" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Si è verificato un errore durante la conferma.";
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
          : "Si è verificato un errore durante il rifiuto.";
      setView({ stage: "submit_error", message });
    }
  }

  return (
    <div className="parent-confirm-page">
      <div className="pc-dialog">
        {view.stage === "loading" ? (
          <StatusPanel tone="neutral" title="Un attimo..." spinner>
            <p>Verifica del link in corso...</p>
          </StatusPanel>
        ) : null}

        {view.stage === "submitting" ? (
          <StatusPanel tone="neutral" title="Salvataggio in corso..." spinner>
            <p>Non chiudere questa pagina.</p>
          </StatusPanel>
        ) : null}

        {view.stage === "context_error" ? (
          <StatusPanel tone="error" title="Impossibile verificare il link" icon="bell">
            <p>{view.message}</p>
          </StatusPanel>
        ) : null}

        {view.stage === "ready" && view.status !== "valid" ? (
          <TokenInvalidPanel status={view.status} context={view.context} />
        ) : null}

        {view.stage === "ready" && view.status === "valid" ? (
          <ConfirmationWizard
            context={view.context}
            stepIndex={stepIndex}
            consents={consents}
            photoConsent={photoConsent}
            socialPublicationConsent={socialPublicationConsent}
            allRequiredConsentsChecked={allRequiredConsentsChecked}
            hasReusableSignature={hasReusableSignature}
            hasSignature={hasSignature}
            canSubmit={canSubmit}
            signatureRef={signatureRef}
            onStepChange={setStepIndex}
            onToggleConsent={toggleConsent}
            onPhotoConsentChange={setPhotoConsent}
            onSocialConsentChange={setSocialPublicationConsent}
            onSignatureChange={setHasSignature}
            onConfirm={handleConfirm}
            onOpenReject={() => setShowRejectModal(true)}
          />
        ) : null}

        {view.stage === "confirmed" ? (
          <StatusPanel tone="success" title="Tutto completato" icon="check">
            <p>
              Grazie. L'autorizzazione è stata registrata correttamente. Gli organizzatori
              dell'attività riceveranno una notifica e l'iscrizione del minore risulta ora
              autorizzata. Puoi chiudere questa pagina.
            </p>
            <p className="parent-confirm-fineprint">
              Una copia PDF dell'autorizzazione viene conservata in modo sicuro dagli admin.
              Se vuoi una copia per i tuoi archivi, contatta il dirigente della tua unita'.
            </p>
          </StatusPanel>
        ) : null}

        {view.stage === "rejected" ? (
          <StatusPanel tone="info" title="Autorizzazione rifiutata" icon="bell">
            <p>
              Abbiamo registrato il tuo rifiuto. Gli organizzatori dell'attività verranno
              notificati e l'iscrizione del minore risulta non autorizzata. Puoi chiudere
              questa pagina.
            </p>
            <p className="parent-confirm-fineprint">
              Se cambi idea, contatta il dirigente della tua unità: potrà inviarti un
              nuovo link di autorizzazione.
            </p>
          </StatusPanel>
        ) : null}

        {view.stage === "submit_error" ? (
          <StatusPanel tone="error" title="Operazione non riuscita" icon="bell">
            <p>{view.message}</p>
            <button
              className="button button--primary"
              onClick={() => window.location.reload()}
              type="button"
            >
              Riprova
            </button>
          </StatusPanel>
        ) : null}
      </div>

      <footer className="pc-footnote">
        <p>{SUPPORT_CONTACT_TEXT}</p>
        <UnofficialDisclaimer compact />
      </footer>

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
// Wizard
// =============================================================================

interface ConfirmationWizardProps {
  context: ParentAuthorizationContext;
  stepIndex: number;
  consents: ParentAuthorizationConsents;
  photoConsent: PhotoConsentDecision;
  socialPublicationConsent: PhotoConsentDecision;
  allRequiredConsentsChecked: boolean;
  hasReusableSignature: boolean;
  hasSignature: boolean;
  canSubmit: boolean;
  signatureRef: React.RefObject<SignaturePadHandle | null>;
  onStepChange: (index: number) => void;
  onToggleConsent: (key: keyof ParentAuthorizationConsents) => void;
  onPhotoConsentChange: (value: PhotoConsentDecision) => void;
  onSocialConsentChange: (value: PhotoConsentDecision) => void;
  onSignatureChange: (hasSignature: boolean) => void;
  onConfirm: () => void;
  onOpenReject: () => void;
}

function ConfirmationWizard({
  context,
  stepIndex,
  consents,
  photoConsent,
  socialPublicationConsent,
  allRequiredConsentsChecked,
  hasReusableSignature,
  hasSignature,
  canSubmit,
  signatureRef,
  onStepChange,
  onToggleConsent,
  onPhotoConsentChange,
  onSocialConsentChange,
  onSignatureChange,
  onConfirm,
  onOpenReject,
}: ConfirmationWizardProps) {
  const step = WIZARD_STEPS[stepIndex];
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const nextDisabled = step.id === "conditions" && !allRequiredConsentsChecked;

  function goNext() {
    onStepChange(Math.min(stepIndex + 1, WIZARD_STEPS.length - 1));
  }

  function goBack() {
    onStepChange(Math.max(stepIndex - 1, 0));
  }

  return (
    <>
      <header className="pc-dialog__head">
        <span className="pc-dialog__eyebrow">Autorizzazione genitore o tutore</span>
        <h1>{context.activityTitle || "Attività in chiesa"}</h1>
        <p className="pc-dialog__meta">
          {context.participantName ? `Per ${context.participantName} · ` : ""}
          {formatDateRange(context.activityStartDate, context.activityEndDate)}
        </p>
        <ol className="pc-steps" aria-label="Passaggi">
          {WIZARD_STEPS.map((item, index) => (
            <li
              key={item.id}
              aria-current={index === stepIndex ? "step" : undefined}
              className={
                index === stepIndex
                  ? "pc-steps__item pc-steps__item--active"
                  : index < stepIndex
                    ? "pc-steps__item pc-steps__item--done"
                    : "pc-steps__item"
              }
            >
              <span aria-hidden="true" className="pc-steps__dot">
                {index < stepIndex ? <AppIcon name="check" /> : index + 1}
              </span>
              <span className="pc-steps__label">{item.label}</span>
            </li>
          ))}
        </ol>
      </header>

      <div key={step.id} className="pc-dialog__body">
        {step.id === "conditions" ? (
          <>
            <p className="pc-step-intro">
              Stai accettando queste condizioni per autorizzare la partecipazione
              {context.participantName ? ` di ${context.participantName}` : " del minore"}.
              Puoi aprire ogni documento per leggerlo per intero.
            </p>
            <div className="pc-doc-list">
              <details className="parent-confirm-document">
                <summary>{LEGAL_DOCS.participation.title}</summary>
                <p>{LEGAL_DOCS.participation.body}</p>
              </details>
              <details className="parent-confirm-document">
                <summary>{LEGAL_DOCS.conduct.title}</summary>
                <p>{LEGAL_DOCS.conduct.body}</p>
              </details>
              <details className="parent-confirm-document">
                <summary>{LEGAL_DOCS.privacy.title}</summary>
                <p>{LEGAL_DOCS.privacy.body}</p>
              </details>
              <details className="parent-confirm-document">
                <summary>{LEGAL_DOCS.photo.title}</summary>
                <p>{LEGAL_DOCS.photo.body}</p>
              </details>
            </div>
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
            <p className="parent-confirm-fineprint">
              Il regolamento di comportamento è parte del modulo firmato: il partecipante si
              impegna a rispettarlo durante l'attività.
            </p>
          </>
        ) : null}

        {step.id === "photos" ? (
          <>
            <p className="pc-step-intro">
              Dai il consenso per foto e video? Questi consensi sono{" "}
              <strong>facoltativi e separati</strong>: il rifiuto non impedisce la
              partecipazione del minore all'attività.
            </p>
            <div className="parent-confirm-photo-block">
              <h3>{PHOTO_CONSENT_OPTIONS[0].label}</h3>
              <p className="parent-confirm-fineprint">{PHOTO_CONSENT_OPTIONS[0].helpText}</p>
              <PhotoChoice value={photoConsent} onChange={onPhotoConsentChange} />
            </div>
            <div className="parent-confirm-photo-block">
              <h3>{PHOTO_CONSENT_OPTIONS[1].label}</h3>
              <p className="parent-confirm-fineprint">{PHOTO_CONSENT_OPTIONS[1].helpText}</p>
              <PhotoChoice
                value={socialPublicationConsent}
                onChange={onSocialConsentChange}
              />
            </div>
          </>
        ) : null}

        {step.id === "signature" ? (
          <>
            {hasReusableSignature ? (
              <div className="parent-confirm-reusable-signature">
                <AppIcon name="check" />
                <div>
                  <strong>Firma già salvata per questa email</strong>
                  <p>
                    Puoi confermare subito. Se vuoi sostituirla, disegna una nuova firma
                    nel riquadro qui sotto.
                  </p>
                </div>
              </div>
            ) : (
              <p className="pc-step-intro">
                Disegna qui la tua firma con il dito (su telefono o tablet) o con il mouse.
                Non è una firma digitale qualificata: è una firma elettronica semplice che
                attesta la tua dichiarazione.
              </p>
            )}
            <div className="parent-confirm-signature-wrapper">
              <SignaturePad
                ref={signatureRef}
                onChange={(hasContent) => onSignatureChange(hasContent)}
              />
            </div>
            <p className="parent-confirm-fineprint">
              Cliccando "Confermo" dichiari di essere il genitore o tutore legale del minore e
              accetti i consensi sopra. Il consenso è raccolto tramite procedura elettronica con
              link unico inviato all'indirizzo email che ci hai fornito.
            </p>
          </>
        ) : null}
      </div>

      <footer className="pc-dialog__foot">
        <div className="pc-dialog__foot-buttons">
          {stepIndex > 0 ? (
            <button className="button button--ghost" onClick={goBack} type="button">
              Indietro
            </button>
          ) : null}
          {isLastStep ? (
            <button
              className="button button--primary"
              disabled={!canSubmit}
              onClick={onConfirm}
              type="button"
            >
              <AppIcon name="check" />
              <span>
                {hasReusableSignature && !hasSignature
                  ? "Confermo con la firma salvata"
                  : "Confermo l'autorizzazione"}
              </span>
            </button>
          ) : (
            <button
              className="button button--primary"
              disabled={nextDisabled}
              onClick={goNext}
              type="button"
            >
              <span>Continua</span>
              <AppIcon name="arrow-right" />
            </button>
          )}
        </div>
        {step.id === "conditions" && !allRequiredConsentsChecked ? (
          <p className="pc-dialog__foot-hint">
            Spunta tutte le caselle per continuare.
          </p>
        ) : null}
        {step.id === "signature" && !canSubmit ? (
          <p className="pc-dialog__foot-hint">
            Per confermare serve la firma{hasReusableSignature ? " (o quella salvata)" : ""}.
          </p>
        ) : null}
        <button className="pc-reject-link" onClick={onOpenReject} type="button">
          Non autorizzo la partecipazione
        </button>
        {context.expiresAt ? (
          <p className="pc-dialog__foot-expiry">
            Link valido fino al {formatExpiry(context.expiresAt)}
          </p>
        ) : null}
      </footer>
    </>
  );
}

// =============================================================================
// Status panels
// =============================================================================

function StatusPanel({
  tone,
  title,
  icon,
  spinner = false,
  children,
}: {
  tone: "neutral" | "info" | "success" | "error";
  title: string;
  icon?: "check" | "bell";
  spinner?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`pc-status pc-status--${tone}`}>
      {spinner ? (
        <div className="spinner" aria-hidden="true" />
      ) : icon ? (
        <div className="pc-status__icon" aria-hidden="true">
          <AppIcon name={icon} />
        </div>
      ) : null}
      <h1>{title}</h1>
      {children}
    </div>
  );
}

function TokenInvalidPanel({
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
        "Questo link di autorizzazione non risulta nei nostri sistemi. Verifica di aver aperto l'ultimo link ricevuto via email. Se il problema persiste contatta il dirigente della tua unità.",
    },
    expired: {
      title: "Link scaduto",
      body:
        "Questo link di autorizzazione è scaduto. Per ricevere un nuovo link contatta il dirigente della tua unità che potrà rigenerarne uno valido.",
    },
    used: {
      title: "Autorizzazione già confermata",
      body:
        "Hai già completato la procedura di autorizzazione con questo link. Non è necessario ripeterla. Se ricevi questo messaggio per errore contatta il dirigente.",
    },
    invalidated: {
      title: "Link non più valido",
      body:
        "Questo link è stato sostituito da uno nuovo. Controlla l'email più recente che hai ricevuto e usa quel link al posto di questo.",
    },
  };

  const info = messages[status as Exclude<ParentTokenStatus, "valid">];

  return (
    <StatusPanel tone="info" title={info.title} icon="bell">
      <p>{info.body}</p>
      {context.activityTitle || context.participantName ? (
        <p className="parent-confirm-fineprint">
          <strong>Riferimento:</strong> {context.activityTitle || ""}
          {context.activityTitle && context.participantName ? " - " : ""}
          {context.participantName || ""}
        </p>
      ) : null}
    </StatusPanel>
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
          L'iscrizione del minore verrà marcata come <strong>non autorizzata</strong>.
          Gli organizzatori riceveranno una notifica.
        </p>
        <label className="parent-confirm-modal-field">
          <span>Motivo (facoltativo)</span>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Es. ho un conflitto di date, preferisco un'altra attività, ecc."
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
