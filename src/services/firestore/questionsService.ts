import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import { registrationsService } from "@/services/firestore/registrationsService";
import type {
  Question,
  QuestionStatus,
  QuestionWriteInput,
  RegistrationLookup,
} from "@/types";

function nowIso() {
  return new Date().toISOString();
}

function getRegistrationDocId(lookup: RegistrationLookup) {
  if (lookup.userId) {
    return `user_${lookup.userId}`;
  }

  if (lookup.anonymousUid) {
    return `guest_${lookup.anonymousUid}`;
  }

  throw new Error("Sessione non valida.");
}

function getQuestionsCollection(
  stakeId: string,
  eventId: string,
  registrationId: string,
) {
  return collection(
    db,
    "stakes",
    stakeId,
    "activities",
    eventId,
    "registrations",
    registrationId,
    "questions",
  );
}

function getQuestionRef(
  stakeId: string,
  eventId: string,
  registrationId: string,
  questionId: string,
) {
  return doc(
    db,
    "stakes",
    stakeId,
    "activities",
    eventId,
    "registrations",
    registrationId,
    "questions",
    questionId,
  );
}

function mapQuestion(
  stakeId: string,
  eventId: string,
  registrationId: string,
  id: string,
  data: Record<string, unknown>,
): Question {
  return {
    id,
    eventId,
    stakeId,
    registrationId,
    authorUserId: typeof data.authorUserId === "string" ? data.authorUserId : null,
    authorAnonymousUid:
      typeof data.authorAnonymousUid === "string" ? data.authorAnonymousUid : null,
    authorName: typeof data.authorName === "string" ? data.authorName : null,
    text: typeof data.text === "string" ? data.text : "",
    isAnonymous: data.isAnonymous === true,
    status: data.status === "hidden" ? "hidden" : "active",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
  };
}

function sortByCreatedAt(left: Question, right: Question) {
  return left.createdAt.localeCompare(right.createdAt);
}

export const questionsService = {
  async listOwn(
    stakeId: string,
    eventId: string,
    lookup: RegistrationLookup,
  ): Promise<Question[]> {
    if (!lookup.userId && !lookup.anonymousUid) {
      return [];
    }

    const registrationId = getRegistrationDocId(lookup);
    const snapshot = await getDocs(
      getQuestionsCollection(stakeId, eventId, registrationId),
    );

    return snapshot.docs
      .map((d) => mapQuestion(stakeId, eventId, registrationId, d.id, d.data()))
      .sort(sortByCreatedAt);
  },

  async listAllForEvent(stakeId: string, eventId: string): Promise<Question[]> {
    const registrations = await registrationsService.listRegistrationsByEvent(
      stakeId,
      eventId,
    );
    const questionGroups = await Promise.all(
      registrations.map(async (registration) => {
        const snapshot = await getDocs(
          getQuestionsCollection(stakeId, eventId, registration.id),
        );
        return snapshot.docs.map((d) =>
          mapQuestion(stakeId, eventId, registration.id, d.id, d.data()),
        );
      }),
    );

    return questionGroups.flat().sort(sortByCreatedAt);
  },

  async create(
    stakeId: string,
    eventId: string,
    lookup: RegistrationLookup,
    authorFullName: string,
    input: QuestionWriteInput,
  ): Promise<Question> {
    const text = input.text.trim();

    if (!text) {
      throw new Error("La domanda non può essere vuota.");
    }

    if (text.length > 2000) {
      throw new Error("La domanda è troppo lunga (max 2000 caratteri).");
    }

    const registrationId = getRegistrationDocId(lookup);
    const reference = doc(getQuestionsCollection(stakeId, eventId, registrationId));
    const timestamp = nowIso();
    const trimmedName = authorFullName.trim();
    const payload = {
      eventId,
      stakeId,
      registrationId,
      authorUserId: lookup.userId ?? null,
      authorAnonymousUid: lookup.userId ? null : lookup.anonymousUid ?? null,
      authorName: input.isAnonymous ? null : trimmedName || null,
      text,
      isAnonymous: input.isAnonymous,
      status: "active" as QuestionStatus,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await setDoc(reference, payload);

    return {
      id: reference.id,
      ...payload,
    };
  },

  async update(
    stakeId: string,
    eventId: string,
    lookup: RegistrationLookup,
    questionId: string,
    authorFullName: string,
    input: QuestionWriteInput,
  ): Promise<void> {
    const text = input.text.trim();

    if (!text) {
      throw new Error("La domanda non può essere vuota.");
    }

    if (text.length > 2000) {
      throw new Error("La domanda è troppo lunga (max 2000 caratteri).");
    }

    const registrationId = getRegistrationDocId(lookup);
    const trimmedName = authorFullName.trim();

    await updateDoc(getQuestionRef(stakeId, eventId, registrationId, questionId), {
      text,
      isAnonymous: input.isAnonymous,
      authorName: input.isAnonymous ? null : trimmedName || null,
      updatedAt: nowIso(),
    });
  },

  async remove(
    stakeId: string,
    eventId: string,
    lookup: RegistrationLookup,
    questionId: string,
  ): Promise<void> {
    const registrationId = getRegistrationDocId(lookup);
    await deleteDoc(getQuestionRef(stakeId, eventId, registrationId, questionId));
  },

  async setStatus(
    stakeId: string,
    eventId: string,
    registrationId: string,
    questionId: string,
    status: QuestionStatus,
  ): Promise<void> {
    await updateDoc(getQuestionRef(stakeId, eventId, registrationId, questionId), {
      status,
      updatedAt: nowIso(),
    });
  },

  async adminDelete(
    stakeId: string,
    eventId: string,
    registrationId: string,
    questionId: string,
  ): Promise<void> {
    await deleteDoc(getQuestionRef(stakeId, eventId, registrationId, questionId));
  },
};
