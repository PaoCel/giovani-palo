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

// Cache modulo del legacy profile (settings/organization): doc readonly di
// fallback storico, invariato per tutta la sessione. Una sola read invece di
// una per pagina pubblica.
let legacyProfileCache: Awaited<
  ReturnType<typeof stakesService.getLegacyProfile>
> | null | undefined;

async function getCachedLegacyProfile() {
  if (legacyProfileCache === undefined) {
    legacyProfileCache = await stakesService.getLegacyProfile();
  }
  return legacyProfileCache;
}

export function getDefaultOrganizationProfile(stakeName?: string) {
  return getDefaultProfile(stakeName);
}

export const organizationService = {
  async getProfile(stakeId?: string) {
    const resolvedStakeId = await resolveStakeId(stakeId);
    // Carico stake + units in parallelo. Il legacy profile (settings/organization)
    // serve solo come fallback storico: lo leggo on demand soltanto se lo stake
    // doc manca o se ha campi vuoti, evitando una read inutile a ogni pagina
    // pubblica.
    const [stake, units] = await Promise.all([
      stakesService.getStakeProfileById(resolvedStakeId),
      unitsService.listUnits(resolvedStakeId),
    ]);

    if (!stake) {
      const legacy = await getCachedLegacyProfile();

      if (legacy) {
        return {
          ...legacy.profile,
          stakeId: legacy.profile.stakeId || legacy.profile.id,
          units: legacy.units,
        };
      }

      return getDefaultProfile();
    }

    const stakeUnits = units.map((unit) => unit.name);
    const fallback = getDefaultProfile(stake.name);
    // Stringhe del doc stake che, se vuote, devono cadere sul legacy. Se tutte
    // valorizzate evito del tutto la read di settings/organization.
    const needsLegacyFallback =
      !stake.publicHomeTitle ||
      !stake.publicHomeSubtitle ||
      !stake.accountHelpText ||
      !stake.codeRecoveryHelpText ||
      !stake.guestRegistrationHint ||
      !stake.youngMenPresident ||
      !stake.youngWomenPresident ||
      !stake.supportContact ||
      !stake.minorConsentExampleImageUrl ||
      !stake.minorConsentExampleImagePath ||
      !stake.registrationDefaults ||
      stakeUnits.length === 0;

    const legacy = needsLegacyFallback ? await getCachedLegacyProfile() : null;
    const legacyProfile = legacy?.profile;
    const legacyUnits = legacy && legacy.profile.id === stake.id ? legacy.units : [];

    return {
      id: stake.id,
      stakeId: stake.id,
      stakeName: stake.name,
      stakeSlug: stake.slug,
      isActive: stake.isActive,
      publicHomeTitle:
        stake.publicHomeTitle || legacyProfile?.publicHomeTitle || "Attività giovanili",
      publicHomeSubtitle:
        stake.publicHomeSubtitle ||
        legacyProfile?.publicHomeSubtitle ||
        fallback.publicHomeSubtitle,
      accountHelpText:
        stake.accountHelpText || legacyProfile?.accountHelpText || fallback.accountHelpText,
      codeRecoveryHelpText:
        stake.codeRecoveryHelpText ||
        legacyProfile?.codeRecoveryHelpText ||
        fallback.codeRecoveryHelpText,
      units: stakeUnits.length > 0 ? stakeUnits : legacyUnits,
      youngMenPresident:
        stake.youngMenPresident || legacyProfile?.youngMenPresident || "",
      youngMenCounselors: stake.youngMenCounselors,
      youngWomenPresident:
        stake.youngWomenPresident || legacyProfile?.youngWomenPresident || "",
      youngWomenCounselors: stake.youngWomenCounselors,
      supportContact: stake.supportContact || legacyProfile?.supportContact || "",
      guestRegistrationHint:
        stake.guestRegistrationHint ||
        legacyProfile?.guestRegistrationHint ||
        fallback.guestRegistrationHint,
      minorConsentExampleImageUrl:
        stake.minorConsentExampleImageUrl ||
        legacyProfile?.minorConsentExampleImageUrl ||
        "",
      minorConsentExampleImagePath:
        stake.minorConsentExampleImagePath ||
        legacyProfile?.minorConsentExampleImagePath ||
        "",
      registrationDefaults:
        stake.registrationDefaults ||
        legacyProfile?.registrationDefaults ||
        fallback.registrationDefaults,
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
