import { useEffect, useState } from "react";

import { surveysService } from "@/services/firestore/surveysService";
import type {
  SurveyQuestion,
  SurveyQuestionType,
  SurveyQuestionWriteInput,
} from "@/types";

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
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftQuestion>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

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

  async function removeQuestion(id: string) {
    if (!confirm("Eliminare la domanda? Le risposte gia' inviate non saranno cancellate.")) {
      return;
    }
    await surveysService.deleteQuestion(stakeId, eventId, id);
    await refresh();
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
          <p className="subtle-text">Nessuna domanda configurata.</p>
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
                  onClick={() => removeQuestion(question.id)}
                >
                  Elimina
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
