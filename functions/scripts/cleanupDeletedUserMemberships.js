#!/usr/bin/env node
// Membership-only cleanup after an assistance request: Auth -> profile ->
// dry-run -> reviewed counts -> explicit apply. Never deletes other user data.

function argumentError(code = "invalid_arguments") {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const out = { uid: null, project: null, apply: false, expectedMemberships: undefined };
  const seen = new Set();
  const values = { "--uid": "uid", "--project": "project", "--expect-memberships": "expectedMemberships" };
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (seen.has(option)) throw argumentError();
    seen.add(option);
    if (option === "--apply") out.apply = true;
    else if (values[option]) {
      const value = argv[++index];
      if (typeof value !== "string" || !value || value.startsWith("--")) throw argumentError();
      out[values[option]] = value;
    } else throw argumentError();
  }
  if (!out.uid || !out.project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(out.project)) throw argumentError();
  if (!out.uid.trim() || out.uid.length > 128 || out.uid.includes("/")) throw argumentError("invalid_uid");
  if (out.expectedMemberships !== undefined) {
    if (!/^(0|[1-9]\d*)$/u.test(out.expectedMemberships)) throw argumentError();
    out.expectedMemberships = Number(out.expectedMemberships);
    if (!Number.isSafeInteger(out.expectedMemberships)) throw argumentError();
  }
  if (out.apply && out.expectedMemberships === undefined) throw argumentError("expected_memberships_required");
  return out;
}

function validateEnvironment(project, env) {
  const firestore = env.FIRESTORE_EMULATOR_HOST;
  const auth = env.FIREBASE_AUTH_EMULATOR_HOST;
  const local = (host) => typeof host === "string" && /^(127\.0\.0\.1|localhost):\d+$/u.test(host)
    && Number(host.split(":")[1]) > 0 && Number(host.split(":")[1]) <= 65535;
  if (project.startsWith("demo-")) {
    if (!local(firestore) || !local(auth)) throw argumentError("invalid_environment");
    return true;
  }
  if (firestore !== undefined || auth !== undefined) throw argumentError("invalid_environment");
  return false;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const emulator = validateEnvironment(args.project, env);
  // Resolve credentials only after validating both emulator hosts and project.
  const { initializeApp, applicationDefault, deleteApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { getAuth } = require("firebase-admin/auth");
  const { cleanupDeletedUserMemberships } = require("../lib/stakeMembershipCleanup");
  const app = initializeApp({ projectId: args.project, ...(emulator ? {} : { credential: applicationDefault() }) });
  try {
    const result = await cleanupDeletedUserMemberships({
      db: getFirestore(app), auth: getAuth(app), uid: args.uid,
      dryRun: !args.apply, expectedMemberships: args.expectedMemberships,
    });
    console.log(JSON.stringify({ project: args.project, ...result }));
    return result;
  } finally {
    await deleteApp(app);
  }
}

const GUARD_CODES = new Set([
  "invalid_arguments", "invalid_environment", "invalid_uid", "account_exists", "profile_exists",
  "expected_memberships_required", "membership_count_changed",
]);
if (require.main === module) {
  main().catch((error) => {
    // SDK error messages can contain document paths, UIDs or personal data.
    console.error(JSON.stringify({ error: GUARD_CODES.has(error?.code) ? error.code : "cleanup_failed" }));
    process.exitCode = GUARD_CODES.has(error?.code) ? 2 : 1;
  });
}

module.exports = { parseArgs, validateEnvironment, main };
