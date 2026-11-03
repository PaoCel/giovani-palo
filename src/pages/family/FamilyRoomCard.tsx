import { useEffect, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import { fillCopy } from "@/copy/parole";
import { STANZA } from "@/copy/stanza";
import {
  roomMatesService,
  type AssignedRoomResult,
} from "@/services/firestore/roomMatesService";
import { formatRoomBeds, formatRoomMates } from "@/utils/roomMates";

interface FamilyRoomCardProps {
  parentUid: string;
  stakeId: string;
  activityId: string;
  childId: string;
  childName: string;
  // Nome scritto sull'iscrizione dalla pubblicazione del piano: si vede subito,
  // i compagni arrivano dalla callable.
  roomName: string;
}

type RoomMatesState =
  | { key: string; status: "ready"; result: AssignedRoomResult }
  | { key: string; status: "error" };

// Stanza del figlio in Famiglia (docs/ROOM_MANAGEMENT.md, «Compagni di
// stanza»). Il risultato vale solo per l'account e l'iscrizione che l'hanno
// chiesto: con un altro contesto la riga torna in attesa.
export function FamilyRoomCard({
  parentUid,
  stakeId,
  activityId,
  childId,
  childName,
  roomName,
}: FamilyRoomCardProps) {
  const contextKey = `${parentUid}|${stakeId}|${activityId}|${childId}`;
  const [state, setState] = useState<RoomMatesState | null>(null);

  useEffect(() => {
    let active = true;

    roomMatesService
      .getAssigned({ stakeId, activityId, childId })
      .then((result) => {
        if (active) setState({ key: contextKey, status: "ready", result });
      })
      .catch((error: unknown) => {
        console.warn("Compagni di stanza non disponibili.", error);
        if (active) setState({ key: contextKey, status: "error" });
      });

    return () => {
      active = false;
    };
  }, [contextKey, stakeId, activityId, childId]);

  const current = state?.key === contextKey ? state : null;
  const room = current?.status === "ready" ? current.result.room : null;

  return (
    <div aria-busy={current ? undefined : true} className="family-reg-room">
      <span aria-hidden="true" className="family-reg-room__icon">
        <AppIcon name="home" />
      </span>
      <div className="family-reg-room__info">
        <strong>{fillCopy(STANZA.titoloFiglio, { nome: childName })}</strong>
        <span>{room ? formatRoomBeds(room) : roomName}</span>
        {current?.status === "ready" && room ? (
          <span className="family-reg-room__mates">{formatRoomMates(current.result.mates)}</span>
        ) : null}
        {current?.status === "error" ? (
          <span className="family-reg-room__error">{STANZA.errore}</span>
        ) : null}
      </div>
    </div>
  );
}
