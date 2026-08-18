import { useEffect, useRef, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import { roomMatesService, type RoomMateSuggestion } from "@/services/firestore/roomMatesService";

interface RoomMateFieldProps {
  label: string;
  helpText?: string;
  placeholder?: string;
  value: string;
  stakeId: string;
  inputClassName: string;
  labelNode: React.ReactNode;
  errorNode: React.ReactNode;
  onChange: (value: string) => void;
}

type SearchState = "idle" | "searching" | "done" | "error";

const SEARCH_DEBOUNCE_MS = 350;
// Sotto questo punteggio il server non risponde nemmeno; qui serve a decidere
// se il nome scritto è già quello giusto (match pieno) o va confermato.
const EXACT_SCORE = 1;

function isSameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Campo "compagno di stanza" con ricerca fra chi ha già partecipato.
 *
 * Chi scrive solo "Camilla" non deve restare nel dubbio: il campo cerca, dice
 * a schermo che sta cercando, e propone "intendi Camilla Fiorillo?". Il nome
 * fuori elenco resta comunque valido — significa solo che quella persona non
 * era ancora passata di qui — e da lì in poi entra in elenco per gli altri.
 */
export function RoomMateField({
  helpText,
  placeholder,
  value,
  stakeId,
  inputClassName,
  labelNode,
  errorNode,
  onChange,
}: RoomMateFieldProps) {
  const [suggestions, setSuggestions] = useState<RoomMateSuggestion[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [confirmedName, setConfirmedName] = useState<string | null>(null);
  const [dismissedQueries, setDismissedQueries] = useState<string[]>([]);
  const latestQuery = useRef("");

  useEffect(() => {
    const query = value.trim();
    latestQuery.current = query;

    if (!stakeId || query.length < 2 || (confirmedName && isSameName(confirmedName, query))) {
      setSuggestions([]);
      setSearchState("idle");
      return;
    }

    setSearchState("searching");
    const timer = setTimeout(async () => {
      try {
        const results = await roomMatesService.search(stakeId, query);

        if (latestQuery.current !== query) {
          return;
        }

        setSuggestions(results);
        setSearchState("done");
      } catch {
        if (latestQuery.current !== query) {
          return;
        }

        // La ricerca è un aiuto, non un requisito: se il server non risponde
        // il nome scritto a mano resta valido e lo diciamo esplicitamente.
        setSuggestions([]);
        setSearchState("error");
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [confirmedName, stakeId, value]);

  const query = value.trim();
  const isDismissed = dismissedQueries.some((item) => isSameName(item, query));
  const exactSuggestion = suggestions.find(
    (item) => item.score >= EXACT_SCORE || isSameName(item.name, query),
  );
  const proposals = suggestions.filter((item) => !isSameName(item.name, query));
  const showConfirmed = Boolean(
    (confirmedName && isSameName(confirmedName, query)) || exactSuggestion,
  );

  function acceptSuggestion(name: string) {
    setConfirmedName(name);
    setSuggestions([]);
    setSearchState("idle");
    onChange(name);
  }

  function dismissSuggestions() {
    setDismissedQueries((current) => [...current, query]);
    setSuggestions([]);
  }

  return (
    <label className="field roommate-field">
      {labelNode}
      <input
        className={inputClassName}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => {
          setConfirmedName(null);
          onChange(event.target.value);
        }}
      />

      {searchState === "searching" ? (
        <span className="roommate-field__status" role="status" aria-live="polite">
          <span className="roommate-field__spinner" aria-hidden="true" />
          Sto cercando tra chi ha già partecipato…
        </span>
      ) : null}

      {searchState !== "searching" && showConfirmed ? (
        <span className="roommate-field__status roommate-field__status--ok" role="status">
          <AppIcon name="check" />
          Trovato: {confirmedName ?? exactSuggestion?.name}
        </span>
      ) : null}

      {searchState === "done" && !showConfirmed && !isDismissed && proposals.length > 0 ? (
        <div className="roommate-field__panel">
          <p className="roommate-field__question">
            {proposals.length === 1 ? (
              <>
                Intendi <strong>{proposals[0].name}</strong>?
              </>
            ) : (
              <>Chi intendi?</>
            )}
          </p>
          <div className="roommate-field__options">
            {proposals.map((item) => (
              <button
                key={item.name}
                type="button"
                className="button button--ghost roommate-field__option"
                onClick={() => acceptSuggestion(item.name)}
              >
                {proposals.length === 1 ? `Sì, è ${item.name}` : item.name}
              </button>
            ))}
            <button
              type="button"
              className="button button--ghost roommate-field__option roommate-field__option--deny"
              onClick={dismissSuggestions}
            >
              No, è un&apos;altra persona
            </button>
          </div>
        </div>
      ) : null}

      {searchState === "done" && !showConfirmed && proposals.length === 0 ? (
        <span className="roommate-field__status roommate-field__status--free">
          Non è tra chi ha già partecipato: va bene lo stesso, basta nome e cognome.
        </span>
      ) : null}

      {isDismissed && !showConfirmed ? (
        <span className="roommate-field__status roommate-field__status--free">
          Scrivi anche il cognome così non lo confondiamo con qualcun altro.
        </span>
      ) : null}

      {searchState === "error" ? (
        <span className="roommate-field__status roommate-field__status--free">
          Ricerca non disponibile ora: scrivi pure nome e cognome, va bene comunque.
        </span>
      ) : null}

      {errorNode ?? (helpText ? <small>{helpText}</small> : null)}
    </label>
  );
}
