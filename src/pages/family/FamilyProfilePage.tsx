import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { StakeMembershipStatus } from "@/components/membership/StakeMembershipStatus";
import { Button, Card, Notice, PageHeader } from "@/components/ui";
import { TIPO_ACCOUNT } from "@/copy/tipoAccount";
import { useAuth } from "@/hooks/useAuth";
import { usersService } from "@/services/firestore/usersService";
import { getRoleLabel } from "@/utils/roles";

import "@/styles/family.css";

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
    <div className="page family-profile">
      <PageHeader
        description={`Account: ${session.firebaseUser.email ?? "senza email"} · Ruolo: ${getRoleLabel(session.profile.role)}`}
        title="Profilo genitore"
      />

      {error ? (
        <Notice title="Operazione non riuscita" tone="warning">
          <p>{error}</p>
        </Notice>
      ) : null}

      {feedback ? (
        <Notice tone="success">
          <p>{feedback}</p>
        </Notice>
      ) : null}

      <div className="family-profile__cards">
        <Card className="family-profile__form" title="I tuoi dati">
          <form className="family-form" onSubmit={(event) => void handleSave(event)}>
            <label className="field">
              <span>Nome *</span>
              <input
                className="input"
                required
                type="text"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Cognome</span>
              <input
                className="input"
                type="text"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </label>
            <div className="family-dialog-actions">
              <Button busy={busy === "save"} disabled={busy !== null} type="submit">
                {busy === "save" ? "Salvataggio..." : "Salva profilo"}
              </Button>
            </div>
          </form>
        </Card>

        <Card subtitle={session.profile.stakeName || "Non definito"} title="Palo" variant="cool">
          <StakeMembershipStatus stakeName={session.profile.stakeName} />
        </Card>

        <Card
          subtitle="Un account genitore gestisce le iscrizioni dei figli. Se invece partecipi tu alle attività, usa un account partecipante."
          title="Tipo di account"
          variant="cool"
        >
          <div className="family-dialog-actions">
            <Button
              disabled={busy !== null}
              onClick={() => setParticipantSheetOpen(true)}
              variant="secondary"
            >
              {TIPO_ACCOUNT.passaPartecipante}
            </Button>
            <Button onClick={() => void signOut()} variant="ghost">
              Esci
            </Button>
          </div>
        </Card>
      </div>

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
