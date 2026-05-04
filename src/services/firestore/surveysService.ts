import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type {
  GenderRoleCategory,
  SurveyAnswerEntry,
  SurveyQuestion,
  SurveyQuestionType,
  SurveyQuestionWriteInput,
  SurveyResponse,
} from "@/types";

function nowIso() {
  return new Date().toISOString();
}

function getQuestionsCollection(stakeId: string, eventId: string) {
  return collection(db, "stakes", stakeId, "activities", eventId, "surveyQuestions");
}

function getQuestionRef(stakeId: string, eventId: string, questionId: string) {
  return doc(db, "stakes", stakeId, "activities", eventId, "surveyQuestions", questionId);
}

function getResponsesCollection(stakeId: string, eventId: string) {
  return collection(db, "stakes", stakeId, "activities", eventId, "surveyResponses");
}

function getResponseRef(stakeId: string, eventId: string, responseId: string) {
  return doc(db, "stakes", stakeId, "activities", eventId, "surveyResponses", responseId);
}

function sanitizeQuestionType(value: unknown): SurveyQuestionType {
  if (value === "rating" || value === "open" || value === "fields") return value;
  return "open";
}

function mapQuestion(
  stakeId: string,
  eventId: string,
  id: string,
  data: Record<string, unknown>,
): SurveyQuestion {
  return {
    id,
    eventId,
    stakeId,
    text: typeof data.text === "string" ? data.text : "",
    type: sanitizeQuestionType(data.type),
    fieldCount: typeof data.fieldCount === "number" ? data.fieldCount : 0,
    order: typeof data.order === "number" ? data.order : 0,
    status: data.status === "hidden" ? "hidden" : "active",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
  };
}

function sanitizeAnswerEntry(value: unknown): SurveyAnswerEntry | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const type = sanitizeQuestionType(data.type);
  const raw = data.value;
  if (type === "rating") {
    const num = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(num)) return null;
    return { type, value: Math.max(0, Math.min(5, Math.round(num * 2) / 2)) };
  }
  if (type === "open") {
    return { type, value: typeof raw === "string" ? raw : "" };
  }
  if (Array.isArray(raw)) {
    return {
      type,
      value: raw.filter((item): item is string => typeof item === "string"),
    };
  }
  return null;
}

function mapResponse(
  stakeId: string,
  eventId: string,
  id: string,
  data: Record<string, unknown>,
): SurveyResponse {
  const answers: Record<string, SurveyAnswerEntry> = {};
  if (data.answers && typeof data.answers === "object") {
    for (const [key, raw] of Object.entries(data.answers as Record<string, unknown>)) {
      const entry = sanitizeAnswerEntry(raw);
      if (entry) answers[key] = entry;
    }
  }

  const category =
    data.category === "giovane_uomo" ||
    data.category === "giovane_donna" ||
    data.category === "dirigente" ||
    data.category === "accompagnatore"
      ? (data.category as GenderRoleCategory)
      : "";

  return {
    id,
    eventId,
    stakeId,
    isDraft: data.isDraft !== false,
    category,
    answers,
    submittedAt: typeof data.submittedAt === "string" ? data.submittedAt : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
  };
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const surveysService = {
  async listQuestions(stakeId: string, eventId: string): Promise<SurveyQuestion[]> {
    const snapshot = await getDocs(
      query(getQuestionsCollection(stakeId, eventId), orderBy("order", "asc")),
    );
    return snapshot.docs.map((document) =>
      mapQuestion(stakeId, eventId, document.id, document.data()),
    );
  },

  async listActiveQuestions(stakeId: string, eventId: string): Promise<SurveyQuestion[]> {
    const all = await this.listQuestions(stakeId, eventId);
    return all.filter((question) => question.status === "active");
  },

  async upsertQuestion(
    stakeId: string,
    eventId: string,
    questionId: string | null,
    input: SurveyQuestionWriteInput,
  ): Promise<SurveyQuestion> {
    const id = questionId ?? generateId();
    const reference = getQuestionRef(stakeId, eventId, id);
    const existing = questionId ? await getDoc(reference) : null;
    const timestamp = nowIso();
    const fieldCount =
      input.type === "fields"
        ? Math.max(2, Math.min(10, Math.floor(input.fieldCount ?? 2)))
        : 0;
    const payload = {
      eventId,
      stakeId,
      text: input.text.trim(),
      type: input.type,
      fieldCount,
      order: input.order ?? (existing?.data()?.order ?? Date.now()),
      status: input.status ?? "active",
      createdAt: existing?.exists()
        ? (existing.data() as { createdAt?: string }).createdAt ?? timestamp
        : timestamp,
      updatedAt: timestamp,
    };
    await setDoc(reference, payload);
    return mapQuestion(stakeId, eventId, id, payload);
  },

  async deleteQuestion(stakeId: string, eventId: string, questionId: string) {
    await deleteDoc(getQuestionRef(stakeId, eventId, questionId));
  },

  async getResponseById(
    stakeId: string,
    eventId: string,
    responseId: string,
  ): Promise<SurveyResponse | null> {
    const snapshot = await getDoc(getResponseRef(stakeId, eventId, responseId));
    if (!snapshot.exists()) return null;
    return mapResponse(stakeId, eventId, snapshot.id, snapshot.data());
  },

  async saveResponse(
    stakeId: string,
    eventId: string,
    responseId: string | null,
    input: {
      isDraft: boolean;
      category: GenderRoleCategory | "";
      answers: Record<string, SurveyAnswerEntry>;
    },
  ): Promise<SurveyResponse> {
    const id = responseId ?? generateId();
    const reference = getResponseRef(stakeId, eventId, id);
    const existing = responseId ? await getDoc(reference) : null;
    const timestamp = nowIso();
    const payload = {
      eventId,
      stakeId,
      isDraft: input.isDraft,
      category: input.category,
      answers: input.answers,
      submittedAt: input.isDraft
        ? null
        : existing?.exists()
          ? (existing.data() as { submittedAt?: string }).submittedAt ?? timestamp
          : timestamp,
      createdAt: existing?.exists()
        ? (existing.data() as { createdAt?: string }).createdAt ?? timestamp
        : timestamp,
      updatedAt: timestamp,
    };
    await setDoc(reference, payload);
    return mapResponse(stakeId, eventId, id, payload);
  },

  async listSubmittedResponses(
    stakeId: string,
    eventId: string,
  ): Promise<SurveyResponse[]> {
    const snapshot = await getDocs(getResponsesCollection(stakeId, eventId));
    return snapshot.docs
      .map((document) => mapResponse(stakeId, eventId, document.id, document.data()))
      .filter((response) => !response.isDraft);
  },
};

export function generateSurveyResponseId() {
  return generateId();
}
