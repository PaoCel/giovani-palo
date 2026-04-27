import type { OrganizationProfile, OrganizationRegistrationDefaults } from "@/types";

import { stakesService } from "@/services/firestore/stakesService";
import { unitsService } from "@/services/firestore/unitsService";
import { slugify } from "@/utils/slugify";

const defaultEnabledStandardFields: OrganizationRegistrationDefaults["enabledStandardFields"] = [
  "birthDate",
  "genderRoleCategory",
  "phone",
  "unitName",
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeUnits(values: string[]) {
  const seen = new Set<string>();

  return values.reduce<string[]>((accumulator, item) => {
    const normalized = item.trim();

    if (!normalized) {
      return accumulator;
    }

    const key = normalized.toLocaleLowerCase("it-IT");

    if (seen.has(key)) {
      return accumulator;
    }

    seen.add(key);
    accumulator.push(normalized);
    return accumulator;
  }, []);
}

function getDefaultProfile(stakeName = "Palo di Roma Est"): OrganizationProfile {
  return {
    id: stakesService.defaultStakeId,
    stakeId: stakesService.defaultStakeId,
    stakeName,
    stakeSlug: slugify(stakeName) || stakesService.defaultStakeId,
    isActive: true,
    publicHomeTitle: "Attività giovanili",
    publicHomeSubtitle:
      "Una piattaforma semplice per vedere le attività, iscriversi e ridurre il coordinamento manuale.",
    accountHelpText:
      "Con un account puoi ritrovare le tue iscrizioni e compilare più velocemente le prossime attività.",
    codeRecoveryHelpText:
      "Se ti iscrivi senza account, conserva il codice di recupero e il PDF riepilogativo.",
    units: [],
    youngMenPresident: "",
    youngMenCounselors: [],
    youngWomenPresident: "",
    youngWomenCounselors: [],
    supportContact: "",
    guestRegistrationHint:
      "Se non fai il login, i tuoi dati verranno salvati solo per questa attività.",
    minorConsentExampleImageUrl: "",
    minorConsentExampleImagePath: "",
    registrationDefaults: {
      allowGuestRegistration: true,
      requireLoginForEdit: true,
      enabledStandardFields: defaultEnabledStandardFields,
      fieldOverrides: {},
    },
    updatedAt: nowIso(),
  };
}

async function resolveStakeId(stakeId?: string) {
  if (stakeId) {
    return stakeId;
  }

  const defaultStake = await stakesService.getDefaultStake();
  return defaultStake?.id || stakesService.defaultStakeId;
}

export function getDefaultOrganizationProfile(stakeName?: string) {
  return getDefaultProfile(stakeName);
}

export const organizationService = {
  async getProfile(stakeId?: string) {
    const resolvedStakeId = await resolveStakeId(stakeId);
    const [stake, legacy, units] = await Promise.all([
      stakesService.getStakeProfileById(resolvedStakeId),
      stakesService.getLegacyProfile(),
      unitsService.listUnits(resolvedStakeId),
    ]);

    if (!stake && legacy) {
      return {
        ...legacy.profile,
        stakeId: legacy.profile.stakeId || legacy.profile.id,
        units: legacy.units,
      };
    }

    if (!stake) {
      return getDefaultProfile();
    }

    const stakeUnits = units.map((unit) => unit.name);
    const legacyUnits =
      legacy && legacy.profile.id === stake.id ? legacy.units : [];

    return {
      id: stake.id,
      stakeId: stake.id,
      stakeName: stake.name,
      stakeSlug: stake.slug,
      isActive: stake.isActive,
      publicHomeTitle:
        stake.publicHomeTitle || legacy?.profile.publicHomeTitle || "Attività giovanili",
      publicHomeSubtitle:
        stake.publicHomeSubtitle ||
        legacy?.profile.publicHomeSubtitle ||
        getDefaultProfile(stake.name).publicHomeSubtitle,
      accountHelpText:
        stake.accountHelpText ||
        legacy?.profile.accountHelpText ||
        getDefaultProfile(stake.name).accountHelpText,
      codeRecoveryHelpText:
        stake.codeRecoveryHelpText ||
        legacy?.profile.codeRecoveryHelpText ||
        getDefaultProfile(stake.name).codeRecoveryHelpText,
      units: stakeUnits.length > 0 ? stakeUnits : legacyUnits,
      youngMenPresident: stake.youngMenPresident || legacy?.profile.youngMenPresident || "",
      youngMenCounselors: stake.youngMenCounselors || legacy?.profile.youngMenCounselors || [],
      youngWomenPresident:
        stake.youngWomenPresident || legacy?.profile.youngWomenPresident || "",
      youngWomenCounselors:
        stake.youngWomenCounselors || legacy?.profile.youngWomenCounselors || [],
      supportContact: stake.supportContact || legacy?.profile.supportContact || "",
      guestRegistrationHint:
        stake.guestRegistrationHint ||
        legacy?.profile.guestRegistrationHint ||
        getDefaultProfile(stake.name).guestRegistrationHint,
      minorConsentExampleImageUrl:
        stake.minorConsentExampleImageUrl ||
        legacy?.profile.minorConsentExampleImageUrl ||
        "",
      minorConsentExampleImagePath:
        stake.minorConsentExampleImagePath ||
        legacy?.profile.minorConsentExampleImagePath ||
        "",
      registrationDefaults:
        stake.registrationDefaults ||
        legacy?.profile.registrationDefaults ||
        getDefaultProfile(stake.name).registrationDefaults,
      updatedAt: stake.updatedAt,
    };
  },

  async saveProfile(
    stakeIdOrInput:
      | string
      | (Omit<
          OrganizationProfile,
          "id" | "stakeId" | "stakeSlug" | "isActive" | "updatedAt" | "units"
        > & {
          units: string[];
        }),
    maybeInput?: Omit<
      OrganizationProfile,
      "id" | "stakeId" | "stakeSlug" | "isActive" | "updatedAt" | "units"
    > & {
      units: string[];
    },
  ) {
    const input = typeof stakeIdOrInput === "string" ? maybeInput : stakeIdOrInput;

    if (!input) {
      throw new Error("Profilo organizzazione non valido.");
    }

    const resolvedStakeId = await resolveStakeId(
      typeof stakeIdOrInput === "string" ? stakeIdOrInput : undefined,
    );
    const normalizedUnits = normalizeUnits(input.units);
    const existingUnits = await unitsService.listUnits(resolvedStakeId, {
      includeInactive: true,
    });

    await stakesService.upsertStake(resolvedStakeId, {
      stakeName: input.stakeName,
      stakeSlug: undefined,
      isActive: true,
      publicHomeTitle: input.publicHomeTitle,
      publicHomeSubtitle: input.publicHomeSubtitle,
      accountHelpText: input.accountHelpText,
      codeRecoveryHelpText: input.codeRecoveryHelpText,
      supportContact: input.supportContact,
      guestRegistrationHint: input.guestRegistrationHint,
      minorConsentExampleImageUrl: input.minorConsentExampleImageUrl,
      minorConsentExampleImagePath: input.minorConsentExampleImagePath,
      youngMenPresident: input.youngMenPresident,
      youngMenCounselors: input.youngMenCounselors,
      youngWomenPresident: input.youngWomenPresident,
      youngWomenCounselors: input.youngWomenCounselors,
      registrationDefaults: input.registrationDefaults,
    });

    const matchedUnitIds = new Set<string>();

    for (const unitName of normalizedUnits) {
      const existingUnit = existingUnits.find(
        (unit) => unit.name.toLocaleLowerCase("it-IT") === unitName.toLocaleLowerCase("it-IT"),
      );
      const savedUnit = await unitsService.createOrUpdateUnit(resolvedStakeId, {
        id: existingUnit?.id,
        name: unitName,
        type: existingUnit?.type,
      });
      matchedUnitIds.add(savedUnit.id);
    }

    for (const existingUnit of existingUnits) {
      if (matchedUnitIds.has(existingUnit.id) || !existingUnit.isActive) {
        continue;
      }

      await unitsService.deactivateUnit(resolvedStakeId, existingUnit.id);
    }

    return this.getProfile(resolvedStakeId);
  },

  async getManagedUnits(stakeId?: string) {
    const profile = await this.getProfile(stakeId);
    return profile.units;
  },

  async assertManagedUnit(
    stakeIdOrUnitName: string,
    unitSelector?: string | { unitId?: string; unitName?: string },
  ) {
    const calledWithStakeFirst = typeof unitSelector !== "undefined";
    const stakeId = calledWithStakeFirst
      ? stakeIdOrUnitName
      : await resolveStakeId(undefined);
    const selector = calledWithStakeFirst ? unitSelector : stakeIdOrUnitName;
    const units = await unitsService.listUnits(stakeId);

    if (units.length === 0) {
      throw new Error(
        "L'admin deve configurare almeno un'unità prima di completare il flusso.",
      );
    }

    if (typeof selector === "string") {
      const normalizedUnitName = selector.trim();

      if (!normalizedUnitName) {
        return null;
      }

      const matchedUnit = units.find(
        (unit) =>
          unit.name.toLocaleLowerCase("it-IT") ===
            normalizedUnitName.toLocaleLowerCase("it-IT") && unit.isActive,
      );

      if (!matchedUnit) {
        throw new Error("Seleziona un'unità valida dalla lista configurata dall'admin.");
      }

      return matchedUnit;
    }

    if (!selector?.unitId && !selector?.unitName) {
      return null;
    }

    const matchedUnit = units.find((unit) => {
      if (selector.unitId) {
        return unit.id === selector.unitId && unit.isActive;
      }

      return (
        unit.name.toLocaleLowerCase("it-IT") ===
          String(selector.unitName).trim().toLocaleLowerCase("it-IT") &&
        unit.isActive
      );
    });

    if (!matchedUnit) {
      throw new Error("Seleziona un'unità valida dalla lista configurata dall'admin.");
    }

    return matchedUnit;
  },
};
