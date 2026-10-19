import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { AppIcon } from "@/components/AppIcon";
import { italianMunicipalityOptions } from "@/config/cityOptions";
import { fillCopy } from "@/copy/parole";
import { PROFILO } from "@/copy/profilo";
import { useAuth } from "@/hooks/useAuth";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { toUserFacingAuthError } from "@/services/firebase/debug";
import type { AuthSession, GenderRoleCategory, OrganizationProfile } from "@/types";
import { readPendingAccountProfile } from "@/utils/pendingAccountProfile";
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
  const role = session?.profile.role ?? "participant";
  // Dirigenti e admin non diventano genitori da qui (le rules non lo
  // permettono), né chi ha già una data di nascita da minore: completano i
  // loro dati.
  const variant: ProfileVariant =
    requestedVariant === "genitore" &&
    canBecomeParent(role, session?.profile.birthDate, new Date())
      ? "genitore"
      : "io";
  const [values, setValues] = useState(() => buildInitialState(session, presetCategory));
  const [step, setStep] = useState(0);
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

  // Cambiare percorso ("Sei tu a partecipare") riparte dal primo passo con
  // nome e cognome già scritti.
  useEffect(() => {
    setStep(0);
    setError(null);
  }, [variant]);

  // Passo nuovo (o percorso cambiato): il focus va al titolo, così si
  // riparte dall'alto. Al primo render solo se richiesto.
  useEffect(() => {
    if (!focusedOnceRef.current) {
      focusedOnceRef.current = true;

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

    if (!isLastStep) {
      setStep((current) => current + 1);
      return;
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
              className="input"
              max={todayValue}
              min={BIRTH_DATE_MIN}
              type="date"
              value={values.birthDate}
              onChange={(eventInput) => update("birthDate", eventInput.target.value)}
            />
          </label>
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
    </section>
  );
}
