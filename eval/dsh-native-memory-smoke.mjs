import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DSH_CLI = resolve(APP_ROOT, "server/node_modules/@deepseek-ai/dsh/lib/bin.js");
const MEMORY_SOURCE = "dsh-native-memory@0.2.0";
const MEMORY_PACKAGE = "dsh-native-memory";

function runCommand(executable, args, { timeoutMs = 60_000, ...options } = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectCommand(new Error(`${executable} timed out after ${timeoutMs}ms:\n${output}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectCommand(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveCommand(output);
      else rejectCommand(new Error(`${executable} exited with ${code}:\n${output}`));
    });
  });
}

function waitForSurface(child) {
  return new Promise((resolveSurface, rejectSurface) => {
    let output = "";
    const timeout = setTimeout(() => {
      rejectSurface(new Error(`DSH Web Profile did not start:\n${output}`));
    }, 30_000);
    const inspect = (chunk) => {
      output += chunk.toString();
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolveSurface(match[1]);
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectSurface(new Error(`DSH Web Profile exited with ${code}:\n${output}`));
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGTERM");
  let timeoutId;
  const timeout = new Promise((resolveTimeout) => {
    timeoutId = setTimeout(resolveTimeout, 5_000, "timeout");
  });
  const result = await Promise.race([exited, timeout]);
  clearTimeout(timeoutId);
  if (result !== "timeout") return;
  child.kill("SIGKILL");
  await exited;
}

async function clientRequest(surface, method, payload) {
  const rpcId = `dsh-native-memory-smoke:${method}`;
  const response = await fetch(new URL(`/api/${method}`, surface), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
  });
  assert.equal(response.ok, true);
  const message = await response.json();
  assert.equal(message.rpcId, rpcId);
  assert.equal(message.result?.ok, true, message.result?.error?.message);
  return message.result.value;
}

assert.equal(existsSync(DSH_CLI), true, "app-pinned DSH CLI is missing; run npm run setup first");

const dshHome = await mkdtemp(join(tmpdir(), "dsh-native-memory-smoke-"));
const workspace = join(dshHome, "workspace");
const profileManifest = join(dshHome, "profiles", "web", "package.json");
const env = {
  ...process.env,
  DEEPSEEK_API_KEY: "",
  DSH_HOME: dshHome,
  DSH_TELEMETRY_DISABLED: "1",
};
let server;

try {
  await mkdir(workspace);
  await runCommand(process.execPath, [
    DSH_CLI,
    "plugin", "--profile", "web", "add", "-w", MEMORY_SOURCE,
    "--save-exact", "--ignore-scripts",
  ], { cwd: APP_ROOT, env });

  const installed = JSON.parse(await readFile(profileManifest, "utf8"));
  assert.equal(installed.dependencies?.[MEMORY_PACKAGE], "0.2.0");
  assert.equal(installed.dsh?.profile?.bundles?.includes(MEMORY_PACKAGE), true);

  const composed = await runCommand(process.execPath, [
    DSH_CLI, "--profile", "web", "--dump-config",
  ], { cwd: APP_ROOT, env });
  assert.match(composed, /patched by dsh-native-memory/);
  assert.match(composed, /openAt: first-search/);
  assert.match(composed, /name: dsh-native-memory/);
  assert.match(composed, /approvalWrites: true/);

  server = spawn(process.execPath, [DSH_CLI, "--profile", "web", "--port", "0"], {
    cwd: APP_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const surface = await waitForSurface(server);
  const html = await fetch(surface).then((response) => {
    assert.equal(response.ok, true);
    return response.text();
  });
  assert.doesNotMatch(html, /plugins\/dsh-native-memory\/client\.js/);
  const created = await clientRequest(surface, "session.create", {
    cwd: workspace,
    sessionId: "dsh-native-memory-smoke",
  });
  assert.equal(created.sessionId, "dsh-native-memory-smoke");

  await stopChild(server);
  server = null;
  await runCommand(process.execPath, [
    DSH_CLI, "plugin", "--profile", "web", "remove", MEMORY_PACKAGE,
  ], { cwd: APP_ROOT, env });
  const uninstalled = JSON.parse(await readFile(profileManifest, "utf8"));
  assert.equal(uninstalled.dependencies?.[MEMORY_PACKAGE], undefined);
  assert.equal(uninstalled.dsh?.profile?.bundles?.includes(MEMORY_PACKAGE), false);

  console.log("[dsh-native-memory-smoke] PASS install/profile composition/Host boot/Session scope/uninstall");
} finally {
  await stopChild(server);
  await rm(dshHome, { recursive: true, force: true });
}
