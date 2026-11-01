import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MAX_BULK_ROOMS, MAX_PLAN_ROOMS, buildBulkRooms, bulkRoomNames } from "../src/utils/roomBulk.ts";
import { MISSING_STAFF_ROOM, emptyRoomPlan, validateRoomPlan } from "../functions/lib/roomPlannerCore.mjs";

// Contratto: docs/ATTIVITA_MODULARI.md, «Quinto incremento: finitura alloggi»,
// e docs/ROOM_MANAGEMENT.md, «Interfaccia e importazione».

function sequentialIds() {
  let next = 0;
  return () => `id-${++next}`;
}

function input(extra = {}) {
  return { count: 3, firstName: "101", capacity: 4, floor: "Primo", category: "boys", ...extra };
}

function existingRoom(id, name, extra = {}) {
  return { id, name, capacity: 2, floor: "", category: "boys", accessible: false, notes: "", minAge: null, maxAge: null, ...extra };
}

function existingRooms(count) {
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze(existingRoom(`old-${index}`, `Vecchia ${index}`))));
}

// Il server (functions/lib/roomManagement.js) è la fonte dei limiti: il client
// non deve promettere più di quanto la callable accetti.
const serverSource = readFileSync(new URL("../functions/lib/roomManagement.js", import.meta.url), "utf8");
const SERVER_MAX_ROOMS = Number(/const MAX_ROOMS = (\d+);/.exec(serverSource)?.[1]);
const SERVER_ID_PATTERN = new RegExp(/const ID_PATTERN = \/(.+)\/u;/.exec(serverSource)?.[1] ?? "^$", "u");

test("la numerazione continua il numero finale e ne conserva gli zeri", () => {
  assert.deepEqual(bulkRoomNames("101", 3), ["101", "102", "103"]);
  assert.deepEqual(bulkRoomNames("Camera 01", 3), ["Camera 01", "Camera 02", "Camera 03"]);
  assert.deepEqual(bulkRoomNames("001", 3), ["001", "002", "003"]);
  assert.deepEqual(bulkRoomNames("A-07", 2), ["A-07", "A-08"]);
  assert.deepEqual(bulkRoomNames("Piano 2 - 05", 2), ["Piano 2 - 05", "Piano 2 - 06"]);
});

test("superato il padding le cifre crescono senza tagliare il numero", () => {
  assert.deepEqual(bulkRoomNames("Camera 09", 2), ["Camera 09", "Camera 10"]);
  assert.deepEqual(bulkRoomNames("Camera 99", 2), ["Camera 99", "Camera 100"]);
  assert.deepEqual(bulkRoomNames("9", 3), ["9", "10", "11"]);
  assert.deepEqual(bulkRoomNames("098", 4), ["098", "099", "100", "101"]);
});

test("i numeri oltre la precisione di Number restano esatti", () => {
  assert.deepEqual(bulkRoomNames("Stanza 9007199254740993", 2), ["Stanza 9007199254740993", "Stanza 9007199254740994"]);
  assert.deepEqual(bulkRoomNames("99999999999999999999", 2), ["99999999999999999999", "100000000000000000000"]);
  assert.deepEqual(bulkRoomNames("00000000000000000000001", 2), ["00000000000000000000001", "00000000000000000000002"]);
});

test("senza numero finale le stanze si numerano da 1 dopo il nome", () => {
  assert.deepEqual(bulkRoomNames("Camera", 3), ["Camera 1", "Camera 2", "Camera 3"]);
  assert.deepEqual(bulkRoomNames("Camera 1a", 2), ["Camera 1a 1", "Camera 1a 2"]);
  assert.deepEqual(bulkRoomNames("  Camera  ", 2), ["Camera 1", "Camera 2"]);
});

test("con una sola stanza il nome resta quello scritto, senza numero aggiunto", () => {
  assert.deepEqual(bulkRoomNames("Camera", 1), ["Camera"]);
  assert.deepEqual(bulkRoomNames("101", 1), ["101"]);
  assert.deepEqual(bulkRoomNames("  Camera 09 ", 1), ["Camera 09"]);
});

test("nome vuoto o quantità non positiva non generano nomi", () => {
  assert.deepEqual(bulkRoomNames("", 3), []);
  assert.deepEqual(bulkRoomNames("   ", 3), []);
  assert.deepEqual(bulkRoomNames("101", 0), []);
  assert.deepEqual(bulkRoomNames("101", -2), []);
});

test("la stanza generata ha gli stessi campi di una stanza nuova e il piano ripulito", () => {
  const result = buildBulkRooms(input({ floor: "  Primo piano  ", category: "girls" }), [], sequentialIds());
  assert.deepEqual(result, {
    rooms: ["101", "102", "103"].map((name, index) => ({
      id: `id-${index + 1}`,
      name,
      capacity: 4,
      floor: "Primo piano",
      category: "girls",
      accessible: false,
      notes: "",
      minAge: null,
      maxAge: null,
    })),
  });
});

test("gli id vengono dal generatore iniettato, uno per stanza e nell'ordine dei nomi", () => {
  let calls = 0;
  const result = buildBulkRooms(input({ count: 4 }), [], () => `x${++calls}`);
  assert.equal(calls, 4);
  assert.deepEqual(result.rooms.map(({ id, name }) => [id, name]), [["x1", "101"], ["x2", "102"], ["x3", "103"], ["x4", "104"]]);
});

test("un errore non chiama il generatore di id", () => {
  let calls = 0;
  const result = buildBulkRooms(input({ count: 0 }), [], () => `x${++calls}`);
  assert.ok("error" in result);
  assert.equal(calls, 0);
});

test("il generatore predefinito produce id unici accettati dalla callable", () => {
  const result = buildBulkRooms(input({ count: MAX_BULK_ROOMS }), []);
  const ids = result.rooms.map(({ id }) => id);
  assert.equal(new Set(ids).size, MAX_BULK_ROOMS);
  for (const id of ids) assert.match(id, SERVER_ID_PATTERN);
});

test("ogni categoria scelta arriva su tutte le stanze generate", () => {
  for (const category of ["unassigned", "boys", "girls", "staff_male", "staff_female"]) {
    const result = buildBulkRooms(input({ category }), [], sequentialIds());
    assert.deepEqual(result.rooms.map((room) => room.category), [category, category, category]);
  }
});

test("i tetti sono 50 stanze per foglio e 200 per piano, come il server", () => {
  assert.equal(MAX_BULK_ROOMS, 50);
  assert.equal(MAX_PLAN_ROOMS, 200);
  assert.equal(MAX_PLAN_ROOMS, SERVER_MAX_ROOMS);
});

test("la quantità va da 1 a 50, intera", () => {
  const message = "Indica quante stanze aggiungere, da 1 a 50.";
  for (const count of [0, -1, 51, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(buildBulkRooms(input({ count }), [], sequentialIds()), { error: message }, `quantità ${count}`);
  }
  assert.equal(buildBulkRooms(input({ count: 1 }), [], sequentialIds()).rooms.length, 1);
  assert.equal(buildBulkRooms(input({ count: 50 }), [], sequentialIds()).rooms.length, 50);
});

test("il nome della prima stanza è obbligatorio", () => {
  for (const firstName of ["", "   "]) {
    assert.deepEqual(buildBulkRooms(input({ firstName }), [], sequentialIds()), { error: "Indica il nome o il numero della prima stanza." });
  }
});

test("i posti letto vanno da 1 a 50, interi", () => {
  const message = "I posti letto di ogni stanza vanno da 1 a 50.";
  for (const capacity of [0, -3, 51, 2.5, Number.NaN]) {
    assert.deepEqual(buildBulkRooms(input({ capacity }), [], sequentialIds()), { error: message }, `posti ${capacity}`);
  }
  assert.equal(buildBulkRooms(input({ capacity: 1 }), [], sequentialIds()).rooms[0].capacity, 1);
  assert.equal(buildBulkRooms(input({ capacity: 50 }), [], sequentialIds()).rooms[0].capacity, 50);
});

test("il piano ha al massimo 80 caratteri dopo il trim", () => {
  assert.deepEqual(buildBulkRooms(input({ floor: "p".repeat(81) }), [], sequentialIds()), { error: "Il piano può avere al massimo 80 caratteri." });
  assert.equal(buildBulkRooms(input({ floor: "p".repeat(80) }), [], sequentialIds()).rooms[0].floor, "p".repeat(80));
  assert.equal(buildBulkRooms(input({ floor: `  ${"p".repeat(80)}  ` }), [], sequentialIds()).rooms[0].floor, "p".repeat(80));
  assert.equal(buildBulkRooms(input({ floor: "" }), [], sequentialIds()).rooms[0].floor, "");
});

test("oltre 200 stanze nel piano dice quante se ne possono ancora aggiungere", () => {
  assert.equal(buildBulkRooms(input({ count: 50 }), existingRooms(150), sequentialIds()).rooms.length, 50);
  assert.deepEqual(buildBulkRooms(input({ count: 50 }), existingRooms(151), sequentialIds()), {
    error: "Il piano può contenere al massimo 200 stanze: puoi aggiungerne ancora 49.",
  });
  assert.deepEqual(buildBulkRooms(input({ count: 2 }), existingRooms(199), sequentialIds()), {
    error: "Il piano può contenere al massimo 200 stanze: puoi aggiungerne ancora una.",
  });
  assert.equal(buildBulkRooms(input({ count: 1 }), existingRooms(199), sequentialIds()).rooms.length, 1);
  // A piano pieno non si propone di aggiungerne «ancora 0».
  assert.deepEqual(buildBulkRooms(input({ count: 1 }), existingRooms(200), sequentialIds()), {
    error: "Il piano ha già 200 stanze, il massimo.",
  });
  assert.deepEqual(buildBulkRooms(input({ count: 1 }), existingRooms(210), sequentialIds()), {
    error: "Il piano ha già 200 stanze, il massimo.",
  });
});

test("un nome generato oltre 80 caratteri ferma tutto il foglio e viene citato", () => {
  const firstName = `${"A".repeat(78)}99`;
  assert.equal(buildBulkRooms(input({ firstName, count: 1 }), [], sequentialIds()).rooms[0].name, firstName);
  assert.deepEqual(buildBulkRooms(input({ firstName, count: 2 }), [], sequentialIds()), {
    error: `Il nome ${"A".repeat(78)}100 supera 80 caratteri.`,
  });
  const base = "B".repeat(78);
  assert.deepEqual(buildBulkRooms(input({ firstName: base, count: 10 }), [], sequentialIds()), {
    error: `Il nome ${base} 10 supera 80 caratteri.`,
  });
  assert.equal(buildBulkRooms(input({ firstName: base, count: 9 }), [], sequentialIds()).rooms.at(-1).name, `${base} 9`);
});

test("un nome già usato ferma il foglio ignorando maiuscole, accenti e spazi esterni", () => {
  const duplicateOf = (existingName, firstName = "Camera 1") =>
    buildBulkRooms(input({ firstName }), [existingRoom("old", existingName)], sequentialIds());
  const message = "La stanza Camera 2 esiste già. Modificala dalla sua scheda.";
  assert.deepEqual(duplicateOf("Camera 2"), { error: message });
  assert.deepEqual(duplicateOf("CAMERA 2"), { error: message });
  assert.deepEqual(duplicateOf("Càmera 2"), { error: message });
  assert.deepEqual(duplicateOf("Cámera 2"), { error: message }, "accento composto con un segno combinante");
  assert.deepEqual(duplicateOf("  camera 2 "), { error: message });
  assert.deepEqual(duplicateOf("camera 1", "Càmera 1"), { error: "La stanza Càmera 1 esiste già. Modificala dalla sua scheda." });
  assert.deepEqual(duplicateOf("Camera 03", "Camera 01"), { error: "La stanza Camera 03 esiste già. Modificala dalla sua scheda." });
});

test("si cita il primo nome duplicato nell'ordine di generazione", () => {
  const result = buildBulkRooms(input({ firstName: "101", count: 5 }), [existingRoom("a", "105"), existingRoom("b", "103")], sequentialIds());
  assert.deepEqual(result, { error: "La stanza 103 esiste già. Modificala dalla sua scheda." });
});

test("nomi solo simili alle stanze esistenti non sono duplicati", () => {
  const existing = [existingRoom("a", "Camera 20"), existingRoom("b", "Camera"), existingRoom("c", "101b")];
  const result = buildBulkRooms(input({ firstName: "Camera 1", count: 3 }), existing, sequentialIds());
  assert.deepEqual(result.rooms.map(({ name }) => name), ["Camera 1", "Camera 2", "Camera 3"]);
  assert.equal(buildBulkRooms(input({ firstName: "101", count: 2 }), existing, sequentialIds()).rooms.length, 2);
});

test("le stanze esistenti non vengono modificate, né in caso di errore", () => {
  const existing = existingRooms(3);
  const snapshot = structuredClone(existing);
  buildBulkRooms(input(), existing, sequentialIds());
  buildBulkRooms(input({ firstName: "Vecchia 0" }), existing, sequentialIds());
  buildBulkRooms(input({ count: 999 }), existing, sequentialIds());
  assert.deepEqual(existing, snapshot);
});

test("cinquanta stanze generate sono una bozza valida e chiedono la stanza staff solo al salvataggio", () => {
  const { rooms } = buildBulkRooms(input({ count: MAX_BULK_ROOMS, firstName: "Camera 01" }), [], sequentialIds());
  const draft = { ...emptyRoomPlan(), rooms };
  assert.deepEqual(validateRoomPlan(draft, [], "2026-07-15", { allowMissingStaffRoom: true }), []);
  assert.deepEqual(validateRoomPlan(draft, [], "2026-07-15"), [MISSING_STAFF_ROOM]);
  assert.deepEqual(validateRoomPlan({ ...draft, staffElsewhere: true }, [], "2026-07-15"), []);
});

test("i nomi che il core considera uguali passano il foglio ma la validazione della bozza li ferma", () => {
  // Il foglio confronta solo maiuscole, accenti e spazi esterni; il core
  // tratta anche punteggiatura e spazi doppi. RoomPlanner.addBulk valida la
  // bozza dopo buildBulkRooms, quindi il duplicato non arriva al salvataggio.
  for (const existingName of ["Camera.2", "Camera  2", "Camera_2"]) {
    const existing = [existingRoom("old", existingName)];
    const result = buildBulkRooms(input({ firstName: "Camera 1", count: 2 }), existing, sequentialIds());
    assert.ok("rooms" in result, `il foglio accetta accanto a ${existingName}`);
    const errors = validateRoomPlan({ ...emptyRoomPlan(), rooms: [...existing, ...result.rooms] }, [], "2026-07-15", { allowMissingStaffRoom: true });
    assert.deepEqual(errors, ["Nome stanza duplicato: Camera 2."], `accanto a ${existingName}`);
  }
});

test("stanze coppia in blocco con più di due posti passano il foglio ma la bozza le rifiuta", () => {
  const result = buildBulkRooms(input({ category: "couple", capacity: 4, count: 2 }), [], sequentialIds());
  assert.ok("rooms" in result);
  const errors = validateRoomPlan({ ...emptyRoomPlan(), rooms: result.rooms }, [], "2026-07-15", { allowMissingStaffRoom: true });
  assert.deepEqual(errors, ["La stanza coppia 101 deve avere due posti.", "La stanza coppia 102 deve avere due posti."]);
});
