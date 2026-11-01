import type { Room, RoomCategory } from "../../functions/lib/roomPlannerCore.mjs";

// Per foglio, e tetto del piano uguale a MAX_ROOMS di roomManagementSave.
export const MAX_BULK_ROOMS = 50;
export const MAX_PLAN_ROOMS = 200;

export interface BulkRoomsInput {
  count: number;
  firstName: string;
  capacity: number;
  floor: string;
  category: RoomCategory;
}

const normalize = (value: string) => value.toLocaleLowerCase("it").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// The names continue the trailing number of the first one and keep its zero
// padding ("101" → 101, 102; "Camera 01" → Camera 01, Camera 02). Without a
// number, several rooms are numbered from 1 after the given name.
export function bulkRoomNames(firstName: string, count: number): string[] {
  const name = firstName.trim();
  if (!name || count < 1) return [];
  if (count === 1) return [name];
  const match = /^(.*?)(\d+)$/.exec(name);
  if (!match) return Array.from({ length: count }, (_, index) => `${name} ${index + 1}`);
  const [, prefix, digits] = match;
  return Array.from({ length: count }, (_, index) => `${prefix}${String(BigInt(digits) + BigInt(index)).padStart(digits.length, "0")}`);
}

export function buildBulkRooms(
  input: BulkRoomsInput,
  existing: readonly Room[],
  newId: () => string = () => crypto.randomUUID(),
): { rooms: Room[] } | { error: string } {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_BULK_ROOMS) {
    return { error: `Indica quante stanze aggiungere, da 1 a ${MAX_BULK_ROOMS}.` };
  }
  if (!input.firstName.trim()) return { error: "Indica il nome o il numero della prima stanza." };
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 50) {
    return { error: "I posti letto di ogni stanza vanno da 1 a 50." };
  }
  if (input.floor.trim().length > 80) return { error: "Il piano può avere al massimo 80 caratteri." };
  if (existing.length + input.count > MAX_PLAN_ROOMS) {
    const left = Math.max(0, MAX_PLAN_ROOMS - existing.length);
    if (!left) return { error: `Il piano ha già ${MAX_PLAN_ROOMS} stanze, il massimo.` };
    return { error: `Il piano può contenere al massimo ${MAX_PLAN_ROOMS} stanze: ${left === 1 ? "puoi aggiungerne ancora una" : `puoi aggiungerne ancora ${left}`}.` };
  }
  const names = bulkRoomNames(input.firstName, input.count);
  const tooLong = names.find((name) => name.length > 80);
  if (tooLong) return { error: `Il nome ${tooLong} supera 80 caratteri.` };
  const taken = new Set(existing.map((room) => normalize(room.name)));
  const duplicate = names.find((name) => taken.has(normalize(name)));
  if (duplicate) return { error: `La stanza ${duplicate} esiste già. Modificala dalla sua scheda.` };
  return {
    rooms: names.map((name) => ({
      id: newId(), name, capacity: input.capacity, floor: input.floor.trim(), category: input.category,
      accessible: false, notes: "", minAge: null, maxAge: null,
    })),
  };
}
