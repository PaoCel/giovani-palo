import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { useAuth } from "@/hooks/useAuth";
import { toUserFacingAuthError } from "@/services/firebase/debug";
import type { GenderRoleCategory, OrganizationProfile } from "@/types";
import {
  clearPendingAccountProfile,
  readPendingAccountProfile,
} from "@/utils/pendingAccountProfile";

interface AuthAccessPanelProps {
  organization: OrganizationProfile;
  redirect?: string | null;
  title?: string;
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

function isPlaceholderName(value: string | null | undefined) {
  return !value || value === "Partecipante";
}

function needsProfileCompletion(session: ReturnType<typeof useAuth>["session"]) {
  if (!session || session.isAnonymous) {
    return false;
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
  return session.isAdmin ? "/admin" : session.isUnitLeader ? "/unit" : "/me";
}

function isCompatibleRedirect(
  session: NonNullable<ReturnType<typeof useAuth>["session"]>,
  redirect: string,
) {
  // Aree role-specific: redirect verso un'area altrui (residuo del logout
  // di un utente con ruolo diverso) viene ignorato. Path neutri pubblici
  // o legati a /activities restano onorati.
  if (redirect.startsWith("/admin")) return session.isAdmin;
  if (redirect.startsWith("/unit")) return session.isUnitLeader;
  if (redirect.startsWith("/me")) return !session.isAdmin && !session.isUnitLeader;
  return true;
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
  title = "Login o crea un account",
  description,
  backAction,
}: AuthAccessPanelProps) {
  const navigate = useNavigate();
  const {
    session,
    signInWithEmail,
    signInWithGoogle,
    signUpWithEmail,
    sendPasswordReset,
    completeProfile,
  } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "auth" | "profile">(null);
  const [error, setError] = useState<string | null>(null);
  const [profileStep, setProfileStep] = useState(0);
  const [profileState, setProfileState] = useState({
    firstName: "",
    lastName: "",
    birthDate: "",
    genderRoleCategory: "" as GenderRoleCategory | "",
    unitName: "",
  });
  const [manualUnitMode, setManualUnitMode] = useState(false);

  const unitOptions = useMemo(
    () => organization.units.filter(Boolean),
    [organization.units],
  );
  const hasConfiguredUnits = unitOptions.length > 0;
  const canUseManualUnit = Boolean(session?.isAdmin);
  const requiresProfileCompletion = needsProfileCompletion(session);
  const effectiveDescription =
    description ||
    organization.accountHelpText ||
    "Pochi dati essenziali, poi puoi gestire tutto dal tuo profilo.";

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
  }, [session, unitOptions]);

  useEffect(() => {
    if (!session || session.isAnonymous || requiresProfileCompletion) {
      return;
    }

    clearPendingAccountProfile();
    navigate(getPostLoginPath(session, redirect), { replace: true });
  }, [navigate, redirect, requiresProfileCompletion, session]);

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

      if (!profileState.birthDate) {
        return "Inserisci la data di nascita.";
      }

      return null;
    }

    if (!profileState.genderRoleCategory) {
      return "Seleziona la tua organizzazione.";
    }

    if (!normalizedUnitName) {
      return "Indica il tuo rione o ramo.";
    }

    if (
      !canUseManualUnit &&
      (!hasConfiguredUnits || !isConfiguredUnit(unitOptions, normalizedUnitName))
    ) {
      return "Seleziona un'unità valida dall'elenco configurato.";
    }

    return null;
  }

  function goToNextProfileStep() {
    const nextError = validateProfileStep(profileStep);

    if (nextError) {
      setError(nextError);
      return;
    }

    setError(null);
    setProfileStep((current) => Math.min(current + 1, profileSteps.length - 1));
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = validateProfileStep(profileStep);

    if (nextError) {
      setError(nextError);
      return;
    }

    if (profileStep < profileSteps.length - 1) {
      goToNextProfileStep();
      return;
    }

    setBusy("profile");
    setError(null);
    const genderRoleCategory = profileState.genderRoleCategory;

    if (!genderRoleCategory) {
      setBusy(null);
      setError("Seleziona la tua organizzazione.");
      return;
    }

    try {
      await completeProfile({
        firstName: profileState.firstName.trim(),
        lastName: profileState.lastName.trim(),
        birthDate: profileState.birthDate,
        genderRoleCategory,
        unitName: profileState.unitName.trim(),
        stakeId: organization.stakeId,
      });
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

  if (requiresProfileCompletion) {
    const progress = ((profileStep + 1) / profileSteps.length) * 100;

    return (
      <section className="card auth-flow">
        <div className="section-head">
          <div>
            <h2>Completa il profilo</h2>
            <p>Ti chiediamo solo ciò che serve per velocizzare le prossime iscrizioni.</p>
          </div>
          {backAction}
        </div>

        <div className="form-stepper">
          <div className="form-stepper__progress">
            <div className="form-stepper__track">
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="form-stepper__steps">
              {profileSteps.map((step, index) => (
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

                  <label className="field field--full">
                    <span>Data di nascita</span>
                    <input
                      className="input"
                      type="date"
                      value={profileState.birthDate}
                      onChange={(eventInput) =>
                        setProfileState((current) => ({
                          ...current,
                          birthDate: eventInput.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              ) : (
                <div className="form-stack">
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
                ) : profileStep === profileSteps.length - 1 ? (
                  <>
                    <AppIcon name="check" />
                    <span>Entra nell&apos;app</span>
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

  return (
    <section className="auth-screen">
      <div className="auth-screen__copy">
        <h1 className="auth-screen__title">{title}</h1>
      </div>

      {error ? <div className="form-error">{error}</div> : null}
      {feedback ? <div className="form-success">{feedback}</div> : null}

      {session?.isAnonymous ? (
        <p className="auth-screen__note auth-screen__note--emphasis">
          Hai già iniziato come ospite: se crei un account adesso, colleghiamo subito
          l&apos;iscrizione appena fatta al tuo profilo.
        </p>
      ) : null}

      <div className="auth-panel">
        <form className="auth-panel__form" noValidate onSubmit={handleEmailAuth}>
          <label className="field">
            <span>Email</span>
            <input
              autoComplete="email"
              className={fieldErrors.email ? "input input--error" : "input"}
              type="email"
              value={email}
              onChange={(event) => setFieldValue("email", event.target.value, setEmail)}
              placeholder="nome@esempio.it"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <div className={fieldErrors.password ? "password-field password-field--error" : "password-field"}>
              <input
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className={fieldErrors.password ? "input input--error" : "input"}
                type={showPasswords ? "text" : "password"}
                value={password}
                onChange={(event) => setFieldValue("password", event.target.value, setPassword)}
                placeholder={mode === "signup" ? "Almeno 6 caratteri" : "Inserisci la tua password"}
              />
              <button
                aria-label={showPasswords ? "Nascondi password" : "Mostra password"}
                className="password-field__toggle"
                onClick={() => setShowPasswords((current) => !current)}
                type="button"
              >
                <AppIcon name="eye" />
                <span>{showPasswords ? "Nascondi" : "Mostra"}</span>
              </button>
            </div>
          </label>

          {mode === "signup" ? (
            <label className="field">
              <span>Conferma password</span>
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
                  placeholder="Ripeti la password"
                />
                <button
                  aria-label={showPasswords ? "Nascondi password" : "Mostra password"}
                  className="password-field__toggle"
                  onClick={() => setShowPasswords((current) => !current)}
                  type="button"
                >
                  <AppIcon name="eye" />
                  <span>{showPasswords ? "Nascondi" : "Mostra"}</span>
                </button>
              </div>
            </label>
          ) : (
            <button
              className="auth-link-button"
              disabled={busy !== null}
              onClick={() => void handlePasswordReset()}
              type="button"
            >
              Password dimenticata
            </button>
          )}

          <button className="button button--primary button--large" disabled={busy !== null} type="submit">
            {busy === "auth" ? (
              "Un attimo..."
            ) : mode === "signup" ? (
              "Crea account"
            ) : (
              "Login"
            )}
          </button>
        </form>

        <div className="auth-divider">
          <span>oppure</span>
        </div>

        <button
          className="auth-google-button"
          disabled={busy !== null}
          onClick={() => void handleGoogleAuth()}
          type="button"
        >
          <span className="auth-google-button__mark">
            <GoogleMark />
          </span>
          <span>{mode === "signup" ? "Registrati con Google" : "Continua con Google"}</span>
        </button>
      </div>

      <p className="auth-switch">
        {mode === "login" ? "Non hai un account?" : "Hai già un account?"}{" "}
        <button
          className="auth-link-button"
          onClick={() => setMode((current) => (current === "login" ? "signup" : "login"))}
          type="button"
        >
          {mode === "login" ? "Crea un account" : "Fai login"}
        </button>
      </p>

      <p className="auth-screen__note">{effectiveDescription}</p>
    </section>
  );
}
