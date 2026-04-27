import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";

export function PasswordResetPage() {
  const navigate = useNavigate();
  const { session, changePassword } = useAuth();
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session || session.isAnonymous) {
    return <Navigate replace to="/login" />;
  }

  const destination = session.isAdmin ? "/admin" : "/me";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (nextPassword.length < 8) {
      setError("La nuova password deve avere almeno 8 caratteri.");
      return;
    }

    if (nextPassword !== confirmPassword) {
      setError("Le due password non coincidono.");
      return;
    }

    setBusy(true);

    try {
      await changePassword(nextPassword);
      navigate(destination, { replace: true });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile aggiornare la password.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHero
        eyebrow="Primo accesso"
        title="Imposta una password definitiva."
        description="Per continuare serve sostituire la password temporanea assegnata all'account."
      />

      <SectionCard
        title="Sicurezza account"
        description="Questa operazione si fa una sola volta al primo accesso."
      >
        <form className="form-stack" onSubmit={handleSubmit}>
          {error ? <div className="form-error">{error}</div> : null}

          <label className="field">
            <span>Nuova password</span>
            <input
              className="input"
              type="password"
              value={nextPassword}
              onChange={(eventInput) => setNextPassword(eventInput.target.value)}
            />
          </label>

          <label className="field">
            <span>Conferma password</span>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(eventInput) => setConfirmPassword(eventInput.target.value)}
            />
          </label>

          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Aggiornamento..." : "Conferma nuova password"}
          </button>
        </form>
      </SectionCard>
    </div>
  );
}
