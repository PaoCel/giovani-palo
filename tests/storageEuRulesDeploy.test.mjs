import test from "node:test";
import assert from "node:assert/strict";
import { runRulesCli } from "../tools/storage-eu-rules-deploy.mjs";
import { EU_TARGETS } from "../tools/lib/storageEuSetup.mjs";

const target = EU_TARGETS["giovani-palo"];
const argv = ["--project", target.project, "--bucket", target.bucket];
const root = "/synthetic-main";
const rules = "synthetic rules source";
const resource = `projects/123456789/buckets/${target.bucket}`;
const ruleset = id => `projects/${target.project}/rulesets/${id}`;
function fixture(options = {}) {
  const calls = [], output = [], deployments = [];
  let deployed = false, gitReads = 0;
  const readText = filename => filename.endsWith("storage.rules") ? rules : JSON.stringify({ storage: [{ bucket: target.bucket, rules: "storage.rules" }] });
  const request = async (method, url) => {
    calls.push({ method, url });
    assert.equal(method, "GET", "Preflight e verifica leggono soltanto");
    if (url.startsWith("https://firebase.googleapis.com/")) return { status: 200, body: { projectId: target.project, projectNumber: "123456789", state: "ACTIVE" } };
    if (url.startsWith("https://storage.googleapis.com/")) return { status: 200, body: { name: target.bucket, projectNumber: "123456789", location: "EUROPE-WEST1", iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" } } };
    if (url.startsWith("https://firebasestorage.googleapis.com/")) return { status: options.unlinked ? 404 : 200, body: { name: resource } };
    if (url.includes("/releases/firebase.storage/")) return { status: 200, body: { rulesetName: url.endsWith(target.defaultBucket) ? ruleset(deployed && options.defaultChanged ? "default-after" : "default-before") : ruleset("eu-after") } };
    if (url.endsWith("/rulesets/default-before")) return { status: 200, body: { source: { files: [{ name: "storage.rules", content: "previous default rules" }] } } };
    if (url.endsWith("/rulesets/eu-after")) return { status: 200, body: { source: { files: [{ name: "storage.rules", content: options.euMismatch ? "different" : rules }] } } };
    throw new Error("Unexpected synthetic URL");
  };
  const deps = {
    env: {}, cwd: root, readText, output: value => output.push(JSON.parse(value)),
    gitState: () => ({ root, branch: options.branch ?? "main", head: ++gitReads > 1 && options.headChanged ? "new-head" : "main-head", originMain: gitReads > 1 && options.headChanged ? "new-head" : "main-head", status: options.dirty ? " M storage.rules" : "" }),
    transport: async () => request,
    deploy: async value => { deployments.push(value); if (options.deployFailure) throw new Error("synthetic-sensitive-detail"); deployed = true; },
  };
  return { deps, calls, output, deployments };
}

test("dry-run rules confronta sorgenti senza invocare deploy o scrivere cloud", async () => {
  const api = fixture();
  const result = await runRulesCli(argv, api.deps);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.config, "firebase.storage-phase-a.json");
  assert.equal(result.rulesDifferFromDefault, true);
  assert.deepEqual(result.plannedActions, ["deploy-rules-eu-only"]);
  assert.equal(api.deployments.length, 0);
  assert.ok(api.calls.every(call => call.method === "GET"));
});

test("apply esegue soltanto il deploy EU e conferma che la release default non cambia", async () => {
  const api = fixture();
  const result = await runRulesCli([...argv, "--apply"], api.deps);
  assert.equal(api.deployments.length, 1);
  assert.equal(api.deployments[0].target, target);
  assert.equal(api.deployments[0].cwd, root);
  assert.equal(result.defaultRulesUnchanged, true);
  assert.deepEqual(result.changes, ["deployed-rules-eu-only"]);
  assert.ok(api.calls.some(call => call.url.includes("/rulesets/eu-after")));
  assert.ok(api.output.every(value => !JSON.stringify(value).includes(rules)));
});

test("branch, tree e commit devono essere validi prima del deploy", async () => {
  for (const options of [{ branch: "feature" }, { branch: "" }, { dirty: true }, { headChanged: true }, { unlinked: true }]) {
    const api = fixture(options);
    await assert.rejects(runRulesCli([...argv, "--apply"], api.deps));
    assert.equal(api.deployments.length, 0);
  }
});

test("config mista o alterata blocca il deploy prima dell'autenticazione", async () => {
  const api = fixture(); let authenticated = false;
  api.deps.transport = async () => { authenticated = true; throw new Error("must not run"); };
  api.deps.readText = () => JSON.stringify({ storage: [{ bucket: target.bucket, rules: "storage.rules" }], hosting: {} });
  await assert.rejects(runRulesCli([...argv, "--apply"], api.deps), error => error.code === "DEPLOY_CONFIG_INVALID");
  assert.equal(authenticated, false); assert.equal(api.deployments.length, 0);
});

test("mismatch delle rules EU o modifica default dopo deploy restano fallimenti con effetto possibile", async () => {
  for (const [options, code] of [[{ euMismatch: true }, "RULES_SOURCE_MISMATCH"], [{ defaultChanged: true }, "DEFAULT_RULES_CHANGED"], [{ deployFailure: true }, "DEPLOY_COMMAND_FAILED"]]) {
    const api = fixture(options);
    await assert.rejects(runRulesCli([...argv, "--apply"], api.deps), error => error.code === code && error.mayHaveApplied === true && !error.message.includes("synthetic-sensitive-detail"));
    assert.equal(api.deployments.length, 1);
    assert.equal(api.output.length, 0);
  }
});
