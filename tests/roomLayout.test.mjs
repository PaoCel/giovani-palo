import test from "node:test";
import assert from "node:assert/strict";
import { layoutFromDoc, layoutToDoc, parseRoomLayout, pickLayout, readRoomLayoutFile, roomsWithLayoutFloors } from "../src/utils/roomLayout.ts";

const floor = (rooms, extra = {}) => ({ id: "piano-terra", name: "Piano terra", width: 900, height: 600, rooms, ...extra });
const sample = () => ({
  version: 1,
  id: "foresteria-demo",
  name: "Foresteria demo",
  floors: [
    floor([{ number: "104", x: 10, y: 10, w: 60, h: 140 }, { number: "133A", x: 80, y: 10, w: 60, h: 60 }], {
      outline: { x: 0, y: 0, w: 900, h: 600 },
      spaces: [{ kind: "court", label: "Corte", x: 200, y: 200, w: 300, h: 200 }],
      markers: [{ label: "Ingresso", x: 450, y: 20 }],
    }),
    { id: "primo-piano", name: "Primo piano", width: 900, height: 600, rooms: [{ number: "215", x: 10, y: 10, w: 120, h: 100 }] },
  ],
});

test("i piani della pianta prevalgono sui numeri inferiti dal modulo", () => {
  const rooms = [{ name: "104", floor: "1" }, { name: "215", floor: "2" }, { name: " 133A ", floor: "" }, { name: "extra", floor: "Terzo" }];
  assert.deepEqual(roomsWithLayoutFloors(rooms, parseRoomLayout(sample())).map((room) => room.floor), ["Piano terra", "Primo piano", "Piano terra", "Terzo"]);
  assert.equal(rooms[0].floor, "1");
  assert.deepEqual(roomsWithLayoutFloors(rooms), rooms);
});

test("reads a valid layout, fills the optional parts and round-trips through Firestore", () => {
  const layout = parseRoomLayout(sample());
  assert.equal(layout.floors.length, 2);
  assert.deepEqual([layout.floors[1].spaces, layout.floors[1].markers, layout.floors[1].outline], [[], [], null]);
  assert.deepEqual(layout.floors[0].rooms[1], { number: "133A", x: 80, y: 10, w: 60, h: 60 });
  assert.deepEqual(layoutFromDoc("foresteria-demo", layoutToDoc(layout)), layout);
});

test("rejects layouts that could not be drawn or matched safely", () => {
  const cases = [
    [(layout) => { layout.version = 2; }, /versione/],
    [(layout) => { layout.id = "Foresteria Roma"; }, /id/],
    [(layout) => { layout.floors[1].rooms[0].number = "104"; }, /stanza 104 ripetuta/],
    [(layout) => { layout.floors[0].rooms[0].w = 2000; }, /stanza 104: larghezza/],
    [(layout) => { layout.floors[0].rooms[0].x = "10"; }, /stanza 104: x/],
    [(layout) => { layout.floors[0].spaces[0].kind = "giardino"; }, /tipo dello spazio/],
    [(layout) => { layout.floors = []; }, /nessun piano/],
    [(layout) => { layout.floors = Array.from({ length: 7 }, (_, index) => ({ ...layout.floors[1], id: `p${index}`, rooms: [] })); }, /piani/],
  ];
  for (const [mutate, message] of cases) {
    const layout = sample();
    mutate(layout);
    assert.throws(() => parseRoomLayout(layout), message);
  }
  assert.throws(() => layoutFromDoc("rotta", { version: 1, name: "Rotta", floors: "no" }), /piani/);
});

test("picks the saved layout that contains most rooms of the plan", () => {
  const foresteria = parseRoomLayout(sample());
  const other = parseRoomLayout({ ...sample(), id: "altro", floors: [floor([{ number: "104", x: 10, y: 10, w: 60, h: 140 }])] });
  assert.equal(pickLayout([other, foresteria], [{ name: "104" }, { name: "215" }]).layout.id, "foresteria-demo");
  assert.equal(pickLayout([other, foresteria], [{ name: " 133a " }]).matched, 1);
  assert.equal(pickLayout([foresteria], [{ name: "301" }]), null);
});

test("reads only small .json files", async () => {
  await assert.rejects(readRoomLayoutFile(new File(["{}"], "pianta.txt")), /\.json/);
  await assert.rejects(readRoomLayoutFile(new File(["{"], "pianta.json")), /JSON/);
  assert.equal((await readRoomLayoutFile(new File([JSON.stringify(sample())], "pianta.json"))).name, "Foresteria demo");
});
