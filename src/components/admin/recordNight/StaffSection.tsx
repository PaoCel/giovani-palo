import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import {
  getRecordNightErrorMessage,
  recordNightService,
  type RecordNightStaffCandidate,
} from "@/services/firestore/recordNightService";

import { ClosedSection } from "./ClosedSections";
import { normalizeSearch } from "./helpers";
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
  const [query, setQuery] = useState("");
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

  const adults = useMemo(
    () => candidates.filter((candidate) => candidate.isAdult).sort(byName),
    [candidates],
  );
  const others = useMemo(
    () => candidates.filter((candidate) => !candidate.isAdult).sort(byName),
    [candidates],
  );
  const activeCount = candidates.filter((candidate) => candidate.isStaff).length;

  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  const visibleOthers = terms.length
    ? others.filter((candidate) => {
        const haystack = normalizeSearch(candidate.name);
        return terms.every((term) => haystack.includes(term));
      })
    : others;

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

  function renderRow(candidate: RecordNightStaffCandidate) {
    const pending = pendingUid === candidate.uid;
    return (
      <li key={candidate.uid}>
        <label className={pending ? "rna-switch rna-switch--pending" : "rna-switch"}>
          <input
            checked={candidate.isStaff}
            disabled={pendingUid !== null}
            onChange={(event) => void toggle(candidate, event.target.checked)}
            role="switch"
            type="checkbox"
          />
          <span className="rna-switch__who">
            <strong>{candidate.name}</strong>
            {candidate.unitName ? <small>{candidate.unitName}</small> : null}
          </span>
          <span aria-hidden="true" className="rna-switch__track" />
        </label>
      </li>
    );
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
        <>
          {adults.length === 0 ? (
            <p className="rna-empty-inline">Nessun adulto iscritto a questa attività.</p>
          ) : (
            <ul aria-label="Adulti iscritti" className="rna-staff">
              {adults.map(renderRow)}
            </ul>
          )}

          {others.length > 0 ? (
            <details
              className="rna-closed rna-closed--nested"
              onToggle={(event) => setOthersOpen(event.currentTarget.open)}
              open={othersOpen}
            >
              <summary>
                <span className="rna-closed__title">Altri iscritti ({others.length})</span>
                <AppIcon name="arrow-right" />
              </summary>
              <div className="rna-closed__body">
                <p className="rna-closed__hint">Di solito qui non serve nessuno.</p>
                <div className="rna-field rna-field--wide">
                  <label htmlFor="rna-staff-search">Cerca per nome</label>
                  <input
                    autoComplete="off"
                    className="rna-input"
                    id="rna-staff-search"
                    onChange={(event) => setQuery(event.target.value)}
                    type="search"
                    value={query}
                  />
                </div>
                {visibleOthers.length === 0 ? (
                  <p className="rna-empty-inline">Nessuno con questo nome.</p>
                ) : (
                  <ul aria-label="Altri iscritti" className="rna-staff rna-staff--scroll">
                    {visibleOthers.map(renderRow)}
                  </ul>
                )}
              </div>
            </details>
          ) : null}

          {error ? (
            <p className="rna-panel__error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </ClosedSection>
  );
}

function byName(left: RecordNightStaffCandidate, right: RecordNightStaffCandidate) {
  return left.name.localeCompare(right.name, "it-IT");
}
