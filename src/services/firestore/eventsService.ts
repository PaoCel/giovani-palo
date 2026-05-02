import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import {
  eventFormsService,
  getDefaultEventFormConfig,
} from "@/services/firestore/eventFormsService";
import { organizationService } from "@/services/firestore/organizationService";
import type { Event, EventStatus, EventWriteInput } from "@/types";
import { normalizeStandardFieldKeys, removeRoomStandardFieldKeys } from "@/utils/formFields";
import { eventSpansMultipleCalendarDays, sanitizeEventAudience } from "@/utils/events";
import { slugify } from "@/utils/slugify";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeStatus(value: unknown): EventStatus {
  switch (value) {
    case "planned":
    case "confirmed":
    case "registrations_open":
    case "registrations_closed":
    case "completed":
    case "cancelled":
      return value;
    default:
      return "draft";
  }
}

function mapEvent(
  id: string,
  data: Record<string, unknown>,
  stakeId: string,
): Event {
  const title = typeof data.title === "string" ? data.title : "Attività senza titolo";
  const startDate = typeof data.startDate === "string" ? data.startDate : nowIso();
  const endDate = typeof data.endDate === "string" ? data.endDate : startDate;
  const overnight =
    Boolean(data.overnight) && eventSpansMultipleCalendarDays(startDate, endDate);

  return {
    id,
    activityId: id,
    stakeId,
    title,
    slug: typeof data.slug === "string" ? data.slug : slugify(title),
    description: typeof data.description === "string" ? data.description : "",
    year:
      typeof data.year === "number" ? data.year : new Date(startDate).getFullYear(),
    audience: sanitizeEventAudience(data.audience),
    startDate,
    endDate,
    location: typeof data.location === "string" ? data.location : "",
    program: typeof data.program === "string" ? data.program : "",
    publicNotes: typeof data.publicNotes === "string" ? data.publicNotes : "",
    organizerNotes: typeof data.organizerNotes === "string" ? data.organizerNotes : "",
    menuInfo: typeof data.menuInfo === "string" ? data.menuInfo : "",
    allergiesInfo: typeof data.allergiesInfo === "string" ? data.allergiesInfo : "",
    roomsInfo: overnight && typeof data.roomsInfo === "string" ? data.roomsInfo : "",
    heroImageUrl: typeof data.heroImageUrl === "string" ? data.heroImageUrl : "",
    heroImagePath: typeof data.heroImagePath === "string" ? data.heroImagePath : "",
    coverImageUrl:
      typeof data.coverImageUrl === "string"
        ? data.coverImageUrl
        : typeof data.heroImageUrl === "string"
          ? data.heroImageUrl
          : "",
    coverImagePath:
      typeof data.coverImagePath === "string"
        ? data.coverImagePath
        : typeof data.heroImagePath === "string"
          ? data.heroImagePath
          : "",
    status: sanitizeStatus(data.status),
    isPublic: data.isPublic === true,
    isVisible: data.isVisible !== false,
    allowGuestRegistration:
      typeof data.allowGuestRegistration === "boolean" ? data.allowGuestRegistration : true,
    requireLoginForEdit:
      typeof data.requireLoginForEdit === "boolean" ? data.requireLoginForEdit : true,
    registrationOpen:
      typeof data.registrationOpen === "string" ? data.registrationOpen : startDate,
    registrationClose:
      typeof data.registrationClose === "string"
        ? data.registrationClose
        : typeof data.endDate === "string"
          ? data.endDate
          : startDate,
    maxParticipants:
      typeof data.maxParticipants === "number" ? data.maxParticipants : null,
    overnight,
    templateId: typeof data.templateId === "string" ? data.templateId : null,
    questionsEnabled: data.questionsEnabled === true,
    requiresParentalConsent: data.requiresParentalConsent === true,
    requiresPhotoRelease: data.requiresPhotoRelease === true,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
    statsSummary:
      data.statsSummary && typeof data.statsSummary === "object"
        ? (data.statsSummary as Event["statsSummary"])
        : null,
  };
}

function normalizeEventInput(input: EventWriteInput) {
  const title = input.title.trim();
  const overnight =
    input.overnight && eventSpansMultipleCalendarDays(input.startDate, input.endDate);

  return {
    title,
    slug: slugify(title),
    description: input.description.trim(),
    year: input.year,
    audience: sanitizeEventAudience(input.audience),
    startDate: input.startDate,
    endDate: input.endDate,
    location: input.location.trim(),
    program: input.program.trim(),
    publicNotes: (input.publicNotes ?? "").trim(),
    organizerNotes: (input.organizerNotes ?? "").trim(),
    menuInfo: (input.menuInfo ?? "").trim(),
    allergiesInfo: (input.allergiesInfo ?? "").trim(),
    roomsInfo: overnight ? (input.roomsInfo ?? "").trim() : "",
    heroImageUrl: input.heroImageUrl.trim(),
    heroImagePath: (input.heroImagePath ?? "").trim(),
    coverImageUrl: (input.coverImageUrl ?? input.heroImageUrl).trim(),
    coverImagePath: (input.coverImagePath ?? input.heroImagePath ?? "").trim(),
    status: input.status,
    isPublic: input.isPublic,
    isVisible: input.isVisible ?? input.isPublic,
    allowGuestRegistration: input.allowGuestRegistration ?? true,
    requireLoginForEdit: input.requireLoginForEdit ?? true,
    registrationOpen: input.registrationOpen,
    registrationClose: input.registrationClose,
    maxParticipants: input.maxParticipants,
    overnight,
    templateId: (input.templateId ?? "").trim() || null,
    questionsEnabled: input.questionsEnabled ?? false,
    requiresParentalConsent: input.requiresParentalConsent ?? false,
    requiresPhotoRelease: input.requiresPhotoRelease ?? false,
  };
}

function getActivityCollection(stakeId: string) {
  return collection(db, "stakes", stakeId, "activities");
}

async function getLegacyEventById(eventId: string) {
  const snapshot = await getDoc(doc(db, "events", eventId));

  if (!snapshot.exists()) {
    return null;
  }

  return mapEvent(snapshot.id, snapshot.data(), "roma-est");
}

export const eventsService = {
  async listAllEvents(stakeId: string) {
    const snapshot = await getDocs(getActivityCollection(stakeId));

    if (snapshot.empty && stakeId === "roma-est") {
      const legacySnapshot = await getDocs(collection(db, "events"));
      return legacySnapshot.docs
        .map((item) => mapEvent(item.id, item.data(), "roma-est"))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    return snapshot.docs
      .map((document) => mapEvent(document.id, document.data(), stakeId))
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
  },

  async listPublicEvents(stakeId: string) {
    const snapshot = await getDocs(
      query(
        getActivityCollection(stakeId),
        where("isPublic", "==", true),
        where("isVisible", "==", true),
      ),
    );

    if (snapshot.empty && stakeId === "roma-est") {
      const legacySnapshot = await getDocs(
        query(collection(db, "events"), where("isPublic", "==", true)),
      );

      return legacySnapshot.docs
        .map((document) => mapEvent(document.id, document.data(), "roma-est"))
        .filter((event) => event.isVisible)
        .filter((event) => event.status !== "draft")
        .sort((left, right) => left.startDate.localeCompare(right.startDate));
    }

    const events = snapshot.docs.map((document) =>
      mapEvent(document.id, document.data(), stakeId),
    );

    return events
      .filter((event) => event.isVisible)
      .filter((event) => event.isPublic)
      .filter((event) => event.status !== "draft")
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
  },

  async getEventById(stakeId: string, eventId: string) {
    const snapshot = await getDoc(doc(db, "stakes", stakeId, "activities", eventId));

    if (snapshot.exists()) {
      return mapEvent(snapshot.id, snapshot.data(), stakeId);
    }

    if (stakeId === "roma-est") {
      return getLegacyEventById(eventId);
    }

    return null;
  },

  async getPublicEventById(stakeId: string, eventId: string) {
    const event = await this.getEventById(stakeId, eventId);

    if (!event || !event.isPublic || event.status === "draft") {
      return null;
    }

    return event;
  },

  async createEvent(stakeId: string, input: EventWriteInput, createdBy: string) {
    const eventReference = doc(getActivityCollection(stakeId));
    const timestamp = nowIso();
    const data = normalizeEventInput(input);
    const organization = await organizationService.getProfile(stakeId);
    const event: Event = {
      id: eventReference.id,
      activityId: eventReference.id,
      stakeId,
      ...data,
      createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await setDoc(eventReference, {
      ...data,
      activityId: eventReference.id,
      createdBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await eventFormsService.saveFormConfig(
      stakeId,
      eventReference.id,
      {
        ...getDefaultEventFormConfig(organization.registrationDefaults),
        allowGuestRegistration:
          input.allowGuestRegistration ??
          organization.registrationDefaults.allowGuestRegistration,
        requireLoginForEdit:
          input.requireLoginForEdit ??
          organization.registrationDefaults.requireLoginForEdit,
        enabledStandardFields: normalizeStandardFieldKeys(
          (
            data.overnight
              ? getDefaultEventFormConfig(organization.registrationDefaults).enabledStandardFields
              : removeRoomStandardFieldKeys(
                  getDefaultEventFormConfig(organization.registrationDefaults).enabledStandardFields,
                )
          ).concat(data.audience !== "congiunta" ? ["genderRoleCategory"] : []),
        ),
      },
    );

    return event;
  },

  async updateEvent(stakeId: string, eventId: string, input: EventWriteInput) {
    const data = normalizeEventInput(input);

    await updateDoc(doc(db, "stakes", stakeId, "activities", eventId), {
      ...data,
      updatedAt: nowIso(),
    });

    const currentFormConfig = await eventFormsService.getFormConfig(stakeId, eventId);

    await eventFormsService.saveFormConfig(stakeId, eventId, {
      ...currentFormConfig,
      allowGuestRegistration:
        input.allowGuestRegistration ?? currentFormConfig.allowGuestRegistration,
      requireLoginForEdit:
        input.requireLoginForEdit ?? currentFormConfig.requireLoginForEdit,
      enabledStandardFields: normalizeStandardFieldKeys(
        (
          data.overnight
            ? currentFormConfig.enabledStandardFields
            : removeRoomStandardFieldKeys(currentFormConfig.enabledStandardFields)
        ).concat(data.audience !== "congiunta" ? ["genderRoleCategory"] : []),
      ),
    });

    return this.getEventById(stakeId, eventId);
  },

  async updateEventStatus(stakeId: string, eventId: string, status: EventStatus) {
    await updateDoc(doc(db, "stakes", stakeId, "activities", eventId), {
      status,
      updatedAt: nowIso(),
    });

    return this.getEventById(stakeId, eventId);
  },

  async publishEvent(stakeId: string, eventId: string) {
    await updateDoc(doc(db, "stakes", stakeId, "activities", eventId), {
      status: "registrations_open",
      isPublic: true,
      updatedAt: nowIso(),
    });

    return this.getEventById(stakeId, eventId);
  },

  async deleteEvent(stakeId: string, eventId: string) {
    const formConfigReference = doc(
      db,
      "stakes",
      stakeId,
      "activities",
      eventId,
      "config",
      "form",
    );
    const formFieldsSnapshot = await getDocs(
      collection(db, "stakes", stakeId, "activities", eventId, "formFields"),
    );
    const registrationsSnapshot = await getDocs(
      collection(db, "stakes", stakeId, "activities", eventId, "registrations"),
    );

    for (const formField of formFieldsSnapshot.docs) {
      await deleteDoc(formField.ref);
    }

    for (const registration of registrationsSnapshot.docs) {
      await deleteDoc(registration.ref);
    }

    await deleteDoc(formConfigReference).catch(() => undefined);
    await deleteDoc(doc(db, "stakes", stakeId, "activities", eventId));
  },
};
