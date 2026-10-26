// Independent acceptance tests, written from the Storage EU transition contract.
// No Admin SDK, credentials, environment changes or network access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resolveMediaBucketNames, mediaFolder, createGalleryMediaStorage, rewriteMediaDownloadUrl } = require("../lib/galleryMediaStorage.js");
const { mediaLifecyclePath, guardMediaCopy: guardedCopy } = await import("../../tools/lib/storageMediaLifecycle.mjs");
const guardMediaCopy = options => guardedCopy({ reconcileHide: async () => {}, ...options });

const EU = "giovani-palo-eu", US = "giovani-palo.firebasestorage.app";
const context = { stakeId: "stake-a", galleryId: "gallery-a", mediaId: "media-a" };
const prefix = "protected/stakes/stake-a/galleries/gallery-a/media/media-a/";
const path = `${prefix}foto con accènto.jpg`;
const thumb = `${prefix}thumbnail.jpg`;
const sibling = `${prefix.slice(0, -1)}-sibling/photo.jpg`;
const pdf = "protected/stakes/stake-a/activities/activity-a/parent-authorization-pdfs/user-a/document.pdf";
const url = (bucket, objectPath = path, token = "old-token") => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
const clone = value => structuredClone(value);

function fakeStorage({ failedLists = [], failedWrites = [], failedDeletes = [] } = {}) {
  const contents = new Map([[EU, new Map()], [US, new Map()]]);
  const calls = [];
  const faults = { failedLists: new Set(failedLists), failedWrites: new Set(failedWrites), failedDeletes: new Set(failedDeletes), beforeWrite: null };
  const failure = () => Object.assign(new Error("synthetic-storage-failure"), { code: 503 });
  function put(bucket, objectPath, token = "old-token") {
    contents.get(bucket).set(objectPath, { name: objectPath, generation: "1", metageneration: "1", contentType: "image/jpeg", metadata: { firebaseStorageDownloadTokens: token, uploadedBy: "owner", sentinel: "preserve" } });
  }
  function file(bucket, objectPath) {
    return {
      name: objectPath,
      bucket: { name: bucket },
      async getMetadata() { return [clone(contents.get(bucket).get(objectPath))]; },
      async setMetadata(patch, options = {}) {
        calls.push(["setMetadata", bucket, objectPath]);
        if (faults.failedWrites.has(bucket)) throw failure();
        if (faults.beforeWrite) await faults.beforeWrite({ bucket, objectPath, patch, options });
        const previous = contents.get(bucket).get(objectPath);
        for (const [option, field] of [["ifGenerationMatch", "generation"], ["ifMetagenerationMatch", "metageneration"]]) {
          if (options[option] !== undefined && String(options[option]) !== previous[field]) throw Object.assign(new Error("synthetic-precondition-failed"), { code: 412 });
        }
        // GCS objects.patch updates named metadata keys. An explicit token key
        // replaces its previous value; this fake does not reproduce the known
        // Storage Emulator bug that appends download tokens instead.
        contents.get(bucket).set(objectPath, { ...previous, ...clone(patch), metageneration: String(Number(previous.metageneration) + 1), metadata: { ...previous.metadata, ...patch.metadata } });
        return [clone(contents.get(bucket).get(objectPath))];
      },
      async delete() { contents.get(bucket).delete(objectPath); },
    };
  }
  const storage = { bucket(bucket) {
    assert.ok(contents.has(bucket), `unexpected bucket access: ${bucket}`);
    return {
      name: bucket,
      async getFiles({ prefix: selected }) {
        calls.push(["getFiles", bucket, selected]);
        if (faults.failedLists.has(bucket)) throw failure();
        return [[...contents.get(bucket).keys()].filter(item => item.startsWith(selected)).map(item => file(bucket, item))];
      },
      file: objectPath => file(bucket, objectPath),
      async deleteFiles({ prefix: selected }) {
        calls.push(["deleteFiles", bucket, selected]);
        if (faults.failedDeletes.has(bucket)) throw failure();
        for (const objectPath of contents.get(bucket).keys()) if (objectPath.startsWith(selected)) contents.get(bucket).delete(objectPath);
      },
    };
  } };
  return { storage, contents, calls, faults, put, metadata: (bucket, objectPath) => contents.get(bucket).get(objectPath)?.metadata };
}
function fixture(options = {}) {
  const f = fakeStorage(options);
  for (const bucket of [EU, US]) {
    f.put(bucket, path); f.put(bucket, thumb, "old-thumb-token"); f.put(bucket, sibling); f.put(bucket, pdf);
  }
  return { ...f, helper: createGalleryMediaStorage({ storage: f.storage, bucketNames: [EU, US] }) };
}
const expectIncomplete = promise => assert.rejects(promise, error => {
  assert.equal(error.code, "storage-cleanup-incomplete");
  assert.equal(error.retryable, true);
  return true;
});

test("produzione: revoca e delete hanno entrambi i bucket fissi anche se default è USA", () => {
  assert.deepEqual(resolveMediaBucketNames({ projectId: "giovani-palo", emulator: false, defaultBucketName: US }), [EU, US]);
});
test("produzione: default EU non elimina il vecchio bucket dalla transizione", () => {
  assert.deepEqual(resolveMediaBucketNames({ projectId: "giovani-palo", emulator: false, defaultBucketName: EU }), [EU, US]);
});
for (const [label, input] of [
  ["staging", { projectId: "giovani-palo-staging", emulator: false, defaultBucketName: "giovani-palo-staging-eu" }],
  ["demo", { projectId: "demo-storage-eu", emulator: true, defaultBucketName: "demo-storage-eu.appspot.com" }],
  ["emulatore con projectId produzione", { projectId: "giovani-palo", emulator: true, defaultBucketName: "isolated-emulator-bucket" }],
]) test(`${label}: soltanto il proprio bucket, mai i due bucket reali`, () => {
  assert.deepEqual(resolveMediaBucketNames(input), [input.defaultBucketName]);
});
test("prefisso esatto include lo slash finale e non comprende il media fratello", () => {
  assert.equal(mediaFolder(context.stakeId, context.galleryId, context.mediaId), prefix);
  assert.equal(sibling.startsWith(prefix), false);
});
test("revoca: vecchi token rimossi da entrambe le repliche, altri metadata e file preservati", async () => {
  const f = fixture();
  const result = await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" });
  assert.deepEqual(result.bucketNames, [EU, US]);
  for (const bucket of [EU, US]) for (const objectPath of [path, thumb]) {
    const m = f.metadata(bucket, objectPath);
    assert.ok(m.firebaseStorageDownloadTokens);
    assert.ok(!m.firebaseStorageDownloadTokens.includes("old-"));
    assert.equal(m.uploadedBy, "owner"); assert.equal(m.sentinel, "preserve");
  }
  for (const bucket of [EU, US]) {
    assert.equal(f.metadata(bucket, sibling).firebaseStorageDownloadTokens, "old-token");
    assert.equal(f.metadata(bucket, pdf).firebaseStorageDownloadTokens, "old-token");
  }
});
test("stesso path ha token comune EU/USA; path diversi restano distinti", async () => {
  const f = fixture();
  await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" });
  assert.equal(f.metadata(EU, path).firebaseStorageDownloadTokens, f.metadata(US, path).firebaseStorageDownloadTokens);
  assert.notEqual(f.metadata(EU, path).firebaseStorageDownloadTokens, f.metadata(EU, thumb).firebaseStorageDownloadTokens);
});
test("retry con stesso seed è idempotente e una nuova segnalazione ruota ancora", async () => {
  const f = fixture();
  await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" });
  const first = f.metadata(EU, path).firebaseStorageDownloadTokens;
  await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" });
  assert.equal(f.metadata(EU, path).firebaseStorageDownloadTokens, first);
  await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-b" });
  assert.notEqual(f.metadata(EU, path).firebaseStorageDownloadTokens, first);
});
test("revoca parziale: tenta anche l'altro bucket, fallisce esplicitamente e retry completa", async () => {
  const f = fixture({ failedWrites: [EU] });
  await expectIncomplete(f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" }));
  assert.notEqual(f.metadata(US, path).firebaseStorageDownloadTokens, "old-token");
  f.faults.failedWrites.clear();
  await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" });
  assert.equal(f.metadata(EU, path).firebaseStorageDownloadTokens, f.metadata(US, path).firebaseStorageDownloadTokens);
});
test("errore di enumerazione su EU non impedisce di revocare USA ma non viene nascosto", async () => {
  const f = fixture({ failedLists: [EU] });
  await expectIncomplete(f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" }));
  assert.notEqual(f.metadata(US, path).firebaseStorageDownloadTokens, "old-token");
});
test("revoca tollera una replica assente e include tutte le varianti enumerate", async () => {
  const f = fixture(); f.contents.get(US).delete(path); f.contents.get(US).delete(thumb);
  for (const name of ["original.jpg", "poster.jpg", "clip.mp4"]) f.put(EU, `${prefix}${name}`);
  await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" });
  for (const [objectPath, value] of f.contents.get(EU)) if (objectPath.startsWith(prefix)) assert.notEqual(value.metadata.firebaseStorageDownloadTokens, "old-token");
});
test("delete rimuove entrambe le copie e preserva sibling e PDF con retention separata", async () => {
  const f = fixture();
  assert.deepEqual((await f.helper.deleteMedia(context)).bucketNames, [EU, US]);
  for (const bucket of [EU, US]) {
    assert.equal(f.contents.get(bucket).has(path), false); assert.equal(f.contents.get(bucket).has(thumb), false);
    assert.equal(f.contents.get(bucket).has(sibling), true); assert.equal(f.contents.get(bucket).has(pdf), true);
  }
});
test("delete è idempotente quando entrambe le repliche sono già assenti", async () => {
  const f = fixture();
  await f.helper.deleteMedia(context);
  await f.helper.deleteMedia(context);
  assert.ok(f.contents.get(EU).has(pdf)); assert.ok(f.contents.get(US).has(pdf));
});
test("delete parziale tenta tutti i bucket e retry elimina la copia residua", async () => {
  const f = fixture({ failedDeletes: [EU] });
  await expectIncomplete(f.helper.deleteMedia(context));
  assert.equal(f.contents.get(EU).has(path), true); assert.equal(f.contents.get(US).has(path), false);
  f.faults.failedDeletes.clear(); await f.helper.deleteMedia(context);
  assert.equal(f.contents.get(EU).has(path), false);
});
test("report → sync USA/EU: token del nuovo URL EU resta valido dopo la copia metadata", async () => {
  const f = fixture();
  const result = await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" });
  const rewritten = rewriteMediaDownloadUrl(url(EU), { ...result, prefix });
  // Ordinary migration copies USA metadata to EU, without altering an URL
  // that already points at EU. It must not invalidate the post-report URL.
  f.contents.get(EU).set(path, clone(f.contents.get(US).get(path)));
  assert.equal(new URL(rewritten).searchParams.get("token"), f.metadata(EU, path).firebaseStorageDownloadTokens);
  assert.notEqual(rewritten, url(EU));
});
test("URL fidati di entrambe le repliche vengono riscritti per il path corretto", async () => {
  const f = fixture();
  const result = await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" });
  for (const bucket of [EU, US]) {
    const before = new URL(url(bucket));
    const after = new URL(rewriteMediaDownloadUrl(before.href, { ...result, prefix }));
    assert.equal(after.origin, before.origin); assert.equal(after.pathname, before.pathname);
    assert.equal(after.searchParams.get("alt"), "media");
    assert.equal(after.searchParams.get("token"), f.metadata(bucket, path).firebaseStorageDownloadTokens);
  }
});
for (const [label, untrusted] of [
  ["bucket estraneo", url("unrelated-bucket")], ["media fratello", url(EU, sibling)],
  ["PDF", url(EU, pdf)], ["host simile", url(EU).replace("googleapis.com", "googleapis.com.evil.invalid")],
  ["altro host", url(EU).replace("firebasestorage.googleapis.com", "example.invalid")],
  ["URL non valido", "not an URL"], ["assenza URL", null],
]) test(`non riscrive ${label}`, async () => {
  const f = fixture(); const result = await f.helper.revokeMedia({ ...context, rotationSeed: "report-generation-a" });
  assert.equal(rewriteMediaDownloadUrl(untrusted, { ...result, prefix }), untrusted);
});

test("sync: deriva soltanto il marker del media esatto, mai quello di PDF o cover", () => {
  assert.equal(mediaLifecyclePath(path), "stakes/stake-a/galleries/gallery-a/mediaLifecycle/media-a");
  for (const name of [pdf, "public/stakes/stake-a/activities/a/cover.jpg", "protected/stakes/stake-a/galleries/gallery-a/cover.jpg"]) assert.equal(mediaLifecyclePath(name), null);
});
for (const apply of [false, true]) test(`sync: tombstone precedente blocca copia; apply=${apply}`, async () => {
  const calls = [];
  const result = await guardMediaCopy({ name: path, apply, readLifecycle: async () => ({ operation: "delete", status: "pending" }),
    copy: async () => { calls.push("copy"); }, removeCopies: async name => { assert.equal(name, path); calls.push("remove"); } });
  assert.equal(result.skipped, true); assert.deepEqual(calls, apply ? ["remove"] : []);
});
test("sync: anche il tombstone complete impedisce di ricreare le copie", async () => {
  let copied = false;
  const result = await guardMediaCopy({ name: path, apply: true, readLifecycle: async () => ({ operation: "delete", status: "complete" }),
    copy: async () => { copied = true; }, removeCopies: async () => {} });
  assert.equal(copied, false); assert.equal(result.skipped, true);
});
for (const apply of [false, true]) test(`sync: delete sopraggiunto durante copy ripulisce soltanto in apply=${apply}`, async () => {
  let reads = 0, copied = false, removed = false;
  const result = await guardMediaCopy({ name: path, apply, readLifecycle: async () => ++reads === 1 ? null : { operation: "delete", status: "pending" },
    copy: async () => { copied = true; return "copy-result"; }, removeCopies: async () => { removed = true; } });
  assert.equal(reads, 2); assert.equal(copied, true); assert.equal(removed, apply); assert.equal(result.skipped, true);
});
for (const failureRead of [1, 2]) test(`sync: lettura marker fallita ${failureRead} non viene confusa con marker assente`, async () => {
  let reads = 0, copies = 0;
  await assert.rejects(guardMediaCopy({ name: path, apply: true,
    readLifecycle: async () => { if (++reads === failureRead) throw new Error("synthetic-read-failure"); return null; },
    copy: async () => { copies++; }, removeCopies: async () => { throw new Error("must-not-remove"); } }), /synthetic-read-failure/);
  assert.equal(copies, failureRead === 1 ? 0 : 1);
});
test("sync: hide non è delete, preserva copia e risultato", async () => {
  const result = await guardMediaCopy({ name: path, apply: true, readLifecycle: async () => ({ operation: "hide", status: "complete" }),
    copy: async () => "expected-result", removeCopies: async () => { throw new Error("must-not-remove"); } });
  assert.equal(result.skipped, false); assert.equal(result.result, "expected-result");
});
test("sync: PDF retention separata non legge marker né cancella copie", async () => {
  const result = await guardMediaCopy({ name: pdf, apply: true, readLifecycle: async () => { throw new Error("must-not-read"); },
    copy: async () => "retained-pdf", removeCopies: async () => { throw new Error("must-not-remove"); } });
  assert.equal(result.result, "retained-pdf"); assert.equal(result.skipped, false);
});
test("sync: errore copia non diventa successo o skipped", async () => {
  await assert.rejects(guardMediaCopy({ name: path, apply: true, readLifecycle: async () => null,
    copy: async () => { throw new Error("synthetic-copy-failure"); }, removeCopies: async () => {} }), /synthetic-copy-failure/);
});
test("revoca vecchia ritardata oltre nuova generazione non sovrascrive il token più recente", async () => {
  const f = fixture(); let entered, release, delayed = false, current = "a";
  const started = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  f.faults.beforeWrite = async ({ bucket, objectPath }) => {
    if (bucket === EU && objectPath === path && !delayed) { delayed = true; entered(); await barrier; }
  };
  const stale = f.helper.revokeMedia({ ...context, rotationSeed: "generation-a", isCurrent: async () => current === "a" });
  // Attach the rejection assertion before the deliberately delayed request can
  // settle; it must report partial failure rather than become an unhandled one.
  const rejected = expectIncomplete(stale);
  await started; current = "b";
  try {
    await f.helper.revokeMedia({ ...context, rotationSeed: "generation-b", isCurrent: async () => current === "b" });
  } finally { release(); }
  const fresh = f.metadata(EU, path).firebaseStorageDownloadTokens;
  await rejected;
  assert.equal(f.metadata(EU, path).firebaseStorageDownloadTokens, fresh);
  assert.equal(f.metadata(US, path).firebaseStorageDownloadTokens, fresh);
});
test("worker già superato prima della scrittura non cambia metadata", async () => {
  const f = fixture();
  await expectIncomplete(f.helper.revokeMedia({ ...context, rotationSeed: "obsolete", isCurrent: async () => false }));
  for (const bucket of [EU, US]) assert.equal(f.metadata(bucket, path).firebaseStorageDownloadTokens, "old-token");
});
test("sync iniziato prima di hide riconcilia la revoca dopo avere copiato vecchi metadata", async () => {
  const f = fixture(); let state = null, reconciled = false;
  const oldMetadata = clone(f.contents.get(US).get(path));
  const result = await guardMediaCopy({ name: path, apply: true, readLifecycle: async () => state,
    copy: async () => {
      state = { operation: "hide", status: "complete", rotationSeed: "latest-hide" };
      await f.helper.revokeMedia({ ...context, rotationSeed: state.rotationSeed });
      // A GCS rewrite that was already in flight now completes with metadata
      // captured before the report, overwriting the otherwise finished revoke.
      f.contents.get(EU).set(path, clone(oldMetadata));
    },
    reconcileHide: async (name, markerPath) => {
      assert.equal(name, path); assert.equal(markerPath, mediaLifecyclePath(path)); reconciled = true;
      await f.helper.revokeMedia({ ...context, rotationSeed: state.rotationSeed });
    }, removeCopies: async () => { throw new Error("hide-must-not-delete"); } });
  assert.equal(result.skipped, false); assert.equal(reconciled, true);
  assert.notEqual(f.metadata(EU, path).firebaseStorageDownloadTokens, "old-token");
  assert.equal(f.metadata(EU, path).firebaseStorageDownloadTokens, f.metadata(US, path).firebaseStorageDownloadTokens);
});
test("sync dry-run non esegue la riconciliazione metadata che può scrivere", async () => {
  const result = await guardMediaCopy({ name: path, apply: false, readLifecycle: async () => ({ operation: "hide", rotationSeed: "latest" }),
    copy: async () => "dry-plan", reconcileHide: async () => { throw new Error("dry-run-must-not-write"); }, removeCopies: async () => { throw new Error("dry-run-must-not-delete"); } });
  assert.equal(result.result, "dry-plan");
});
test("sync fallisce se non riesce a riconciliare hide dopo copy", async () => {
  await assert.rejects(guardMediaCopy({ name: path, apply: true, readLifecycle: async () => ({ operation: "hide", rotationSeed: "latest" }),
    copy: async () => "copied", reconcileHide: async () => { throw new Error("synthetic-reconcile-failure"); }, removeCopies: async () => {} }), /synthetic-reconcile-failure/);
});
for (const operation of ["hide", "delete"]) test(`sync: risposta persa dopo scrittura compensa ${operation} prima di terminare`, async () => {
  let state = null; const calls = [], failure = new Error("synthetic-response-lost-after-write");
  const result = guardMediaCopy({ name: path, apply: true, readLifecycle: async () => state,
    copy: async () => { calls.push("write-applied"); state = { operation, status: "pending", rotationSeed: "latest" }; throw failure; },
    removeCopies: async () => { calls.push("delete"); }, reconcileHide: async () => { calls.push("hide"); },
  });
  if (operation === "hide") await assert.rejects(result, error => error === failure);
  else assert.equal((await result).skipped, true, "delete already compensated must stop this copy");
  assert.deepEqual(calls, ["write-applied", operation]);
});
test("sync: callback di ogni tentativo impedisce una seconda mutazione dopo delete", async () => {
  let state = null, mutations = 0, removed = 0;
  const result = await guardMediaCopy({ name: path, apply: true, readLifecycle: async () => state,
    copy: async beforeAttempt => {
      await beforeAttempt(); mutations++;
      state = { operation: "delete", status: "pending" };
      await beforeAttempt(); mutations++;
      return "must-not-complete";
    }, removeCopies: async () => { removed++; } });
  assert.equal(mutations, 1); assert.equal(removed, 1); assert.equal(result.skipped, true);
});
test("sync: callback prima del tentativo blocca la mutazione se la lettura marker fallisce", async () => {
  let reads = 0, mutations = 0;
  await assert.rejects(guardMediaCopy({ name: path, apply: true,
    readLifecycle: async () => { if (++reads === 2) throw new Error("synthetic-pre-attempt-read-failure"); return null; },
    copy: async beforeAttempt => { await beforeAttempt(); mutations++; }, removeCopies: async () => {},
  }), /synthetic-pre-attempt-read-failure/);
  assert.equal(mutations, 0);
});
