import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { AppIcon } from "@/components/AppIcon";
import { ACCEDI } from "@/copy/accedi";
import { SONDAGGIO } from "@/copy/sondaggio";
import { useAuth } from "@/hooks/useAuth";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { toUserFacingAuthError } from "@/services/firebase/debug";

export type AuthMode = "login" | "signup";

interface AuthFieldErrors {
  email?: boolean;
  password?: boolean;
  confirmPassword?: boolean;
}

interface AuthCredentialsFormProps {
  compactLogin?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  initialMode: AuthMode;
  // Le due schede alla pari, nell'ordine in cui compaiono: in Accedi prima
  // "Accedi", dentro l'iscrizione prima "Crea un account".
  tabOrder?: readonly [AuthMode, AuthMode];
  titles: Record<AuthMode, string>;
  leads: Record<AuthMode, string>;
  // Tipo dell'account nuovo ("per chi" dell'iscrizione). Un account che esiste
  // già non cambia mai tipo (AuthProvider, applyAccountType).
  accountType?: "participant" | "parent";
  // Sotto il modulo di "Crea un account": a cosa servono i dati.
  signupNote?: string;
  // Sessione anonima già aperta su questo telefono.
  anonymousNote?: string | null;
  // Sotto il modulo, prima del piede (per esempio "Continua senza account").
  extra?: ReactNode;
  // Ancora sotto, per tutte e due le schede (contatto di supporto).
  afterExtra?: ReactNode;
  footNotes?: Partial<Record<AuthMode, string>>;
  // Il focus va sul titolo all'arrivo (cambio di passo nell'iscrizione).
  autoFocusTitle?: boolean;
  // Prima di ogni tentativo di accesso: chi orchestra sa che l'azione è
  // partita da qui (Accedi va avanti da sola solo dopo un'azione).
  onAuthStart?: () => void;
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

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Accedi" e "Crea un account" come schede alla pari, con "Continua con
// Google" in tutte e due (docs/FLUSSO_GENITORE.md, C e I). Non decide dove
// andare dopo: chi lo usa guarda la sessione.
export function AuthCredentialsForm({
  compactLogin = false,
  disabled = false,
  onBusyChange,
  initialMode,
  tabOrder = ["login", "signup"],
  titles,
  leads,
  accountType,
  signupNote,
  anonymousNote,
  extra,
  afterExtra,
  footNotes,
  autoFocusTitle = false,
  onAuthStart,
}: AuthCredentialsFormProps) {
  const { signInWithEmail, signInWithGoogle, signUpWithEmail, sendPasswordReset } = useAuth();
  const authIds = useId();
  const formId = `${authIds}-form`;
  const panelId = `${authIds}-panel`;
  const tabIds = { login: `${authIds}-tab-login`, signup: `${authIds}-tab-signup` };
  const keyboardOpen = useKeyboardOpen();
  const [mode, setMode] = useState<AuthMode>(compactLogin ? "login" : initialMode);
  const messageRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setBusy] = useState(false);
  const busy = pending || disabled;
  const [emailExpanded, setEmailExpanded] = useState(false);
  const Title = compactLogin ? "h2" : "h1";
  const [error, setError] = useState<string | null>(null);
  const isSignup = mode === "signup";
  useEffect(() => { onBusyChange?.(pending); }, [pending, onBusyChange]);

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
    if (autoFocusTitle) {
      titleRef.current?.focus({ preventScroll: true });
    }
    // Solo all'arrivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    if (busy) {
      return;
    }

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

    if (isSignup) {
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
      setError(
        nextFieldErrors.email
          ? ACCEDI.erroreEmail
          : isSignup && password.length < 6
            ? ACCEDI.errorePassword
            : isSignup && password !== confirmPassword
              ? ACCEDI.errorePasswordDiverse
              : ACCEDI.erroreCampi,
      );
      return;
    }

    setBusy(true);
    onAuthStart?.();

    try {
      await (isSignup
        ? signUpWithEmail(normalizedEmail, password, accountType)
        : signInWithEmail(normalizedEmail, password));
    } catch (caughtError) {
      setError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleAuth() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    setFeedback(null);
    onAuthStart?.();

    try {
      await signInWithGoogle(accountType);
    } catch (caughtError) {
      // Finestra chiusa o annullata: nessun messaggio, si resta qui.
      setError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset() {
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !emailPattern.test(normalizedEmail)) {
      setFieldErrors((current) => ({ ...current, email: true }));
      setFeedback(null);
      setError(ACCEDI.erroreEmailPerReset);
      return;
    }

    setBusy(true);
    setError(null);
    setFeedback(null);

    try {
      await sendPasswordReset(normalizedEmail);
      setFeedback(ACCEDI.resetInviato);
    } catch (caughtError) {
      setError(toUserFacingAuthError(caughtError));
    } finally {
      setBusy(false);
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const nextMode: AuthMode =
      event.key === "Home"
        ? tabOrder[0]
        : event.key === "End"
          ? tabOrder[1]
          : mode === tabOrder[0]
            ? tabOrder[1]
            : tabOrder[0];
    setMode(nextMode);
    document.getElementById(tabIds[nextMode])?.focus();
  }

  return (
    <section className={compactLogin ? "auth-screen auth-screen--compact" : "auth-screen"}>
      <div className="auth-screen__copy">
        <Title className="auth-screen__title" id={`${authIds}-title`} ref={titleRef} tabIndex={-1}>
          {titles[mode]}
        </Title>
        <p className="auth-screen__lead">{leads[mode]}</p>
      </div>

      {!compactLogin ? <div aria-label={ACCEDI.schede} className="auth-tabs" role="tablist">
        {tabOrder.map((tabMode) => (
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
      </div> : null}

      {anonymousNote ? (
        <p className="auth-screen__note auth-screen__note--emphasis">{anonymousNote}</p>
      ) : null}

      <div aria-labelledby={compactLogin ? `${authIds}-title` : tabIds[mode]} className="auth-panel" id={panelId} role={compactLogin ? undefined : "tabpanel"}>
        <button
          className="auth-google-button"
          disabled={busy}
          onClick={() => void handleGoogleAuth()}
          type="button"
        >
          <span className="auth-google-button__mark">
            <GoogleMark />
          </span>
          <span>{ACCEDI.google}</span>
        </button>

        {compactLogin ? <button type="button" className="survey-email-choice" disabled={busy}
          aria-expanded={emailExpanded} aria-controls={formId} onClick={() => setEmailExpanded(!emailExpanded)}>
          {emailExpanded ? SONDAGGIO.altriAccessi : SONDAGGIO.email}
        </button> : <div className="auth-divider">
          <span>{ACCEDI.oppureConEmail}</span>
        </div>}

        {!compactLogin || emailExpanded ? <form className="auth-panel__form" id={formId} noValidate onSubmit={handleEmailAuth}>
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
            <div
              className={
                fieldErrors.password ? "password-field password-field--error" : "password-field"
              }
            >
              <input
                autoComplete={isSignup ? "new-password" : "current-password"}
                className={fieldErrors.password ? "input input--error" : "input"}
                type={showPasswords ? "text" : "password"}
                value={password}
                onChange={(event) => setFieldValue("password", event.target.value, setPassword)}
                placeholder={
                  isSignup ? ACCEDI.passwordPlaceholderCrea : ACCEDI.passwordPlaceholderAccedi
                }
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
              disabled={busy}
              onClick={() => void handlePasswordReset()}
              type="button"
            >
              {ACCEDI.passwordDimenticata}
            </button>
          )}
        </form> : null}

        {isSignup && signupNote ? <p className="auth-screen__note">{signupNote}</p> : null}

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

        {extra}
        {afterExtra}
      </div>

      {!compactLogin || emailExpanded ? <div className={compactLogin || keyboardOpen ? "auth-foot auth-foot--inline" : "auth-foot"}>
        <button
          className="button button--primary button--large"
          disabled={busy}
          form={formId}
          type="submit"
        >
          {busy ? ACCEDI.attendi : isSignup ? ACCEDI.inviaCrea : ACCEDI.inviaAccedi}
        </button>
        {!compactLogin ? <p className="auth-foot__note">
          {footNotes?.[mode] ?? (isSignup ? ACCEDI.notaCrea : ACCEDI.notaAccedi)}
        </p> : null}
      </div> : null}
    </section>
  );
}
