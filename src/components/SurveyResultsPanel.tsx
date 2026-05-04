import { useEffect, useMemo, useState } from "react";

import { surveysService } from "@/services/firestore/surveysService";
import type {
  GenderRoleCategory,
  SurveyAnswerEntry,
  SurveyQuestion,
  SurveyResponse,
} from "@/types";
import { getGenderRoleCategoryLabel } from "@/utils/profile";

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
    <div className="stack">
      <article className="surface-panel surface-panel--subtle">
        <h3>Riepilogo</h3>
        <p>
          <strong>{responses.length}</strong> risposte definitive ricevute.
        </p>
        <div className="chip-row">
          {CATEGORIES.map((category) =>
            categoryCounts[category] ? (
              <span key={category} className="chip">
                {getCategoryLabel(category)}: <strong>{categoryCounts[category]}</strong>
              </span>
            ) : null,
          )}
        </div>
      </article>

      {questions.map((question) => (
        <QuestionResults
          key={question.id}
          question={question}
          responses={responses}
        />
      ))}
    </div>
  );
}

interface QuestionResultsProps {
  question: SurveyQuestion;
  responses: SurveyResponse[];
}

function QuestionResults({ question, responses }: QuestionResultsProps) {
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
      <article className="surface-panel surface-panel--subtle">
        <h4>{question.text}</h4>
        <p className="subtle-text">Stelline · {values.length} risposte</p>
        <p>
          Media:{" "}
          <strong>{average !== null ? average.toFixed(2) : "—"}</strong> / 5
        </p>
        <ul className="plain-list">
          {Object.entries(byCategory).map(([key, list]) => {
            const avg = list.reduce((acc, value) => acc + value, 0) / list.length;
            return (
              <li key={key}>
                {getCategoryLabel(key as GenderRoleCategory | "")}: {list.length} risposte —
                media <strong>{avg.toFixed(2)}</strong>
              </li>
            );
          })}
        </ul>
      </article>
    );
  }

  if (question.type === "open") {
    return (
      <article className="surface-panel surface-panel--subtle">
        <h4>{question.text}</h4>
        <p className="subtle-text">
          Risposte aperte · {entries.length} risposte
        </p>
        {entries.length === 0 ? (
          <p className="subtle-text">Nessuna risposta.</p>
        ) : (
          <ul className="plain-list">
            {entries.map((item, index) => (
              <li key={`${item.response.id}-${index}`}>
                <strong>
                  {getCategoryLabel(item.response.category)}
                </strong>{" "}
                — {typeof item.entry.value === "string" ? item.entry.value : ""}
              </li>
            ))}
          </ul>
        )}
      </article>
    );
  }

  return (
    <article className="surface-panel surface-panel--subtle">
      <h4>{question.text}</h4>
      <p className="subtle-text">
        {question.fieldCount} campi · {entries.length} risposte
      </p>
      {entries.length === 0 ? (
        <p className="subtle-text">Nessuna risposta.</p>
      ) : (
        <ul className="plain-list">
          {entries.map((item, index) => {
            const list = Array.isArray(item.entry.value) ? item.entry.value : [];
            return (
              <li key={`${item.response.id}-${index}`}>
                <strong>{getCategoryLabel(item.response.category)}</strong>:{" "}
                {list.filter(Boolean).join(" · ") || "(vuoto)"}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
