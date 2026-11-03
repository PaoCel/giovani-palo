// Lato client dei compagni di stanza (docs/ROOM_MANAGEMENT.md, «Compagni di
// stanza»): la risposta della callable `roomMates` ripulita e i testi della card.
// Nomi inventati.
import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_ASSIGNED_ROOM,
  formatRoomBeds,
  formatRoomMates,
  parseAssignedRoomResult,
} from "../src/utils/roomMates.ts";

const NONE = { room: null, mates: [] };

test("parseAssignedRoomResult: la risposta del contratto passa intatta", () => {
  const value = {
    room: { name: "Camera 12", capacity: 4 },
    mates: [
      { fullName: "Sara Conti", adult: false },
      { fullName: "Anna Neri", adult: true },
    ],
  };
  assert.deepEqual(parseAssignedRoomResult(value), value);
});

test("parseAssignedRoomResult: scarta le chiavi fuori contratto a ogni livello", () => {
  const parsed = parseAssignedRoomResult({
    room: { name: "Camera 12", capacity: 4, id: "r12", floor: "primo", notes: "Nota staff", category: "girls" },
    mates: [
      {
        fullName: "Sara Conti",
        adult: false,
        email: "sara@example.invalid",
        phone: "+39 000",
        birthDate: "2010-01-01",
        unitName: "Rione Inventato",
        registrationId: "user_abc",
      },
    ],
    unitName: "Rione Inventato",
    registrationId: "user_xyz",
  });
  assert.deepEqual(parsed, { room: { name: "Camera 12", capacity: 4 }, mates: [{ fullName: "Sara Conti", adult: false }] });
  assert.deepEqual(Object.keys(parsed).sort(), ["mates", "room"]);
  assert.deepEqual(Object.keys(parsed.room).sort(), ["capacity", "name"]);
  assert.deepEqual(Object.keys(parsed.mates[0]).sort(), ["adult", "fullName"]);
});

test("parseAssignedRoomResult: nomi ripuliti, compagni senza nome o di forma strana scartati", () => {
  const parsed = parseAssignedRoomResult({
    room: { name: "  Camera 12  ", capacity: 3 },
    mates: [
      { fullName: "  Sara Conti  ", adult: false },
      { fullName: "", adult: false },
      { fullName: "   ", adult: true },
      { adult: true },
      { fullName: 42, adult: false },
      { fullName: ["Marta Leone"], adult: false },
      null,
      "Marta Leone",
      ["Marta Leone"],
      7,
      { fullName: "Anna Neri", adult: "true" },
      { fullName: "Luca Bianchi", adult: 1 },
      { fullName: "Paolo Neri", adult: true },
    ],
  });
  assert.deepEqual(parsed, {
    room: { name: "Camera 12", capacity: 3 },
    mates: [
      { fullName: "Sara Conti", adult: false },
      // Solo `true` vale adulto: stringhe e numeri no.
      { fullName: "Anna Neri", adult: false },
      { fullName: "Luca Bianchi", adult: false },
      { fullName: "Paolo Neri", adult: true },
    ],
  });
});

test("parseAssignedRoomResult: capacity non intera, non positiva o non numerica diventa null", () => {
  for (const capacity of [0, -1, -3, 2.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "4", null, undefined, true, {}, [4]]) {
    assert.deepEqual(
      parseAssignedRoomResult({ room: { name: "Camera 12", capacity }, mates: [] }),
      { room: { name: "Camera 12", capacity: null }, mates: [] },
      `capacity ${String(capacity)}`,
    );
  }
  assert.deepEqual(
    parseAssignedRoomResult({ room: { name: "Camera 12", capacity: 1 }, mates: [] }).room,
    { name: "Camera 12", capacity: 1 },
  );
});

test("parseAssignedRoomResult: mates non array vale nessun compagno, la stanza resta", () => {
  for (const mates of [undefined, null, "Sara Conti", { fullName: "Sara Conti", adult: false }, 3]) {
    assert.deepEqual(
      parseAssignedRoomResult({ room: { name: "Camera 12", capacity: 2 }, mates }),
      { room: { name: "Camera 12", capacity: 2 }, mates: [] },
      `mates ${JSON.stringify(mates)}`,
    );
  }
});

test("parseAssignedRoomResult: forme strane o stanza senza nome valgono nessuna stanza", () => {
  const cases = [
    undefined,
    null,
    "",
    "Camera 12",
    42,
    true,
    [],
    [{ name: "Camera 12" }],
    {},
    { room: null, mates: [{ fullName: "Sara Conti", adult: false }] },
    { mates: [{ fullName: "Sara Conti", adult: false }] },
    { room: "Camera 12", mates: [] },
    { room: 12, mates: [] },
    { room: [], mates: [] },
    { room: ["Camera 12"], mates: [] },
    { room: {}, mates: [{ fullName: "Sara Conti", adult: false }] },
    { room: { name: "", capacity: 3 }, mates: [{ fullName: "Sara Conti", adult: false }] },
    { room: { name: "   ", capacity: 3 }, mates: [] },
    { room: { name: 12, capacity: 3 }, mates: [] },
    { room: { name: null, capacity: 3 }, mates: [] },
    { room: { capacity: 3 }, mates: [] },
  ];
  for (const value of cases) {
    const parsed = parseAssignedRoomResult(value);
    assert.deepEqual(parsed, NONE, `valore ${JSON.stringify(value)}`);
    assert.equal(parsed.room, null);
    assert.deepEqual(parsed.mates, [], "senza stanza nessun nome");
  }
  assert.deepEqual(NO_ASSIGNED_ROOM, NONE);
  assert.equal(Object.isFrozen(NO_ASSIGNED_ROOM), true);
});

test("formatRoomMates: nessuno, uno, due, tre compagni", () => {
  assert.equal(formatRoomMates([]), "Per ora nessun altro in stanza.");
  assert.equal(formatRoomMates([{ fullName: "Sara Conti", adult: false }]), "Con Sara Conti");
  assert.equal(
    formatRoomMates([
      { fullName: "Sara Conti", adult: false },
      { fullName: "Marta Leone", adult: false },
    ]),
    "Con Sara Conti e Marta Leone",
  );
  assert.equal(
    formatRoomMates([
      { fullName: "Sara Conti", adult: false },
      { fullName: "Marta Leone", adult: false },
      { fullName: "Anna Neri", adult: true },
    ]),
    "Con Sara Conti, Marta Leone e Anna Neri (dirigente)",
  );
});

test("formatRoomMates: l'adulto porta «(dirigente)» anche da solo o in mezzo all'elenco", () => {
  assert.equal(formatRoomMates([{ fullName: "Anna Neri", adult: true }]), "Con Anna Neri (dirigente)");
  assert.equal(
    formatRoomMates([
      { fullName: "Paolo Neri", adult: true },
      { fullName: "Anna Neri", adult: true },
    ]),
    "Con Paolo Neri (dirigente) e Anna Neri (dirigente)",
  );
  assert.equal(
    formatRoomMates([
      { fullName: "Sara Conti", adult: false },
      { fullName: "Paolo Neri", adult: true },
      { fullName: "Marta Leone", adult: false },
      { fullName: "Luca Bianchi", adult: false },
    ]),
    "Con Sara Conti, Paolo Neri (dirigente), Marta Leone e Luca Bianchi",
  );
});

test("formatRoomMates: segnaposto e $ nei nomi restano testo", () => {
  assert.equal(
    formatRoomMates([
      { fullName: "Nome {nomi}", adult: false },
      { fullName: "Altro {ruolo} $& $1", adult: true },
    ]),
    "Con Nome {nomi} e Altro {ruolo} $& $1 (dirigente)",
  );
});

test("formatRoomBeds: posti letto al plurale, al singolare o solo il nome", () => {
  assert.equal(formatRoomBeds({ name: "101", capacity: 3 }), "101 · 3 posti letto");
  assert.equal(formatRoomBeds({ name: "Camera Glicine", capacity: 12 }), "Camera Glicine · 12 posti letto");
  assert.equal(formatRoomBeds({ name: "101", capacity: 1 }), "101 · 1 posto letto");
  assert.equal(formatRoomBeds({ name: "101", capacity: null }), "101");
  assert.equal(formatRoomBeds({ name: "Stanza {posti}", capacity: 2 }), "Stanza {posti} · 2 posti letto");
});

test("parse e format insieme: una risposta sporca dà il testo pulito", () => {
  const parsed = parseAssignedRoomResult({
    room: { name: " 101 ", capacity: 2, notes: "riservato" },
    mates: [{ fullName: " Sara Conti ", adult: false, email: "x@example.invalid" }, { fullName: "" }],
  });
  assert.equal(formatRoomBeds(parsed.room), "101 · 2 posti letto");
  assert.equal(formatRoomMates(parsed.mates), "Con Sara Conti");
});
