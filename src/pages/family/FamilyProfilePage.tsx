import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { StakeMembershipStatus } from "@/components/membership/StakeMembershipStatus";
import { SectionCard } from "@/components/SectionCard";
import { TIPO_ACCOUNT } from "@/copy/tipoAccount";
import { useAuth } from "@/hooks/useAuth";
import { usersService } from "@/services/firestore/usersService";
import { getRoleLabel } from "@/utils/roles";

export function FamilyProfilePage() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState(session?.profile.firstName ?? "");
  const [lastName, setLastName] = useState(session?.profile.lastName ?? "");
  const [busy, setBusy] = useState<null | "save" | "switch">(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Conferma nel foglio, mai con un dialogo del browser.
  const [participantSheetOpen, setParticipantSheetOpen] = useState(false);

  if (!session) {
    return null;
  }

  // Famiglia aperta a ogni account adulto (G2): il profilo di chi non è da
  // genitore è quello della sua area (un dirigente di unità non ne ha uno).
  if (!session.isParent) {
    return <Navigate replace to={session.isUnitLeader ? "/unit" : "/me/profile"} />;
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();

    if (!session) {
      return;
    }

    setBusy("save");
    setError(null);
    setFeedback(null);

    try {
      await usersService.updateBasicProfile(session.firebaseUser.uid, {
        firstName,
        lastName,
      });
      setFeedback("Profilo aggiornato.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Impossibile salvare il profilo.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSwitchToParticipant() {
    if (!session) {
      return;
    }

    setBusy("switch");
    setError(null);

    try {
      await usersService.setOwnAccountType(session.firebaseUser.uid, "participant");
      // Il listener sul profilo aggiorna la sessione; il guard reindirizza.
      navigate("/me", { replace: true });
    } catch (caughtError) {
      setParticipantSheetOpen(false);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile cambiare tipo di account.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <SectionCard
        title="Profilo genitore"
        description={`Account: ${session.firebaseUser.email ?? "senza email"} · Ruolo: ${getRoleLabel(session.profile.role)}`}
      >
        {error ? (
          <div className="notice notice--warning">
            <div>
              <h3>Operazione non riuscita</h3>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {feedback ? (
          <div className="notice notice--info">
            <div>
              <p>{feedback}</p>
            </div>
          </div>
        ) : null}

        <form className="stack" onSubmit={(event) => void handleSave(event)}>
          <label className="field">
            <span>Nome *</span>
            <input
              required
              type="text"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Cognome</span>
            <input
              type="text"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </label>
          <div className="inline-actions">
            <button className="button button--primary" disabled={busy !== null} type="submit">
              {busy === "save" ? "Salvataggio..." : "Salva profilo"}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Palo" description={session.profile.stakeName || "Non definito"}>
        <StakeMembershipStatus stakeName={session.profile.stakeName} />
      </SectionCard>

      <SectionCard
        title="Tipo di account"
        description="Un account genitore gestisce le iscrizioni dei figli. Se invece partecipi tu alle attività, usa un account partecipante."
      >
        <div className="inline-actions">
          <button
            className="button button--soft"
            disabled={busy !== null}
            onClick={() => setParticipantSheetOpen(true)}
            type="button"
          >
            {TIPO_ACCOUNT.passaPartecipante}
          </button>
          <button
            className="button button--ghost"
            onClick={() => void signOut()}
            type="button"
          >
            Esci
          </button>
        </div>
      </SectionCard>

      {participantSheetOpen ? (
        <ConfirmSheet
          body={TIPO_ACCOUNT.passaPartecipanteTesto}
          busy={busy === "switch"}
          busyLabel={TIPO_ACCOUNT.passaPartecipanteInCorso}
          cancelLabel={TIPO_ACCOUNT.restaComeSei}
          confirmLabel={TIPO_ACCOUNT.passaPartecipante}
          onCancel={() => setParticipantSheetOpen(false)}
          onConfirm={() => void handleSwitchToParticipant()}
          title={TIPO_ACCOUNT.passaPartecipanteTitolo}
        />
      ) : null}
    </div>
  );
}
