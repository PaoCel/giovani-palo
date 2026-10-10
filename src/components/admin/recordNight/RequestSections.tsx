import { useId, useRef, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import type { RecordNightEntry, RecordNightStaffRequest } from "@/types";
import { getStaffLinkedState, groupLinkedRequests } from "@/utils/recordNightGuest";

import {
  REGISTRATION_TYPE_LABEL,
  describeRequest,
  formatShortDateTime,
  getRegistrationType,
  getRequestPersonName,
  WITHDRAWN_BY_SELF_LABEL,
  getWithdrawalLabel,
  stripBidi,
} from "./helpers";
import { RnaIcon } from "./icons";
import { Avatar, rememberFocusNeighbour, useFocusReturn } from "./parts";
import { UnlinkConfirm, describeAttempt } from "./RequestParts";
import type { RnaContext } from "./types";

// Sezioni chiuse delle richieste senza account: "Collegate" (con Scollega),
// "Non collegate" (con Riapri) e "Richieste ritirate" (sola lettura). Si chiama
// "Richieste ritirate" per non confondersi con "Ritirati", che sono i tentativi.

// ---------------------------------------------------------------------------
// Collegate
// ---------------------------------------------------------------------------

export function LinkedRequestsList({
  ctx,
  requests,
  entriesById,
}: {
  ctx: RnaContext;
  requests: ReadonlyArray<RecordNightStaffRequest>;
  entriesById: ReadonlyMap<string, RecordNightEntry>;
}) {
  // Divise per stato del tentativo (in attesa, approvate, non accettate, ritirate):
  // Scollega resta disponibile da ogni stato, anche da un tentativo già ritirato o
  // non accettato.
  const groups = groupLinkedRequests(requests);
  return (
    <div className="rna-linked-groups">
      {groups.map((group) => (
        <section
          aria-label={`${group.label} (${group.requests.length})`}
          className="rna-linked-group"
          key={group.key}
        >
          <h4 className="rna-linked-group__title">
            {group.label}
            <span>{group.requests.length}</span>
          </h4>
          <ul className="rna-list">
            {group.requests.map((request) => (
              <LinkedRow
                ctx={ctx}
                entry={request.linkedEntryId ? entriesById.get(request.linkedEntryId) : undefined}
                key={request.id}
                request={request}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LinkedRow({
  ctx,
  request,
  entry,
}: {
  ctx: RnaContext;
  request: RecordNightStaffRequest;
  entry: RecordNightEntry | undefined;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();
  const unlinkButton = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const focusUnlink = useFocusReturn(unlinkButton);

  const typedName = getRequestPersonName(request);
  const registrationId = request.linkedRegistrationId ?? "";
  const person = registrationId
    ? ctx.participants.list.find((item) => item.registrationId === registrationId)
    : undefined;
  const knownName = entry?.participantName || person?.name || "";
  const attemptName = knownName || "chi è collegato";
  // Lo stato del tentativo lo dà il server con la richiesta: il testo dice tutto,
  // il colore è solo un aiuto.
  const state = getStaffLinkedState(request);
  // Su un record (iscrizione) o ancora proposta: lo dice il tentativo se lo conosco,
  // altrimenti la richiesta (una sfida è sempre su un record).
  const onRecord = entry
    ? entry.recordId !== null
    : request.kind === "challenge" || state.key === "approved";
  const panelId = `${baseId}-unlink`;
  const details = [
    person?.unitName ?? "",
    registrationId ? REGISTRATION_TYPE_LABEL[getRegistrationType(registrationId)] : "",
  ].filter(Boolean);

  async function unlink() {
    setError(null);
    const restoreFocus = rememberFocusNeighbour(rowRef.current, ctx.anchors.queue);
    const result = await ctx.requests.unlink(request);
    if (result.ok) {
      setConfirming(false);
      restoreFocus();
    } else {
      setError(result.message);
    }
  }

  return (
    <li className="rna-list__item rna-list__item--stack" ref={rowRef}>
      <Avatar name={typedName} />
      <div className="rna-list__body">
        <div className="rna-list__head">
          <strong>{typedName}</strong>
          <span
            className={
              state.tone ? `rna-state-chip rna-state-chip--${state.tone}` : "rna-state-chip"
            }
          >
            {state.key === "withdrawn" ? getWithdrawalLabel(state.withdrawnBy) : state.label}
          </span>
        </div>
        <p className="rna-list__quote">{describeRequest(request)}</p>
        {registrationId ? (
          <p className="rna-list__link">
            <RnaIcon name="link" />
            <span>
              Collegata a {knownName ? <b>{knownName}</b> : "un'iscrizione"}
              {details.length > 0 ? ` · ${details.join(" · ")}` : ""}
            </span>
          </p>
        ) : null}
      </div>
      <button
        aria-controls={confirming ? panelId : undefined}
        aria-expanded={confirming}
        aria-label={`Scollega la richiesta di ${typedName}`}
        className="button button--ghost button--small rna-danger"
        disabled={ctx.busy}
        onClick={() => {
          setError(null);
          setConfirming((current) => !current);
        }}
        ref={unlinkButton}
        type="button"
      >
        <RnaIcon name="unlink" />
        <span>Scollega</span>
      </button>
      {confirming ? (
        <UnlinkConfirm
          attemptStatus={state.key}
          subject={describeAttempt(attemptName, onRecord)}
          busy={ctx.busyKey === `req-unlink:${request.id}`}
          className="rna-list__panel"
          disabled={ctx.busy}
          error={error}
          hasOwner={registrationId ? getRegistrationType(registrationId) !== "manual" : false}
          id={panelId}
          onCancel={() => {
            setConfirming(false);
            setError(null);
            focusUnlink();
          }}
          onConfirm={() => void unlink()}
          typedName={typedName}
        />
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Non collegate
// ---------------------------------------------------------------------------

export function NotLinkedRequestsList({
  ctx,
  requests,
}: {
  ctx: RnaContext;
  requests: ReadonlyArray<RecordNightStaffRequest>;
}) {
  return (
    <ul className="rna-list">
      {requests.map((request) => (
        <NotLinkedRow ctx={ctx} key={request.id} request={request} />
      ))}
    </ul>
  );
}

function NotLinkedRow({ ctx, request }: { ctx: RnaContext; request: RecordNightStaffRequest }) {
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const name = getRequestPersonName(request);
  const date = formatShortDateTime(request.createdAt);

  async function reopen() {
    setError(null);
    const restoreFocus = rememberFocusNeighbour(rowRef.current, ctx.anchors.queue);
    const result = await ctx.requests.reopen(request);
    if (result.ok) restoreFocus();
    else setError(result.message);
  }

  return (
    <li className="rna-list__item" ref={rowRef}>
      <Avatar name={name} />
      <div className="rna-list__body">
        <strong>{name}</strong>
        <p className="rna-list__link">
          <span className="rna-unit">{request.unitName || "Unità non indicata"}</span>
          {date ? <span>{date}</span> : null}
        </p>
        <p className="rna-list__quote">{describeRequest(request)}</p>
        {request.staffNote ? (
          <p className="rna-list__reason">
            <span>Nota</span> {stripBidi(request.staffNote)}
          </p>
        ) : null}
        {error ? (
          <p className="rna-panel__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button
        aria-label={`Riapri la richiesta di ${name}`}
        className="button button--ghost button--small"
        disabled={ctx.busy}
        onClick={() => void reopen()}
        type="button"
      >
        <AppIcon name="refresh" />
        <span>{ctx.busyKey === `req-reopen:${request.id}` ? "Un momento..." : "Riapri"}</span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Richieste ritirate (si possono riaprire)
// ---------------------------------------------------------------------------

// Il telefono ritira da solo finché la finestra è aperta; dopo la chiusura, o con
// il telefono perso, "Riapri" è l'unica strada: la richiesta torna in "Da collegare".
export function WithdrawnRequestsList({
  ctx,
  requests,
}: {
  ctx: RnaContext;
  requests: ReadonlyArray<RecordNightStaffRequest>;
}) {
  return (
    <ul className="rna-list">
      {requests.map((request) => (
        <WithdrawnRow ctx={ctx} key={request.id} request={request} />
      ))}
    </ul>
  );
}

function WithdrawnRow({ ctx, request }: { ctx: RnaContext; request: RecordNightStaffRequest }) {
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const name = getRequestPersonName(request);
  const date = formatShortDateTime(request.updatedAt);

  async function reopen() {
    setError(null);
    const restoreFocus = rememberFocusNeighbour(rowRef.current, ctx.anchors.queue);
    const result = await ctx.requests.reopen(request);
    if (result.ok) restoreFocus();
    else setError(result.message);
  }

  return (
    <li className="rna-list__item" ref={rowRef}>
      <Avatar name={name} />
      <div className="rna-list__body">
        <strong>{name}</strong>
        <p className="rna-list__link">
          <span className="rna-unit">{request.unitName || "Unità non indicata"}</span>
        </p>
        <p className="rna-list__quote">{describeRequest(request)}</p>
        <small className="rna-list__date rna-list__date--inline">
          <span>{WITHDRAWN_BY_SELF_LABEL}</span>
          {date ? <span>{date}</span> : null}
        </small>
        {error ? (
          <p className="rna-panel__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button
        aria-label={`Riapri la richiesta di ${name}`}
        className="button button--ghost button--small"
        disabled={ctx.busy}
        onClick={() => void reopen()}
        type="button"
      >
        <AppIcon name="refresh" />
        <span>{ctx.busyKey === `req-reopen:${request.id}` ? "Un momento..." : "Riapri"}</span>
      </button>
    </li>
  );
}
