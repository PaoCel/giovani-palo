import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { AppLoader } from "@/components/AppLoader";
import { italianMunicipalityOptions } from "@/config/cityOptions";
import { ACCEDI } from "@/copy/accedi";
import { fillCopy } from "@/copy/parole";
import { useAuth } from "@/hooks/useAuth";
import { toUserFacingAuthError } from "@/services/firebase/debug";
import type { GenderRoleCategory, OrganizationProfile } from "@/types";
import { isRecordNightPath } from "@/utils/activityLinks";
import { getRoleLabel } from "@/utils/roles";
import {
  clearPendingAccountProfile,
  readPendingAccountProfile,
} from "@/utils/pendingAccountProfile";

export type AuthMode = "login" | "signup";

interface AuthAccessPanelProps {
  organization: OrganizationProfile;
  redirect?: string | null;
  // Scheda aperta all'arrivo: "Accedi" salvo link espliciti a "Crea un account".
  initialMode?: AuthMode;
  description?: string;
  backAction?: ReactNode;
}

interface ProfileStepItem {
  title: string;
  description: string;
  icon: AppIconName;
}

interface AuthFieldErrors {
  email?: boolean;
  password?: boolean;
  confirmPassword?: boolean;
}

const MANUAL_UNIT_VALUE = "__manual_unit__";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const profileSteps: ProfileStepItem[] = [
  {
    title: "Identità",
    description: "Nome, cognome e data di nascita.",
    icon: "user",
  },
  {
    title: "Appartenenza",
    description: "Organizzazione e unità di riferimento.",
    icon: "users",
  },
];
const parentProfileSteps: ProfileStepItem[] = [
  {
    title: "Identità",
    description: "Nome e cognome del genitore.",
    icon: "user",
  },
  {
    title: "Appartenenza",
    description: "Rione o ramo e comune.",
    icon: "users",
  },
];

function isPlaceholderName(value: string | null | undefined) {
  return !value || value === "Partecipante";
}

function needsProfileCompletion(session: ReturnType<typeof useAuth>["session"]) {
  if (!session || session.isAnonymous) {
    return false;
  }

  // Per i genitori i dati anagrafici (data di nascita, gruppo, unità) vivono
  // sui profili figli: per l'account basta il nome.
  if (session.isParent) {
    return (
      isPlaceholderName(session.profile.fullName) ||
      !session.profile.unitName ||
      !session.profile.stakeId ||
      !session.profile.city
    );
  }

  return (
    isPlaceholderName(session.profile.fullName) ||
    !session.profile.birthDate ||
    !session.profile.genderRoleCategory ||
    !session.profile.unitName ||
    !session.profile.stakeId
  );
}

function getRoleHome(session: NonNullable<ReturnType<typeof useAuth>["session"]>) {
  return session.isAdmin
    ? "/admin"
    : session.isUnitLeader
      ? "/unit"
      : session.isParent
        ? "/family"
        : "/me";
}

function isCampManagementAdminPath(pathname: string) {
  return /^\/admin\/events\/[^/]+\/(committees|comitati)$/.test(pathname.split("?")[0]);
}

function isCompatibleRedirect(
  session: NonNullable<ReturnType<typeof useAuth>["session"]>,
  redirect: string,
) {
  // Aree role-specific: redirect verso un'area altrui (residuo del logout
  // di un utente con ruolo diverso) viene ignorato. Path neutri pubblici
  // o legati a /activities restano onorati.
  if (redirect.startsWith("/admin")) {
    return (
      session.isAdmin ||
      // Chi gestisce il campeggio lo verifica la guardia della route (server).
      (isCampManagementAdminPath(redirect) && !session.isParent)
    );
  }
  if (redirect.startsWith("/unit")) return session.isUnitLeader;
  if (redirect.startsWith("/family")) return session.isParent;
  if (redirect.startsWith("/me"))
    return !session.isAdmin && !session.isUnitLeader && !session.isParent;
  return true;
}

function getHomePath(session: NonNullable<ReturnType<typeof useAuth>["session"]>) {
  return session.isAdmin && session.profile.mustChangePassword
    ? "/password-reset"
    : getRoleHome(session);
}

function getPostLoginPath(
  session: NonNullable<ReturnType<typeof useAuth>["session"]>,
  redirect: string | null | undefined,
) {
  if (session.isAdmin && session.profile.mustChangePassword) {
    return "/password-reset";
  }

  if (redirect && isCompatibleRedirect(session, redirect)) {
    return redirect;
  }

  return getRoleHome(session);
}

function getInitials(fullName: string) {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0))
    .slice(0, 2)
    .join("");
  return initials.toUpperCase() || "?";
}

// Tastiera aperta (iOS e Android riducono il visual viewport, non il layout):
// il piede con la CTA torna nel flusso, così non copre il campo attivo e non
// resta a metà schermo sopra la tastiera.
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;

    if (!viewport) {
      return;
    }

    const update = () =>
      setOpen(viewport.scale <= 1.01 && window.innerHeight - viewport.height > 150);

    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);

  return open;
}

function splitFullName(value: string | null | undefined) {
  if (!value || isPlaceholderName(value)) {
    return { firstName: "", lastName: "" };
  }

  const parts = value.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function normalizeUnitName(value: string) {
  return value.trim().toLocaleLowerCase("it-IT");
}

function isConfiguredUnit(unitOptions: string[], unitName: string) {
  return unitOptions.some((unit) => normalizeUnitName(unit) === normalizeUnitName(unitName));
}

function isBirthDateMoreThan20YearsAgo(value: string) {
  if (!value) {
    return false;
  }

  const birthDate = new Date(`${value}T00:00:00`);

  if (Number.isNaN(birthDate.getTime())) {
    return false;
  }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setFullYear(cutoff.getFullYear() - 20);

  return birthDate < cutoff;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M21.805 10.041h-9.18v3.918h5.268c-.227 1.263-1.553 3.705-5.268 3.705-3.17 0-5.75-2.625-5.75-5.863s2.58-5.863 5.75-5.863c1.805 0 3.01.768 3.702 1.434l2.518-2.438C17.242 3.444 15.205 2.5 12.625 2.5 7.114 2.5 2.625 6.988 2.625 12.5S7.114 22.5 12.625 22.5c5.773 0 9.595-4.053 9.595-9.785 0-.656-.078-1.156-.215-1.674Z"
        fill="#4285F4"
      />
      <path
        d="M3.777 7.852 7 10.216c.873-2.586 3.26-4.278 5.625-4.278 1.805 0 3.01.768 3.702 1.434l2.518-2.438C17.242 3.444 15.205 2.5 12.625 2.5c-3.839 0-7.186 2.168-8.848 5.352Z"
        fill="#EA4335"
      />
      <path
        d="M12.625 22.5c2.51 0 4.621-.824 6.16-2.238l-2.846-2.33c-.799.56-1.848.955-3.314.955-3.699 0-5.964-2.5-6.943-5.856l-3.119 2.406C4.209 19.199 8.097 22.5 12.625 22.5Z"
        fill="#34A853"
      />
      <path
        d="M5.682 13.031a6.137 6.137 0 0 1-.35-2.031c0-.709.125-1.396.35-2.031L2.563 6.562A10.052 10.052 0 0 0 1.875 11c0 1.611.385 3.137 1.063 4.437l2.744-2.406Z"
        fill="#FBBC05"
      />
    </svg>
  );
}

export function AuthAccessPanel({
  organization,
  redirect,
  initialMode = "login",
  description,
  backAction,
}: AuthAccessPanelProps) {
  const navigate = useNavigate();
  const {
    session,
    loading,
    signInWithEmail,
    signInWithGoogle,
    signUpWithEmail,
    sendPasswordReset,
    completeProfile,
    completeParentProfile,
    switchToParentAccount,
    signOut,
  } = useAuth();
  const cityOptionsListId = useId();
  const authIds = useId();
  const formId = `${authIds}-form`;
  const panelId = `${authIds}-panel`;
  const tabIds = { login: `${authIds}-tab-login`, signup: `${authIds}-tab-signup` };
  const keyboardOpen = useKeyboardOpen();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  // Si va avanti da soli solo dopo un'azione fatta qui (accesso, account nuovo,
  // profilo completato). Chi apre la pagina già dentro vede "Sei già dentro":
  // mai un redirect muto (docs/FLUSSO_GENITORE.md, I).
  const [actedHere, setActedHere] = useState(false);
  const messageRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "auth" | "profile">(null);
  const [error, setError] = useState<string | null>(null);
  const [profileStep, setProfileStep] = useState(0);
  const [parentPromptDismissed, setParentPromptDismissed] = useState(false);
  const [profileState, setProfileState] = useState({
    firstName: "",
    lastName: "",
    birthDate: "",
    genderRoleCategory: "" as GenderRoleCategory | "",
    unitName: "",
    city: "",
  });
  const [manualUnitMode, setManualUnitMode] = useState(false);

  const unitOptions = useMemo(
    () => organization.units.filter(Boolean),
    [organization.units],
  );
  const hasConfiguredUnits = unitOptions.length > 0;
  const canUseManualUnit = Boolean(session?.isAdmin);
  const requiresProfileCompletion = needsProfileCompletion(session);
  const isParentProfileFlow = Boolean(session?.isParent);
  const activeProfileSteps = isParentProfileFlow ? parentProfileSteps : profileSteps;
  const effectiveDescription =
    description ||
    organization.accountHelpText ||
    ACCEDI.notaDatiDefault;

  useEffect(() => {
    if (!session || session.isAnonymous) {
      return;
    }

    const names = splitFullName(session.profile.fullName);
    const pendingProfile = readPendingAccountProfile();

    setProfileState({
      firstName: names.firstName || pendingProfile?.firstName || "",
      lastName: names.lastName || pendingProfile?.lastName || "",
      birthDate:
        session.profile.birthDate || pendingProfile?.birthDate || "",
      genderRoleCategory:
        session.profile.genderRoleCategory ||
        pendingProfile?.genderRoleCategory ||
        "",
      unitName:
        session.profile.unitName || pendingProfile?.unitName || "",
      city: session.profile.city || "",
    });
    setManualUnitMode(
      Boolean(
        session.isAdmin &&
          (!unitOptions.length ||
            (session.profile.unitName &&
              !isConfiguredUnit(unitOptions, session.profile.unitName))),
      ),
    );
    setProfileStep(0);
    setParentPromptDismissed(false);
  }, [session, unitOptions]);

  useEffect(() => {
    if (!actedHere || !session || session.isAnonymous || requiresProfileCompletion) {
      return;
    }

    clearPendingAccountProfile();
    navigate(getPostLoginPath(session, redirect), { replace: true });
  }, [actedHere, navigate, redirect, requiresProfileCompletion, session]);

  // L'esito arriva dopo il tocco sulla CTA in fondo: il messaggio va in vista,
  // sopra il piede fisso (scroll-margin nel CSS), non sotto.
  useEffect(() => {
    if (!error && !feedback) {
      return;
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    messageRef.current?.scrollIntoView({
      block: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [error, feedback]);

  useEffect(() => {
    setPassword("");
    setConfirmPassword("");
    setShowPasswords(false);
    setFieldErrors({});
    setError(null);
    setFeedback(null);
  }, [mode]);

  function setFieldValue(
    field: keyof AuthFieldErrors,
    value: string,
    setter: (nextValue: string) => void,
  ) {
    setter(value);
    setFieldErrors((current) => ({ ...current, [field]: false }));
    setError(null);
    setFeedback(null);
  }

  async function handleEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("auth");
    setError(null);
    setFeedback(null);
    const normalizedEmail = email.trim();
    const nextFieldErrors: AuthFieldErrors = {};

    if (!normalizedEmail || !emailPattern.test(normalizedEmail)) {
      nextFieldErrors.email = true;
    }

    if (!password) {
      nextFieldErrors.password = true;
    }

    if (mode === "signup") {
      if (!confirmPassword) {
        nextFieldErrors.confirmPassword = true;
      }

      if (password.length < 6) {
        nextFieldErrors.password = true;
      }

      if (password && confirmPassword && password !== confirmPassword) {
        nextFieldErrors.password = true;
        nextFieldErrors.confirmPassword = true;
      }
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setBusy(null);
      if (nextFieldErrors.email) {
        setError("Inserisci un indirizzo email valido.");
        return;
      }

      if (mode === "signup" && password.length < 6) {
        setError("La password deve avere almeno 6 caratteri.");
        return;
      }

      if (mode === "signup" && password !== confirmPassword) {
        setError("Le password non coincidono.");
        return;
      }

      setError("Completa i campi richiesti per continuare.");
      return;
    }

    setActedHere(true);

    try {
      await (mode === "signup"
        ? signUpWithEmail(normalizedEmail, password)
        : signInWithEmail(normalizedEmail, password));
    } catch (caughtError) {
      setError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(null);
    }
  }

  async function handleGoogleAuth() {
    setBusy("auth");
    setError(null);
    setFeedback(null);
    setActedHere(true);

    try {
      await signInWithGoogle();
    } catch (caughtError) {
      setError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(null);
    }
  }

  async function handlePasswordReset() {
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !emailPattern.test(normalizedEmail)) {
      setFieldErrors((current) => ({ ...current, email: true }));
      setFeedback(null);
      setError("Inserisci prima la tua email per ricevere il link di reset.");
      return;
    }

    setBusy("auth");
    setError(null);
    setFeedback(null);

    try {
      await sendPasswordReset(normalizedEmail);
      setFeedback("Ti abbiamo inviato il link per reimpostare la password.");
    } catch (caughtError) {
      setError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(null);
    }
  }

  function validateProfileStep(step: number) {
    const normalizedUnitName = profileState.unitName.trim();

    if (step === 0) {
      if (!profileState.firstName.trim() || !profileState.lastName.trim()) {
        return "Inserisci nome e cognome.";
      }

      if (!isParentProfileFlow && !profileState.birthDate) {
        return "Inserisci la data di nascita.";
      }

      return null;
    }

    if (!isParentProfileFlow && !profileState.genderRoleCategory) {
      return "Seleziona la tua organizzazione.";
    }

    if (!normalizedUnitName) {
      return "Indica il tuo rione o ramo.";
    }

    if (isParentProfileFlow && !profileState.city.trim()) {
      return "Indica il comune di riferimento.";
    }

    if (
      !canUseManualUnit &&
      (!hasConfiguredUnits || !isConfiguredUnit(unitOptions, normalizedUnitName))
    ) {
      return "Seleziona un'unità valida dall'elenco configurato.";
    }

    return null;
  }

  async function maybeSwitchToParentFlow() {
    if (
      !session ||
      isParentProfileFlow ||
      profileStep !== 0 ||
      parentPromptDismissed ||
      !isBirthDateMoreThan20YearsAgo(profileState.birthDate)
    ) {
      return false;
    }

    const shouldSwitch =
      typeof window !== "undefined" &&
      window.confirm("Sei un genitore e stai iscrivendo tuo figlio o tua figlia?");

    if (!shouldSwitch) {
      setParentPromptDismissed(true);
      return false;
    }

    setBusy("profile");
    setError(null);

    try {
      await switchToParentAccount();
      setParentPromptDismissed(false);
      setProfileStep(0);
      return true;
    } catch (caughtError) {
      setError(toUserFacingAuthError(caughtError));
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function goToNextProfileStep() {
    const nextError = validateProfileStep(profileStep);

    if (nextError) {
      setError(nextError);
      return;
    }

    if (await maybeSwitchToParentFlow()) {
      return;
    }

    setError(null);
    setProfileStep((current) => Math.min(current + 1, activeProfileSteps.length - 1));
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = validateProfileStep(profileStep);

    if (nextError) {
      setError(nextError);
      return;
    }

    if (profileStep < activeProfileSteps.length - 1) {
      await goToNextProfileStep();
      return;
    }

    setBusy("profile");
    setError(null);
    setActedHere(true);
    const genderRoleCategory = profileState.genderRoleCategory;

    if (!isParentProfileFlow && !genderRoleCategory) {
      setBusy(null);
      setError("Seleziona la tua organizzazione.");
      return;
    }

    try {
      if (isParentProfileFlow) {
        await completeParentProfile({
          firstName: profileState.firstName.trim(),
          lastName: profileState.lastName.trim(),
          unitName: profileState.unitName.trim(),
          city: profileState.city.trim(),
          stakeId: organization.stakeId,
        });
      } else if (genderRoleCategory) {
        await completeProfile({
          firstName: profileState.firstName.trim(),
          lastName: profileState.lastName.trim(),
          birthDate: profileState.birthDate,
          genderRoleCategory,
          unitName: profileState.unitName.trim(),
          stakeId: organization.stakeId,
        });
      }
    } catch (caughtError) {
      setError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(null);
    }
  }

  const showManualUnitInput =
    canUseManualUnit &&
    (!hasConfiguredUnits ||
      manualUnitMode ||
      (profileState.unitName.trim() &&
        !isConfiguredUnit(unitOptions, profileState.unitName)));
  const unitSelectValue = showManualUnitInput ? MANUAL_UNIT_VALUE : profileState.unitName;

  if (loading) {
    return <AppLoader label={ACCEDI.verificaSessione} />;
  }

  if (requiresProfileCompletion) {
    const progress = ((profileStep + 1) / activeProfileSteps.length) * 100;

    return (
      <section className="card auth-flow">
        <div className="section-head">
          <div>
            <h2>Completa il profilo</h2>
            <p>
              {isParentProfileFlow
                ? "Ti chiediamo solo ciò che serve per gestire le iscrizioni dei tuoi figli."
                : "Ti chiediamo solo ciò che serve per velocizzare le prossime iscrizioni."}
            </p>
          </div>
          {backAction}
        </div>

        <div className="form-stepper">
          <div className="form-stepper__progress">
            <div className="form-stepper__track">
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="form-stepper__steps">
              {activeProfileSteps.map((step, index) => (
                <div
                  key={step.title}
                  className={
                    index === profileStep
                      ? "form-stepper__step form-stepper__step--active"
                      : index < profileStep
                        ? "form-stepper__step form-stepper__step--done"
                        : "form-stepper__step"
                  }
                >
                  <div className="form-stepper__step-icon">
                    <AppIcon name={index < profileStep ? "check" : step.icon} />
                  </div>
                  <div>
                    <strong>{step.title}</strong>
                    <small>{step.description}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error ? <div className="form-error">{error}</div> : null}

          <form className="form-stack" onSubmit={handleProfileSubmit}>
            <div className="form-stepper__panel">
              {profileStep === 0 ? (
                <div className="card-grid card-grid--two">
                  <label className="field">
                    <span>Nome</span>
                    <input
                      className="input"
                      value={profileState.firstName}
                      onChange={(eventInput) =>
                        setProfileState((current) => ({
                          ...current,
                          firstName: eventInput.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Cognome</span>
                    <input
                      className="input"
                      value={profileState.lastName}
                      onChange={(eventInput) =>
                        setProfileState((current) => ({
                          ...current,
                          lastName: eventInput.target.value,
                        }))
                      }
                    />
                  </label>

                  {!isParentProfileFlow ? (
                    <label className="field field--full">
                      <span>Data di nascita</span>
                      <input
                        className="input"
                        type="date"
                      value={profileState.birthDate}
                      onChange={(eventInput) => {
                        setParentPromptDismissed(false);
                        setProfileState((current) => ({
                          ...current,
                          birthDate: eventInput.target.value,
                        }));
                      }}
                    />
                    </label>
                  ) : null}
                </div>
              ) : (
                <div className="form-stack">
                  {!isParentProfileFlow ? (
                    <label className="field">
                      <span>Organizzazione</span>
                      <select
                        className="input"
                        value={profileState.genderRoleCategory}
                        onChange={(eventInput) =>
                          setProfileState((current) => ({
                            ...current,
                            genderRoleCategory: eventInput.target.value as GenderRoleCategory | "",
                          }))
                        }
                      >
                        <option value="">Seleziona</option>
                        <option value="giovane_uomo">Giovane uomo</option>
                        <option value="giovane_donna">Giovane donna</option>
                        <option value="dirigente">Dirigente</option>
                        <option value="accompagnatore">Accompagnatore</option>
                      </select>
                    </label>
                  ) : null}

                  <label className="field">
                    <span>Unità di appartenenza</span>
                    {hasConfiguredUnits ? (
                      <select
                        className="input"
                        value={unitSelectValue}
                        onChange={(eventInput) => {
                          const { value } = eventInput.target;

                          if (value === MANUAL_UNIT_VALUE) {
                            setManualUnitMode(true);
                            setProfileState((current) => ({
                              ...current,
                              unitName: isConfiguredUnit(unitOptions, current.unitName)
                                ? ""
                                : current.unitName,
                            }));
                            return;
                          }

                          setManualUnitMode(false);
                          setProfileState((current) => ({
                            ...current,
                            unitName: value,
                          }));
                        }}
                      >
                        <option value="">Seleziona un'unità</option>
                        {unitOptions.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                        {canUseManualUnit ? (
                          <option value={MANUAL_UNIT_VALUE}>Unità non in elenco</option>
                        ) : null}
                      </select>
                    ) : canUseManualUnit ? null : (
                      <select className="input" disabled value="">
                        <option value="">Nessuna unità configurata</option>
                      </select>
                    )}

                    {showManualUnitInput ? (
                      <input
                        className="input"
                        placeholder="Scrivi la tua unità"
                        value={profileState.unitName}
                        onChange={(eventInput) =>
                          setProfileState((current) => ({
                            ...current,
                            unitName: eventInput.target.value,
                          }))
                        }
                      />
                    ) : null}

                    <small>
                      {showManualUnitInput
                        ? "Se la tua unità non è ancora in elenco, scrivila qui."
                        : hasConfiguredUnits
                          ? `Palo: ${organization.stakeName}.`
                          : "L'amministratore deve prima configurare almeno un'unità."}
                    </small>
                  </label>

                  {isParentProfileFlow ? (
                    <label className="field">
                      <span>Comune</span>
                      <input
                        className="input"
                        list={cityOptionsListId}
                        value={profileState.city}
                        onChange={(eventInput) =>
                          setProfileState((current) => ({
                            ...current,
                            city: eventInput.target.value,
                          }))
                        }
                        placeholder="Seleziona o scrivi un comune"
                      />
                      <datalist id={cityOptionsListId}>
                        {italianMunicipalityOptions.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                    </label>
                  ) : null}
                </div>
              )}
            </div>

            <div className="form-stepper__actions">
              {profileStep > 0 ? (
                <button
                  className="button button--ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    setError(null);
                    setProfileStep((current) => Math.max(current - 1, 0));
                  }}
                  type="button"
                >
                  <AppIcon name="arrow-left" />
                  <span>Indietro</span>
                </button>
              ) : (
                <div />
              )}

              <button className="button button--primary" disabled={busy !== null} type="submit">
                {busy === "profile" ? (
                  "Salvataggio..."
                ) : profileStep === activeProfileSteps.length - 1 ? (
                  <>
                    <AppIcon name="check" />
                    <span>{ACCEDI.salvaEContinua}</span>
                  </>
                ) : (
                  <>
                    <span>Continua</span>
                    <AppIcon name="arrow-right" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  if (session && !session.isAnonymous) {
    // Appena entrato da qui: l'effetto sopra sta già portando alla pagina giusta.
    if (actedHere) {
      return <AppLoader label={ACCEDI.attendi} />;
    }

    const fullName = isPlaceholderName(session.profile.fullName)
      ? ""
      : session.profile.fullName.trim();
    const email = session.firebaseUser.email || session.profile.email || "";
    const roleLabel = getRoleLabel(session.profile.role);

    return (
      <section className="auth-screen auth-screen--signed-in">
        <div className="auth-screen__copy">
          <h1 className="auth-screen__title">{ACCEDI.giaDentro}</h1>
        </div>

        <div className="auth-identity">
          <span aria-hidden="true" className="auth-identity__avatar">
            {getInitials(fullName || email)}
          </span>
          <div className="auth-identity__text">
            <strong>{fullName || email}</strong>
            {fullName && email ? <span>{email}</span> : null}
            <span className="auth-identity__tag">
              {session.profile.unitName
                ? fillCopy(ACCEDI.ruoloEUnita, {
                    ruolo: roleLabel,
                    unita: session.profile.unitName,
                  })
                : roleLabel}
            </span>
          </div>
        </div>

        <div className="auth-identity__actions">
          <Link className="button button--primary button--large" to={getHomePath(session)}>
            {ACCEDI.vaiAllaTuaPagina}
          </Link>
          <button
            className="button button--ghost button--large"
            onClick={() => {
              setMode("login");
              void signOut();
            }}
            type="button"
          >
            <AppIcon name="logout" />
            <span>{ACCEDI.esciECambiaAccount}</span>
          </button>
        </div>
      </section>
    );
  }

  const isSignup = mode === "signup";

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const nextMode: AuthMode =
      event.key === "Home" ? "login" : event.key === "End" ? "signup" : isSignup ? "login" : "signup";
    setMode(nextMode);
    document.getElementById(tabIds[nextMode])?.focus();
  }

  return (
    <section className="auth-screen">
      <div className="auth-screen__copy">
        <h1 className="auth-screen__title">
          {isSignup ? ACCEDI.titoloCrea : ACCEDI.titoloAccedi}
        </h1>
        <p className="auth-screen__lead">{isSignup ? ACCEDI.leadCrea : ACCEDI.leadAccedi}</p>
      </div>

      <div aria-label={ACCEDI.schede} className="auth-tabs" role="tablist">
        {(["login", "signup"] as const).map((tabMode) => (
          <button
            aria-controls={panelId}
            aria-selected={mode === tabMode}
            className="auth-tabs__tab"
            id={tabIds[tabMode]}
            key={tabMode}
            onClick={() => setMode(tabMode)}
            onKeyDown={handleTabKeyDown}
            role="tab"
            tabIndex={mode === tabMode ? 0 : -1}
            type="button"
          >
            {tabMode === "login" ? ACCEDI.schedaAccedi : ACCEDI.schedaCrea}
          </button>
        ))}
      </div>

      {session?.isAnonymous ? (
        <p className="auth-screen__note auth-screen__note--emphasis">
          {isRecordNightPath(redirect) ? ACCEDI.ospiteRecord : ACCEDI.ospiteIscrizione}
        </p>
      ) : null}

      <div
        aria-labelledby={tabIds[mode]}
        className="auth-panel"
        id={panelId}
        role="tabpanel"
      >
        <button
          className="auth-google-button"
          disabled={busy !== null}
          onClick={() => void handleGoogleAuth()}
          type="button"
        >
          <span className="auth-google-button__mark">
            <GoogleMark />
          </span>
          <span>{ACCEDI.google}</span>
        </button>

        <div className="auth-divider">
          <span>{ACCEDI.oppureConEmail}</span>
        </div>

        <form className="auth-panel__form" id={formId} noValidate onSubmit={handleEmailAuth}>
          <label className="field">
            <span>{ACCEDI.email}</span>
            <input
              autoComplete="email"
              className={fieldErrors.email ? "input input--error" : "input"}
              inputMode="email"
              type="email"
              value={email}
              onChange={(event) => setFieldValue("email", event.target.value, setEmail)}
              placeholder={ACCEDI.emailPlaceholder}
            />
          </label>

          <label className="field">
            <span>{ACCEDI.password}</span>
            <div className={fieldErrors.password ? "password-field password-field--error" : "password-field"}>
              <input
                autoComplete={isSignup ? "new-password" : "current-password"}
                className={fieldErrors.password ? "input input--error" : "input"}
                type={showPasswords ? "text" : "password"}
                value={password}
                onChange={(event) => setFieldValue("password", event.target.value, setPassword)}
                placeholder={isSignup ? ACCEDI.passwordPlaceholderCrea : ACCEDI.passwordPlaceholderAccedi}
              />
              <button
                aria-label={showPasswords ? ACCEDI.nascondiPassword : ACCEDI.mostraPassword}
                className="password-field__toggle"
                onClick={() => setShowPasswords((current) => !current)}
                type="button"
              >
                <AppIcon name="eye" />
                <span>{showPasswords ? ACCEDI.nascondi : ACCEDI.mostra}</span>
              </button>
            </div>
          </label>

          {isSignup ? (
            <label className="field">
              <span>{ACCEDI.confermaPassword}</span>
              <div
                className={
                  fieldErrors.confirmPassword
                    ? "password-field password-field--error"
                    : "password-field"
                }
              >
                <input
                  autoComplete="new-password"
                  className={fieldErrors.confirmPassword ? "input input--error" : "input"}
                  type={showPasswords ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) =>
                    setFieldValue("confirmPassword", event.target.value, setConfirmPassword)
                  }
                  placeholder={ACCEDI.confermaPasswordPlaceholder}
                />
                <button
                  aria-label={showPasswords ? ACCEDI.nascondiPassword : ACCEDI.mostraPassword}
                  className="password-field__toggle"
                  onClick={() => setShowPasswords((current) => !current)}
                  type="button"
                >
                  <AppIcon name="eye" />
                  <span>{showPasswords ? ACCEDI.nascondi : ACCEDI.mostra}</span>
                </button>
              </div>
            </label>
          ) : (
            <button
              className="auth-link-button auth-link-button--forgot"
              disabled={busy !== null}
              onClick={() => void handlePasswordReset()}
              type="button"
            >
              {ACCEDI.passwordDimenticata}
            </button>
          )}
        </form>

        {isSignup ? <p className="auth-screen__note">{effectiveDescription}</p> : null}

        {error || feedback ? (
          <div className="auth-panel__message" ref={messageRef}>
            {error ? (
              <div className="form-error" role="alert">
                {error}
              </div>
            ) : null}
            {feedback ? (
              <div className="form-success" role="status">
                {feedback}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={keyboardOpen ? "auth-foot auth-foot--inline" : "auth-foot"}>
        <button
          className="button button--primary button--large"
          disabled={busy !== null}
          form={formId}
          type="submit"
        >
          {busy === "auth" ? ACCEDI.attendi : isSignup ? ACCEDI.inviaCrea : ACCEDI.inviaAccedi}
        </button>
        <p className="auth-foot__note">{isSignup ? ACCEDI.notaCrea : ACCEDI.notaAccedi}</p>
      </div>
    </section>
  );
}
