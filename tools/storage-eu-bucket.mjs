#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { approvedEuTarget, assertRealCloudEnvironment, runEuBucketAction, StorageEuError } from "./lib/storageEuSetup.mjs";

export function parseEuArguments(argv, { deploy = false } = {}) {
  let parsed;
  try { parsed = parseArgs({ args: argv, allowPositionals: true, tokens: true, strict: true, options: { project: { type: "string" }, bucket: { type: "string" }, account: { type: "string" }, apply: { type: "boolean", default: false } } }); }
  catch { throw new StorageEuError("ARGUMENTS_INVALID"); }
  const seen = new Set();
  for (const token of parsed.tokens) if (token.kind === "option") {
    if (seen.has(token.name)) throw new StorageEuError("ARGUMENTS_INVALID");
    seen.add(token.name);
  }
  if (parsed.positionals.length !== (deploy ? 0 : 1)) throw new StorageEuError("ARGUMENTS_INVALID");
  const action = deploy ? "deploy-rules" : parsed.positionals[0];
  if (!deploy && (!["inspect", "create", "link"].includes(action) || (action === "inspect" && parsed.values.apply))) throw new StorageEuError("ARGUMENTS_INVALID");
  if (parsed.values.account !== undefined && !parsed.values.account.trim()) throw new StorageEuError("ARGUMENTS_INVALID");
  const target = approvedEuTarget(parsed.values.project, parsed.values.bucket);
  return { ...parsed.values, target, action };
}

// Explicit Firebase CLI login only. No ADC fallback, gcloud, token argument,
// external API origin override, or credential material in output.
export async function firebaseCliTransport({ target, account, cwd = process.cwd() }) {
  assertRealCloudEnvironment(process.env);
  const require = createRequire(import.meta.url);
  let root;
  try { root = path.join(execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), "firebase-tools", "lib"); }
  catch { throw new StorageEuError("FIREBASE_CLI_UNAVAILABLE"); }
  let apiv2;
  try {
    const logger = require(path.join(root, "logger.js")).logger;
    logger.debug = () => undefined;
    const auth = require(path.join(root, "auth.js"));
    const selected = auth.selectAccount(account, cwd);
    if (!selected?.user || !selected?.tokens?.refresh_token) throw new Error("CLI_LOGIN_REQUIRED");
    const { requireAuth } = require(path.join(root, "requireAuth.js"));
    apiv2 = require(path.join(root, "apiv2.js"));
    await requireAuth({ project: target.project, user: selected.user, tokens: selected.tokens, nonInteractive: true }, true);
  } catch { throw new StorageEuError("FIREBASE_CLI_LOGIN_REQUIRED"); }
  const origins = new Set(["https://storage.googleapis.com", "https://firebasestorage.googleapis.com", "https://firebase.googleapis.com", "https://firebaserules.googleapis.com"]);
  return async (method, url, body) => {
    if (!origins.has(new URL(url).origin) || !["GET", "POST"].includes(method)) throw new StorageEuError("API_REQUEST_FORBIDDEN");
    let response;
    try {
      const token = await apiv2.getAccessToken();
      response = await fetch(url, {
        method, redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": target.project, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new StorageEuError("API_REQUEST_FAILED", { mayHaveApplied: method !== "GET" }); }
    let result;
    try { result = await response.json(); } catch { result = {}; }
    return { status: response.status, body: result };
  };
}

export async function runBucketCli(argv, { env = process.env, output = console.log, transport = firebaseCliTransport } = {}) {
  const options = parseEuArguments(argv);
  assertRealCloudEnvironment(env);
  const request = await transport(options);
  const result = await runEuBucketAction({ ...options, project: options.target.project, bucket: options.target.bucket, request });
  output(JSON.stringify(result));
  return result;
}

export function printEuFailure(error) {
  // SDK/API response messages can contain identities, URLs and credentials.
  console.error(JSON.stringify({ ok: false, code: error instanceof StorageEuError ? error.code : "UNEXPECTED_FAILURE", ...(error instanceof StorageEuError && error.status !== undefined ? { status: error.status } : {}), ...(error?.mayHaveApplied ? { mayHaveApplied: true } : {}) }));
  process.exitCode = error instanceof StorageEuError && ["ARGUMENTS_INVALID", "TARGET_NOT_APPROVED", "EMULATOR_ENV_FORBIDDEN", "FIREBASE_TOKEN_FORBIDDEN"].includes(error.code) ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runBucketCli(process.argv.slice(2)).catch(printEuFailure);
