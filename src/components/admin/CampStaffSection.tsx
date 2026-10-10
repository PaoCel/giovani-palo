import { useCallback, useEffect, useRef, useState } from "react";

import { StaffPicker } from "@/components/admin/StaffPicker";
import { ClosedSection } from "@/components/admin/recordNight/ClosedSections";
import {
  campManagementService,
  getCampStaffErrorMessage,
  type CampStaffCandidate,
} from "@/services/firestore/campManagementService";
import "@/styles/recordNightAdmin.css";

interface CampStaffSectionProps {
  stakeId: string;
  eventId: string;
}

type LoadStatus = "loading" | "ready" | "error";

// "Chi gestisce comitati e pattuglie": solo per gli admin del palo. Admin e
// dirigenti di unità gestiscono sempre; qui l'admin sceglie a mano quali altri
// adulti iscritti possono farlo. La categoria "accompagnatore/dirigente" è
// autodichiarata e non basta.
export function CampStaffSection({ stakeId, eventId }: CampStaffSectionProps) {
  const [candidates, setCandidates] = useState<CampStaffCandidate[]>([]);
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
      const list = await campManagementService.listStaff(stakeId, eventId);
      setCandidates(list);
      setStatus("ready");
      if (!touched.current) {
        setOpen(list.some((candidate) => candidate.isStaff));
        setOthersOpen(list.some((candidate) => candidate.isStaff && !candidate.isAdult));
      }
    } catch {
      setStatus("error");
    }
  }, [stakeId, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = candidates.filter((candidate) => candidate.isStaff).length;

  async function toggle(candidate: CampStaffCandidate, enabled: boolean) {
    if (pendingUid !== null) return;
    setPendingUid(candidate.uid);
    setError(null);
    try {
      const updatedUids = await campManagementService.setStaff(
        stakeId,
        eventId,
        candidate.uid,
        enabled,
      );
      // L'elenco vero lo dà il server: allineo tutti gli interruttori.
      const staffUids = new Set(updatedUids);
      setCandidates((current) =>
        current.map((item) => ({ ...item, isStaff: staffUids.has(item.uid) })),
      );
    } catch (caught) {
      setError(getCampStaffErrorMessage(caught));
    } finally {
      setPendingUid(null);
    }
  }

  return (
    <div className="rna">
      <ClosedSection
        count={activeCount > 0 ? activeCount : undefined}
        hint="Admin e dirigenti di unità gestiscono sempre. Qui scegli quali altri adulti iscritti possono modificare comitati e pattuglie e vedere tutte le iscrizioni del campeggio."
        onToggle={(next) => {
          touched.current = true;
          setOpen(next);
        }}
        open={open}
        title="Chi gestisce il campeggio"
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
    </div>
  );
}
