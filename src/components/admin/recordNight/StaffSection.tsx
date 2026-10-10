import { useCallback, useEffect, useRef, useState } from "react";

import { StaffPicker } from "@/components/admin/StaffPicker";
import {
  getRecordNightErrorMessage,
  recordNightService,
  type RecordNightStaffCandidate,
} from "@/services/firestore/recordNightService";

import { ClosedSection } from "./ClosedSections";
import type { RnaContext } from "./types";

interface StaffSectionProps {
  ctx: RnaContext;
}

type LoadStatus = "loading" | "ready" | "error";

// "Chi gestisce le proposte": solo per gli admin del palo. Admin e dirigenti di
// unità gestiscono sempre; qui l'admin sceglie a mano quali altri adulti
// iscritti possono farlo (vedono i nomi di tutti e approvano o rifiutano). La
// categoria "accompagnatore/dirigente" è autodichiarata e non basta.
export function StaffSection({ ctx }: StaffSectionProps) {
  const { stakeId, activityId, notify } = ctx;
  const [candidates, setCandidates] = useState<RecordNightStaffCandidate[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  // Dopo che l'admin ha aperto o chiuso a mano, la sezione non si muove più da sola.
  const touched = useRef(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const list = await recordNightService.listStaff(stakeId, activityId);
      setCandidates(list);
      setStatus("ready");
      if (!touched.current) {
        // Aperta se c'è già qualcuno scelto, chiusa se non serve nessuno.
        setOpen(list.some((candidate) => candidate.isStaff));
        setOthersOpen(list.some((candidate) => candidate.isStaff && !candidate.isAdult));
      }
    } catch {
      setStatus("error");
    }
  }, [stakeId, activityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = candidates.filter((candidate) => candidate.isStaff).length;

  async function toggle(candidate: RecordNightStaffCandidate, enabled: boolean) {
    if (pendingUid !== null) return;
    setPendingUid(candidate.uid);
    setError(null);
    try {
      const updatedUids = await recordNightService.setStaff(
        stakeId,
        activityId,
        candidate.uid,
        enabled,
      );
      // L'elenco vero lo dà il server: allineo tutti gli interruttori.
      const staffUids = new Set(updatedUids);
      setCandidates((current) =>
        current.map((item) => ({ ...item, isStaff: staffUids.has(item.uid) })),
      );
      notify(
        enabled
          ? `Ora ${candidate.name} può gestire le proposte.`
          : `${candidate.name} non gestisce più le proposte.`,
      );
    } catch (caught) {
      setError(getRecordNightErrorMessage(caught));
    } finally {
      setPendingUid(null);
    }
  }

  return (
    <ClosedSection
      count={activeCount > 0 ? activeCount : undefined}
      hint="Admin e dirigenti di unità le gestiscono sempre. Qui scegli quali altri adulti iscritti possono farlo: vedranno i nomi di tutti e potranno approvare o rifiutare."
      onToggle={(next) => {
        touched.current = true;
        setOpen(next);
      }}
      open={open}
      title="Chi gestisce le proposte"
    >
      {status === "loading" ? (
        <p className="rna-empty-inline" role="status">
          Sto caricando le persone...
        </p>
      ) : status === "error" ? (
        <div className="rna-notice rna-notice--error" role="alert">
          <p>Non riesco a caricare l'elenco. Controlla la connessione e riprova.</p>
          <button
            className="button button--ghost button--small"
            onClick={() => void load()}
            type="button"
          >
            Riprova
          </button>
        </div>
      ) : (
        <StaffPicker
          candidates={candidates}
          error={error}
          onOthersToggle={setOthersOpen}
          onToggle={(candidate, enabled) => void toggle(candidate, enabled)}
          othersOpen={othersOpen}
          pendingUid={pendingUid}
        />
      )}
    </ClosedSection>
  );
}
