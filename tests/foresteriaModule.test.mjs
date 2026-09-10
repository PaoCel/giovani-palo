import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { fillForesteriaModule, patchSheetXml, planForesteriaFill } from "../src/utils/foresteriaModule.ts";

// Synthetic copy of the Foresteria layout: room labels merged over C:F, beds in G, nights from H.
function template(nights = ["Venerdì 16 Ottobre"]) {
  const rows = [
    ["", "", "Dal:", "", "", "", "", new Date(2026, 9, 16)],
    ["", "", "Num. Stanza", "", "", "", "", ...nights],
    ["", "", "106 Piano Terra\nHandicap", "", "", "", 1],
    ["", "", "", "", "", "", 1],
    ["", "", "118 Piano Terra", "", "", "", 1],
    ["", "", "", "", "", "", 1],
    ["", "", "215 Primo Piano\nMatrimoniale", "", "", "", 2],
    ["", "", "", "", "", "", ""],
    ["", "", "Totale Posti", "", "", "", 6],
  ];
  const merges = [
    { s: { r: 2, c: 2 }, e: { r: 3, c: 5 } },
    { s: { r: 4, c: 2 }, e: { r: 5, c: 5 } },
    { s: { r: 6, c: 2 }, e: { r: 7, c: 5 } },
    { s: { r: 6, c: 6 }, e: { r: 7, c: 6 } },
  ];
  return { rows, merges };
}

const plan = { rooms: [{ id: "r106", name: "106" }, { id: "r118", name: "118" }, { id: "r215", name: "215" }] };
const names = { r106: ["Anna Bianchi"], r215: ["Luca Verdi", "Maria Verdi"] };
const namesForRoom = (roomId) => names[roomId] ?? [];

test("writes one name per bed row, both rows of a double room, and clears free beds", () => {
  const { rows, merges } = template();
  const fill = planForesteriaFill(rows, merges, plan, namesForRoom);
  assert.deepEqual(fill.cells, { H3: "Anna Bianchi", H4: "", H5: "", H6: "", H7: "Luca Verdi", H8: "Maria Verdi" });
  assert.deepEqual({ people: fill.people, rooms: fill.rooms, nights: fill.nights, night: fill.night }, { people: 3, rooms: 2, nights: 1, night: "2026-10-16" });
  // Rooms of the module that are not in the plan stay untouched.
  assert.deepEqual(Object.keys(planForesteriaFill(rows, merges, { rooms: [plan.rooms[0]] }, namesForRoom).cells), ["H3", "H4"]);
});

test("repeats names in every night column and lists them all in a merged night cell", () => {
  const { rows, merges } = template(["Venerdì", "Sabato"]);
  merges.push({ s: { r: 6, c: 8 }, e: { r: 7, c: 8 } });
  const fill = planForesteriaFill(rows, merges, plan, namesForRoom);
  assert.equal(fill.nights, 2);
  assert.equal(fill.cells.I3, "Anna Bianchi");
  assert.deepEqual([fill.cells.H7, fill.cells.H8], ["Luca Verdi", "Maria Verdi"]);
  assert.equal(fill.cells.I7, "Luca Verdi / Maria Verdi");
  assert.equal("I8" in fill.cells, false);
});

test("refuses modules that cannot hold the saved plan", () => {
  const { rows, merges } = template();
  const withExtraRoom = { rooms: [...plan.rooms, { id: "r301", name: "301" }] };
  assert.throws(() => planForesteriaFill(rows, merges, withExtraRoom, (id) => (id === "r301" ? ["Anna Bianchi"] : [])), /non sono nel modulo: 301/);
  assert.throws(() => planForesteriaFill(rows, merges, plan, (id) => (id === "r118" ? ["A", "B", "C"] : [])), /118 ha 3 persone assegnate, ma nel modulo ha 2 posti/);
  assert.throws(() => planForesteriaFill(rows.map((row, index) => (index === 1 ? row.slice(0, 7) : row)), merges, plan, namesForRoom), /notti/);
  assert.throws(() => planForesteriaFill([["", "", "Stanza"]], [], plan, namesForRoom), /Num\. Stanza/);
});

test("patches only the night cells and keeps their styles", () => {
  const head = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><cols><col min=\"2\" max=\"7\" width=\"5\" customWidth=\"1\"/><col min=\"8\" max=\"12\" width=\"26\" style=\"7\" customWidth=\"1\"/></cols><sheetData>";
  const tail = "</sheetData><mergeCells count=\"1\"><mergeCell ref=\"C20:F21\"/></mergeCells></worksheet>";
  const header = "<row r=\"19\" spans=\"2:8\"><c r=\"C19\" s=\"54\" t=\"s\"><v>11</v></c><c r=\"H19\" s=\"14\" t=\"s\"><v>12</v></c></row>";
  const input = head + header
    + "<row r=\"20\" spans=\"2:8\"><c r=\"C20\" s=\"51\" t=\"s\"><v>13</v></c><c r=\"G20\" s=\"28\"><v>1</v></c><c r=\"H20\" s=\"15\"/></row>"
    + "<row r=\"21\" spans=\"2:8\"><c r=\"G21\" s=\"29\"><v>1</v></c><c r=\"H21\" s=\"16\" t=\"s\"><v>4</v></c></row>"
    + "<row r=\"23\"/>" + tail;
  const inline = (ref, style, value) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`;
  const patched = patchSheetXml(input, { H20: "Anna & <Bianchi>", I20: "Luca Verdi", H21: "", H22: "Sara Neri", H23: "Marco Blu" });
  assert.equal(patched, head + header
    + `<row r="20" spans="2:9"><c r="C20" s="51" t="s"><v>13</v></c><c r="G20" s="28"><v>1</v></c>${inline("H20", 15, "Anna &amp; &lt;Bianchi&gt;")}${inline("I20", 7, "Luca Verdi")}</row>`
    + "<row r=\"21\" spans=\"2:8\"><c r=\"G21\" s=\"29\"><v>1</v></c><c r=\"H21\" s=\"16\"/></row>"
    + `<row r="22">${inline("H22", 7, "Sara Neri")}</row>`
    + `<row r="23">${inline("H23", 7, "Marco Blu")}</row>` + tail);

  const prefixed = "<x:worksheet xmlns:x=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><x:sheetData><x:row r=\"2\"><x:c r=\"H2\"/></x:row></x:sheetData></x:worksheet>";
  assert.equal(patchSheetXml(prefixed, { H2: "Anna" }), "<x:worksheet xmlns:x=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><x:sheetData><x:row r=\"2\"><x:c r=\"H2\" t=\"inlineStr\"><x:is><x:t xml:space=\"preserve\">Anna</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>");
});

test("fills an .xlsx module and leaves every other part of the file untouched", async () => {
  const { rows, merges } = template();
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  sheet["!merges"] = merges;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "ITALIANO");
  const original = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const result = await fillForesteriaModule(new File([original], "Special Group Temple Trip.xlsx"), plan, namesForRoom);
  assert.equal(result.fileName, "Special Group Temple Trip - compilato.xlsx");
  const filled = new Uint8Array(await result.blob.arrayBuffer());
  const cells = XLSX.read(filled, { type: "array" }).Sheets.ITALIANO;
  assert.deepEqual([cells.H3.v, cells.H7.v, cells.H8.v], ["Anna Bianchi", "Luca Verdi", "Maria Verdi"]);
  assert.deepEqual([cells.C3.v, cells.G3.v, cells.C9.v], ["106 Piano Terra\nHandicap", 1, "Totale Posti"]);
  const [before, after] = await Promise.all([JSZip.loadAsync(original), JSZip.loadAsync(filled)]);
  assert.deepEqual(Object.keys(after.files), Object.keys(before.files));
  for (const name of Object.keys(before.files).filter((part) => part !== "xl/worksheets/sheet1.xml")) {
    assert.equal(await after.file(name)?.async("string"), await before.file(name)?.async("string"), name);
  }
  await assert.rejects(fillForesteriaModule(new File([original], "modulo.xls"), plan, namesForRoom), /\.xlsx/);
});
