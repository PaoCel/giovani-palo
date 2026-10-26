import { useEffect, useRef, useState, type FormEvent } from "react";

import { AppIcon } from "@/components/AppIcon";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { SectionCard } from "@/components/SectionCard";
import { DOMANDE } from "@/copy/domande";
import { questionsService } from "@/services/firestore/questionsService";
import type { AuthSession, Question, Registration } from "@/types";
import { formatDateTime } from "@/utils/formatters";
import { getRegistrationLookupFromSession } from "@/utils/session";
import { isConnectionError, withWriteTimeout } from "@/utils/writeTimeout";

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
  // "Elimina": prima il foglio di conferma, mai un dialogo del browser.
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Numero del foglio: l'esito di una richiesta partita da un foglio
  // precedente (altra iscrizione, altro account) non tocca quello di adesso.
  const deleteRunRef = useRef(0);

  function showDelete(questionId: string | null) {
    deleteRunRef.current += 1;
    setDeleteError(null);
    setDeleteTarget(questionId);
  }

  const isCancelled = registration.registrationStatus === "cancelled";
  const authorFullName =
    session && !session.isAnonymous
      ? session.profile.fullName
      : registration.fullName;

  useEffect(() => {
    let active = true;
    // Altra iscrizione o altro account: il foglio di prima non vale più.
    showDelete(null);

    async function load() {
      if (!session) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const list = await questionsService.listOwn(stakeId, eventId, registration.id);

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
  }, [stakeId, eventId, session, registration.id]);

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
      const lookup = getRegistrationLookupFromSession(session, registration.childId);
      const created = await questionsService.create(
        stakeId,
        eventId,
        registration.id,
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
      await questionsService.update(
        stakeId,
        eventId,
        registration.id,
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

  async function handleConfirmDelete() {
    const questionId = deleteTarget;

    if (!session || !questionId || busy) {
      return;
    }

    const run = deleteRunRef.current;
    setBusy(true);
    setDeleteError(null);
    setError(null);
    setInfo(null);

    try {
      // Senza rete la cancellazione aspetterebbe il server per sempre, col
      // foglio bloccato: dopo il timeout si sblocca e lo si dice.
      await withWriteTimeout(
        questionsService.remove(stakeId, eventId, registration.id, questionId),
      );
      setQuestions((current) => current.filter((question) => question.id !== questionId));

      if (run !== deleteRunRef.current) {
        return;
      }

      if (editingId === questionId) {
        cancelEdit();
      }

      showDelete(null);
      setInfo("Domanda eliminata.");
    } catch (caughtError) {
      if (run !== deleteRunRef.current) {
        return;
      }

      setDeleteError(
        isConnectionError(caughtError)
          ? DOMANDE.erroreRete
          : DOMANDE.errore,
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
                          onClick={() => showDelete(question.id)}
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

      {deleteTarget ? (
        <ConfirmSheet
          body={DOMANDE.eliminaCorpo}
          busy={busy}
          busyLabel={DOMANDE.eliminazione}
          cancelLabel={DOMANDE.tieni}
          confirmLabel={DOMANDE.conferma}
          error={deleteError}
          onCancel={() => showDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
          title={DOMANDE.eliminaTitolo}
          tone="danger"
        />
      ) : null}
    </SectionCard>
  );
}
