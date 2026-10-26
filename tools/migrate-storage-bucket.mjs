#!/usr/bin/env node
// Sposta i file da un bucket Storage a un altro e riscrive in Firestore gli URL
// che nominano il bucket vecchio. Dry-run di default (nessuna scrittura, nemmeno
// del checkpoint); idempotente e riprendibile: si rilancia finché non c'è più
// niente da fare. Piano e ordine dei passi: handbook privato del progetto.
//
//   --phase sync     copia lato server (rewrite, metadata e token di download
//                    compresi) dei file nuovi o cambiati, riallinea i metadata
//                    cambiati nella sorgente (token revocati), toglie dalla
//                    destinazione i file copiati e poi cancellati nella sorgente
//   --phase rewrite  sostituisce il bucket negli URL salvati in Firestore
//   --phase verify   confronta i bucket, cerca URL rimasti sul vecchio, prova
//                    qualche download con token sul nuovo, legge la regione
//   --phase all      sync, rewrite, verify (default)
//
// Emulatori (FIRESTORE_EMULATOR_HOST e FIREBASE_STORAGE_EMULATOR_HOST impostati):
//   node tools/migrate-storage-bucket.mjs --project demo-x --from a --to b --apply
// Produzione o staging: login della Firebase CLI (non gcloud), --project esplicito,
// --account se il progetto sta su un altro login della CLI.
//   node tools/migrate-storage-bucket.mjs --project giovani-palo \
//     --from giovani-palo.firebasestorage.app --to giovani-palo-eu --phase sync
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { guardMediaCopy, mediaLifecyclePath } from "./lib/storageMediaLifecycle.mjs";
import { metadataKey, planSync, rewriteDocumentFields } from "./lib/storageMigration.mjs";

const { values: args } = parseArgs({
  options: {
    project: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    phase: { type: "string", default: "all" },
    apply: { type: "boolean", default: false },
    checkpoint: { type: "string" },
    concurrency: { type: "string", default: "6" },
    "max-deletes": { type: "string", default: "20" },
    account: { type: "string" },
  },
});

const PHASES = { sync: ["sync"], rewrite: ["rewrite"], verify: ["verify"], all: ["sync", "rewrite", "verify"] };
if (!args.project || !args.from || !args.to || !PHASES[args.phase] || args.from === args.to) {
  console.error("Uso: --project <id> --from <bucket> --to <bucket> [--phase sync|rewrite|verify|all] [--apply]");
  process.exit(2);
}
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST);
if (emulator && !(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST)) {
  console.error("Emulatori: servono sia FIRESTORE_EMULATOR_HOST sia FIREBASE_STORAGE_EMULATOR_HOST.");
  process.exit(2);
}
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 6);
const MAX_DELETES = Number(args["max-deletes"]);
// Un tetto non numerico (NaN) spegnerebbe la guardia sulle cancellazioni.
if (!Number.isInteger(MAX_DELETES) || MAX_DELETES < 0) {
  console.error("--max-deletes vuole un intero >= 0.");
  process.exit(2);
}
const checkpointPath =
  args.checkpoint ||
  path.join(os.homedir(), ".cache", "giovani-palo", "storage-migration", `${args.project}__${args.from}__${args.to}.jsonl`);

const enc = encodeURIComponent;
const log = (...xs) => console.log(new Date().toISOString().slice(11, 19), ...xs);

// --- trasporto --------------------------------------------------------------

async function makeApi() {
  if (emulator) {
    const st = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`;
    return {
      storage: st,
      firestore: `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1`,
      download: `${st}/v0`,
      headers: async () => ({ Authorization: "Bearer owner" }),
    };
  }
  const root = path.join(execSync("npm root -g").toString().trim(), "firebase-tools", "lib");
  const require = createRequire(import.meta.url);
  const { requireAuth } = require(path.join(root, "requireAuth"));
  const apiv2 = require(path.join(root, "apiv2"));
  // --account: un altro login della CLI (staging sta su un altro account Google).
  await requireAuth({ project: args.project, ...(args.account ? { account: args.account } : {}) });
  return {
    storage: "https://storage.googleapis.com/storage/v1",
    firestore: "https://firestore.googleapis.com/v1",
    download: "https://firebasestorage.googleapis.com/v0",
    // Con l'ADC Storage risponde 403 senza il progetto di fatturazione esplicito.
    headers: async () => ({ Authorization: `Bearer ${await apiv2.getAccessToken()}`, "x-goog-user-project": args.project }),
  };
}

let api;
async function call(method, url, body, { ok = [] } = {}) {
  for (let attempt = 1; ; attempt++) {
    const headers = await api.headers();
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (res.ok || ok.includes(res.status)) {
      return { status: res.status, json: text ? JSON.parse(text) : {} };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    const err = new Error(`${method} ${url.replace(/\?.*/, "")} → ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
}

async function pool(items, fn) {
  let i = 0;
  const errors = [];
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        await fn(item);
      } catch (e) {
        errors.push({ item, message: e.message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return errors;
}

// --- Storage ----------------------------------------------------------------

const objectUrl = (bucket, name) => `${api.storage}/b/${enc(bucket)}/o/${enc(name)}`;

async function listObjects(bucket, { allowMissing = false } = {}) {
  const out = new Map();
  let pageToken;
  do {
    const q = new URLSearchParams({ maxResults: "1000" });
    if (pageToken) q.set("pageToken", pageToken);
    const { status, json } = await call("GET", `${api.storage}/b/${enc(bucket)}/o?${q}`, undefined, { ok: allowMissing ? [404] : [] });
    if (status === 404) {
      log(`  il bucket ${bucket} non esiste ancora: lo tratto come vuoto (solo in dry-run)`);
      return out;
    }
    for (const o of json.items || []) {
      out.set(o.name, {
        generation: String(o.generation),
        metageneration: String(o.metageneration),
        crc32c: o.crc32c,
        size: Number(o.size),
        metadata: o.metadata || {},
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

function loadCheckpoint() {
  const map = new Map();
  if (!fs.existsSync(checkpointPath)) return map;
  for (const line of fs.readFileSync(checkpointPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (e.deleted) map.delete(e.name);
    else map.set(e.name, e);
  }
  return map;
}

function record(entry) {
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.appendFileSync(checkpointPath, JSON.stringify(entry) + "\n");
}

async function readMediaLifecycle(relativePath) {
  const { status, json } = await call("GET", docUrl(`${docsRoot()}/${relativePath}`), undefined, { ok: [404] });
  return status === 404 ? null : { operation: json.fields?.operation?.stringValue, rotationSeed: json.fields?.rotationSeed?.stringValue };
}
let deletionBudgetNames = new Set();
async function removeMediaCopies(name) {
  deletionBudgetNames.add(name);
  if (deletionBudgetNames.size > MAX_DELETES) throw new Error("Tetto cancellazioni superato da un tombstone concorrente; sync fermato.");
  const results = await Promise.allSettled([args.from, args.to].map((bucket) =>
    call("DELETE", objectUrl(bucket, name), undefined, { ok: [404] })));
  if (results.some((result) => result.status === "rejected")) throw new Error("Cleanup copie media incompleto.");
  record({ name, deleted: true });
}
// Metadata first, then authoritative seed, then CAS: a newer rotation or
// rewrite invalidates this patch instead of allowing a stale token to win.
async function reconcileMediaHide(name, lifecyclePath) {
  for (const bucket of [args.from, args.to]) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { status, json: metadata } = await call("GET", objectUrl(bucket, name), undefined, { ok: [404] });
      if (status === 404) break;
      const state = await readMediaLifecycle(lifecyclePath);
      if (state?.operation === "delete") { await removeMediaCopies(name); return; }
      if (state?.operation !== "hide") break;
      if (!state.rotationSeed) throw new Error("Seed lifecycle mancante: sync bloccato.");
      const token = createHmac("sha256", state.rotationSeed).update(name).digest("hex");
      if (metadata.metadata?.firebaseStorageDownloadTokens === token) break;
      const q = new URLSearchParams({ ifGenerationMatch: metadata.generation, ifMetagenerationMatch: metadata.metageneration });
      try {
        await call("PATCH", `${objectUrl(bucket, name)}?${q}`, { metadata: { firebaseStorageDownloadTokens: token } });
        break;
      } catch (error) {
        if ([409, 412].includes(error.status) && attempt < 4) continue;
        throw error;
      }
    }
  }
}

async function mediaDeleted(name) {
  const lifecyclePath = mediaLifecyclePath(name);
  return lifecyclePath && (await readMediaLifecycle(lifecyclePath))?.operation === "delete";
}

async function rewriteObject(name, srcGen, srcMetaGen, ifDestGeneration) {
  let rewriteToken;
  for (;;) {
    const q = new URLSearchParams({ ifSourceGenerationMatch: srcGen, ifSourceMetagenerationMatch: srcMetaGen, ifGenerationMatch: String(ifDestGeneration) });
    if (rewriteToken) q.set("rewriteToken", rewriteToken);
    if (await mediaDeleted(name)) { await removeMediaCopies(name); return null; }
    const { json } = await call("POST", `${objectUrl(args.from, name)}/rewriteTo/b/${enc(args.to)}/o/${enc(name)}?${q}`);
    if (json.done) return json.resource;
    rewriteToken = json.rewriteToken;
  }
}

async function phaseSync() {
  const [source, dest] = await Promise.all([listObjects(args.from), listObjects(args.to, { allowMissing: !args.apply })]);
  const checkpoint = loadCheckpoint();
  if (source.size === 0 && checkpoint.size > 0) {
    throw new Error("Sorgente vuota ma checkpoint pieno: lista sospetta, mi fermo prima di cancellare.");
  }
  const planned = planSync({ source, dest, checkpoint });
  const actions = [];
  // Fail closed on lifecycle read errors; never cache across mutations/retries.
  const plannedNames = new Set(planned.map(action => action.name));
  for (const action of planned) {
    actions.push(await mediaDeleted(action.name) ? { ...action, type: "mediaDeleted" } : action);
  }
  // Destination-only uploads can finish after a deletion listed its prefix.
  // They have no migration checkpoint, but the tombstone still owns cleanup.
  for (const name of dest.keys()) {
    if (!plannedNames.has(name) && await mediaDeleted(name)) actions.push({ name, type: "mediaDeleted" });
  }
  const count = (t) => actions.filter((a) => a.type === t).length;
  const bytesToCopy = actions
    .filter((a) => a.type === "copy" || a.type === "recopy")
    .reduce((s, a) => s + source.get(a.name).size, 0);
  log("SYNC", JSON.stringify({
    source: source.size,
    dest: dest.size,
    checkpoint: checkpoint.size,
    copy: count("copy"),
    recopy: count("recopy"),
    patchMetadata: count("patchMetadata"),
    deleteFromDest: count("deleteFromDest"),
    adopt: count("adopt"),
    unchanged: count("unchanged"),
    destNewer: count("destNewer"),
    conflict: count("conflict"),
    mediaDeleted: count("mediaDeleted"),
    tombstoneSourceDeletes: actions.filter(a => a.type === "mediaDeleted" && source.has(a.name)).length,
    tombstoneDestDeletes: actions.filter(a => a.type === "mediaDeleted" && dest.has(a.name)).length,
    mbToCopy: Number((bytesToCopy / 1e6).toFixed(1)),
  }));
  for (const a of actions.filter((x) => x.type === "conflict")) log("  CONFLICT", a.name, "-", a.reason);
  const deletes = actions.filter((a) => a.type === "deleteFromDest" || a.type === "mediaDeleted");
  for (const a of deletes) log(a.type === "mediaDeleted" ? "  DELETE-MEDIA-BOTH-BUCKETS" : "  DELETE-FROM-DEST", a.name);
  if (deletes.length > MAX_DELETES) {
    throw new Error(`${deletes.length} percorsi da cancellare (copie USA/UE incluse), oltre --max-deletes ${MAX_DELETES}: controlla e rilancia con un tetto più alto.`);
  }
  deletionBudgetNames = new Set(deletes.map(a => a.name));
  if (!args.apply) return { actions, errors: [] };

  const snapshot = (name, resource) =>
    record({
      name,
      srcGen: source.get(name).generation,
      srcCrc: source.get(name).crc32c,
      srcMeta: metadataKey(source.get(name).metadata),
      dstGen: String(resource.generation),
    });

  let done = 0;
  const work = actions.filter((a) => !["unchanged", "destNewer", "conflict"].includes(a.type));
  const errors = await pool(work, async (a) => {
    const s = source.get(a.name);
    if (a.type === "mediaDeleted" || await mediaDeleted(a.name)) {
      await removeMediaCopies(a.name);
      return;
    }
    if (a.type === "copy" || a.type === "recopy") {
      const guarded = await guardMediaCopy({ name: a.name, readLifecycle: readMediaLifecycle,
        removeCopies: removeMediaCopies, apply: true, reconcileHide: reconcileMediaHide,
        copy: () => rewriteObject(a.name, s.generation, s.metageneration, a.ifDestGeneration) });
      if (guarded.skipped || !guarded.result) return;
      const resource = guarded.result;
      if (resource.crc32c !== s.crc32c || metadataKey(resource.metadata) !== metadataKey(s.metadata)) {
        throw new Error("copia diversa dalla sorgente (crc32c o metadata)");
      }
      snapshot(a.name, resource);
    } else if (a.type === "patchMetadata") {
      const d = dest.get(a.name);
      const metadata = { ...s.metadata };
      for (const k of Object.keys(d.metadata)) if (!(k in s.metadata)) metadata[k] = null;
      const q = new URLSearchParams({ ifGenerationMatch: a.dstGen, ifMetagenerationMatch: a.ifDestMetageneration });
      const guarded = await guardMediaCopy({ name: a.name, readLifecycle: readMediaLifecycle,
        removeCopies: removeMediaCopies, apply: true, reconcileHide: reconcileMediaHide,
        copy: async () => (await call("PATCH", `${objectUrl(args.to, a.name)}?${q}`, { metadata })).json });
      if (!guarded.skipped) snapshot(a.name, guarded.result);
    } else if (a.type === "adopt") {
      snapshot(a.name, { generation: a.dstGen });
    } else if (a.type === "deleteFromDest") {
      await call("DELETE", `${objectUrl(args.to, a.name)}?ifGenerationMatch=${a.ifDestGeneration}`, undefined, { ok: [404] });
      record({ name: a.name, deleted: true });
    }
    if (++done % 100 === 0) log(`  ${done}/${work.length}`);
  });
  log("SYNC_DONE", JSON.stringify({ done: work.length - errors.length, errors: errors.length }));
  for (const e of errors) log("  ERROR", e.item.type, e.item.name, e.message);
  return { actions, errors };
}

// --- Firestore --------------------------------------------------------------

const docsRoot = () => `projects/${args.project}/databases/(default)/documents`;
const docUrl = (name) => `${api.firestore}/${name.split("/").map(enc).join("/")}`;

async function listCollectionIds(parent) {
  const ids = [];
  let pageToken;
  do {
    const { json } = await call("POST", `${docUrl(parent)}:listCollectionIds`, { pageSize: 300, ...(pageToken ? { pageToken } : {}) });
    ids.push(...(json.collectionIds || []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return ids;
}

/**
 * Tutti i documenti del database, visitando l'albero per path: ogni collection
 * con listDocuments(showMissing), ogni documento (anche "mancante", cioè senza
 * campi ma con sottocollection, come un'attività cancellata con le iscrizioni
 * rimaste) con listCollectionIds. Così nessun ramo sfugge alla riscrittura.
 */
async function* allDocuments() {
  const queue = (await listCollectionIds(docsRoot())).map((id) => `${docsRoot()}/${id}`);
  while (queue.length) {
    const collection = queue.shift();
    let pageToken;
    do {
      const q = new URLSearchParams({ pageSize: "300", showMissing: "true" });
      if (pageToken) q.set("pageToken", pageToken);
      const { json } = await call("GET", `${docUrl(collection)}?${q}`);
      const page = json.documents || [];
      const children = [];
      await pool(page, async (d) => {
        for (const c of await listCollectionIds(d.name)) children.push(`${d.name}/${c}`);
      });
      queue.push(...children.sort());
      for (const d of page) if (d.createTime) yield d;
      pageToken = json.nextPageToken;
    } while (pageToken);
  }
}

const relPath = (name) => name.split("/documents/")[1];
const pattern = (name) => relPath(name).split("/").map((p, i) => (i % 2 ? "*" : p)).join("/");

async function phaseRewrite() {
  const byPattern = {};
  let scanned = 0;
  let leftovers = 0;
  const todo = [];
  for await (const d of allDocuments()) {
    scanned++;
    const r = rewriteDocumentFields(d.fields, args.from, args.to);
    leftovers += r.leftovers;
    if (!r.changes) continue;
    todo.push({ doc: d, r });
    for (const m of r.mask) byPattern[`${pattern(d.name)} :: ${m}`] = (byPattern[`${pattern(d.name)} :: ${m}`] || 0) + 1;
  }
  log("REWRITE", JSON.stringify({ scanned, docs: todo.length, fields: todo.reduce((s, t) => s + t.r.changes, 0), unknownFormatLeftovers: leftovers }));
  for (const [k, v] of Object.entries(byPattern).sort()) log("  ", v, k);
  // I trigger onDocumentWritten delle iscrizioni rientrano anche per questa
  // scrittura: lo stato dice se possono fare qualcosa (solo pending_parent_authorization).
  const regStates = {};
  for (const t of todo.filter((x) => relPath(x.doc.name).includes("/registrations/"))) {
    const s = t.doc.fields?.registrationStatus?.stringValue ?? "(nessuno)";
    regStates[s] = (regStates[s] || 0) + 1;
  }
  if (Object.keys(regStates).length) log("  iscrizioni toccate per registrationStatus", JSON.stringify(regStates));
  if (!args.apply) return { todo, errors: [] };

  let done = 0;
  const errors = await pool(todo, async ({ doc }) => {
    for (let attempt = 1; ; attempt++) {
      const current = attempt === 1 ? doc : (await call("GET", docUrl(doc.name))).json;
      const r = rewriteDocumentFields(current.fields, args.from, args.to);
      if (!r.changes) return;
      // Precondizione sull'updateTime letto: se il documento cambia nel frattempo
      // la scrittura fallisce e si riparte dalla versione nuova.
      const write = {
        update: { name: doc.name, fields: r.fields },
        updateMask: { fieldPaths: r.mask },
        currentDocument: { updateTime: current.updateTime },
      };
      try {
        await call("POST", `${docUrl(docsRoot())}:commit`, { writes: [write] });
        done++;
        return;
      } catch (e) {
        // Il documento è cambiato fra lettura e scrittura: si rilegge e si riprova.
        if ((e.status === 400 || e.status === 409) && attempt < 4) continue;
        throw e;
      }
    }
  });
  log("REWRITE_DONE", JSON.stringify({ done, errors: errors.length }));
  for (const e of errors) log("  ERROR", relPath(e.item.doc.name), e.message);
  return { todo, errors };
}

// --- verifica -----------------------------------------------------------------

async function phaseVerify() {
  const [source, dest] = await Promise.all([listObjects(args.from), listObjects(args.to)]);
  let missing = 0;
  let differentContent = 0;
  let differentMetadata = 0;
  let deletedMediaObjects = 0;
  for (const name of new Set([...source.keys(), ...dest.keys()])) {
    if (await mediaDeleted(name)) deletedMediaObjects++;
  }
  for (const [name, s] of source) {
    const d = dest.get(name);
    if (!d) missing++;
    else if (d.crc32c !== s.crc32c) differentContent++;
    else if (metadataKey(d.metadata) !== metadataKey(s.metadata)) differentMetadata++;
  }
  const onlyInDest = [...dest.keys()].filter((n) => !source.has(n)).length;

  let oldRefs = 0;
  let scanned = 0;
  const samples = [];
  for await (const d of allDocuments()) {
    scanned++;
    const walk = (v) => {
      if (!v) return;
      if ("stringValue" in v) {
        if (v.stringValue.includes(args.from)) oldRefs++;
        else if (samples.length < 5 && v.stringValue.includes(`/v0/b/${args.to}/o/`) && v.stringValue.includes("token=")) samples.push(v.stringValue);
      } else if ("mapValue" in v) Object.values(v.mapValue.fields || {}).forEach(walk);
      else if ("arrayValue" in v) (v.arrayValue.values || []).forEach(walk);
    };
    walk({ mapValue: { fields: d.fields || {} } });
  }

  // Download con token sul bucket nuovo, come fa il browser (senza credenziali).
  const downloads = [];
  for (const url of samples) {
    const target = emulator ? url.replace(/^https?:\/\/[^/]+\/v0/, api.download) : url;
    const res = await fetch(target, { headers: { Range: "bytes=0-0" } });
    downloads.push(res.status);
    await res.body?.cancel();
  }

  let location = "(emulatore)";
  if (!emulator) {
    const { json } = await call("GET", `${api.storage}/b/${enc(args.to)}`);
    location = `${json.location} (${json.locationType})`;
  }
  const report = { source: source.size, dest: dest.size, missing, differentContent, differentMetadata, deletedMediaObjects, onlyInDest, docsScanned: scanned, oldRefs, downloads, destLocation: location };
  log("VERIFY", JSON.stringify(report));
  const ok = missing === 0 && differentContent === 0 && deletedMediaObjects === 0 && oldRefs === 0 && downloads.every((s) => s === 200 || s === 206);
  log(ok ? "VERIFY_OK" : "VERIFY_FAIL");
  return { ok, report };
}

// --- main ---------------------------------------------------------------------

try {
  api = await makeApi();
  log(`progetto ${args.project}${emulator ? " (emulatori)" : ""}, ${args.from} → ${args.to}, ${args.apply ? "APPLY" : "dry-run"}, checkpoint ${checkpointPath}`);
  let failed = false;
  for (const phase of PHASES[args.phase]) {
    if (phase === "sync") failed = (await phaseSync()).errors.length > 0 || failed;
    if (phase === "rewrite") failed = (await phaseRewrite()).errors.length > 0 || failed;
    if (phase === "verify" && (args.apply || args.phase === "verify")) failed = !(await phaseVerify()).ok || failed;
  }
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error("FAIL", e.message);
  process.exit(1);
}
