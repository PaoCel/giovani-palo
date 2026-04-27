import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type {
  CustomField,
  EventFormConfig,
  OrganizationRegistrationDefaults,
  StandardFieldKey,
} from "@/types";
import {
  type StandardFieldDefinition,
  canonicalizeStandardFieldKey,
  getStandardFieldDefinition,
  normalizeStandardFieldKeys,
} from "@/utils/formFields";

const defaultEnabledStandardFields: StandardFieldKey[] = [
  "birthDate",
  "genderRoleCategory",
  "phone",
  "unitName",
];

function sanitizeCustomField(field: Partial<CustomField>, index: number): CustomField {
  return {
    id: field.id || `custom-field-${index + 1}`,
    key: field.key || `customField${index + 1}`,
    label: field.label || `Campo ${index + 1}`,
    type:
      field.type === "longText" ||
      field.type === "select" ||
      field.type === "checkbox"
        ? field.type
        : "shortText",
    required: Boolean(field.required),
    helpText: field.helpText || "",
    options: Array.isArray(field.options)
      ? field.options.filter((option): option is string => typeof option === "string")
      : [],
    order: typeof field.order === "number" ? field.order : index,
    presetOrigin:
      field.presetOrigin === "standard" || field.presetOrigin === "template"
        ? field.presetOrigin
        : "custom",
  };
}

function getSettingsReference(stakeId: string, eventId: string) {
  return doc(db, "stakes", stakeId, "activities", eventId, "config", "form");
}

function getFieldsCollection(stakeId: string, eventId: string) {
  return collection(db, "stakes", stakeId, "activities", eventId, "formFields");
}

export function getDefaultEventFormConfig(
  defaults?: Partial<OrganizationRegistrationDefaults>,
): EventFormConfig {
  return {
    allowGuestRegistration: defaults?.allowGuestRegistration ?? true,
    requireLoginForEdit: defaults?.requireLoginForEdit ?? true,
    enabledStandardFields:
      defaults?.enabledStandardFields?.length
        ? normalizeStandardFieldKeys(defaults.enabledStandardFields)
        : defaultEnabledStandardFields,
    customFields: [],
  };
}

function mapFormConfig(
  settings: Record<string, unknown> | null,
  fields: Array<Record<string, unknown> & { id: string }>,
) {
  const normalizedFields = fields
    .map((field, index) =>
      sanitizeCustomField(
        {
          ...field,
          id: field.id,
        },
        index,
      ),
    )
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const enabledStandardFields = normalizedFields
    .filter((field) => field.presetOrigin === "standard")
    .map((field) => canonicalizeStandardFieldKey(field.key as StandardFieldKey));

  return {
    allowGuestRegistration: settings?.allowGuestRegistration !== false,
    requireLoginForEdit:
      typeof settings?.requireLoginForEdit === "boolean"
        ? settings.requireLoginForEdit
        : true,
    enabledStandardFields:
      enabledStandardFields.length > 0
        ? normalizeStandardFieldKeys(enabledStandardFields)
        : defaultEnabledStandardFields,
    customFields: normalizedFields.filter((field) => field.presetOrigin !== "standard"),
  };
}

export const eventFormsService = {
  async getFormConfig(stakeId: string, eventId: string): Promise<EventFormConfig> {
    const [settingsSnapshot, fieldsSnapshot] = await Promise.all([
      getDoc(getSettingsReference(stakeId, eventId)),
      getDocs(getFieldsCollection(stakeId, eventId)),
    ]);

    if (!settingsSnapshot.exists() && fieldsSnapshot.empty && stakeId === "roma-est") {
      const legacySnapshot = await getDoc(doc(db, "events", eventId, "config", "form"));

      if (legacySnapshot.exists()) {
        const data = legacySnapshot.data();
        return {
          allowGuestRegistration: Boolean(data.allowGuestRegistration),
          requireLoginForEdit:
            typeof data.requireLoginForEdit === "boolean"
              ? data.requireLoginForEdit
              : true,
          enabledStandardFields: Array.isArray(data.enabledStandardFields)
            ? normalizeStandardFieldKeys(
                data.enabledStandardFields.filter(
                  (value): value is StandardFieldKey => typeof value === "string",
                ),
              )
            : defaultEnabledStandardFields,
          customFields: Array.isArray(data.customFields)
            ? data.customFields.map((field, index) =>
                sanitizeCustomField(field as Partial<CustomField>, index),
              )
            : [],
        };
      }
    }

    return mapFormConfig(
      settingsSnapshot.exists() ? (settingsSnapshot.data() as Record<string, unknown>) : null,
      fieldsSnapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Record<string, unknown>),
      })),
    );
  },

  async saveFormConfig(
    stakeId: string,
    eventId: string,
    formConfig: EventFormConfig,
    standardFieldDefinitions?: StandardFieldDefinition[],
  ) {
    const normalizedConfig: EventFormConfig = {
      allowGuestRegistration: formConfig.allowGuestRegistration,
      requireLoginForEdit: formConfig.requireLoginForEdit,
      enabledStandardFields: normalizeStandardFieldKeys(formConfig.enabledStandardFields),
      customFields: formConfig.customFields.map((field, index) =>
        sanitizeCustomField(field, index),
      ),
    };
    const settingsReference = getSettingsReference(stakeId, eventId);
    const fieldsCollection = getFieldsCollection(stakeId, eventId);
    const existingFields = await getDocs(fieldsCollection);
    const nextFieldIds = new Set<string>();
    const standardFields = normalizedConfig.enabledStandardFields.map((fieldKey, index) => {
      const definition =
        standardFieldDefinitions?.find((field) => field.key === fieldKey) ??
        getStandardFieldDefinition(fieldKey);

      return {
        id: fieldKey,
        key: fieldKey,
        label: definition?.label ?? fieldKey,
        type:
          definition?.inputType === "textarea"
            ? "longText"
            : definition?.inputType === "select"
              ? "select"
              : definition?.inputType === "checkbox"
                ? "checkbox"
                : "shortText",
        required:
          fieldKey === "birthDate" ||
          fieldKey === "genderRoleCategory" ||
          fieldKey === "unitName",
        order: index,
        presetOrigin: "standard" as const,
        options: definition?.options ?? [],
        helpText: definition?.helpText ?? "",
      };
    });
    const customFields = normalizedConfig.customFields.map((field, index) => ({
      ...field,
      order: standardFields.length + index,
      presetOrigin: field.presetOrigin === "template" ? "template" : "custom",
    }));
    const allFields = [...standardFields, ...customFields];

    await setDoc(settingsReference, {
      allowGuestRegistration: normalizedConfig.allowGuestRegistration,
      requireLoginForEdit: normalizedConfig.requireLoginForEdit,
    });

    for (const field of allFields) {
      nextFieldIds.add(field.id);
      await setDoc(doc(fieldsCollection, field.id), field);
    }

    for (const existingField of existingFields.docs) {
      if (nextFieldIds.has(existingField.id)) {
        continue;
      }

      await deleteDoc(existingField.ref);
    }

    return normalizedConfig;
  },
};
