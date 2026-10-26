// Phase A is limited to the two approved, additional EU buckets. No object
// operation or default-bucket change is part of this module.
export const EU_TARGETS = Object.freeze({
  "giovani-palo": Object.freeze({ project: "giovani-palo", bucket: "giovani-palo-eu", defaultBucket: "giovani-palo.firebasestorage.app", config: "firebase.storage-phase-a.json" }),
  "giovani-palo-staging": Object.freeze({ project: "giovani-palo-staging", bucket: "giovani-palo-staging-eu", defaultBucket: "giovani-palo-staging.firebasestorage.app", config: "firebase.storage-phase-a-staging.json" }),
});

export class StorageEuError extends Error {
  constructor(code, { status, mayHaveApplied = false } = {}) {
    super(code);
    this.code = code;
    if (status !== undefined) this.status = status;
    this.mayHaveApplied = mayHaveApplied;
  }
}

export function approvedEuTarget(project, bucket) {
  if (!Object.hasOwn(EU_TARGETS, project) || EU_TARGETS[project].bucket !== bucket) throw new StorageEuError("TARGET_NOT_APPROVED");
  return EU_TARGETS[project];
}

export function assertRealCloudEnvironment(env) {
  if (Object.entries(env).some(([key, value]) => /EMULATOR/i.test(key) && value && value !== "false" && value !== "0")) throw new StorageEuError("EMULATOR_ENV_FORBIDDEN");
  if (env.FIREBASE_TOKEN) throw new StorageEuError("FIREBASE_TOKEN_FORBIDDEN");
}

export function validateEuBucket(bucket, target, projectNumber) {
  if (bucket.name !== target.bucket) throw new StorageEuError("BUCKET_NAME_MISMATCH");
  if (String(bucket.projectNumber) !== projectNumber) throw new StorageEuError("BUCKET_OWNER_MISMATCH");
  if (String(bucket.location).toUpperCase() !== "EUROPE-WEST1") throw new StorageEuError("BUCKET_REGION_MISMATCH");
  if (bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true) throw new StorageEuError("BUCKET_UNIFORM_ACCESS_REQUIRED");
  if (bucket.iamConfiguration?.publicAccessPrevention !== "enforced") throw new StorageEuError("BUCKET_PUBLIC_PREVENTION_REQUIRED");
}

const resourceName = (target, number) => `projects/${number}/buckets/${target.bucket}`;
const gcsUrl = target => `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(target.bucket)}?fields=name,projectNumber,location,iamConfiguration`;
const linkedUrl = (target, number) => `https://firebasestorage.googleapis.com/v1beta/${resourceName(target, number)}`;

// request returns { status, body }; only a literal 404 is absence. API errors
// are never interpreted as an empty bucket or printed with their response body.
export async function inspectEuBucket({ target, request }) {
  approvedEuTarget(target.project, target.bucket);
  const project = await request("GET", `https://firebase.googleapis.com/v1beta1/projects/${target.project}?fields=projectId,projectNumber,state`);
  if (project.status !== 200) throw new StorageEuError("PROJECT_READ_FAILED", { status: project.status });
  if (project.body?.projectId !== target.project || !/^[0-9]+$/.test(String(project.body?.projectNumber || "")) || project.body.state !== "ACTIVE") throw new StorageEuError("PROJECT_IDENTITY_MISMATCH");
  const projectNumber = String(project.body.projectNumber);
  const bucket = await request("GET", gcsUrl(target));
  if (bucket.status === 404) return { target, projectNumber, exists: false, linked: false };
  if (bucket.status !== 200) throw new StorageEuError("BUCKET_READ_FAILED", { status: bucket.status });
  validateEuBucket(bucket.body, target, projectNumber);
  const link = await request("GET", linkedUrl(target, projectNumber));
  if (![200, 404].includes(link.status)) throw new StorageEuError("FIREBASE_LINK_READ_FAILED", { status: link.status });
  if (link.status === 200 && link.body?.name !== resourceName(target, projectNumber)) throw new StorageEuError("FIREBASE_LINK_MISMATCH");
  return { target, projectNumber, exists: true, linked: link.status === 200 };
}

export function summarizeEuState(state, action, apply, changes = []) {
  return {
    project: state.target.project, bucket: state.target.bucket, action,
    mode: apply ? "apply" : "dry-run", exists: state.exists, linked: state.linked,
    ownershipVerified: state.exists,
    region: state.exists ? "EUROPE-WEST1" : null,
    uniformBucketLevelAccess: state.exists ? true : null,
    publicAccessPrevention: state.exists ? "enforced" : null,
    changes,
  };
}

async function applyRequest(request, url, body) {
  try { return await request("POST", url, body); }
  catch (error) {
    if (error instanceof StorageEuError) { error.mayHaveApplied = true; throw error; }
    throw new StorageEuError("API_REQUEST_FAILED", { mayHaveApplied: true });
  }
}

export async function runEuBucketAction({ action, project, bucket, apply = false, request }) {
  if (!["inspect", "create", "link"].includes(action) || typeof apply !== "boolean" || (action === "inspect" && apply)) throw new StorageEuError("ARGUMENTS_INVALID");
  const target = approvedEuTarget(project, bucket);
  let state = await inspectEuBucket({ target, request });
  if (action === "inspect") return summarizeEuState(state, action, false);
  if (action === "create") {
    if (state.exists) return summarizeEuState(state, action, apply);
    if (!apply) return { ...summarizeEuState(state, action, false), plannedActions: ["create"] };
    const created = await applyRequest(request, `https://storage.googleapis.com/storage/v1/b?project=${target.project}`, {
      name: target.bucket, location: "EUROPE-WEST1", storageClass: "STANDARD",
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: "enforced" },
    });
    // A concurrent create may return 409; only a fresh ownership/configuration
    // check can turn that result into an idempotent success.
    if (![200, 201, 409].includes(created.status)) throw new StorageEuError("BUCKET_CREATE_FAILED", { status: created.status, mayHaveApplied: created.status >= 500 });
    try { state = await inspectEuBucket({ target, request }); }
    catch (error) {
      if (error instanceof StorageEuError) { error.mayHaveApplied = true; throw error; }
      throw new StorageEuError("BUCKET_CREATE_VERIFY_FAILED", { mayHaveApplied: true });
    }
    if (!state.exists) throw new StorageEuError("BUCKET_CREATE_NOT_CONFIRMED", { mayHaveApplied: true });
    return summarizeEuState(state, action, true, created.status === 409 ? [] : ["created"]);
  }
  if (!state.exists) throw new StorageEuError("BUCKET_MISSING");
  if (state.linked) return summarizeEuState(state, action, apply);
  if (!apply) return { ...summarizeEuState(state, action, false), plannedActions: ["link"] };
  const linked = await applyRequest(request, `${linkedUrl(target, state.projectNumber)}:addFirebase`);
  if (![200, 409].includes(linked.status)) throw new StorageEuError("FIREBASE_LINK_FAILED", { status: linked.status, mayHaveApplied: linked.status >= 500 });
  try { state = await inspectEuBucket({ target, request }); }
  catch (error) {
    if (error instanceof StorageEuError) { error.mayHaveApplied = true; throw error; }
    throw new StorageEuError("FIREBASE_LINK_VERIFY_FAILED", { mayHaveApplied: true });
  }
  if (!state.linked) throw new StorageEuError("FIREBASE_LINK_NOT_CONFIRMED", { mayHaveApplied: true });
  return summarizeEuState(state, action, true, linked.status === 409 ? [] : ["linked"]);
}

export function validatePhaseAConfig(config, target) {
  if (!config || Object.keys(config).join(",") !== "storage" || !Array.isArray(config.storage) || config.storage.length !== 1) throw new StorageEuError("DEPLOY_CONFIG_INVALID");
  const storage = config.storage[0];
  if (!storage || Object.keys(storage).sort().join(",") !== "bucket,rules" || storage.bucket !== target.bucket || storage.rules !== "storage.rules") throw new StorageEuError("DEPLOY_CONFIG_INVALID");
}

export function assertCleanMain({ branch, head, originMain, status }) {
  if (branch !== "main" || !head || head !== originMain || status !== "") throw new StorageEuError("CLEAN_MAIN_REQUIRED");
}

export async function readStorageRelease({ target, bucket = target.bucket, request }) {
  if (![target.bucket, target.defaultBucket].includes(bucket)) throw new StorageEuError("TARGET_NOT_APPROVED");
  const response = await request("GET", `https://firebaserules.googleapis.com/v1/projects/${target.project}/releases/firebase.storage/${bucket}`);
  if (response.status === 404) return null;
  if (response.status !== 200 || typeof response.body?.rulesetName !== "string") throw new StorageEuError("RULES_RELEASE_READ_FAILED", { status: response.status });
  const prefix = `projects/${target.project}/rulesets/`;
  if (!response.body.rulesetName.startsWith(prefix) || !/^[a-zA-Z0-9-]+$/.test(response.body.rulesetName.slice(prefix.length))) throw new StorageEuError("RULESET_IDENTITY_MISMATCH");
  return response.body.rulesetName;
}

export async function verifyStorageRules({ target, request, expectedSource }) {
  const ruleset = await readStorageRelease({ target, request });
  if (!ruleset) throw new StorageEuError("RULES_RELEASE_MISSING");
  const response = await request("GET", `https://firebaserules.googleapis.com/v1/${ruleset}`);
  const files = response.body?.source?.files;
  if (response.status !== 200 || !Array.isArray(files) || files.length !== 1 || files[0]?.content !== expectedSource) throw new StorageEuError("RULES_SOURCE_MISMATCH");
  return ruleset;
}

export async function storageReleaseSource({ target, bucket = target.bucket, request }) {
  const ruleset = await readStorageRelease({ target, bucket, request });
  if (!ruleset) return null;
  const response = await request("GET", `https://firebaserules.googleapis.com/v1/${ruleset}`);
  const files = response.body?.source?.files;
  if (response.status !== 200 || !Array.isArray(files) || files.length !== 1 || typeof files[0]?.content !== "string") throw new StorageEuError("RULES_SOURCE_READ_FAILED", { status: response.status });
  return { ruleset, content: files[0].content };
}
