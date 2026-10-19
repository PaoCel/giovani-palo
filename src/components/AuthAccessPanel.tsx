import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { AppLoader } from "@/components/AppLoader";
import { AuthCredentialsForm, type AuthMode } from "@/components/auth/AuthCredentialsForm";
import type { ChiSeiChoice } from "@/components/auth/ChiSeiPanel";
import { ACCEDI } from "@/copy/accedi";
import { fillCopy } from "@/copy/parole";
import { PROFILO } from "@/copy/profilo";
import { useAuth } from "@/hooks/useAuth";
import type { OrganizationProfile } from "@/types";
import { isRecordNightPath } from "@/utils/activityLinks";
import { clearPendingAccountProfile } from "@/utils/pendingAccountProfile";
import {
  canBecomeParent,
  isPlaceholderName,
  needsProfileCompletion,
} from "@/utils/profileCompletion";
import { getRoleLabel } from "@/utils/roles";

export type { AuthMode } from "@/components/auth/AuthCredentialsForm";

// «Chi sei?» e "I tuoi dati" servono solo dopo un account nuovo: fuori dal
// bundle iniziale della pagina Accedi.
const ChiSeiPanel = lazy(() =>
  import("@/components/auth/ChiSeiPanel").then((module) => ({ default: module.ChiSeiPanel })),
);
const ChiSeiAnswer = lazy(() =>
  import("@/components/auth/ChiSeiPanel").then((module) => ({ default: module.ChiSeiAnswer })),
);
const ProfileForm = lazy(() =>
  import("@/components/auth/ProfileForm").then((module) => ({ default: module.ProfileForm })),
);

interface AuthAccessPanelProps {
  organization: OrganizationProfile;
  redirect?: string | null;
  // Scheda aperta all'arrivo: "Accedi" salvo link espliciti a "Crea un account".
  initialMode?: AuthMode;
  description?: string;
  backAction?: ReactNode;
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

// Pagina Accedi (/login): schede "Accedi" e "Crea un account", poi «Chi sei?»
// e "I tuoi dati" per un account nuovo, oppure "Sei già dentro"
// (docs/FLUSSO_GENITORE.md, I).
export function AuthAccessPanel({
  organization,
  redirect,
  initialMode = "login",
  description,
  backAction,
}: AuthAccessPanelProps) {
  const navigate = useNavigate();
  const { session, loading, signOut } = useAuth();
  // Si va avanti da soli solo dopo un'azione fatta qui (accesso, account nuovo,
  // profilo completato). Chi apre la pagina già dentro vede "Sei già dentro":
  // mai un redirect muto.
  const [actedHere, setActedHere] = useState(false);
  // Risposta a «Chi sei?»: in memoria, il profilo si scrive con "I tuoi dati".
  const [chiSei, setChiSei] = useState<ChiSeiChoice | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  // Dopo "Esci e cambia account" si riparte da "Accedi".
  const [credentialsMode, setCredentialsMode] = useState<AuthMode>(initialMode);
  const requiresProfileCompletion = Boolean(
    session && !session.isAnonymous && needsProfileCompletion(session.profile),
  );
  const effectiveDescription =
    description || organization.accountHelpText || ACCEDI.notaDatiDefault;
  const sessionUid = session?.firebaseUser.uid ?? null;

  // Un altro account (uscita e nuovo accesso): «Chi sei?» riparte da zero.
  useEffect(() => {
    setChiSei(null);
  }, [sessionUid]);

  useEffect(() => {
    if (!actedHere || !session || session.isAnonymous || requiresProfileCompletion) {
      return;
    }

    clearPendingAccountProfile();
    navigate(getPostLoginPath(session, redirect), { replace: true });
  }, [actedHere, navigate, redirect, requiresProfileCompletion, session]);

  async function handleSignOut() {
    setSigningOut(true);

    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  if (loading) {
    return <AppLoader label={ACCEDI.verificaSessione} />;
  }

  if (session && !session.isAnonymous && requiresProfileCompletion) {
    // Dirigenti e admin creati da un admin non scelgono, né chi ha già una
    // data di nascita da minore: completano i dati.
    const canChoose = canBecomeParent(
      session.profile.role,
      session.profile.birthDate,
      new Date(),
    );

    if (canChoose && !chiSei) {
      return (
        <Suspense fallback={<AppLoader label={ACCEDI.attendi} />}>
          <ChiSeiPanel
            busy={signingOut}
            onChoose={setChiSei}
            onSignOut={() => void handleSignOut()}
            selected={null}
          />
        </Suspense>
      );
    }

    const isParentForm = canChoose && chiSei === "genitore";

    return (
      <Suspense fallback={<AppLoader label={ACCEDI.attendi} />}>
        <ProfileForm
          context={
            canChoose && chiSei ? (
              <ChiSeiAnswer choice={chiSei} onChange={() => setChiSei(null)} />
            ) : (
              backAction
            )
          }
          key={sessionUid ?? "anonimo"}
          autoFocusTitle
          lead={isParentForm ? PROFILO.leadGenitoreAccedi : PROFILO.leadIo}
          onSubmitStart={() => setActedHere(true)}
          organization={organization}
          presetCategory={chiSei === "dirigente" ? "dirigente" : undefined}
          submitLabel={ACCEDI.salvaEContinua}
          footNote={PROFILO.piede}
          title={PROFILO.titoloDati}
          variant={isParentForm ? "genitore" : "io"}
        />
      </Suspense>
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
              setCredentialsMode("login");
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

  return (
    <AuthCredentialsForm
      anonymousNote={
        session?.isAnonymous
          ? isRecordNightPath(redirect)
            ? ACCEDI.ospiteRecord
            : ACCEDI.ospiteIscrizione
          : null
      }
      initialMode={credentialsMode}
      leads={{ login: ACCEDI.leadAccedi, signup: ACCEDI.leadCrea }}
      onAuthStart={() => setActedHere(true)}
      signupNote={effectiveDescription}
      titles={{ login: ACCEDI.titoloAccedi, signup: ACCEDI.titoloCrea }}
    />
  );
}
