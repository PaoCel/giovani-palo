import type JSZip from "jszip";
import type { Range } from "xlsx";
import type { RoomPlan } from "../../functions/lib/roomPlannerCore.mjs";
import {
  MAX_ROOM_FILE_BYTES, foresteriaHeaderRow, foresteriaNight, foresteriaRoomNumber, isForesteriaTotal, readRoomSheet,
} from "./roomImport.ts";

export interface ForesteriaFill {
  /** Night cells to write, by A1 reference. An empty string clears a free bed. */
  cells: Record<string, string>;
  people: number;
  rooms: number;
  nights: number;
  night: string | null;
}

interface RoomBlock { number: string; rows: number[]; beds: number; headingEnd: number }
interface Target { ref: string; column: number; value: string }
interface ColumnStyle { min: number; max: number; style: string }

// The template lists the room in C:F, its beds in G and one column per night from H onwards.
const FIRST_NIGHT_COLUMN = 7;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const UNREADABLE = "Non riesco a leggere il modulo. Aprilo con Excel, salvalo come .xlsx e riprova.";
// Optional namespace prefix: Excel writes <row>, a few generators write <x:row>.
const NAME = "(?:[A-Za-z_][\\w.-]*:)?";

const text = (value: unknown) => String(value ?? "").trim();
const attribute = (tag: string, name: string) => new RegExp(`\\s${name}=(["'])(.*?)\\1`).exec(tag)?.[2];

function columnLetters(index: number) {
  let letters = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  return letters;
}

function columnNumber(letters: string) {
  let number = 0;
  for (const letter of letters) number = number * 26 + letter.charCodeAt(0) - 64;
  return number;
}

function isWritable(merges: Range[], row: number, column: number) {
  const merge = merges.find((item) => row >= item.s.r && row <= item.e.r && column >= item.s.c && column <= item.e.c);
  return !merge || (merge.s.r === row && merge.s.c === column);
}

function roomBlocks(rows: unknown[][], header: number, merges: Range[]) {
  const blocks: RoomBlock[] = [];
  let current: RoomBlock | null = null;
  for (let index = header + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (isForesteriaTotal(row[2])) break;
    const number = foresteriaRoomNumber(row[2]);
    if (number) {
      const heading = merges.find((merge) => merge.s.r === index && merge.s.c === 2);
      current = { number, rows: [], beds: 0, headingEnd: heading ? heading.e.r : index };
      blocks.push(current);
    }
    const hasBeds = text(row[6]) !== "";
    if (!current || (index > current.headingEnd && !hasBeds)) continue;
    if (hasBeds) {
      const beds = Number(row[6]);
      if (!Number.isInteger(beds) || beds < 0 || beds > 50) throw new Error("Numero di posti non valido nel modulo.");
      current.beds += beds;
    }
    current.rows.push(index);
  }
  return blocks;
}

// Maps the saved plan onto the Foresteria template: one name per bed row, repeated in every night column.
export function planForesteriaFill(rows: unknown[][], merges: Range[], plan: RoomPlan, namesForRoom: (roomId: string) => string[]): ForesteriaFill {
  const header = foresteriaHeaderRow(rows);
  if (header < 0) throw new Error("Non è il modulo della Foresteria: manca la colonna Num. Stanza.");
  const nightColumns = (rows[header] ?? []).flatMap((value, column) => (column >= FIRST_NIGHT_COLUMN && text(value) ? [column] : []));
  if (!nightColumns.length) throw new Error("Il modulo non indica le notti: manca la data accanto a Num. Stanza.");
  const roomsByName = new Map(plan.rooms.map((room) => [room.name.trim().toLowerCase(), room]));
  const cells: Record<string, string> = {};
  const written = new Set<string>();
  let people = 0;
  let rooms = 0;
  for (const block of roomBlocks(rows, header, merges)) {
    const room = roomsByName.get(block.number);
    if (!room) continue;
    if (written.has(room.id)) throw new Error(`La stanza ${block.number} compare due volte nel modulo.`);
    written.add(room.id);
    const names = namesForRoom(room.id);
    if (names.length > block.beds) throw new Error(`La stanza ${block.number} ha ${names.length} persone assegnate, ma nel modulo ha ${block.beds} posti.`);
    if (names.length) { people += names.length; rooms += 1; }
    for (const column of nightColumns) {
      const slots = block.rows.filter((row) => isWritable(merges, row, column));
      if (names.length && !slots.length) throw new Error(`Nel modulo manca la cella della notte per la stanza ${block.number}.`);
      // One bed per row in the template; a night cell merged over several rows lists all their names.
      const perSlot = Math.max(1, Math.ceil(names.length / Math.max(1, slots.length)));
      slots.forEach((row, slot) => {
        cells[`${columnLetters(column)}${row + 1}`] = names.slice(slot * perSlot, (slot + 1) * perSlot).join(" / ");
      });
    }
  }
  const missing = plan.rooms.filter((room) => !written.has(room.id) && namesForRoom(room.id).length).map((room) => room.name);
  if (missing.length) throw new Error(`Queste stanze hanno persone assegnate ma non sono nel modulo: ${missing.join(", ")}. Controlla di aver scelto il modulo giusto.`);
  return { cells, people, rooms, nights: nightColumns.length, night: foresteriaNight(rows) };
}

function decodeXml(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()];
    return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
  });
}

// Escapes text for XML 1.0 and drops the characters it cannot carry (controls, unpaired surrogates).
function xmlText(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { output += value[index] + value[index + 1]; index += 1; }
      continue;
    }
    if ((code >= 0xdc00 && code <= 0xdfff) || code === 0xfffe || code === 0xffff || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) continue;
    output += code === 0x26 ? "&amp;" : code === 0x3c ? "&lt;" : code === 0x3e ? "&gt;" : value[index];
  }
  return output;
}

function cellXml(prefix: string, target: Target, style?: string) {
  const styleAttribute = style === undefined ? "" : ` s="${style}"`;
  if (!target.value) return `<${prefix}c r="${target.ref}"${styleAttribute}/>`;
  return `<${prefix}c r="${target.ref}"${styleAttribute} t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${xmlText(target.value)}</${prefix}t></${prefix}is></${prefix}c>`;
}

function columnStyles(xml: string): ColumnStyle[] {
  return [...xml.matchAll(new RegExp(`<${NAME}col\\b[^>]*>`, "g"))].flatMap(([tag]) => {
    const style = attribute(tag, "style");
    return style === undefined ? [] : [{ min: Number(attribute(tag, "min")), max: Number(attribute(tag, "max")), style }];
  });
}

function widenSpans(attributes: string, columns: number[]) {
  const spans = /\sspans="(\d+):(\d+)"/.exec(attributes);
  if (!spans || !columns.length) return attributes;
  return attributes.replace(spans[0], ` spans="${Math.min(Number(spans[1]), ...columns)}:${Math.max(Number(spans[2]), ...columns)}"`);
}

function patchCells(body: string, prefix: string, targets: Target[], styles: ColumnStyle[], rowStyle?: string) {
  const cells = [...body.matchAll(new RegExp(`<${NAME}c\\b([^>]*?)(?:\\/>|>[\\s\\S]*?<\\/${NAME}c>)`, "g"))].map((match) => {
    const ref = attribute(match[1], "r");
    if (!ref) throw new Error(UNREADABLE);
    return { start: match.index, end: match.index + match[0].length, ref, column: columnNumber(ref.replace(/\d+$/, "")), style: attribute(match[1], "s") };
  });
  const edits: Array<{ start: number; end: number; column: number; xml: string }> = [];
  for (const target of targets) {
    const existing = cells.find((cell) => cell.ref === target.ref);
    if (existing) {
      edits.push({ start: existing.start, end: existing.end, column: target.column, xml: cellXml(prefix, target, existing.style) });
    } else if (target.value) {
      const at = cells.find((cell) => cell.column > target.column)?.start ?? body.length;
      const style = styles.find((item) => target.column >= item.min && target.column <= item.max)?.style ?? rowStyle;
      edits.push({ start: at, end: at, column: target.column, xml: cellXml(prefix, target, style) });
    }
  }
  // Apply from the end so earlier offsets stay valid; inserts at the same offset go right to left.
  edits.sort((a, b) => b.start - a.start || b.column - a.column);
  return edits.reduce((result, edit) => result.slice(0, edit.start) + edit.xml + result.slice(edit.end), body);
}

function patchRow(data: string, prefix: string, rowNumber: number, targets: Target[], styles: ColumnStyle[]) {
  let insertAt = data.length;
  for (const match of data.matchAll(new RegExp(`<${NAME}row\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/${NAME}row>)`, "g"))) {
    const number = Number(attribute(match[1], "r"));
    if (!Number.isInteger(number) || number < 1) throw new Error(UNREADABLE);
    if (number < rowNumber) continue;
    if (number > rowNumber) { insertAt = match.index; break; }
    const body = match[3] ?? "";
    const rowStyle = attribute(match[1], "customFormat") === "1" ? attribute(match[1], "s") : undefined;
    const patched = patchCells(body, prefix, targets, styles, rowStyle);
    if (patched === body) return data;
    const attributes = widenSpans(match[1], targets.filter((target) => target.value).map((target) => target.column));
    return `${data.slice(0, match.index)}<${prefix}row${attributes}>${patched}</${prefix}row>${data.slice(match.index + match[0].length)}`;
  }
  const created = targets.filter((target) => target.value).sort((a, b) => a.column - b.column);
  if (!created.length) return data;
  const cells = created.map((target) => cellXml(prefix, target, styles.find((item) => target.column >= item.min && target.column <= item.max)?.style)).join("");
  return `${data.slice(0, insertAt)}<${prefix}row r="${rowNumber}">${cells}</${prefix}row>${data.slice(insertAt)}`;
}

// Writes inline strings into the worksheet XML and leaves every other byte of the sheet as it was.
export function patchSheetXml(xml: string, cells: Record<string, string>): string {
  const open = new RegExp(`<(${NAME})sheetData\\b[^>]*?(\\/?)>`).exec(xml);
  if (!open) throw new Error(UNREADABLE);
  const prefix = open[1];
  const closing = `</${prefix}sheetData>`;
  const start = open.index + open[0].length;
  const end = open[2] ? start : xml.indexOf(closing, start);
  if (end < 0) throw new Error(UNREADABLE);
  const styles = columnStyles(xml);
  const byRow = new Map<number, Target[]>();
  for (const [ref, value] of Object.entries(cells)) {
    const match = /^([A-Z]{1,3})(\d+)$/.exec(ref);
    if (!match) throw new Error(UNREADABLE);
    const row = Number(match[2]);
    byRow.set(row, [...(byRow.get(row) ?? []), { ref, column: columnNumber(match[1]), value }]);
  }
  let data = xml.slice(start, end);
  for (const [row, targets] of [...byRow].sort((a, b) => a[0] - b[0])) data = patchRow(data, prefix, row, targets, styles);
  const opening = open[2] ? open[0].replace(/\s*\/>$/, ">") : open[0];
  return `${xml.slice(0, open.index)}${opening}${data}${closing}${xml.slice(open[2] ? start : end + closing.length)}`;
}

async function worksheetPath(zip: JSZip, sheetName: string) {
  const [workbook, relations] = await Promise.all([
    zip.file("xl/workbook.xml")?.async("string"),
    zip.file("xl/_rels/workbook.xml.rels")?.async("string"),
  ]);
  if (!workbook || !relations) throw new Error(UNREADABLE);
  const sheet = [...workbook.matchAll(new RegExp(`<${NAME}sheet\\b[^>]*>`, "g"))].map(([tag]) => tag)
    .find((tag) => decodeXml(attribute(tag, "name") ?? "") === sheetName);
  const relationId = sheet ? /\s[\w.-]+:id=(["'])(.*?)\1/.exec(sheet)?.[2] : undefined;
  const relation = [...relations.matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)].map(([tag]) => tag)
    .find((tag) => relationId !== undefined && attribute(tag, "Id") === relationId);
  const target = relation ? attribute(relation, "Target") : undefined;
  if (!target) throw new Error(UNREADABLE);
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

// Returns the Foresteria's own module with the names written in: nothing leaves the browser.
export async function fillForesteriaModule(file: File, plan: RoomPlan, namesForRoom: (roomId: string) => string[]) {
  if (file.size > MAX_ROOM_FILE_BYTES) throw new Error("Il file deve essere più piccolo di 5 MB.");
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Scegli il modulo della Foresteria in formato .xlsx.");
  const data = await file.arrayBuffer();
  const sheet = await readRoomSheet(data);
  const fill = planForesteriaFill(sheet.rows, sheet.merges, plan, namesForRoom);
  const { default: JSZipLoader } = await import("jszip");
  let zip: JSZip;
  try { zip = await JSZipLoader.loadAsync(data); } catch { throw new Error(UNREADABLE); }
  const path = await worksheetPath(zip, sheet.name);
  const part = zip.file(path);
  if (!part) throw new Error(UNREADABLE);
  // Only the night cells change: logo, styles and the other parts of the file stay as received.
  zip.file(path, patchSheetXml(await part.async("string"), fill.cells), { createFolders: false });
  const blob = await zip.generateAsync({ type: "blob", mimeType: XLSX_MIME, compression: "DEFLATE" });
  return { ...fill, blob, fileName: `${file.name.replace(/\.xlsx$/i, "")} - compilato.xlsx` };
}
