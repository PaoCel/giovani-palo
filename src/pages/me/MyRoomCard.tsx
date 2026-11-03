import { useEffect, useState } from "react";

import { Card } from "@/components/ui";
import { STANZA } from "@/copy/stanza";
import {
  roomMatesService,
  type AssignedRoomResult,
} from "@/services/firestore/roomMatesService";
import { getCommitteeInitials } from "@/utils/campGroups";
import { formatRoomBeds, formatRoomMates } from "@/utils/roomMates";

interface MyRoomCardProps {
  uid: string;
  // Gli account anonimi non chiedono i compagni: la callable li rifiuta.
  isAnonymous: boolean;
  stakeId: string;
  activityId: string;
  // Nome scritto sull'iscrizione dalla pubblicazione del piano: si vede subito,
  // posti letto e compagni arrivano dalla callable.
  roomName: string;
  roomsInfo: string;
}

type RoomMatesState =
  | { key: string; status: "ready"; result: AssignedRoomResult }
  | { key: string; status: "error" };

// "La tua stanza" nella scheda del partecipante (docs/ROOM_MANAGEMENT.md,
// «Compagni di stanza»). Il risultato vale solo per l'account e l'attività che
// l'hanno chiesto, come in FamilyRoomCard.
export function MyRoomCard({
  uid,
  isAnonymous,
  stakeId,
  activityId,
  roomName,
  roomsInfo,
}: MyRoomCardProps) {
  const contextKey = `${uid}|${stakeId}|${activityId}`;
  const [state, setState] = useState<RoomMatesState | null>(null);

  useEffect(() => {
    if (isAnonymous) {
      return;
    }

    let active = true;

    roomMatesService
      .getAssigned({ stakeId, activityId })
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
  }, [contextKey, isAnonymous, stakeId, activityId]);

  const current = !isAnonymous && state?.key === contextKey ? state : null;
  const room = current?.status === "ready" ? current.result.room : null;

  return (
    <Card title={STANZA.titolo}>
      <div
        aria-busy={current || isAnonymous ? undefined : true}
        className="my-activity-room"
      >
        <span className="my-activity-room__number" aria-hidden="true">
          {roomName.match(/\d+/u)?.[0] ?? getCommitteeInitials(roomName)}
        </span>
        <div className="my-activity-room__text">
          <p className="my-activity-room__name">{room ? formatRoomBeds(room) : roomName}</p>
          {room && current?.status === "ready" ? (
            <p>{formatRoomMates(current.result.mates)}</p>
          ) : null}
          {current?.status === "error" ? <p>{STANZA.errore}</p> : null}
        </div>
      </div>
      {roomsInfo ? (
        <dl className="my-activity-facts">
          <div>
            <dt>Alloggio</dt>
            <dd>{roomsInfo}</dd>
          </div>
        </dl>
      ) : null}
    </Card>
  );
}
