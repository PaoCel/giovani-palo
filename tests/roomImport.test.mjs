import test from "node:test";
import assert from "node:assert/strict";
import { parseRoomRows, readRoomFile } from "../src/utils/roomImport.ts";
import * as XLSX from "xlsx";

test("Foresteria: count each bed, merged room headings and a two-person double bed", () => {
  const rows = [];
  rows.push(["", "", "Dal:", "", "", "", "", new Date(2026, 9, 16)]);
  rows.push(["", "", "Num. Stanza"]);
  rows.push(["", "", "106 Piano Terra\nHandicap", "", "", "", 1]);
  rows.push(["", "", "", "", "", "", 1]);
  rows.push(["", "", "118 Piano Terra", "", "", "", 1]);
  rows.push(["", "", "", "", "", "", 1]);
  rows.push(["", "", "215 Primo Piano\nMatrimoniale", "", "", "", 2]);
  rows.push(["", "", "Totale Posti", "", "", "", 6]);
  const result = parseRoomRows(rows);
  assert.equal(result.night, "2026-10-16");
  assert.deepEqual(result.rooms.map(({ name, capacity, category, accessible }) => ({ name, capacity, category, accessible })), [
    { name: "106", capacity: 2, category: "unassigned", accessible: true },
    { name: "118", capacity: 2, category: "staff_male", accessible: false },
    { name: "215", capacity: 2, category: "couple", accessible: false },
  ]);
  rows.at(-1)[6] = 8;
  assert.throws(() => parseRoomRows(rows), /totale/);
});

test("table import rejects duplicate labels and invalid capacities without partial results", () => {
  for (const beds of ["", "due", 0, 1.5, -2, 51]) assert.throws(() => parseRoomRows([["Stanza", "Posti"], ["101", beds]]), /capienza/);
  assert.throws(() => parseRoomRows([["Stanza", "Posti"], ["A", 2], ["a", 4]]), /duplicata/);
  assert.throws(() => parseRoomRows([["Stanza", "Posti", "Tipo"], ["A", 2, "mista"]]), /Categoria/);
  assert.throws(() => parseRoomRows([["Stanza", "Posti", "Tipo"], ["A", 4, "matrimoniale"]]), /2 posti/);
});

test("table import preserves explicit reservations", () => {
  const result = parseRoomRows([["Stanza", "Posti", "Piano", "Tipo", "Accessibile"], ["A", 3, "Terra", "ragazze", "sì"], ["B", 2, "Primo", "accompagnatori uomini", "no"]]);
  assert.equal(result.rooms[0].category, "girls"); assert.equal(result.rooms[0].accessible, true);
  assert.equal(result.rooms[1].category, "staff_male"); assert.equal(result.warnings.length, 0);
});

test("Excel import preserves C/G coordinates when the used range starts at C3", async () => {
  const sheet = { C3: { t: "s", v: "Num. Stanza" }, C4: { t: "s", v: "118 Piano Terra" }, G4: { t: "n", v: 1 }, G5: { t: "n", v: 1 }, C6: { t: "s", v: "Totale Posti" }, G6: { t: "n", v: 2 }, "!ref": "C3:G6" };
  const workbook = { SheetNames: ["ITALIANO"], Sheets: { ITALIANO: sheet } };
  const file = new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "test.xlsx");
  const result = await readRoomFile(file);
  assert.equal(result.rooms.length, 1);
  assert.equal(result.rooms[0].name, "118");
  assert.equal(result.rooms[0].capacity, 2);
});
