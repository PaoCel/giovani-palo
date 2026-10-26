import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  runTransaction,
  type DocumentData,
  type DocumentReference,
  type Transaction,
  type WriteBatch,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import { getDocCacheFirst, getDocsCacheFirst } from "@/services/firestore/cacheFirst";
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
import { LEGACY_DATA_STAKE_ID } from "@/config/app";
import { assertEventRevision, nextEventRevision } from "@/utils/eventCreation";

type FormWriteOptions =
  | { batch: WriteBatch | Transaction; updatedAt: string }
  | { expectedUpdatedAt: string };

interface FormWriter {
  set(reference: DocumentReference, data: DocumentData): unknown;
  delete(reference: DocumentReference): unknown;
  update(reference: DocumentReference, data: DocumentData): unknown;
}

const defaultEnabledStandardFields: StandardFieldKey[] = [
  "birthDate",
  "genderRoleCategory",
  "phone",
  "unitName",
];

function normalizeEnabledStandardFields(keys: readonly StandardFieldKey[]) {
  return normalizeStandardFieldKeys(keys).filter((key) => key !== "parentConfirmed");
}

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
        ? normalizeEnabledStandardFields(defaults.enabledStandardFields)
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
        ? normalizeEnabledStandardFields(enabledStandardFields)
        : defaultEnabledStandardFields,
    customFields: normalizedFields.filter((field) => field.presetOrigin !== "standard"),
  };
}

export const eventFormsService = {
  async getFormConfig(stakeId: string, eventId: string, serverOnly = false): Promise<EventFormConfig> {
    const [settingsSnapshot, fieldsSnapshot] = await Promise.all([
      serverOnly ? getDocFromServer(getSettingsReference(stakeId, eventId)) : getDocCacheFirst(getSettingsReference(stakeId, eventId)),
      serverOnly ? getDocsFromServer(getFieldsCollection(stakeId, eventId)) : getDocsCacheFirst(getFieldsCollection(stakeId, eventId)),
    ]);

    if (!settingsSnapshot.exists() && fieldsSnapshot.empty && stakeId === LEGACY_DATA_STAKE_ID) {
      const legacyReference = doc(db, "events", eventId, "config", "form");
      const legacySnapshot = serverOnly ? await getDocFromServer(legacyReference) : await getDocCacheFirst(legacyReference);

      if (legacySnapshot.exists()) {
        const data = legacySnapshot.data();
        return {
          allowGuestRegistration: Boolean(data.allowGuestRegistration),
          requireLoginForEdit:
            typeof data.requireLoginForEdit === "boolean"
              ? data.requireLoginForEdit
              : true,
          enabledStandardFields: Array.isArray(data.enabledStandardFields)
            ? normalizeEnabledStandardFields(
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
    options?: FormWriteOptions,
  ) {
    const normalizedConfig: EventFormConfig = {
      allowGuestRegistration: formConfig.allowGuestRegistration,
      requireLoginForEdit: formConfig.requireLoginForEdit,
      enabledStandardFields: normalizeEnabledStandardFields(formConfig.enabledStandardFields),
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

    const activityReference = doc(db, "stakes", stakeId, "activities", eventId);
    function queueWrites(writes: FormWriter, updatedAt: string) {
      writes.set(settingsReference, {
        allowGuestRegistration: normalizedConfig.allowGuestRegistration,
        requireLoginForEdit: normalizedConfig.requireLoginForEdit,
      });

      for (const field of allFields) {
        nextFieldIds.add(field.id);
        writes.set(doc(fieldsCollection, field.id), field);
      }

      for (const existingField of existingFields.docs) {
        if (nextFieldIds.has(existingField.id)) {
          continue;
        }

        writes.delete(existingField.ref);
      }

      // The activity revision also covers its form. A preview made before a
      // second admin changed the form must be reviewed again before publishing.
      writes.update(activityReference, {
        updatedAt,
        allowGuestRegistration: normalizedConfig.allowGuestRegistration,
        requireLoginForEdit: normalizedConfig.requireLoginForEdit,
      });
    }
    if (options && "batch" in options) {
      queueWrites(options.batch, options.updatedAt);
    } else {
      await runTransaction(db, async (transaction) => {
        const activity = await transaction.get(activityReference);
        if (!activity.exists()) throw new Error("Attività non disponibile.");
        const revision = activity.data().updatedAt;
        assertEventRevision(revision, options?.expectedUpdatedAt);
        queueWrites(transaction, nextEventRevision(typeof revision === "string" ? revision : undefined));
      });
    }
    return normalizedConfig;
  },
};
