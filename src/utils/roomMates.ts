// Testi della stanza assegnata (docs/ROOM_MANAGEMENT.md, «Compagni di stanza»),
// condivisi dalla scheda del partecipante e da Famiglia.
//
// Questo file lo carica anche Node (tests/): niente alias "@/" fra gli import
// di valori.

import { fillCopy } from "../copy/parole.ts";
import { STANZA } from "../copy/stanza.ts";

export interface AssignedRoomMate {
  fullName: string;
  adult: boolean;
}

export interface AssignedRoom {
  name: string;
  capacity: number | null;
}

export interface AssignedRoomResult {
  room: AssignedRoom | null;
  mates: AssignedRoomMate[];
}

export const NO_ASSIGNED_ROOM: AssignedRoomResult = Object.freeze({ room: null, mates: [] });

// Risposta della callable `roomMates` ripulita: solo le chiavi del contratto,
// nomi non vuoti. Qualunque altra forma vale "nessuna stanza".
export function parseAssignedRoomResult(value: unknown): AssignedRoomResult {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const room = data.room && typeof data.room === "object" ? (data.room as Record<string, unknown>) : null;
  const name = typeof room?.name === "string" ? room.name.trim() : "";

  if (!room || !name) {
    return NO_ASSIGNED_ROOM;
  }

  const capacity =
    typeof room.capacity === "number" && Number.isInteger(room.capacity) && room.capacity > 0
      ? room.capacity
      : null;
  const mates = (Array.isArray(data.mates) ? data.mates : []).flatMap((item): AssignedRoomMate[] => {
    const mate = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const fullName = typeof mate.fullName === "string" ? mate.fullName.trim() : "";
    return fullName ? [{ fullName, adult: mate.adult === true }] : [];
  });

  return { room: { name, capacity }, mates };
}

// "Con Sara Conti, Marta Leone e Anna Neri (dirigente)"; senza compagni,
// "Per ora nessun altro in stanza.".
export function formatRoomMates(mates: AssignedRoomMate[]) {
  const names = mates.map((mate) =>
    mate.adult ? fillCopy(STANZA.adulto, { nome: mate.fullName, ruolo: STANZA.dirigente }) : mate.fullName,
  );

  if (names.length === 0) {
    return STANZA.nessunAltro;
  }

  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")}${STANZA.ultimoSeparatore}${names[names.length - 1]}`;

  return fillCopy(STANZA.con, { nomi: list });
}

// "101 · 3 posti letto", o solo il nome se il piano non dà i posti.
export function formatRoomBeds(room: AssignedRoom) {
  if (!room.capacity) {
    return room.name;
  }

  const posti =
    room.capacity === 1
      ? STANZA.postoLetto
      : fillCopy(STANZA.postiLetto, { n: String(room.capacity) });

  return fillCopy(STANZA.stanzaEPosti, { stanza: room.name, posti });
}
