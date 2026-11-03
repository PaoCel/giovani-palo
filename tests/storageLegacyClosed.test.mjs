// Guardia della fase D della migrazione Storage in UE (2026-11-03).
//
// Il vecchio bucket USA (giovani-palo.firebasestorage.app) è chiuso a ogni
// richiesta client da storage.legacy-closed.rules; il bucket UE
// (giovani-palo-eu) resta con le rules normali di storage.rules. La mappatura
// bucket -> rules passa da quattro file (.firebaserc, firebase.json,
// firebase.staging.json, i due storage*.rules): un errore in uno di questi o
// applica le rules chiuse al bucket UE (tutti i media spariscono agli utenti)
// o riapre il bucket USA con storage.rules a un futuro
// `firebase deploy --only storage`.
//
// Il test legge i file veri del repo, non usa rete né emulatori. Le funzioni
// check* restituiscono l'elenco dei problemi (vuoto = ok) e lavorano sul
// testo, così gli ultimi test le provano su copie in memoria con errori
// introdotti apposta: se una guardia smette di accorgersene, fallisce.
//
// Rilancio dalla radice del repository:
//   node --test tests/storageLegacyClosed.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROJECT = "giovani-palo";
const EU_BUCKET = "giovani-palo-eu";
const US_BUCKET = "giovani-palo.firebasestorage.app";
const MAIN_TARGET = "main";
const CLOSED_TARGET = "legacyClosed";
const MAIN_RULES = "storage.rules";
const CLOSED_RULES = "storage.legacy-closed.rules";

const readRepoFile = name => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");

const real = {
  firebaserc: readRepoFile(".firebaserc"),
  firebaseJson: readRepoFile("firebase.json"),
  stagingJson: readRepoFile("firebase.staging.json"),
  mainRules: readRepoFile(MAIN_RULES),
  closedRules: readRepoFile(CLOSED_RULES),
};

// ---------------------------------------------------------------------------
// Guardie: ognuna prende il testo di un file e restituisce i problemi trovati
// ---------------------------------------------------------------------------

function parseJson(source, label) {
  try {
    return { value: JSON.parse(source) };
  } catch {
    return { problem: `${label}: JSON non valido, la mappatura dei bucket non è leggibile.` };
  }
}

// Tolti i commenti // e /* */ (un'unica passata, da sinistra a destra, così un
// "//" dentro un blocco o viceversa non confonde): un allow commentato non conta.
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
// Senza spazi e con apici uniformi, per confrontare la struttura delle rules.
const compact = source => source.replace(/\s+/g, "").replace(/"/g, "'");

// 1. .firebaserc: ogni bucket in un solo target, quello giusto.
function checkFirebaserc(source) {
  const { value: rc, problem } = parseJson(source, ".firebaserc");
  if (problem) return [problem];
  const storage = rc?.targets?.[PROJECT]?.storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    return [`.firebaserc: manca targets.${PROJECT}.storage, quindi i target "${MAIN_TARGET}" e "${CLOSED_TARGET}" di firebase.json non puntano a nessun bucket e il deploy delle rules Storage fallisce o va al bucket di default (USA).`];
  }
  const problems = [];
  for (const [name, list] of Object.entries(storage)) {
    if (!Array.isArray(list)) problems.push(`.firebaserc: il target "${name}" non è un elenco di bucket.`);
  }
  const listOf = name => (Array.isArray(storage[name]) ? storage[name] : []);

  for (const { bucket, expected, nome, rischio } of [
    { bucket: EU_BUCKET, expected: MAIN_TARGET, nome: "bucket UE",
      rischio: "Con la mappatura sbagliata un deploy delle rules Storage può applicare al bucket UE le rules chiuse (tutti i media spariscono agli utenti) oppure lasciarlo senza rules." },
    { bucket: US_BUCKET, expected: CLOSED_TARGET, nome: "bucket USA vecchio",
      rischio: "Con la mappatura sbagliata un deploy delle rules Storage può riaprire il bucket USA con storage.rules oppure non chiuderlo più." },
  ]) {
    const found = Object.entries(storage).flatMap(([name, list]) => (Array.isArray(list) ? list.filter(item => item === bucket).map(() => name) : []));
    if (found.length === 0) {
      problems.push(`.firebaserc: il ${nome} ${bucket} non è in nessun target Storage, deve stare solo in "${expected}". ${rischio}`);
    } else if (found.length !== 1 || found[0] !== expected) {
      problems.push(`.firebaserc: il ${nome} ${bucket} compare nei target [${found.join(", ")}], deve stare solo in "${expected}". ${rischio}`);
    }
  }
  for (const item of listOf(MAIN_TARGET)) {
    if (item !== EU_BUCKET) problems.push(`.firebaserc: il target "${MAIN_TARGET}" contiene anche ${item}: gli verrebbero applicate le rules normali di ${MAIN_RULES}.`);
  }
  for (const item of listOf(CLOSED_TARGET)) {
    if (item !== US_BUCKET) problems.push(`.firebaserc: il target "${CLOSED_TARGET}" contiene anche ${item}: gli verrebbero applicate le rules chiuse e tutti i suoi media sparirebbero agli utenti.`);
  }
  for (const [project, mapping] of Object.entries(rc.targets ?? {})) {
    if (project === PROJECT) continue;
    const buckets = Object.values(mapping?.storage ?? {}).flat();
    for (const bucket of [EU_BUCKET, US_BUCKET]) {
      if (buckets.includes(bucket)) problems.push(`.firebaserc: il progetto "${project}" mappa il bucket di produzione ${bucket}: un deploy di quel progetto toccherebbe i bucket veri.`);
    }
  }
  return problems;
}

// 2. firebase.json: target main -> storage.rules, legacyClosed -> chiuse,
// nessuna voce senza target.
function checkFirebaseJson(source) {
  const { value: config, problem } = parseJson(source, "firebase.json");
  if (problem) return [problem];
  const storage = config?.storage;
  if (!Array.isArray(storage)) {
    return [`firebase.json: "storage" deve essere un elenco di voci con target (${MAIN_TARGET} e ${CLOSED_TARGET}). Una voce singola senza target va al bucket di default del progetto, cioè quello USA vecchio: il bucket UE resterebbe senza rules e il bucket USA non sarebbe chiuso.`];
  }
  const problems = [];
  storage.forEach((entry, index) => {
    const numero = index + 1;
    if (!entry || typeof entry.target !== "string" || entry.target === "") {
      problems.push(`firebase.json: la voce storage numero ${numero} non ha target e andrebbe al bucket di default, cioè quello USA vecchio.`);
    } else if (![MAIN_TARGET, CLOSED_TARGET].includes(entry.target)) {
      problems.push(`firebase.json: la voce storage numero ${numero} usa il target non previsto "${entry.target}".`);
    }
    if (entry && typeof entry === "object" && "bucket" in entry) {
      problems.push(`firebase.json: la voce storage numero ${numero} nomina il bucket "${entry.bucket}" invece di un target e aggira la mappatura di .firebaserc.`);
    }
  });
  for (const { target, rules, conseguenzaMancante, rulesSbagliate } of [
    { target: MAIN_TARGET, rules: MAIN_RULES,
      conseguenzaMancante: "le rules del bucket UE non verrebbero più deployate.",
      rulesSbagliate: { [CLOSED_RULES]: "il bucket UE verrebbe chiuso e tutti i media sparirebbero agli utenti." } },
    { target: CLOSED_TARGET, rules: CLOSED_RULES,
      conseguenzaMancante: "il bucket USA vecchio non verrebbe più chiuso da un deploy.",
      rulesSbagliate: { [MAIN_RULES]: "il bucket USA vecchio verrebbe riaperto con le rules normali." } },
  ]) {
    const entries = storage.filter(entry => entry?.target === target);
    if (entries.length === 0) {
      problems.push(`firebase.json: manca la voce storage con target "${target}": ${conseguenzaMancante}`);
    } else if (entries.length > 1) {
      problems.push(`firebase.json: il target "${target}" compare in ${entries.length} voci storage, ne serve una sola.`);
    } else if (entries[0].rules !== rules) {
      const conseguenza = rulesSbagliate[entries[0].rules] ?? "il bucket riceverebbe rules diverse da quelle previste.";
      problems.push(`firebase.json: il target "${target}" usa "${entries[0].rules}" invece di "${rules}": ${conseguenza}`);
    }
  }
  return problems;
}

// 3. storage.legacy-closed.rules: un solo allow, `read, write: if false`.
function checkClosedRules(source) {
  const body = stripComments(source);
  const problems = [];
  if (!/rules_version\s*=\s*['"]2['"]\s*;/.test(body)) {
    problems.push(`${CLOSED_RULES}: manca rules_version = '2'; senza la versione 2 le rules non sono quelle previste.`);
  }
  const allowCount = (body.match(/\ballow\b/g) ?? []).length;
  if (allowCount !== 1) {
    problems.push(`${CLOSED_RULES}: contiene ${allowCount} allow (commenti esclusi), ne serve uno solo: ogni allow in più può riaprire il bucket USA ai client.`);
  } else {
    const allow = body.match(/\ballow\b[^;]*;?/)[0];
    if (compact(allow) !== "allowread,write:iffalse;") {
      problems.push(`${CLOSED_RULES}: l'allow è "${allow.replace(/\s+/g, " ").trim()}" invece di "allow read, write: if false;": il bucket USA non sarebbe più chiuso a tutti.`);
    }
  }
  if (/\btrue\b/.test(body)) {
    problems.push(`${CLOSED_RULES}: compare "true" fuori dai commenti: una condizione sempre vera riaprirebbe il bucket USA ai client.`);
  }
  if (!/match\s+\/b\/\{bucket\}\/o\s*\{/.test(body) || !/match\s+\/\{allPaths=\*\*\}\s*\{/.test(body)) {
    problems.push(`${CLOSED_RULES}: mancano i match "/b/{bucket}/o" e "/{allPaths=**}": la chiusura non coprirebbe tutti i percorsi del bucket.`);
  }
  if (problems.length === 0 &&
      compact(body) !== "rules_version='2';servicefirebase.storage{match/b/{bucket}/o{match/{allPaths=**}{allowread,write:iffalse;}}}") {
    problems.push(`${CLOSED_RULES}: la struttura è diversa dall'unica ammessa (service firebase.storage > match /b/{bucket}/o > match /{allPaths=**} > allow read, write: if false;): funzioni o match aggiuntivi potrebbero riaprire il bucket USA.`);
  }
  return problems;
}

// 4. storage.rules (bucket UE): ha ancora le rules vere, non le chiuse.
function checkMainRules(source) {
  const body = stripComments(source);
  const problems = [];
  if (!/match\s+\/protected\/stakes\/\{stakeId\}\/galleries\/\{galleryId\}\/media\/\{mediaId\}/.test(body)) {
    problems.push(`${MAIN_RULES}: manca il match delle gallerie protected/stakes/{stakeId}/galleries/{galleryId}/media/{mediaId}: i due file di rules sono stati scambiati o ${MAIN_RULES} è stato svuotato, e sul bucket UE foto e video delle gallerie non si vedrebbero più.`);
  }
  return problems;
}

// 5. firebase.staging.json: nessun target o bucket di produzione, rules normali.
function checkStagingConfig(source) {
  const { value: config, problem } = parseJson(source, "firebase.staging.json");
  if (problem) return [problem];
  const raw = config?.storage;
  const entries = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const problems = [];
  entries.forEach((entry, index) => {
    const numero = index + 1;
    if ([MAIN_TARGET, CLOSED_TARGET].includes(entry?.target)) {
      problems.push(`firebase.staging.json: la voce storage numero ${numero} usa il target di produzione "${entry.target}": lo staging deve restare separato dalla mappatura dei bucket veri.`);
    }
    if ([EU_BUCKET, US_BUCKET].includes(entry?.bucket)) {
      problems.push(`firebase.staging.json: la voce storage numero ${numero} nomina il bucket di produzione ${entry.bucket}.`);
    }
    if (entry?.rules !== MAIN_RULES) {
      problems.push(`firebase.staging.json: la voce storage numero ${numero} usa "${entry?.rules}" invece di "${MAIN_RULES}": con le rules chiuse lo staging non caricherebbe più i media.`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Utilità dei test
// ---------------------------------------------------------------------------

function assertNoProblems(problems, titolo) {
  assert.equal(problems.length, 0, `${titolo}:\n${problems.map(problem => ` - ${problem}`).join("\n")}`);
}

// La guardia deve accorgersi dell'errore e dirlo con le parole attese.
function assertCaught(problems, pattern, errore) {
  assert.ok(problems.length > 0, `La guardia non si accorge di: ${errore}`);
  assert.ok(problems.some(problem => pattern.test(problem)),
    `La guardia segnala altro invece di: ${errore}\n${problems.map(problem => ` - ${problem}`).join("\n")}`);
}

const withJson = (source, mutate) => {
  const value = JSON.parse(source);
  mutate(value);
  return JSON.stringify(value, null, 2);
};
const replaceOnce = (source, from, to) => {
  assert.ok(source.includes(from), `Il testo da modificare non c'è più nel file vero: ${from}`);
  return source.replace(from, to);
};

// ---------------------------------------------------------------------------
// File veri del repo
// ---------------------------------------------------------------------------

test(".firebaserc: bucket UE solo in main, bucket USA solo in legacyClosed", () => {
  assertNoProblems(checkFirebaserc(real.firebaserc), "Mappatura bucket -> target in .firebaserc non sicura");
});

test("firebase.json: main usa storage.rules, legacyClosed le rules chiuse, nessuna voce senza target", () => {
  assertNoProblems(checkFirebaseJson(real.firebaseJson), "Voci storage di firebase.json non sicure");
});

test("storage.legacy-closed.rules: un solo allow, read e write false su tutti i percorsi", () => {
  assertNoProblems(checkClosedRules(real.closedRules), "Le rules chiuse del bucket USA non sono più chiuse");
});

test("storage.rules (bucket UE) ha ancora il match delle gallerie", () => {
  assertNoProblems(checkMainRules(real.mainRules), "storage.rules non è più quello del bucket UE");
});

test("firebase.staging.json non usa i target di produzione", () => {
  assertNoProblems(checkStagingConfig(real.stagingJson), "firebase.staging.json tocca la mappatura di produzione");
});

test("i due file di rules sono diversi: le chiuse non finiscono in storage.rules", () => {
  assert.notEqual(compact(stripComments(real.mainRules)), compact(stripComments(real.closedRules)),
    `${MAIN_RULES} e ${CLOSED_RULES} hanno lo stesso contenuto: il bucket UE sarebbe chiuso a tutti.`);
});

// ---------------------------------------------------------------------------
// Prova delle guardie su copie in memoria con errori introdotti apposta
// ---------------------------------------------------------------------------
// Configurazione corretta scritta qui a mano, indipendente dai file veri: se un
// file vero si rompe fallisce solo il suo test sopra, non anche queste prove.
const baseline = {
  firebaserc: JSON.stringify({
    projects: { default: PROJECT },
    targets: { [PROJECT]: { storage: { [MAIN_TARGET]: [EU_BUCKET], [CLOSED_TARGET]: [US_BUCKET] } } },
  }, null, 2),
  firebaseJson: JSON.stringify({
    storage: [{ target: MAIN_TARGET, rules: MAIN_RULES }, { target: CLOSED_TARGET, rules: CLOSED_RULES }],
  }, null, 2),
  stagingJson: JSON.stringify({ storage: { rules: MAIN_RULES } }, null, 2),
  closedRules: `rules_version = '2';

// Commento che nomina "allow read: if true" senza essere codice.
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
`,
  mainRules: `rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    match /protected/stakes/{stakeId}/galleries/{galleryId}/media/{mediaId}/{fileName=**} {
      allow read: if request.auth != null;
    }
  }
}
`,
};

test("la configurazione di partenza delle prove passa tutte le guardie", () => {
  assertNoProblems([
    ...checkFirebaserc(baseline.firebaserc),
    ...checkFirebaseJson(baseline.firebaseJson),
    ...checkClosedRules(baseline.closedRules),
    ...checkMainRules(baseline.mainRules),
    ...checkStagingConfig(baseline.stagingJson),
  ], "La configurazione di partenza non è valida, le prove sulle guardie non significano nulla");
});


test("guardia .firebaserc: bucket scambiati fra i due target", () => {
  const swapped = withJson(baseline.firebaserc, rc => {
    rc.targets[PROJECT].storage = { [MAIN_TARGET]: [US_BUCKET], [CLOSED_TARGET]: [EU_BUCKET] };
  });
  const problems = checkFirebaserc(swapped);
  assertCaught(problems, /bucket UE giovani-palo-eu compare nei target \[legacyClosed\]/, "bucket UE nel target legacyClosed");
  assertCaught(problems, /bucket USA vecchio giovani-palo\.firebasestorage\.app compare nei target \[main\]/, "bucket USA nel target main");
});

test("guardia .firebaserc: bucket in due target, mancante, target sparito, bucket di troppo", () => {
  const edit = mutate => checkFirebaserc(withJson(baseline.firebaserc, rc => mutate(rc.targets[PROJECT].storage)));
  assertCaught(edit(storage => { storage[CLOSED_TARGET].push(EU_BUCKET); }), /compare nei target \[main, legacyClosed\]/, "bucket UE anche in legacyClosed");
  assertCaught(edit(storage => { storage[MAIN_TARGET].push(US_BUCKET); }), /vecchio giovani-palo\.firebasestorage\.app compare nei target \[main, legacyClosed\]/, "bucket USA anche in main");
  assertCaught(edit(storage => { storage[MAIN_TARGET] = []; }), /non è in nessun target Storage/, "bucket UE senza target");
  assertCaught(edit(storage => { delete storage[CLOSED_TARGET]; }), /giovani-palo\.firebasestorage\.app non è in nessun target/, "target legacyClosed rimosso");
  assertCaught(edit(storage => { storage[MAIN_TARGET].push("altro-bucket"); }), /"main" contiene anche altro-bucket/, "bucket sconosciuto in main");
  assertCaught(edit(storage => { storage[MAIN_TARGET] = [EU_BUCKET, EU_BUCKET]; }), /compare nei target \[main, main\]/, "bucket UE duplicato");
  assertCaught(checkFirebaserc(withJson(baseline.firebaserc, rc => {
    rc.targets["giovani-palo-staging"] = { storage: { [MAIN_TARGET]: [US_BUCKET] } };
  })), /giovani-palo-staging.*bucket di produzione/, "progetto di staging con il bucket USA");
  assertCaught(checkFirebaserc(withJson(baseline.firebaserc, rc => { delete rc.targets[PROJECT]; })), /manca targets\.giovani-palo\.storage/, "progetto senza target");
  assertCaught(checkFirebaserc("{ non json"), /JSON non valido/, "file illeggibile");
});

test("guardia firebase.json: rules scambiate, voce senza target, voce mancante o doppia", () => {
  const edit = mutate => checkFirebaseJson(withJson(baseline.firebaseJson, mutate));
  assertCaught(edit(config => {
    const [main, closed] = config.storage;
    [main.rules, closed.rules] = [closed.rules, main.rules];
  }), /target "main" usa "storage\.legacy-closed\.rules".*bucket UE verrebbe chiuso/, "rules chiuse sul target main");
  assertCaught(edit(config => { config.storage[1].rules = MAIN_RULES; }),
    /target "legacyClosed" usa "storage\.rules".*bucket USA vecchio verrebbe riaperto/, "storage.rules sul target legacyClosed");
  assertCaught(edit(config => { config.storage = { rules: MAIN_RULES }; }), /deve essere un elenco di voci con target/, "storage come oggetto singolo senza target");
  assertCaught(edit(config => { config.storage.push({ rules: MAIN_RULES }); }), /voce storage numero 3 non ha target/, "voce senza target");
  assertCaught(edit(config => { delete config.storage[0].target; }), /voce storage numero 1 non ha target/, "target tolto dalla voce main");
  assertCaught(edit(config => { config.storage.pop(); }), /manca la voce storage con target "legacyClosed"/, "voce legacyClosed rimossa");
  assertCaught(edit(config => { config.storage.shift(); }), /manca la voce storage con target "main"/, "voce main rimossa");
  assertCaught(edit(config => { config.storage.push({ ...config.storage[0] }); }), /target "main" compare in 2 voci/, "voce main duplicata");
  assertCaught(edit(config => { config.storage.push({ bucket: US_BUCKET, rules: MAIN_RULES }); }), /nomina il bucket "giovani-palo\.firebasestorage\.app"/, "voce con il bucket USA e storage.rules");
  assertCaught(edit(config => { config.storage.push({ target: "altro", rules: MAIN_RULES }); }), /target non previsto "altro"/, "target sconosciuto");
  assertCaught(edit(config => { delete config.storage; }), /deve essere un elenco/, "storage tolto");
});

test("guardia rules chiuse: un allow in più o una condizione diversa riaprono il bucket USA", () => {
  const allow = "allow read, write: if false;";
  const edit = to => checkClosedRules(replaceOnce(baseline.closedRules, allow, to));
  assertCaught(edit(`${allow}\n      allow read: if true;`), /contiene 2 allow/, "allow read: if true aggiunto");
  assertCaught(edit("allow read, write: if true;"), /compare "true"/, "if true al posto di if false");
  assertCaught(edit("allow read, write: if request.auth != null;"), /invece di "allow read, write: if false;"/, "condizione sull'utente loggato");
  assertCaught(edit("allow read: if false;"), /invece di "allow read, write: if false;"/, "solo read chiuso");
  assertCaught(edit("allow write: if false;"), /invece di "allow read, write: if false;"/, "solo write chiuso");
  assertCaught(edit("allow read, write;"), /invece di "allow read, write: if false;"/, "allow senza condizione");
  assertCaught(edit(""), /contiene 0 allow/, "nessun allow");
  assertCaught(edit(`${allow}\n      allow get: if false;`), /contiene 2 allow/, "secondo allow anche se chiuso");
  assertCaught(checkClosedRules(replaceOnce(baseline.closedRules, "rules_version = '2';", "")), /manca rules_version/, "rules_version tolto");
  assertCaught(checkClosedRules(replaceOnce(baseline.closedRules, "match /{allPaths=**} {", "match /public/{allPaths=**} {")), /mancano i match/, "chiusura limitata a un prefisso");
  assertCaught(checkClosedRules(replaceOnce(baseline.closedRules, "    match /{allPaths=**} {",
    "    function open() { return true; }\n    match /{allPaths=**} {")), /compare "true"/, "funzione che restituisce true");
  assertCaught(checkClosedRules(replaceOnce(baseline.closedRules, "    match /{allPaths=**} {",
    "    function ok() { return request.auth != null; }\n    match /{allPaths=**} {")), /struttura è diversa/, "funzione aggiuntiva");
  assertCaught(checkClosedRules(baseline.mainRules), /invece di "allow read, write: if false;"/, "storage.rules al posto delle rules chiuse");
});

test("guardia rules chiuse: i commenti non contano", () => {
  const commented = `${baseline.closedRules}\n// allow read: if true;\n/* allow write: if true; */\n`;
  assertNoProblems(checkClosedRules(commented), "Un allow dentro un commento viene scambiato per codice");
  const hidden = replaceOnce(baseline.closedRules, "allow read, write: if false;", "// allow read, write: if false;\n      allow read: if true;");
  assertCaught(checkClosedRules(hidden), /invece di "allow read, write: if false;"/, "allow chiuso solo in commento e allow aperto vero");
});

test("guardia storage.rules: file scambiati o match delle gallerie tolto", () => {
  assertCaught(checkMainRules(baseline.closedRules), /file di rules sono stati scambiati/, "rules chiuse al posto di storage.rules");
  assertCaught(checkMainRules(""), /match delle gallerie/, "storage.rules vuoto");
  assertCaught(checkMainRules(replaceOnce(baseline.mainRules, "match /protected/stakes/{stakeId}/galleries/", "// match /protected/stakes/{stakeId}/galleries/")),
    /match delle gallerie/, "match delle gallerie commentato");
});

test("guardia staging: target di produzione, bucket di produzione, rules chiuse", () => {
  const edit = mutate => checkStagingConfig(withJson(baseline.stagingJson, mutate));
  assertCaught(edit(config => { config.storage = [{ target: MAIN_TARGET, rules: MAIN_RULES }]; }), /target di produzione "main"/, "target main in staging");
  assertCaught(edit(config => { config.storage = [{ target: CLOSED_TARGET, rules: CLOSED_RULES }]; }), /target di produzione "legacyClosed"/, "target legacyClosed in staging");
  assertCaught(edit(config => { config.storage = { rules: CLOSED_RULES }; }), /con le rules chiuse lo staging/, "rules chiuse in staging");
  assertCaught(edit(config => { config.storage = { bucket: EU_BUCKET, rules: MAIN_RULES }; }), /bucket di produzione giovani-palo-eu/, "bucket UE in staging");
  assertNoProblems(edit(config => { config.storage = [{ rules: MAIN_RULES }]; }), "Una voce staging normale viene rifiutata");
});
