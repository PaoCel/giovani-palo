import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { Registration } from "@/types";
import { layoutRoomKey, type LayoutMarker, type LayoutRoom, type LayoutSpace, type RoomLayout } from "@/utils/roomLayout";
import { categoryLabels, type Room, type RoomPlan } from "../../../functions/lib/roomPlannerCore.mjs";
import "@/styles/roomMap.css";

interface Props {
  layout: RoomLayout;
  plan: RoomPlan;
  peopleById: Map<string, Registration>;
  nameOf: (person: Registration) => string;
  /** Set while a person is armed: returns why a room cannot take them, or null. */
  problemFor?: (room: Room) => string | null;
  onRoom: (room: Room) => void;
  onPerson: (personId: string) => void;
}

const SLOT = 23;
const RADIUS = 9.5;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((word) => word[0]).slice(0, 2).join("").toUpperCase();

function SpaceLabel({ space }: { space: LayoutSpace }) {
  const cx = space.x + space.w / 2;
  const cy = space.y + space.h / 2;
  // Narrow tall spaces (corridors) read better with a vertical label.
  const vertical = space.label.length * 5.6 > space.w - 8 && space.h > space.w;
  return <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>{space.label}</text>;
}

function Space({ space, hatch }: { space: LayoutSpace; hatch: string }) {
  if (space.kind === "court") {
    const cx = space.x + space.w / 2;
    const cy = space.y + space.h / 2;
    const base = Math.min(space.w, space.h);
    return <g className="rm-court">
      <rect x={space.x} y={space.y} width={space.w} height={space.h} rx={16} />
      {[0.37, 0.26, 0.15].map((ratio) => <circle key={ratio} cx={cx} cy={cy} r={base * ratio} />)}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">{space.label}</text>
    </g>;
  }
  return <g className={`rm-space rm-space--${space.kind}`}>
    <rect x={space.x} y={space.y} width={space.w} height={space.h} rx={space.kind === "other" ? 12 : 10} fill={space.kind === "other" ? `url(#${hatch})` : undefined} />
    <SpaceLabel space={space} />
  </g>;
}

function Marker({ marker }: { marker: LayoutMarker }) {
  const width = Math.max(44, marker.label.length * 5.4 + 16);
  return <g className="rm-marker">
    <rect x={marker.x - width / 2} y={marker.y - 20} width={width} height={16} rx={8} />
    <text x={marker.x} y={marker.y - 12} textAnchor="middle" dominantBaseline="central">{marker.label}</text>
    <path d={`M${marker.x} ${marker.y - 4}v6`} />
  </g>;
}

function NotBooked({ item }: { item: LayoutRoom }) {
  const vertical = item.h > item.w;
  const x = vertical ? item.x + item.w / 2 : item.x + 14;
  const anchor = vertical ? "middle" : "start";
  return <g className="rm-nb">
    <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={12} />
    <text className="rm-nb__num" x={x} y={vertical ? item.y + 22 : item.y + item.h / 2 - 1} textAnchor={anchor}>{item.number}</text>
    <text className="rm-nb__tag" x={x} y={vertical ? item.y + 35 : item.y + item.h / 2 + 12} textAnchor={anchor}>non prenotata</text>
  </g>;
}

function AccessibleIcon({ x, y }: { x: number; y: number }) {
  return <g className="rm-room__icon" transform={`translate(${x - 6} ${y - 6})`}>
    <circle cx="6" cy="1.6" r="1.4" />
    <path d="M5.5 4v4h3.5l1.6 3.2M5.5 6h3" />
    <path d="M3.6 6.4a3.6 3.6 0 1 0 4.8 4.6" />
  </g>;
}

function MapRoom({ item, room, ids, names, armed, problem, filters, onRoom, onPerson }: {
  item: LayoutRoom; room: Room; ids: string[]; names: string[]; armed: boolean; problem: string | null;
  filters: { glow: string; soft: string }; onRoom: (room: Room) => void; onPerson: (personId: string) => void;
}) {
  const vertical = item.h > item.w;
  const free = room.capacity - ids.length;
  const target = armed && !problem && free > 0;
  const cols = vertical ? Math.min(2, room.capacity) : Math.ceil(room.capacity / (room.capacity > 3 ? 2 : 1));
  const rows = Math.ceil(room.capacity / cols);
  const span = (count: number) => (count - 1) * SLOT + 2 * RADIUS;
  // Draw one seat per bed only when they fit; big rooms keep the count alone.
  const fits = vertical
    ? 58 + span(rows) <= item.h - 12 && span(cols) <= item.w - 8
    : item.w - 16 - span(cols) >= 64 && span(rows) <= item.h - 8;
  const x0 = vertical ? item.x + item.w / 2 - ((cols - 1) * SLOT) / 2 : item.x + item.w - 16 - RADIUS - (cols - 1) * SLOT;
  const y0 = vertical ? item.y + 58 : item.y + item.h / 2 - ((rows - 1) * SLOT) / 2;
  const tx = vertical ? item.x + item.w / 2 : item.x + 18;
  const anchor = vertical ? "middle" : "start";
  const label = `Stanza ${room.name}, ${categoryLabels[room.category]}, ${ids.length} posti occupati su ${room.capacity}${names.length ? `: ${names.join(", ")}` : ""}${armed && problem ? `. ${problem}` : ""}`;
  const state = armed ? (target ? " is-target" : " is-dim") : "";
  return <g className={`rm-room rm-room--${room.category}${state}`} role="button" tabIndex={0} aria-label={label}
    filter={`url(#${target ? filters.glow : filters.soft})`} onClick={() => onRoom(room)}
    onKeyDown={(event: KeyboardEvent<SVGGElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRoom(room); } }}>
    <title>{label}</title>
    <rect className="rm-room__tile" x={item.x} y={item.y} width={item.w} height={item.h} rx={12} />
    {vertical
      ? <rect className="rm-room__accent" x={item.x + 10} y={item.y + 6} width={Math.max(4, item.w - 20)} height={3} rx={1.5} />
      : <rect className="rm-room__accent" x={item.x + 6} y={item.y + 10} width={3} height={Math.max(4, item.h - 20)} rx={1.5} />}
    <text className="rm-room__num" x={tx} y={vertical ? item.y + 26 : item.y + item.h / 2 - 1} textAnchor={anchor}>{room.name}</text>
    <text className="rm-room__count" x={tx} y={vertical ? item.y + 39 : item.y + item.h / 2 + 12} textAnchor={anchor}>{ids.length}/{room.capacity} posti</text>
    {fits ? Array.from({ length: room.capacity }, (_, index) => {
      const cx = x0 + (index % cols) * SLOT;
      const cy = y0 + Math.floor(index / cols) * SLOT;
      const personId = ids[index];
      if (personId) {
        return <g key={index} className="rm-seat rm-seat--taken" onClick={(event) => { event.stopPropagation(); onPerson(personId); }}>
          <title>{names[index]}</title>
          <circle cx={cx} cy={cy} r={RADIUS} />
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">{initials(names[index])}</text>
        </g>;
      }
      if (target && index === ids.length) {
        return <g key={index} className="rm-seat rm-seat--open">
          <circle className="rm-seat__ring" cx={cx} cy={cy} r={RADIUS + 3.5} />
          <circle cx={cx} cy={cy} r={RADIUS} />
          <path d={`M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8`} />
        </g>;
      }
      return <circle key={index} className="rm-seat rm-seat--free" cx={cx} cy={cy} r={RADIUS} />;
    }) : null}
    {room.accessible && vertical ? <AccessibleIcon x={item.x + item.w / 2} y={item.y + item.h - 14} /> : null}
    {free <= 0 && vertical && !room.accessible ? <text className="rm-room__full" x={tx} y={item.y + item.h - 12} textAnchor="middle">Completa</text> : null}
  </g>;
}

export function RoomMap({ layout, plan, peopleById, nameOf, problemFor, onRoom, onPerson }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { hatch: `${uid}-hatch`, glow: `${uid}-glow`, soft: `${uid}-soft` };
  const roomsByKey = useMemo(() => new Map(plan.rooms.map((room) => [layoutRoomKey(room.name), room])), [plan.rooms]);
  const occupants = useMemo(() => {
    const byRoom = new Map<string, string[]>();
    for (const [personId, roomId] of Object.entries(plan.assignments)) byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), personId]);
    return byRoom;
  }, [plan.assignments]);
  const nameFor = (personId: string) => {
    const person = peopleById.get(personId);
    return person ? nameOf(person) : "Iscrizione non più disponibile";
  };
  const floors = layout.floors.map((floor) => {
    const rooms = floor.rooms.flatMap((item) => roomsByKey.get(layoutRoomKey(item.number)) ?? []);
    return {
      floor,
      booked: rooms.length,
      beds: rooms.reduce((sum, room) => sum + room.capacity, 0),
      taken: rooms.reduce((sum, room) => sum + (occupants.get(room.id)?.length ?? 0), 0),
    };
  });
  const [floorId, setFloorId] = useState(() => (floors.find((item) => item.booked) ?? floors[0]).floor.id);
  const current = (floors.find((item) => item.floor.id === floorId) ?? floors[0]).floor;
  const placed = new Set(layout.floors.flatMap((floor) => floor.rooms.map((room) => layoutRoomKey(room.number))));
  const unplaced = plan.rooms.filter((room) => !placed.has(layoutRoomKey(room.name)));
  const categories = [...new Set(current.rooms.flatMap((item) => roomsByKey.get(layoutRoomKey(item.number))?.category ?? []))];
  const hasNotBooked = current.rooms.some((item) => !roomsByKey.has(layoutRoomKey(item.number)));

  return <div className="rm-map">
    <div className="rm-bar">
      {floors.length > 1 ? <div className="rm-floors" role="group" aria-label="Piani">
        {floors.map(({ floor, beds, taken }) => <button key={floor.id} type="button" className={floor.id === current.id ? "is-on" : ""} aria-pressed={floor.id === current.id} onClick={() => setFloorId(floor.id)}>
          {floor.name}{beds ? <small>{taken}/{beds}</small> : null}
        </button>)}
      </div> : <strong className="rm-floor-name">{current.name}</strong>}
      <div className="rm-legend">
        {categories.map((category) => <span key={category} className={`rm-room--${category}`}><i />{categoryLabels[category]}</span>)}
        {hasNotBooked ? <span className="rm-legend__nb"><i />Non prenotata</span> : null}
      </div>
    </div>
    <div className="rm-canvas">
      <svg viewBox={`0 0 ${current.width} ${current.height}`} role="group" aria-label={`${layout.name}, ${current.name}`}>
        <defs>
          <pattern id={ids.hatch} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="#f3f5f8" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="#e2e7ee" strokeWidth="2" />
          </pattern>
          <filter id={ids.glow} x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#386f9b" floodOpacity="0.35" /></filter>
          <filter id={ids.soft} x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#101c30" floodOpacity="0.08" /></filter>
        </defs>
        {current.outline ? <rect className="rm-outline" x={current.outline.x} y={current.outline.y} width={current.outline.w} height={current.outline.h} rx={22} /> : null}
        {current.spaces.map((space, index) => <Space key={index} space={space} hatch={ids.hatch} />)}
        {current.markers.map((marker, index) => <Marker key={index} marker={marker} />)}
        {current.rooms.map((item) => {
          const room = roomsByKey.get(layoutRoomKey(item.number));
          if (!room) return <NotBooked key={item.number} item={item} />;
          const roomIds = [...(occupants.get(room.id) ?? [])].sort((a, b) => nameFor(a).localeCompare(nameFor(b), "it"));
          return <MapRoom key={item.number} item={item} room={room} ids={roomIds} names={roomIds.map(nameFor)}
            armed={Boolean(problemFor)} problem={problemFor ? problemFor(room) : null} filters={ids} onRoom={onRoom} onPerson={onPerson} />;
        })}
      </svg>
    </div>
    {unplaced.length ? <div className="rm-unplaced"><span>Non sulla pianta</span>
      {unplaced.map((room) => <button key={room.id} type="button" onClick={() => onRoom(room)}>{room.name}</button>)}
    </div> : null}
  </div>;
}
