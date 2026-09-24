// Floor plans of a lodging (e.g. the Foresteria), stored once per stake and shown to admins only.
// Only geometry and room numbers: never personal data, never committed to the public repository.

export type LayoutSpaceKind = "service" | "other" | "court";

export interface LayoutRect { x: number; y: number; w: number; h: number }
export interface LayoutRoom extends LayoutRect { number: string }
export interface LayoutSpace extends LayoutRect { kind: LayoutSpaceKind; label: string }
export interface LayoutMarker { label: string; x: number; y: number }

export interface LayoutFloor {
  id: string;
  name: string;
  width: number;
  height: number;
  outline: LayoutRect | null;
  rooms: LayoutRoom[];
  spaces: LayoutSpace[];
  markers: LayoutMarker[];
}

export interface RoomLayout {
  id: string;
  name: string;
  floors: LayoutFloor[];
}

export const ROOM_LAYOUT_VERSION = 1;
const MAX_FILE_BYTES = 1024 * 1024;
const LIMITS = { floors: 6, rooms: 200, spaces: 200, markers: 20 };
const SPACE_KINDS: readonly string[] = ["service", "other", "court"];
const SLUG = /^[a-z0-9-]+$/;

const invalid = (detail: string) => new Error(`File della pianta non valido: ${detail}.`);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Room numbers match plan room names without case or surrounding spaces. */
export const layoutRoomKey = (value: string) => value.trim().toLowerCase();

/** Use the matched geometry as the source of truth, keeping unmatched room floors. */
export function roomsWithLayoutFloors<T extends { name: string; floor: string }>(rooms: readonly T[], layout?: RoomLayout): T[] {
  const floors = new Map(layout?.floors.flatMap((floor) => floor.rooms.map((room) => [layoutRoomKey(room.number), floor.name] as const)) ?? []);
  return rooms.map((room) => ({ ...room, floor: floors.get(layoutRoomKey(room.name)) ?? room.floor }));
}

function text(value: unknown, label: string, max: number, pattern?: RegExp) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > max || (pattern && !pattern.test(trimmed))) throw invalid(label);
  return trimmed;
}

function number(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw invalid(label);
  return Math.round(value * 10) / 10;
}

function list(value: unknown, label: string, max: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw invalid(label);
  return value;
}

function rect(value: unknown, label: string, floor: { width: number; height: number }): LayoutRect {
  if (!isObject(value)) throw invalid(label);
  const x = number(value.x, `${label}: x`, 0, floor.width);
  const y = number(value.y, `${label}: y`, 0, floor.height);
  return { x, y, w: number(value.w, `${label}: larghezza`, 1, floor.width - x), h: number(value.h, `${label}: altezza`, 1, floor.height - y) };
}

export function parseRoomLayout(input: unknown): RoomLayout {
  if (!isObject(input)) throw invalid("serve un oggetto JSON");
  if (input.version !== ROOM_LAYOUT_VERSION) throw invalid("versione non supportata");
  const floors = list(input.floors, "piani", LIMITS.floors);
  if (!floors.length) throw invalid("nessun piano");
  const floorIds = new Set<string>();
  const numbers = new Set<string>();
  return {
    id: text(input.id, "id", 60, SLUG),
    name: text(input.name, "nome", 120),
    floors: floors.map((floor, index): LayoutFloor => {
      const label = `piano ${index + 1}`;
      if (!isObject(floor)) throw invalid(label);
      const id = text(floor.id, `${label}: id`, 40, SLUG);
      if (floorIds.has(id)) throw invalid(`${label}: id ripetuto`);
      floorIds.add(id);
      const size = { width: number(floor.width, `${label}: larghezza`, 100, 4000), height: number(floor.height, `${label}: altezza`, 100, 4000) };
      const rooms = list(floor.rooms, `${label}: stanze`, LIMITS.rooms).map((room, roomIndex) => {
        if (!isObject(room)) throw invalid(`${label}: stanza ${roomIndex + 1}`);
        const roomNumber = text(room.number, `${label}: numero della stanza ${roomIndex + 1}`, 12, /^[A-Za-z0-9-]+$/);
        if (numbers.has(layoutRoomKey(roomNumber))) throw invalid(`stanza ${roomNumber} ripetuta`);
        numbers.add(layoutRoomKey(roomNumber));
        return { number: roomNumber, ...rect(room, `stanza ${roomNumber}`, size) };
      });
      const spaces = list(floor.spaces, `${label}: spazi`, LIMITS.spaces).map((space, spaceIndex) => {
        if (!isObject(space) || !SPACE_KINDS.includes(String(space.kind))) throw invalid(`${label}: tipo dello spazio ${spaceIndex + 1}`);
        return {
          kind: space.kind as LayoutSpaceKind,
          label: text(space.label, `${label}: nome dello spazio ${spaceIndex + 1}`, 60),
          ...rect(space, `${label}: spazio ${spaceIndex + 1}`, size),
        };
      });
      const markers = list(floor.markers, `${label}: segnaposto`, LIMITS.markers).map((marker, markerIndex) => {
        if (!isObject(marker)) throw invalid(`${label}: segnaposto ${markerIndex + 1}`);
        return {
          label: text(marker.label, `${label}: nome del segnaposto ${markerIndex + 1}`, 30),
          x: number(marker.x, `${label}: segnaposto ${markerIndex + 1}`, 0, size.width),
          y: number(marker.y, `${label}: segnaposto ${markerIndex + 1}`, 0, size.height),
        };
      });
      const outline = floor.outline === undefined || floor.outline === null ? null : rect(floor.outline, `${label}: contorno`, size);
      return { id, name: text(floor.name, `${label}: nome`, 60), ...size, outline, rooms, spaces, markers };
    }),
  };
}

export async function readRoomLayoutFile(file: File): Promise<RoomLayout> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Il file della pianta deve essere più piccolo di 1 MB.");
  if (!/\.json$/i.test(file.name)) throw new Error("Scegli il file della pianta in formato .json.");
  let data: unknown;
  try { data = JSON.parse(await file.text()); } catch { throw invalid("il JSON non si legge"); }
  return parseRoomLayout(data);
}

export function layoutToDoc(layout: RoomLayout) {
  return { version: ROOM_LAYOUT_VERSION, name: layout.name, floors: layout.floors };
}

/** Throws when a stored layout no longer passes validation. */
export function layoutFromDoc(id: string, data: Record<string, unknown>): RoomLayout {
  return parseRoomLayout({ version: data.version, id, name: data.name, floors: data.floors });
}

/** The saved layout containing most rooms of the plan, or null when none contains any. */
export function pickLayout(layouts: readonly RoomLayout[], rooms: readonly { name: string }[]) {
  const names = new Set(rooms.map((room) => layoutRoomKey(room.name)));
  let best: { layout: RoomLayout; matched: number } | null = null;
  for (const layout of layouts) {
    const matched = layout.floors.reduce((sum, floor) => sum + floor.rooms.filter((room) => names.has(layoutRoomKey(room.number))).length, 0);
    if (matched && (!best || matched > best.matched)) best = { layout, matched };
  }
  return best;
}
