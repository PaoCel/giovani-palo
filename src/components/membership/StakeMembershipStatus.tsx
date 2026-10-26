import { useState } from "react";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { PALO } from "@/copy/palo";
import { fillCopy } from "@/copy/parole";
import { useAuth } from "@/hooks/useAuth";
import { useStakeMembership } from "@/hooks/useStakeMembership";
import { stakeMembersService } from "@/services/firestore/stakeMembersService";
import { membershipErrorMessage } from "@/utils/stakeMembership";

import "@/styles/membership.css";

interface StakeMembershipStatusProps {
  stakeName: string;
}

/**
 * Nel blocco "Palo" del profilo: lo stato dell'appartenenza e, per chi è
 * membro, "Esci dal palo" con il foglio di conferma (docs/APPARTENENZA_AL_PALO.md,
 * «Client della fase 3»). Rientrare ripassa dalla coda.
 */
export function StakeMembershipStatus({ stakeName }: StakeMembershipStatusProps) {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  const { access, member } = useStakeMembership(stakeId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (access === "loading" || access === "guest") return null;
  const label = access === "member" ? PALO.statoMembro : access === "waiting" ? PALO.statoInAttesa : PALO.statoFuori;
  const role = session?.profile.role;
  const roleName = role === "admin" ? PALO.ruoloAdmin : role === "unit_leader" ? PALO.ruoloDirigente : "";
  const body = roleName ? `${PALO.esciCorpo} ${fillCopy(PALO.esciCorpoStaff, { ruolo: roleName })}` : PALO.esciCorpo;

  async function leave() {
    setBusy(true);
    setError(null);
    try {
      await stakeMembersService.run({ action: "leave", stakeId });
      setOpen(false);
    } catch (caught) {
      setError(membershipErrorMessage(caught, { self: true }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mship-status">
      <span className={access === "member" ? "mship-tag mship-tag--ok" : "mship-tag"}>{label}</span>
      {member?.status === "active" ? (
        <button className="mship-link mship-link--danger" onClick={() => setOpen(true)} type="button">
          {PALO.esciDalPalo}
        </button>
      ) : null}
      {open ? (
        <ConfirmSheet
          body={body}
          busy={busy}
          busyLabel={PALO.uscita}
          cancelLabel={PALO.restaNelPalo}
          confirmLabel={PALO.confermaEsci}
          error={error}
          onCancel={() => {
            setOpen(false);
            setError(null);
          }}
          onConfirm={() => void leave()}
          title={fillCopy(PALO.esciTitolo, { palo: stakeName })}
          tone="danger"
        />
      ) : null}
    </div>
  );
}
