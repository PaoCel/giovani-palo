import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { randomUUID } from "node:crypto";
import { calls, reset, setRead } from "./support/commentServiceFirebase.mjs";

// Exercise the production service with a deterministic SDK transport. Replacing
// import specifiers leaves its promise, ID, context and retry logic unchanged.
async function service() {
  reset();
  const source = await readFile(new URL("../src/services/firestore/galleryCommentsService.ts", import.meta.url), "utf8");
  const mock = new URL("./support/commentServiceFirebase.mjs", import.meta.url).href;
  const timeout = new URL("../src/utils/writeTimeout.ts", import.meta.url).href;
  const code = stripTypeScriptTypes(source)
    .replace('"firebase/firestore"', JSON.stringify(mock))
    .replace('"@/services/firebase/app"', JSON.stringify(mock))
    .replace('"@/utils/writeTimeout"', JSON.stringify(timeout));
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  return (await import(`data:text/javascript;base64,${Buffer.from(`${code}\n// ${randomUUID()}`).toString("base64")}`)).galleryCommentsService;
}
const context = (extra = {}) => ({ uid: "synthetic-author", stakeId: "synthetic-stake", galleryId: "synthetic-gallery", mediaId: "synthetic-photo", ...extra });
const comment = (extra = {}) => ({ ...context(), displayName: "Persona sintetica", body: "Un ricordo sintetico", ...extra });

test("doppio invio con SDK pendente condivide promessa, ID e testo originali", async () => {
  const api = await service();
  const first = api.add(comment());
  const second = api.add(comment({ body: "Un secondo tocco non crea un altro commento" }));
  assert.equal(first, second);
  assert.equal(calls.writes.length, 1);
  assert.equal(api.getSubmission(context()).status, "pending");
  calls.writes[0].resolve();
  const sent = await first;
  assert.equal(sent.body, comment().body);
  assert.equal(api.getSubmission(context()).status, "sent");
});

test("dopo un errore SDK il retry conserva documento e data dell'azione", async () => {
  const api = await service();
  const first = api.add(comment());
  const failed = assert.rejects(first, { code: "unavailable" });
  calls.writes[0].reject(Object.assign(new Error("controlled"), { code: "unavailable" }));
  await failed;
  assert.equal(api.getSubmission(context()).status, "failed");
  const retry = api.add(comment({ body: "Testo corretto prima del retry" }));
  assert.equal(calls.writes[1].path, calls.writes[0].path);
  assert.equal(calls.writes[1].data.createdAt, calls.writes[0].data.createdAt);
  calls.writes[1].resolve();
  assert.equal((await retry).body, "Testo corretto prima del retry");
});

test("offline impedisce creazione e cancellazione prima di chiamare l'SDK", async () => {
  const api = await service();
  navigator.onLine = false;
  await assert.rejects(api.add(comment()), { code: "unavailable" });
  await assert.rejects(api.remove("s", "g", "m", "c"), { code: "unavailable" });
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.deletes.length, 0);
});

test("scartare una richiesta pendente conserva il lock fino all'esito reale", async () => {
  const api = await service();
  const first = api.add(comment());
  api.clearContext(context().uid, context().stakeId);
  assert.equal(api.getSubmission(context()), undefined);
  await assert.rejects(api.add(comment()), { code: "comment-in-flight" });
  api.discardSubmission(context());
  assert.equal(calls.writes.length, 1);
  calls.writes[0].resolve();
  await first;
  assert.equal(api.getSubmission(context()), undefined);
  const next = api.add(comment());
  assert.notEqual(calls.writes[1].path, calls.writes[0].path);
  calls.writes[1].resolve(); await next;
});

test("account, palo e foto distinti non condividono né testo né esito", async () => {
  const api = await service();
  const variants = [comment(), comment({ uid: "other-author" }), comment({ stakeId: "other-stake" }), comment({ mediaId: "other-photo" }), comment({ galleryId: "other-gallery" })];
  const pending = variants.map(value => api.add(value));
  assert.equal(new Set(pending).size, 5);
  assert.equal(calls.writes.length, 5);
  api.clearContext(context().uid, context().stakeId);
  assert.equal(api.getSubmission(variants[0]), undefined);
  assert.equal(api.getSubmission(variants[1]).status, "pending");
  assert.equal(api.getSubmission(variants[2]).status, "pending");
  for (const call of calls.writes) call.resolve();
  await Promise.all(pending);
});

test("la cancellazione ripetuta condivide la richiesta ancora pendente", async () => {
  const api = await service();
  const first = api.remove("s", "g", "m", "c");
  const second = api.remove("s", "g", "m", "c");
  assert.equal(first, second); assert.equal(calls.deletes.length, 1);
  calls.deletes[0].resolve(); await first;
  const next = api.remove("s", "g", "m", "c");
  assert.equal(calls.deletes.length, 2); calls.deletes[1].resolve(); await next;
});

test("lettura fallita resta un errore, mentre un thread vuoto confermato resta vuoto", async () => {
  const api = await service();
  const denied = Object.assign(new Error("controlled"), { code: "permission-denied" });
  setRead([], denied);
  await assert.rejects(api.list("s", "g", "m"), error => error === denied);
  setRead([]); assert.deepEqual(await api.list("s", "g", "m"), []);
  setRead([{ id: "later", data: { uid: "u", body: "Secondo", createdAt: "2027-01-02" } }, { id: "first", data: { uid: "u", body: "Primo", createdAt: "2027-01-01" } }]);
  assert.deepEqual((await api.list("s", "g", "m")).map(item => item.id), ["first", "later"]);
});

test("validazione non produce scritture vuote o sopra il limite", async () => {
  const api = await service();
  for (const body of [" ", "x".repeat(2001)]) await assert.rejects(api.add(comment({ body })));
  assert.equal(calls.writes.length, 0);
});
