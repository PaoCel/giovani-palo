import { Link, useLocation } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";

interface UserPageIntroProps {
  subtitle?: string;
}

function getUserDisplayName(session: ReturnType<typeof useAuth>["session"]) {
  if (!session) {
    return "Profilo utente";
  }

  const fullName = session.profile.fullName?.trim();

  if (fullName && fullName !== "Partecipante" && fullName !== "Ospite anonimo") {
    return fullName;
  }

  const displayName = session.firebaseUser.displayName?.trim();

  if (displayName) {
    return displayName;
  }

  const email = session.firebaseUser.email || session.profile.email;

  if (email) {
    return email.split("@")[0];
  }

  return "Profilo utente";
}

export function UserPageIntro({ subtitle }: UserPageIntroProps) {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) {
    return null;
  }

  const needsYouthProfile =
    session.isAdmin &&
    (!session.profile.birthDate ||
      !session.profile.genderRoleCategory ||
      !session.profile.unitName);
  const showYouthProfileNotice = needsYouthProfile && location.pathname !== "/me/profile";

  return (
    <>
      <section className="user-page-intro">
        <h1>{getUserDisplayName(session)}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </section>

      {showYouthProfileNotice ? (
        <div className="notice notice--info">
          <div>
            <h3>Completa la vista giovane</h3>
            <p>
              Per vedere e usare le iscrizioni come un giovane, aggiungi data di nascita,
              organizzazione e unità al tuo profilo.
            </p>
          </div>
          <Link className="button button--soft button--small" to="/me/profile">
            Completa profilo
          </Link>
        </div>
      ) : null}
    </>
  );
}
