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

  if (!session) {
    return null;
  }

  return (
    <section className="user-page-intro">
      <h1>{getUserDisplayName(session)}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </section>
  );
}
