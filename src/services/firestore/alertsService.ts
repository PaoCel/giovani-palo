import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type { Alert, Registration } from "@/types";

function nowIso() {
  return new Date().toISOString();
}

function getAlertsCollection(stakeId: string) {
  return collection(db, "stakes", stakeId, "adminAlerts");
}

function mapAlert(id: string, data: Record<string, unknown>): Alert {
  return {
    id,
    type: data.type === "registration_created" ? "registration_created" : undefined,
    stakeId: typeof data.stakeId === "string" ? data.stakeId : undefined,
    eventId: typeof data.eventId === "string" ? data.eventId : undefined,
    registrationId: typeof data.registrationId === "string" ? data.registrationId : null,
    eventTitle: typeof data.eventTitle === "string" ? data.eventTitle : "",
    participantName: typeof data.participantName === "string" ? data.participantName : "",
    submittedByMode:
      data.submittedByMode === "anonymous" ? "anonymous" : "authenticated",
    title: typeof data.title === "string" ? data.title : "Notifica admin",
    message: typeof data.message === "string" ? data.message : "",
    severity:
      data.severity === "warning" ||
      data.severity === "critical" ||
      data.severity === "success"
        ? data.severity
        : "info",
    active: data.active !== false,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
    readBy: Array.isArray(data.readBy)
      ? data.readBy.filter((value): value is string => typeof value === "string")
      : [],
  };
}

export const alertsService = {
  async createRegistrationCreatedAlert(args: {
    stakeId: string;
    eventId: string;
    eventTitle: string;
    registration: Registration;
  }) {
    const timestamp = nowIso();
    const alertId = `registration_created_${args.eventId}_${args.registration.id}`;

    await setDoc(doc(db, "stakes", args.stakeId, "adminAlerts", alertId), {
      type: "registration_created",
      stakeId: args.stakeId,
      eventId: args.eventId,
      registrationId: args.registration.id,
      eventTitle: args.eventTitle,
      participantName: args.registration.fullName,
      submittedByMode: args.registration.submittedByMode,
      title: "Nuovo iscritto",
      message: `${args.registration.fullName} si e iscritto a ${args.eventTitle}.`,
      severity: "info",
      active: true,
      readBy: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },

  async listActiveAlerts(stakeId: string, maxItems = 12): Promise<Alert[]> {
    const snapshot = await getDocs(
      query(getAlertsCollection(stakeId), orderBy("createdAt", "desc"), limit(maxItems)),
    );

    return snapshot.docs
      .map((item) => mapAlert(item.id, item.data()))
      .filter((alert) => alert.active);
  },

  subscribeToActiveAlerts(
    stakeId: string,
    maxItems: number,
    onData: (alerts: Alert[]) => void,
    onError?: (error: Error) => void,
  ) {
    return onSnapshot(
      query(getAlertsCollection(stakeId), orderBy("createdAt", "desc"), limit(maxItems)),
      (snapshot) => {
        onData(
          snapshot.docs
            .map((item) => mapAlert(item.id, item.data()))
            .filter((alert) => alert.active),
        );
      },
      (error) => {
        onError?.(error);
      },
    );
  },

  async markAlertRead(stakeId: string, alertId: string, userId: string) {
    await updateDoc(doc(db, "stakes", stakeId, "adminAlerts", alertId), {
      readBy: arrayUnion(userId),
      updatedAt: nowIso(),
    });
  },
};
