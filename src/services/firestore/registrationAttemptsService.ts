import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type {
  Registration,
  RegistrationAttemptLog,
  RegistrationAttemptStep,
  RegistrationLookup,
  RegistrationStatus,
  RegistrationWriteInput,
} from "@/types";

function nowIso() {
  return new Date().toISOString();
}

function getAttemptsCollection(stakeId: string) {
  return collection(db, "stakes", stakeId, "registrationAttempts");
}

function getStringField(data: Record<string, unknown>, key: string) {
  return typeof data[key] === "string" ? data[key] : "";
}

function getNullableStringField(data: Record<string, unknown>, key: string) {
  return typeof data[key] === "string" ? data[key] : null;
}

function getSubmittedByMode(lookup: RegistrationLookup) {
  return lookup.userId ? "authenticated" : "anonymous";
}

function getDisplayMode() {
  if (typeof document === "undefined") {
    return "unknown" as const;
  }

  const rawMode = document.documentElement.dataset.displayMode;

  if (rawMode === "browser" || rawMode === "standalone") {
    return rawMode;
  }

  return "unknown" as const;
}

function getRoute() {
  if (typeof window === "undefined") {
    return "";
  }

  return `${window.location.pathname}${window.location.search}`;
}

function getRuntimeSnapshot() {
  return {
    route: getRoute(),
    displayMode: getDisplayMode(),
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
}

function getErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function mapAttemptLog(id: string, data: Record<string, unknown>): RegistrationAttemptLog {
  const status =
    data.status === "started" || data.status === "succeeded" || data.status === "failed"
      ? data.status
      : "started";
  const lastStep =
    data.lastStep === "submit_started" ||
    data.lastStep === "registration_saved" ||
    data.lastStep === "recovery_saved" ||
    data.lastStep === "completed" ||
    data.lastStep === "pdf_generated" ||
    data.lastStep === "submit_failed" ||
    data.lastStep === "pdf_failed"
      ? data.lastStep
      : "submit_started";
  const displayMode =
    data.displayMode === "browser" ||
    data.displayMode === "standalone" ||
    data.displayMode === "unknown"
      ? data.displayMode
      : "unknown";
  const registrationStatus: RegistrationStatus | null =
    data.registrationStatus === "draft" ||
    data.registrationStatus === "submitted" ||
    data.registrationStatus === "confirmed" ||
    data.registrationStatus === "waitlist" ||
    data.registrationStatus === "active" ||
    data.registrationStatus === "cancelled"
      ? data.registrationStatus
      : null;

  return {
    id,
    stakeId: getStringField(data, "stakeId"),
    eventId: getStringField(data, "eventId"),
    eventTitle: getStringField(data, "eventTitle"),
    registrationId: getNullableStringField(data, "registrationId"),
    userId: getNullableStringField(data, "userId"),
    anonymousUid: getNullableStringField(data, "anonymousUid"),
    submittedByMode: data.submittedByMode === "anonymous" ? "anonymous" : "authenticated",
    fullName: getStringField(data, "fullName"),
    email: getStringField(data, "email"),
    phone: getStringField(data, "phone"),
    status,
    lastStep,
    route: getStringField(data, "route"),
    displayMode,
    online: data.online === false ? false : true,
    userAgent: getStringField(data, "userAgent"),
    registrationStatus,
    errorCode: getNullableStringField(data, "errorCode"),
    errorMessage: getNullableStringField(data, "errorMessage"),
    startedAt: getStringField(data, "startedAt"),
    completedAt: getNullableStringField(data, "completedAt"),
    failedAt: getNullableStringField(data, "failedAt"),
    createdAt: getStringField(data, "createdAt"),
    updatedAt: getStringField(data, "updatedAt"),
  };
}

export const registrationAttemptsService = {
  async startAttempt(args: {
    stakeId: string;
    eventId: string;
    eventTitle: string;
    lookup: RegistrationLookup;
    input: RegistrationWriteInput;
  }) {
    try {
      const timestamp = nowIso();
      const runtime = getRuntimeSnapshot();
      const reference = await addDoc(getAttemptsCollection(args.stakeId), {
        stakeId: args.stakeId,
        eventId: args.eventId,
        eventTitle: args.eventTitle,
        registrationId: null,
        userId: args.lookup.userId ?? null,
        anonymousUid: args.lookup.userId ? null : args.lookup.anonymousUid ?? null,
        submittedByMode: getSubmittedByMode(args.lookup),
        fullName: args.input.fullName.trim(),
        email: args.input.email.trim(),
        phone: args.input.phone.trim(),
        status: "started",
        lastStep: "submit_started",
        route: runtime.route,
        displayMode: runtime.displayMode,
        online: runtime.online,
        userAgent: runtime.userAgent,
        registrationStatus: null,
        errorCode: null,
        errorMessage: null,
        startedAt: timestamp,
        completedAt: null,
        failedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      return reference.id;
    } catch {
      return null;
    }
  },

  async markStep(
    stakeId: string,
    attemptId: string | null,
    input: {
      lastStep: RegistrationAttemptStep;
      registrationId?: string | null;
      registrationStatus?: RegistrationStatus | null;
    },
  ) {
    if (!attemptId) {
      return;
    }

    try {
      await updateDoc(doc(db, "stakes", stakeId, "registrationAttempts", attemptId), {
        ...input,
        updatedAt: nowIso(),
      });
    } catch {
      // Best effort support logging must never block registration flows.
    }
  },

  async markSucceeded(
    stakeId: string,
    attemptId: string | null,
    registration: Registration,
    lastStep: Extract<
      RegistrationAttemptStep,
      "completed" | "pdf_generated" | "recovery_saved" | "registration_saved"
    >,
  ) {
    if (!attemptId) {
      return;
    }

    const timestamp = nowIso();

    try {
      await updateDoc(doc(db, "stakes", stakeId, "registrationAttempts", attemptId), {
        status: "succeeded",
        lastStep,
        registrationId: registration.id,
        registrationStatus: registration.registrationStatus,
        completedAt: timestamp,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: timestamp,
      });
    } catch {
      // Best effort support logging must never block registration flows.
    }
  },

  async markFailed(
    stakeId: string,
    attemptId: string | null,
    lastStep: Extract<RegistrationAttemptStep, "submit_failed" | "pdf_failed">,
    error: unknown,
  ) {
    if (!attemptId) {
      return;
    }

    const timestamp = nowIso();

    try {
      await updateDoc(doc(db, "stakes", stakeId, "registrationAttempts", attemptId), {
        status: "failed",
        lastStep,
        errorCode: getErrorCode(error),
        errorMessage: getErrorMessage(error),
        failedAt: timestamp,
        updatedAt: timestamp,
      });
    } catch {
      // Best effort support logging must never block registration flows.
    }
  },

  async listRecentAttempts(stakeId: string, maxItems = 30): Promise<RegistrationAttemptLog[]> {
    try {
      const snapshot = await getDocs(
        query(getAttemptsCollection(stakeId), orderBy("updatedAt", "desc"), limit(maxItems)),
      );

      return snapshot.docs.map((document) =>
        mapAttemptLog(document.id, document.data() as Record<string, unknown>),
      );
    } catch {
      return [];
    }
  },
};
