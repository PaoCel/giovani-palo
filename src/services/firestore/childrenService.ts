import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type { ChildProfile, GenderRoleCategory } from "@/types";

function nowIso() {
  return new Date().toISOString();
}

function getChildrenCollection(parentUid: string) {
  return collection(db, "users", parentUid, "children");
}

function getChildReference(parentUid: string, childId: string) {
  return doc(db, "users", parentUid, "children", childId);
}

function mapChild(id: string, data: Record<string, unknown>): ChildProfile {
  return {
    id,
    firstName: typeof data.firstName === "string" ? data.firstName : "",
    lastName: typeof data.lastName === "string" ? data.lastName : "",
    fullName: typeof data.fullName === "string" ? data.fullName : "",
    birthDate: typeof data.birthDate === "string" ? data.birthDate : "",
    genderRoleCategory:
      data.genderRoleCategory === "giovane_uomo" || data.genderRoleCategory === "giovane_donna"
        ? data.genderRoleCategory
        : "",
    unitId: typeof data.unitId === "string" ? data.unitId : "",
    unitName: typeof data.unitName === "string" ? data.unitName : "",
    stakeId: typeof data.stakeId === "string" ? data.stakeId : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
  };
}

export interface ChildWriteInput {
  firstName: string;
  lastName: string;
  birthDate: string;
  genderRoleCategory: GenderRoleCategory | "";
  unitId: string;
  unitName: string;
  stakeId: string;
}

function buildPayload(input: ChildWriteInput) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();

  if (!firstName) {
    throw new Error("Il nome del ragazzo/a è obbligatorio.");
  }

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    birthDate: input.birthDate,
    genderRoleCategory: input.genderRoleCategory,
    unitId: input.unitId,
    unitName: input.unitName.trim(),
    stakeId: input.stakeId,
  };
}

export const childrenService = {
  async listChildren(parentUid: string): Promise<ChildProfile[]> {
    if (!parentUid) {
      return [];
    }

    const snapshot = await getDocs(getChildrenCollection(parentUid));

    return snapshot.docs
      .map((item) => mapChild(item.id, item.data()))
      .sort((left, right) => left.fullName.localeCompare(right.fullName, "it-IT"));
  },

  async getChild(parentUid: string, childId: string): Promise<ChildProfile | null> {
    const snapshot = await getDoc(getChildReference(parentUid, childId));
    return snapshot.exists() ? mapChild(snapshot.id, snapshot.data()) : null;
  },

  async createChild(parentUid: string, input: ChildWriteInput): Promise<ChildProfile> {
    const reference = doc(getChildrenCollection(parentUid));
    const timestamp = nowIso();
    const payload = {
      ...buildPayload(input),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await setDoc(reference, payload);

    return { id: reference.id, ...payload };
  },

  async updateChild(
    parentUid: string,
    childId: string,
    input: ChildWriteInput,
  ): Promise<void> {
    await updateDoc(getChildReference(parentUid, childId), {
      ...buildPayload(input),
      updatedAt: nowIso(),
    });
  },

  async deleteChild(parentUid: string, childId: string): Promise<void> {
    await deleteDoc(getChildReference(parentUid, childId));
  },
};
