import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import {
  ConsentChoices,
  consentChoiceFromDecision as toChoice,
  getConsentChoicesProblem,
  type ConsentChoicesValue,
} from "@/components/ConsentChoices";
import { UnofficialDisclaimer } from "@/components/UnofficialDisclaimer";
import { SUPPORT_CONTACT_TEXT } from "@/constants/legalDocs";
import { useAuth } from "@/hooks/useAuth";
import {
  parentAuthorizationService,
  type ParentConsentContext,
  type UpdateConsentResult,
} from "@/services/firestore/parentAuthorizationService";
import type { PhotoConsentDecision } from "@/types";
import { isConsentStaleError } from "@/utils/callableError";

import { formatDateRange, StatusPanel, useNoIndex } from "./parentPageShared";

type ViewState =
  | { stage: "loading" }
  | { stage: "context_error"; message: string }
  | { stage: "ready"; context: ParentConsentContext }
  | { stage: "saved"; context: ParentConsentContext; result: UpdateConsentResult };

const LINK_PROBLEMS: Record<
  Exclude<ParentConsentContext["status"], "valid">,
  { title: string; body: string }
> = {
  not_found: {
    title: "Link non valido",
    body: "Questo link non risulta nei nostri sistemi. Controlla di aver aperto l'ultima email ricevuta. Se il problema persiste contatta il dirigente della tua unità.",
  },
  expired: {
    title: "Link scaduto",
    body: "Questo link è scaduto. Per ricevere un nuovo link contatta il dirigente della tua unità.",
  },
  mismatch: {
    title: "Link non più valido",
    body: "Questo link non è più valido perché l'indirizzo email del genitore è cambiato. Controlla l'email più recente che hai ricevuto.",
  },
  not_signed: {
    title: "Autorizzazione non ancora firmata",
    body: "Le scelte su foto e social si danno insieme alla firma dell'autorizzazione. Completa prima la firma dal link che ti abbiamo mandato.",
  },
};

function describeDecision(value: PhotoConsentDecision) {
  if (value === "accepted") return { text: "Acconsento", tone: "accepted" } as const;
  if (value === "not_answered") return { text: "Da completare", tone: "pending" } as const;
  return { text: "Non acconsento", tone: "refused" } as const;
}

export function ParentConsentPage() {
  useNoIndex("Scelte su foto e social");

  const { token } = useParams();
  const { session } = useAuth();
  const isParentSession = Boolean(session?.isParent);
  const [view, setView] = useState<ViewState>({ stage: "loading" });
  const [choices, setChoices] = useState<ConsentChoicesValue>({ photo: null, social: null });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Le scelte sono cambiate altrove: serve rileggerle prima di salvare.
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  // Cambia quando la pagina si smonta o il link cambia: le risposte asincrone
  // partite prima non devono più aggiornare lo stato.
  const epochRef = useRef(0);

  useEffect(() => {
    if (!token) {
      setView({ stage: "context_error", message: "Link non valido (token mancante)." });
      return;
    }

    let cancelled = false;
    parentAuthorizationService
      .getConsentContext(token)
      .then((context) => {
        if (cancelled) return;
        setChoices({
          photo: toChoice(context.photoConsent),
          social: toChoice(context.socialPublicationConsent),
        });
        setView({ stage: "ready", context });
      })
      .catch((error) => {
        if (cancelled) return;
        setView({
          stage: "context_error",
          message:
            error instanceof Error
              ? error.message
              : "Impossibile verificare il link. Riprova tra poco.",
        });
      });

    return () => {
      cancelled = true;
      epochRef.current += 1;
    };
  }, [token]);

  // Rilegge dal server le scelte e la loro data (`expectedUpdatedAt`) e riapre
  // il modulo con i valori attuali.
  async function reloadContext() {
    if (!token) return;
    const epoch = epochRef.current;
    setReloading(true);
    setReloadError(null);
    try {
      const context = await parentAuthorizationService.getConsentContext(token);
      if (epoch !== epochRef.current) return;
      setChoices({
        photo: toChoice(context.photoConsent),
        social: toChoice(context.socialPublicationConsent),
      });
      setSaveError(null);
      setStale(false);
      setView({ stage: "ready", context });
    } catch (error) {
      if (epoch !== epochRef.current) return;
      setReloadError(
        error instanceof Error
          ? error.message
          : "Non siamo riusciti a rileggere le scelte. Riprova tra poco.",
      );
    } finally {
      if (epoch === epochRef.current) setReloading(false);
    }
  }

  async function handleSave() {
    if (!token || view.stage !== "ready") return;
    const { photo, social } = choices;
    if (photo === null || social === null) return;
    const epoch = epochRef.current;

    setSaving(true);
    setSaveError(null);
    try {
      const result = await parentAuthorizationService.updateConsent({
        token,
        photoConsent: photo,
        socialPublicationConsent: social,
        expectedUpdatedAt: view.context.consentUpdatedAt ?? null,
      });
      if (epoch !== epochRef.current) return;
      setReloadError(null);
      setView({ stage: "saved", context: view.context, result });
    } catch (error) {
      if (epoch !== epochRef.current) return;
      setStale(isConsentStaleError(error));
      setSaveError(
        error instanceof Error
          ? error.message
          : "Non siamo riusciti a salvare le scelte. Riprova tra poco.",
      );
    } finally {
      if (epoch === epochRef.current) setSaving(false);
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

        {view.stage === "context_error" ? (
          <StatusPanel tone="error" title="Impossibile verificare il link" icon="bell">
            <p>{view.message}</p>
          </StatusPanel>
        ) : null}

        {view.stage === "ready" && view.context.status !== "valid" ? (
          <StatusPanel
            tone="info"
            title={LINK_PROBLEMS[view.context.status].title}
            icon="bell"
          >
            <p>{LINK_PROBLEMS[view.context.status].body}</p>
          </StatusPanel>
        ) : null}

        {view.stage === "ready" && view.context.status === "valid" ? (
          <ConsentForm
            context={view.context}
            choices={choices}
            saving={saving}
            saveError={saveError}
            stale={stale}
            reloading={reloading}
            reloadError={reloadError}
            onChange={(next) => {
              setSaveError(null);
              setChoices(next);
            }}
            onSave={() => void handleSave()}
            onReload={() => void reloadContext()}
          />
        ) : null}

        {view.stage === "saved" ? (
          <StatusPanel tone="success" title="Scelte salvate" icon="check">
            <ul className="consent-summary">
              <li>
                <span>Foto per l'album</span>
                <SummaryValue value={view.result.photoConsent} />
              </li>
              <li>
                <span>Pubblicazione sui social</span>
                <SummaryValue value={view.result.socialPublicationConsent} />
              </li>
            </ul>
            {view.result.receiptSent ? (
              <p className="parent-confirm-fineprint">
                Ti abbiamo mandato una ricevuta via email.
              </p>
            ) : null}
            <p className="parent-confirm-fineprint">
              Puoi cambiare di nuovo le scelte quando vuoi da questo link. Puoi chiudere questa
              pagina.
            </p>
            {reloadError ? (
              <p className="consent-choices__error" role="alert">
                <AppIcon name="bell" />
                <span>{reloadError}</span>
              </p>
            ) : null}
            <button
              className="button button--soft"
              disabled={reloading}
              onClick={() => void reloadContext()}
              type="button"
            >
              <AppIcon name="pencil" />
              <span>{reloading ? "Un attimo..." : "Modifica ancora"}</span>
            </button>
            {isParentSession ? (
              <Link className="button button--primary" to="/family">
                <AppIcon name="home" />
                <span>Torna alla tua famiglia</span>
              </Link>
            ) : null}
          </StatusPanel>
        ) : null}
      </div>

      <footer className="pc-footnote">
        <p>{SUPPORT_CONTACT_TEXT}</p>
        <UnofficialDisclaimer compact />
      </footer>
    </div>
  );
}

function SummaryValue({ value }: { value: PhotoConsentDecision }) {
  const { text, tone } = describeDecision(value);
  return <span className={`consent-summary__value consent-summary__value--${tone}`}>{text}</span>;
}

function ConsentForm({
  context,
  choices,
  saving,
  saveError,
  stale,
  reloading,
  reloadError,
  onChange,
  onSave,
  onReload,
}: {
  context: ParentConsentContext;
  choices: ConsentChoicesValue;
  saving: boolean;
  saveError: string | null;
  stale: boolean;
  reloading: boolean;
  reloadError: string | null;
  onChange: (value: ConsentChoicesValue) => void;
  onSave: () => void;
  onReload: () => void;
}) {
  const problem = getConsentChoicesProblem(choices.photo, choices.social);
  const initialPhoto = toChoice(context.photoConsent);
  const initialSocial = toChoice(context.socialPublicationConsent);
  // Si salva solo se qualcosa è cambiato, oppure se manca una risposta (il
  // silenzio non vale come consenso: va data una scelta, anche il no).
  const wasIncomplete = initialPhoto === null || initialSocial === null;
  const changed = choices.photo !== initialPhoto || choices.social !== initialSocial;
  const withdrawsConsent =
    (initialPhoto === "accepted" && choices.photo === "refused") ||
    (initialSocial === "accepted" && choices.social === "refused");
  const canSave = problem === null && (changed || wasIncomplete) && !saving && !stale;

  return (
    <>
      <header className="pc-dialog__head">
        <span className="pc-dialog__eyebrow">Autorizzazione genitore o tutore</span>
        <h1>Scelte su foto e social</h1>
        <p className="pc-dialog__meta">
          Per {context.participantName || "il minore"}
          {context.activityTitle ? ` · ${context.activityTitle}` : ""}
          {context.activityStartDate
            ? ` · ${formatDateRange(context.activityStartDate, context.activityEndDate)}`
            : ""}
        </p>
      </header>

      <div className="pc-dialog__body">
        <p className="pc-step-intro">
          {wasIncomplete
            ? "Servono due risposte, una per le foto e una per i social. Sono obbligatorie, anche il no. "
            : "Queste sono le scelte attuali. Cambiale quando vuoi. "}
          Il rifiuto non impedisce la partecipazione all'attività. Non serve rifare la firma.
        </p>
        <ConsentChoices value={choices} onChange={onChange} disabled={saving} />
        {withdrawsConsent ? (
          <p className="consent-note">
            <AppIcon name="bell" />
            <span>
              Le foto già fatte non vengono cancellate in automatico: gli organizzatori le
              rivedono e tolgono quelle che non puoi più autorizzare.
            </span>
          </p>
        ) : null}
        {saveError ? (
          <p className="consent-choices__error" role="alert">
            <AppIcon name="bell" />
            <span>{saveError}</span>
          </p>
        ) : null}
        {reloadError ? (
          <p className="consent-choices__error" role="alert">
            <AppIcon name="bell" />
            <span>{reloadError}</span>
          </p>
        ) : null}
      </div>

      <footer className="pc-dialog__foot">
        <div className="pc-dialog__foot-buttons">
          <button
            className="button button--primary"
            disabled={!canSave}
            onClick={onSave}
            type="button"
          >
            <AppIcon name="check" />
            <span>{saving ? "Salvataggio..." : "Salva le scelte"}</span>
          </button>
          {stale ? (
            <button
              className="button button--soft"
              disabled={reloading}
              onClick={onReload}
              type="button"
            >
              <AppIcon name="refresh" />
              <span>{reloading ? "Un attimo..." : "Ricarica le scelte"}</span>
            </button>
          ) : null}
        </div>
        {problem ? <p className="pc-dialog__foot-hint">{problem}</p> : null}
        {!problem && !changed && !wasIncomplete ? (
          <p className="pc-dialog__foot-hint">Nessuna modifica da salvare.</p>
        ) : null}
      </footer>
    </>
  );
}
