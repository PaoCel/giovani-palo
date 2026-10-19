import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { RoomMateField } from "@/components/RoomMateField";
import { italianMunicipalityOptions } from "@/config/cityOptions";
import { INVIATA } from "@/copy/inviata";
import { ISCRIZIONE } from "@/copy/iscrizione";
import { fillCopy } from "@/copy/parole";
import { PROFILO } from "@/copy/profilo";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
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
import { getParentEmailAddress } from "@/utils/childChoice";
import { getAllowedCategoriesForAudience } from "@/utils/events";
import { getParentStepNotice, parentStepNoticeSendsLink } from "@/utils/parentStepNotice";
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
  // Iscrizione precedente dello stesso partecipante: da qui arrivano i
  // contatti del genitore già noti, che l'utente deve solo confermare.
  parentDetailsSource?: Registration | null;
  session: AuthSession | null;
  unitOptions?: string[];
  standardFieldDefinitions?: StandardFieldDefinition[];
  minorConsentExampleImageUrl?: string;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (input: RegistrationWriteInput) => Promise<void>;
  // Risposte toccate dall'utente e non ancora inviate (foglio "Esci
  // dall'iscrizione?"): conta solo l'input vero, non i riempimenti automatici.
  onDirtyChange?: (dirty: boolean) => void;
  // Bozza in memoria per account, attività e persona (docs/FLUSSO_GENITORE.md,
  // F): tornando a questo modulo si riparte dalle risposte e dal passo di prima.
  draftKey?: string;
  initialDraft?: RegistrationEditorDraft | null;
  // Riceve anche la chiave: la bozza resta legata alla persona di questo modulo.
  onDraftChange?: (draft: RegistrationEditorDraft, draftKey: string | undefined) => void;
  // Account che iscrive un figlio: il passo "Genitore e sicurezza" parte con
  // nome, email e telefono dell'account, modificabili.
  parentAccount?: ParentAccountPrefill | null;
  // Nome del figlio nei testi del passo genitore.
  childFirstName?: string;
  // "flow": dentro il percorso d'iscrizione (docs/FLUSSO_GENITORE.md, F e
  // "Finitura"): titolo del passo come titolo della pagina, col focus a ogni
  // passo, "Passo 2 di 4 · Titolo" con i segmenti, piede fisso con la CTA.
  layout?: "card" | "flow";
}

export interface ParentAccountPrefill {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface RegistrationEditorDraft {
  values: RegistrationEditorValues;
  stepIndex: number;
}

export interface RegistrationEditorValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthDate: string;
  category: string;
  unitName: string;
  answers: RegistrationAnswers;
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
  participatingDays: string[];
  pendingQuestions: { text: string; isAnonymous: boolean }[];
}

interface StepDefinition {
  id: "identity" | "profile" | "details" | "parent" | "questions";
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
const STICKY_ANSWER_KEYS: StandardFieldKey[] = [
  "allergies",
  "dietaryNotes",
  "medicalNotes",
];
const detailFieldKeys = new Set<StandardFieldKey>([
  "roomNotes",
  "allergies",
  "dietaryNotes",
  "medicalNotes",
  "photoInternalConsent",
  "photoPublicConsent",
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

const ACCOUNT_PARENT_FIELDS: Record<string, keyof ParentAccountPrefill> = {
  parentFirstName: "firstName",
  parentLastName: "lastName",
  parentEmail: "email",
  parentPhone: "phone",
};

function getInitialValues(
  session: AuthSession | null,
  formConfig: EventFormConfig,
  registration?: Registration | null,
  parentDetailsSource?: Registration | null,
  parentAccount?: ParentAccountPrefill | null,
): RegistrationEditorValues {
  // I campi genitore/sanitari ricadono sull'ultima iscrizione del
  // partecipante quando questa è nuova: si conferma, non si ridigita. Chi
  // iscrive un figlio dal suo account parte dai dati dell'account per nome,
  // email e telefono; ciò che l'iscrizione ha già salvato vince sempre.
  const accountField = (key: string) => {
    const accountKey = ACCOUNT_PARENT_FIELDS[key];
    return accountKey && parentAccount ? parentAccount[accountKey].trim() : "";
  };
  const parentField = (key: string) =>
    getStoredParentField(registration, key) ||
    accountField(key) ||
    getStoredParentField(parentDetailsSource, key);
  const registrationNames = splitFullName(registration?.fullName);
  const sessionNames = splitFullName(session?.profile.fullName);
  const answers: RegistrationAnswers = {};

  for (const standardFieldKey of normalizeStandardFieldKeys(formConfig.enabledStandardFields)) {
    const existingValue = registration?.answers[standardFieldKey];

    if (existingValue !== undefined) {
      answers[standardFieldKey] = existingValue;
      continue;
    }

    // Allergie e note sanitarie non cambiano tra un'attività e l'altra: si
    // ripresentano già compilate dall'ultima iscrizione, da confermare o
    // correggere. Le preferenze stanza no: quelle si scelgono ogni volta.
    const stickyValue = STICKY_ANSWER_KEYS.includes(standardFieldKey)
      ? // Nelle iscrizioni con autorizzazione genitore questi campi finiscono
        // nel blocco genitore invece che fra le risposte: si guarda in
        // entrambi i posti, altrimenti l'allergia già dichiarata si perde.
        (parentDetailsSource?.answers[standardFieldKey] ??
          getStoredParentField(parentDetailsSource, standardFieldKey) ??
          undefined)
      : undefined;

    if (stickyValue !== undefined && stickyValue !== "") {
      answers[standardFieldKey] = stickyValue;
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
    phone: registration?.phone ?? session?.profile.phone ?? "",
    birthDate: registration?.birthDate || session?.profile.birthDate || "",
    category:
      registration?.genderRoleCategory ||
      session?.profile.genderRoleCategory ||
      "",
    unitName: registration?.unitNameSnapshot || session?.profile.unitName || "",
    answers,
    parentFirstName: parentField("parentFirstName"),
    parentLastName: parentField("parentLastName"),
    parentEmail: parentField("parentEmail"),
    parentPhone: parentField("parentPhone"),
    emergencyContactName: parentField("emergencyContactName"),
    emergencyContactPhone: parentField("emergencyContactPhone"),
    emergencyContactRelation: parentField("emergencyContactRelation"),
    allergies: parentField("allergies"),
    medications: parentField("medications"),
    medicalNotes: parentField("medicalNotes"),
    dietaryNotes: parentField("dietaryNotes"),
    participatingDays: Array.isArray(registration?.participatingDays)
      ? [...registration.participatingDays]
      : [],
    pendingQuestions: [],
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
  parentDetailsSource,
  session,
  unitOptions = [],
  standardFieldDefinitions,
  minorConsentExampleImageUrl,
  busy,
  submitLabel,
  onSubmit,
  onDirtyChange,
  draftKey,
  initialDraft,
  onDraftChange,
  parentAccount,
  childFirstName,
  layout = "card",
}: RegistrationEditorProps) {
  const flowLayout = layout === "flow";
  const keyboardOpen = useKeyboardOpen();
  const stepTitleRef = useRef<HTMLHeadingElement | null>(null);
  // Doppio tocco su "Continua" nel penultimo passo: il secondo tocco cadrebbe
  // su "Conferma iscrizione", nello stesso punto, prima di vedere l'ultimo passo.
  const stepEnteredAtRef = useRef(0);
  const cityOptionsListId = useId();
  // Un account genitore riceve anche una Registration sintetica che precompila
  // i dati del figlio scelto (buildChildPrefill): ha id vuoto e stato "active".
  // Non è un'iscrizione esistente, e trattarla come tale faceva saltare la
  // richiesta di autorizzazione al genitore per un minore (2026-09-17).
  const existingRegistration = initialRegistration?.id ? initialRegistration : null;
  const editorIdentityKey = [
    event.stakeId,
    event.id,
    initialRegistration?.id ?? "new",
    parentDetailsSource?.id ?? "no-parent-source",
    session?.firebaseUser.uid ?? "no-session",
    draftKey ?? "no-draft",
  ].join(":");
  const [values, setValues] = useState<RegistrationEditorValues>(
    () =>
      initialDraft?.values ??
      getInitialValues(session, formConfig, initialRegistration, parentDetailsSource, parentAccount),
  );
  // Un campo toccato dall'utente (non i riempimenti automatici). Una bozza
  // ritrovata conta come già toccata.
  const touchedRef = useRef(Boolean(initialDraft));
  const identityKeyRef = useRef(editorIdentityKey);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [currentStepIndex, setCurrentStepIndex] = useState(initialDraft?.stepIndex ?? 0);
  // "Abbiamo inserito i dati del tuo account": solo se il passo genitore
  // parte davvero dall'account, non da un'iscrizione già salvata.
  const parentPrefilledFromAccount = useMemo(
    () =>
      Boolean(
        parentAccount &&
          (hasFilledText(parentAccount.email) || hasFilledText(parentAccount.firstName)) &&
          !hasFilledText(getStoredParentField(initialRegistration, "parentEmail")),
      ),
    [parentAccount, initialRegistration],
  );
  const sessionNames = useMemo(
    () => splitFullName(session?.profile.fullName),
    [session?.profile.fullName],
  );
  const enabledStandardFields = useMemo(
    () => {
      // Caminetti (event.questionsEnabled): l'organizzazione vuole sempre
      // sapere come arriverà il partecipante per coordinare passaggi/auto.
      // Forzo transportMode anche se l'admin non l'ha toggleato nel form.
      const base = normalizeStandardFieldKeys(formConfig.enabledStandardFields);
      if (event.questionsEnabled && !base.includes("transportMode")) {
        return [...base, "transportMode"];
      }
      return base;
    },
    [formConfig.enabledStandardFields, event.questionsEnabled],
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
  const supportsParticipatingDays = useMemo(() => {
    const type = event.activityType ?? (event.overnight ? "overnight" : "standard");
    return (
      type === "overnight" ||
      type === "camp" ||
      type === "multi_day" ||
      type === "trip"
    );
  }, [event.activityType, event.overnight]);
  const availableEventDays = useMemo(() => {
    if (!supportsParticipatingDays) return [];
    const startSrc = event.startDate;
    const endSrc = event.endDate || event.startDate;
    if (!startSrc) return [];
    const start = new Date(startSrc);
    const end = new Date(endSrc);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (endDay < startDay) return [];
    const days: string[] = [];
    const cursor = new Date(startDay);
    while (cursor <= endDay && days.length < 60) {
      const yyyy = cursor.getFullYear();
      const mm = String(cursor.getMonth() + 1).padStart(2, "0");
      const dd = String(cursor.getDate()).padStart(2, "0");
      days.push(`${yyyy}-${mm}-${dd}`);
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [event.startDate, event.endDate, supportsParticipatingDays]);
  const isMinorParticipant = isMinorBirthDate(values.birthDate);
  // Unico flusso genitore supportato: magic-link via email per minori.
  const eventRequiresParentAuthorization = Boolean(
    event.requiresParentAuthorization && isMinorParticipant,
  );
  const eventRequiresEmergencyContacts = Boolean(event.requiresEmergencyContacts);
  const eventRequiresMedicalNotes = Boolean(event.requiresMedicalNotes);
  const showParentStep = eventRequiresParentAuthorization;
  const hasPrefilledParentContacts = hasFilledText(values.parentEmail);
  // Cosa dice il passo genitore: quello che farà il salvataggio, letto
  // dall'iscrizione già salvata (mai dal precompilato di un figlio).
  const parentStepNotice = getParentStepNotice(existingRegistration);
  const parentStepEmail = getParentEmailAddress(existingRegistration);

  // Foto/video consent per MAGGIORENNI: per i minori il consenso lo dà il
  // genitore via magic-link (parentAuthorization.photoConsent). Per gli
  // adulti serve una checkbox semplice qui nel form, se l'evento richiede
  // image consent.
  const showAdultPhotoConsent = Boolean(
    event.requiresImageConsent && !isMinorParticipant && values.birthDate,
  );
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
  // Se l'utente ha un account e il telefono è già nel profilo, non lo
  // ri-chiediamo: il dato è già nostro, vogliamo solo le info specifiche
  // dell'attività.
  const shouldHidePhoneField = isAuthenticatedAccount && hasFilledText(session?.profile.phone);
  const shouldAskPhoneField =
    activeStandardFields.some((field) => field.key === "phone") && !shouldHidePhoneField;
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

          if (field.key === "parentConfirmed") return false;

          return true;
        },
      ),
    [activeStandardFields],
  );
  const hasStandardAllergiesField = stepDetailFields.some(
    (field) => field.key === "allergies",
  );
  const hasStandardMedicalNotesField = stepDetailFields.some(
    (field) => field.key === "medicalNotes",
  );
  const hasStandardDietaryNotesField = stepDetailFields.some(
    (field) => field.key === "dietaryNotes",
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
    stepDetailFields.length > 0 ||
    formConfig.customFields.length > 0 ||
    showAdultPhotoConsent;
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

    // Caminetto: domande per il Settanta. Step facoltativo ma elevato a
    // pari livello degli altri per non finire nascosto sotto la submit.
    if (event.questionsEnabled) {
      nextSteps.push({
        id: "questions",
        title: "Domande caminetto",
        description: "Facoltative. Anonime o con nome.",
        icon: "sparkles",
      });
    }

    if (nextSteps.length === 0) {
      nextSteps.push({
        id: "details",
        title: "Conferma",
        description: "Rivedi e conferma l'iscrizione.",
        icon: "check",
      });
    }

    return nextSteps;
  }, [
    detailStepHasContent,
    event.questionsEnabled,
    formConfig.customFields.length,
    identityStepHasContent,
    profileStepHasContent,
    shouldAskEmailField,
    shouldAskNameFields,
    shouldAskPhoneField,
    showParentStep,
  ]);

  useEffect(() => {
    // Le letture cache-first possono sostituire formConfig, registration e
    // session con nuovi oggetti equivalenti mentre l'utente sta compilando.
    // Resettare su ogni cambio di riferimento cancellava la bozza e riportava
    // al primo passo. Si riparte solo quando cambia davvero il soggetto del
    // modulo (attività, iscrizione, sorgente genitore, sessione o bozza), mai
    // al primo montaggio: lì valgono i valori iniziali o la bozza ritrovata.
    if (identityKeyRef.current === editorIdentityKey) {
      return;
    }

    identityKeyRef.current = editorIdentityKey;
    setValues(
      getInitialValues(session, formConfig, initialRegistration, parentDetailsSource, parentAccount),
    );
    setFieldErrors({});
    setCurrentStepIndex(0);
    touchedRef.current = false;
    onDirtyChange?.(false);
  }, [editorIdentityKey]);

  // Avvisa la pagina dopo il render, mai dentro l'evento del campo: un
  // aggiornamento del genitore durante l'input faceva perdere la prima
  // lettera digitata. La bozza segue risposte e passo.
  useEffect(() => {
    if (touchedRef.current) {
      onDirtyChange?.(true);
      onDraftChange?.({ values, stepIndex: currentStepIndex }, draftKey);
    }
  }, [values, currentStepIndex, onDirtyChange, onDraftChange, draftKey]);

  useEffect(() => {
    setCurrentStepIndex((current) => Math.min(current, registrationSteps.length - 1));
  }, [registrationSteps.length]);

  useEffect(() => {
    stepEnteredAtRef.current = Date.now();
  }, [currentStepIndex]);

  // Passo nuovo dentro il percorso: si riparte dall'alto con il focus sul
  // titolo (anche all'apertura del modulo e su una bozza ritrovata).
  useEffect(() => {
    if (!flowLayout) {
      return;
    }

    stepTitleRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [currentStepIndex, flowLayout]);

  useEffect(() => {
    if (!supportsParticipatingDays || availableEventDays.length === 0) return;
    setValues((current) => {
      const filtered = current.participatingDays.filter((day) =>
        availableEventDays.includes(day),
      );
      const next = filtered.length > 0 ? filtered : [...availableEventDays];
      if (
        next.length === current.participatingDays.length &&
        next.every((day, index) => day === current.participatingDays[index])
      ) {
        return current;
      }
      return { ...current, participatingDays: next };
    });
  }, [availableEventDays, supportsParticipatingDays]);

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
    if (field.key === "parentConfirmed") {
      return null;
    }

    if (!event.overnight && isRoomRelatedStandardFieldKey(field.key)) {
      return null;
    }

    const value = values.answers[field.key];
    const isRequired =
      field.key === "birthDate" ||
      field.key === "genderRoleCategory" ||
      field.key === "unitName";

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

    if (isRoomRelatedStandardFieldKey(field.key) && field.key !== "roomNotes") {
      return (
        <RoomMateField
          key={field.key}
          label={field.label}
          helpText={field.helpText}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          stakeId={event.stakeId}
          inputClassName={getInputClass(field.key)}
          labelNode={renderFieldLabel(field.label, field.key)}
          errorNode={fieldErrors[field.key] ? renderFieldHint(field.key, field.helpText) : null}
          onChange={(nextValue) => {
            clearFieldError(field.key);
            updateAnswer(field.key, nextValue);
          }}
        />
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

    if (flowLayout && currentStepIndex > 0 && Date.now() - stepEnteredAtRef.current < 600) {
      return;
    }

    const fullName = `${values.firstName.trim()} ${values.lastName.trim()}`.trim();
    const category = getGenderRoleCategory(values.category);
    const youthGroup = getYouthGroupLabel(category);
    const consentAcceptedAt = new Date().toISOString();
    const medicalText = (key: StandardFieldKey, fallback: string) => {
      const answer = values.answers[key];
      return (typeof answer === "string" ? answer : fallback).trim();
    };

    // Quando l'attività richiede autorizzazione magic-link al genitore e il
    // partecipante è minorenne, raccogliamo i dati del genitore qui e settiamo
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
          allergies: medicalText("allergies", values.allergies),
          medications: values.medications.trim(),
          medicalNotes: medicalText("medicalNotes", values.medicalNotes),
          dietaryNotes: medicalText("dietaryNotes", values.dietaryNotes),
          submittedAt: consentAcceptedAt,
        }
      : null;

    const nextRegistrationStatus = (() => {
      if (
        existingRegistration?.registrationStatus
        && existingRegistration.registrationStatus !== "cancelled"
      ) {
        // Update di iscrizione esistente: preservo lo stato (la Cloud Function
        // lo cambia solo dopo conferma/rifiuto del genitore).
        return existingRegistration.registrationStatus;
      }
      // Iscrizione annullata risalvata: vale come nuova iscrizione, altrimenti
      // il modulo si salvava restando "annullata" senza dirlo a nessuno.
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
        ...(parentAuthRequestPayload
          ? {
              parentAuthorizationRequest:
                parentAuthRequestPayload as unknown as RegistrationAnswerValue,
            }
          : {}),
      },
      registrationStatus: nextRegistrationStatus,
      // Il modulo non annulla mai: l'annullamento passa da cancelRegistration.
      status: "active",
      participatingDays: supportsParticipatingDays
        ? values.participatingDays.filter((day) => availableEventDays.includes(day))
        : undefined,
      pendingQuestions: event.questionsEnabled
        ? values.pendingQuestions
            .map((draft) => ({
              text: draft.text.trim(),
              isAnonymous: Boolean(draft.isAnonymous),
            }))
            .filter((draft) => draft.text.length > 0)
        : undefined,
    });
  }

  return (
    <form
      className="form-stack"
      onChangeCapture={() => {
        touchedRef.current = true;
      }}
      onInputCapture={() => {
        touchedRef.current = true;
      }}
      // La firma sul canvas non genera input: conta il tocco.
      onPointerDownCapture={(eventInput) => {
        if ((eventInput.target as HTMLElement).tagName === "CANVAS") {
          touchedRef.current = true;
        }
      }}
      onSubmit={handleSubmit}
    >
      <div
        className={
          flowLayout
            ? "form-stepper form-stepper--registration form-stepper--flow"
            : "form-stepper form-stepper--registration"
        }
      >
        {flowLayout ? (
          <div className="form-stepper__flow-progress">
            <p className="form-stepper__flow-count">
              <strong>
                Passo {currentStepIndex + 1} di {registrationSteps.length}
              </strong>{" "}
              · {currentStep.title}
            </p>
            <div aria-hidden="true" className="form-stepper__segments">
              {registrationSteps.map((step, index) => (
                <span
                  className={
                    index === currentStepIndex
                      ? "form-stepper__segment form-stepper__segment--on"
                      : index < currentStepIndex
                        ? "form-stepper__segment form-stepper__segment--done"
                        : "form-stepper__segment"
                  }
                  key={step.id}
                />
              ))}
            </div>
          </div>
        ) : (
        <div className="form-stepper__progress">
          <div className="form-stepper__progress-meta">
            <span className="form-stepper__progress-count">
              Passo {currentStepIndex + 1} di {registrationSteps.length}
            </span>
          </div>
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

        )}

        <div key={currentStep.id} className="form-stepper__panel">
          <div className="form-stepper__panel-head">
            {flowLayout ? (
              <h1 className="auth-screen__title" ref={stepTitleRef} tabIndex={-1}>
                {currentStep.title}
              </h1>
            ) : (
              <>
                <h3>{currentStep.title}</h3>
                <p>{currentStep.description}</p>
              </>
            )}
          </div>
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
              {supportsParticipatingDays && availableEventDays.length > 1 ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Giorni di partecipazione</h3>
                  <p className="subtle-text">
                    Seleziona i giorni in cui sarai presente. Per default sono selezionati tutti.
                  </p>
                  <div className="participating-days-grid">
                    {availableEventDays.map((day) => {
                      const checked = values.participatingDays.includes(day);
                      return (
                        <label key={day} className="participating-day-chip">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(eventInput) => {
                              const next = eventInput.target.checked
                                ? [...values.participatingDays, day]
                                : values.participatingDays.filter((d) => d !== day);
                              setValues((current) => ({
                                ...current,
                                participatingDays: availableEventDays.filter((d) =>
                                  next.includes(d),
                                ),
                              }));
                            }}
                          />
                          <span>
                            {new Date(day).toLocaleDateString("it-IT", {
                              weekday: "short",
                              day: "2-digit",
                              month: "short",
                            })}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {!hasVisibleQuestions ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Tutto pronto</h3>
                  <p>Conferma qui sotto per iscriverti.</p>
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

              {showAdultPhotoConsent ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Foto e video (consensi facoltativi)</h3>
                  <p className="subtle-text">
                    Sei maggiorenne, quindi i consensi li esprimi tu direttamente.
                    Sono <strong>facoltativi</strong>: il rifiuto non impedisce la
                    partecipazione all&apos;attività. Maggiori dettagli nella{" "}
                    <Link to="/privacy/photos">informativa fotografie</Link>.
                  </p>

                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={values.answers.adultPhotoConsent === true}
                      onChange={(eventInput) =>
                        updateAnswer("adultPhotoConsent", eventInput.target.checked)
                      }
                    />
                    <span>
                      <strong>Acconsento alla realizzazione di foto e video</strong>
                      <small>
                        Foto e video realizzati durante l&apos;attività per uso interno
                        e documentazione (album dell&apos;attività, materiale per le famiglie
                        partecipanti).
                      </small>
                    </span>
                  </label>

                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={values.answers.adultSocialPublicationConsent === true}
                      onChange={(eventInput) =>
                        updateAnswer(
                          "adultSocialPublicationConsent",
                          eventInput.target.checked,
                        )
                      }
                    />
                    <span>
                      <strong>Acconsento alla pubblicazione su canali pubblici</strong>
                      <small>
                        Pubblicazione delle immagini su sito web, social media e materiale
                        promozionale dell&apos;Organizzazione. Consenso separato e
                        facoltativo.
                      </small>
                    </span>
                  </label>
                </div>
              ) : null}

              {formConfig.customFields.length > 0 ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Domande aggiuntive</h3>
                  <div className="form-stack">
                    {formConfig.customFields.map((field) => renderCustomField(field))}
                  </div>
                </div>
              ) : null}

            </div>
          ) : null}

          {currentStep.id === "parent" ? (
            <div className="form-stack">
              {parentAccount ? (
                <>
                  {parentPrefilledFromAccount ? (
                    <p className="flow-banner flow-banner--ok">
                      <AppIcon name="check" />
                      <span>{ISCRIZIONE.datiAccountInseriti}</span>
                    </p>
                  ) : null}
                </>
              ) : parentStepNotice !== "nessuno" && parentStepNotice !== "autorizza_ora" ? (
                // "Autorizza ora" vale solo per i figli di un account genitore.
                <div className="form-info-banner">
                  <strong>
                    {hasPrefilledParentContacts
                      ? "Controlla i dati del genitore o tutore"
                      : "Dati genitore o tutore richiesti"}
                  </strong>
                  {parentStepNotice === "nuovo_link" ? (
                    <span>
                      Dopo l&apos;invio invieremo al genitore un&apos;email con un link unico
                      per autorizzare la partecipazione. L&apos;iscrizione sarà in stato
                      <em> &quot;in attesa autorizzazione&quot; </em>
                      finché il genitore non conferma. Il link scade dopo 14 giorni.
                    </span>
                  ) : parentStepNotice === "autorizzata" ? (
                    <span>{INVIATA.autorizzataIo}</span>
                  ) : parentStepNotice === "rifiutata" ? (
                    <span className="form-info-banner__warning">
                      {ISCRIZIONE.genitoreHaRifiutato}
                    </span>
                  ) : parentStepNotice === "mail_fallita" ? (
                    <>
                      <span className="form-info-banner__warning">
                        {INVIATA.genitoreMailFallita}
                      </span>
                      <span>{ISCRIZIONE.nuovoLinkSeCambi}</span>
                    </>
                  ) : (
                    <span>
                      {fillCopy(
                        parentStepNotice === "scritto"
                          ? INVIATA.genitoreScritto
                          : INVIATA.genitoreInInvio,
                        { email: parentStepEmail },
                      )}{" "}
                      {ISCRIZIONE.nuovoLinkSeCambi}
                    </span>
                  )}
                </div>
              ) : null}

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
                      parentStepNoticeSendsLink(parentStepNotice)
                        ? ISCRIZIONE.emailGenitoreSuggerimento
                        : undefined,
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

              {parentAccount && parentStepNotice === "nuovo_link" ? (
                <p className="flow-banner">
                  <AppIcon name="mail" />
                  <span>
                    {fillCopy(ISCRIZIONE.linkDopoInvio, {
                      nome: childFirstName || ISCRIZIONE.tuoFiglio,
                    })}
                  </span>
                </p>
              ) : null}

              {eventRequiresEmergencyContacts ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Contatto di emergenza</h3>
                  <p className="subtle-text">
                    Persona da contattare in caso di urgenza durante l&apos;attività
                    (può coincidere con il genitore se preferisci).
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

              {eventRequiresMedicalNotes || eventRequiresParentAuthorization ? (
                <div className="surface-panel surface-panel--subtle form-subsection">
                  <h3>Note mediche e alimentari</h3>
                  <p className="subtle-text">{ISCRIZIONE.noteMedicheIntro}</p>
                  <div className="form-stack">
                    {eventRequiresMedicalNotes && !hasStandardAllergiesField ? (
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
                    ) : null}

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
                        placeholder={ISCRIZIONE.farmaciPlaceholder}
                      />
                    </label>

                    {eventRequiresMedicalNotes && !hasStandardMedicalNotesField ? (
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
                    ) : null}

                    {eventRequiresMedicalNotes && !hasStandardDietaryNotesField ? (
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
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {currentStep.id === "questions" ? (
            <div className="form-stack">
              <div className="form-info-banner">
                <strong>Domande facoltative per il caminetto</strong>
                <span>
                  Scrivi una o più domande per il Settanta. Puoi inviarle in forma
                  anonima. Salta lo step se non vuoi farne nessuna: l&apos;iscrizione si
                  conclude lo stesso al passo successivo.
                </span>
              </div>

              {values.pendingQuestions.length === 0 ? (
                <p className="subtle-text">
                  Nessuna domanda inserita. Aggiungi sotto se vuoi farne una.
                </p>
              ) : (
                <ul className="plain-list">
                  {values.pendingQuestions.map((draft, index) => (
                    <li key={`pending-question-${index}`} className="form-subsection">
                      <label className="field">
                        <span className="field__label">Domanda {index + 1}</span>
                        <textarea
                          className="input input--textarea"
                          maxLength={2000}
                          rows={3}
                          value={draft.text}
                          onChange={(eventInput) => {
                            const nextText = eventInput.target.value;
                            setValues((current) => ({
                              ...current,
                              pendingQuestions: current.pendingQuestions.map((entry, i) =>
                                i === index ? { ...entry, text: nextText } : entry,
                              ),
                            }));
                          }}
                        />
                      </label>
                      <label className="toggle-field">
                        <input
                          checked={draft.isAnonymous}
                          onChange={(eventInput) => {
                            const nextAnon = eventInput.target.checked;
                            setValues((current) => ({
                              ...current,
                              pendingQuestions: current.pendingQuestions.map((entry, i) =>
                                i === index ? { ...entry, isAnonymous: nextAnon } : entry,
                              ),
                            }));
                          }}
                          type="checkbox"
                        />
                        <span>Invia in forma anonima (senza nome)</span>
                      </label>
                      <div className="inline-actions">
                        <button
                          className="button button--ghost button--small"
                          onClick={() =>
                            setValues((current) => ({
                              ...current,
                              pendingQuestions: current.pendingQuestions.filter(
                                (_, i) => i !== index,
                              ),
                            }))
                          }
                          type="button"
                        >
                          <AppIcon name="trash" />
                          <span>Rimuovi</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="inline-actions">
                <button
                  className="button button--soft"
                  onClick={() =>
                    setValues((current) => ({
                      ...current,
                      pendingQuestions: [
                        ...current.pendingQuestions,
                        { text: "", isAnonymous: false },
                      ],
                    }))
                  }
                  type="button"
                >
                  <AppIcon name="plus" />
                  <span>Aggiungi domanda</span>
                </button>
              </div>

              {existingRegistration ? (
                <p className="subtle-text">
                  Hai già inviato l&apos;iscrizione: le domande già salvate
                  in precedenza puoi gestirle dalla pagina dell&apos;attività nella
                  sezione &quot;Domande per il caminetto&quot;.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {flowLayout ? (
          <div className={keyboardOpen ? "auth-foot auth-foot--inline" : "auth-foot"}>
            <div
              className={
                currentStepIndex > 0
                  ? "flow-foot-actions flow-foot-actions--two form-stepper__flow-actions"
                  : "flow-foot-actions form-stepper__flow-actions"
              }
            >
              {currentStepIndex > 0 ? (
                <button
                  className="button button--ghost button--large"
                  disabled={busy}
                  onClick={() => {
                    setFieldErrors({});
                    setCurrentStepIndex((current) => Math.max(current - 1, 0));
                  }}
                  type="button"
                >
                  <span>{PROFILO.indietro}</span>
                </button>
              ) : null}
              <button className="button button--primary button--large" disabled={busy} type="submit">
                {busy ? PROFILO.salvataggio : isLastStep ? submitLabel : PROFILO.continua}
              </button>
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </form>
  );
}
