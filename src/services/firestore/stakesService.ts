import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type {
  OrganizationRegistrationDefaults,
  OrganizationProfile,
  StakeSummary,
  StandardFieldKey,
  StandardFieldOverrides,
} from "@/types";
import { normalizeStandardFieldKeys } from "@/utils/formFields";
import { slugify } from "@/utils/slugify";

const DEFAULT_STAKE_ID = "roma-est";
const allowedStandardFieldKeys = new Set<StandardFieldKey>([
  "birthDate",
  "genderRoleCategory",
  "phone",
  "unitName",
  "city",
  "transportMode",
  "roomPreference1Name",
  "roomPreference2Name",
  "roomNotes",
  "allergies",
  "dietaryNotes",
  "medicalNotes",
  "photoInternalConsent",
  "photoPublicConsent",
  "parentConfirmed",
]);
const defaultEnabledStandardFields: StandardFieldKey[] = [
  "birthDate",
  "genderRoleCategory",
  "phone",
  "unitName",
];

interface StakeProfileDocument extends StakeSummary {
  publicHomeTitle: string;
  publicHomeSubtitle: string;
  accountHelpText: string;
  codeRecoveryHelpText: string;
  supportContact: string;
  guestRegistrationHint: string;
  minorConsentExampleImageUrl?: string;
  minorConsentExampleImagePath?: string;
  youngMenPresident: string;
  youngMenCounselors: string[];
  youngWomenPresident: string;
  youngWomenCounselors: string[];
  registrationDefaults: OrganizationRegistrationDefaults;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();

  return value.reduce<string[]>((accumulator, item) => {
    if (typeof item !== "string") {
      return accumulator;
    }

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

function sanitizeEnabledStandardFields(value: unknown) {
  if (!Array.isArray(value)) {
    return [...defaultEnabledStandardFields];
  }

  const enabledFields = value.reduce<StandardFieldKey[]>((accumulator, item) => {
    if (typeof item !== "string") {
      return accumulator;
    }

    const normalizedKey =
      item === "youthGroup" ? "genderRoleCategory" : (item as StandardFieldKey);

    if (!allowedStandardFieldKeys.has(normalizedKey)) {
      return accumulator;
    }

    accumulator.push(normalizedKey);
    return accumulator;
  }, []);

  return enabledFields.length > 0
    ? normalizeStandardFieldKeys(enabledFields)
    : [...defaultEnabledStandardFields];
}

function getDefaultRegistrationDefaults(): OrganizationRegistrationDefaults {
  return {
    allowGuestRegistration: true,
    requireLoginForEdit: true,
    enabledStandardFields: [...defaultEnabledStandardFields],
    fieldOverrides: {},
  };
}

function normalizeFieldOverrides(value: unknown): StandardFieldOverrides {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<StandardFieldOverrides>(
    (accumulator, [key, entry]) => {
      if (!allowedStandardFieldKeys.has(key as StandardFieldKey)) {
        return accumulator;
      }

      if (!entry || typeof entry !== "object") {
        return accumulator;
      }

      const data = entry as Record<string, unknown>;
      const options = Array.isArray(data.options)
        ? data.options
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : null;

      // Firestore non accetta undefined: ometto le chiavi vuote anziche'
      // settarle a undefined (causava errore "Unsupported field value: undefined").
      const override: StandardFieldOverrides[StandardFieldKey] = {};
      if (typeof data.label === "string" && data.label.trim()) {
        override.label = data.label.trim();
      }
      if (typeof data.helpText === "string" && data.helpText.trim()) {
        override.helpText = data.helpText.trim();
      }
      if (options && options.length > 0) {
        override.options = options;
      }

      accumulator[key as StandardFieldKey] = override;
      return accumulator;
    },
    {},
  );
}

function mapRegistrationDefaults(value: unknown): OrganizationRegistrationDefaults {
  const fallback = getDefaultRegistrationDefaults();

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const data = value as Record<string, unknown>;

  return {
    allowGuestRegistration:
      typeof data.allowGuestRegistration === "boolean"
        ? data.allowGuestRegistration
        : fallback.allowGuestRegistration,
    requireLoginForEdit:
      typeof data.requireLoginForEdit === "boolean"
        ? data.requireLoginForEdit
        : fallback.requireLoginForEdit,
    enabledStandardFields: sanitizeEnabledStandardFields(data.enabledStandardFields),
    fieldOverrides: normalizeFieldOverrides(data.fieldOverrides),
  };
}

function buildDefaultStakeDocument(name = "Palo di Roma Est") {
  const timestamp = nowIso();

  return {
    name,
    slug: slugify(name) || DEFAULT_STAKE_ID,
    isActive: true,
    publicHomeTitle: "Attività giovanili",
    publicHomeSubtitle:
      "Informazioni chiare, iscrizioni veloci e una gestione più ordinata delle attività del palo.",
    accountHelpText:
      "Crea un account per salvare i tuoi dati principali e ritrovare più facilmente le iscrizioni future.",
    codeRecoveryHelpText:
      "Se ti iscrivi senza account, conserva il codice di recupero e il PDF riepilogativo.",
    supportContact: "",
    guestRegistrationHint:
      "Se non fai il login, i tuoi dati verranno salvati solo per questa attività.",
    minorConsentExampleImageUrl: "",
    minorConsentExampleImagePath: "",
    youngMenPresident: "",
    youngMenCounselors: [],
    youngWomenPresident: "",
    youngWomenCounselors: [],
    registrationDefaults: getDefaultRegistrationDefaults(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function mapStakeSummary(id: string, data: Record<string, unknown>): StakeSummary {
  const name =
    typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Palo di Roma Est";
  const slug =
    typeof data.slug === "string" && data.slug.trim()
      ? data.slug.trim()
      : slugify(name) || DEFAULT_STAKE_ID;

  return {
    id,
    name,
    slug,
    isActive: data.isActive !== false,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
  };
}

function mapStakeProfileDocument(id: string, data: Record<string, unknown>): StakeProfileDocument {
  const summary = mapStakeSummary(id, data);
  const defaults = buildDefaultStakeDocument(summary.name);

  return {
    ...summary,
    publicHomeTitle:
      typeof data.publicHomeTitle === "string" && data.publicHomeTitle.trim()
        ? data.publicHomeTitle.trim()
        : defaults.publicHomeTitle,
    publicHomeSubtitle:
      typeof data.publicHomeSubtitle === "string" && data.publicHomeSubtitle.trim()
        ? data.publicHomeSubtitle.trim()
        : defaults.publicHomeSubtitle,
    accountHelpText:
      typeof data.accountHelpText === "string" && data.accountHelpText.trim()
        ? data.accountHelpText.trim()
        : defaults.accountHelpText,
    codeRecoveryHelpText:
      typeof data.codeRecoveryHelpText === "string" && data.codeRecoveryHelpText.trim()
        ? data.codeRecoveryHelpText.trim()
        : defaults.codeRecoveryHelpText,
    supportContact:
      typeof data.supportContact === "string" ? data.supportContact.trim() : defaults.supportContact,
    guestRegistrationHint:
      typeof data.guestRegistrationHint === "string" && data.guestRegistrationHint.trim()
        ? data.guestRegistrationHint.trim()
        : defaults.guestRegistrationHint,
    minorConsentExampleImageUrl:
      typeof data.minorConsentExampleImageUrl === "string"
        ? data.minorConsentExampleImageUrl.trim()
        : "",
    minorConsentExampleImagePath:
      typeof data.minorConsentExampleImagePath === "string"
        ? data.minorConsentExampleImagePath.trim()
        : "",
    youngMenPresident:
      typeof data.youngMenPresident === "string" ? data.youngMenPresident.trim() : "",
    youngMenCounselors: normalizeStringList(data.youngMenCounselors),
    youngWomenPresident:
      typeof data.youngWomenPresident === "string" ? data.youngWomenPresident.trim() : "",
    youngWomenCounselors: normalizeStringList(data.youngWomenCounselors),
    registrationDefaults: mapRegistrationDefaults(data.registrationDefaults),
  };
}

function mapLegacyOrganizationProfile(
  data: Record<string, unknown>,
): Omit<OrganizationProfile, "units"> {
  const name =
    typeof data.stakeName === "string" && data.stakeName.trim()
      ? data.stakeName.trim()
      : "Palo di Roma Est";

  return {
    id: DEFAULT_STAKE_ID,
    stakeId: DEFAULT_STAKE_ID,
    stakeName: name,
    stakeSlug: slugify(name) || DEFAULT_STAKE_ID,
    isActive: true,
    publicHomeTitle:
      typeof data.publicHomeTitle === "string" && data.publicHomeTitle.trim()
        ? data.publicHomeTitle.trim()
        : "Attività giovanili",
    publicHomeSubtitle:
      typeof data.publicHomeSubtitle === "string" && data.publicHomeSubtitle.trim()
        ? data.publicHomeSubtitle.trim()
        : buildDefaultStakeDocument(name).publicHomeSubtitle,
    accountHelpText:
      typeof data.accountHelpText === "string" && data.accountHelpText.trim()
        ? data.accountHelpText.trim()
        : buildDefaultStakeDocument(name).accountHelpText,
    codeRecoveryHelpText:
      typeof data.codeRecoveryHelpText === "string" && data.codeRecoveryHelpText.trim()
        ? data.codeRecoveryHelpText.trim()
        : buildDefaultStakeDocument(name).codeRecoveryHelpText,
    supportContact: typeof data.supportContact === "string" ? data.supportContact.trim() : "",
    guestRegistrationHint:
      typeof data.guestRegistrationHint === "string" && data.guestRegistrationHint.trim()
        ? data.guestRegistrationHint.trim()
        : buildDefaultStakeDocument(name).guestRegistrationHint,
    minorConsentExampleImageUrl:
      typeof data.minorConsentExampleImageUrl === "string"
        ? data.minorConsentExampleImageUrl.trim()
        : "",
    minorConsentExampleImagePath:
      typeof data.minorConsentExampleImagePath === "string"
        ? data.minorConsentExampleImagePath.trim()
        : "",
    youngMenPresident:
      typeof data.youngMenPresident === "string" ? data.youngMenPresident.trim() : "",
    youngMenCounselors: normalizeStringList(data.youngMenCounselors),
    youngWomenPresident:
      typeof data.youngWomenPresident === "string" ? data.youngWomenPresident.trim() : "",
    youngWomenCounselors: normalizeStringList(data.youngWomenCounselors),
    registrationDefaults: mapRegistrationDefaults(data.registrationDefaults),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
  };
}

async function getLegacyOrganizationProfile() {
  const snapshot = await getDoc(doc(db, "settings", "organization"));

  if (!snapshot.exists()) {
    return null;
  }

  const data = (snapshot.data() ?? {}) as Record<string, unknown>;

  return {
    profile: mapLegacyOrganizationProfile(data),
    units: normalizeStringList(data.units),
  };
}

export const stakesService = {
  defaultStakeId: DEFAULT_STAKE_ID,

  async listActiveStakes() {
    const snapshot = await getDocs(
      query(collection(db, "stakes"), where("isActive", "==", true)),
    );

    if (!snapshot.empty) {
      return snapshot.docs
        .map((item) => mapStakeSummary(item.id, item.data()))
        .sort((left, right) => left.name.localeCompare(right.name, "it-IT"));
    }

    const legacy = await getLegacyOrganizationProfile();

    if (legacy) {
      return [
        {
          id: legacy.profile.id,
          name: legacy.profile.stakeName,
          slug: legacy.profile.stakeSlug,
          isActive: true,
          createdAt: nowIso(),
          updatedAt: legacy.profile.updatedAt,
        },
      ];
    }

    const fallback = buildDefaultStakeDocument();

    return [
      {
        id: DEFAULT_STAKE_ID,
        name: fallback.name,
        slug: fallback.slug,
        isActive: true,
        createdAt: fallback.createdAt,
        updatedAt: fallback.updatedAt,
      },
    ];
  },

  async getDefaultStake() {
    const stakes = await this.listActiveStakes();
    return stakes[0] ?? null;
  },

  async getDefaultStakeId() {
    const stake = await this.getDefaultStake();
    return stake?.id ?? DEFAULT_STAKE_ID;
  },

  async getStakeById(stakeId: string) {
    if (!stakeId) {
      return this.getDefaultStake();
    }

    const snapshot = await getDoc(doc(db, "stakes", stakeId));

    if (snapshot.exists()) {
      return mapStakeSummary(snapshot.id, snapshot.data());
    }

    const legacy = await getLegacyOrganizationProfile();

    if (legacy && stakeId === legacy.profile.id) {
      return {
        id: legacy.profile.id,
        name: legacy.profile.stakeName,
        slug: legacy.profile.stakeSlug,
        isActive: legacy.profile.isActive,
        createdAt: nowIso(),
        updatedAt: legacy.profile.updatedAt,
      };
    }

    return null;
  },

  async getStakeProfileById(stakeId: string): Promise<StakeProfileDocument | null> {
    if (!stakeId) {
      const defaultStake = await this.getDefaultStake();

      if (!defaultStake) {
        return null;
      }

      return this.getStakeProfileById(defaultStake.id);
    }

    const snapshot = await getDoc(doc(db, "stakes", stakeId));

    if (snapshot.exists()) {
      return mapStakeProfileDocument(snapshot.id, snapshot.data());
    }

    const legacy = await getLegacyOrganizationProfile();

    if (legacy && stakeId === legacy.profile.id) {
      return {
        id: legacy.profile.id,
        name: legacy.profile.stakeName,
        slug: legacy.profile.stakeSlug,
        isActive: legacy.profile.isActive,
        publicHomeTitle: legacy.profile.publicHomeTitle,
        publicHomeSubtitle: legacy.profile.publicHomeSubtitle,
        accountHelpText: legacy.profile.accountHelpText,
        codeRecoveryHelpText: legacy.profile.codeRecoveryHelpText,
        supportContact: legacy.profile.supportContact,
        guestRegistrationHint: legacy.profile.guestRegistrationHint,
        minorConsentExampleImageUrl: legacy.profile.minorConsentExampleImageUrl || "",
        minorConsentExampleImagePath: legacy.profile.minorConsentExampleImagePath || "",
        youngMenPresident: legacy.profile.youngMenPresident,
        youngMenCounselors: legacy.profile.youngMenCounselors,
        youngWomenPresident: legacy.profile.youngWomenPresident,
        youngWomenCounselors: legacy.profile.youngWomenCounselors,
        registrationDefaults: legacy.profile.registrationDefaults,
        createdAt: nowIso(),
        updatedAt: legacy.profile.updatedAt,
      };
    }

    return null;
  },

  async getStakeBySlug(slug: string) {
    const stakes = await this.listActiveStakes();
    return stakes.find((stake) => stake.slug === slug) ?? null;
  },

  async getLegacyProfile() {
    return getLegacyOrganizationProfile();
  },

  async upsertStake(
    stakeId: string,
    input: {
      stakeName: string;
      stakeSlug?: string;
      isActive?: boolean;
      publicHomeTitle: string;
      publicHomeSubtitle: string;
      accountHelpText: string;
      codeRecoveryHelpText: string;
      supportContact: string;
      guestRegistrationHint: string;
      minorConsentExampleImageUrl?: string;
      minorConsentExampleImagePath?: string;
      youngMenPresident: string;
      youngMenCounselors: string[];
      youngWomenPresident: string;
      youngWomenCounselors: string[];
      registrationDefaults: OrganizationRegistrationDefaults;
    },
  ) {
    const reference = doc(db, "stakes", stakeId || DEFAULT_STAKE_ID);
    const existingSnapshot = await getDoc(reference);
    const existingData = existingSnapshot.exists()
      ? (existingSnapshot.data() as Record<string, unknown>)
      : buildDefaultStakeDocument(input.stakeName);
    const createdAt =
      typeof existingData.createdAt === "string" ? existingData.createdAt : nowIso();
    const payload = {
      name: input.stakeName.trim() || "Palo di Roma Est",
      slug: input.stakeSlug?.trim() || slugify(input.stakeName) || DEFAULT_STAKE_ID,
      isActive: input.isActive ?? true,
      publicHomeTitle: input.publicHomeTitle.trim() || "Attività giovanili",
      publicHomeSubtitle: input.publicHomeSubtitle.trim(),
      accountHelpText: input.accountHelpText.trim(),
      codeRecoveryHelpText: input.codeRecoveryHelpText.trim(),
      supportContact: input.supportContact.trim(),
      guestRegistrationHint: input.guestRegistrationHint.trim(),
      minorConsentExampleImageUrl: input.minorConsentExampleImageUrl?.trim() || "",
      minorConsentExampleImagePath: input.minorConsentExampleImagePath?.trim() || "",
      youngMenPresident: input.youngMenPresident.trim(),
      youngMenCounselors: normalizeStringList(input.youngMenCounselors),
      youngWomenPresident: input.youngWomenPresident.trim(),
      youngWomenCounselors: normalizeStringList(input.youngWomenCounselors),
      registrationDefaults: {
        allowGuestRegistration: input.registrationDefaults.allowGuestRegistration,
        requireLoginForEdit: input.registrationDefaults.requireLoginForEdit,
        enabledStandardFields: sanitizeEnabledStandardFields(
          input.registrationDefaults.enabledStandardFields,
        ),
        fieldOverrides: normalizeFieldOverrides(input.registrationDefaults.fieldOverrides),
      },
      createdAt,
      updatedAt: nowIso(),
    };

    await setDoc(reference, payload, { merge: true });
    return mapStakeSummary(reference.id, payload);
  },
};
