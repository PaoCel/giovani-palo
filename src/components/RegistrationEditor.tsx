import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { ConsentTextModal, type ConsentKind } from "@/components/ConsentTextModal";
import { italianMunicipalityOptions } from "@/config/cityOptions";
import type {
  AuthSession,
  CustomField,
  Event,
  EventFormConfig,
  Registration,
  RegistrationAnswerValue,
  RegistrationAnswers,
  RegistrationWriteInput,
  StandardFieldKey,
} from "@/types";
import {
  type StandardFieldDefinition,
  isRoomRelatedStandardFieldKey,
  normalizeStandardFieldKeys,
  visibleStandardFieldDefinitions,
} from "@/utils/formFields";
import { isMinorBirthDate } from "@/utils/age";
import { getAllowedCategoriesForAudience } from "@/utils/events";
import { getGenderRoleCategory, getYouthGroupLabel } from "@/utils/profile";
import {
  getRoomPreferenceTextFromAnswers,
  hasRoomPreferenceFullName,
  normalizeWhitespace,
} from "@/utils/roomPreferences";

interface RegistrationEditorProps {
  event: Event;
  formConfig: EventFormConfig;
  initialRegistration?: Registration | null;
  session: AuthSession | null;
  unitOptions?: string[];
  standardFieldDefinitions?: StandardFieldDefinition[];
  minorConsentExampleImageUrl?: string;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (input: RegistrationWriteInput) => Promise<void>;
}

interface RegistrationEditorValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthDate: string;
  category: string;
  unitName: string;
  answers: RegistrationAnswers;
  consentSignerName: string;
  parentalConsentAccepted: boolean;
  photoReleaseAccepted: boolean;
  parentFirstName: string;
  parentLastName: string;
  parentEmail: string;
  parentPhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  allergies: string;
  medications: string;
  medicalNotes: string;
  dietaryNotes: string;
}

interface StepDefinition {
  id: "identity" | "profile" | "details" | "parent";
  title: string;
  description: string;
  icon: AppIconName;
}

type FieldErrors = Record<string, string>;

const profileFieldKeys = new Set<StandardFieldKey>([
  "genderRoleCategory",
  "unitName",
  "city",
  "transportMode",
  "roomPreference1Name",
  "roomPreference2Name",
]);
const detailFieldKeys = new Set<StandardFieldKey>([
  "roomNotes",
  "allergies",
  "dietaryNotes",
  "medicalNotes",
  "photoInternalConsent",
  "photoPublicConsent",
  "parentConfirmed",
]);

function getDefaultAnswerValue(field: CustomField) {
  if (field.type === "checkbox") {
    return false;
  }

  return "";
}

function splitFullName(value: string | null | undefined) {
  if (!value) {
    return { firstName: "", lastName: "" };
  }

  const parts = value.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function getInitialValues(
  session: AuthSession | null,
  formConfig: EventFormConfig,
  registration?: Registration | null,
): RegistrationEditorValues {
  const registrationNames = splitFullName(registration?.fullName);
  const sessionNames = splitFullName(session?.profile.fullName);
  const answers: RegistrationAnswers = {};

  for (const standardFieldKey of normalizeStandardFieldKeys(formConfig.enabledStandardFields)) {
    const existingValue = registration?.answers[standardFieldKey];

    if (existingValue !== undefined) {
      answers[standardFieldKey] = existingValue;
      continue;
    }

    if (standardFieldKey === "birthDate") {
      answers[standardFieldKey] = registration?.birthDate || session?.profile.birthDate || "";
      continue;
    }

    if (standardFieldKey === "youthGroup") {
      answers[standardFieldKey] =
        registration?.youthGroup || session?.profile.youthGroup || "";
      continue;
    }

    if (standardFieldKey === "unitName") {
      answers[standardFieldKey] =
        registration?.unitNameSnapshot || session?.profile.unitName || "";
      continue;
    }

    answers[standardFieldKey] = "";
  }

  for (const customField of formConfig.customFields) {
    answers[customField.key] =
      registration?.answers[customField.key] ?? getDefaultAnswerValue(customField);
  }

  return {
    firstName:
      registration?.firstName ||
      registrationNames.firstName ||
      session?.profile.firstName ||
      sessionNames.firstName,
    lastName:
      registration?.lastName ||
      registrationNames.lastName ||
      session?.profile.lastName ||
      sessionNames.lastName,
    email:
      registration?.email ??
      session?.profile.email ??
      session?.firebaseUser.email ??
      "",
    phone: registration?.phone ?? "",
    birthDate: registration?.birthDate || session?.profile.birthDate || "",
    category:
      registration?.genderRoleCategory ||
      session?.profile.genderRoleCategory ||
      "",
    unitName: registration?.unitNameSnapshot || session?.profile.unitName || "",
    answers,
    consentSignerName:
      typeof registration?.answers.parentalConsentSignerName === "string"
        ? registration.answers.parentalConsentSignerName
        : typeof registration?.answers.photoReleaseSignerName === "string"
          ? registration.answers.photoReleaseSignerName
          : "",
    parentalConsentAccepted: registration?.answers.parentalConsentAccepted === true,
    photoReleaseAccepted: registration?.answers.photoReleaseAccepted === true,
    parentFirstName: getStoredParentField(registration, "parentFirstName"),
    parentLastName: getStoredParentField(registration, "parentLastName"),
    parentEmail: getStoredParentField(registration, "parentEmail"),
    parentPhone: getStoredParentField(registration, "parentPhone"),
    emergencyContactName: getStoredParentField(registration, "emergencyContactName"),
    emergencyContactPhone: getStoredParentField(registration, "emergencyContactPhone"),
    emergencyContactRelation: getStoredParentField(registration, "emergencyContactRelation"),
    allergies: getStoredParentField(registration, "allergies"),
    medications: getStoredParentField(registration, "medications"),
    medicalNotes: getStoredParentField(registration, "medicalNotes"),
    dietaryNotes: getStoredParentField(registration, "dietaryNotes"),
  };
}

function getStoredParentField(
  registration: Registration | null | undefined,
  key: string,
): string {
  if (!registration) return "";

  // 1. Cerco nel sub-object parentAuthorization (popolato dopo conferma genitore)
  const parentAuth = registration.parentAuthorization;
  if (parentAuth && typeof parentAuth === "object") {
    const value = (parentAuth as unknown as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }

  // 2. Cerco nei dati raw raccolti al submit (answers.parentAuthorizationRequest)
  const request = (registration.answers as Record<string, unknown>)[
    "parentAuthorizationRequest"
  ];
  if (request && typeof request === "object") {
    const value = (request as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }

  return "";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeUnitName(value: string) {
  return value.trim().toLocaleLowerCase("it-IT");
}

function getUnitOptions(unitOptions: string[], currentValue?: string) {
  const normalizedOptions = unitOptions.filter(Boolean);

  if (
    currentValue &&
    !normalizedOptions.some(
      (option) => normalizeUnitName(option) === normalizeUnitName(currentValue),
    )
  ) {
    return [currentValue, ...normalizedOptions];
  }

  return normalizedOptions;
}

function hasValidationErrors(errors: FieldErrors) {
  return Object.keys(errors).length > 0;
}

function hasFilledText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function RegistrationEditor({
  event,
  formConfig,
  initialRegistration,
  session,
  unitOptions = [],
  standardFieldDefinitions,
  minorConsentExampleImageUrl,
  busy,
  submitLabel,
  onSubmit,
}: RegistrationEditorProps) {
  const cityOptionsListId = useId();
  const [values, setValues] = useState<RegistrationEditorValues>(
    getInitialValues(session, formConfig, initialRegistration),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const sessionNames = useMemo(
    () => splitFullName(session?.profile.fullName),
    [session?.profile.fullName],
  );
  const enabledStandardFields = useMemo(
    () => normalizeStandardFieldKeys(formConfig.enabledStandardFields),
    [formConfig.enabledStandardFields],
  );
  const activeStandardFields = useMemo(
    () =>
      (standardFieldDefinitions?.length
        ? standardFieldDefinitions
        : visibleStandardFieldDefinitions
      ).filter(
        (field) =>
          enabledStandardFields.includes(field.key) &&
          (event.overnight || !isRoomRelatedStandardFieldKey(field.key)),
      ),
    [enabledStandardFields, event.overnight, standardFieldDefinitions],
  );
  const allowedCategoryOptions = useMemo(
    () => getAllowedCategoriesForAudience(event.audience),
    [event.audience],
  );
  const hasConfiguredUnits = unitOptions.length > 0;
  const unitFieldOptions = useMemo(
    () =>
      getUnitOptions(
        unitOptions,
        typeof values.answers.unitName === "string" ? values.answers.unitName : values.unitName,
      ),
    [unitOptions, values.answers.unitName, values.unitName],
  );
  const isMinorParticipant = isMinorBirthDate(values.birthDate);
  const eventRequiresParental = event.requiresParentalConsent && isMinorParticipant;
  const eventRequiresPhotoRelease = event.requiresPhotoRelease;
  const useNewConsentFlow = eventRequiresParental || eventRequiresPhotoRelease;
  const requiresParentConsent =
    !eventRequiresParental &&
    enabledStandardFields.includes("parentConfirmed") &&
    isMinorParticipant;

  // Nuovo flusso magic-link: scatta solo per minori in attivita' rafforzate.
  const eventRequiresParentAuthorization = Boolean(
    event.requiresParentAuthorization && isMinorParticipant,
  );
  const eventRequiresEmergencyContacts = Boolean(event.requiresEmergencyContacts);
  const eventRequiresMedicalNotes = Boolean(event.requiresMedicalNotes);
  const showParentStep = eventRequiresParentAuthorization;
  const [openConsentModal, setOpenConsentModal] = useState<ConsentKind | null>(null);
  const isAuthenticatedAccount = Boolean(session?.isAuthenticated && !session.isAnonymous);
  const shouldAskNameFields = !(
    isAuthenticatedAccount &&
    hasFilledText(session?.profile.firstName || sessionNames.firstName) &&
    hasFilledText(session?.profile.lastName || sessionNames.lastName)
  );
  const shouldAskEmailField =
    isAuthenticatedAccount &&
    !hasFilledText(session?.profile.email || session?.firebaseUser.email || "");
  const shouldHideBirthDateField = isAuthenticatedAccount && hasFilledText(session?.profile.birthDate);
  const shouldHideCategoryField =
    isAuthenticatedAccount && hasFilledText(session?.profile.genderRoleCategory);
  const shouldHideUnitField = isAuthenticatedAccount && hasFilledText(session?.profile.unitName);
  const shouldAskPhoneField = activeStandardFields.some((field) => field.key === "phone");
  const visibleIdentityFields = useMemo(
    () =>
      activeStandardFields.filter(
        (field) => field.key === "birthDate" && !shouldHideBirthDateField,
      ),
    [activeStandardFields, shouldHideBirthDateField],
  );
  const stepProfileFields = useMemo(
    () =>
      activeStandardFields.filter((field) => {
        if (!profileFieldKeys.has(field.key)) {
          return false;
        }

        if (field.key === "genderRoleCategory") {
          return !shouldHideCategoryField;
        }

        if (field.key === "unitName") {
          return !shouldHideUnitField;
        }

        return true;
      }),
    [activeStandardFields, shouldHideCategoryField, shouldHideUnitField],
  );
  const stepDetailFields = useMemo(
    () =>
      activeStandardFields.filter(
        (field) => {
          if (!detailFieldKeys.has(field.key)) {
            return false;
          }

          if (field.key === "parentConfirmed") {
            return requiresParentConsent;
          }

          if (
            (field.key === "photoInternalConsent" ||
              field.key === "photoPublicConsent") &&
            eventRequiresPhotoRelease
          ) {
            return false;
          }

          return true;
        },
      ),
    [activeStandardFields, eventRequiresPhotoRelease, requiresParentConsent],
  );
  const hasPhotoConsentFields = stepDetailFields.some(
    (field) => field.key === "photoInternalConsent" || field.key === "photoPublicConsent",
  );
  const identityStepHasContent =
    shouldAskNameFields ||
    shouldAskEmailField ||
    shouldAskPhoneField ||
    visibleIdentityFields.length > 0;
  const profileStepHasContent = stepProfileFields.length > 0;
  const detailStepHasContent =
    stepDetailFields.length > 0 || formConfig.customFields.length > 0 || useNewConsentFlow;
  const hasVisibleQuestions =
    identityStepHasContent || profileStepHasContent || detailStepHasContent;
  const registrationSteps = useMemo<StepDefinition[]>(() => {
    const nextSteps: StepDefinition[] = [];

    if (identityStepHasContent) {
      nextSteps.push({
        id: "identity",
        title:
          !shouldAskNameFields && !shouldAskEmailField && shouldAskPhoneField
            ? "Contatto"
            : "Chi partecipa",
        description: "Dati personali essenziali e contatto.",
        icon: "user",
      });
    }

    if (profileStepHasContent) {
      nextSteps.push({
        id: "profile",
        title: "Appartenenza",
        description: "Organizzazione, unità e logistica di base.",
        icon: "users",
      });
    }

    if (detailStepHasContent) {
      nextSteps.push({
        id: "details",
        title: "Dettagli utili",
        description: "Note, preferenze e autorizzazioni.",
        icon: "sparkles",
      });
    }

    if (showParentStep) {
      nextSteps.push({
        id: "parent",
        title: "Genitore e sicurezza",
        description: "Contatti del genitore, emergenze e note sanitarie.",
        icon: "user",
      });
    }

    if (nextSteps.length === 0) {
      nextSteps.push({
        id: "details",
        title: "Conferma",
        description: "Useremo i dati gia presenti nel tuo account.",
        icon: "check",
      });
    }

    return nextSteps;
  }, [
    detailStepHasContent,
    formConfig.customFields.length,
    identityStepHasContent,
    profileStepHasContent,
    shouldAskEmailField,
    shouldAskNameFields,
    shouldAskPhoneField,
    showParentStep,
  ]);

  useEffect(() => {
    setValues(getInitialValues(session, formConfig, initialRegistration));
    setFieldErrors({});
    setCurrentStepIndex(0);
  }, [formConfig, initialRegistration, session]);

  useEffect(() => {
    setCurrentStepIndex((current) => Math.min(current, registrationSteps.length - 1));
  }, [registrationSteps.length]);

  const currentStep = registrationSteps[currentStepIndex];
  const progress = ((currentStepIndex + 1) / registrationSteps.length) * 100;
  const isLastStep = currentStepIndex === registrationSteps.length - 1;

  function clearFieldError(key: string) {
    setFieldErrors((current) => {
      if (!current[key]) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateAnswer(key: string, value: RegistrationAnswerValue) {
    clearFieldError(key);
    setValues((current) => ({
      ...current,
      answers: {
        ...current.answers,
        [key]: value,
      },
    }));
  }

  function getInputClass(key: string) {
    return fieldErrors[key] ? "input input--error" : "input";
  }

  function renderFieldLabel(label: string, key: string, required = false) {
    return (
      <span className={fieldErrors[key] ? "field__label field__label--error" : "field__label"}>
        {label}
        {required ? <em aria-hidden="true">*</em> : null}
      </span>
    );
  }

  function renderFieldHint(key: string, helpText?: string, requiredLabel = "Campo obbligatorio.") {
    if (fieldErrors[key]) {
      return <small className="field-error">{fieldErrors[key] || requiredLabel}</small>;
    }

    return helpText ? <small>{helpText}</small> : null;
  }

  function validateIdentityStep() {
    const errors: FieldErrors = {};

    if (shouldAskNameFields && !values.firstName.trim()) {
      errors.firstName = "Campo obbligatorio.";
    }

    if (shouldAskNameFields && !values.lastName.trim()) {
      errors.lastName = "Campo obbligatorio.";
    }

    if (shouldAskEmailField && !values.email.trim()) {
      errors.email = "Campo obbligatorio.";
    }

    if (visibleIdentityFields.some((field) => field.key === "birthDate") && !values.birthDate) {
      errors.birthDate = "Campo obbligatorio.";
    }

    return errors;
  }

  function validateProfileStep() {
    const errors: FieldErrors = {};

    if (stepProfileFields.some((field) => field.key === "genderRoleCategory") && !values.category) {
      errors.genderRoleCategory = "Campo obbligatorio.";
    }

    if (stepProfileFields.some((field) => field.key === "unitName")) {
      if (!hasConfiguredUnits || !values.unitName.trim()) {
        errors.unitName = "Campo obbligatorio.";
      } else if (
        !unitOptions.some(
          (unit) => normalizeUnitName(unit) === normalizeUnitName(values.unitName),
        )
      ) {
        errors.unitName = "Seleziona un'unità valida dall'elenco.";
      }
    }

    for (const key of ["roomPreference1Name", "roomPreference2Name"] as const) {
      if (
        stepProfileFields.some((field) => field.key === key) &&
        getRoomPreferenceTextFromAnswers(values.answers, key) &&
        !hasRoomPreferenceFullName(getRoomPreferenceTextFromAnswers(values.answers, key))
      ) {
        errors[key] = "Inserisci sia nome che cognome.";
      }
    }

    return errors;
  }

  function validateDetailsStep() {
    const errors: FieldErrors = {};

    for (const field of formConfig.customFields) {
      const value = values.answers[field.key];
      const isEmpty =
        value === null ||
        value === undefined ||
        (typeof value === "string" && !value.trim()) ||
        (Array.isArray(value) && value.length === 0) ||
        (field.type === "checkbox" && value !== true);

      if (field.required && isEmpty) {
        errors[field.key] = "Campo obbligatorio.";
      }
    }

    return errors;
  }

  function validateParentStep() {
    const errors: FieldErrors = {};

    if (!values.parentFirstName.trim()) {
      errors.parentFirstName = "Campo obbligatorio.";
    }
    if (!values.parentLastName.trim()) {
      errors.parentLastName = "Campo obbligatorio.";
    }
    if (!values.parentEmail.trim()) {
      errors.parentEmail = "Campo obbligatorio.";
    } else if (!EMAIL_PATTERN.test(values.parentEmail.trim())) {
      errors.parentEmail = "Inserisci un'email valida.";
    }
    if (!values.parentPhone.trim()) {
      errors.parentPhone = "Campo obbligatorio.";
    }

    if (eventRequiresEmergencyContacts) {
      if (!values.emergencyContactName.trim()) {
        errors.emergencyContactName = "Campo obbligatorio.";
      }
      if (!values.emergencyContactPhone.trim()) {
        errors.emergencyContactPhone = "Campo obbligatorio.";
      }
    }

    return errors;
  }

  function validateCurrentStep() {
    const nextErrors =
      currentStep.id === "identity"
        ? validateIdentityStep()
        : currentStep.id === "profile"
          ? validateProfileStep()
          : currentStep.id === "parent"
            ? validateParentStep()
            : validateDetailsStep();

    setFieldErrors(nextErrors);
    return !hasValidationErrors(nextErrors);
  }

  function renderStandardField(field: (typeof activeStandardFields)[number]) {
    if (field.key === "parentConfirmed" && !requiresParentConsent) {
      return null;
    }

    if (!event.overnight && isRoomRelatedStandardFieldKey(field.key)) {
      return null;
    }

    const value = values.answers[field.key];
    const isRequired =
      field.key === "birthDate" ||
      field.key === "genderRoleCategory" ||
      field.key === "unitName" ||
      field.key === "parentConfirmed";

    if (field.key === "birthDate") {
      return (
        <label key={field.key} className="field">
          {renderFieldLabel(field.label, field.key, true)}
          <input
            className={getInputClass(field.key)}
            type="date"
            value={values.birthDate}
            onChange={(eventInput) => {
              clearFieldError(field.key);
              setValues((current) => ({
                ...current,
                birthDate: eventInput.target.value,
              }));
              updateAnswer(field.key, eventInput.target.value);
            }}
          />
          {renderFieldHint(field.key, field.helpText)}
        </label>
      );
    }

    if (field.key === "youthGroup" || field.key === "genderRoleCategory") {
      return (
        <label key={field.key} className="field">
          {renderFieldLabel(field.label, "genderRoleCategory", true)}
          <select
            className={getInputClass("genderRoleCategory")}
            value={values.category}
            onChange={(eventInput) => {
              clearFieldError("genderRoleCategory");
              setValues((current) => ({
                ...current,
                category: eventInput.target.value,
              }));
              updateAnswer(field.key, eventInput.target.value);
              updateAnswer("genderRoleCategory", eventInput.target.value);
              updateAnswer("youthGroup", eventInput.target.value);
            }}
          >
            <option value="">Seleziona</option>
            {allowedCategoryOptions.includes("giovane_uomo") ? (
              <option value="giovane_uomo">Giovane uomo</option>
            ) : null}
            {allowedCategoryOptions.includes("giovane_donna") ? (
              <option value="giovane_donna">Giovane donna</option>
            ) : null}
            {allowedCategoryOptions.includes("dirigente") ? (
              <option value="dirigente">Dirigente</option>
            ) : null}
          </select>
          {renderFieldHint("genderRoleCategory", field.helpText)}
        </label>
      );
    }

    if (field.key === "unitName") {
      return (
        <label key={field.key} className="field">
          {renderFieldLabel(field.label, field.key, true)}
          <select
            className={getInputClass(field.key)}
            disabled={!hasConfiguredUnits}
            value={values.unitName}
            onChange={(eventInput) => {
              clearFieldError(field.key);
              setValues((current) => ({
                ...current,
                unitName: eventInput.target.value,
              }));
              updateAnswer(field.key, eventInput.target.value);
            }}
          >
            <option value="">
              {hasConfiguredUnits ? "Seleziona un'unità" : "Nessuna unità configurata"}
            </option>
            {unitFieldOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {renderFieldHint(field.key, field.helpText)}
        </label>
      );
    }

    if (field.key === "city") {
      const cityOptions = field.options?.length ? field.options : italianMunicipalityOptions;

      return (
        <label key={field.key} className="field">
          {renderFieldLabel(field.label, field.key, isRequired)}
          <input
            className={getInputClass(field.key)}
            list={cityOptionsListId}
            value={typeof value === "string" ? value : ""}
            onChange={(eventInput) => updateAnswer(field.key, eventInput.target.value)}
            placeholder="Seleziona o scrivi un comune"
          />
          <datalist id={cityOptionsListId}>
            {cityOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          {renderFieldHint(field.key, field.helpText)}
        </label>
      );
    }

    if (field.inputType === "textarea") {
      return (
        <label key={field.key} className="field">
          {renderFieldLabel(field.label, field.key, isRequired)}
          <textarea
            className={fieldErrors[field.key] ? "input input--textarea input--error" : "input input--textarea"}
            rows={4}
            value={typeof value === "string" ? value : ""}
            onChange={(eventInput) =>
              updateAnswer(
                field.key,
                isRoomRelatedStandardFieldKey(field.key)
                  ? normalizeWhitespace(eventInput.target.value)
                  : eventInput.target.value,
              )
            }
            placeholder={field.placeholder}
          />
          {renderFieldHint(field.key, field.helpText)}
        </label>
      );
    }

    if (field.inputType === "select") {
      return (
        <label key={field.key} className="field">
          {renderFieldLabel(field.label, field.key, isRequired)}
          <select
            className={getInputClass(field.key)}
            value={typeof value === "string" ? value : ""}
            onChange={(eventInput) => updateAnswer(field.key, eventInput.target.value)}
          >
            <option value="">Seleziona...</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {renderFieldHint(field.key, field.helpText)}
        </label>
      );
    }

    if (field.inputType === "checkbox") {
      if (field.key === "parentConfirmed") {
        const hasUploadedDocument = Boolean(initialRegistration?.parentConsentDocumentUrl);
        const sessionCanUpload = Boolean(session?.isAuthenticated && !session.isAnonymous);

        return (
          <div key={field.key} className="surface-panel surface-panel--subtle form-subsection">
            <h3>{field.label}</h3>
            <p>
              {hasUploadedDocument
                ? "Il documento e gia stato collegato a questa iscrizione."
                : sessionCanUpload
                  ? "Non usiamo piu un semplice tick: dopo il primo salvataggio potrai caricare una foto del foglio firmato dalla pagina dell'attivita."
                  : "Per i minori il consenso si gestisce con una foto del foglio firmato. Se ti iscrivi senza account, potrai caricarlo dopo aver creato il profilo."}
            </p>
            <p className="subtle-text">
              Non e obbligatorio per inviare adesso il modulo, ma gli admin vedranno chiaramente
              se manca.
            </p>
            {minorConsentExampleImageUrl ? (
              <div
                className="upload-preview"
                style={{ backgroundImage: `url(${minorConsentExampleImageUrl})` }}
              />
            ) : null}
          </div>
        );
      }

      return (
        <label
          key={field.key}
          className={fieldErrors[field.key] ? "toggle-field toggle-field--error" : "toggle-field"}
        >
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(eventInput) => {
              clearFieldError(field.key);
              updateAnswer(field.key, eventInput.target.checked);
            }}
          />
          <span>
            <strong>
              {field.label}
              {isRequired ? <em aria-hidden="true">*</em> : null}
            </strong>
            {renderFieldHint(field.key, field.helpText)}
          </span>
        </label>
      );
    }

    return (
      <label key={field.key} className="field">
        {renderFieldLabel(field.label, field.key, isRequired)}
        <input
          className={getInputClass(field.key)}
          value={typeof value === "string" ? value : ""}
          onChange={(eventInput) => updateAnswer(field.key, eventInput.target.value)}
          placeholder={field.placeholder}
        />
        {renderFieldHint(field.key, field.helpText)}
      </label>
    );
  }

  function renderCustomField(field: CustomField) {
    const value = values.answers[field.key];

    if (field.type === "longText") {
      return (
        <label key={field.id} className="field">
          {renderFieldLabel(field.label, field.key, field.required)}
          <textarea
            className={fieldErrors[field.key] ? "input input--textarea input--error" : "input input--textarea"}
            rows={4}
            value={typeof value === "string" ? value : ""}
            onChange={(eventInput) => updateAnswer(field.key, eventInput.target.value)}
          />
          {renderFieldHint(field.key, field.helpText)}
        </label>
      );
    }

    if (field.type === "select") {
      return (
        <label key={field.id} className="field">
          {renderFieldLabel(field.label, field.key, field.required)}
          <select
            className={getInputClass(field.key)}
            value={typeof value === "string" ? value : ""}
            onChange={(eventInput) => updateAnswer(field.key, eventInput.target.value)}
          >
            <option value="">Seleziona...</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {renderFieldHint(field.key, field.helpText)}
        </label>
      );
    }

    if (field.type === "checkbox") {
      return (
        <label
          key={field.id}
          className={fieldErrors[field.key] ? "toggle-field toggle-field--error" : "toggle-field"}
        >
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(eventInput) => {
              clearFieldError(field.key);
              updateAnswer(field.key, eventInput.target.checked);
            }}
          />
          <span>
            <strong>
              {field.label}
              {field.required ? <em aria-hidden="true">*</em> : null}
            </strong>
            {renderFieldHint(field.key, field.helpText)}
          </span>
        </label>
      );
    }

    return (
      <label key={field.id} className="field">
        {renderFieldLabel(field.label, field.key, field.required)}
        <input
          className={getInputClass(field.key)}
          value={typeof value === "string" ? value : ""}
          onChange={(eventInput) => updateAnswer(field.key, eventInput.target.value)}
        />
        {renderFieldHint(field.key, field.helpText)}
      </label>
    );
  }

  async function handleSubmit(eventForm: FormEvent<HTMLFormElement>) {
    eventForm.preventDefault();

    if (!validateCurrentStep()) {
      return;
    }

    if (!isLastStep) {
      setCurrentStepIndex((current) => Math.min(current + 1, registrationSteps.length - 1));
      return;
    }

    if (useNewConsentFlow) {
      const missingParental = eventRequiresParental && !values.parentalConsentAccepted;
      const missingPhoto = eventRequiresPhotoRelease && !values.photoReleaseAccepted;

      if (missingParental || missingPhoto) {
        const missingLabels = [
          missingParental ? "consenso del genitore" : null,
          missingPhoto ? "liberatoria immagini" : null,
        ]
          .filter(Boolean)
          .join(" e ");

        const proceed = window.confirm(
          `Manca: ${missingLabels}.\n\nPer poter partecipare il genitore o tutore deve completare l'autorizzazione (anche dopo l'iscrizione, dalla scheda dell'attivita). Se non riesci, rivolgiti al tuo dirigente.\n\nVuoi continuare comunque?`,
        );

        if (!proceed) {
          return;
        }
      }
    }

    const fullName = `${values.firstName.trim()} ${values.lastName.trim()}`.trim();
    const category = getGenderRoleCategory(values.category);
    const youthGroup = getYouthGroupLabel(category);
    const consentAcceptedAt = new Date().toISOString();
    const trimmedSignerName = values.consentSignerName.trim();

    // Quando l'attivita' richiede autorizzazione magic-link al genitore e il
    // partecipante e' minorenne, raccogliamo i dati del genitore qui e settiamo
    // lo status di registrazione a "in attesa autorizzazione". La Cloud Function
    // di richiesta autorizzazione (lato server) sposta questi dati nel
    // sub-object `parentAuthorization`, crea il token e invia la mail Brevo.
    const parentAuthRequestPayload = eventRequiresParentAuthorization
      ? {
          parentFirstName: values.parentFirstName.trim(),
          parentLastName: values.parentLastName.trim(),
          parentEmail: values.parentEmail.trim().toLowerCase(),
          parentPhone: values.parentPhone.trim(),
          emergencyContactName: values.emergencyContactName.trim(),
          emergencyContactPhone: values.emergencyContactPhone.trim(),
          emergencyContactRelation: values.emergencyContactRelation.trim(),
          allergies: values.allergies.trim(),
          medications: values.medications.trim(),
          medicalNotes: values.medicalNotes.trim(),
          dietaryNotes: values.dietaryNotes.trim(),
          submittedAt: consentAcceptedAt,
        }
      : null;

    const nextRegistrationStatus = (() => {
      if (initialRegistration?.registrationStatus) {
        // Update di iscrizione esistente: preservo lo stato (la Cloud Function
        // lo cambia solo dopo conferma/rifiuto del genitore).
        return initialRegistration.registrationStatus;
      }
      if (eventRequiresParentAuthorization) {
        return "pending_parent_authorization" as const;
      }
      return "active" as const;
    })();

    await onSubmit({
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      fullName,
      email: values.email.trim(),
      phone: values.phone.trim(),
      birthDate: values.birthDate,
      genderRoleCategory: category,
      unitName: values.unitName.trim(),
      answers: {
        ...values.answers,
        roomPreference1Name: getRoomPreferenceTextFromAnswers(
          values.answers,
          "roomPreference1Name",
        ),
        roomPreference2Name: getRoomPreferenceTextFromAnswers(
          values.answers,
          "roomPreference2Name",
        ),
        birthDate: values.birthDate,
        genderRoleCategory: category,
        youthGroup,
        unitName: values.unitName.trim(),
        parentConfirmed:
          requiresParentConsent &&
          (values.answers.parentConfirmed === true ||
            Boolean(initialRegistration?.parentConsentDocumentUrl)),
        ...(eventRequiresParental
          ? {
              parentalConsentAccepted: values.parentalConsentAccepted,
              parentalConsentAcceptedAt: values.parentalConsentAccepted
                ? consentAcceptedAt
                : null,
              parentalConsentSignerName: trimmedSignerName,
            }
          : {}),
        ...(eventRequiresPhotoRelease
          ? {
              photoReleaseAccepted: values.photoReleaseAccepted,
              photoReleaseAcceptedAt: values.photoReleaseAccepted
                ? consentAcceptedAt
                : null,
              photoReleaseSignerName: trimmedSignerName,
            }
          : {}),
        ...(parentAuthRequestPayload
          ? {
              parentAuthorizationRequest:
                parentAuthRequestPayload as unknown as RegistrationAnswerValue,
            }
          : {}),
      },
      registrationStatus: nextRegistrationStatus,
      status: initialRegistration?.status === "cancelled" ? "cancelled" : "active",
    });
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      {openConsentModal ? (
        <ConsentTextModal kind={openConsentModal} onClose={() => setOpenConsentModal(null)} />
      ) : null}
      <div className="form-stepper form-stepper--registration">
        <div className="form-stepper__progress">
          <div className="form-stepper__track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="form-stepper__steps">
            {registrationSteps.map((step, index) => (
              <div
                key={step.id}
                className={
                  index === currentStepIndex
                    ? "form-stepper__step form-stepper__step--active"
                    : index < currentStepIndex
                      ? "form-stepper__step form-stepper__step--done"
                      : "form-stepper__step"
                }
              >
                <div className="form-stepper__step-icon">
                  <AppIcon name={index < currentStepIndex ? "check" : step.icon} />
                </div>
                <strong className="form-stepper__step-label">{step.title}</strong>
              </div>
            ))}
          </div>
        </div>

        <div key={currentStep.id} className="form-stepper__panel">
          {currentStep.id === "identity" ? (
            <div className="card-grid card-grid--two">
              {shouldAskNameFields ? (
                <>
                  <label className="field">
                    {renderFieldLabel("Nome", "firstName", true)}
                    <input
                      className={getInputClass("firstName")}
                      value={values.firstName}
                      onChange={(eventInput) => {
                        clearFieldError("firstName");
                        setValues((current) => ({
                          ...current,
                          firstName: eventInput.target.value,
                        }));
                      }}
                    />
                    {renderFieldHint("firstName")}
                  </label>

                  <label className="field">
                    {renderFieldLabel("Cognome", "lastName", true)}
                    <input
                      className={getInputClass("lastName")}
                      value={values.lastName}
                      onChange={(eventInput) => {
                        clearFieldError("lastName");
                        setValues((current) => ({
                          ...current,
                          lastName: eventInput.target.value,
                        }));
                      }}
                    />
                    {renderFieldHint("lastName")}
                  </label>
                </>
              ) : null}

              {shouldAskEmailField ? (
                <label className="field">
                  {renderFieldLabel("Email", "email", true)}
                  <input
                    className={getInputClass("email")}
                    type="email"
                    value={values.email}
                    onChange={(eventInput) => {
                      clearFieldError("email");
                      setValues((current) => ({
                        ...current,
                        email: eventInput.target.value,
                      }));
                    }}
                  />
                  {renderFieldHint("email")}
                </label>
              ) : null}

              {shouldAskPhoneField ? (
                <label className="field">
                  {renderFieldLabel("Telefono", "phone")}
                  <input
                    className={getInputClass("phone")}
                    value={values.phone}
                    onChange={(eventInput) => {
                      clearFieldError("phone");
                      setValues((current) => ({
                        ...current,
                        phone: eventInput.target.value,
                      }));
                    }}
                  />
                  {renderFieldHint("phone")}
                </label>
              ) : null}

              {isAuthenticatedAccount && (!shouldAskNameFields || !shouldAskEmailField) ? (
                <div className="field field--full">
                  <div className="surface-panel surface-panel--subtle registration-account-hint">
                    <strong>Dati account gia riutilizzati</strong>
                    <p>Nome, email e profilo gia presenti non ti vengono richiesti di nuovo.</p>
                  </div>
                </div>
              ) : null}

              {visibleIdentityFields.map((field) => (
                <div key={field.key} className="field--full">
                  {renderStandardField(field)}
                </div>
              ))}
            </div>
          ) : null}

          {currentStep.id === "profile" ? (
            <div className="form-stack">{stepProfileFields.map((field) => renderStandardField(field))}</div>
          ) : null}

          {currentStep.id === "details" ? (
            <div className="form-stack">
              {!hasVisibleQuestions ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Pronto per inviare</h3>
                  <p>
                    Per questa attivita useremo direttamente i dati gia presenti nel tuo account.
                  </p>
                </div>
              ) : null}
              {hasPhotoConsentFields ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Uso delle fotografie</h3>
                  <p>
                    Spuntando i consensi foto autorizzi solo gli usi descritti nella{" "}
                    <Link to="/privacy/photos">comunicazione sull&apos;uso delle fotografie</Link>.
                  </p>
                </div>
              ) : null}
              {stepDetailFields.map((field) => renderStandardField(field))}
              {formConfig.customFields.length > 0 ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Domande aggiuntive</h3>
                  <div className="form-stack">
                    {formConfig.customFields.map((field) => renderCustomField(field))}
                  </div>
                </div>
              ) : null}

              {useNewConsentFlow ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Autorizzazioni</h3>
                  <p className="subtle-text">
                    Spuntale ora se puoi. Se manca qualcosa puoi completare anche
                    dopo l&apos;iscrizione (firma del genitore inclusa).
                  </p>

                  {eventRequiresParental ? (
                    <label
                      className={
                        fieldErrors.parentalConsentAccepted
                          ? "toggle-field toggle-field--error"
                          : "toggle-field"
                      }
                    >
                      <input
                        checked={values.parentalConsentAccepted}
                        onChange={(eventInput) => {
                          clearFieldError("parentalConsentAccepted");
                          setValues((current) => ({
                            ...current,
                            parentalConsentAccepted: eventInput.target.checked,
                          }));
                        }}
                        type="checkbox"
                      />
                      <span>
                        <strong>Consenso del genitore o tutore (per minori)</strong>
                        <small>
                          Accetto il consenso a nome del genitore o tutore.{" "}
                          <button
                            className="link-button"
                            onClick={() => setOpenConsentModal("parental")}
                            type="button"
                          >
                            Leggi il documento
                          </button>
                        </small>
                      </span>
                    </label>
                  ) : null}

                  {eventRequiresPhotoRelease ? (
                    <label className="toggle-field">
                      <input
                        checked={values.photoReleaseAccepted}
                        onChange={(eventInput) =>
                          setValues((current) => ({
                            ...current,
                            photoReleaseAccepted: eventInput.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>Liberatoria per l&apos;uso delle immagini</strong>
                        <small>
                          Accetto la liberatoria immagini.{" "}
                          <button
                            className="link-button"
                            onClick={() => setOpenConsentModal("photo")}
                            type="button"
                          >
                            Leggi il documento
                          </button>
                        </small>
                      </span>
                    </label>
                  ) : null}

                  <label className="field">
                    <span className="field__label">
                      Nome del firmatario {eventRequiresParental ? "(genitore o tutore)" : ""}
                    </span>
                    <input
                      className="input"
                      onChange={(eventInput) =>
                        setValues((current) => ({
                          ...current,
                          consentSignerName: eventInput.target.value,
                        }))
                      }
                      placeholder="Es. Mario Rossi"
                      type="text"
                      value={values.consentSignerName}
                    />
                    <small>
                      Firma digitale e documento d&apos;identita opzionali si
                      caricano dopo l&apos;iscrizione, dalla scheda dell&apos;attivita.
                    </small>
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {currentStep.id === "parent" ? (
            <div className="form-stack">
              <div className="form-info-banner">
                <strong>Dati genitore o tutore richiesti</strong>
                <span>
                  Dopo l&apos;invio invieremo al genitore un&apos;email con un link unico
                  per autorizzare la partecipazione. L&apos;iscrizione sara&apos; in stato
                  <em> &quot;in attesa autorizzazione&quot; </em>
                  finche&apos; il genitore non conferma. Il link scade dopo 14 giorni.
                </span>
              </div>

              <div className="surface-panel surface-panel--subtle form-subsection">
                <h3>Contatti del genitore o tutore</h3>
                <div className="card-grid card-grid--two">
                  <label className="field">
                    {renderFieldLabel("Nome genitore", "parentFirstName", true)}
                    <input
                      className={getInputClass("parentFirstName")}
                      value={values.parentFirstName}
                      onChange={(eventInput) => {
                        clearFieldError("parentFirstName");
                        setValues((current) => ({
                          ...current,
                          parentFirstName: eventInput.target.value,
                        }));
                      }}
                    />
                    {renderFieldHint("parentFirstName")}
                  </label>

                  <label className="field">
                    {renderFieldLabel("Cognome genitore", "parentLastName", true)}
                    <input
                      className={getInputClass("parentLastName")}
                      value={values.parentLastName}
                      onChange={(eventInput) => {
                        clearFieldError("parentLastName");
                        setValues((current) => ({
                          ...current,
                          parentLastName: eventInput.target.value,
                        }));
                      }}
                    />
                    {renderFieldHint("parentLastName")}
                  </label>

                  <label className="field">
                    {renderFieldLabel("Email genitore", "parentEmail", true)}
                    <input
                      className={getInputClass("parentEmail")}
                      type="email"
                      value={values.parentEmail}
                      onChange={(eventInput) => {
                        clearFieldError("parentEmail");
                        setValues((current) => ({
                          ...current,
                          parentEmail: eventInput.target.value,
                        }));
                      }}
                    />
                    {renderFieldHint(
                      "parentEmail",
                      "Riceveremo qui il link unico di autorizzazione. Verifica con cura l'indirizzo.",
                    )}
                  </label>

                  <label className="field">
                    {renderFieldLabel("Telefono genitore", "parentPhone", true)}
                    <input
                      className={getInputClass("parentPhone")}
                      type="tel"
                      value={values.parentPhone}
                      onChange={(eventInput) => {
                        clearFieldError("parentPhone");
                        setValues((current) => ({
                          ...current,
                          parentPhone: eventInput.target.value,
                        }));
                      }}
                    />
                    {renderFieldHint("parentPhone")}
                  </label>
                </div>
              </div>

              {eventRequiresEmergencyContacts ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Contatto di emergenza</h3>
                  <p className="subtle-text">
                    Persona da contattare in caso di urgenza durante l&apos;attivita&apos;
                    (puo&apos; coincidere con il genitore se preferisci).
                  </p>
                  <div className="card-grid card-grid--two">
                    <label className="field">
                      {renderFieldLabel("Nome e cognome", "emergencyContactName", true)}
                      <input
                        className={getInputClass("emergencyContactName")}
                        value={values.emergencyContactName}
                        onChange={(eventInput) => {
                          clearFieldError("emergencyContactName");
                          setValues((current) => ({
                            ...current,
                            emergencyContactName: eventInput.target.value,
                          }));
                        }}
                      />
                      {renderFieldHint("emergencyContactName")}
                    </label>

                    <label className="field">
                      {renderFieldLabel("Telefono", "emergencyContactPhone", true)}
                      <input
                        className={getInputClass("emergencyContactPhone")}
                        type="tel"
                        value={values.emergencyContactPhone}
                        onChange={(eventInput) => {
                          clearFieldError("emergencyContactPhone");
                          setValues((current) => ({
                            ...current,
                            emergencyContactPhone: eventInput.target.value,
                          }));
                        }}
                      />
                      {renderFieldHint("emergencyContactPhone")}
                    </label>

                    <label className="field">
                      {renderFieldLabel("Relazione (es. zio, nonna)", "emergencyContactRelation")}
                      <input
                        className={getInputClass("emergencyContactRelation")}
                        value={values.emergencyContactRelation}
                        onChange={(eventInput) =>
                          setValues((current) => ({
                            ...current,
                            emergencyContactRelation: eventInput.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              {eventRequiresMedicalNotes ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Note mediche e alimentari</h3>
                  <p className="subtle-text">
                    Tutto facoltativo. Dichiara solo cio&apos; che ritieni utile per la
                    sicurezza del minore. Le informazioni sono visibili solo agli admin.
                  </p>
                  <div className="form-stack">
                    <label className="field">
                      {renderFieldLabel("Allergie", "allergies")}
                      <textarea
                        className="input input--textarea"
                        rows={2}
                        value={values.allergies}
                        onChange={(eventInput) =>
                          setValues((current) => ({
                            ...current,
                            allergies: eventInput.target.value,
                          }))
                        }
                        placeholder="Es. arachidi, polline. Lascia vuoto se non rilevanti."
                      />
                    </label>

                    <label className="field">
                      {renderFieldLabel("Farmaci assunti", "medications")}
                      <textarea
                        className="input input--textarea"
                        rows={2}
                        value={values.medications}
                        onChange={(eventInput) =>
                          setValues((current) => ({
                            ...current,
                            medications: eventInput.target.value,
                          }))
                        }
                        placeholder="Nome e dosaggio dei farmaci che il minore deve assumere."
                      />
                    </label>

                    <label className="field">
                      {renderFieldLabel("Note mediche o logistiche", "medicalNotes")}
                      <textarea
                        className="input input--textarea"
                        rows={2}
                        value={values.medicalNotes}
                        onChange={(eventInput) =>
                          setValues((current) => ({
                            ...current,
                            medicalNotes: eventInput.target.value,
                          }))
                        }
                        placeholder="Patologie, supporti necessari, intolleranze gravi."
                      />
                    </label>

                    <label className="field">
                      {renderFieldLabel("Note alimentari", "dietaryNotes")}
                      <textarea
                        className="input input--textarea"
                        rows={2}
                        value={values.dietaryNotes}
                        onChange={(eventInput) =>
                          setValues((current) => ({
                            ...current,
                            dietaryNotes: eventInput.target.value,
                          }))
                        }
                        placeholder="Es. vegetariano, intolleranza lattosio, dieta specifica."
                      />
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          className={
            currentStepIndex > 0
              ? "form-stepper__actions form-stepper__actions--registration"
              : "form-stepper__actions form-stepper__actions--registration form-stepper__actions--end"
          }
        >
          {currentStepIndex > 0 ? (
            <button
              className="button button--ghost form-stepper__nav-button"
              disabled={busy}
              onClick={() => {
                setFieldErrors({});
                setCurrentStepIndex((current) => Math.max(current - 1, 0));
              }}
              type="button"
            >
              <AppIcon name="arrow-left" />
              <span>Indietro</span>
            </button>
          ) : (
            <span aria-hidden="true" className="form-stepper__actions-spacer" />
          )}

          <button
            className="button button--primary form-stepper__nav-button"
            disabled={busy}
            type="submit"
          >
            {busy ? (
              "Salvataggio..."
            ) : isLastStep ? (
              <>
                <AppIcon name="check" />
                <span>{submitLabel}</span>
              </>
            ) : (
              <>
                <span>Continua</span>
                <AppIcon name="arrow-right" />
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
