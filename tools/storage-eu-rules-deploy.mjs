#!/usr/bin/env node
// Separate configuration plus an explicit bucket prevent default-bucket
// fallback. Deploy from clean, pushed main only, after fresh human approval.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { firebaseCliTransport, parseEuArguments, printEuFailure } from "./storage-eu-bucket.mjs";
import { assertCleanMain, assertRealCloudEnvironment, inspectEuBucket, readStorageRelease, storageReleaseSource, summarizeEuState, validatePhaseAConfig, verifyStorageRules, StorageEuError } from "./lib/storageEuSetup.mjs";

const runFile = promisify(execFile);
const digest = text => createHash("sha256").update(text).digest("hex");

export function readGitState(cwd) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return { root: git("rev-parse", "--show-toplevel"), branch: git("branch", "--show-current"), head: git("rev-parse", "HEAD"), originMain: git("rev-parse", "origin/main"), status: git("status", "--porcelain", "--untracked-files=normal") };
  } catch { throw new StorageEuError("GIT_STATE_UNVERIFIED"); }
}

export async function deployEuRules({ target, account, cwd }) {
  const args = ["deploy", "--project", target.project, "--config", target.config, "--only", "storage", "--non-interactive"];
  if (account) args.push("--account", account);
  try {
    // Capture rather than forwarding arbitrary CLI output or auth diagnostics.
    await runFile("firebase", args, { cwd, timeout: 180000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
  } catch { throw new StorageEuError("DEPLOY_COMMAND_FAILED", { mayHaveApplied: true }); }
}

export async function runRulesCli(argv, {
  env = process.env, cwd = process.cwd(), output = console.log,
  gitState = readGitState,
  readText = filename => fs.readFileSync(filename, "utf8"),
  transport = firebaseCliTransport, deploy = deployEuRules,
} = {}) {
  const options = parseEuArguments(argv, { deploy: true });
  assertRealCloudEnvironment(env);
  const state = gitState(cwd);
  assertCleanMain(state);
  const root = state.root;
  let source;
  try {
    const config = JSON.parse(readText(path.join(root, options.target.config)));
    validatePhaseAConfig(config, options.target);
    source = readText(path.join(root, "storage.rules"));
    if (!source.trim()) throw new StorageEuError("RULES_SOURCE_EMPTY");
  } catch (error) {
    if (error instanceof StorageEuError) throw error;
    throw new StorageEuError("DEPLOY_FILES_UNREADABLE");
  }
  const request = await transport({ ...options, cwd: root });
  const bucket = await inspectEuBucket({ target: options.target, request });
  if (!bucket.exists || !bucket.linked) throw new StorageEuError("LINKED_EU_BUCKET_REQUIRED");
  const originalDefault = await storageReleaseSource({ target: options.target, bucket: options.target.defaultBucket, request });
  if (!originalDefault) throw new StorageEuError("DEFAULT_RULES_RELEASE_MISSING");
  const result = {
    ...summarizeEuState(bucket, "deploy-rules", options.apply),
    commit: state.head, config: options.target.config,
    sourceRulesSha256: digest(source), defaultRulesSha256: digest(originalDefault.content),
    rulesDifferFromDefault: source !== originalDefault.content,
  };
  if (!options.apply) {
    result.plannedActions = ["deploy-rules-eu-only"];
    output(JSON.stringify(result));
    return result;
  }
  // All preflight reads finish before the production mutation. Recheck local
  // source and git state immediately before invoking the CLI.
  const current = gitState(root);
  assertCleanMain(current);
  if (current.head !== state.head || readText(path.join(root, "storage.rules")) !== source) throw new StorageEuError("DEPLOY_SOURCE_CHANGED");
  validatePhaseAConfig(JSON.parse(readText(path.join(root, options.target.config))), options.target);
  try { await deploy({ target: options.target, account: options.account, cwd: root }); }
  catch (error) {
    if (error instanceof StorageEuError) error.mayHaveApplied = true;
    else throw new StorageEuError("DEPLOY_COMMAND_FAILED", { mayHaveApplied: true });
    throw error;
  }
  try {
    await verifyStorageRules({ target: options.target, request, expectedSource: source });
    const defaultAfter = await readStorageRelease({ target: options.target, bucket: options.target.defaultBucket, request });
    if (defaultAfter !== originalDefault.ruleset) throw new StorageEuError("DEFAULT_RULES_CHANGED");
    const after = await inspectEuBucket({ target: options.target, request });
    if (!after.exists || !after.linked) throw new StorageEuError("EU_BUCKET_VERIFY_FAILED");
  } catch (error) {
    if (error instanceof StorageEuError) error.mayHaveApplied = true;
    else throw new StorageEuError("DEPLOY_VERIFY_FAILED", { mayHaveApplied: true });
    throw error;
  }
  result.changes = ["deployed-rules-eu-only"];
  result.defaultRulesUnchanged = true;
  output(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runRulesCli(process.argv.slice(2)).catch(printEuFailure);
