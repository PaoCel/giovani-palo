import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRecordNightResult,
  formatRecordNightResult,
  getRecordNightResultRecords,
} from "../src/utils/recordNightResults.ts";

test("risultato valido: conserva il valore e normalizza il nome", () => {
  assert.deepEqual(
    parseRecordNightResult({ winnerName: "  Partecipante prova  ", value: 316 }),
    { winnerName: "Partecipante prova", value: 316 },
  );
  assert.deepEqual(
    parseRecordNightResult({ winnerName: "Partecipante prova", value: 18.5 }),
    { winnerName: "Partecipante prova", value: 18.5 },
  );
});

test("dati assenti o legacy: nessun vincitore dedotto dagli iscritti", () => {
  for (const input of [
    undefined, null, false, 1, "vincitore", [], {},
    { challengerCount: 1, featured: true, status: "open" },
    { winnerName: "Partecipante prova" },
    { value: 66 },
    { winner: "Partecipante prova", score: 66 },
  ]) {
    assert.equal(parseRecordNightResult(input), null);
  }
});

test("nome obbligatorio, stringa non vuota e lungo al massimo 100 caratteri", () => {
  for (const winnerName of [undefined, null, 123, true, [], {}, "", " \t\n", "a".repeat(101)]) {
    assert.equal(parseRecordNightResult({ winnerName, value: 11 }), null);
  }
  const winnerName = "a".repeat(100);
  assert.deepEqual(parseRecordNightResult({ winnerName, value: 11 }), { winnerName, value: 11 });
});

test("valore numerico finito e positivo, senza conversioni implicite", () => {
  for (const value of [undefined, null, "66", "18,5", true, [], {}, 0, -0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(parseRecordNightResult({ winnerName: "Partecipante prova", value }), null);
  }
  assert.deepEqual(
    parseRecordNightResult({ winnerName: "Partecipante prova", value: 0.5 }),
    { winnerName: "Partecipante prova", value: 0.5 },
  );
});

for (const measure of ["longest_time", "fastest_time"]) {
  test(`${measure}: secondi e minuti senza unità vuote`, () => {
    for (const [value, expected] of [
      [316, "5 min 16 s"],
      [18, "18 s"],
      [60, "1 min"],
      [120, "2 min"],
      [59, "59 s"],
      [61, "1 min 1 s"],
      [18.5, "18,5 s"],
      [61.5, "1 min 1,5 s"],
      [0.5, "0,5 s"],
    ]) {
      assert.equal(formatRecordNightResult(value, measure), expected);
    }
  });
}

for (const measure of ["count_in_time", "count_streak", "distance", "other"]) {
  test(`${measure}: numero italiano, senza unità di tempo inventate`, () => {
    assert.equal(formatRecordNightResult(66, measure), "66");
    assert.equal(formatRecordNightResult(11, measure), "11");
    assert.equal(formatRecordNightResult(1234.5, measure), "1.234,5");
  });
}

const finishedAt = "2026-10-17T18:00:00Z";
const afterEvent = Date.parse("2026-10-18T12:00:00Z");
const confirmedRecord = {
  id: "synthetic-record",
  status: "open",
  challengerCount: 0,
  featured: false,
  result: { winnerName: "Partecipante prova", value: 316 },
};

test("albo: include risultati confermati anche senza sfidanti o featured", () => {
  const records = getRecordNightResultRecords([confirmedRecord], finishedAt, afterEvent);
  assert.equal(records.length, 1);
  assert.equal(records[0], confirmedRecord);
});

test("albo: esclude hidden e risultati assenti o malformati", () => {
  const invalidRecords = [
    { ...confirmedRecord, status: "hidden" },
    { ...confirmedRecord, result: undefined },
    { ...confirmedRecord, result: null },
    { ...confirmedRecord, result: {} },
    { ...confirmedRecord, result: { winnerName: "", value: 66 } },
    { ...confirmedRecord, result: { winnerName: "Partecipante prova", value: "66" } },
    { ...confirmedRecord, result: { winnerName: "Partecipante prova", value: 0 } },
  ];
  assert.deepEqual(getRecordNightResultRecords(invalidRecords, finishedAt, afterEvent), []);
});

test("albo: conserva oggetti originali e ordine senza modificare l'elenco", () => {
  const secondRecord = {
    ...confirmedRecord,
    id: "synthetic-second",
    result: { winnerName: "Altro partecipante prova", value: 18 },
  };
  const input = [confirmedRecord, { ...confirmedRecord, status: "hidden" }, secondRecord];
  const snapshot = structuredClone(input);
  const result = getRecordNightResultRecords(input, finishedAt, afterEvent);
  assert.deepEqual(input, snapshot);
  assert.equal(result.length, 2);
  assert.equal(result[0], confirmedRecord);
  assert.equal(result[1], secondRecord);
});

test("albo: nascosto senza fine valida o finché l'attività non è finita", () => {
  for (const endDate of [undefined, null, "", "non-una-data", "2026-10-19T12:00:00Z"]) {
    assert.deepEqual(getRecordNightResultRecords([confirmedRecord], endDate, afterEvent), []);
  }
  assert.deepEqual(getRecordNightResultRecords([confirmedRecord], finishedAt, Date.parse(finishedAt)), []);
  assert.deepEqual(getRecordNightResultRecords([confirmedRecord], finishedAt, Date.parse(finishedAt) - 1), []);
  assert.deepEqual(getRecordNightResultRecords([], finishedAt, afterEvent), []);
});

test("albo: confronta l'istante della fine rispettando il fuso ISO", () => {
  assert.deepEqual(
    getRecordNightResultRecords([confirmedRecord], "2026-10-17T20:00:00+02:00", Date.parse(finishedAt) + 1),
    [confirmedRecord],
  );
});
