import { useEffect, useRef, useState } from "react";
import { deleteField } from "firebase/firestore";

import { AppModal } from "@/components/AppModal";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import {
  AdminParentFields,
  AdminPersonFields,
} from "@/components/admin/registrations/AdminPersonFields";
import { ModalFeedback } from "@/components/admin/ModalFeedback";
import { ISCRITTI } from "@/copy/iscritti";
import { fillCopy } from "@/copy/parole";
import { useAsyncData } from "@/hooks/useAsyncData";
import { registrationsService } from "@/services/firestore/registrationsService";
import { unitsService } from "@/services/firestore/unitsService";
import type { Registration, Unit } from "@/types";
import {
  EMPTY_PARENT_DRAFT,
  buildAdminEditPatch,
  personDraftFromRegistration,
  planAdminEdit,
  validateAdminEdit,
  type AdminParentDraft,
  type AdminPersonDraft,
} from "@/utils/adminRegistration";
import { getAdminActionError } from "@/utils/adminErrors";
import { WRITE_TIMEOUT_CODE, isOffline, withWriteTimeout } from "@/utils/writeTimeout";

interface EditRegistrationSheetProps {
  stakeId: string;
  eventId: string;
  requiresParentAuthorization: boolean;
  registration: Registration;
  onClose: () => void;
  onSaved: (info: string) => void;
}

// Foglio "Modifica dati" sopra la scheda dell'iscrizione (docs/ADMIN_ISCRITTI.md,
// D). "Salvando" elenca ogni effetto prima del tasto, calcolato da
// planAdminEdit con le regole del salvataggio; il tasto dice se parte una mail.
export function EditRegistrationSheet({
  stakeId,
  eventId,
  requiresParentAuthorization,
  registration,
  onClose,
  onSaved,
}: EditRegistrationSheetProps) {
  const [initial] = useState(() => personDraftFromRegistration(registration));
  const [person, setPerson] = useState<AdminPersonDraft>(initial);
  const [parent, setParent] = useState<AdminParentDraft>(EMPTY_PARENT_DRAFT);
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Scrittura scaduta col timeout: è in coda e parte al ritorno della rete.
  // Da qui i dati non si cambiano più (partirebbero quelli di prima) e
  // chiudere non li perde: niente "Esci senza salvare".
  const [queued, setQueued] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const mountedRef = useRef(true);
  // Rimesso a vero a ogni montaggio: con StrictMode (sviluppo) l'effetto
  // gira due volte e la pulizia del primo giro lo lascerebbe falso.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { data: units, loading: unitsLoading } = useAsyncData<Unit[]>(
    () => unitsService.listUnits(stakeId),
    [stakeId],
    [],
  );

  const plan = planAdminEdit(registration, person, parent, {
    requiresParentAuthorization,
    previousUnitName: initial.unitName,
  });
  const problems = validateAdminEdit(person, parent, plan);
  const dirty =
    JSON.stringify(person) !== JSON.stringify(initial) ||
    JSON.stringify(parent) !== JSON.stringify(EMPTY_PARENT_DRAFT);

  function requestClose() {
    if (busy) return;
    if (dirty && !queued) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  async function handleSave() {
    if (busy || !dirty) return;
    setShowProblems(true);
    setError(null);
    if (problems.length > 0) return;
    // Senza rete la scrittura resterebbe in coda e potrebbe partire dopo
    // "Esci senza salvare", mail compresa: si dice subito.
    if (isOffline()) {
      setError(ISCRITTI.erroreRete);
      return;
    }

    setBusy(true);
    try {
      const patch = buildAdminEditPatch({
        registration,
        person,
        parent,
        plan,
        timestamp: new Date().toISOString(),
        deleteValue: deleteField(),
      });
      await withWriteTimeout(
        registrationsService.adminUpdateRegistration(stakeId, eventId, registration.id, patch),
      );
      if (!mountedRef.current) return;
      const name = `${person.firstName.trim()} ${person.lastName.trim()}`.trim();
      onSaved(
        [fillCopy(ISCRITTI.modificaOk, { nome: name }), plan.sendsMail ? ISCRITTI.mailInPartenza : ""]
          .filter(Boolean)
          .join(" "),
      );
    } catch (caughtError) {
      if (
        mountedRef.current &&
        (caughtError as { code?: unknown } | null)?.code === WRITE_TIMEOUT_CODE
      ) {
        setQueued(true);
      }
      if (mountedRef.current) setError(getAdminActionError(caughtError, ISCRITTI.erroreModifica));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  return (
    <>
      <AppModal
        footer={
          <div className="admin-sheet-footer">
            {dirty && plan.effects.length > 0 ? (
              <div className="admin-outcome admin-outcome--warning" role="status">
                <h4>{ISCRITTI.salvando}</h4>
                <ul>
                  {plan.effects.map((effect) => (
                    <li key={effect}>{effect}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ModalFeedback error={error} />
            <div className="admin-sheet-actions">
              <button
                className="button button--primary"
                disabled={busy || !dirty}
                onClick={() => void handleSave()}
                type="button"
              >
                {busy ? ISCRITTI.salvataggio : plan.sendsMail ? ISCRITTI.salvaEMail : ISCRITTI.salva}
              </button>
              <button
                className="button button--ghost"
                disabled={busy}
                onClick={requestClose}
                type="button"
              >
                {ISCRITTI.annulla}
              </button>
            </div>
          </div>
        }
        onClose={requestClose}
        subtitle={`${registration.lastName} ${registration.firstName}`.trim()}
        title={ISCRITTI.modificaDati}
      >
        <div className="admin-modal-stack">
          <AdminPersonFields
            disabled={busy || queued}
            onChange={(patch) => {
              setPerson((current) => ({ ...current, ...patch }));
              setError(null);
            }}
            person={person}
            previous={initial}
            problems={showProblems ? problems : []}
            units={units}
            unitsLoading={unitsLoading}
          />

          {plan.needsParentFields ? (
            <AdminParentFields
              disabled={busy || queued}
              onChange={(patch) => {
                setParent((current) => ({ ...current, ...patch }));
                setError(null);
              }}
              parent={parent}
              problems={showProblems ? problems : []}
              subtitle={fillCopy(ISCRITTI.genitoreSotto, {
                nome: person.firstName.trim() || "—",
              })}
            />
          ) : null}

        </div>
      </AppModal>

      {confirmDiscard ? (
        <ConfirmSheet
          body={ISCRITTI.esciSenzaSalvareCorpo}
          cancelLabel={ISCRITTI.continuaACompilare}
          confirmLabel={ISCRITTI.esciSenzaSalvare}
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={onClose}
          title={ISCRITTI.esciSenzaSalvareTitolo}
          tone="danger"
        />
      ) : null}
    </>
  );
}
