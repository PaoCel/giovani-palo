import { useEffect, useState, type FormEvent } from "react";

import { AppIcon } from "@/components/AppIcon";
import { SectionCard } from "@/components/SectionCard";
import { questionsService } from "@/services/firestore/questionsService";
import type { AuthSession, Question, Registration } from "@/types";
import { formatDateTime } from "@/utils/formatters";
import { getRegistrationLookupFromSession } from "@/utils/session";

interface QuestionsSectionProps {
  stakeId: string;
  eventId: string;
  session: AuthSession | null;
  registration: Registration;
}

export function QuestionsSection({
  stakeId,
  eventId,
  session,
  registration,
}: QuestionsSectionProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftAnonymous, setDraftAnonymous] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editAnonymous, setEditAnonymous] = useState(false);

  const isCancelled = registration.registrationStatus === "cancelled";
  const authorFullName =
    session && !session.isAnonymous
      ? session.profile.fullName
      : registration.fullName;

  useEffect(() => {
    let active = true;

    async function load() {
      if (!session) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const lookup = getRegistrationLookupFromSession(session);
        const list = await questionsService.listOwn(stakeId, eventId, lookup);

        if (active) {
          setQuestions(list);
        }
      } catch (caughtError) {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Impossibile caricare le tue domande.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [stakeId, eventId, session]);

  async function handleCreate(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();

    if (!session) {
      return;
    }

    const text = draftText.trim();

    if (!text) {
      setError("Scrivi una domanda prima di salvare.");
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const lookup = getRegistrationLookupFromSession(session);
      const created = await questionsService.create(
        stakeId,
        eventId,
        lookup,
        authorFullName,
        { text, isAnonymous: draftAnonymous },
      );

      setQuestions((current) => [...current, created]);
      setDraftText("");
      setDraftAnonymous(false);
      setInfo("Domanda inviata.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile salvare la domanda.",
      );
    } finally {
      setBusy(false);
    }
  }

  function startEdit(question: Question) {
    setEditingId(question.id);
    setEditText(question.text);
    setEditAnonymous(question.isAnonymous);
    setInfo(null);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
    setEditAnonymous(false);
  }

  async function handleUpdate(questionId: string) {
    if (!session) {
      return;
    }

    const text = editText.trim();

    if (!text) {
      setError("La domanda non può essere vuota.");
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const lookup = getRegistrationLookupFromSession(session);
      await questionsService.update(
        stakeId,
        eventId,
        lookup,
        questionId,
        authorFullName,
        { text, isAnonymous: editAnonymous },
      );

      setQuestions((current) =>
        current.map((question) =>
          question.id === questionId
            ? {
                ...question,
                text,
                isAnonymous: editAnonymous,
                authorName: editAnonymous ? null : authorFullName,
                updatedAt: new Date().toISOString(),
              }
            : question,
        ),
      );
      cancelEdit();
      setInfo("Domanda aggiornata.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile aggiornare la domanda.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(questionId: string) {
    if (!session) {
      return;
    }

    const confirmed = window.confirm("Eliminare questa domanda?");

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const lookup = getRegistrationLookupFromSession(session);
      await questionsService.remove(stakeId, eventId, lookup, questionId);
      setQuestions((current) => current.filter((question) => question.id !== questionId));

      if (editingId === questionId) {
        cancelEdit();
      }

      setInfo("Domanda eliminata.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile eliminare la domanda.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (isCancelled) {
    return null;
  }

  return (
    <SectionCard
      title="Domande per il caminetto"
      description="Scrivi le tue domande per il Settanta. Puoi inviarle in forma anonima o con il tuo nome."
    >
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

        <form className="form-stack form-stack--compact" onSubmit={handleCreate}>
          <label className="field">
            <span className="field__label">Nuova domanda</span>
            <textarea
              className="input input--textarea"
              maxLength={2000}
              placeholder="Scrivi qui la tua domanda..."
              rows={4}
              value={draftText}
              onChange={(formEvent) => setDraftText(formEvent.target.value)}
            />
            <small>Massimo 2000 caratteri.</small>
          </label>

          <label className="toggle-field">
            <input
              checked={draftAnonymous}
              onChange={(formEvent) => setDraftAnonymous(formEvent.target.checked)}
              type="checkbox"
            />
            <span>Invia in forma anonima (l'admin non vedrà il tuo nome)</span>
          </label>

          <div className="inline-actions">
            <button
              className="button button--primary"
              disabled={busy || !draftText.trim()}
              type="submit"
            >
              <AppIcon name="plus" />
              <span>{busy ? "Salvataggio..." : "Aggiungi domanda"}</span>
            </button>
          </div>
        </form>

        {loading ? (
          <p className="subtle-text">Carico le tue domande...</p>
        ) : questions.length === 0 ? (
          <p className="subtle-text">Non hai ancora inviato domande.</p>
        ) : (
          <ul className="plain-list">
            {questions.map((question) => {
              const isEditing = editingId === question.id;

              return (
                <li key={question.id}>
                  {isEditing ? (
                    <div className="form-stack form-stack--compact">
                      <label className="field">
                        <span className="field__label">Modifica domanda</span>
                        <textarea
                          className="input input--textarea"
                          maxLength={2000}
                          rows={4}
                          value={editText}
                          onChange={(formEvent) => setEditText(formEvent.target.value)}
                        />
                      </label>

                      <label className="toggle-field">
                        <input
                          checked={editAnonymous}
                          onChange={(formEvent) =>
                            setEditAnonymous(formEvent.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>Invia in forma anonima</span>
                      </label>

                      <div className="inline-actions">
                        <button
                          className="button button--primary"
                          disabled={busy || !editText.trim()}
                          onClick={() => void handleUpdate(question.id)}
                          type="button"
                        >
                          <AppIcon name="check" />
                          <span>Salva</span>
                        </button>
                        <button
                          className="button button--ghost"
                          disabled={busy}
                          onClick={cancelEdit}
                          type="button"
                        >
                          Annulla
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <strong>{question.isAnonymous ? "Anonima" : "Con nome"}</strong>
                      <span>{question.text}</span>
                      <small>Inviata il {formatDateTime(question.createdAt)}</small>
                      <div className="inline-actions inline-actions--compact">
                        <button
                          className="button button--ghost button--small"
                          disabled={busy}
                          onClick={() => startEdit(question)}
                          type="button"
                        >
                          <AppIcon name="pencil" />
                          <span>Modifica</span>
                        </button>
                        <button
                          className="button button--ghost button--small"
                          disabled={busy}
                          onClick={() => void handleDelete(question.id)}
                          type="button"
                        >
                          <AppIcon name="trash" />
                          <span>Elimina</span>
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
