import { useId, useMemo, useRef, useState, type FormEvent } from "react";

import { AppIcon } from "@/components/AppIcon";
import type { RecordNightRegistrationType, RecordNightStaffRequest } from "@/types";
import { RECORD_NIGHT_MAX_ENTRIES, getRecordNightMeasureShortLabel } from "@/utils/recordNight";
import { GUEST_COPY } from "@/utils/recordNightGuest";

import { REJECT_REQUEST_EFFECT, STAFF_NOTE_LIMIT, UNDO_REJECT_REQUEST_HINT } from "./copy";
import {
  REGISTRATION_TYPE_LABEL,
  formatShortDateTime,
  getMeasureFullLabel,
  getRegistrationType,
  getRequestPersonName,
  normalizeSearch,
} from "./helpers";
import { RnaIcon } from "./icons";
import { Avatar, CategoryPill, useFocusReturn } from "./parts";
import type { RnaContext } from "./types";

// Quante persone mostra la ricerca per nome: chi cerca restringe scrivendo.
const MAX_SEARCH_RESULTS = 6;
const MIN_SEARCH_LENGTH = 2;

// Un'iscrizione che si può scegliere: un suggerimento del server o una persona
// trovata cercando per nome fra le iscrizioni attive.
interface Candidate {
  registrationId: string;
  name: string;
  unitName: string;
  type: RecordNightRegistrationType;
  activeEntries: number;
  alreadyOnRecord: boolean;
  isAdult: boolean;
  // true = trovata con la ricerca: si mostra solo ciò che mostra già "Iscrivi
  // qualcuno" (unità, "Iscritto dal genitore", quanti record ha).
  fromSearch: boolean;
}

// Non selezionabile: già su questo record, o già a 2 record (lo rifiuterebbe anche
// il server).
function isUnavailable(candidate: Candidate) {
  return candidate.alreadyOnRecord || candidate.activeEntries >= RECORD_NIGHT_MAX_ENTRIES;
}

interface RequestCardProps {
  ctx: RnaContext;
  request: RecordNightStaffRequest;
  // Dentro un gruppo di omonimi il badge sta sul gruppo, non sulla carta.
  grouped?: boolean;
  // Quante richieste hanno lo stesso nome (badge sulla carta, fuori dai gruppi).
  sameNameCount?: number;
  // Selezione per il rifiuto in blocco: carta compatta con la casella.
  selectMode?: boolean;
  selected?: boolean;
  selectDisabled?: boolean;
  onToggleSelect?: () => void;
}

export function RequestCard({
  ctx,
  request,
  grouped = false,
  sameNameCount = 1,
  selectMode = false,
  selected = false,
  selectDisabled = false,
  onToggleSelect,
}: RequestCardProps) {
  const [pickedId, setPickedId] = useState("");
  const [verified, setVerified] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();
  const rejectButton = useRef<HTMLButtonElement>(null);
  const focusReject = useFocusReturn(rejectButton);

  const name = getRequestPersonName(request);
  const challenge = request.kind === "challenge";
  const record =
    challenge && request.recordId ? ctx.requests.recordsById.get(request.recordId) : undefined;
  const recordHidden = challenge && request.recordStatus === "hidden";
  const recordMissing = challenge && !request.recordTitle;
  const recordBlocked = recordHidden || recordMissing;
  const date = formatShortDateTime(request.createdAt);
  const { participants } = ctx;

  const suggestions = useMemo<Candidate[]>(
    () =>
      request.suggestions.map((suggestion) => ({
        registrationId: suggestion.registrationId,
        name: suggestion.name,
        unitName: suggestion.unitName,
        type: suggestion.type,
        activeEntries: suggestion.activeEntries,
        alreadyOnRecord: suggestion.alreadyOnRecord,
        isAdult: false,
        fromSearch: false,
      })),
    [request.suggestions],
  );

  const searchVisible = !selectMode && (searchOpen || suggestions.length === 0);
  const searchTerms = normalizeSearch(query);

  function toSearchCandidate(person: (typeof participants.list)[number]): Candidate {
    const taken =
      challenge && request.recordId
        ? ctx.requests.takenByRecord.get(request.recordId)?.has(person.registrationId) === true
        : false;
    return {
      registrationId: person.registrationId,
      name: person.name,
      unitName: person.unitName,
      type: getRegistrationType(person.registrationId),
      activeEntries: ctx.requests.activeEntryCounts.get(person.registrationId) ?? 0,
      alreadyOnRecord: taken,
      isAdult: person.isAdult,
      fromSearch: true,
    };
  }

  const matches = useMemo(() => {
    if (!searchVisible || searchTerms.length < MIN_SEARCH_LENGTH) return [];
    const terms = searchTerms.split(" ").filter(Boolean);
    const suggestedIds = new Set(suggestions.map((item) => item.registrationId));
    return participants.list
      .filter((person) => !suggestedIds.has(person.registrationId))
      .map((person) => ({ person, search: normalizeSearch(person.name) }))
      .filter((item) => terms.every((term) => item.search.includes(term)))
      .sort((left, right) => left.person.name.localeCompare(right.person.name, "it-IT"))
      .map((item) => item.person);
  }, [participants.list, searchTerms, searchVisible, suggestions]);

  // La scelta si risolve sempre sui dati di adesso: un suggerimento sparito dopo
  // una rilettura, o una persona non più iscritta, non resta scelta.
  const picked: Candidate | null = (() => {
    if (!pickedId) return null;
    const suggested = suggestions.find((item) => item.registrationId === pickedId);
    if (suggested) return suggested;
    const person = participants.list.find((item) => item.registrationId === pickedId);
    return person ? toSearchCandidate(person) : null;
  })();

  const pickedFromSearchOnly =
    picked &&
    picked.fromSearch &&
    !matches.some((person) => person.registrationId === picked.registrationId)
      ? picked
      : null;
  const shownMatches = matches.slice(0, MAX_SEARCH_RESULTS);
  const hiddenMatches = matches.length - shownMatches.length;

  const hasChoices =
    suggestions.length > 0 || pickedFromSearchOnly !== null || shownMatches.length > 0;
  const ready = Boolean(picked && !isUnavailable(picked) && verified && !recordBlocked);
  const hintId = `${baseId}-hint`;
  const groupName = `${baseId}-pick`;
  const labelId = `${baseId}-label`;
  const searchId = `${baseId}-search`;
  const verifyId = `${baseId}-verify`;
  const panelId = `${baseId}-reject`;
  const busyLink = ctx.busyKey === `req-link:${request.id}`;

  function pick(candidate: Candidate) {
    // La conferma vale per la persona che ha inviato la richiesta: se la scelta
    // cambia, si spunta di nuovo.
    if (pickedId && pickedId !== candidate.registrationId) setVerified(false);
    setPickedId(candidate.registrationId);
    setError(null);
  }

  async function link() {
    if (!picked || !verified || recordBlocked || isUnavailable(picked)) return;
    setError(null);
    const result = await ctx.requests.link(
      request,
      { registrationId: picked.registrationId, name: picked.name },
      verified,
    );
    if (!result.ok) setError(result.message);
  }

  async function reject(note: string) {
    setError(null);
    const result = await ctx.requests.reject(request, note);
    if (!result.ok) setError(result.message);
  }

  const className = [
    "rna-req",
    selectMode && selected ? "rna-req--selected" : "",
    !selectMode && picked ? "rna-req--picked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  let hint: string | null = null;
  if (recordHidden) {
    hint = "Il record è nascosto: mostralo di nuovo dai «Record nascosti» prima di collegare.";
  } else if (recordMissing) {
    hint = "Il record non c'è più: non si può collegare. Segna la richiesta «Non collegabile».";
  } else if (!ready) {
    hint =
      suggestions.length === 0
        ? "Cerca la persona fra le iscrizioni e spunta la conferma per collegare."
        : "Scegli una persona e spunta la conferma per collegare.";
  }

  return (
    <article aria-label={`Richiesta di ${name}`} className={className}>
      <header className="rna-req__head">
        <Avatar name={name} />
        <div className="rna-req__who">
          <h4>{name}</h4>
          <small>
            <span className="rna-unit">{request.unitName || "Unità non indicata"}</span>
            {date ? <span>{date}</span> : null}
          </small>
        </div>
        {selectMode ? (
          <label className="rna-pick">
            <input
              aria-label={`Seleziona la richiesta di ${name}`}
              checked={selected}
              disabled={selectDisabled && !selected}
              onChange={() => onToggleSelect?.()}
              type="checkbox"
            />
            <i aria-hidden="true">
              <AppIcon name="check" />
            </i>
          </label>
        ) : null}
      </header>

      {!grouped && sameNameCount > 1 ? (
        <span className="rna-dup">
          <AppIcon name="users" />
          {sameNameCount} richieste con lo stesso nome
        </span>
      ) : null}

      <div className="rna-req__body">
        <span className={challenge ? "rna-kind rna-kind--challenge" : "rna-kind"}>
          {challenge ? "Sfida" : "Proposta"}
        </span>
        {challenge ? (
          <div className="rna-req__record">
            <strong>{request.recordTitle || "Record non più disponibile"}</strong>
            {record ? (
              <span className="rna-record__meta">
                <CategoryPill category={record.category} />
                <span>
                  {getRecordNightMeasureShortLabel(record.measure, record.durationSeconds)}
                </span>
                {recordHidden ? <span className="rna-flag rna-flag--soft">Nascosto</span> : null}
              </span>
            ) : recordHidden ? (
              <span className="rna-record__meta">
                <span className="rna-flag rna-flag--soft">Nascosto</span>
              </span>
            ) : null}
          </div>
        ) : (
          <>
            <blockquote className="rna-req__quote">
              <span aria-hidden="true">“</span>
              {request.proposedText ?? ""}
              <span aria-hidden="true">”</span>
            </blockquote>
            <p className="rna-req__facts">
              <span>
                <b>Misura</b>{" "}
                {getMeasureFullLabel(request.proposedMeasure, request.proposedDurationSeconds)}
              </span>
              <span>
                <b>Serve</b> {request.proposedNeeds || "Niente"}
              </span>
            </p>
          </>
        )}
      </div>

      {selectMode ? null : (
        <>
          <div className="rna-sugg">
            <p className="rna-sugg__label" id={labelId}>
              Chi potrebbe essere
              {suggestions.length > 0 ? <span>Scegli l'iscrizione</span> : null}
            </p>
            {suggestions.length === 0 ? (
              <p className="rna-none">Nessuna iscrizione somiglia a questo nome.</p>
            ) : null}

            {hasChoices ? (
              <div aria-labelledby={labelId} className="rna-sugg__group" role="radiogroup">
                {suggestions.map((candidate) => (
                  <CandidateChoice
                    candidate={candidate}
                    checked={pickedId === candidate.registrationId}
                    disabled={ctx.busy}
                    groupName={groupName}
                    key={candidate.registrationId}
                    onPick={pick}
                    showType
                  />
                ))}
                {pickedFromSearchOnly ? (
                  <CandidateChoice
                    candidate={pickedFromSearchOnly}
                    checked
                    disabled={ctx.busy}
                    groupName={groupName}
                    onPick={pick}
                  />
                ) : null}
                {shownMatches.map((person) => {
                  const candidate = toSearchCandidate(person);
                  return (
                    <CandidateChoice
                      candidate={candidate}
                      checked={pickedId === candidate.registrationId}
                      disabled={ctx.busy}
                      groupName={groupName}
                      key={candidate.registrationId}
                      onPick={pick}
                    />
                  );
                })}
              </div>
            ) : null}

            {searchVisible ? (
              <>
                <div className="rna-search">
                  <RnaIcon name="search" />
                  <input
                    aria-label="Cerca per nome fra le iscrizioni"
                    autoComplete="off"
                    className="rna-input"
                    id={searchId}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Cerca per nome fra le iscrizioni"
                    type="search"
                    value={query}
                  />
                </div>
                {participants.status === "loading" ? (
                  <p className="rna-empty-inline" role="status">
                    Sto caricando le persone...
                  </p>
                ) : participants.status === "error" ? (
                  <div className="rna-notice rna-notice--error" role="alert">
                    <p>
                      Non riesco a caricare l'elenco delle persone. Controlla la connessione e
                      riprova.
                    </p>
                    <button
                      className="button button--ghost button--small"
                      onClick={participants.reload}
                      type="button"
                    >
                      Riprova
                    </button>
                  </div>
                ) : searchTerms.length < MIN_SEARCH_LENGTH ? (
                  <p className="rna-field__hint">
                    Scrivi almeno due lettere del nome o del cognome.
                  </p>
                ) : matches.length === 0 && !pickedFromSearchOnly ? (
                  <p className="rna-empty-inline">Nessuno con questo nome.</p>
                ) : hiddenMatches > 0 ? (
                  <p className="rna-field__hint">
                    Ce ne sono altri {hiddenMatches}: scrivi più lettere per restringere.
                  </p>
                ) : null}
              </>
            ) : (
              <button
                aria-expanded={false}
                className="rna-linkbtn rna-linkbtn--primary"
                disabled={ctx.busy}
                onClick={() => setSearchOpen(true)}
                type="button"
              >
                <RnaIcon name="search" />
                Non è nessuna di queste: cerca per nome
              </button>
            )}
          </div>

          <label className="rna-verify" htmlFor={verifyId}>
            <input
              checked={verified}
              disabled={ctx.busy}
              id={verifyId}
              onChange={(event) => setVerified(event.target.checked)}
              type="checkbox"
            />
            <span>{GUEST_COPY.verifiedLabel}</span>
          </label>

          <div className="rna-req__actions">
            <button
              aria-describedby={hint ? hintId : undefined}
              className="button button--primary button--small"
              disabled={!ready || ctx.busy}
              onClick={() => void link()}
              type="button"
            >
              <RnaIcon name="link" />
              <span>
                {busyLink ? "Sto collegando..." : picked ? `Collega a ${picked.name}` : "Collega"}
              </span>
            </button>
            <button
              aria-controls={rejecting ? panelId : undefined}
              aria-expanded={rejecting}
              className="button button--ghost button--small rna-danger"
              disabled={ctx.busy}
              onClick={() => {
                setError(null);
                setRejecting((current) => !current);
              }}
              ref={rejectButton}
              type="button"
            >
              <AppIcon name="x" />
              <span>Non collegabile</span>
            </button>
          </div>
          {hint ? (
            <p className="rna-req__hint" id={hintId}>
              {hint}
            </p>
          ) : null}

          {rejecting ? (
            <RejectRequestPanel
              busy={ctx.busyKey === `req-reject:${request.id}`}
              disabled={ctx.busy}
              id={panelId}
              name={name}
              onCancel={() => {
                setRejecting(false);
                setError(null);
                focusReject();
              }}
              onReject={(note) => void reject(note)}
            />
          ) : null}

          {error ? (
            <p className="rna-panel__error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Una scelta (suggerimento o persona trovata cercando)
// ---------------------------------------------------------------------------

interface CandidateChoiceProps {
  candidate: Candidate;
  checked: boolean;
  disabled: boolean;
  groupName: string;
  // Suggerimenti del server: mostrano anche il tipo di iscrizione.
  showType?: boolean;
  onPick: (candidate: Candidate) => void;
}

function CandidateChoice({
  candidate,
  checked,
  disabled,
  groupName,
  showType = false,
  onPick,
}: CandidateChoiceProps) {
  const unavailable = isUnavailable(candidate);
  const full = !candidate.alreadyOnRecord && candidate.activeEntries >= RECORD_NIGHT_MAX_ENTRIES;
  return (
    <label className={unavailable ? "rna-choice rna-choice--off" : "rna-choice"}>
      <input
        checked={checked}
        disabled={disabled || unavailable}
        name={groupName}
        onChange={() => onPick(candidate)}
        type="radio"
        value={candidate.registrationId}
      />
      <span className="rna-choice__body">
        <strong>
          {candidate.name}
          {candidate.isAdult ? <span className="rna-tag">Adulto</span> : null}
        </strong>
        <span className="rna-choice__meta">
          {showType || candidate.type === "child" ? (
            <span className={`rna-tag rna-tag--${candidate.type}`}>
              {REGISTRATION_TYPE_LABEL[candidate.type]}
            </span>
          ) : null}
          {candidate.unitName ? <span>{candidate.unitName}</span> : null}
          {candidate.activeEntries > 0 ? (
            <span className={full ? "rna-flag" : undefined}>
              Ha già {candidate.activeEntries} record
            </span>
          ) : null}
          {candidate.alreadyOnRecord ? (
            <span className="rna-flag">Già su questo record</span>
          ) : null}
        </span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Non collegabile (con nota interna facoltativa)
// ---------------------------------------------------------------------------

interface RejectRequestPanelProps {
  id: string;
  name: string;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
  onReject: (note: string) => void;
}

function RejectRequestPanel({
  id,
  name,
  busy,
  disabled,
  onCancel,
  onReject,
}: RejectRequestPanelProps) {
  const [note, setNote] = useState("");
  const noteId = `${id}-note`;
  const hintId = `${id}-hint`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    onReject(note.replace(/\s+/gu, " ").trim());
  }

  return (
    <form
      aria-labelledby={`${id}-heading`}
      className="rna-panel"
      id={id}
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="rna-panel__head">
        <h5 id={`${id}-heading`}>Segna come non collegabile</h5>
        <p className="rna-panel__note">La richiesta di {name} esce dalla coda.</p>
      </div>

      <div className="rna-field rna-field--wide">
        <div className="rna-field__top">
          <label htmlFor={noteId}>Nota interna (facoltativa)</label>
          <span aria-hidden="true" className="rna-counter">
            {Array.from(note).length}/{STAFF_NOTE_LIMIT}
          </span>
        </div>
        <textarea
          aria-describedby={hintId}
          className="rna-input rna-input--area"
          id={noteId}
          maxLength={STAFF_NOTE_LIMIT}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          value={note}
        />
        <p className="rna-field__hint" id={hintId}>
          La nota la vedono solo gli adulti che gestiscono i record: non arriva al telefono.
        </p>
      </div>

      <p className="rna-panel__footnote">
        {REJECT_REQUEST_EFFECT} {UNDO_REJECT_REQUEST_HINT}
      </p>

      <div className="rna-panel__actions">
        <button
          className="button button--ghost button--small"
          disabled={disabled}
          onClick={onCancel}
          type="button"
        >
          Annulla
        </button>
        <button
          className="button button--primary button--small rna-danger-solid"
          disabled={disabled}
          type="submit"
        >
          {busy ? "Sto segnando..." : "Non collegabile"}
        </button>
      </div>
    </form>
  );
}
