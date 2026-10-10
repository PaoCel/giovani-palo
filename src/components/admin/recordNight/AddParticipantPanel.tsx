import { useEffect, useId, useMemo, useRef, useState } from "react";

import { recordNightService } from "@/services/firestore/recordNightService";
import type { RecordNightRecord } from "@/types";
import { RECORD_NIGHT_MAX_ENTRIES } from "@/utils/recordNight";

import { normalizeSearch } from "./helpers";
import { Avatar } from "./parts";
import type { RnaContext } from "./types";

interface AddParticipantPanelProps {
  ctx: RnaContext;
  record: RecordNightRecord;
  // Chi ha già un tentativo in attesa o approvato su questo record.
  takenRegistrationIds: ReadonlySet<string>;
  // Quanti tentativi attivi ha ogni persona (il tetto è 2).
  activeEntryCounts: ReadonlyMap<string, number>;
  onClose: () => void;
}

// "Iscrivi qualcuno": per chi non ha un account (iscritti dal genitore) e per
// chi non riesce a farlo da solo. L'elenco delle persone lo dà il server
// (`listParticipants`): chi organizza non può leggere tutte le iscrizioni. Il
// limite di 2 record lo applica il server e il suo messaggio compare qui sotto.
export function AddParticipantPanel({
  ctx,
  record,
  takenRegistrationIds,
  activeEntryCounts,
  onClose,
}: AddParticipantPanelProps) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const searchId = `${baseId}-search`;
  const { participants } = ctx;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const candidates = useMemo(
    () =>
      participants.list
        .filter((person) => !takenRegistrationIds.has(person.registrationId))
        .map((person) => ({ person, search: normalizeSearch(person.name) }))
        .sort((left, right) => left.person.name.localeCompare(right.person.name, "it-IT")),
    [participants.list, takenRegistrationIds],
  );

  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  const visible = terms.length
    ? candidates.filter((item) => terms.every((term) => item.search.includes(term)))
    : candidates;

  async function add(registrationId: string, name: string) {
    setError(null);
    const result = await ctx.run(
      `add:${record.id}:${registrationId}`,
      () => recordNightService.addParticipant(ctx.stakeId, ctx.activityId, record.id, registrationId),
      `${name} è su «${record.title}».`,
    );
    if (result.ok) {
      setLastAdded(name);
      inputRef.current?.focus();
    } else {
      setError(result.message);
    }
  }

  return (
    <div aria-labelledby={headingId} className="rna-panel" role="group">
      <div className="rna-panel__head">
        <h5 id={headingId}>Iscrivi qualcuno a «{record.title}»</h5>
        <p className="rna-panel__note">
          Solo chi è iscritto all'attività. Ognuno può stare in {RECORD_NIGHT_MAX_ENTRIES} record al massimo.
        </p>
      </div>

      <div className="rna-field rna-field--wide">
        <label htmlFor={searchId}>Cerca per nome</label>
        <input
          autoComplete="off"
          className="rna-input"
          id={searchId}
          onChange={(event) => setQuery(event.target.value)}
          ref={inputRef}
          type="search"
          value={query}
        />
      </div>

      {lastAdded ? (
        <p className="rna-panel__ok" role="status">
          Iscrizione fatta: {lastAdded}. Puoi cercare un'altra persona.
        </p>
      ) : null}

      {participants.status === "loading" ? (
        <p className="rna-empty-inline" role="status">
          Sto caricando le persone...
        </p>
      ) : participants.status === "error" ? (
        <div className="rna-notice rna-notice--error" role="alert">
          <p>Non riesco a caricare l'elenco delle persone. Controlla la connessione e riprova.</p>
          <button
            className="button button--ghost button--small"
            onClick={participants.reload}
            type="button"
          >
            Riprova
          </button>
        </div>
      ) : candidates.length === 0 ? (
        <p className="rna-empty-inline">
          Non c'è nessun altro da iscrivere: chi ha un'iscrizione attiva è già su questo record.
        </p>
      ) : visible.length === 0 ? (
        <p className="rna-empty-inline">Nessuno con questo nome.</p>
      ) : (
        <ul aria-label="Persone iscritte all'attività" className="rna-people">
          {visible.map(({ person }) => {
            const count = activeEntryCounts.get(person.registrationId) ?? 0;
            // Già a 2 record: non si può iscrivere (lo rifiuterebbe anche il
            // server), quindi la riga resta ma spenta.
            const full = count >= RECORD_NIGHT_MAX_ENTRIES;
            const busyThis = ctx.busyKey === `add:${record.id}:${person.registrationId}`;
            const details = [
              person.unitName,
              person.registrationId.startsWith("child_") ? "Iscritto dal genitore" : "",
              full ? `Ha già ${RECORD_NIGHT_MAX_ENTRIES} record` : count > 0 ? "Ha già 1 record" : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li className={full ? "rna-people__row--full" : undefined} key={person.registrationId}>
                <Avatar name={person.name} />
                <span className="rna-people__who">
                  <strong>
                    {person.name}
                    {person.isAdult ? <span className="rna-tag">Adulto</span> : null}
                  </strong>
                  {details ? <small>{details}</small> : null}
                </span>
                <button
                  aria-label={
                    full
                      ? `${person.name} ha già ${RECORD_NIGHT_MAX_ENTRIES} record`
                      : `Iscrivi ${person.name} a ${record.title}`
                  }
                  className="button button--soft button--small"
                  disabled={ctx.busy || full}
                  onClick={() => void add(person.registrationId, person.name)}
                  type="button"
                >
                  {busyThis ? "Sto iscrivendo..." : "Iscrivi"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="rna-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rna-panel__actions">
        <button
          className="button button--ghost button--small"
          disabled={ctx.busy}
          onClick={onClose}
          type="button"
        >
          Chiudi
        </button>
      </div>
    </div>
  );
}
