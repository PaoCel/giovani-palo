import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CATALOGO } from "../src/copy/catalogo.ts";
import {
  formatHomeWhen,
  formatListWhen,
  monthKey,
  monthLabel,
  publicActivityTypeLabel,
  publicActivityTypeOf,
  resolvePublicCatalogStakeId,
} from "../src/utils/publicCatalog.ts";
import { hasEventEnded } from "../src/utils/publicEventState.ts";

// Il palo pubblico non si sceglie da solo: senza una scelta resta tutta Italia.
test("senza palo scelto resta tutta Italia", () => {
  assert.equal(resolvePublicCatalogStakeId(null, "", ["roma-est", "milano-est"]), "");
  assert.equal(resolvePublicCatalogStakeId(null, "", null), "");
});

test("un palo memorizzato o nell'indirizzo vale solo se è attivo", () => {
  assert.equal(resolvePublicCatalogStakeId(null, "milano-est", ["roma-est", "milano-est"]), "milano-est");
  assert.equal(
    resolvePublicCatalogStakeId("roma-est", "milano-est", ["roma-est", "milano-est"]),
    "roma-est",
  );
  assert.equal(resolvePublicCatalogStakeId("sconosciuto", "milano-est", ["roma-est", "milano-est"]), "milano-est");
  assert.equal(resolvePublicCatalogStakeId("sconosciuto", "sconosciuto", ["roma-est"]), "");
});

test("finché l'elenco pali non è arrivato ci si fida della scelta già fatta", () => {
  assert.equal(resolvePublicCatalogStakeId("roma-est", "", null), "roma-est");
  assert.equal(resolvePublicCatalogStakeId(null, "milano-est", null), "milano-est");
});

test("le date pubbliche seguono il calendario italiano", () => {
  const gala = {
    startDate: new Date(2027, 0, 16, 17, 0).toISOString(),
    endDate: new Date(2027, 0, 16, 22, 30).toISOString(),
    location: "Centro di Palo",
  };

  assert.deepEqual(formatHomeWhen(gala), {
    date: "Sab 16 gen 2027",
    suffix: ", 17:00 · Centro di Palo",
  });
  assert.equal(
    formatListWhen(gala),
    "Sabato 16 gennaio 2027, 17:00–22:30 · Centro di Palo",
  );

  const camp = {
    startDate: new Date(2026, 6, 15, 0, 0).toISOString(),
    endDate: new Date(2026, 6, 18, 0, 0).toISOString(),
    location: "Nazzano (RM)",
  };

  assert.equal(formatListWhen(camp), "Mercoledì 15 – sabato 18 luglio 2026 · Nazzano (RM)");
  assert.equal(monthKey(gala.startDate), "2027-01");
  assert.equal(monthLabel("2027-01"), "Gennaio 2027");
});

test("il tipo in elenco usa le etichette corte del mockup", () => {
  assert.equal(publicActivityTypeOf({ overnight: true }), "overnight");
  assert.equal(publicActivityTypeOf({ activityType: "camp" }), "camp");
  assert.equal(publicActivityTypeLabel("overnight"), "Pernottamento");
  assert.equal(publicActivityTypeLabel("standard"), "Attività");
});

// Annunciata in catalogo e in home (docs/ATTIVITA_MODULARI.md, «Resa con dati
// mancanti»): con timeToBeDefined solo il giorno, oppure «dalle 19:00» se
// l'inizio non è 00:00. L'ora di fine non si mostra (niente «23:59»). Il luogo
// vuoto diventa «Luogo da definire» solo se la pagina passa missingPlace.
//
// Le date sono locali (`new Date(anno, mese, giorno, ore, minuti)`): il giro
// per ISO non dipende dal fuso del processo.

const at = (year, monthIndex, day, hour = 0, minute = 0) =>
  new Date(year, monthIndex, day, hour, minute).toISOString();

const LUOGO_MANCANTE = "Luogo da definire";

const giornoSenzaOra = {
  startDate: at(2027, 0, 16, 0, 0),
  endDate: at(2027, 0, 16, 23, 59),
  timeToBeDefined: true,
  location: "",
};

const dalleDiciannove = {
  startDate: at(2027, 0, 16, 19, 0),
  endDate: at(2027, 0, 16, 23, 59),
  timeToBeDefined: true,
  location: "",
};

const piuGiorni = {
  startDate: at(2026, 6, 15, 0, 0),
  endDate: at(2026, 6, 18, 23, 59),
  timeToBeDefined: true,
  location: "",
};

function assertNienteOreSentinella(value, label) {
  assert.equal(value.includes("00:00"), false, `${label}: niente 00:00`);
  assert.equal(value.includes("23:59"), false, `${label}: niente 23:59`);
  assert.equal(value.includes("00.00"), false, `${label}: niente 00.00`);
  assert.equal(value.includes("23.59"), false, `${label}: niente 23.59`);
}

test("annunciata di un giorno senza ora: in elenco solo il giorno", () => {
  const out = formatListWhen(giornoSenzaOra);
  assert.equal(out, "Sabato 16 gennaio 2027");
  assertNienteOreSentinella(out, "elenco senza ora");
});

test("annunciata con inizio alle 19:00: in elenco «dalle 19:00», mai la fine", () => {
  const out = formatListWhen(dalleDiciannove);
  assert.equal(out, "Sabato 16 gennaio 2027, dalle 19:00");
  assertNienteOreSentinella(out, "elenco dalle 19:00");

  // L'ora di fine non si mostra mai, anche se non è la sentinella 23:59.
  const altraFine = formatListWhen({
    ...dalleDiciannove,
    endDate: at(2027, 0, 16, 22, 30),
  });
  assert.equal(altraFine, "Sabato 16 gennaio 2027, dalle 19:00");
  assert.equal(altraFine.includes("22:30"), false);
});

test("annunciata su più giorni: in elenco solo i giorni", () => {
  const out = formatListWhen(piuGiorni);
  assert.equal(out, "Mercoledì 15 – sabato 18 luglio 2026");
  assertNienteOreSentinella(out, "elenco più giorni");
  assert.equal(out.includes("dalle"), false);
});

test("luogo vuoto o di soli spazi: il testo mancante non lascia un separatore", () => {
  for (const location of ["", "   ", "\t\n "]) {
    const event = { ...giornoSenzaOra, location };
    const conTesto = formatListWhen(event, { missingPlace: LUOGO_MANCANTE });
    assert.equal(conTesto, `Sabato 16 gennaio 2027 · ${LUOGO_MANCANTE}`, JSON.stringify(location));

    const senzaOpzione = formatListWhen(event);
    assert.equal(senzaOpzione, "Sabato 16 gennaio 2027", JSON.stringify(location));
    assert.equal(senzaOpzione.includes(" · "), false, JSON.stringify(location));
    assert.equal(senzaOpzione.endsWith("·"), false, JSON.stringify(location));

    const homeConTesto = formatHomeWhen(event, { missingPlace: LUOGO_MANCANTE });
    assert.equal(homeConTesto.date, "Sab 16 gen 2027");
    assert.equal(homeConTesto.suffix, ` · ${LUOGO_MANCANTE}`, JSON.stringify(location));

    const homeSenza = formatHomeWhen(event);
    assert.deepEqual(homeSenza, { date: "Sab 16 gen 2027", suffix: "" }, JSON.stringify(location));
    assert.equal(`${homeSenza.date}${homeSenza.suffix}`.includes(" · "), false);
  }

  const vero = { ...giornoSenzaOra, location: "Centro di Palo" };
  assert.equal(
    formatListWhen(vero, { missingPlace: LUOGO_MANCANTE }),
    "Sabato 16 gennaio 2027 · Centro di Palo",
  );
  assert.equal(formatListWhen(vero, { missingPlace: LUOGO_MANCANTE }).includes(LUOGO_MANCANTE), false);
  assert.deepEqual(formatHomeWhen(vero, { missingPlace: LUOGO_MANCANTE }), {
    date: "Sab 16 gen 2027",
    suffix: " · Centro di Palo",
  });
  assert.equal(formatHomeWhen(vero, { missingPlace: LUOGO_MANCANTE }).suffix.includes(LUOGO_MANCANTE), false);
});

test("formatHomeWhen: data nel giorno, ora e luogo nel suffisso, niente 00:00 né 23:59", () => {
  const senzaOra = formatHomeWhen(giornoSenzaOra);
  assert.deepEqual(senzaOra, { date: "Sab 16 gen 2027", suffix: "" });
  assertNienteOreSentinella(`${senzaOra.date}${senzaOra.suffix}`, "home senza ora");

  const sera = formatHomeWhen(dalleDiciannove);
  assert.equal(sera.date, "Sab 16 gen 2027");
  assert.equal(sera.suffix.includes("19:00"), true);
  assert.equal(sera.date.includes("19:00"), false);
  assertNienteOreSentinella(`${sera.date}${sera.suffix}`, "home dalle 19:00");
  assert.equal(sera.suffix.includes("22:30"), false);

  const seraSenzaLuogo = formatHomeWhen({ ...dalleDiciannove, endDate: at(2027, 0, 16, 22, 30) });
  assert.equal(seraSenzaLuogo.suffix.includes("22:30"), false);
  assert.equal(seraSenzaLuogo.suffix.includes("19:00"), true);

  const conLuogoMancante = formatHomeWhen(dalleDiciannove, { missingPlace: LUOGO_MANCANTE });
  assert.equal(conLuogoMancante.date, "Sab 16 gen 2027");
  assert.equal(conLuogoMancante.suffix.includes("19:00"), true);
  assert.equal(conLuogoMancante.suffix.includes(LUOGO_MANCANTE), true);
  assert.ok(conLuogoMancante.suffix.indexOf("19:00") < conLuogoMancante.suffix.indexOf(LUOGO_MANCANTE));
  assertNienteOreSentinella(`${conLuogoMancante.date}${conLuogoMancante.suffix}`, "home 19:00 e luogo");

  const giorni = formatHomeWhen(piuGiorni);
  assert.equal(giorni.date, "Mer 15 lug 2026");
  assert.equal(giorni.suffix, "");
  assertNienteOreSentinella(`${giorni.date}${giorni.suffix}`, "home più giorni");

  const giorniSenzaOpzione = formatHomeWhen({ ...piuGiorni, location: "   " });
  assert.equal(`${giorniSenzaOpzione.date}${giorniSenzaOpzione.suffix}`.includes(" · "), false);
  const giorniConTesto = formatHomeWhen({ ...piuGiorni, location: "   " }, { missingPlace: LUOGO_MANCANTE });
  assert.equal(giorniConTesto.suffix, ` · ${LUOGO_MANCANTE}`);
});

test("senza timeToBeDefined una fine vera alle 23:59 resta in elenco", () => {
  const vera = {
    startDate: at(2027, 0, 16, 18, 0),
    endDate: at(2027, 0, 16, 23, 59),
    location: "Centro di Palo",
  };
  const atteso = "Sabato 16 gennaio 2027, 18:00–23:59 · Centro di Palo";
  assert.equal(formatListWhen(vera), atteso);
  assert.equal(formatListWhen({ ...vera, timeToBeDefined: false }), atteso);
  assert.equal(formatListWhen(vera).includes("23:59"), true);
});

// Le pagine non esportano statusClass: si esegue la funzione del sorgente,
// così togliere il ramo di "announced" la fa ricadere in "closed".

function endOfQuoted(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source[i] === quote) {
      return i;
    }
  }
  return source.length - 1;
}

function matchBracket(source, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      i = endOfQuoted(source, i);
      continue;
    }
    if (ch === "`") {
      i = endOfTemplate(source, i);
      continue;
    }
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error(`parentesi ${openChar} non chiusa a ${openIndex}`);
}

function endOfTemplate(source, start) {
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source[i] === "`") {
      return i;
    }
    if (source[i] === "$" && source[i + 1] === "{") {
      i = matchBracket(source, i + 1, "{", "}");
    }
  }
  return source.length - 1;
}

function stripComments(source) {
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "'" || ch === '"') {
      const end = endOfQuoted(source, i);
      out += source.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === "`") {
      const end = endOfTemplate(source, i);
      out += source.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        i += 1;
      }
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i += 1;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

function splitTopLevel(text, separator) {
  const parts = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let angle = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = endOfQuoted(text, i);
      continue;
    }
    if (ch === "`") {
      i = endOfTemplate(text, i);
      continue;
    }
    if (ch === "(") paren += 1;
    else if (ch === ")") paren -= 1;
    else if (ch === "{") brace += 1;
    else if (ch === "}") brace -= 1;
    else if (ch === "[") bracket += 1;
    else if (ch === "]") bracket -= 1;
    else if (ch === "<") angle += 1;
    else if (ch === ">") angle -= 1;
    else if (ch === separator && paren === 0 && brace === 0 && bracket === 0 && angle === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function callsOf(source, name) {
  const cleaned = stripComments(source);
  const found = [];
  const token = `${name}(`;
  let from = 0;
  while (from < cleaned.length) {
    const at = cleaned.indexOf(token, from);
    if (at < 0) {
      break;
    }
    const prev = at > 0 ? cleaned[at - 1] : "";
    if (/[A-Za-z0-9_$]/u.test(prev)) {
      from = at + token.length;
      continue;
    }
    const open = at + name.length;
    const close = matchBracket(cleaned, open, "(", ")");
    found.push(cleaned.slice(open + 1, close));
    from = close + 1;
  }
  return found;
}

function loadStatusClass(source) {
  const cleaned = stripComments(source);
  const mark = cleaned.search(/function\s+statusClass\s*\(|\bstatusClass\s*=\s*(?:function\s*)?\(/u);
  assert.notEqual(mark, -1, "statusClass non c'è più: il ramo announced non è protetto");
  const open = cleaned.indexOf("(", mark);
  const close = matchBracket(cleaned, open, "(", ")");
  const params = splitTopLevel(cleaned.slice(open + 1, close), ",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const name = part.split(":")[0].trim().replace(/[?]/u, "");
      assert.match(name, /^[A-Za-z_$][\w$]*$/u, `parametro non eseguibile: ${part}`);
      return name;
    });
  let cursor = close + 1;
  while (cursor < cleaned.length && /\s/u.test(cleaned[cursor])) {
    cursor += 1;
  }
  if (cleaned[cursor] === ":") {
    while (
      cursor < cleaned.length &&
      cleaned[cursor] !== "{" &&
      !(cleaned[cursor] === "=" && cleaned[cursor + 1] === ">")
    ) {
      cursor += 1;
    }
  }
  if (cleaned.startsWith("=>", cursor)) {
    cursor += 2;
    while (cursor < cleaned.length && /\s/u.test(cleaned[cursor])) {
      cursor += 1;
    }
  }
  assert.equal(cleaned[cursor], "{", "statusClass non ha un corpo eseguibile");
  const end = matchBracket(cleaned, cursor, "{", "}");
  const body = cleaned.slice(cursor + 1, end);
  return new Function(...params, body);
}

test("le pagine pubbliche passano missingPlace e l'annunciata non è closed", () => {
  const activities = readFileSync(new URL("../src/pages/public/ActivitiesPage.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../src/pages/public/HomePage.tsx", import.meta.url), "utf8");

  const listCalls = callsOf(activities, "formatListWhen");
  const homeCalls = callsOf(home, "formatHomeWhen");
  assert.ok(listCalls.length >= 1, "ActivitiesPage non chiama formatListWhen");
  assert.ok(homeCalls.length >= 1, "HomePage non chiama formatHomeWhen");
  for (const args of listCalls) {
    assert.match(args, /\bmissingPlace\b/u, `formatListWhen(${args})`);
  }
  for (const args of homeCalls) {
    assert.match(args, /\bmissingPlace\b/u, `formatHomeWhen(${args})`);
  }

  const statusClass = loadStatusClass(activities);
  assert.equal(statusClass("open"), "open");
  assert.notEqual(statusClass("announced"), "closed");
  for (const phase of ["closed", "ended", "cancelled"]) {
    assert.equal(statusClass(phase), "closed", phase);
  }
  assert.match(activities, /className=\{`status \$\{statusClass\(state\.phase\)\}`\}/u);
});

test("formatHomeWhen: con timeToBeDefined alle 19:00 il suffisso è «dalle 19:00»", () => {
  const definita = formatHomeWhen(dalleDiciannove);
  assert.equal(definita.date, "Sab 16 gen 2027");
  assert.equal(definita.suffix, ", dalle 19:00");

  const vera = formatHomeWhen({ ...dalleDiciannove, timeToBeDefined: false });
  assert.equal(vera.date, "Sab 16 gen 2027");
  assert.equal(vera.suffix, ", 19:00");

  const senzaSegno = formatHomeWhen({
    startDate: dalleDiciannove.startDate,
    endDate: dalleDiciannove.endDate,
    location: "",
  });
  assert.equal(senzaSegno.suffix, ", 19:00");
});

test("formatListWhen e formatHomeWhen non lanciano se l'inizio manca o è invalido", () => {
  const endDate = at(2027, 0, 17, 2, 0);
  for (const startDate of ["", "non-una-data", "2026-13-40"]) {
    const event = { startDate, endDate, location: "Centro di Palo", timeToBeDefined: true };
    let list;
    let home;
    assert.doesNotThrow(() => {
      list = formatListWhen(event);
      home = formatHomeWhen(event);
    }, JSON.stringify(startDate));
    assert.equal(list, "Centro di Palo", JSON.stringify(startDate));
    assert.deepEqual(home, { date: "", suffix: " · Centro di Palo" }, JSON.stringify(startDate));
  }

  const senza = { endDate, location: "" };
  assert.doesNotThrow(() => formatListWhen(senza));
  assert.doesNotThrow(() => formatHomeWhen(senza));
  assert.equal(formatListWhen(senza), "");
  assert.deepEqual(formatHomeWhen(senza), { date: "", suffix: "" });
});

// Regressione: un'attività con orario vero che scavalca la mezzanotte non resta
// «22:00–02:00». formatListWhen vede due giorni di calendario e non scrive le ore.
test("formatListWhen: 22:00–02:00 del giorno dopo, senza timeToBeDefined, mostra due giorni", () => {
  const notte = {
    startDate: at(2027, 0, 16, 22, 0),
    endDate: at(2027, 0, 17, 2, 0),
    location: "Centro di Palo",
  };
  const out = formatListWhen(notte);
  assert.equal(out, "Sabato 16 – domenica 17 gennaio 2027 · Centro di Palo");
  assert.equal(out.includes("22:00"), false);
  assert.equal(out.includes("02:00"), false);
});

test("in home la card rende state.label solo per announced e cancelled", () => {
  const home = readFileSync(new URL("../src/pages/public/HomePage.tsx", import.meta.url), "utf8");
  const flagOf = new Function("state", "return (" + assignmentExpression(home, "flag") + ");");
  const pill = splitTernary(jsxBlock(home, "flag ?"));
  assert.equal(pill.whenFalse.includes("state.label"), false, pill.whenFalse);
  const classExpr = attributeExpression(pill.whenTrue, "className");
  const classClose = pill.whenTrue.indexOf(classExpr) + classExpr.length;
  const afterClass = pill.whenTrue.slice(pill.whenTrue.indexOf("}", classClose) + 1).replace(/\s+/gu, "");
  assert.equal(afterClass, ">{state.label}</span>", pill.whenTrue);
  const visibleOf = new Function("flag", "return (" + pill.condition + ");");
  const classOf = new Function("flag", "return (" + classExpr + ");");
  const labelOf = new Function("state", "return state.label;");

  for (const phase of ["draft", "announced", "open", "upcoming", "closed", "ended", "cancelled"]) {
    const state = { phase, label: "etichetta " + phase };
    const flag = flagOf(state);
    const visible = Boolean(visibleOf(flag));
    const expectLabel = phase === "announced" || phase === "cancelled";
    assert.equal(flag, phase === "announced" ? "soon" : phase === "cancelled" ? "closed" : "", phase);
    assert.equal(visible, expectLabel, phase);
    if (expectLabel) {
      assert.equal(labelOf(state), state.label, phase);
      assert.equal(classOf(flag), "status " + flag, phase);
    }
  }
});

test("in elenco «Dettagli e iscrizione» solo con open o upcoming e attività non finita", () => {
  const activities = readFileSync(new URL("../src/pages/public/ActivitiesPage.tsx", import.meta.url), "utf8");
  const pastOf = new Function(
    "hasEventEnded",
    "event",
    "state",
    "return (" + assignmentExpression(activities, "past") + ");",
  );
  const canOf = new Function("past", "state", "return (" + assignmentExpression(activities, "canRegister") + ");");
  const labelOf = new Function("canRegister", "CATALOGO", "return (" + jsxBlock(activities, "canRegister ?") + ");");
  const futura = { startDate: "2099-07-15T17:00:00.000Z", endDate: "2099-07-15T20:00:00.000Z" };
  const finita = { startDate: "2000-07-14T22:00:00.000Z", endDate: "2000-07-15T21:59:00.000Z" };

  function etichetta(event, phase) {
    const state = { phase };
    const past = pastOf(hasEventEnded, event, state);
    return labelOf(canOf(past, state), CATALOGO);
  }

  for (const phase of ["open", "upcoming"]) {
    assert.equal(etichetta(futura, phase), "Dettagli e iscrizione", phase);
    assert.equal(etichetta(finita, phase), "Dettagli", phase + " finita");
  }
  for (const phase of ["announced", "closed", "ended", "cancelled", "draft"]) {
    assert.equal(etichetta(futura, phase), "Dettagli", phase);
    assert.equal(etichetta(finita, phase), "Dettagli", phase + " finita");
  }
});

function assignmentExpression(source, name) {
  const cleaned = stripComments(source);
  const re = new RegExp("\\b(?:const|let)\\s+" + name + "\\s*=", "g");
  const hits = cleaned.match(re);
  assert.equal(hits?.length, 1, "assegnazioni di " + name + ": " + (hits?.length ?? 0));
  const mark = hits ? cleaned.search(re) : -1;
  let cursor = cleaned.indexOf("=", mark) + 1;
  const start = cursor;
  let depth = 0;
  while (cursor < cleaned.length) {
    const ch = cleaned[cursor];
    if (ch === "'" || ch === '"') {
      cursor = endOfQuoted(cleaned, cursor) + 1;
      continue;
    }
    if (ch === "`") {
      cursor = endOfTemplate(cleaned, cursor) + 1;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
    } else if (ch === ";" && depth === 0) {
      break;
    }
    cursor += 1;
  }
  return cleaned.slice(start, cursor).trim();
}

function jsxBlock(source, startToken) {
  const cleaned = stripComments(source);
  const at = cleaned.indexOf(startToken);
  assert.notEqual(at, -1, "manca " + startToken);
  assert.equal(cleaned.indexOf(startToken, at + startToken.length), -1, "più di un " + startToken);
  let open = at - 1;
  while (open >= 0 && /\s/u.test(cleaned[open])) {
    open -= 1;
  }
  assert.equal(cleaned[open], "{", startToken + " non è un'espressione JSX");
  const close = matchBracket(cleaned, open, "{", "}");
  return cleaned.slice(at, close).trim();
}

function splitTernary(expression) {
  const question = topLevelIndex(expression, "?");
  assert.notEqual(question, -1, expression);
  const colon = topLevelIndex(expression, ":", question + 1);
  assert.notEqual(colon, -1, expression);
  return {
    condition: expression.slice(0, question).trim(),
    whenTrue: expression.slice(question + 1, colon).trim(),
    whenFalse: expression.slice(colon + 1).trim(),
  };
}

function topLevelIndex(text, char, from = 0) {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = endOfQuoted(text, i);
      continue;
    }
    if (ch === "`") {
      i = endOfTemplate(text, i);
      continue;
    }
    if (ch === "(") paren += 1;
    else if (ch === ")") paren -= 1;
    else if (ch === "{") brace += 1;
    else if (ch === "}") brace -= 1;
    else if (ch === "[") bracket += 1;
    else if (ch === "]") bracket -= 1;
    else if (ch === char && paren === 0 && brace === 0 && bracket === 0) {
      return i;
    }
  }
  return -1;
}

function attributeExpression(element, name) {
  const token = name + "={";
  const at = element.indexOf(token);
  assert.notEqual(at, -1, "manca " + name + " in " + element);
  const open = at + token.length - 1;
  const close = matchBracket(element, open, "{", "}");
  return element.slice(open + 1, close).trim();
}
