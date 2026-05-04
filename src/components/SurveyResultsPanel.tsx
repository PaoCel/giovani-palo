import { useEffect, useMemo, useState } from "react";

import { StarDisplay } from "@/components/StarDisplay";
import { surveysService } from "@/services/firestore/surveysService";
import type {
  GenderRoleCategory,
  SurveyAnswerEntry,
  SurveyQuestion,
  SurveyResponse,
} from "@/types";
import { getGenderRoleCategoryLabel } from "@/utils/profile";
import { clusterSurveyAnswers } from "@/utils/surveyClustering";

interface SurveyResultsPanelProps {
  stakeId: string;
  eventId: string;
}

const CATEGORIES: Array<GenderRoleCategory | ""> = [
  "giovane_uomo",
  "giovane_donna",
  "dirigente",
  "accompagnatore",
  "",
];

function getCategoryLabel(category: GenderRoleCategory | "") {
  if (!category) return "Non specificato";
  return getGenderRoleCategoryLabel(category);
}

function getCategoryShort(category: GenderRoleCategory | "") {
  switch (category) {
    case "giovane_uomo":
      return "GU";
    case "giovane_donna":
      return "GD";
    case "dirigente":
      return "Dir";
    case "accompagnatore":
      return "Acc";
    default:
      return "—";
  }
}

export function SurveyResultsPanel({ stakeId, eventId }: SurveyResultsPanelProps) {
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      surveysService.listQuestions(stakeId, eventId),
      surveysService.listSubmittedResponses(stakeId, eventId),
    ])
      .then(([questionList, responseList]) => {
        if (cancelled) return;
        setQuestions(questionList);
        setResponses(responseList);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento risultati.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stakeId, eventId]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const response of responses) {
      const key = response.category || "";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [responses]);

  if (loading) {
    return <p className="subtle-text">Caricamento risultati...</p>;
  }

  if (error) {
    return <p className="field-error">{error}</p>;
  }

  if (questions.length === 0) {
    return <p className="subtle-text">Nessuna domanda configurata.</p>;
  }

  return (
    <div className="survey-results">
      <article className="survey-results__summary">
        <div className="survey-results__total">
          <strong className="survey-results__total-number">{responses.length}</strong>
          <span className="survey-results__total-label">
            risposte definitive
          </span>
        </div>
        <div className="survey-results__categories">
          {CATEGORIES.filter((category) => categoryCounts[category]).map((category) => (
            <div key={category || "none"} className="survey-results__cat-chip">
              <span className="survey-results__cat-name">
                {getCategoryLabel(category)}
              </span>
              <strong className="survey-results__cat-count">
                {categoryCounts[category]}
              </strong>
            </div>
          ))}
          {Object.keys(categoryCounts).length === 0 ? (
            <span className="subtle-text">Nessuna risposta ancora.</span>
          ) : null}
        </div>
      </article>

      <div className="survey-results__questions">
        {questions.map((question) => (
          <QuestionResults
            key={question.id}
            question={question}
            responses={responses}
          />
        ))}
      </div>
    </div>
  );
}

interface QuestionResultsProps {
  question: SurveyQuestion;
  responses: SurveyResponse[];
}

function QuestionResults({ question, responses }: QuestionResultsProps) {
  const [showRaw, setShowRaw] = useState(false);
  const entries = responses
    .map((response) => ({
      response,
      entry: response.answers[question.id] as SurveyAnswerEntry | undefined,
    }))
    .filter((item): item is { response: SurveyResponse; entry: SurveyAnswerEntry } =>
      Boolean(item.entry),
    );

  if (question.type === "rating") {
    const values = entries
      .map((item) => (typeof item.entry.value === "number" ? item.entry.value : null))
      .filter((value): value is number => value !== null);
    const average =
      values.length > 0
        ? values.reduce((acc, value) => acc + value, 0) / values.length
        : null;

    const byCategory: Record<string, number[]> = {};
    for (const item of entries) {
      if (typeof item.entry.value !== "number") continue;
      const key = item.response.category || "";
      byCategory[key] = byCategory[key] ?? [];
      byCategory[key].push(item.entry.value);
    }

    return (
      <article className="survey-question-card survey-question-card--rating">
        <header className="survey-question-card__head">
          <span className="survey-question-card__type">Stelline</span>
          <span className="survey-question-card__count">
            {values.length} {values.length === 1 ? "risposta" : "risposte"}
          </span>
        </header>
        <h4 className="survey-question-card__title">{question.text}</h4>

        {average !== null ? (
          <div className="survey-question-card__average">
            <StarDisplay value={average} size="lg" />
            <div className="survey-question-card__average-text">
              <strong>{average.toFixed(2)}</strong>
              <span> / 5 — media</span>
            </div>
          </div>
        ) : (
          <p className="subtle-text">Nessuna risposta ancora.</p>
        )}

        {Object.keys(byCategory).length > 0 ? (
          <ul className="survey-rating-breakdown">
            {Object.entries(byCategory)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([key, list]) => {
                const avg = list.reduce((acc, value) => acc + value, 0) / list.length;
                return (
                  <li key={key} className="survey-rating-breakdown__row">
                    <div className="survey-rating-breakdown__label">
                      <span className="survey-rating-breakdown__short">
                        {getCategoryShort(key as GenderRoleCategory | "")}
                      </span>
                      <span className="survey-rating-breakdown__name">
                        {getCategoryLabel(key as GenderRoleCategory | "")}
                      </span>
                    </div>
                    <div className="survey-rating-breakdown__stars">
                      <StarDisplay value={avg} size="sm" />
                      <span className="survey-rating-breakdown__num">
                        {avg.toFixed(1)}
                      </span>
                    </div>
                    <span className="survey-rating-breakdown__count">
                      {list.length}
                    </span>
                  </li>
                );
              })}
          </ul>
        ) : null}
      </article>
    );
  }

  if (question.type === "open") {
    const openTexts = entries
      .map((item) =>
        typeof item.entry.value === "string" ? item.entry.value.trim() : "",
      )
      .filter((text) => text.length > 0);
    const clusters = clusterSurveyAnswers(openTexts);

    return (
      <article className="survey-question-card">
        <header className="survey-question-card__head">
          <span className="survey-question-card__type">Aperta</span>
          <span className="survey-question-card__count">
            {entries.length} {entries.length === 1 ? "risposta" : "risposte"}
          </span>
        </header>
        <h4 className="survey-question-card__title">{question.text}</h4>

        {entries.length === 0 ? (
          <p className="subtle-text">Nessuna risposta ancora.</p>
        ) : (
          <>
            {clusters.length > 0 ? (
              <div className="survey-clusters">
                {clusters.map((cluster) => (
                  <div
                    key={cluster.label}
                    className={`survey-cluster survey-cluster--rank-${Math.min(cluster.count, 3)}`}
                  >
                    <span className="survey-cluster__label">{cluster.label}</span>
                    <span className="survey-cluster__count">×{cluster.count}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              className="survey-results__toggle"
              onClick={() => setShowRaw((value) => !value)}
            >
              {showRaw ? "Nascondi risposte complete" : "Mostra risposte complete"}
            </button>

            {showRaw ? (
              <ul className="survey-raw-list">
                {entries.map((item, index) => (
                  <li key={`${item.response.id}-${index}`} className="survey-raw-list__item">
                    <span className="survey-raw-list__cat">
                      {getCategoryShort(item.response.category)}
                    </span>
                    <span className="survey-raw-list__text">
                      {typeof item.entry.value === "string" ? item.entry.value : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </article>
    );
  }

  // type === "fields" (multi-input)
  const fieldTexts: string[] = [];
  for (const item of entries) {
    if (Array.isArray(item.entry.value)) {
      for (const value of item.entry.value) {
        if (typeof value === "string" && value.trim()) {
          fieldTexts.push(value.trim());
        }
      }
    }
  }
  const fieldClusters = clusterSurveyAnswers(fieldTexts);

  return (
    <article className="survey-question-card">
      <header className="survey-question-card__head">
        <span className="survey-question-card__type">Più campi</span>
        <span className="survey-question-card__count">
          {entries.length} {entries.length === 1 ? "risposta" : "risposte"}
        </span>
      </header>
      <h4 className="survey-question-card__title">{question.text}</h4>

      {entries.length === 0 ? (
        <p className="subtle-text">Nessuna risposta ancora.</p>
      ) : (
        <>
          {fieldClusters.length > 0 ? (
            <div className="survey-clusters">
              {fieldClusters.map((cluster) => (
                <div
                  key={cluster.label}
                  className={`survey-cluster survey-cluster--rank-${Math.min(cluster.count, 3)}`}
                >
                  <span className="survey-cluster__label">{cluster.label}</span>
                  <span className="survey-cluster__count">×{cluster.count}</span>
                </div>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            className="survey-results__toggle"
            onClick={() => setShowRaw((value) => !value)}
          >
            {showRaw ? "Nascondi risposte per partecipante" : "Mostra risposte per partecipante"}
          </button>

          {showRaw ? (
            <ul className="survey-raw-list">
              {entries.map((item, index) => {
                const list = Array.isArray(item.entry.value) ? item.entry.value : [];
                return (
                  <li key={`${item.response.id}-${index}`} className="survey-raw-list__item">
                    <span className="survey-raw-list__cat">
                      {getCategoryShort(item.response.category)}
                    </span>
                    <span className="survey-raw-list__text">
                      {list.filter(Boolean).join(" · ") || "(vuoto)"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}
    </article>
  );
}
