import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DSH_CLI = resolve(APP_ROOT, "server/node_modules/@deepseek-ai/dsh/lib/bin.js");
const MODEL_INHERITANCE_PACKAGE = resolve(APP_ROOT, "packages/dsh-model-inheritance");
const COMPAT_PACKAGE = "@linxin666/dsh-web-ui-all@0.1.20";
const COMPAT_PACKAGE_NAME = "@linxin666/dsh-web-ui-all";
const RUN_COMPAT_E2E = process.env.DSH_LIVE_COMPAT_TEST === "1";
const ELECTRON_FIXTURE = resolve(APP_ROOT, "eval/fixtures/official-web-electron.cjs");
const requireFromElectron = createRequire(resolve(APP_ROOT, "electron/package.json"));
const ELECTRON_EXECUTABLE = requireFromElectron("electron");

function runCommand(executable, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const { timeoutMs = 45_000, ...spawnOptions } = options;
    const child = spawn(executable, args, { ...spawnOptions, stdio: ["ignore", "pipe", "pipe"] });
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

function waitForOfficialSurface(child) {
  return new Promise((resolveSurface, rejectSurface) => {
    let output = "";
    const timeout = setTimeout(() => rejectSurface(new Error(`official Web Profile did not start:\n${output}`)), 30_000);
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
      rejectSurface(new Error(`official Web Profile exited with ${code}:\n${output}`));
    });
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
}

test("our portable Bundle installs and runs in an unmodified official Web Profile", {
  timeout: 120_000,
  skip: existsSync(DSH_CLI) && existsSync(ELECTRON_EXECUTABLE) && existsSync(resolve(MODEL_INHERITANCE_PACKAGE, "src/index.js"))
    ? false
    : "missing app-pinned DSH CLI, Electron, or model inheritance Bundle",
}, async () => {
  const dshHome = await mkdtemp(join(tmpdir(), "dsh-official-web-plugin-"));
  let server;
  try {
    const env = {
      ...process.env,
      DEEPSEEK_API_KEY: "",
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: "1",
    };
    await runCommand(process.execPath, [
      DSH_CLI,
      "plugin", "--profile", "web", "add", "-w", MODEL_INHERITANCE_PACKAGE,
      "--save-exact", "--ignore-scripts", "--offline",
    ], { cwd: APP_ROOT, env });

    const profileDir = join(dshHome, "profiles", "web");
    const manifest = JSON.parse(await readFile(join(profileDir, "package.json"), "utf8"));
    assert.equal(typeof manifest.dependencies?.["@vibeinging/dsh-model-inheritance"], "string");
    assert.equal(manifest.dsh?.profile?.bundles?.includes("@vibeinging/dsh-model-inheritance"), true);

    server = spawn(process.execPath, [DSH_CLI, "--profile", "web", "--port", "0"], {
      cwd: APP_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const surface = await waitForOfficialSurface(server);
    const html = await fetch(surface).then((response) => {
      assert.equal(response.ok, true);
      return response.text();
    });
    assert.doesNotMatch(html, /\/plugins\/@deepseek-ai\/dsh-model-inheritance\/client\.js\?rev=/);
    assert.doesNotMatch(html, /\/plugins\/@deepseek-ai\/dsh-work-shell\/client\.js\?rev=/);

    const electronEnv = {
      ...process.env,
      DSH_OFFICIAL_WEB_URL: surface,
      DSH_OFFICIAL_WEB_USER_DATA: join(dshHome, "electron-user-data"),
    };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    const browserOutput = await runCommand(ELECTRON_EXECUTABLE, [ELECTRON_FIXTURE], {
      cwd: APP_ROOT,
      env: electronEnv,
    });
    const resultLine = browserOutput.split(/\r?\n/).find((line) => line.startsWith("DSH_OFFICIAL_WEB_RESULT "));
    assert.ok(resultLine, `missing browser result:\n${browserOutput}`);
    const result = JSON.parse(resultLine.slice("DSH_OFFICIAL_WEB_RESULT ".length));
    assert.equal(result.officialWeb, true);
    assert.equal(result.modelInheritanceClientLoaded, false);
    assert.equal(result.productShellLoaded, false);
    assert.equal(result.bodyChildCount > 0, true);

    await stopServer(server);
    server = null;
    await runCommand(process.execPath, [
      DSH_CLI,
      "plugin", "--profile", "web", "remove", "@vibeinging/dsh-model-inheritance",
    ], { cwd: APP_ROOT, env });
    const removedManifest = JSON.parse(await readFile(join(profileDir, "package.json"), "utf8"));
    assert.equal(removedManifest.dsh?.profile?.bundles?.includes("@vibeinging/dsh-model-inheritance"), false);
    assert.equal(Object.hasOwn(removedManifest.dependencies || {}, "@vibeinging/dsh-model-inheritance"), false);

    server = spawn(process.execPath, [DSH_CLI, "--profile", "web", "--port", "0"], {
      cwd: APP_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const restoredSurface = await waitForOfficialSurface(server);
    const restoredHtml = await fetch(restoredSurface).then((response) => {
      assert.equal(response.ok, true);
      return response.text();
    });
    assert.doesNotMatch(restoredHtml, /\/plugins\/@vibeinging\/dsh-model-inheritance\/client\.js\?rev=/);
    const restoredOutput = await runCommand(ELECTRON_EXECUTABLE, [ELECTRON_FIXTURE], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        DSH_OFFICIAL_WEB_URL: restoredSurface,
        DSH_OFFICIAL_WEB_USER_DATA: join(dshHome, "electron-user-data-restored"),
      },
    });
    const restoredLine = restoredOutput.split(/\r?\n/).find((line) => line.startsWith("DSH_OFFICIAL_WEB_RESULT "));
    assert.ok(restoredLine, `missing restored browser result:\n${restoredOutput}`);
    const restoredResult = JSON.parse(restoredLine.slice("DSH_OFFICIAL_WEB_RESULT ".length));
    assert.equal(restoredResult.officialWeb, true);
    assert.equal(restoredResult.modelInheritanceClientLoaded, false);
    assert.equal(restoredResult.productShellLoaded, false);
    await stopServer(server);
    server = null;
  } finally {
    await stopServer(server);
    await rm(dshHome, { recursive: true, force: true });
  }
});

test("the real dsh-web-ui aggregate compat Client installs, stamps the official Web, and uninstalls", {
  timeout: 300_000,
  skip: RUN_COMPAT_E2E
    ? false
    : "set DSH_LIVE_COMPAT_TEST=1 to run the network-backed compat Profile and Electron gate",
}, async () => {
  const dshHome = await mkdtemp(join(tmpdir(), "dsh-web-ui-compat-"));
  let server;
  const env = {
    ...process.env,
    DEEPSEEK_API_KEY: "",
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: "1",
  };
  const profileDir = join(dshHome, "profiles", "web");
  try {
    await runCommand(process.execPath, [
      DSH_CLI,
      "plugin", "--profile", "web", "add", "-w", COMPAT_PACKAGE,
      "--save-exact", "--ignore-scripts",
    ], { cwd: APP_ROOT, env, timeoutMs: 240_000 });
    const installedManifest = JSON.parse(await readFile(join(profileDir, "package.json"), "utf8"));
    const compatPackageManifest = JSON.parse(await readFile(join(
      profileDir,
      "node_modules",
      "@linxin666",
      "dsh-web-ui-all",
      "package.json",
    ), "utf8"));
    assert.equal(compatPackageManifest.name, COMPAT_PACKAGE_NAME);
    assert.equal(compatPackageManifest.version, "0.1.20");
    assert.equal(compatPackageManifest.exports?.["./client"], "./lib/client.js");
    assert.equal(compatPackageManifest.dsh?.client?.platform, "web");
    assert.equal(installedManifest.dsh?.profile?.bundles?.includes(COMPAT_PACKAGE_NAME), true);
    assert.equal(Object.hasOwn(installedManifest.dependencies || {}, COMPAT_PACKAGE_NAME), true);

    server = spawn(process.execPath, [DSH_CLI, "--profile", "web", "--port", "0"], {
      cwd: APP_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const surface = await waitForOfficialSurface(server);
    const browserOutput = await runCommand(ELECTRON_EXECUTABLE, [ELECTRON_FIXTURE], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        DSH_OFFICIAL_WEB_URL: surface,
        DSH_OFFICIAL_WEB_USER_DATA: join(dshHome, "electron-user-data-compat"),
        DSH_OFFICIAL_WEB_COMMUNITY_UI: "compat",
      },
      timeoutMs: 90_000,
    });
    const resultLine = browserOutput.split(/\r?\n/).find((line) => line.startsWith("DSH_OFFICIAL_WEB_RESULT "));
    assert.ok(resultLine, `missing compat browser result:\n${browserOutput}`);
    const result = JSON.parse(resultLine.slice("DSH_OFFICIAL_WEB_RESULT ".length));
    assert.equal(result.officialWeb, true);
    assert.equal(result.compatClientLoaded, true);
    assert.equal(result.compatPaneHooks, true);
    assert.equal(result.compatFrame, true);

    await stopServer(server);
    server = null;
    await runCommand(process.execPath, [
      DSH_CLI,
      "plugin", "--profile", "web", "remove", COMPAT_PACKAGE_NAME,
    ], { cwd: APP_ROOT, env, timeoutMs: 120_000 });
    const removedManifest = JSON.parse(await readFile(join(profileDir, "package.json"), "utf8"));
    assert.equal(removedManifest.dsh?.profile?.bundles?.includes(COMPAT_PACKAGE_NAME), false);
    assert.equal(Object.hasOwn(removedManifest.dependencies || {}, COMPAT_PACKAGE_NAME), false);

    server = spawn(process.execPath, [DSH_CLI, "--profile", "web", "--port", "0"], {
      cwd: APP_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const restoredSurface = await waitForOfficialSurface(server);
    const restoredOutput = await runCommand(ELECTRON_EXECUTABLE, [ELECTRON_FIXTURE], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        DSH_OFFICIAL_WEB_URL: restoredSurface,
        DSH_OFFICIAL_WEB_USER_DATA: join(dshHome, "electron-user-data-compat-restored"),
      },
      timeoutMs: 90_000,
    });
    const restoredLine = restoredOutput.split(/\r?\n/).find((line) => line.startsWith("DSH_OFFICIAL_WEB_RESULT "));
    assert.ok(restoredLine, `missing restored compat browser result:\n${restoredOutput}`);
    const restoredResult = JSON.parse(restoredLine.slice("DSH_OFFICIAL_WEB_RESULT ".length));
    assert.equal(restoredResult.officialWeb, true);
    assert.equal(restoredResult.compatClientLoaded, false);
  } finally {
    await stopServer(server);
    await rm(dshHome, { recursive: true, force: true });
  }
});
