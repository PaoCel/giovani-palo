import { useMemo, useState } from "react";

import { AppIcon } from "@/components/AppIcon";

import { normalizeSearch } from "./recordNight/helpers";

export interface StaffPickerCandidate {
  uid: string;
  name: string;
  unitName: string;
  isAdult: boolean;
  isStaff: boolean;
}

interface StaffPickerProps<T extends StaffPickerCandidate> {
  candidates: T[];
  pendingUid: string | null;
  error: string | null;
  othersOpen: boolean;
  onOthersToggle: (open: boolean) => void;
  onToggle: (candidate: T, enabled: boolean) => void;
}

// Elenco di chi può gestire un'attività: gli adulti iscritti in vista, gli altri
// in una sezione chiusa con ricerca. Le categorie sono autodichiarate: qui
// servono solo a ordinare, il permesso lo dà l'interruttore.
export function StaffPicker<T extends StaffPickerCandidate>({
  candidates,
  pendingUid,
  error,
  othersOpen,
  onOthersToggle,
  onToggle,
}: StaffPickerProps<T>) {
  const [query, setQuery] = useState("");

  const adults = useMemo(
    () => candidates.filter((candidate) => candidate.isAdult).sort(byName),
    [candidates],
  );
  const others = useMemo(
    () => candidates.filter((candidate) => !candidate.isAdult).sort(byName),
    [candidates],
  );

  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  const visibleOthers = terms.length
    ? others.filter((candidate) => {
        const haystack = normalizeSearch(candidate.name);
        return terms.every((term) => haystack.includes(term));
      })
    : others;

  function renderRow(candidate: T) {
    const pending = pendingUid === candidate.uid;
    return (
      <li key={candidate.uid}>
        <label className={pending ? "rna-switch rna-switch--pending" : "rna-switch"}>
          <input
            checked={candidate.isStaff}
            disabled={pendingUid !== null}
            onChange={(event) => onToggle(candidate, event.target.checked)}
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
          onToggle={(event) => onOthersToggle(event.currentTarget.open)}
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
  );
}

function byName(left: StaffPickerCandidate, right: StaffPickerCandidate) {
  return left.name.localeCompare(right.name, "it-IT");
}
