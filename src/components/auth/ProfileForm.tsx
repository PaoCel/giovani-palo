import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { AppIcon } from "@/components/AppIcon";
import { AdultGuardCard } from "@/components/register/AdultGuardCard";
import { italianMunicipalityOptions } from "@/config/cityOptions";
import { fillCopy } from "@/copy/parole";
import { PROFILO } from "@/copy/profilo";
import { useAuth } from "@/hooks/useAuth";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { toUserFacingAuthError } from "@/services/firebase/debug";
import type { AuthSession, GenderRoleCategory, OrganizationProfile } from "@/types";
import { getAdultGuardAge, getAdultGuardSentence, isAdultCategory } from "@/utils/adultGuard";
import { readPendingAccountProfile } from "@/utils/pendingAccountProfile";
import { deleteProfileDraft, readProfileDraft, writeProfileDraft } from "@/utils/profileDrafts";
import { isConnectionError, isOffline, withWriteTimeout } from "@/utils/writeTimeout";
import {
  BIRTH_DATE_MIN,
  canBecomeParent,
  isAcceptableBirthDate,
  isEmailDerivedName,
  isPlaceholderName,
  toCalendarDateValue,
} from "@/utils/profileCompletion";

import "@/styles/registerFlow.css";

export type ProfileVariant = "io" | "genitore";

// Guardia adulto al «Continua» della data di nascita (docs/FLUSSO_GENITORE.md,
// G): solo dentro un'iscrizione e solo per chi partecipa lui.
export interface ProfileAdultGuard {
  // Primo giorno dell'attività: l'età si conta lì.
  firstDay: Date;
  // Profilo già salvato (aperto dalla guardia del modulo o da un genitore
  // senza figli): cambia il testo sotto "Iscrivo mio figlio o mia figlia".
  existingAccount: boolean;
  isConfirmed: (birthDate: string) => boolean;
  onConfirm: (birthDate: string) => void;
  onChooseChild: () => void;
}

interface ProfileFormProps {
  organization: OrganizationProfile;
  // "genitore": nome, cognome, comune e unità; "io": nome, cognome e data di
  // nascita, poi organizzazione e unità (come prima).
  variant: ProfileVariant;
  title: string;
  lead: string;
  // Organizzazione già scelta («Chi sei?»: dirigente o accompagnatore).
  presetCategory?: GenderRoleCategory;
  // Sopra il titolo: per esempio "Sono un genitore · Cambia".
  context?: ReactNode;
  // Sotto i campi del genitore: "Hai meno di 18 anni? Sei tu a partecipare".
  aside?: ReactNode;
  submitLabel: string;
  footNote?: string;
  // Al primo passo il focus va sul titolo (cambio di passo nell'iscrizione).
  autoFocusTitle?: boolean;
  adultGuard?: ProfileAdultGuard;
  // Dalla guardia in cima al modulo: "dirigente" apre Organizzazione con
  // Dirigente già scelto, "data" mette il cursore sulla data di nascita.
  start?: "data" | "dirigente";
  // Risposte non salvate da ritrovare tornando qui nella stessa attività
  // ("Cambia" e poi di nuovo "Partecipo io"). Senza chiave, nessuna memoria.
  draftKey?: string;
  onSubmitStart?: () => void;
  onSaved?: (session: AuthSession) => void;
}

const MANUAL_UNIT_VALUE = "__manual_unit__";

const CATEGORY_OPTIONS: ReadonlyArray<{ value: GenderRoleCategory; label: string }> = [
  { value: "giovane_uomo", label: PROFILO.giovaneUomo },
  { value: "giovane_donna", label: PROFILO.giovaneDonna },
  { value: "dirigente", label: PROFILO.dirigente },
  { value: "accompagnatore", label: PROFILO.accompagnatore },
];

function splitFullName(value: string | null | undefined) {
  if (!value || isPlaceholderName(value)) {
    return { firstName: "", lastName: "" };
  }

  const parts = value.trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

function normalizeUnitName(value: string) {
  return value.trim().toLocaleLowerCase("it-IT");
}

function isConfiguredUnit(unitOptions: string[], unitName: string) {
  return unitOptions.some((unit) => normalizeUnitName(unit) === normalizeUnitName(unitName));
}

function buildInitialState(session: AuthSession | null, presetCategory?: GenderRoleCategory) {
  const profile = session?.profile;
  const email = session?.firebaseUser.email || profile?.email || "";
  // Il nome preso dall'email non si propone: lo scrive la persona.
  const names = isEmailDerivedName(profile?.fullName, email)
    ? { firstName: "", lastName: "" }
    : splitFullName(profile?.fullName);
  const pending = readPendingAccountProfile();

  return {
    firstName: names.firstName || pending?.firstName || "",
    lastName: names.lastName || pending?.lastName || "",
    birthDate: profile?.birthDate || pending?.birthDate || "",
    genderRoleCategory: (profile?.genderRoleCategory ||
      pending?.genderRoleCategory ||
      presetCategory ||
      "") as GenderRoleCategory | "",
    unitName: profile?.unitName || pending?.unitName || "",
    city: profile?.city || "",
  };
}

type ProfileValues = ReturnType<typeof buildInitialState>;

// "I tuoi dati" (docs/FLUSSO_GENITORE.md, D): niente è scritto sul profilo
// finché non si preme il pulsante in fondo. Il salvataggio decide anche il tipo
// di account (genitore o partecipante), solo per chi può sceglierlo.
export function ProfileForm({
  organization,
  variant: requestedVariant,
  title,
  lead,
  presetCategory,
  context,
  aside,
  submitLabel,
  footNote,
  autoFocusTitle = false,
  adultGuard,
  start,
  draftKey,
  onSubmitStart,
  onSaved,
}: ProfileFormProps) {
  const { session, completeProfile, completeParentProfile } = useAuth();
  const cityOptionsListId = useId();
  const titleId = useId();
  const keyboardOpen = useKeyboardOpen();
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const messageRef = useRef<HTMLDivElement | null>(null);
  const focusedOnceRef = useRef(false);
  const birthDateRef = useRef<HTMLInputElement | null>(null);
  const role = session?.profile.role ?? "participant";
  // Dirigenti e admin non diventano genitori da qui (le rules non lo
  // permettono), né chi ha già una data di nascita da minore: completano i
  // loro dati.
  const variant: ProfileVariant =
    requestedVariant === "genitore" &&
    canBecomeParent(role, session?.profile.birthDate, new Date())
      ? "genitore"
      : "io";
  const [values, setValues] = useState<ProfileValues>(() => {
    const base =
      (draftKey ? readProfileDraft(draftKey) : undefined) ??
      buildInitialState(session, presetCategory);
    return start === "dirigente" ? { ...base, genderRoleCategory: "dirigente" } : base;
  });
  // "Partecipo come dirigente" apre Organizzazione solo se nome, cognome e
  // data (anche di una bozza) reggono: altrimenti si riparte da lì.
  const [step, setStep] = useState(() =>
    start === "dirigente" &&
    variant === "io" &&
    values.firstName.trim() &&
    values.lastName.trim() &&
    isAcceptableBirthDate(values.birthDate, new Date())
      ? 1
      : 0,
  );
  // Età che ha fatto scattare la guardia: la scheda resta finché non si sceglie.
  const [guardAge, setGuardAge] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unitOptions = useMemo(() => organization.units.filter(Boolean), [organization.units]);
  const hasConfiguredUnits = unitOptions.length > 0;
  const canUseManualUnit = Boolean(session?.isAdmin);
  const [manualUnitMode, setManualUnitMode] = useState(() =>
    Boolean(
      session?.isAdmin &&
        (!unitOptions.length ||
          (session.profile.unitName && !isConfiguredUnit(unitOptions, session.profile.unitName))),
    ),
  );
  const totalSteps = variant === "io" ? 2 : 1;
  const today = useMemo(() => new Date(), []);
  const todayValue = toCalendarDateValue(today);
  const isLastStep = step >= totalSteps - 1;

  // Cambiare percorso ("Sei tu a partecipare", o "Iscrivo mio figlio" dalla
  // guardia) riparte dal primo passo con nome e cognome già scritti.
  const previousVariantRef = useRef(variant);
  useEffect(() => {
    if (previousVariantRef.current === variant) {
      return;
    }

    previousVariantRef.current = variant;
    setStep(0);
    setError(null);
    setGuardAge(null);
  }, [variant]);

  useEffect(() => {
    if (draftKey) {
      writeProfileDraft(draftKey, values);
    }
  }, [draftKey, values]);

  // Passo nuovo (o percorso cambiato): il focus va al titolo, così si
  // riparte dall'alto. Al primo render solo se richiesto.
  useEffect(() => {
    if (!focusedOnceRef.current) {
      focusedOnceRef.current = true;

      // "Ho sbagliato la data" dalla guardia del modulo: cursore sul campo,
      // dopo il primo disegno (vince anche su un secondo giro dell'effetto).
      if (start === "data") {
        window.requestAnimationFrame(() => birthDateRef.current?.focus());
        return;
      }

      if (!autoFocusTitle) {
        return;
      }
    }

    titleRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step, variant, autoFocusTitle]);

  // L'errore arriva dopo il tocco sulla CTA in fondo: va in vista, sopra il
  // piede fisso.
  useEffect(() => {
    if (!error) {
      return;
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    messageRef.current?.scrollIntoView({
      block: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [error]);

  function update<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);

    // Una data nuova si guarda di nuovo al «Continua».
    if (key === "birthDate") {
      setGuardAge(null);
    }
  }

  function validateStep(currentStep: number) {
    if (currentStep === 0) {
      if (!values.firstName.trim() || !values.lastName.trim()) {
        return PROFILO.erroreNome;
      }

      if (variant === "io") {
        if (!values.birthDate) {
          return PROFILO.erroreDataNascita;
        }

        if (!isAcceptableBirthDate(values.birthDate, today)) {
          return PROFILO.erroreDataNonValida;
        }

        return null;
      }
    }

    if (variant === "io" && !values.genderRoleCategory) {
      return PROFILO.erroreOrganizzazione;
    }

    const unitName = values.unitName.trim();

    if (!unitName) {
      return PROFILO.erroreUnita;
    }

    if (variant === "genitore" && !values.city.trim()) {
      return PROFILO.erroreComune;
    }

    if (!canUseManualUnit && (!hasConfiguredUnits || !isConfiguredUnit(unitOptions, unitName))) {
      return PROFILO.erroreUnitaElenco;
    }

    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy || !session) {
      return;
    }

    const nextError = validateStep(step);

    if (nextError) {
      setError(nextError);
      return;
    }

    // Chi partecipa con almeno 19 anni il primo giorno sceglie prima di
    // andare avanti; dirigenti e accompagnatori già scelti no.
    if (
      step === 0 &&
      variant === "io" &&
      adultGuard &&
      !isAdultCategory(values.genderRoleCategory) &&
      !adultGuard.isConfirmed(values.birthDate)
    ) {
      const age = getAdultGuardAge(values.birthDate, adultGuard.firstDay);

      if (age !== null) {
        setGuardAge(age);
        return;
      }
    }

    if (!isLastStep) {
      setStep((current) => current + 1);
      return;
    }

    // Il passo di prima si ricontrolla prima di scrivere: nomi o data possono
    // essere cambiati con la guardia aperta, o arrivare da una bozza.
    if (step > 0) {
      const firstStepError = validateStep(0);

      if (firstStepError) {
        setStep(0);
        setError(firstStepError);
        return;
      }
    }

    // Senza rete la scrittura del profilo aspetterebbe il server per sempre.
    if (isOffline()) {
      setError(PROFILO.erroreRete);
      return;
    }

    setBusy(true);
    setError(null);
    onSubmitStart?.();

    try {
      const nextSession = await withWriteTimeout(
        variant === "genitore"
          ? completeParentProfile({
              firstName: values.firstName.trim(),
              lastName: values.lastName.trim(),
              unitName: values.unitName.trim(),
              city: values.city.trim(),
              stakeId: organization.stakeId,
            })
          : completeProfile({
              firstName: values.firstName.trim(),
              lastName: values.lastName.trim(),
              birthDate: values.birthDate,
              genderRoleCategory: values.genderRoleCategory as GenderRoleCategory,
              unitName: values.unitName.trim(),
              stakeId: organization.stakeId,
              // Account nato da genitore che partecipa lui: cambia nella stessa scrittura.
              ...(role === "parent" ? { role: "participant" as const } : {}),
            }),
      );
      if (draftKey) {
        deleteProfileDraft(draftKey);
      }

      onSaved?.(nextSession);
    } catch (caughtError) {
      setError(
        isConnectionError(caughtError) ? PROFILO.erroreRete : toUserFacingAuthError(caughtError),
      );
    } finally {
      setBusy(false);
    }
  }

  const showManualUnitInput =
    canUseManualUnit &&
    (!hasConfiguredUnits ||
      manualUnitMode ||
      (values.unitName.trim() && !isConfiguredUnit(unitOptions, values.unitName)));
  const unitSelectValue = showManualUnitInput ? MANUAL_UNIT_VALUE : values.unitName;
  const showNames = step === 0;
  const showBelonging = variant === "genitore" || step === 1;
  const submitDisabled = busy || (variant === "io" && step === 0 && !values.birthDate);
  const guardOpen = guardAge !== null && adultGuard !== undefined;
  // Scegliendo un gruppo dei giovani resta la riga "Il … avrai 47 anni.".
  const guardLineAge =
    adultGuard &&
    variant === "io" &&
    (values.genderRoleCategory === "giovane_uomo" || values.genderRoleCategory === "giovane_donna")
      ? getAdultGuardAge(values.birthDate, adultGuard.firstDay)
      : null;

  const unitField = (
    <label className="field">
      <span>{PROFILO.unita}</span>
      {hasConfiguredUnits ? (
        <select
          className="input"
          value={unitSelectValue}
          onChange={(eventInput) => {
            const { value } = eventInput.target;

            if (value === MANUAL_UNIT_VALUE) {
              setManualUnitMode(true);
              update(
                "unitName",
                isConfiguredUnit(unitOptions, values.unitName) ? "" : values.unitName,
              );
              return;
            }

            setManualUnitMode(false);
            update("unitName", value);
          }}
        >
          <option value="">{PROFILO.selezionaUnita}</option>
          {unitOptions.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
          {canUseManualUnit ? (
            <option value={MANUAL_UNIT_VALUE}>{PROFILO.unitaNonInElenco}</option>
          ) : null}
        </select>
      ) : canUseManualUnit ? null : (
        <select className="input" disabled value="">
          <option value="">{PROFILO.nessunaUnita}</option>
        </select>
      )}

      {showManualUnitInput ? (
        <input
          className="input"
          placeholder={PROFILO.scriviUnita}
          value={values.unitName}
          onChange={(eventInput) => update("unitName", eventInput.target.value)}
        />
      ) : null}

      <small>
        {showManualUnitInput
          ? PROFILO.aiutoUnitaManuale
          : hasConfiguredUnits
            ? fillCopy(PROFILO.aiutoPalo, { palo: organization.stakeName })
            : PROFILO.aiutoNessunaUnita}
      </small>
    </label>
  );

  return (
    <section aria-labelledby={titleId} className="auth-screen">
      {context}

      <div className="auth-screen__copy">
        {totalSteps > 1 ? (
          <p className="flow-step-count">
            {fillCopy(PROFILO.passoDi, { n: String(step + 1), totale: String(totalSteps) })}
          </p>
        ) : null}
        <h1 className="auth-screen__title" id={titleId} ref={titleRef} tabIndex={-1}>
          {title}
        </h1>
        <p className="auth-screen__lead">{lead}</p>
      </div>

      <form className="auth-panel__form" id={`${titleId}-form`} noValidate onSubmit={handleSubmit}>
        {showNames ? (
          <div className="flow-name-row">
            <label className="field">
              <span>{PROFILO.nome}</span>
              <input
                autoComplete="given-name"
                className="input"
                value={values.firstName}
                onChange={(eventInput) => update("firstName", eventInput.target.value)}
              />
            </label>
            <label className="field">
              <span>{PROFILO.cognome}</span>
              <input
                autoComplete="family-name"
                className="input"
                value={values.lastName}
                onChange={(eventInput) => update("lastName", eventInput.target.value)}
              />
            </label>
          </div>
        ) : null}

        {variant === "io" && step === 0 ? (
          <label className="field">
            <span>{PROFILO.dataNascita}</span>
            <input
              autoComplete="bday"
              className={guardOpen ? "input input--guard" : "input"}
              max={todayValue}
              min={BIRTH_DATE_MIN}
              ref={birthDateRef}
              type="date"
              value={values.birthDate}
              onChange={(eventInput) => update("birthDate", eventInput.target.value)}
            />
          </label>
        ) : null}

        {guardOpen && adultGuard && guardAge !== null ? (
          <AdultGuardCard
            age={guardAge}
            existingAccount={adultGuard.existingAccount}
            firstDay={adultGuard.firstDay}
            headingLevel="h2"
            onChooseAdult={() => {
              setValues((current) => ({ ...current, genderRoleCategory: "dirigente" }));
              setGuardAge(null);
              setStep(1);
            }}
            onChooseChild={() => {
              setGuardAge(null);
              adultGuard.onChooseChild();
            }}
            onConfirm={() => {
              adultGuard.onConfirm(values.birthDate);
              setGuardAge(null);
              setStep(1);
            }}
            onWrongDate={() => {
              setGuardAge(null);
              window.requestAnimationFrame(() => birthDateRef.current?.focus());
            }}
          />
        ) : null}

        {variant === "io" && step === 1 ? (
          <fieldset className="flow-pills">
            <legend>{PROFILO.organizzazione}</legend>
            <div className="flow-pills__options">
              {CATEGORY_OPTIONS.map((option) => (
                <label
                  className={
                    values.genderRoleCategory === option.value
                      ? "flow-pill flow-pill--selected"
                      : "flow-pill"
                  }
                  key={option.value}
                >
                  <input
                    checked={values.genderRoleCategory === option.value}
                    name={`${titleId}-categoria`}
                    onChange={() => update("genderRoleCategory", option.value)}
                    type="radio"
                    value={option.value}
                  />
                  {values.genderRoleCategory === option.value ? <AppIcon name="check" /> : null}
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {guardLineAge !== null && adultGuard ? (
              <p className="flow-guard-line">
                <AppIcon name="alert" />
                <span>{getAdultGuardSentence(guardLineAge, adultGuard.firstDay).text}</span>
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {variant === "genitore" ? (
          <label className="field">
            <span>{PROFILO.comune}</span>
            <input
              autoComplete="address-level2"
              className="input"
              list={cityOptionsListId}
              value={values.city}
              onChange={(eventInput) => update("city", eventInput.target.value)}
              placeholder={PROFILO.comunePlaceholder}
            />
            <datalist id={cityOptionsListId}>
              {italianMunicipalityOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>
        ) : null}

        {showBelonging ? unitField : null}

        {variant === "genitore" ? aside : null}

        {error ? (
          <div className="auth-panel__message" ref={messageRef}>
            <div className="form-error" role="alert">
              {error}
            </div>
          </div>
        ) : null}
      </form>

      {/* Con la guardia aperta si sceglie nella scheda: niente «Continua». */}
      {guardOpen ? null : (
        <div className={keyboardOpen ? "auth-foot auth-foot--inline" : "auth-foot"}>
          <div className={step > 0 ? "flow-foot-actions flow-foot-actions--two" : "flow-foot-actions"}>
            {step > 0 ? (
              <button
                className="button button--ghost button--large"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setStep((current) => Math.max(current - 1, 0));
                }}
                type="button"
              >
                <AppIcon name="arrow-left" />
                <span>{PROFILO.indietro}</span>
              </button>
            ) : null}
            <button
              className="button button--primary button--large"
              disabled={submitDisabled}
              form={`${titleId}-form`}
              type="submit"
            >
              {busy ? PROFILO.salvataggio : isLastStep ? submitLabel : PROFILO.continua}
            </button>
          </div>
          {footNote ? <p className="auth-foot__note">{footNote}</p> : null}
        </div>
      )}
    </section>
  );
}
