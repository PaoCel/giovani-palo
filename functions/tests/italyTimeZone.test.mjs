// Fuso italiano di email, intervalli e moduli. Le Functions girano in UTC:
// un'attività rapida inizia alle 00:00 italiane, cioè il giorno prima in Z.
// TZ va impostato prima del require, così getDate() vede davvero l'11.
// Gli import ESM sono issati: qui sotto si caricano solo i moduli CommonJS.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.TZ = "UTC";

const require = createRequire(import.meta.url);
const { formatDateRangeIt, sendParentAuthorizationEmail } = require("../lib/brevo.js");
const { calculateAge, isMinorBirthDate } = require("../lib/officialConsentPdf.js");
const { logger } = require("firebase-functions");

const SUMMER_START = "2026-07-11T22:00:00.000Z";
const SUMMER_END = "2026-07-14T21:59:00.000Z";
const SUMMER_RANGE = "12 luglio 2026 - 14 luglio 2026";
const SUMMER_DAY = "12 luglio 2026";
const WINTER_DAY = "12 dicembre 2026";
// 22:30Z di luglio è 00:30 del giorno dopo in Italia (CEST, UTC+2).
const EXPIRES_AT = "2026-07-11T22:30:00.000Z";
const EXPIRES_DAY = "12 luglio 2026";
const EXPIRES_CLOCK = "00:30";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const functionsDir = fileURLToPath(new URL("..", import.meta.url));

test("il runtime è in UTC: l'11 luglio alle 22:00Z resta il giorno 11", () => {
  const probe = new Date("2026-07-11T22:00:00Z");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(
    probe.getDate(),
    11,
    `Il runtime non rispetta process.env.TZ="UTC": ` +
      `new Date("2026-07-11T22:00:00Z").getDate() è ${probe.getDate()} ` +
      `(offset ${probe.getTimezoneOffset()} minuti, fuso Intl ${zone}). ` +
      `Senza il giorno locale 11 il confronto con l'ora italiana non dimostra la correzione. ` +
      `Avvia node con TZ=UTC.`,
  );
});

test("formatDateRangeIt: campeggio rapido 12-14 luglio, non l'11", () => {
  assert.equal(formatDateRangeIt(SUMMER_START, SUMMER_END), SUMMER_RANGE);
});

test("formatDateRangeIt: un solo giorno d'inverno è una data, non un intervallo", () => {
  assert.equal(
    formatDateRangeIt("2026-12-11T23:00:00.000Z", "2026-12-12T22:59:00.000Z"),
    WINTER_DAY,
  );
});

test("formatDateRangeIt: 19:00-22:00 italiane restano nel giorno giusto", () => {
  // 12 luglio 2026, 19:00-22:00 in Europe/Rome (CEST, UTC+2).
  assert.equal(
    formatDateRangeIt("2026-07-12T17:00:00.000Z", "2026-07-12T20:00:00.000Z"),
    SUMMER_DAY,
  );
});

test("formatDateRangeIt: inizio vuoto o invalido è «data da definire»", () => {
  const cases = [
    [undefined, undefined],
    [null, null],
    ["", ""],
    ["", SUMMER_END],
    ["non-una-data", SUMMER_END],
    ["2026-13-40", null],
  ];
  for (const [start, end] of cases) {
    assert.equal(formatDateRangeIt(start, end), "data da definire", JSON.stringify([start, end]));
  }
});

test("formatDateRangeIt: fine mancante o invalida lascia solo l'inizio", () => {
  for (const end of [undefined, null, "", "non-una-data", "2026-13-40"]) {
    assert.equal(formatDateRangeIt(SUMMER_START, end), SUMMER_DAY, JSON.stringify(end));
  }
});

test("ogni formattatore di data in functions ha timeZone nello stesso costrutto", () => {
  const missing = dateFormattersMissingTimeZone();
  assert.deepEqual(
    missing,
    [],
    missing.map((item) => `${item.where} ${item.kind}`).join("\n"),
  );
});

test("l'email al genitore scrive le date e la scadenza del link in ora italiana", async () => {
  await withProduction(async (calls) => {
    await sendParentAuthorizationEmail({
      apiKey: "chiave-finta",
      parentEmail: "genitore@example.invalid",
      parentName: "Genitore Esempio",
      participantName: "Mario Rossi",
      activityTitle: "Campeggio",
      activityStartDate: SUMMER_START,
      activityEndDate: SUMMER_END,
      activityLocation: "Roma",
      authorizationUrl: "https://example.invalid/autorizza/abc",
      expiresAt: EXPIRES_AT,
    });

    assert.equal(calls.length, 1);
    const { htmlContent, textContent } = calls[0].body;
    assert.equal(textContent.includes(`Date: ${SUMMER_RANGE}`), true, textContent);
    assert.equal(htmlContent.includes(SUMMER_RANGE), true, htmlContent);
    assert.equal(textContent.includes("11 luglio 2026"), false, textContent);
    assert.equal(htmlContent.includes("11 luglio 2026"), false, htmlContent);
    assert.equal(textContent.includes(`Scade il ${EXPIRES_DAY}`), true, textContent);
    assert.equal(htmlContent.includes(`scade il ${EXPIRES_DAY}`), true, htmlContent);
    assert.equal(textContent.includes(EXPIRES_CLOCK), true, textContent);
    assert.equal(htmlContent.includes(EXPIRES_CLOCK), true, htmlContent);
    assert.equal(textContent.includes("22:30"), false, textContent);
    assert.equal(htmlContent.includes("22:30"), false, htmlContent);
  });
});

// 00:00 italiane sono le 22:00Z d'estate e le 23:00Z d'inverno, cioè il giorno
// prima in UTC. L'età usa il giorno di calendario italiano di quell'istante.
test("calculateAge: il compleanno alle 00:00 italiane conta, estate e inverno", () => {
  assert.equal(calculateAge("2014-07-12", "2026-07-11T22:00:00.000Z"), "12");
  assert.equal(calculateAge("2014-07-13", "2026-07-11T22:00:00.000Z"), "11");
  assert.equal(calculateAge("2014-12-12", "2026-12-11T23:00:00.000Z"), "12");
});

// isMinorBirthDate è vera solo sotto i 18: il giorno del diciottesimo compleanno
// (00:00 italiane) la persona non è più minorenne.
test("isMinorBirthDate: i 18 anni scattano alle 00:00 italiane", () => {
  assert.equal(isMinorBirthDate("2008-07-12", "2026-07-11T22:00:00.000Z"), false);
  assert.equal(isMinorBirthDate("2008-07-13", "2026-07-11T22:00:00.000Z"), true);
  assert.equal(isMinorBirthDate("2008-12-12", "2026-12-11T23:00:00.000Z"), false);
  assert.equal(isMinorBirthDate("2008-12-13", "2026-12-11T23:00:00.000Z"), true);
});

test("calculateAge: ore vere e riferimento mancante non lanciano, nascita vuota è vuota", () => {
  assert.equal(calculateAge("2014-07-12", "2026-07-12T17:00:00.000Z"), "12");
  assert.doesNotThrow(() => isMinorBirthDate("2008-07-12", "2026-07-12T17:00:00.000Z"));

  for (const reference of [undefined, null, ""]) {
    const label = reference === undefined ? "undefined" : JSON.stringify(reference);
    assert.doesNotThrow(() => calculateAge("2014-07-12", reference), label);
    assert.doesNotThrow(() => isMinorBirthDate("2008-07-12", reference), label);
  }

  assert.equal(calculateAge("", "2026-07-12T17:00:00.000Z"), "");
  assert.equal(calculateAge(null, SUMMER_START), "");
  assert.equal(calculateAge(undefined, SUMMER_START), "");
});

test("formatDateRangeIt: il cambio d'ora resta un solo giorno", () => {
  // 29 marzo 2026: 00:00 CET, 23:59 CEST.
  assert.equal(
    formatDateRangeIt("2026-03-28T23:00:00.000Z", "2026-03-29T21:59:00.000Z"),
    "29 marzo 2026",
  );
  // 25 ottobre 2026: 00:00 CEST, 23:59 CET.
  assert.equal(
    formatDateRangeIt("2026-10-24T22:00:00.000Z", "2026-10-25T22:59:00.000Z"),
    "25 ottobre 2026",
  );
});

// La forma YYYY-MM-DD con un giorno che non esiste non è una data: l'età resta
// vuota, come prima della correzione sul fuso. Il 29 febbraio 2012 è un giorno
// vero. Il 28 febbraio 2026 alle 23:00Z è già il 1° marzo in Italia (14 anni);
// il 27 febbraio alle 23:00Z è ancora il 28 febbraio (13).
test("calculateAge: giorno inesistente è vuoto, il 29 febbraio bisestile conta", () => {
  assert.equal(calculateAge("2014-02-31", "2026-03-01T12:00:00.000Z"), "");
  assert.equal(calculateAge("2014-13-40", "2026-03-01T12:00:00.000Z"), "");
  assert.equal(calculateAge("2012-02-29", "2026-02-28T23:00:00.000Z"), "14");
  assert.equal(calculateAge("2012-02-29", "2026-02-27T23:00:00.000Z"), "13");
});

// Comportamento ereditato, in discussione nel task gugd-consenso-eta-fuso:
// oggi l'età vuota vale 0, quindi la nascita vuota e «non-una-data» sono minorenni.
test("isMinorBirthDate: nascita vuota o illeggibile risulta minorenne", () => {
  assert.equal(isMinorBirthDate("", "2026-07-12T17:00:00.000Z"), true);
  assert.equal(isMinorBirthDate("non-una-data", "2026-07-12T17:00:00.000Z"), true);
});

const ENV_KEYS = [
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "FIREBASE_CONFIG",
  "FUNCTIONS_EMULATOR",
  "EMAIL_ALLOWLIST",
  "EMAIL_SUBJECT_PREFIX",
  "EMAIL_SENDER_ADDRESS",
  "EMAIL_REPLY_TO_ADDRESS",
  "APP_PUBLIC_URL",
];

async function withProduction(fn) {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.GCLOUD_PROJECT = "giovani-palo";

  const savedFetch = globalThis.fetch;
  const savedInfo = logger.info;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push({ body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ messageId: "<messaggio-finto@brevo>" }),
      text: async () => "",
    };
  };
  logger.info = () => {};

  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = savedFetch;
    logger.info = savedInfo;
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const DATE_OPTION =
  /\b(?:weekday|era|year|month|day|hour|minute|second|fractionalSecondDigits|dayPeriod|timeZoneName|dateStyle|timeStyle|hour12|hourCycle)\b/;

function dateFormattersMissingTimeZone() {
  const libDir = path.join(functionsDir, "lib");
  const files = readdirSync(libDir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => path.join(libDir, name));
  files.push(path.join(functionsDir, "index.js"));

  const missing = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const whereOf = (index) =>
      `${path.relative(repoRoot, file).split(path.sep).join("/")}:${lineOf(source, index)}`;

    scanCode(source, (index) => {
      const match = matchFormatter(source, index);
      if (!match) return false;

      const end = endOfCall(source, match.parenAt);
      const construct = source.slice(index, end);
      const isDate =
        match.kind !== "toLocaleString" ||
        DATE_OPTION.test(stripCommentsAndStrings(construct)) ||
        receiverLooksLikeDate(source, index);
      if (isDate && !/\btimeZone\b/.test(stripCommentsAndStrings(construct))) {
        missing.push({ where: whereOf(index), kind: match.kind });
      }
      return false;
    });
  }
  return missing;
}

function matchFormatter(source, index) {
  if (index > 0 && /[\w$]/.test(source[index - 1])) return null;
  const head = source.slice(index);
  let found = /^Intl\.DateTimeFormat\s*\(/.exec(head);
  if (found) {
    return { kind: "Intl.DateTimeFormat", parenAt: index + found[0].length - 1 };
  }
  found = /^\.toLocale(DateString|TimeString|String)\s*\(/.exec(head);
  if (!found) return null;
  return { kind: `toLocale${found[1]}`, parenAt: index + found[0].length - 1 };
}

function receiverLooksLikeDate(source, dotIndex) {
  let cursor = dotIndex - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
  if (cursor < 0) return false;

  if (source[cursor] === ")") {
    const open = findMatchingOpen(source, cursor);
    if (open < 0) return false;
    const head = source.slice(Math.max(0, open - 40), open);
    return /new\s+Date\s*$/.test(head) || /(?:Date|At)\s*$/.test(head);
  }

  let start = cursor;
  while (start >= 0 && /[\w$]/.test(source[start])) start -= 1;
  const name = source.slice(start + 1, cursor + 1);
  return /date/i.test(name) || /At$/.test(name);
}

function findMatchingOpen(source, closeIndex) {
  let depth = 0;
  for (let index = closeIndex; index >= 0; index -= 1) {
    const char = source[index];
    if (char === ")") depth += 1;
    else if (char === "(") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function lineOf(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

/**
 * Visita solo il codice, non stringhe né commenti. `visit` riceve l'indice
 * e può consumare un costrutto ritornando l'indice successivo; `false` fa
 * avanzare di un carattere, così un formattatore annidato resta visibile.
 */
function scanCode(source, visit) {
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    const char = source[index];
    if (char === "'" || char === '"') {
      index = skipQuoted(source, index);
      continue;
    }
    if (char === "`") {
      index = skipTemplate(source, index, visit);
      continue;
    }
    const next = visit(index);
    index = next === false ? index + 1 : next;
  }
}

function stripCommentsAndStrings(fragment) {
  let out = "";
  scanCode(fragment, (index) => {
    out += fragment[index];
    return false;
  });
  return out;
}

function endOfCall(source, openIndex) {
  let index = openIndex;
  let depth = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    const char = source[index];
    if (char === "'" || char === '"') {
      index = skipQuoted(source, index);
      continue;
    }
    if (char === "`") {
      index = skipTemplate(source, index, () => false);
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function skipQuoted(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    if (source[index] === "\n") return index;
    index += 1;
  }
  return source.length;
}

function skipTemplate(source, start, visit) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === "`") return index + 1;
    if (source[index] === "$" && source[index + 1] === "{") {
      index = skipBraces(source, index + 1, visit);
      continue;
    }
    index += 1;
  }
  return source.length;
}

function skipBraces(source, openIndex, visit) {
  let index = openIndex + 1;
  let depth = 1;
  while (index < source.length && depth > 0) {
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    const char = source[index];
    if (char === "'" || char === '"') {
      index = skipQuoted(source, index);
      continue;
    }
    if (char === "`") {
      index = skipTemplate(source, index, visit);
      continue;
    }
    if (char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      index += 1;
      continue;
    }
    const next = visit(index);
    index = next === false ? index + 1 : next;
  }
  return index;
}
