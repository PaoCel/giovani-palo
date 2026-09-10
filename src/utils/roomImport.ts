import type { Room } from "../../functions/lib/roomPlannerCore.mjs";

export interface RoomImport {
  rooms: Room[];
  night: string | null;
  warnings: string[];
}

const text = (value: unknown) => String(value ?? "").trim();
const normalize = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const newRoom = (name: string): Room => ({
  id: crypto.randomUUID(), name, capacity: 0, floor: "", category: "unassigned",
  accessible: false, notes: "", minAge: null, maxAge: null,
});

// Pure parser: both the supplied Foresteria template and a simple header table.
export function parseRoomRows(rows: unknown[][]): RoomImport {
  const rooms: Room[] = [];
  let night: string | null = null;
  const warnings: string[] = [];
  const templateHeader = rows.findIndex((row) => normalize(row[2]).includes("num. stanza"));
  if (templateHeader >= 0) {
    let current: Room | null = null;
    for (const row of rows.slice(templateHeader + 1)) {
      const label = text(row[2]);
      if (normalize(label).startsWith("totale")) break;
      if (/^\d+\s+(?:piano terra|primo piano)\b/i.test(label)) {
        current = newRoom(label.match(/^\d+/)![0]);
        current.floor = /primo piano/i.test(label) ? "Primo piano" : "Piano terra";
        current.accessible = /handicap|accessibil/i.test(label);
        if (/matrimoniale/i.test(label)) current.category = "couple";
        rooms.push(current);
      } else if (label) {
        throw new Error(`Intestazione stanza non riconosciuta: ${label}.`);
      }
      if (current && row[6] !== undefined && row[6] !== "") {
        const beds = Number(row[6]);
        if (!Number.isInteger(beds) || beds < 0 || beds > 50) throw new Error("Numero di posti non valido nel modulo.");
        current.capacity += beds;
      }
    }
    const dateRow = rows.find((row) => normalize(row[2]) === "dal:");
    if (dateRow?.[7] instanceof Date) {
      const date = dateRow[7];
      night = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
    const totalRow = rows.find((row) => normalize(row[2]).startsWith("totale posti"));
    if (totalRow && Number(totalRow[6]) !== rooms.reduce((sum, room) => sum + room.capacity, 0)) {
      throw new Error("Il totale dei posti non coincide con le stanze del file. Controlla il modulo prima di importarlo.");
    }
  } else {
    const headerIndex = rows.findIndex((row) => row.some((cell) => /^(stanza|camera|nome stanza)$/.test(normalize(cell))));
    if (headerIndex < 0) throw new Error("Formato non riconosciuto. Usa il modulo Foresteria oppure le colonne Stanza, Posti e Piano.");
    const header = rows[headerIndex].map(normalize);
    const column = (pattern: RegExp) => header.findIndex((value) => pattern.test(value));
    const nameColumn = column(/^(stanza|camera|nome stanza)$/);
    const bedsColumn = column(/^(posti|letti|capienza|posti letto)$/);
    if (bedsColumn < 0) throw new Error("Manca la colonna Posti o Capienza.");
    const floorColumn = column(/^piano$/);
    const categoryColumn = column(/^tipo$|^categoria$/);
    const categoryAliases: Record<string, Room["category"]> = {
      ragazzi: "boys", ragazze: "girls", boys: "boys", girls: "girls",
      "accompagnatori uomini": "staff_male", "accompagnatrici donne": "staff_female",
      "accompagnatrici": "staff_female", staff_male: "staff_male", staff_female: "staff_female",
      matrimoniale: "couple", coppia: "couple", couple: "couple", unassigned: "unassigned", "da decidere": "unassigned",
    };
    for (const row of rows.slice(headerIndex + 1)) {
      if (row.every((cell) => !text(cell))) continue;
      const room = newRoom(text(row[nameColumn]));
      room.capacity = Number(row[bedsColumn]);
      room.floor = text(row[floorColumn]);
      const category = normalize(row[categoryColumn]);
      if (category && !categoryAliases[category]) throw new Error(`Categoria non riconosciuta per la stanza ${room.name}: ${text(row[categoryColumn])}.`);
      room.category = categoryAliases[category] ?? "unassigned";
      room.accessible = /^(si|true|1|yes)$/.test(normalize(row[column(/^accessibile$/)]));
      room.notes = text(row[column(/^note$/)]);
      rooms.push(room);
    }
  }
  if (!rooms.length || rooms.length > 200) throw new Error("Il file deve contenere da 1 a 200 stanze.");
  const names = new Set<string>();
  for (const room of rooms) {
    if (!room.name || !Number.isInteger(room.capacity) || room.capacity < 1 || room.capacity > 50) throw new Error(`Nome o capienza non validi per la stanza ${room.name || "senza nome"}.`);
    if (room.category === "couple" && room.capacity !== 2) throw new Error(`La matrimoniale ${room.name} deve avere 2 posti.`);
    if (names.has(normalize(room.name))) throw new Error(`Stanza duplicata nel file: ${room.name}.`);
    names.add(normalize(room.name));
  }
  if (!rooms.some((room) => room.category.startsWith("staff_"))) {
    const staffRoom = rooms.filter((room) => room.category === "unassigned" && !room.accessible)
      .sort((a, b) => a.capacity - b.capacity)[0];
    if (staffRoom) {
      staffRoom.category = "staff_male";
      warnings.push(`Stanza ${staffRoom.name} riservata agli accompagnatori uomini. Puoi cambiarla in accompagnatrici prima di importare.`);
    } else warnings.push("Riserva almeno una stanza agli accompagnatori.");
  }
  return { rooms, night, warnings };
}

export async function readRoomFile(file: File): Promise<RoomImport> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Il file deve essere più piccolo di 5 MB.");
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error("Scegli un file Excel o CSV.");
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, sheetRows: 3000 });
  const sheet = workbook.Sheets[workbook.SheetNames.find((name) => name.toUpperCase() === "ITALIANO") ?? workbook.SheetNames[0]];
  if (!sheet) throw new Error("Il file non contiene fogli leggibili.");
  const bounds = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
  if (bounds.e.r >= 3000 || bounds.e.c >= 100) throw new Error("Il foglio supera le dimensioni supportate: 3000 righe e 100 colonne.");
  // The Foresteria template starts at C3. Preserve absolute column positions,
  // otherwise sheet_to_json shifts C into index 0 and the room labels disappear.
  return parseRoomRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1, defval: "", blankrows: true, range: { s: { r: 0, c: 0 }, e: bounds.e },
  }));
}
