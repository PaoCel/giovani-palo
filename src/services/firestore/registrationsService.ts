import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import { eventsService } from "@/services/firestore/eventsService";
import { organizationService } from "@/services/firestore/organizationService";
import { usersService } from "@/services/firestore/usersService";
import type {
  GenderRoleCategory,
  Registration,
  RegistrationLookup,
  RoomPreferenceMatches,
  RegistrationStatus,
  RegistrationWriteInput,
} from "@/types";
import { getAudienceRestrictionMessage, isEventAudienceEligible } from "@/utils/events";
import { getGenderRoleCategory, getYouthGroupLabel } from "@/utils/profile";
import {
  findRoomPreferenceMatch,
  parseRoomPreferenceMatches,
  preserveRoomPreferenceMatchesOnSave,
} from "@/utils/roomPreferences";

function nowIso() {
  return new Date().toISOString();
}

function createRecoveryCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function splitFullName(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }

  const parts = trimmed.split(/\s+/);

  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function mapRegistration(
  eventId: string,
  stakeId: string,
  registrationId: string,
  data: Record<string, unknown>,
): Registration {
  const fullName = typeof data.fullName === "string" ? data.fullName : "";
  const names = splitFullName(fullName);
  const genderRoleCategory = getGenderRoleCategory(
    typeof data.genderRoleCategory === "string"
      ? data.genderRoleCategory
      : typeof data.answers === "object" &&
          data.answers !== null &&
          typeof (data.answers as Record<string, unknown>).genderRoleCategory === "string"
        ? ((data.answers as Record<string, unknown>).genderRoleCategory as string)
        : "",
  );

  return {
    id: registrationId,
    eventId,
    activityId: eventId,
    stakeId,
    userId: typeof data.userId === "string" ? data.userId : null,
    anonymousUid: typeof data.anonymousUid === "string" ? data.anonymousUid : null,
    anonymousTokenId:
      typeof data.anonymousTokenId === "string" ? data.anonymousTokenId : null,
    firstName:
      typeof data.firstName === "string" && data.firstName.trim()
        ? data.firstName
        : names.firstName,
    lastName:
      typeof data.lastName === "string" && data.lastName.trim()
        ? data.lastName
        : names.lastName,
    fullName,
    email: typeof data.email === "string" ? data.email : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    birthDate: typeof data.birthDate === "string" ? data.birthDate : "",
    genderRoleCategory,
    youthGroup: getYouthGroupLabel(genderRoleCategory),
    unitId: typeof data.unitId === "string" ? data.unitId : "",
    unitNameSnapshot: typeof data.unitNameSnapshot === "string" ? data.unitNameSnapshot : "",
    answers:
      data.answers && typeof data.answers === "object"
        ? (data.answers as Registration["answers"])
        : {},
    roomPreferenceMatches: parseRoomPreferenceMatches(data.roomPreferenceMatches),
    accessCode:
      typeof data.accessCode === "string"
        ? data.accessCode
        : typeof data.recoveryCode === "string"
          ? data.recoveryCode
          : null,
    recoveryCode: typeof data.recoveryCode === "string" ? data.recoveryCode : null,
    recoveryPdfGenerated: Boolean(data.recoveryPdfGenerated),
    parentConsentDocumentName:
      typeof data.parentConsentDocumentName === "string"
        ? data.parentConsentDocumentName
        : null,
    parentConsentDocumentUrl:
      typeof data.parentConsentDocumentUrl === "string"
        ? data.parentConsentDocumentUrl
        : null,
    parentConsentDocumentPath:
      typeof data.parentConsentDocumentPath === "string"
        ? data.parentConsentDocumentPath
        : null,
    parentConsentUploadedAt:
      typeof data.parentConsentUploadedAt === "string" ? data.parentConsentUploadedAt : null,
    consentSignatureUrl:
      typeof data.consentSignatureUrl === "string" ? data.consentSignatureUrl : null,
    consentSignaturePath:
      typeof data.consentSignaturePath === "string" ? data.consentSignaturePath : null,
    consentSignatureSetAt:
      typeof data.consentSignatureSetAt === "string" ? data.consentSignatureSetAt : null,
    parentIdDocumentName:
      typeof data.parentIdDocumentName === "string" ? data.parentIdDocumentName : null,
    parentIdDocumentUrl:
      typeof data.parentIdDocumentUrl === "string" ? data.parentIdDocumentUrl : null,
    parentIdDocumentPath:
      typeof data.parentIdDocumentPath === "string" ? data.parentIdDocumentPath : null,
    parentIdUploadedAt:
      typeof data.parentIdUploadedAt === "string" ? data.parentIdUploadedAt : null,
    linkedLaterToUserId:
      typeof data.linkedLaterToUserId === "string" ? data.linkedLaterToUserId : null,
    status: data.registrationStatus === "cancelled" ? "cancelled" : "active",
    registrationStatus:
      data.registrationStatus === "draft" ||
      data.registrationStatus === "submitted" ||
      data.registrationStatus === "confirmed" ||
      data.registrationStatus === "waitlist" ||
      data.registrationStatus === "cancelled" ||
      data.registrationStatus === "active"
        ? data.registrationStatus
        : "active",
    submittedByMode: data.submittedByMode === "anonymous" ? "anonymous" : "authenticated",
    assignedRoomId:
      typeof data.assignedRoomId === "string" ? data.assignedRoomId : null,
    assignedTempleShiftId:
      typeof data.assignedTempleShiftId === "string"
        ? data.assignedTempleShiftId
        : null,
    assignedServiceTeamIds: Array.isArray(data.assignedServiceTeamIds)
      ? data.assignedServiceTeamIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
  };
}

function getEventRegistrationsCollection(stakeId: string, eventId: string) {
  return collection(db, "stakes", stakeId, "activities", eventId, "registrations");
}

function getRegistrationReference(stakeId: string, eventId: string, registrationId: string) {
  return doc(db, "stakes", stakeId, "activities", eventId, "registrations", registrationId);
}

function getStakeAndEventFromRegistrationPath(path: string) {
  const parts = path.split("/");

  if (parts.length < 6) {
    return null;
  }

  return {
    stakeId: parts[1] ?? "",
    eventId: parts[3] ?? "",
  };
}

function getRegistrationDocId(lookup: RegistrationLookup) {
  if (lookup.userId) {
    return `user_${lookup.userId}`;
  }

  if (lookup.anonymousUid) {
    return `guest_${lookup.anonymousUid}`;
  }

  throw new Error("Serve una sessione valida per salvare la registrazione.");
}

function getUnitName(answers: RegistrationWriteInput["answers"]) {
  return typeof answers.unitName === "string" ? answers.unitName.trim() : "";
}

function getBirthDate(answers: RegistrationWriteInput["answers"]) {
  return typeof answers.birthDate === "string" ? answers.birthDate : "";
}

function getGenderFromAnswers(answers: RegistrationWriteInput["answers"]) {
  return getGenderRoleCategory(
    typeof answers.genderRoleCategory === "string" ? answers.genderRoleCategory : "",
  );
}

function mergeRoomPreferenceMatches(
  source: unknown,
  target: unknown,
): RoomPreferenceMatches {
  return {
    ...parseRoomPreferenceMatches(source),
    ...parseRoomPreferenceMatches(target),
  };
}

function areRoomPreferenceMatchesEqual(
  left: RoomPreferenceMatches,
  right: RoomPreferenceMatches,
) {
  return ["roomPreference1Name", "roomPreference2Name"].every((key) => {
    const leftMatch = left[key as keyof RoomPreferenceMatches] ?? null;
    const rightMatch = right[key as keyof RoomPreferenceMatches] ?? null;

    if (!leftMatch && !rightMatch) {
      return true;
    }

    if (!leftMatch || !rightMatch) {
      return false;
    }

    return (
      leftMatch.rawValue === rightMatch.rawValue &&
      leftMatch.normalizedValue === rightMatch.normalizedValue &&
      leftMatch.matchedRegistrationId === rightMatch.matchedRegistrationId &&
      leftMatch.matchedFullName === rightMatch.matchedFullName &&
      leftMatch.matchedCategory === rightMatch.matchedCategory &&
      leftMatch.score === rightMatch.score &&
      leftMatch.status === rightMatch.status
    );
  });
}

async function getRegistrationCategory(
  stakeId: string,
  lookup: RegistrationLookup,
  input: RegistrationWriteInput,
) {
  if (lookup.userId) {
    const profile = await usersService.getProfile(lookup.userId);
    return profile?.genderRoleCategory ?? "";
  }

  return getGenderFromAnswers(input.answers);
}

export const registrationsService = {
  async listRegistrationsByEvent(stakeId: string, eventId: string): Promise<Registration[]> {
    const snapshot = await getDocs(getEventRegistrationsCollection(stakeId, eventId));

    return snapshot.docs
      .map((document) =>
        mapRegistration(eventId, stakeId, document.id, document.data()),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  async getRegistrationByActor(
    stakeId: string,
    eventId: string,
    lookup: RegistrationLookup,
  ) {
    if (!lookup.userId && !lookup.anonymousUid) {
      return null;
    }

    if (lookup.userId) {
      const authenticatedRegistration = await this.getRegistrationById(
        stakeId,
        eventId,
        `user_${lookup.userId}`,
      );

      if (authenticatedRegistration) {
        return authenticatedRegistration;
      }

      return this.getRegistrationById(stakeId, eventId, `guest_${lookup.userId}`);
    }

    return this.getRegistrationById(stakeId, eventId, getRegistrationDocId(lookup));
  },

  async getRegistrationById(stakeId: string, eventId: string, registrationId: string) {
    const snapshot = await getDoc(getRegistrationReference(stakeId, eventId, registrationId));

    if (!snapshot.exists()) {
      return null;
    }

    return mapRegistration(eventId, stakeId, snapshot.id, snapshot.data());
  },

  async upsertRegistration(
    stakeId: string,
    eventId: string,
    lookup: RegistrationLookup,
    input: RegistrationWriteInput,
  ) {
    const event = await eventsService.getEventById(stakeId, eventId);

    if (!event) {
      throw new Error("Attività non trovata.");
    }

    const registrationCategory = await getRegistrationCategory(stakeId, lookup, input);

    if (!isEventAudienceEligible(event, registrationCategory as GenderRoleCategory | "")) {
      throw new Error(getAudienceRestrictionMessage(event.audience));
    }

    const unitName = getUnitName(input.answers);
    const resolvedUnit = unitName
      ? await organizationService.assertManagedUnit(stakeId, unitName)
      : null;

    const registrationId = getRegistrationDocId(lookup);
    const reference = getRegistrationReference(stakeId, eventId, registrationId);
    const snapshot = await getDoc(reference);
    const guestReference =
      lookup.userId
        ? getRegistrationReference(stakeId, eventId, `guest_${lookup.userId}`)
        : null;
    const guestSnapshot =
      lookup.userId && !snapshot.exists() && guestReference ? await getDoc(guestReference) : null;
    const timestamp = nowIso();
    const existing = snapshot.exists()
      ? mapRegistration(eventId, stakeId, snapshot.id, snapshot.data())
      : guestSnapshot?.exists()
        ? mapRegistration(eventId, stakeId, guestSnapshot.id, guestSnapshot.data())
        : null;
    const fullName = input.fullName.trim();
    const names = splitFullName(fullName);
    const genderRoleCategory = getGenderFromAnswers(input.answers);
    const recoveryCode =
      existing?.recoveryCode ?? (lookup.anonymousUid ? createRecoveryCode() : null);
    const registrationStatus: RegistrationStatus =
      input.registrationStatus === "cancelled"
        ? "cancelled"
        : existing?.registrationStatus ?? "active";
    const roomPreferenceMatches = preserveRoomPreferenceMatchesOnSave(
      existing?.roomPreferenceMatches ?? {},
      input.answers,
    );

    await setDoc(reference, {
      userId: lookup.userId,
      anonymousUid: lookup.userId ? null : lookup.anonymousUid,
      anonymousTokenId: existing?.anonymousTokenId ?? null,
      firstName: names.firstName,
      lastName: names.lastName,
      fullName,
      email: input.email.trim(),
      phone: input.phone.trim(),
      birthDate: getBirthDate(input.answers),
      genderRoleCategory,
      unitId: resolvedUnit?.id ?? existing?.unitId ?? "",
      unitNameSnapshot: resolvedUnit?.name ?? unitName,
      answers: input.answers,
      roomPreferenceMatches,
      accessCode: existing?.accessCode ?? recoveryCode,
      recoveryCode,
      recoveryPdfGenerated: existing?.recoveryPdfGenerated ?? false,
      parentConsentDocumentName: existing?.parentConsentDocumentName ?? null,
      parentConsentDocumentUrl: existing?.parentConsentDocumentUrl ?? null,
      parentConsentDocumentPath: existing?.parentConsentDocumentPath ?? null,
      parentConsentUploadedAt: existing?.parentConsentUploadedAt ?? null,
      consentSignatureUrl: existing?.consentSignatureUrl ?? null,
      consentSignaturePath: existing?.consentSignaturePath ?? null,
      consentSignatureSetAt: existing?.consentSignatureSetAt ?? null,
      parentIdDocumentName: existing?.parentIdDocumentName ?? null,
      parentIdDocumentUrl: existing?.parentIdDocumentUrl ?? null,
      parentIdDocumentPath: existing?.parentIdDocumentPath ?? null,
      parentIdUploadedAt: existing?.parentIdUploadedAt ?? null,
      linkedLaterToUserId: existing?.linkedLaterToUserId ?? null,
      registrationStatus,
      submittedByMode: lookup.userId ? "authenticated" : "anonymous",
      assignedRoomId: existing?.assignedRoomId ?? null,
      assignedTempleShiftId: existing?.assignedTempleShiftId ?? null,
      assignedServiceTeamIds: existing?.assignedServiceTeamIds ?? [],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });

    if (lookup.userId && guestSnapshot?.exists() && guestReference) {
      await deleteDoc(guestReference);
    }

    if (lookup.userId) {
      await usersService.syncProfileFromRegistration(lookup.userId, {
        fullName,
        email: input.email.trim(),
        stakeId,
        birthDate: getBirthDate(input.answers),
        genderRoleCategory,
        unitName: resolvedUnit?.name ?? unitName,
        unitId: resolvedUnit?.id,
      });
    }

    const savedRegistration = await this.getRegistrationById(stakeId, eventId, registrationId);

    return savedRegistration;
  },

  async cancelRegistration(stakeId: string, eventId: string, lookup: RegistrationLookup) {
    const registrationId = getRegistrationDocId(lookup);
    const reference = getRegistrationReference(stakeId, eventId, registrationId);

    await updateDoc(reference, {
      registrationStatus: "cancelled",
      updatedAt: nowIso(),
    });

    return this.getRegistrationById(stakeId, eventId, registrationId);
  },

  async saveAnonymousRecovery(
    stakeId: string,
    eventId: string,
    registrationId: string,
    input: {
      anonymousUid: string;
      anonymousTokenId: string;
      recoveryCode: string;
      pdfDataSummary: Record<string, unknown>;
      recoveryPdfGenerated?: boolean;
    },
  ) {
    const registrationReference = getRegistrationReference(stakeId, eventId, registrationId);

    await updateDoc(registrationReference, {
      anonymousTokenId: input.anonymousTokenId,
      accessCode: input.recoveryCode,
      recoveryCode: input.recoveryCode,
      recoveryPdfGenerated: input.recoveryPdfGenerated ?? false,
      updatedAt: nowIso(),
    });

    return this.getRegistrationById(stakeId, eventId, registrationId);
  },

  async linkAnonymousRegistrationsToUser(anonymousUid: string, userId: string) {
    const snapshot = await getDocs(
      query(collectionGroup(db, "registrations"), where("anonymousUid", "==", anonymousUid)),
    );
    let latestRegistration: Registration | null = null;

    for (const registrationDocument of snapshot.docs) {
      const context = getStakeAndEventFromRegistrationPath(registrationDocument.ref.path);

      if (!context?.stakeId || !context.eventId) {
        continue;
      }

      const { stakeId, eventId } = context;
      const targetRegistrationId = `user_${userId}`;
      const guestRegistration = mapRegistration(
        eventId,
        stakeId,
        registrationDocument.id,
        registrationDocument.data(),
      );
      const targetReference = getRegistrationReference(
        stakeId,
        eventId,
        targetRegistrationId,
      );
      const targetSnapshot = await getDoc(targetReference);
      const targetData = targetSnapshot.exists()
        ? (targetSnapshot.data() as Record<string, unknown>)
        : null;
      const sourceData = registrationDocument.data() as Record<string, unknown>;
      const timestamp = nowIso();

      await setDoc(
        targetReference,
        {
          ...sourceData,
          ...targetData,
          userId,
          anonymousUid: null,
          linkedLaterToUserId: userId,
          anonymousTokenId:
            (typeof targetData?.anonymousTokenId === "string"
              ? targetData.anonymousTokenId
              : guestRegistration.anonymousTokenId) ?? null,
          answers: {
            ...(sourceData.answers && typeof sourceData.answers === "object"
              ? sourceData.answers
              : {}),
            ...(targetData?.answers && typeof targetData.answers === "object"
              ? targetData.answers
              : {}),
          },
          roomPreferenceMatches: mergeRoomPreferenceMatches(
            sourceData.roomPreferenceMatches,
            targetData?.roomPreferenceMatches,
          ),
          createdAt:
            (typeof targetData?.createdAt === "string" ? targetData.createdAt : null) ??
            guestRegistration.createdAt ??
            timestamp,
          updatedAt: timestamp,
        },
        { merge: true },
      );

      if (registrationDocument.id !== targetRegistrationId) {
        await deleteDoc(registrationDocument.ref);
      }

      const linkedRegistration = await this.getRegistrationById(
        stakeId,
        eventId,
        targetRegistrationId,
      );

      if (
        linkedRegistration &&
        (!latestRegistration ||
          linkedRegistration.updatedAt.localeCompare(latestRegistration.updatedAt) > 0)
      ) {
        latestRegistration = linkedRegistration;
      }
    }

    return latestRegistration;
  },

  async markRecoveryPdfGenerated(stakeId: string, eventId: string, registrationId: string) {
    await updateDoc(
      getRegistrationReference(stakeId, eventId, registrationId),
      {
        recoveryPdfGenerated: true,
        updatedAt: nowIso(),
      },
    );
  },

  async saveParentConsentDocument(
    stakeId: string,
    eventId: string,
    registrationId: string,
    input: {
      name: string;
      path: string;
      url: string;
    },
  ) {
    const existingRegistration = await this.getRegistrationById(stakeId, eventId, registrationId);

    if (!existingRegistration) {
      throw new Error("Registrazione non trovata per salvare il consenso.");
    }

    await updateDoc(getRegistrationReference(stakeId, eventId, registrationId), {
      answers: {
        ...existingRegistration.answers,
        parentConfirmed: true,
      },
      parentConsentDocumentName: input.name.trim(),
      parentConsentDocumentPath: input.path,
      parentConsentDocumentUrl: input.url,
      parentConsentUploadedAt: nowIso(),
      updatedAt: nowIso(),
    });

    return this.getRegistrationById(stakeId, eventId, registrationId);
  },

  async saveConsentSignature(
    stakeId: string,
    eventId: string,
    registrationId: string,
    input: { path: string; url: string },
  ) {
    const reference = getRegistrationReference(stakeId, eventId, registrationId);
    const timestamp = nowIso();

    await updateDoc(reference, {
      consentSignatureUrl: input.url,
      consentSignaturePath: input.path,
      consentSignatureSetAt: timestamp,
      updatedAt: timestamp,
    });

    return this.getRegistrationById(stakeId, eventId, registrationId);
  },

  async clearConsentSignature(stakeId: string, eventId: string, registrationId: string) {
    const reference = getRegistrationReference(stakeId, eventId, registrationId);

    await updateDoc(reference, {
      consentSignatureUrl: null,
      consentSignaturePath: null,
      consentSignatureSetAt: null,
      updatedAt: nowIso(),
    });

    return this.getRegistrationById(stakeId, eventId, registrationId);
  },

  async saveParentIdDocument(
    stakeId: string,
    eventId: string,
    registrationId: string,
    input: { path: string; url: string; name: string },
  ) {
    const reference = getRegistrationReference(stakeId, eventId, registrationId);
    const timestamp = nowIso();

    await updateDoc(reference, {
      parentIdDocumentName: input.name,
      parentIdDocumentUrl: input.url,
      parentIdDocumentPath: input.path,
      parentIdUploadedAt: timestamp,
      updatedAt: timestamp,
    });

    return this.getRegistrationById(stakeId, eventId, registrationId);
  },

  async clearParentIdDocument(stakeId: string, eventId: string, registrationId: string) {
    const reference = getRegistrationReference(stakeId, eventId, registrationId);

    await updateDoc(reference, {
      parentIdDocumentName: null,
      parentIdDocumentUrl: null,
      parentIdDocumentPath: null,
      parentIdUploadedAt: null,
      updatedAt: nowIso(),
    });

    return this.getRegistrationById(stakeId, eventId, registrationId);
  },

  async clearParentConsentDocument(stakeId: string, eventId: string, registrationId: string) {
    const existingRegistration = await this.getRegistrationById(stakeId, eventId, registrationId);

    if (!existingRegistration) {
      throw new Error("Registrazione non trovata per rimuovere il consenso.");
    }

    await updateDoc(getRegistrationReference(stakeId, eventId, registrationId), {
      answers: {
        ...existingRegistration.answers,
        parentConfirmed: false,
      },
      parentConsentDocumentName: null,
      parentConsentDocumentPath: null,
      parentConsentDocumentUrl: null,
      parentConsentUploadedAt: null,
      updatedAt: nowIso(),
    });

    return this.getRegistrationById(stakeId, eventId, registrationId);
  },

  async normalizeRoomPreferenceMatches(stakeId: string, eventId: string) {
    const registrations = await this.listRegistrationsByEvent(stakeId, eventId);
    const activeRegistrations = registrations.filter(
      (registration) =>
        registration.registrationStatus !== "cancelled" && registration.status !== "cancelled",
    );
    const batch = writeBatch(db);
    const timestamp = nowIso();
    let updatedRegistrationsCount = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;
    let processedRequestsCount = 0;

    for (const registration of activeRegistrations) {
      const nextMatches = {
        roomPreference1Name: findRoomPreferenceMatch(
          registration,
          "roomPreference1Name",
          activeRegistrations,
          timestamp,
        ),
        roomPreference2Name: findRoomPreferenceMatch(
          registration,
          "roomPreference2Name",
          activeRegistrations,
          timestamp,
        ),
      };

      const currentMatches = registration.roomPreferenceMatches ?? {};
      const hasChanged = !areRoomPreferenceMatchesEqual(currentMatches, nextMatches);

      for (const match of Object.values(nextMatches)) {
        if (!match) {
          continue;
        }

        processedRequestsCount += 1;

        if (match.status === "matched" && match.matchedRegistrationId) {
          matchedCount += 1;
        } else {
          unmatchedCount += 1;
        }
      }

      if (!hasChanged) {
        continue;
      }

      updatedRegistrationsCount += 1;
      batch.update(getRegistrationReference(stakeId, eventId, registration.id), {
        roomPreferenceMatches: nextMatches,
        updatedAt: timestamp,
      });
    }

    if (updatedRegistrationsCount > 0) {
      await batch.commit();
    }

    return {
      updatedRegistrationsCount,
      matchedCount,
      unmatchedCount,
      processedRequestsCount,
    };
  },
};
