import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type { Unit } from "@/types";
import { slugify } from "@/utils/slugify";

function nowIso() {
  return new Date().toISOString();
}

function normalizeUnitName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function mapUnit(stakeId: string, id: string, data: Record<string, unknown>): Unit {
  return {
    id,
    stakeId,
    name: typeof data.name === "string" ? data.name.trim() : "",
    type: data.type === "ramo" ? "ramo" : "rione",
    isActive: data.isActive !== false,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
  };
}

function getUnitCollection(stakeId: string) {
  return collection(db, "stakes", stakeId, "units");
}

export const unitsService = {
  async listUnits(stakeId: string, options?: { includeInactive?: boolean }) {
    if (!stakeId) {
      return [];
    }

    const snapshot = await getDocs(
      options?.includeInactive
        ? getUnitCollection(stakeId)
        : query(getUnitCollection(stakeId), where("isActive", "==", true)),
    );
    const units = snapshot.docs
      .map((item) => mapUnit(stakeId, item.id, item.data()))
      .sort((left, right) => left.name.localeCompare(right.name, "it-IT"));

    if (options?.includeInactive) {
      return units;
    }

    return units;
  },

  async listActiveUnits(stakeId: string) {
    return this.listUnits(stakeId);
  },

  async getUnitById(stakeId: string, unitId: string) {
    const snapshot = await getDoc(doc(db, "stakes", stakeId, "units", unitId));

    if (!snapshot.exists()) {
      return null;
    }

    return mapUnit(stakeId, snapshot.id, snapshot.data() as Record<string, unknown>);
  },

  async createOrUpdateUnit(stakeId: string, input: { id?: string; name: string; type?: Unit["type"] }) {
    const name = normalizeUnitName(input.name);

    if (!name) {
      throw new Error("Inserisci un nome valido per l'unità.");
    }

    const unitId = input.id || slugify(name) || `${Date.now()}`;
    const reference = doc(db, "stakes", stakeId, "units", unitId);
    const snapshot = await getDoc(reference);
    const existing = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : null;
    const payload = {
      name,
      type: input.type ?? (name.toLocaleLowerCase("it-IT").includes("ramo") ? "ramo" : "rione"),
      isActive: true,
      createdAt:
        existing && typeof existing.createdAt === "string" ? existing.createdAt : nowIso(),
      updatedAt: nowIso(),
    };

    await setDoc(reference, payload, { merge: true });
    return mapUnit(stakeId, reference.id, payload);
  },

  async deactivateUnit(stakeId: string, unitId: string) {
    await updateDoc(doc(db, "stakes", stakeId, "units", unitId), {
      isActive: false,
      updatedAt: nowIso(),
    });
  },

  async updateUnit(
    stakeId: string,
    unitId: string,
    input: { name: string; type: Unit["type"]; isActive: boolean },
  ) {
    await updateDoc(doc(db, "stakes", stakeId, "units", unitId), {
      name: normalizeUnitName(input.name),
      type: input.type,
      isActive: input.isActive,
      updatedAt: nowIso(),
    });

    return this.getUnitById(stakeId, unitId);
  },
};
