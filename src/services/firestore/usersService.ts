import type { User } from "firebase/auth";
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
import { organizationService } from "@/services/firestore/organizationService";
import { stakesService } from "@/services/firestore/stakesService";
import type { GenderRoleCategory, UserProfile, UserRole } from "@/types";
import { getGenderRoleCategory, getYouthGroupLabel } from "@/utils/profile";
import { getStoredPublicStakeId } from "@/utils/stakeSelection";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeRole(value: unknown): UserRole {
  if (value === "admin" || value === "super_admin" || value === "unit_leader") {
    return value;
  }

  return "participant";
}

function buildDisplayName(user: User) {
  return user.displayName?.trim() || user.email?.split("@")[0] || "";
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

function mapUserProfile(uid: string, data: Record<string, unknown>): UserProfile {
  const fullName =
    typeof data.fullName === "string" && data.fullName.trim() ? data.fullName.trim() : "";
  const names = splitFullName(fullName);
  const genderRoleCategory = getGenderRoleCategory(
    typeof data.genderRoleCategory === "string"
      ? data.genderRoleCategory
      : typeof data.youthGroup === "string"
        ? data.youthGroup
        : "",
  );

  return {
    id: uid,
    firstName:
      typeof data.firstName === "string" && data.firstName.trim()
        ? data.firstName.trim()
        : names.firstName,
    lastName:
      typeof data.lastName === "string" && data.lastName.trim()
        ? data.lastName.trim()
        : names.lastName,
    fullName,
    email: typeof data.email === "string" ? data.email : null,
    role: sanitizeRole(data.role),
    birthDate: typeof data.birthDate === "string" ? data.birthDate : "",
    genderRoleCategory,
    youthGroup: getYouthGroupLabel(genderRoleCategory),
    unitId: typeof data.unitId === "string" ? data.unitId : "",
    unitName: typeof data.unitName === "string" ? data.unitName : "",
    stakeId: typeof data.stakeId === "string" ? data.stakeId : "",
    stakeSlug: typeof data.stakeSlug === "string" ? data.stakeSlug : "",
    stakeName: typeof data.stakeName === "string" ? data.stakeName : "",
    mustChangePassword: Boolean(data.mustChangePassword),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
    lastLoginAt: typeof data.lastLoginAt === "string" ? data.lastLoginAt : nowIso(),
  };
}

async function getPreferredStake() {
  const storedStakeId = getStoredPublicStakeId();

  if (storedStakeId) {
    const storedStake = await stakesService.getStakeById(storedStakeId);

    if (storedStake) {
      return storedStake;
    }
  }

  return stakesService.getDefaultStake();
}

export const usersService = {
  async ensureProfileForUser(user: User): Promise<UserProfile> {
    if (user.isAnonymous) {
      const preferredStake = await getPreferredStake();

      return {
        id: user.uid,
        firstName: "",
        lastName: "",
        fullName: "",
        email: null,
        role: "participant",
        birthDate: "",
        genderRoleCategory: "",
        youthGroup: "",
        unitId: "",
        unitName: "",
        stakeId: preferredStake?.id || "",
        stakeSlug: preferredStake?.slug || "",
        stakeName: preferredStake?.name || "",
        mustChangePassword: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastLoginAt: nowIso(),
      };
    }

    const reference = doc(db, "users", user.uid);
    const snapshot = await getDoc(reference);
    const lastLoginAt = nowIso();

    if (!snapshot.exists()) {
      const preferredStake = await getPreferredStake();
      const displayName = buildDisplayName(user);
      const names = splitFullName(displayName);
      const payload = {
        firstName: names.firstName,
        lastName: names.lastName,
        fullName: displayName,
        email: user.email,
        role: "participant" as const,
        birthDate: "",
        genderRoleCategory: "",
        unitId: "",
        unitName: "",
        stakeId: preferredStake?.id || "",
        stakeSlug: preferredStake?.slug || "",
        stakeName: preferredStake?.name || "",
        mustChangePassword: false,
        createdAt: lastLoginAt,
        updatedAt: lastLoginAt,
        lastLoginAt,
      };

      // Race con propagazione token Auth dopo signup: a volte il primo
      // setDoc parte prima che le rules vedano request.auth.uid e ritorna
      // permission-denied. Forzo refresh token + retry una volta.
      try {
        await setDoc(reference, payload);
      } catch (firstError) {
        const code =
          firstError && typeof firstError === "object" && "code" in firstError
            ? (firstError as { code?: string }).code
            : null;
        if (code === "permission-denied") {
          try {
            await user.getIdToken(true);
          } catch (tokenError) {
            // Non blocco sul refresh: ritento comunque.
            void tokenError;
          }
          await new Promise((resolve) => setTimeout(resolve, 600));
          await setDoc(reference, payload);
        } else {
          throw firstError;
        }
      }
      return mapUserProfile(user.uid, payload);
    }

    const profile = mapUserProfile(user.uid, snapshot.data());
    const fullName = profile.fullName || buildDisplayName(user);
    const names = splitFullName(fullName);

    await setDoc(
      reference,
      {
        firstName: profile.firstName || names.firstName,
        lastName: profile.lastName || names.lastName,
        fullName,
        email: user.email ?? profile.email,
        role: profile.role,
        birthDate: profile.birthDate,
        genderRoleCategory: profile.genderRoleCategory,
        unitId: profile.unitId,
        unitName: profile.unitName,
        stakeId: profile.stakeId,
        stakeSlug: profile.stakeSlug,
        stakeName: profile.stakeName,
        mustChangePassword: profile.mustChangePassword,
        createdAt: profile.createdAt,
        updatedAt: lastLoginAt,
        lastLoginAt,
      },
      { merge: true },
    );

    return {
      ...profile,
      firstName: profile.firstName || names.firstName,
      lastName: profile.lastName || names.lastName,
      fullName,
      email: user.email ?? profile.email,
      updatedAt: lastLoginAt,
      lastLoginAt,
    };
  },

  async getProfile(uid: string) {
    const snapshot = await getDoc(doc(db, "users", uid));

    if (!snapshot.exists()) {
      return null;
    }

    return mapUserProfile(snapshot.id, snapshot.data());
  },

  async listStakeUsers(stakeId: string) {
    if (!stakeId) {
      return [];
    }

    const snapshot = await getDocs(
      query(collection(db, "users"), where("stakeId", "==", stakeId)),
    );

    return snapshot.docs
      .map((item) => mapUserProfile(item.id, item.data()))
      .sort((left, right) => left.fullName.localeCompare(right.fullName, "it-IT"));
  },

  async listUnitYouth(stakeId: string, unitId: string, unitName = "") {
    const all = await this.listStakeUsers(stakeId);
    const normName = unitName.trim().toLowerCase();
    return all.filter(
      (u) =>
        (u.unitId === unitId || (normName && u.unitName.trim().toLowerCase() === normName)) &&
        (u.genderRoleCategory === "giovane_uomo" || u.genderRoleCategory === "giovane_donna"),
    );
  },

  async assignAdminRole(stakeId: string, uid: string) {
    const reference = doc(db, "users", uid);
    const snapshot = await getDoc(reference);

    if (!snapshot.exists()) {
      throw new Error("Utente non trovato.");
    }

    const profile = mapUserProfile(snapshot.id, snapshot.data());

    if (profile.stakeId !== stakeId) {
      throw new Error("Puoi assegnare admin solo agli utenti del tuo palo.");
    }

    if (profile.role === "super_admin") {
      throw new Error("Il ruolo super admin non può essere modificato da questa schermata.");
    }

    if (profile.role === "admin") {
      return profile;
    }

    await updateDoc(reference, {
      role: "admin",
      updatedAt: nowIso(),
    });

    return this.getProfile(uid);
  },

  async syncProfileFromRegistration(
    uid: string,
    input: {
      fullName: string;
      email: string;
      stakeId: string;
      unitName?: string;
      unitId?: string;
      birthDate?: string;
      genderRoleCategory?: GenderRoleCategory | "";
    },
  ) {
    const reference = doc(db, "users", uid);
    const snapshot = await getDoc(reference);

    if (!snapshot.exists()) {
      return;
    }

    const currentProfile = mapUserProfile(snapshot.id, snapshot.data());

    let resolvedUnit = null;
    if (input.unitName?.trim()) {
      resolvedUnit = await organizationService.assertManagedUnit(input.stakeId, input.unitName);
    }

    const names = splitFullName(input.fullName);
    const stake = await stakesService.getStakeById(input.stakeId);

    await updateDoc(reference, {
      firstName: names.firstName,
      lastName: names.lastName,
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      birthDate: input.birthDate ?? "",
      genderRoleCategory: input.genderRoleCategory ?? "",
      unitId: input.unitId ?? resolvedUnit?.id ?? currentProfile.unitId ?? "",
      unitName: resolvedUnit?.name ?? input.unitName ?? "",
      stakeId: input.stakeId,
      stakeSlug: stake?.slug ?? "",
      updatedAt: nowIso(),
      lastLoginAt: nowIso(),
    });
  },

  async updateProfile(
    uid: string,
    input: {
      firstName: string;
      lastName: string;
      stakeId: string;
      unitName: string;
      birthDate: string;
      genderRoleCategory: GenderRoleCategory;
    },
  ) {
    const reference = doc(db, "users", uid);
    const snapshot = await getDoc(reference);

    if (!snapshot.exists()) {
      throw new Error("Profilo utente non trovato.");
    }

    const currentProfile = mapUserProfile(snapshot.id, snapshot.data());
    const normalizedUnitName = input.unitName.trim();
    let matchedUnit = null;

    if (normalizedUnitName) {
      try {
        matchedUnit = await organizationService.assertManagedUnit(
          input.stakeId,
          normalizedUnitName,
        );
      } catch (error) {
        if (currentProfile.role !== "admin" && currentProfile.role !== "super_admin") {
          throw error;
        }
      }
    }

    const stake = await stakesService.getStakeById(input.stakeId);
    const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();

    await updateDoc(reference, {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      fullName,
      unitId: matchedUnit?.id ?? currentProfile.unitId,
      unitName: normalizedUnitName,
      birthDate: input.birthDate,
      genderRoleCategory: input.genderRoleCategory,
      stakeId: input.stakeId,
      stakeSlug: stake?.slug ?? "",
      updatedAt: nowIso(),
      lastLoginAt: nowIso(),
    });

    return this.getProfile(uid);
  },

  async completeMustChangePassword(uid: string) {
    await updateDoc(doc(db, "users", uid), {
      mustChangePassword: false,
      updatedAt: nowIso(),
    });
  },
};
