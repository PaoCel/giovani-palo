import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import { recordNightService } from "@/services/firestore/recordNightService";
import type { RecordNightRecord } from "@/types";
import { getRecordNightMeasureShortLabel } from "@/utils/recordNight";
import { GUEST_COPY, groupPublicRecordsByCategory } from "@/utils/recordNightGuest";

import { CategoryPill } from "./parts";

// L'editor attività si apre anche da pagine che non caricano la scheda dei record:
// gli stili `rna-*` li porta questo file.
import "@/styles/recordNightAdmin.css";

interface GuestRecordsToggleProps {
  // L'attività salvata (assenti = attività nuova: ancora nessun record).
  stakeId: string | null;
  activityId: string | null;
  enabled: boolean;
  // Era già acceso quando si è aperto l'editor: l'anteprima l'ha già vista chi
  // l'ha acceso, la spunta serve solo per accenderlo.
  alreadyEnabled: boolean;
  reviewed: boolean;
  // Il salvataggio è stato fermato perché manca la spunta.
  reviewMissing: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onReviewedChange: (reviewed: boolean) => void;
}

type PreviewState =
  { status: "loading" } | { status: "error" } | { status: "ready"; records: RecordNightRecord[] };

const REVIEW_NEEDED_MESSAGE =
  "Per accenderlo controlla i titoli qui sotto e spunta «Ho controllato i titoli».";

// Interruttore "Record senza account" dell'editor attività, con l'anteprima di
// ciò che vedrebbero i visitatori senza account: solo titolo, categoria e come si
// misura dei record aperti con iscritti (lo stesso elenco che dà il contesto
// pubblico). Per accenderlo si spunta "Ho controllato i titoli": i titoli già
// approvati quando l'elenco era solo per chi ha un account diventano pubblici
// solo dopo questo passaggio. Spento di default.
export function GuestRecordsToggle({
  stakeId,
  activityId,
  enabled,
  alreadyEnabled,
  reviewed,
  reviewMissing,
  onEnabledChange,
  onReviewedChange,
}: GuestRecordsToggleProps) {
  const [preview, setPreview] = useState<PreviewState>(() =>
    stakeId && activityId ? { status: "loading" } : { status: "ready", records: [] },
  );
  const [reviewHint, setReviewHint] = useState(false);
  // Sale a ogni "Riprova": rifà la lettura dell'anteprima.
  const [attempt, setAttempt] = useState(0);
  const baseId = useId();
  const reviewRef = useRef<HTMLInputElement>(null);
  const hasActivity = Boolean(stakeId && activityId);

  useEffect(() => {
    let cancelled = false;
    if (!stakeId || !activityId) {
      setPreview({ status: "ready", records: [] });
      return undefined;
    }
    setPreview({ status: "loading" });
    recordNightService
      .listAllRecords(stakeId, activityId)
      .then((records) => {
        if (!cancelled) setPreview({ status: "ready", records });
      })
      .catch((caught) => {
        if (cancelled) return;
        console.error("Notte dei Record: anteprima pubblica non disponibile.", caught);
        setPreview({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, attempt, stakeId]);

  // Quello che vedrebbe un visitatore: record aperti con iscritti, per categoria.
  const visible = useMemo(() => {
    if (preview.status !== "ready") return [];
    const open = preview.records
      .filter((record) => record.status === "open" && record.challengerCount > 0)
      .map((record) => ({
        id: record.id,
        title: record.title,
        category: record.category,
        measure: record.measure,
        durationSeconds: record.durationSeconds,
      }));
    return groupPublicRecordsByCategory(open).flatMap((group) => group.records);
  }, [preview]);

  const needsReview = !alreadyEnabled;
  const showHint = reviewHint || reviewMissing;
  const toggleId = `${baseId}-toggle`;
  const reviewId = `${baseId}-review`;
  const hintId = `${baseId}-hint`;

  function handleEnabledChange(next: boolean) {
    // Per accenderlo serve la spunta: senza, resta spento e si indica dove.
    if (next && needsReview && !reviewed) {
      setReviewHint(true);
      reviewRef.current?.focus();
      return;
    }
    setReviewHint(false);
    onEnabledChange(next);
  }

  return (
    <div className="rna-guest-toggle">
      <label className="toggle-field" htmlFor={toggleId}>
        <input
          checked={enabled}
          id={toggleId}
          onChange={(event) => handleEnabledChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          Record senza account
          <small>
            Chi non ha un account vede i record e può segnarsi con nome e unità. Un adulto controlla
            e collega ogni richiesta.
          </small>
          <i
            aria-hidden="true"
            className={
              enabled
                ? "rna-guest-toggle__status rna-guest-toggle__status--on"
                : "rna-guest-toggle__status"
            }
          >
            {enabled ? "Acceso" : "Spento"}
          </i>
        </span>
      </label>

      <div className="rna-preview">
        <div className="rna-preview__head">
          <h5>Anteprima per chi non ha un account</h5>
          <p>
            Questo è tutto ciò che vedranno i visitatori senza account. Riguarda i titoli prima di
            accendere.
          </p>
        </div>
        <p className="rna-warn" role="note">
          <AppIcon name="eye" />
          <span>{GUEST_COPY.publicTitleReminder}</span>
        </p>

        {preview.status === "loading" ? (
          <p className="rna-empty-inline" role="status">
            Sto caricando i record...
          </p>
        ) : preview.status === "error" ? (
          <div className="rna-notice rna-notice--error" role="alert">
            <p>
              Non riesco a caricare i record, quindi non posso mostrarti l'anteprima. Controlla la
              connessione e riprova.
            </p>
            <button
              className="button button--ghost button--small"
              onClick={() => setAttempt((current) => current + 1)}
              type="button"
            >
              Riprova
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="rna-empty-inline">
            {hasActivity
              ? "Ancora nessun record aperto con iscritti: oggi i visitatori vedrebbero un elenco vuoto."
              : "I record compaiono quando l'attività è salvata e lo staff approva le proposte."}{" "}
            I titoli che approverai da adesso li vedranno tutti, anche senza account.
          </p>
        ) : (
          <ul aria-label="Record visibili senza account" className="rna-preview__list">
            {visible.map((record) => (
              <li className="rna-preview__item" key={record.id}>
                <strong>{record.title}</strong>
                <span className="rna-preview__meta">
                  <CategoryPill category={record.category} />
                  <span>
                    {getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="rna-preview__never">
          <b>Non compaiono:</b>
          <span>nomi</span>
          <span>unità</span>
          <span>note</span>
          <span>numero di iscritti</span>
        </div>

        {needsReview ? (
          <>
            <label
              className={showHint && !reviewed ? "rna-verify rna-verify--needed" : "rna-verify"}
              htmlFor={reviewId}
            >
              <input
                aria-describedby={showHint && !reviewed ? hintId : undefined}
                checked={reviewed}
                disabled={preview.status !== "ready"}
                id={reviewId}
                onChange={(event) => {
                  onReviewedChange(event.target.checked);
                  if (event.target.checked) setReviewHint(false);
                }}
                ref={reviewRef}
                type="checkbox"
              />
              <span>Ho controllato i titoli</span>
            </label>
            {showHint && !reviewed ? (
              <p className="field-error" id={hintId} role="alert">
                {REVIEW_NEEDED_MESSAGE}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
