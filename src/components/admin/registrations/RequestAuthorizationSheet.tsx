import { useEffect, useRef, useState } from "react";

import { AppModal } from "@/components/AppModal";
import { AdminParentFields } from "@/components/admin/registrations/AdminPersonFields";
import { ModalFeedback } from "@/components/admin/ModalFeedback";
import { ISCRITTI } from "@/copy/iscritti";
import { fillCopy } from "@/copy/parole";
import { registrationsService } from "@/services/firestore/registrationsService";
import type { Registration } from "@/types";
import {
  EMPTY_PARENT_DRAFT,
  buildRequestAuthorizationPatch,
  isValidEmail,
  type AdminParentDraft,
} from "@/utils/adminRegistration";
import { getAdminActionError } from "@/utils/adminErrors";
import { isOffline, withWriteTimeout } from "@/utils/writeTimeout";

interface RequestAuthorizationSheetProps {
  stakeId: string;
  eventId: string;
  registration: Registration;
  onClose: () => void;
  onSent: (info: string) => void;
}

// Foglio "Chiedi l'autorizzazione" (docs/ADMIN_ISCRITTI.md, E): un'iscrizione in
// attesa del genitore senza email (le aggiunte a mano). Scrive la richiesta e
// la mail la manda il trigger delle autorizzazioni, come per il modulo.
export function RequestAuthorizationSheet({
  stakeId,
  eventId,
  registration,
  onClose,
  onSent,
}: RequestAuthorizationSheetProps) {
  const [parent, setParent] = useState<AdminParentDraft>(EMPTY_PARENT_DRAFT);
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Rimesso a vero a ogni montaggio: con StrictMode (sviluppo) l'effetto
  // gira due volte e la pulizia del primo giro lo lascerebbe falso.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const emailValid = isValidEmail(parent.email);

  async function handleSend() {
    if (busy) return;
    setShowProblems(true);
    setError(null);
    if (!emailValid) return;
    if (isOffline()) {
      setError(ISCRITTI.erroreRete);
      return;
    }

    setBusy(true);
    try {
      await withWriteTimeout(
        registrationsService.adminUpdateRegistration(
          stakeId,
          eventId,
          registration.id,
          buildRequestAuthorizationPatch(registration, parent, new Date().toISOString()),
        ),
      );
      if (!mountedRef.current) return;
      onSent(ISCRITTI.mailInPartenza);
    } catch (caughtError) {
      if (mountedRef.current) setError(getAdminActionError(caughtError, ISCRITTI.erroreChiedi));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  return (
    <AppModal
      footer={
        <>
          <ModalFeedback error={error} />
          <button
            className="button button--ghost"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            {ISCRITTI.annulla}
          </button>
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void handleSend()}
            type="button"
          >
            {busy ? ISCRITTI.salvataggio : ISCRITTI.mandaLaMail}
          </button>
        </>
      }
      onClose={busy ? () => undefined : onClose}
      size="compact"
      subtitle={fillCopy(ISCRITTI.chiediSotto, { nome: registration.fullName })}
      title={ISCRITTI.chiediAutorizzazione}
    >
      <div className="admin-modal-stack">
        <AdminParentFields
          disabled={busy}
          emailRequired
          onChange={(patch) => {
            setParent((current) => ({ ...current, ...patch }));
            setError(null);
          }}
          parent={parent}
          problems={showProblems && !emailValid ? ["emailGenitore"] : []}
        />
        <p className="admin-outcome">{ISCRITTI.chiediCorpo}</p>
      </div>
    </AppModal>
  );
}
