import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type { RegistrationStatus, SupportEvent, SupportEventKind, SupportEventSeverity } from "@/types";

function nowIso() {
  return new Date().toISOString();
}

function mapSupportEvent(id: string, data: Record<string, unknown>): SupportEvent {
  return {
    id,
    stakeId: typeof data.stakeId === "string" ? data.stakeId : "",
    eventId: typeof data.eventId === "string" ? data.eventId : null,
    eventTitle: typeof data.eventTitle === "string" ? data.eventTitle : "",
    registrationId: typeof data.registrationId === "string" ? data.registrationId : null,
    kind:
      data.kind === "registration_submit_started" ||
      data.kind === "registration_submit_succeeded" ||
      data.kind === "registration_submit_failed" ||
      data.kind === "anonymous_recovery_started" ||
      data.kind === "anonymous_recovery_succeeded" ||
      data.kind === "anonymous_recovery_failed"
        ? data.kind
        : "registration_submit_failed",
    severity:
      data.severity === "info" || data.severity === "warning" || data.severity === "error"
        ? data.severity
        : "error",
    route: typeof data.route === "string" ? data.route : "",
    actorUid: typeof data.actorUid === "string" ? data.actorUid : "",
    actorMode:
      data.actorMode === "anonymous" ? "anonymous" : "authenticated",
    fullName: typeof data.fullName === "string" ? data.fullName : "",
    email: typeof data.email === "string" ? data.email : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    message: typeof data.message === "string" ? data.message : "",
    errorCode: typeof data.errorCode === "string" ? data.errorCode : "",
    registrationStatus:
      data.registrationStatus === "draft" ||
      data.registrationStatus === "submitted" ||
      data.registrationStatus === "confirmed" ||
      data.registrationStatus === "waitlist" ||
      data.registrationStatus === "active" ||
      data.registrationStatus === "cancelled"
        ? data.registrationStatus
        : "",
    isStandalone: Boolean(data.isStandalone),
    isOnline: data.isOnline === false ? false : true,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
  };
}

function getRoute() {
  return typeof window !== "undefined" ? window.location.pathname : "";
}

function getDisplayMode() {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement.dataset.displayMode === "standalone";
}

function getErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }

  return "";
}

export const supportEventsService = {
  async listRecentSupportEvents(stakeId: string, take = 20): Promise<SupportEvent[]> {
    if (!stakeId) {
      return [];
    }

    const snapshot = await getDocs(
      query(
        collection(db, "stakes", stakeId, "supportEvents"),
        orderBy("createdAt", "desc"),
        limit(take),
      ),
    );

    return snapshot.docs.map((document) => mapSupportEvent(document.id, document.data()));
  },

  async logRegistrationEvent(args: {
    stakeId: string;
    actorUid: string;
    actorMode: "authenticated" | "anonymous";
    kind: SupportEventKind;
    severity: SupportEventSeverity;
    eventId: string;
    eventTitle: string;
    registrationId?: string | null;
    fullName?: string;
    email?: string;
    phone?: string;
    message?: string;
    error?: unknown;
    registrationStatus?: RegistrationStatus | "";
  }) {
    const payload = {
      stakeId: args.stakeId,
      eventId: args.eventId,
      eventTitle: args.eventTitle,
      registrationId: args.registrationId ?? null,
      kind: args.kind,
      severity: args.severity,
      route: getRoute(),
      actorUid: args.actorUid,
      actorMode: args.actorMode,
      fullName: args.fullName?.trim() ?? "",
      email: args.email?.trim() ?? "",
      phone: args.phone?.trim() ?? "",
      message:
        args.message ??
        (args.error instanceof Error ? args.error.message : ""),
      errorCode: getErrorCode(args.error),
      registrationStatus: args.registrationStatus ?? "",
      isStandalone: getDisplayMode(),
      isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
      createdAt: nowIso(),
    };

    await addDoc(collection(db, "stakes", args.stakeId, "supportEvents"), payload);
  },

  async captureRegistrationEvent(args: {
    stakeId: string;
    actorUid: string;
    actorMode: "authenticated" | "anonymous";
    kind: SupportEventKind;
    severity: SupportEventSeverity;
    eventId: string;
    eventTitle: string;
    registrationId?: string | null;
    fullName?: string;
    email?: string;
    phone?: string;
    message?: string;
    error?: unknown;
    registrationStatus?: RegistrationStatus | "";
  }) {
    try {
      await this.logRegistrationEvent(args);
    } catch {
      // Never block the registration flow because support logging is unavailable.
    }
  },
};
