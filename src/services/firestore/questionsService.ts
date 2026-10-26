import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import { getDocsCacheFirst } from "@/services/firestore/cacheFirst";
import type {
  Question,
  QuestionStatus,
  QuestionWriteInput,
  RegistrationLookup,
} from "@/types";

function nowIso() {
  return new Date().toISOString();
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

// Le domande stanno sotto l'iscrizione che la pagina mostra, letta con il suo
// id: un ospite che ha collegato un account resta `guest_<uid>`, e ricostruire
// `user_<uid>` dalla sessione puntava a un'iscrizione che non esiste (rules:
// exists() falso, domanda rifiutata).
export const questionsService = {
  async listOwn(
    stakeId: string,
    eventId: string,
    registrationId: string,
  ): Promise<Question[]> {
    if (!registrationId) {
      return [];
    }

    const snapshot = await getDocsCacheFirst(
      getQuestionsCollection(stakeId, eventId, registrationId),
    );

    return snapshot.docs
      .map((d) => mapQuestion(stakeId, eventId, registrationId, d.id, d.data()))
      .sort(sortByCreatedAt);
  },

  // Query collection-group al posto del vecchio N+1 (una lettura per ogni
  // iscrizione): richiede l'indice composito su stakeId+eventId definito in
  // firestore.indexes.json e la rule di collection group per gli admin.
  async listAllForEvent(stakeId: string, eventId: string): Promise<Question[]> {
    const snapshot = await getDocsCacheFirst(
      query(
        collectionGroup(db, "questions"),
        where("stakeId", "==", stakeId),
        where("eventId", "==", eventId),
      ),
    );

    return snapshot.docs
      .map((d) => {
        const registrationId = d.ref.parent.parent?.id ?? "";
        return mapQuestion(stakeId, eventId, registrationId, d.id, d.data());
      })
      .sort(sortByCreatedAt);
  },

  async create(
    stakeId: string,
    eventId: string,
    registrationId: string,
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

    const reference = doc(getQuestionsCollection(stakeId, eventId, registrationId));
    const timestamp = nowIso();
    const trimmedName = authorFullName.trim();
    const payload = {
      eventId,
      stakeId,
      registrationId,
      authorUserId: lookup.userId ?? lookup.parentUid ?? null,
      authorAnonymousUid: lookup.userId || lookup.parentUid ? null : lookup.anonymousUid ?? null,
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
    registrationId: string,
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
    registrationId: string,
    questionId: string,
  ): Promise<void> {
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
