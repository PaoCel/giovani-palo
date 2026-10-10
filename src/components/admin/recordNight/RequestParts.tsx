import { useId, useRef, useState } from "react";

import type { RecordNightEntry } from "@/types";

import { getRegistrationType, getRequestPersonName } from "./helpers";
import { RnaIcon } from "./icons";
import { useFocusReturn } from "./parts";
import type { RnaContext } from "./types";

// Pezzi condivisi dalle parti che toccano le richieste senza account: la
// conferma di "Scollega" (sempre in riga, mai in una finestra) e l'etichetta
// "Da una richiesta senza account" sui tentativi nati da una richiesta.

interface UnlinkConfirmProps {
  id: string;
  // Nome digitato da chi ha inviato la richiesta (testo di uno sconosciuto).
  typedName: string;
  // Nome sull'iscrizione collegata.
  attemptName: string;
  // Iscrizione con un titolare (account o genitore): un `manual_` non ne ha.
  hasOwner: boolean;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  className?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

// Spiega cosa succede: il tentativo viene ritirato e la richiesta torna in coda.
// L'errore del server (per esempio "prima usa Riporta in attesa") compare qui sotto.
export function UnlinkConfirm({
  id,
  typedName,
  attemptName,
  hasOwner,
  busy,
  disabled,
  error,
  className,
  onCancel,
  onConfirm,
}: UnlinkConfirmProps) {
  const titleId = `${id}-title`;
  return (
    <div
      aria-labelledby={titleId}
      className={
        className
          ? `rna-confirm rna-confirm--unlink ${className}`
          : "rna-confirm rna-confirm--unlink"
      }
      id={id}
      role="group"
    >
      <p className="rna-confirm__title" id={titleId}>
        Scollegare la richiesta di {typedName}?
      </p>
      <ul className="rna-confirm__list">
        <li>Il tentativo di {attemptName} viene ritirato.</li>
        <li>La richiesta torna in «Da collegare».</li>
        {hasOwner ? <li>Chi ha l'account vede «Tolto da un adulto».</li> : null}
      </ul>
      {error ? (
        <p className="rna-panel__error" role="alert">
          {error}
        </p>
      ) : null}
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
          onClick={onConfirm}
          type="button"
        >
          {busy ? "Sto scollegando..." : "Scollega"}
        </button>
      </div>
    </div>
  );
}

// Etichetta sui tentativi con `fromGuestRequest`, con il nome digitato da chi ha
// inviato la richiesta (se la richiesta è ancora in elenco) e, se il tentativo è
// ancora quello collegato alla richiesta, "Scollega" con conferma in riga.
// Un tentativo vecchio di una richiesta già ricollegata altrove non si scollega
// da qui: toccherebbe il tentativo nuovo.
export function OriginLine({ ctx, entry }: { ctx: RnaContext; entry: RecordNightEntry }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();
  const unlinkButton = useRef<HTMLButtonElement>(null);
  const focusUnlink = useFocusReturn(unlinkButton);

  if (!entry.fromGuestRequest) return null;

  const request = entry.sourceRequestId ? ctx.requests.byId.get(entry.sourceRequestId) : undefined;
  const canUnlink =
    request !== undefined && request.status === "linked" && request.linkedEntryId === entry.id;
  const typedName = request ? getRequestPersonName(request) : "";
  const panelId = `${baseId}-unlink`;
  const busyHere = ctx.busyKey === `req-unlink:${request?.id ?? ""}`;

  async function unlink() {
    if (!request) return;
    setError(null);
    const result = await ctx.requests.unlink(request);
    if (result.ok) setConfirming(false);
    else setError(result.message);
  }

  function cancel() {
    setConfirming(false);
    setError(null);
    focusUnlink();
  }

  return (
    <div className="rna-origin">
      <span className="rna-origin__pill">
        <RnaIcon name="link" />
        Da una richiesta senza account
      </span>
      {request ? (
        <span className="rna-origin__typed">
          Scritto: {typedName} · {request.unitName}
        </span>
      ) : null}
      {canUnlink ? (
        <button
          aria-controls={confirming ? panelId : undefined}
          aria-expanded={confirming}
          aria-label={`Scollega la richiesta di ${typedName}`}
          className="rna-linkbtn"
          disabled={ctx.busy}
          onClick={() => {
            setError(null);
            setConfirming((current) => !current);
          }}
          ref={unlinkButton}
          type="button"
        >
          <RnaIcon name="unlink" />
          Scollega
        </button>
      ) : null}
      {confirming && request ? (
        <UnlinkConfirm
          attemptName={entry.participantName || "chi è collegato"}
          busy={busyHere}
          className="rna-origin__confirm"
          disabled={ctx.busy}
          error={error}
          hasOwner={getRegistrationType(entry.registrationId) !== "manual"}
          id={panelId}
          onCancel={cancel}
          onConfirm={() => void unlink()}
          typedName={typedName}
        />
      ) : null}
    </div>
  );
}
