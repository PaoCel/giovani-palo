import test from "node:test";
import assert from "node:assert/strict";
import { EU_TARGETS, approvedEuTarget, assertRealCloudEnvironment, validateEuBucket,
  inspectEuBucket, runEuBucketAction, validatePhaseAConfig, assertCleanMain,
  readStorageRelease, verifyStorageRules } from "../tools/lib/storageEuSetup.mjs";
import { parseEuArguments, runBucketCli } from "../tools/storage-eu-bucket.mjs";

const target = EU_TARGETS["giovani-palo"];
const number = "123456789";
const resource = `projects/${number}/buckets/${target.bucket}`;
const validBucket = () => ({ name: target.bucket, projectNumber: number, location: "EUROPE-WEST1",
  iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" } });
const expectCode = (fn, code) => assert.throws(fn, error => error.code === code);
const rejected = (promise, code) => assert.rejects(promise, error => error.code === code);
function harness({ exists = false, linked = false, bucket = validBucket(), projectStatus = 200, bucketStatus, linkStatus, createStatus = 200 } = {}) {
  const calls = [];
  const request = async (method, url, body) => {
    calls.push({ method, url, body: body === undefined ? undefined : structuredClone(body) });
    if (method === "GET" && url.startsWith("https://firebase.googleapis.com/")) return { status: projectStatus, body: { projectId: target.project, projectNumber: number, state: "ACTIVE" } };
    if (method === "GET" && url.startsWith("https://storage.googleapis.com/")) return { status: bucketStatus ?? (exists ? 200 : 404), body: bucket };
    if (method === "GET" && url.startsWith("https://firebasestorage.googleapis.com/")) return { status: linkStatus ?? (linked ? 200 : 404), body: { name: resource } };
    if (method === "POST" && url.startsWith("https://storage.googleapis.com/")) { exists = true; return { status: createStatus, body: {} }; }
    if (method === "POST" && url.endsWith(":addFirebase")) { linked = true; return { status: 200, body: { name: resource } }; }
    throw new Error("Unexpected synthetic request");
  };
  return { request, calls };
}
const action = (name, request, apply = false) => runEuBucketAction({ action: name, project: target.project, bucket: target.bucket, apply, request });

test("solo le due coppie progetto/bucket UE approvate sono ammesse", () => {
  for (const value of Object.values(EU_TARGETS)) assert.equal(approvedEuTarget(value.project, value.bucket), value);
  for (const pair of [[target.project, target.defaultBucket], ["other-project", target.bucket], ["__proto__", target.bucket], [target.project, EU_TARGETS["giovani-palo-staging"].bucket]]) expectCode(() => approvedEuTarget(...pair), "TARGET_NOT_APPROVED");
});

test("guardie argomenti e ambiente precedono autenticazione o API", async () => {
  const base = ["inspect", "--project", target.project, "--bucket", target.bucket];
  assert.equal(parseEuArguments(base).action, "inspect");
  for (const argv of [[], [...base, "--apply"], [...base, "--project", target.project], [...base, "--account", "one", "--account", "two"], [...base, "--unknown"], [...base, "extra"], ["inspect", "--project", target.project, "--bucket", target.defaultBucket]]) assert.throws(() => parseEuArguments(argv));
  for (const env of [{ FIRESTORE_EMULATOR_HOST: "localhost:8080" }, { FIREBASE_STORAGE_EMULATOR_HOST: "localhost:9199" }, { FIREBASE_TOKEN: "synthetic-do-not-use" }]) {
    let authenticated = false;
    await assert.rejects(runBucketCli(base, { env, transport: () => { authenticated = true; throw new Error("must not authenticate"); }, output: () => {} }));
    assert.equal(authenticated, false);
  }
  assert.doesNotThrow(() => assertRealCloudEnvironment({}));
});

test("create e link sono realmente in sola lettura senza apply", async () => {
  const missing = harness();
  const created = await action("create", missing.request);
  assert.deepEqual(created.plannedActions, ["create"]);
  assert.equal(created.exists, false);
  assert.ok(missing.calls.every(call => call.method === "GET"));
  const present = harness({ exists: true });
  const linked = await action("link", present.request);
  assert.deepEqual(linked.plannedActions, ["link"]);
  assert.ok(present.calls.every(call => call.method === "GET"));
});

test("creazione limita i privilegi al nuovo bucket e verifica regione e proprietario", async () => {
  const api = harness();
  const result = await action("create", api.request, true);
  assert.equal(result.exists, true); assert.equal(result.linked, false);
  assert.deepEqual(result.changes, ["created"]);
  const writes = api.calls.filter(call => call.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, `https://storage.googleapis.com/storage/v1/b?project=${target.project}`);
  assert.deepEqual(writes[0].body, { name: target.bucket, location: "EUROPE-WEST1", storageClass: "STANDARD",
    iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" } });
  assert.ok(api.calls.filter(call => call.method === "GET").length >= 4);
});

test("link usa numero progetto verificato, è separato da create e idempotente", async () => {
  const api = harness({ exists: true });
  const result = await action("link", api.request, true);
  assert.equal(result.linked, true);
  assert.deepEqual(api.calls.filter(call => call.method === "POST").map(call => call.url), [`https://firebasestorage.googleapis.com/v1beta/${resource}:addFirebase`]);
  for (const name of ["create", "link"]) {
    const ready = harness({ exists: true, linked: true });
    assert.deepEqual((await action(name, ready.request, true)).changes, []);
    assert.ok(ready.calls.every(call => call.method === "GET"));
  }
  await rejected(action("link", harness().request, true), "BUCKET_MISSING");
});

for (const [label, mutate, code] of [
  ["nome", value => { value.name = target.defaultBucket; }, "BUCKET_NAME_MISMATCH"],
  ["proprietario", value => { value.projectNumber = "999"; }, "BUCKET_OWNER_MISMATCH"],
  ["regione", value => { value.location = "US-CENTRAL1"; }, "BUCKET_REGION_MISMATCH"],
  ["ACL", value => { value.iamConfiguration.uniformBucketLevelAccess.enabled = false; }, "BUCKET_UNIFORM_ACCESS_REQUIRED"],
  ["pubblico", value => { value.iamConfiguration.publicAccessPrevention = "inherited"; }, "BUCKET_PUBLIC_PREVENTION_REQUIRED"],
]) test(`bucket difforme (${label}) blocca il collegamento senza correggerlo`, async () => {
  const bucket = validBucket(); mutate(bucket);
  expectCode(() => validateEuBucket(bucket, target, number), code);
  const api = harness({ exists: true, bucket });
  await rejected(action("link", api.request, true), code);
  assert.ok(api.calls.every(call => call.method === "GET"));
});

test("403, 500 e risorse non verificabili non diventano assenza del bucket", async () => {
  for (const status of [403, 500]) {
    await rejected(inspectEuBucket({ target, request: harness({ projectStatus: status }).request }), "PROJECT_READ_FAILED");
    await rejected(inspectEuBucket({ target, request: harness({ bucketStatus: status }).request }), "BUCKET_READ_FAILED");
    await rejected(inspectEuBucket({ target, request: harness({ exists: true, linkStatus: status }).request }), "FIREBASE_LINK_READ_FAILED");
  }
  const api = harness({ createStatus: 500 });
  await assert.rejects(action("create", api.request, true), error => error.code === "BUCKET_CREATE_FAILED" && error.mayHaveApplied);
});

test("create concorrente 409 richiede conferma con nuova lettura", async () => {
  const api = harness({ createStatus: 409 });
  const result = await action("create", api.request, true);
  assert.equal(result.exists, true); assert.deepEqual(result.changes, []);
  assert.ok(api.calls.filter(call => call.method === "GET").length >= 4);
});

test("config deploy non può includere default bucket, hosting o altri servizi", () => {
  assert.doesNotThrow(() => validatePhaseAConfig({ storage: [{ bucket: target.bucket, rules: "storage.rules" }] }, target));
  for (const config of [{}, { storage: { rules: "storage.rules" } }, { storage: [{ bucket: target.defaultBucket, rules: "storage.rules" }] }, { storage: [{ bucket: target.bucket, rules: "other.rules" }] }, { storage: [{ bucket: target.bucket, rules: "storage.rules" }], hosting: {} }, { storage: [{ bucket: target.bucket, rules: "storage.rules" }, { bucket: target.defaultBucket, rules: "storage.rules" }] }]) expectCode(() => validatePhaseAConfig(config, target), "DEPLOY_CONFIG_INVALID");
  assert.doesNotThrow(() => assertCleanMain({ branch: "main", head: "abc", originMain: "abc", status: "" }));
  for (const state of [{ branch: "feature", head: "abc", originMain: "abc", status: "" }, { branch: "main", head: "abc", originMain: "old", status: "" }, { branch: "main", head: "abc", originMain: "abc", status: " M storage.rules" }]) expectCode(() => assertCleanMain(state), "CLEAN_MAIN_REQUIRED");
});

test("verifica rules esige la release del progetto e il sorgente identico", async () => {
  const rulesetName = `projects/${target.project}/rulesets/synthetic-rules`;
  const request = async (_method, url) => ({ status: 200, body: url.includes("/releases/") ? { rulesetName } : { source: { files: [{ name: "storage.rules", content: "synthetic rules" }] } } });
  assert.equal(await readStorageRelease({ target, request }), rulesetName);
  assert.equal(await verifyStorageRules({ target, request, expectedSource: "synthetic rules" }), rulesetName);
  await rejected(verifyStorageRules({ target, request, expectedSource: "different" }), "RULES_SOURCE_MISMATCH");
  await rejected(readStorageRelease({ target, request: async () => ({ status: 200, body: { rulesetName: "projects/other/rulesets/synthetic-rules" } }) }), "RULESET_IDENTITY_MISMATCH");
  assert.equal(await readStorageRelease({ target, request: async () => ({ status: 404, body: {} }) }), null);
});

test("verifica fallita dopo create/link conserva l'indicazione di possibile scrittura", async () => {
  for (const name of ["create", "link"]) {
    const api = harness({ exists: name === "link" });
    let mutated = false;
    const request = async (method, url, body) => {
      if (method === "GET" && mutated) return { status: 503, body: {} };
      const result = await api.request(method, url, body);
      if (method === "POST") mutated = true;
      return result;
    };
    await assert.rejects(action(name, request, true), error => error.mayHaveApplied === true);
    assert.equal(api.calls.filter(call => call.method === "POST").length, 1);
  }
});

test("un checkout staccato non è main anche con lo stesso commit", () => {
  expectCode(() => assertCleanMain({ branch: "", head: "abc", originMain: "abc", status: "" }), "CLEAN_MAIN_REQUIRED");
});

test("errore generico nella verifica dopo POST non espone dettagli e segnala l'effetto possibile", async () => {
  for (const name of ["create", "link"]) {
    const api = harness({ exists: name === "link" });
    let mutated = false;
    const request = async (method, url, body) => {
      if (method === "GET" && mutated) throw new Error("synthetic-sensitive-detail");
      const result = await api.request(method, url, body);
      if (method === "POST") mutated = true;
      return result;
    };
    await assert.rejects(action(name, request, true), error => error.mayHaveApplied === true && !error.message.includes("synthetic-sensitive-detail"));
  }
});

test("risposta persa della POST è indeterminata e non induce un secondo invio automatico", async () => {
  for (const name of ["create", "link"]) {
    const api = harness({ exists: name === "link" });
    let posts = 0;
    const request = async (method, url, body) => {
      if (method === "POST") { posts += 1; throw new Error("synthetic-sensitive-detail"); }
      return api.request(method, url, body);
    };
    await assert.rejects(action(name, request, true), error => error.mayHaveApplied === true && !error.message.includes("synthetic-sensitive-detail"));
    assert.equal(posts, 1);
  }
});
