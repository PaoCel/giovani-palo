import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { MemberLockedNote } from "@/components/membership/MemberLockedNote";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { PALO } from "@/copy/palo";
import { useAuth } from "@/hooks/useAuth";
import { useStakeMembership } from "@/hooks/useStakeMembership";
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

interface SurveyAnswerViewProps {
  stakeId: string;
  eventId: string;
  /** Mostra l'intestazione grande. Off quando la vista è incassata in un hub. */
  showHero?: boolean;
  /** Dove tornare quando non c'è il sondaggio o dopo l'invio. */
  backHref?: string;
  backLabel?: string;
}

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

const LOAD_ERROR = "Non riesco a caricare il sondaggio. Controlla la connessione e riprova.";
const SEND_ERROR = "Non sono riuscito a inviare le risposte. Riprova.";

// Gli errori dell'SDK sono in inglese: un diniego (membro appena uscito, o
// ospite) ha la frase del palo, il resto quella di rete o di invio.
function surveyErrorMessage(error: unknown, fallback: string) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "permission-denied" ? PALO.soloMembriSondaggi : fallback;
}

function idKey(stakeId: string, eventId: string) {
  return `survey-response-id::${stakeId}::${eventId}`;
}

function dataKey(stakeId: string, eventId: string) {
  return `survey-response-data::${stakeId}::${eventId}`;
}

function readStoredResponseId(stakeId: string, eventId: string) {
  try {
    return localStorage.getItem(idKey(stakeId, eventId));
  } catch {
    return null;
  }
}

function writeStoredResponseId(stakeId: string, eventId: string, id: string) {
  try {
    localStorage.setItem(idKey(stakeId, eventId), id);
  } catch {
    // ignored
  }
}

function clearStoredResponseId(stakeId: string, eventId: string) {
  try {
    localStorage.removeItem(idKey(stakeId, eventId));
  } catch {
    // ignored
  }
}

function readStoredAnswers(
  stakeId: string,
  eventId: string,
): Record<string, SurveyAnswerEntry> | null {
  try {
    const raw = localStorage.getItem(dataKey(stakeId, eventId));
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, SurveyAnswerEntry>;
  } catch {
    return null;
  }
}

function writeStoredAnswers(
  stakeId: string,
  eventId: string,
  answers: Record<string, SurveyAnswerEntry>,
) {
  try {
    localStorage.setItem(dataKey(stakeId, eventId), JSON.stringify(answers));
  } catch {
    // ignored
  }
}

export function SurveyAnswerView({
  stakeId,
  eventId,
  showHero = true,
  backHref = "/me",
  backLabel = "Torna alla dashboard",
}: SurveyAnswerViewProps) {
  const { session } = useAuth();
  const { access } = useStakeMembership(stakeId);
  // Chi è in coda o fuori dal palo non legge le domande: la lettura non parte.
  // Mentre il documento members non è arrivato non parte nemmeno per gli altri.
  // Senza account personale (ospite) vale come fuori: i sondaggi sono dei membri.
  const locked = access === "waiting" || access === "out" || access === "guest";
  const canLoad = access === "member";
  const [event, setEvent] = useState<Event | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerEntry>>({});
  const responseId = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const savePending = useRef<Promise<void>>(Promise.resolve());
  const submitLock = useRef(false);
  const category: GenderRoleCategory | "" =
    session?.isAnonymous ? "" : session?.profile.genderRoleCategory ?? "";

  useEffect(() => {
    if (!eventId || !stakeId || !canLoad) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSubmitted(false);
    responseId.current = null;
    Promise.all([
      eventsService.getEventById(stakeId, eventId),
      surveysService.listActiveQuestions(stakeId, eventId),
    ])
      .then(async ([eventData, questionList]) => {
        if (cancelled) return;
        setEvent(eventData);
        setQuestions(questionList);

        const storedId = readStoredResponseId(stakeId, eventId);
        let initialAnswers = buildEmptyAnswers(questionList);
        let activeId: string | null = null;

        if (storedId) {
          try {
            const remote = await surveysService.getResponseById(stakeId, eventId, storedId);
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
          const localAnswers = readStoredAnswers(stakeId, eventId);
          if (localAnswers) {
            initialAnswers = { ...initialAnswers, ...localAnswers };
          }
        }

        if (cancelled) return;
        setAnswers(initialAnswers);
        responseId.current = activeId;
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(surveyErrorMessage(err, LOAD_ERROR));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [eventId, stakeId, canLoad]);

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
    writeStoredAnswers(stakeId, eventId, nextAnswers);
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
    const save = async () => {
      if (submitLock.current) return;
      const targetId = responseId.current ?? generateSurveyResponseId();
      responseId.current = targetId;
      await surveysService.saveResponse(stakeId, eventId, targetId, {
        isDraft: true,
        category,
        answers: nextAnswers,
      });
      writeStoredResponseId(stakeId, eventId, targetId);
      setSavedAt(new Date().toISOString());
    };
    try {
      savePending.current = savePending.current.then(save, save);
      await savePending.current;
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
    if (!eventId || submitLock.current || submitted) return;
    if (!hasContent) {
      setError("Compila almeno una risposta prima di inviare.");
      return;
    }
    setSubmitting(true);
    submitLock.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setError(null);
    try {
      await savePending.current.catch(() => undefined);
      const targetId = responseId.current ?? generateSurveyResponseId();
      responseId.current = targetId;
      await surveysService.saveResponse(stakeId, eventId, targetId, {
        isDraft: false,
        category,
        answers,
      });
      writeStoredResponseId(stakeId, eventId, targetId);
      setSubmitted(true);
      setSavedAt(new Date().toISOString());
    } catch (err: unknown) {
      setError(surveyErrorMessage(err, SEND_ERROR));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function resetLocalDraft() {
    if (!eventId) return;
    clearStoredResponseId(stakeId, eventId);
    try {
      localStorage.removeItem(dataKey(stakeId, eventId));
    } catch {
      // ignored
    }
    setAnswers(buildEmptyAnswers(questions));
    responseId.current = null;
    setSubmitted(false);
  }

  return (
    <div className="page-content">
      {showHero ? (
        <PageHero
          eyebrow="Feedback"
          title="Sondaggio post-evento"
          description={
            event
              ? `Le tue risposte ci aiutano a migliorare ${event.title}. Le risposte sono anonime.`
              : "Le tue risposte ci aiutano a migliorare l'attività. Le risposte sono anonime."
          }
        />
      ) : null}

      {locked ? (
        <SectionCard title="Sondaggio non disponibile">
          <MemberLockedNote access={access === "guest" ? "out" : access} kind="sondaggi" />
          <Link className="button button--ghost" to={backHref}>
            {backLabel}
          </Link>
        </SectionCard>
      ) : null}

      {!locked && loading ? <p className="subtle-text">Caricamento...</p> : null}
      {!locked && error ? <p className="field-error">{error}</p> : null}

      {!locked && !loading && questions.length === 0 ? (
        <SectionCard title="Sondaggio non disponibile">
          <p>Non ci sono ancora domande per questa attività.</p>
          <Link className="button button--ghost" to={backHref}>
            {backLabel}
          </Link>
        </SectionCard>
      ) : null}

      {!locked && !loading && submitted ? (
        <SectionCard title="Risposte inviate, grazie!">
          <p>Le tue risposte sono state registrate. Grazie per il feedback.</p>
          <button type="button" className="button button--ghost" onClick={resetLocalDraft}>
            Rispondi di nuovo (nuovo invio)
          </button>
        </SectionCard>
      ) : null}

      {!locked && !loading && !submitted && questions.length > 0 ? (
        <SectionCard
          title="Domande"
          description="Le risposte si salvano in automatico mentre compili. Il sondaggio è anonimo."
        >
          <div className="form-stack">
            <fieldset disabled={submitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="form-stack">
            {questions.map((question) => (
              <SurveyQuestionField
                key={question.id}
                question={question}
                entry={answers[question.id]}
                onChange={(value) => setAnswerValue(question.id, value)}
              />
            ))}
            </fieldset>

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
