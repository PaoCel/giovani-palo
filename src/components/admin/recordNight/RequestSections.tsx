import { useId, useRef, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import type { RecordNightEntry, RecordNightStaffRequest } from "@/types";

import {
  REGISTRATION_TYPE_LABEL,
  describeRequest,
  formatShortDateTime,
  getEntryStateChip,
  getRegistrationType,
  getRequestPersonName,
} from "./helpers";
import { RnaIcon } from "./icons";
import { Avatar, useFocusReturn } from "./parts";
import { UnlinkConfirm } from "./RequestParts";
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
  return (
    <ul className="rna-list">
      {requests.map((request) => (
        <LinkedRow
          ctx={ctx}
          entry={request.linkedEntryId ? entriesById.get(request.linkedEntryId) : undefined}
          key={request.id}
          request={request}
        />
      ))}
    </ul>
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
  const focusUnlink = useFocusReturn(unlinkButton);

  const typedName = getRequestPersonName(request);
  const registrationId = request.linkedRegistrationId ?? "";
  const person = registrationId
    ? ctx.participants.list.find((item) => item.registrationId === registrationId)
    : undefined;
  const attemptName = entry?.participantName || person?.name || "chi è collegato";
  const chip = getEntryStateChip(entry);
  const panelId = `${baseId}-unlink`;
  const details = [
    person?.unitName ?? "",
    registrationId ? REGISTRATION_TYPE_LABEL[getRegistrationType(registrationId)] : "",
  ].filter(Boolean);

  async function unlink() {
    setError(null);
    const result = await ctx.requests.unlink(request);
    if (result.ok) setConfirming(false);
    else setError(result.message);
  }

  return (
    <li className="rna-list__item rna-list__item--stack">
      <Avatar name={typedName} />
      <div className="rna-list__body">
        <div className="rna-list__head">
          <strong>{typedName}</strong>
          {chip ? (
            <span
              className={
                chip.tone ? `rna-state-chip rna-state-chip--${chip.tone}` : "rna-state-chip"
              }
            >
              {chip.label}
            </span>
          ) : null}
        </div>
        <p className="rna-list__quote">{describeRequest(request)}</p>
        {registrationId ? (
          <p className="rna-list__link">
            <RnaIcon name="link" />
            <span>
              Collegata a <b>{attemptName}</b>
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
          attemptName={attemptName}
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
  const name = getRequestPersonName(request);
  const date = formatShortDateTime(request.createdAt);

  async function reopen() {
    setError(null);
    const result = await ctx.requests.reopen(request);
    if (!result.ok) setError(result.message);
  }

  return (
    <li className="rna-list__item">
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
            <span>Nota</span> {request.staffNote}
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
// Richieste ritirate (sola lettura)
// ---------------------------------------------------------------------------

export function WithdrawnRequestsList({
  requests,
}: {
  requests: ReadonlyArray<RecordNightStaffRequest>;
}) {
  return (
    <ul className="rna-list">
      {requests.map((request) => {
        const name = getRequestPersonName(request);
        const date = formatShortDateTime(request.updatedAt);
        return (
          <li className="rna-list__item" key={request.id}>
            <Avatar name={name} />
            <div className="rna-list__body">
              <strong>{name}</strong>
              <p className="rna-list__link">
                <span className="rna-unit">{request.unitName || "Unità non indicata"}</span>
              </p>
              <p className="rna-list__quote">{describeRequest(request)}</p>
            </div>
            <small className="rna-list__date">
              <span>Ritirata da chi l'ha inviata</span>
              {date ? <span>{date}</span> : null}
            </small>
          </li>
        );
      })}
    </ul>
  );
}
