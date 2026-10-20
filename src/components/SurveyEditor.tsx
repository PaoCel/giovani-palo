import { useEffect, useRef, useState } from "react";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { ADMIN } from "@/copy/admin";
import { useAuth } from "@/hooks/useAuth";
import { surveysService } from "@/services/firestore/surveysService";
import type {
  SurveyQuestion,
  SurveyQuestionType,
  SurveyQuestionWriteInput,
} from "@/types";
import { getAdminActionError } from "@/utils/adminErrors";
import { withWriteTimeout } from "@/utils/writeTimeout";

interface SurveyEditorProps {
  stakeId: string;
  eventId: string;
}

interface DraftQuestion {
  id: string | null;
  text: string;
  type: SurveyQuestionType;
  fieldCount: number;
  status: "active" | "hidden";
}

const EMPTY_DRAFT: DraftQuestion = {
  id: null,
  text: "",
  type: "rating",
  fieldCount: 3,
  status: "active",
};

export function SurveyEditor({ stakeId, eventId }: SurveyEditorProps) {
  const { session } = useAuth();
  const uid = session?.firebaseUser.uid ?? "";
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftQuestion>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  // "Elimina": prima il foglio di conferma, mai un dialogo del browser.
  const [deleteTarget, setDeleteTarget] = useState<SurveyQuestion | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Numero del foglio: l'esito di una richiesta partita da un foglio chiuso
  // nel frattempo (o da un'altra attività) non tocca quello aperto dopo.
  const deleteRunRef = useRef(0);

  function showDelete(question: SurveyQuestion | null) {
    deleteRunRef.current += 1;
    setDeleteError(null);
    setDeleteTarget(question);
  }

  // Altro account o altra attività con il foglio aperto: si chiude, e l'esito
  // di una richiesta partita prima non lo tocca.
  useEffect(() => {
    showDelete(null);
  }, [uid, stakeId, eventId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    surveysService
      .listQuestions(stakeId, eventId)
      .then((list) => {
        if (!cancelled) setQuestions(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento domande.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stakeId, eventId]);

  async function refresh() {
    const list = await surveysService.listQuestions(stakeId, eventId);
    setQuestions(list);
  }

  async function saveDraft() {
    if (!draft.text.trim()) {
      setError("Testo domanda obbligatorio.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: SurveyQuestionWriteInput = {
        text: draft.text,
        type: draft.type,
        fieldCount: draft.type === "fields" ? draft.fieldCount : 0,
        status: draft.status,
        order: draft.id
          ? questions.find((question) => question.id === draft.id)?.order
          : (questions[questions.length - 1]?.order ?? 0) + 1,
      };
      await surveysService.upsertQuestion(stakeId, eventId, draft.id, payload);
      await refresh();
      setDraft(EMPTY_DRAFT);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore salvataggio.");
    } finally {
      setSaving(false);
    }
  }

  async function seedCampTemplate() {
    setSeeding(true);
    setError(null);
    try {
      await surveysService.seedCampSurveyTemplate(stakeId, eventId);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore creazione sondaggio.");
    } finally {
      setSeeding(false);
    }
  }

  async function removeQuestion(question: SurveyQuestion) {
    const run = deleteRunRef.current;
    setDeleting(true);
    setDeleteError(null);
    try {
      await withWriteTimeout(surveysService.deleteQuestion(stakeId, eventId, question.id));
      setQuestions((current) => current.filter((entry) => entry.id !== question.id));
      setDraft((current) => (current.id === question.id ? EMPTY_DRAFT : current));
      if (run === deleteRunRef.current) {
        showDelete(null);
      }
    } catch (caughtError) {
      if (run === deleteRunRef.current) {
        setDeleteError(getAdminActionError(caughtError, ADMIN.erroreEliminaDomanda));
      }
    } finally {
      setDeleting(false);
    }
  }

  function startEdit(question: SurveyQuestion) {
    setDraft({
      id: question.id,
      text: question.text,
      type: question.type,
      fieldCount: question.fieldCount || 3,
      status: question.status,
    });
  }

  return (
    <div className="stack">
      <div className="surface-panel surface-panel--subtle">
        <h3>{draft.id ? "Modifica domanda" : "Nuova domanda"}</h3>
        <div className="form-stack form-stack--compact">
          <label className="field">
            <span className="field__label">Testo</span>
            <textarea
              className="input input--textarea"
              rows={2}
              value={draft.text}
              onChange={(event) => setDraft((d) => ({ ...d, text: event.target.value }))}
            />
          </label>

          <label className="field">
            <span className="field__label">Tipo</span>
            <select
              className="input"
              value={draft.type}
              onChange={(event) =>
                setDraft((d) => ({ ...d, type: event.target.value as SurveyQuestionType }))
              }
            >
              <option value="rating">Stelline (0-5 con mezze)</option>
              <option value="open">Risposta aperta</option>
              <option value="fields">N campi fissi</option>
            </select>
          </label>

          {draft.type === "fields" ? (
            <label className="field">
              <span className="field__label">Numero campi</span>
              <input
                className="input"
                type="number"
                min={2}
                max={10}
                value={draft.fieldCount}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    fieldCount: Math.max(2, Math.min(10, Number(event.target.value) || 2)),
                  }))
                }
              />
            </label>
          ) : null}

          <label className="field">
            <span className="field__label">Stato</span>
            <select
              className="input"
              value={draft.status}
              onChange={(event) =>
                setDraft((d) => ({
                  ...d,
                  status: event.target.value === "hidden" ? "hidden" : "active",
                }))
              }
            >
              <option value="active">Attiva</option>
              <option value="hidden">Nascosta</option>
            </select>
          </label>

          {error ? <p className="field-error">{error}</p> : null}

          <div className="chip-row">
            <button
              type="button"
              className="button button--primary"
              disabled={saving}
              onClick={saveDraft}
            >
              {saving ? "Salvataggio..." : draft.id ? "Aggiorna domanda" : "Aggiungi domanda"}
            </button>
            {draft.id ? (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setDraft(EMPTY_DRAFT)}
              >
                Annulla modifica
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="stack">
        <h3>Domande del sondaggio ({questions.length})</h3>
        {loading ? <p className="subtle-text">Caricamento...</p> : null}
        {!loading && questions.length === 0 ? (
          <div className="surface-panel surface-panel--subtle">
            <p className="subtle-text">
              Nessuna domanda configurata. Per un campeggio puoi partire dal
              sondaggio post-campeggio standard (valutazioni + cosa migliorare) e
              poi modificarlo.
            </p>
            <button
              type="button"
              className="button button--primary button--small"
              disabled={seeding}
              onClick={seedCampTemplate}
            >
              {seeding ? "Creazione..." : "Crea sondaggio post-campeggio"}
            </button>
          </div>
        ) : null}
        {questions.map((question) => (
          <article key={question.id} className="surface-panel surface-panel--subtle">
            <div className="section-head">
              <div>
                <strong>{question.text || "(senza testo)"}</strong>
                <p className="subtle-text">
                  {question.type === "rating"
                    ? "Stelline 0-5"
                    : question.type === "open"
                      ? "Risposta aperta"
                      : `${question.fieldCount} campi fissi`}{" "}
                  · {question.status === "active" ? "Attiva" : "Nascosta"}
                </p>
              </div>
              <div className="chip-row">
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => startEdit(question)}
                >
                  Modifica
                </button>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => showDelete(question)}
                >
                  Elimina
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {deleteTarget ? (
        <ConfirmSheet
          body={ADMIN.eliminaDomandaSondaggioCorpo}
          busy={deleting}
          busyLabel={ADMIN.eliminazione}
          cancelLabel={ADMIN.tieniDomanda}
          confirmLabel={ADMIN.confermaEliminaDomanda}
          error={deleteError}
          onCancel={() => showDelete(null)}
          onConfirm={() => void removeQuestion(deleteTarget)}
          title={ADMIN.eliminaDomandaSondaggioTitolo}
          tone="danger"
        />
      ) : null}
    </div>
  );
}
