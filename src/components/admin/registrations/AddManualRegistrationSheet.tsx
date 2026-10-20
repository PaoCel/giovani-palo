import { useEffect, useRef, useState } from "react";

import { AppModal } from "@/components/AppModal";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import {
  AdminParentFields,
  AdminPersonFields,
} from "@/components/admin/registrations/AdminPersonFields";
import { ModalFeedback } from "@/components/admin/ModalFeedback";
import { getCategoryShortLabel, getUnitLabel } from "@/components/admin/registrations/registrationLabels";
import { ISCRITTI } from "@/copy/iscritti";
import { fillCopy } from "@/copy/parole";
import { useAsyncData } from "@/hooks/useAsyncData";
import { registrationsService } from "@/services/firestore/registrationsService";
import { unitsService } from "@/services/firestore/unitsService";
import type { Registration, Unit } from "@/types";
import {
  EMPTY_PARENT_DRAFT,
  buildManualRegistrationDoc,
  findPossibleDuplicates,
  getManualAddOutcome,
  newManualRegistrationId,
  validateManualAdd,
  type AdminParentDraft,
  type AdminPersonDraft,
  type ManualAddProblem,
} from "@/utils/adminRegistration";
import { getAdminActionError } from "@/utils/adminErrors";
import { getAgeFromBirthDate } from "@/utils/age";
import { getRegistrationDisplayName } from "@/utils/roomPreferences";
import { WRITE_TIMEOUT_CODE, isOffline, withWriteTimeout } from "@/utils/writeTimeout";

const EMPTY_PERSON: AdminPersonDraft = {
  firstName: "",
  lastName: "",
  birthDate: "",
  genderRoleCategory: "",
  unitId: "",
  unitName: "",
  email: "",
  phone: "",
};

interface AddManualRegistrationSheetProps {
  stakeId: string;
  eventId: string;
  requiresParentAuthorization: boolean;
  sessionUid: string;
  // Iscrizioni già lette dalla pagina: il controllo doppioni le rilegge dal
  // server prima di scrivere.
  registrations: Registration[];
  onClose: () => void;
  onCreated: (registrationId: string, info: string) => void;
  onOpenRegistration: (registrationId: string) => void;
}

// Foglio "Aggiungi a mano" (docs/ADMIN_ISCRITTI.md, B). Id e data fissati
// all'apertura: un secondo "Aggiungi" dopo un errore di rete riscrive lo
// stesso documento invece di crearne un doppione.
export function AddManualRegistrationSheet({
  stakeId,
  eventId,
  requiresParentAuthorization,
  sessionUid,
  registrations,
  onClose,
  onCreated,
  onOpenRegistration,
}: AddManualRegistrationSheetProps) {
  const [registrationId] = useState(() => newManualRegistrationId());
  const [timestamp] = useState(() => new Date().toISOString());
  const [person, setPerson] = useState<AdminPersonDraft>(EMPTY_PERSON);
  const [parent, setParent] = useState<AdminParentDraft>(EMPTY_PARENT_DRAFT);
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Scrittura scaduta col timeout: è in coda e parte al ritorno della rete.
  // Da qui i dati non si cambiano più (partirebbero quelli di prima) e
  // chiudere non li perde: niente "Esci senza salvare".
  const [queued, setQueued] = useState(false);
  // Doppione visto e accettato con "Aggiungi lo stesso".
  const [duplicateAccepted, setDuplicateAccepted] = useState(false);
  const [serverDuplicates, setServerDuplicates] = useState<Registration[] | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const mountedRef = useRef(true);
  // Un tentativo è già partito: il secondo controlla prima se il documento
  // c'è (id fissato all'apertura).
  const attemptedRef = useRef(false);
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

  const problems = validateManualAdd(person, parent, requiresParentAuthorization);
  const outcome = getManualAddOutcome({
    birthDate: person.birthDate,
    requiresParentAuthorization,
    parentEmail: parent.email,
  });
  const fullName = `${person.firstName.trim()} ${person.lastName.trim()}`.trim();
  const duplicates = (serverDuplicates ?? findPossibleDuplicates(registrations, person)).filter(
    (registration) => registration.id !== registrationId,
  );
  const showDuplicates = duplicates.length > 0 && !duplicateAccepted;
  const age = person.birthDate ? getAgeFromBirthDate(person.birthDate) : null;
  const dirty =
    JSON.stringify(person) !== JSON.stringify(EMPTY_PERSON) ||
    JSON.stringify(parent) !== JSON.stringify(EMPTY_PARENT_DRAFT);

  function updatePerson(patch: Partial<AdminPersonDraft>) {
    setPerson((current) => ({ ...current, ...patch }));
    setError(null);
    if ("firstName" in patch || "lastName" in patch || "birthDate" in patch) {
      setDuplicateAccepted(false);
      setServerDuplicates(null);
    }
  }

  function requestClose() {
    if (busy) return;
    if (dirty && !queued) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  async function handleSubmit() {
    if (busy) return;
    setShowProblems(true);
    setError(null);
    if (problems.length > 0) return;
    // Senza rete la scrittura resterebbe in coda e potrebbe partire dopo
    // "Esci senza salvare": si dice subito, nessuna scrittura.
    if (isOffline()) {
      setError(ISCRITTI.erroreRete);
      return;
    }

    setBusy(true);
    try {
      if (attemptedRef.current) {
        const exists = await withWriteTimeout(
          registrationsService.adminManualRegistrationExists(stakeId, eventId, registrationId),
        );
        if (exists) {
          if (mountedRef.current) {
            onCreated(registrationId, fillCopy(ISCRITTI.aggiuntaOk, { nome: fullName }));
          }
          return;
        }
      }
      // Doppioni sulla lista fresca del server: quella della pagina può
      // essere vecchia (cache) o non avere chi si è iscritto un minuto fa.
      if (!duplicateAccepted) {
        const fresh = await withWriteTimeout(
          registrationsService.listRegistrationsByEvent(stakeId, eventId, true),
        );
        const found = findPossibleDuplicates(fresh, person).filter(
          (registration) => registration.id !== registrationId,
        );
        if (found.length > 0) {
          if (mountedRef.current) setServerDuplicates(found);
          return;
        }
      }
      // Foglio chiuso durante la lettura (altra attività, altro account):
      // niente scrittura per un contesto che l'admin ha lasciato.
      if (!mountedRef.current) return;

      const document = buildManualRegistrationDoc({
        person,
        parent,
        requiresParentAuthorization,
        createdBy: sessionUid,
        timestamp,
      });
      attemptedRef.current = true;
      await withWriteTimeout(
        registrationsService.adminCreateManualRegistration(stakeId, eventId, registrationId, document),
      );
      if (!mountedRef.current) return;
      const info = [
        fillCopy(ISCRITTI.aggiuntaOk, { nome: document.fullName }),
        outcome.sendsMail ? ISCRITTI.mailInPartenza : "",
      ]
        .filter(Boolean)
        .join(" ");
      onCreated(registrationId, info);
    } catch (caughtError) {
      if (
        mountedRef.current &&
        (caughtError as { code?: unknown } | null)?.code === WRITE_TIMEOUT_CODE
      ) {
        setQueued(true);
      }
      if (mountedRef.current) setError(getAdminActionError(caughtError, ISCRITTI.erroreAggiungi));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  const outcomeText = !outcome.needsParent
    ? fillCopy(ISCRITTI.esitoAttiva, { nome: fullName || "—" })
    : outcome.sendsMail
      ? fillCopy(ISCRITTI.esitoAttesaMail, {
          nome: fullName || "—",
          email: parent.email.trim().toLowerCase(),
        })
      : fillCopy(ISCRITTI.esitoAttesaSenzaEmail, { nome: fullName || "—" });

  return (
    <>
      <AppModal
        footer={
          <div className="admin-sheet-footer">
            {showDuplicates ? (
              <div className="admin-outcome admin-outcome--warning" role="status">
                {fillCopy(ISCRITTI.doppione, {
                  nome: getRegistrationDisplayName(duplicates[0]),
                  dettagli: `${getCategoryShortLabel(duplicates[0])}, ${getUnitLabel(duplicates[0])}`,
                })}
                <div className="admin-outcome__actions">
                  <button
                    className="button button--ghost button--small"
                    onClick={() => onOpenRegistration(duplicates[0].id)}
                    type="button"
                  >
                    {ISCRITTI.apriLaSuaIscrizione}
                  </button>
                  <button
                    className="button button--ghost button--small"
                    onClick={() => setDuplicateAccepted(true)}
                    type="button"
                  >
                    {ISCRITTI.aggiungiLoStesso}
                  </button>
                </div>
              </div>
            ) : fullName ? (
              <div
                className={
                  outcome.needsParent ? "admin-outcome admin-outcome--warning" : "admin-outcome"
                }
                role="status"
              >
                <h4>{ISCRITTI.salvando}</h4>
                {outcomeText}
              </div>
            ) : null}
            <ModalFeedback error={error} />
            <div className="admin-sheet-actions">
              <button
                className="button button--primary"
                disabled={busy || showDuplicates}
                onClick={() => void handleSubmit()}
                type="button"
              >
                {busy
                  ? ISCRITTI.salvataggio
                  : outcome.sendsMail
                    ? ISCRITTI.aggiungiEMail
                    : ISCRITTI.aggiungi}
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
        title={ISCRITTI.aggiungiAMano}
      >
        <div className="admin-modal-stack">
          <AdminPersonFields
            birthDateNotice={
              outcome.needsParent && age !== null
                ? fillCopy(ISCRITTI.anniConAutorizzazione, { anni: String(age) })
                : null
            }
            disabled={busy || queued}
            onChange={updatePerson}
            person={person}
            problems={showProblems ? problems : []}
            unitNotice={
              person.unitName ? fillCopy(ISCRITTI.unitaVisibile, { unita: person.unitName }) : null
            }
            units={units}
            unitsLoading={unitsLoading}
          />

          {outcome.needsParent ? (
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
