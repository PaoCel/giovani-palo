import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import {
  ConsentChoices,
  getConsentChoicesProblem,
  type ConsentChoicesValue,
} from "@/components/ConsentChoices";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { useAuth } from "@/hooks/useAuth";
import { canManageFamily } from "@/utils/family";
import { UnofficialDisclaimer } from "@/components/UnofficialDisclaimer";
import { FIRMA } from "@/copy/firma";
import {
  PARENT_CONSENT_CHECKBOXES,
  SUPPORT_CONTACT_TEXT,
  LEGAL_DOCS,
} from "@/constants/legalDocs";
import {
  parentAuthorizationService,
  type ParentAuthorizationContext,
  type ParentTokenStatus,
} from "@/services/firestore/parentAuthorizationService";
import type { ParentAuthorizationConsents } from "@/types";

import { getCallableErrorReason } from "@/utils/callableError";

import { formatDateRange, StatusPanel, useNoIndex } from "./parentPageShared";

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
  | { stage: "submit_error"; message: string; reason?: string };

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

export function ParentConfirmPage() {
  useNoIndex("Autorizzazione genitore");

  const { token } = useParams();
  // Chi arriva dal magic-link non è loggato; chi firma dall'app sì, e merita
  // una via di ritorno invece di "puoi chiudere questa pagina".
  const { session } = useAuth();
  // Famiglia per ogni account che può avere figli (G2), non solo `parent`.
  const familySession = canManageFamily(session);
  const [view, setView] = useState<ViewState>({ stage: "loading" });
  const [stepIndex, setStepIndex] = useState(0);
  const [consents, setConsents] = useState<ParentAuthorizationConsents>(INITIAL_CONSENTS);
  // Nessuna risposta preselezionata: vanno date entrambe, anche il no.
  const [choices, setChoices] = useState<ConsentChoicesValue>({ photo: null, social: null });
  // Messaggio della callable da mostrare nel passo foto quando si torna indietro.
  const [photoStepNotice, setPhotoStepNotice] = useState<string | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);
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
  const choicesProblem = getConsentChoicesProblem(choices.photo, choices.social);
  const canSubmit =
    allRequiredConsentsChecked &&
    choicesProblem === null &&
    (hasSignature || hasReusableSignature);

  function changeChoices(next: ConsentChoicesValue) {
    setPhotoStepNotice(null);
    setChoices(next);
  }

  function toggleConsent(key: keyof ParentAuthorizationConsents) {
    setConsents((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleConfirm() {
    if (!token || !canSubmit || view.stage !== "ready") return;
    const { photo, social } = choices;
    if (photo === null || social === null) return;
    const readyView = view;

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
      setSignatureError(FIRMA.firmaIlleggibile);
      return;
    }

    setSignatureError(null);

    setView({ stage: "submitting" });

    try {
      await parentAuthorizationService.confirm({
        token,
        consents,
        photoConsent: photo,
        socialPublicationConsent: social,
        signatureDataUrl,
        useStoredSignature: shouldUseStoredSignature,
      });

      setView({ stage: "confirmed" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Si è verificato un errore durante la conferma.";
      const reason = getCallableErrorReason(error);

      if (reason === "social_needs_photo") {
        // Dati e consensi restano nello stato: si torna al passo foto con il
        // messaggio. La firma disegnata va rifatta (il riquadro si rimonta).
        setHasSignature(false);
        setPhotoStepNotice(message);
        setStepIndex(1);
        setView(readyView);
        return;
      }

      setView({ stage: "submit_error", message, reason });
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
          <TokenInvalidPanel context={view.context} status={view.status} />
        ) : null}

        {view.stage === "ready" &&
        view.status === "valid" &&
        view.context.canSignInApp &&
        view.context.createdByMode === "self" ? (
          <p className="parent-confirm-fineprint">{FIRMA.notaLinkAutorizzaOra}</p>
        ) : null}

        {view.stage === "ready" && view.status === "valid" ? (
          <ConfirmationWizard
            context={view.context}
            stepIndex={stepIndex}
            consents={consents}
            choices={choices}
            choicesProblem={choicesProblem}
            photoStepNotice={photoStepNotice}
            allRequiredConsentsChecked={allRequiredConsentsChecked}
            hasReusableSignature={hasReusableSignature}
            hasSignature={hasSignature}
            canSubmit={canSubmit}
            signatureRef={signatureRef}
            onStepChange={(index) => {
              setStepIndex(index);
              setSignatureError(null);
            }}
            onToggleConsent={toggleConsent}
            onChoicesChange={changeChoices}
            signatureError={signatureError}
            onSignatureChange={(value) => {
              setHasSignature(value);
              setSignatureError(null);
            }}
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
              Se vuoi una copia per i tuoi archivi, contatta il dirigente della tua unità.
            </p>
            <p className="parent-confirm-fineprint">
              Le scelte su foto e social si cambiano quando vuoi dal link nella mail con la
              copia firmata
              {familySession ? " o dalla pagina famiglia" : ""}.
            </p>
            {familySession ? (
              <Link className="button button--primary" to="/family">
                <AppIcon name="home" />
                <span>{FIRMA.tornaAllaFamiglia}</span>
              </Link>
            ) : null}
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
              {view.reason === "consent_required" ? "Ricarica la pagina" : "Riprova"}
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
  choices: ConsentChoicesValue;
  choicesProblem: string | null;
  photoStepNotice: string | null;
  allRequiredConsentsChecked: boolean;
  hasReusableSignature: boolean;
  hasSignature: boolean;
  canSubmit: boolean;
  signatureRef: React.RefObject<SignaturePadHandle | null>;
  signatureError: string | null;
  onStepChange: (index: number) => void;
  onToggleConsent: (key: keyof ParentAuthorizationConsents) => void;
  onChoicesChange: (value: ConsentChoicesValue) => void;
  onSignatureChange: (hasSignature: boolean) => void;
  onConfirm: () => void;
  onOpenReject: () => void;
}

function ConfirmationWizard({
  context,
  stepIndex,
  consents,
  choices,
  choicesProblem,
  photoStepNotice,
  allRequiredConsentsChecked,
  hasReusableSignature,
  hasSignature,
  canSubmit,
  signatureRef,
  signatureError,
  onStepChange,
  onToggleConsent,
  onChoicesChange,
  onSignatureChange,
  onConfirm,
  onOpenReject,
}: ConfirmationWizardProps) {
  const { session } = useAuth();
  // Famiglia per ogni account che può avere figli (G2), non solo `parent`.
  const familySession = canManageFamily(session);
  const step = WIZARD_STEPS[stepIndex];
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const nextDisabled =
    (step.id === "conditions" && !allRequiredConsentsChecked) ||
    (step.id === "photos" && choicesProblem !== null);

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
              Servono due risposte, una per le foto e una per i social. Sono obbligatorie,
              anche il no. Il rifiuto non impedisce la partecipazione
              {context.participantName ? ` di ${context.participantName}` : " del minore"}{" "}
              all'attività.
            </p>
            <ConsentChoices value={choices} onChange={onChoicesChange} />
            {photoStepNotice ? (
              <p className="consent-choices__error" role="alert">
                <AppIcon name="bell" />
                <span>{photoStepNotice}</span>
              </p>
            ) : null}
            <p className="parent-confirm-fineprint">
              Potrai cambiare idea quando vuoi dal link nella mail con la copia firmata
              {familySession ? " o dalla pagina famiglia" : ""}.
            </p>
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
            {signatureError ? (
              <p className="consent-choices__error" role="alert">
                <AppIcon name="bell" />
                <span>{signatureError}</span>
              </p>
            ) : null}
            <p className="parent-confirm-fineprint">
              Cliccando "Confermo" dichiari di essere il genitore o tutore legale del minore e
              accetti i consensi sopra. Il consenso è raccolto tramite procedura elettronica
              {familySession
                ? " dal tuo account genitore, autenticato su questa piattaforma."
                : " con link unico inviato all'indirizzo email che ci hai fornito."}
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
        {step.id === "photos" && choicesProblem ? (
          <p className="pc-dialog__foot-hint">{choicesProblem}</p>
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

function TokenInvalidPanel({
  status,
  context,
}: {
  status: ParentTokenStatus;
  context: ParentAuthorizationContext;
}) {
  // Solo il genitore titolare dell'iscrizione può firmare da Famiglia: lo dice
  // il server (un account genitore qualunque non basta).
  const canSignInApp = Boolean(context.canSignInApp);
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
      title: FIRMA.linkSostituitoTitolo,
      body: canSignInApp ? FIRMA.linkSostituitoConAccount : FIRMA.linkSostituitoSenzaAccount,
    },
  };

  const registrationCancelled =
    status === "invalidated" && context.reason === "registration_cancelled";
  const info = registrationCancelled
    ? { title: FIRMA.iscrizioneAnnullataTitolo, body: FIRMA.iscrizioneAnnullataCorpo }
    : status === "expired" && canSignInApp
      ? { title: FIRMA.linkScadutoTitolo, body: FIRMA.linkScadutoConAccount }
      : messages[status as Exclude<ParentTokenStatus, "valid">] ?? messages.not_found;
  // Per un genitore entrato la strada è Famiglia: "Autorizza ora" crea un link nuovo.
  const showFamilyLink =
    canSignInApp && (registrationCancelled || status === "invalidated" || status === "expired");

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
      {showFamilyLink ? (
        <Link className="button button--primary" to="/family">
          <AppIcon name="home" />
          <span>{FIRMA.tornaAllaFamiglia}</span>
        </Link>
      ) : null}
    </StatusPanel>
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
