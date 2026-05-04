import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import { eventsService } from "@/services/firestore/eventsService";
import {
  generateSurveyResponseId,
  surveysService,
} from "@/services/firestore/surveysService";
import type {
  Event,
  GenderRoleCategory,
  SurveyAnswerEntry,
  SurveyAnswerValue,
  SurveyQuestion,
} from "@/types";

const STAKE_ID = "roma-est";

function buildEmptyAnswers(
  questions: SurveyQuestion[],
): Record<string, SurveyAnswerEntry> {
  const next: Record<string, SurveyAnswerEntry> = {};
  for (const question of questions) {
    if (question.type === "rating") {
      next[question.id] = { type: "rating", value: 0 };
    } else if (question.type === "open") {
      next[question.id] = { type: "open", value: "" };
    } else {
      next[question.id] = {
        type: "fields",
        value: Array.from({ length: Math.max(1, question.fieldCount || 0) }, () => ""),
      };
    }
  }
  return next;
}

function getStorageKey(eventId: string) {
  return `survey-response-id::${STAKE_ID}::${eventId}`;
}

function readStoredResponseId(eventId: string) {
  try {
    return localStorage.getItem(getStorageKey(eventId));
  } catch {
    return null;
  }
}

function writeStoredResponseId(eventId: string, id: string) {
  try {
    localStorage.setItem(getStorageKey(eventId), id);
  } catch {
    // ignored
  }
}

function clearStoredResponseId(eventId: string) {
  try {
    localStorage.removeItem(getStorageKey(eventId));
  } catch {
    // ignored
  }
}

function readStoredAnswers(
  eventId: string,
): Record<string, SurveyAnswerEntry> | null {
  try {
    const raw = localStorage.getItem(`survey-response-data::${STAKE_ID}::${eventId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, SurveyAnswerEntry>;
  } catch {
    return null;
  }
}

function writeStoredAnswers(
  eventId: string,
  answers: Record<string, SurveyAnswerEntry>,
) {
  try {
    localStorage.setItem(
      `survey-response-data::${STAKE_ID}::${eventId}`,
      JSON.stringify(answers),
    );
  } catch {
    // ignored
  }
}

export function SurveyAnswerPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { session } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerEntry>>({});
  const [responseId, setResponseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const category: GenderRoleCategory | "" =
    session?.profile.genderRoleCategory ?? "";

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      eventsService.getEventById(STAKE_ID, eventId),
      surveysService.listActiveQuestions(STAKE_ID, eventId),
    ])
      .then(async ([eventData, questionList]) => {
        if (cancelled) return;
        setEvent(eventData);
        setQuestions(questionList);

        const storedId = readStoredResponseId(eventId);
        let initialAnswers = buildEmptyAnswers(questionList);
        let activeId: string | null = null;

        if (storedId) {
          try {
            const remote = await surveysService.getResponseById(STAKE_ID, eventId, storedId);
            if (remote && remote.isDraft) {
              initialAnswers = { ...initialAnswers, ...remote.answers };
              activeId = remote.id;
            } else if (remote && !remote.isDraft) {
              setSubmitted(true);
              activeId = remote.id;
            }
          } catch {
            // ignore network errors and fallback to local storage
          }
        }

        if (!activeId) {
          const localAnswers = readStoredAnswers(eventId);
          if (localAnswers) {
            initialAnswers = { ...initialAnswers, ...localAnswers };
          }
        }

        setAnswers(initialAnswers);
        setResponseId(activeId);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento sondaggio.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const hasContent = useMemo(() => {
    return Object.values(answers).some((entry) => {
      if (entry.type === "rating") return Number(entry.value) > 0;
      if (entry.type === "open") return String(entry.value).trim() !== "";
      if (Array.isArray(entry.value)) return entry.value.some((value) => value.trim() !== "");
      return false;
    });
  }, [answers]);

  function scheduleSave(nextAnswers: Record<string, SurveyAnswerEntry>) {
    if (!eventId) return;
    writeStoredAnswers(eventId, nextAnswers);
    if (submitted || submitting) return;
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      void persistDraft(nextAnswers);
    }, 600);
  }

  async function persistDraft(nextAnswers: Record<string, SurveyAnswerEntry>) {
    if (!eventId) return;
    try {
      const targetId = responseId ?? generateSurveyResponseId();
      await surveysService.saveResponse(STAKE_ID, eventId, targetId, {
        isDraft: true,
        category,
        answers: nextAnswers,
      });
      writeStoredResponseId(eventId, targetId);
      setResponseId(targetId);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      // soft-fail: localStorage already saved
      console.warn("Errore salvataggio bozza sondaggio", err);
    }
  }

  function setAnswerValue(questionId: string, value: SurveyAnswerValue) {
    setAnswers((current) => {
      const previous = current[questionId];
      if (!previous) return current;
      const next = {
        ...current,
        [questionId]: {
          ...previous,
          value,
        },
      };
      scheduleSave(next);
      return next;
    });
  }

  async function submitFinal() {
    if (!eventId) return;
    if (!hasContent) {
      setError("Compila almeno una risposta prima di inviare.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const targetId = responseId ?? generateSurveyResponseId();
      await surveysService.saveResponse(STAKE_ID, eventId, targetId, {
        isDraft: false,
        category,
        answers,
      });
      writeStoredResponseId(eventId, targetId);
      setResponseId(targetId);
      setSubmitted(true);
      setSavedAt(new Date().toISOString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore invio.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetLocalDraft() {
    if (!eventId) return;
    clearStoredResponseId(eventId);
    try {
      localStorage.removeItem(`survey-response-data::${STAKE_ID}::${eventId}`);
    } catch {
      // ignored
    }
    setAnswers(buildEmptyAnswers(questions));
    setResponseId(null);
  }

  return (
    <div className="page-content">
      <PageHero
        eyebrow="Feedback"
        title="Sondaggio post-evento"
        description={
          event
            ? `Le tue risposte ci aiutano a migliorare ${event.title}. Le risposte sono anonime.`
            : "Le tue risposte ci aiutano a migliorare l'attività. Le risposte sono anonime."
        }
      />

      {loading ? <p className="subtle-text">Caricamento...</p> : null}
      {error ? <p className="field-error">{error}</p> : null}

      {!loading && questions.length === 0 ? (
        <SectionCard title="Sondaggio non disponibile">
          <p>Non ci sono ancora domande per questa attività.</p>
          <Link className="button button--ghost" to="/me">
            Torna alla dashboard
          </Link>
        </SectionCard>
      ) : null}

      {!loading && submitted ? (
        <SectionCard title="Risposte inviate, grazie!">
          <p>Le tue risposte sono state registrate. Grazie per il feedback.</p>
          <button type="button" className="button button--ghost" onClick={resetLocalDraft}>
            Rispondi di nuovo (nuovo invio)
          </button>
        </SectionCard>
      ) : null}

      {!loading && !submitted && questions.length > 0 ? (
        <SectionCard
          title="Domande"
          description="Le risposte si salvano in automatico mentre compili."
        >
          <div className="form-stack">
            {questions.map((question) => (
              <SurveyQuestionField
                key={question.id}
                question={question}
                entry={answers[question.id]}
                onChange={(value) => setAnswerValue(question.id, value)}
              />
            ))}

            <div className="chip-row">
              <button
                type="button"
                className="button button--primary"
                onClick={submitFinal}
                disabled={submitting}
              >
                {submitting ? "Invio..." : "Invia definitivamente"}
              </button>
              {savedAt ? (
                <small className="subtle-text">
                  Bozza salvata · {new Date(savedAt).toLocaleTimeString("it-IT")}
                </small>
              ) : null}
            </div>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

interface SurveyQuestionFieldProps {
  question: SurveyQuestion;
  entry: SurveyAnswerEntry | undefined;
  onChange: (value: SurveyAnswerValue) => void;
}

function SurveyQuestionField({ question, entry, onChange }: SurveyQuestionFieldProps) {
  if (!entry) return null;

  if (question.type === "rating") {
    return (
      <div className="surface-panel surface-panel--subtle form-subsection">
        <h4>{question.text}</h4>
        <StarRatingInput
          value={typeof entry.value === "number" ? entry.value : 0}
          onChange={onChange}
        />
      </div>
    );
  }

  if (question.type === "open") {
    return (
      <div className="surface-panel surface-panel--subtle form-subsection">
        <h4>{question.text}</h4>
        <textarea
          className="input input--textarea"
          rows={4}
          value={typeof entry.value === "string" ? entry.value : ""}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onChange(event.target.value)}
        />
      </div>
    );
  }

  const values = Array.isArray(entry.value)
    ? entry.value
    : Array.from({ length: Math.max(1, question.fieldCount || 0) }, () => "");

  return (
    <div className="surface-panel surface-panel--subtle form-subsection">
      <h4>{question.text}</h4>
      <p className="subtle-text">
        Compila almeno una risposta — puoi lasciare gli altri campi vuoti se non ti vengono in mente.
      </p>
      <div className="form-stack form-stack--compact">
        {values.map((value, index) => (
          <input
            key={index}
            className="input"
            type="text"
            value={value}
            placeholder={`Risposta ${index + 1}`}
            onChange={(event) => {
              const next = [...values];
              next[index] = event.target.value;
              onChange(next);
            }}
            onBlur={(event) => {
              const next = [...values];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
}

function StarRatingInput({ value, onChange }: StarRatingInputProps) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className="star-rating">
      {stars.map((star) => {
        const fullThreshold = star;
        const halfThreshold = star - 0.5;
        const filled = value >= fullThreshold ? "full" : value >= halfThreshold ? "half" : "empty";
        return (
          <button
            type="button"
            key={star}
            aria-label={`${star} stelle`}
            className={`star-rating__star star-rating__star--${filled}`}
            onClick={(event) => {
              const target = event.currentTarget;
              const rect = target.getBoundingClientRect();
              const isLeft = event.clientX - rect.left < rect.width / 2;
              const next = isLeft ? star - 0.5 : star;
              onChange(value === next ? 0 : next);
            }}
          >
            <span className="star-rating__background">★</span>
            <span className="star-rating__foreground">★</span>
          </button>
        );
      })}
      <span className="star-rating__value">{value.toFixed(1)} / 5</span>
    </div>
  );
}
