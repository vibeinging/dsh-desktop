import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DshProfilePluginService } from "../../server/src/engine/dsh_runtime/profile_plugin_service.js";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DSH_CLI = resolve(APP_ROOT, "server/node_modules/@deepseek-ai/dsh/lib/bin.js");
const TASK_BOARD_SOURCE = "@linxin666/dsh-client-ui-task-board@0.1.20";
const requireFromElectron = createRequire(resolve(APP_ROOT, "electron/package.json"));
const ELECTRON_EXECUTABLE = requireFromElectron("electron");
const ELECTRON_FIXTURE = resolve(APP_ROOT, "eval/fixtures/official-web-electron.cjs");
const COMMUNITY_SCREENSHOT_DIR = String(process.env.DSH_COMMUNITY_SCREENSHOT_DIR || "").trim();

function runCommand(executable, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const { timeoutMs = 90_000, ...spawnOptions } = options;
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
    const timeout = setTimeout(() => rejectSurface(new Error(`official Web Profile did not start:\n${output}`)), 45_000);
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

test("macOS installer smoke records the DMG-to-App installation boundary", async () => {
  const script = await readFile(resolve(APP_ROOT, "electron/scripts/smoke-macos-installer.mjs"), "utf8");
  assert.match(script, /hdiutil/);
  assert.match(script, /ditto/);
  assert.match(script, /smoke-packaged-community\.mjs/);
  assert.match(script, /DSH_INSTALLER_SOURCE/);
});

test("the independent task-board Bundle installs, runs, uninstalls, and restarts through the official Profile", {
  timeout: 300_000,
  skip: process.env.DSH_LIVE_COMMUNITY_TEST === "1"
    && existsSync(DSH_CLI)
    && existsSync(ELECTRON_EXECUTABLE)
    ? false
    : "set DSH_LIVE_COMMUNITY_TEST=1 to run the network-backed community Profile and Electron gate",
}, async () => {
  const dshHome = await mkdtemp(join(tmpdir(), "dsh-community-task-board-"));
  let server;
  const env = {
    ...process.env,
    DEEPSEEK_API_KEY: "",
    DSH_HOME: dshHome,
    DSH_RUNTIME_HOME: dshHome,
    DSH_DATA_ROOT: dshHome,
    DSH_RUNTIME_DISTRIBUTION: "npm",
    DSH_TELEMETRY_DISABLED: "1",
  };
  const service = new DshProfilePluginService({
    env,
    restartRuntime: async () => ({ restarted: false, sessions: [] }),
  });
  try {
    const preflight = await service.preflight(TASK_BOARD_SOURCE);
    assert.equal(preflight.installable, true, JSON.stringify(preflight));
    assert.equal(preflight.package_name, "@linxin666/dsh-client-ui-task-board");
    const installed = await service.install(TASK_BOARD_SOURCE);
    assert.equal(installed.id, "@linxin666/dsh-client-ui-task-board");

    let state = await service.state();
    assert.equal(state.plugins.some((plugin) => plugin.id === installed.id), true);
    const manifestAfterInstall = JSON.parse(await readFile(join(dshHome, "profiles", "web", "package.json"), "utf8"));
    assert.equal(manifestAfterInstall.dsh.profile.bundles.includes(installed.id), true);

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
    assert.match(html, /@linxin666\/dsh-client-ui-task-board/);

    const electronEnv = {
      ...process.env,
      DSH_OFFICIAL_WEB_URL: surface,
      DSH_OFFICIAL_WEB_USER_DATA: join(dshHome, "electron-user-data"),
      DSH_OFFICIAL_WEB_COMMUNITY_UI: "task-board",
      ...(COMMUNITY_SCREENSHOT_DIR
        ? { DSH_OFFICIAL_WEB_SCREENSHOT: join(COMMUNITY_SCREENSHOT_DIR, "task-board.png") }
        : {}),
    };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    const browserOutput = await runCommand(ELECTRON_EXECUTABLE, [ELECTRON_FIXTURE], {
      cwd: APP_ROOT,
      env: electronEnv,
      timeoutMs: 90_000,
    });
    const resultLine = browserOutput.split(/\r?\n/).find((line) => line.startsWith("DSH_OFFICIAL_WEB_RESULT "));
    assert.ok(resultLine, `missing browser result:\n${browserOutput}`);
    const result = JSON.parse(resultLine.slice("DSH_OFFICIAL_WEB_RESULT ".length));
    assert.equal(result.officialWeb, true);
    assert.equal(result.taskBoardClientLoaded, true);
    assert.equal(result.taskBoardEntryVisible, true);
    assert.equal(result.taskBoardActive, true);
    assert.equal(result.taskBoardBoardVisible, true);
    assert.equal(result.taskBoardColumns, 5);
    assert.equal(result.taskBoardInsideOfficialWebRoot, true);

    server.kill("SIGTERM");
    await new Promise((resolveExit) => server.once("exit", resolveExit));
    server = null;

    const taskBoardPatchPath = join(
      dshHome,
      "profiles",
      "web",
      "node_modules",
      "@linxin666",
      "dsh-client-ui-task-board",
      "cordis.patch.yml",
    );
    const taskBoardPatch = await readFile(taskBoardPatchPath, "utf8");
    const taskBoardPatchId = taskBoardPatch.match(/^\s*-?\s*id:\s*([^\s#]+)\s*$/m)?.[1];
    assert.ok(taskBoardPatchId, `task-board patch 缺少稳定 id: ${taskBoardPatchPath}`);
    const disabledPatch = `- id: ${taskBoardPatchId}\n  disabled: true\n`;
    const homePatchPath = join(dshHome, "cordis.patch.yml");
    await writeFile(homePatchPath, disabledPatch);
    const installedManifest = JSON.parse(await readFile(join(dshHome, "profiles", "web", "package.json"), "utf8"));
    assert.equal(installedManifest.dsh.profile.bundles.includes(installed.id), true);
    assert.equal(Object.hasOwn(installedManifest.dependencies, installed.id), true);

    server = spawn(process.execPath, [DSH_CLI, "--profile", "web", "--port", "0"], {
      cwd: APP_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const disabledSurface = await waitForOfficialSurface(server);
    const disabledOutput = await runCommand(ELECTRON_EXECUTABLE, [ELECTRON_FIXTURE], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        DSH_OFFICIAL_WEB_URL: disabledSurface,
        DSH_OFFICIAL_WEB_USER_DATA: join(dshHome, "electron-user-data-disabled"),
      },
      timeoutMs: 90_000,
    });
    const disabledLine = disabledOutput.split(/\r?\n/).find((line) => line.startsWith("DSH_OFFICIAL_WEB_RESULT "));
    assert.ok(disabledLine, `missing disabled browser result:\n${disabledOutput}`);
    const disabledResult = JSON.parse(disabledLine.slice("DSH_OFFICIAL_WEB_RESULT ".length));
    assert.equal(disabledResult.officialWeb, true);
    assert.equal(disabledResult.taskBoardClientLoaded, false);
    server.kill("SIGTERM");
    await new Promise((resolveExit) => server.once("exit", resolveExit));
    server = null;
    assert.equal(await readFile(homePatchPath, "utf8"), disabledPatch);

    await rm(homePatchPath, { force: true });
    server = spawn(process.execPath, [DSH_CLI, "--profile", "web", "--port", "0"], {
      cwd: APP_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const reenabledSurface = await waitForOfficialSurface(server);
    const reenabledOutput = await runCommand(ELECTRON_EXECUTABLE, [ELECTRON_FIXTURE], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        DSH_OFFICIAL_WEB_URL: reenabledSurface,
        DSH_OFFICIAL_WEB_USER_DATA: join(dshHome, "electron-user-data-reenabled"),
        DSH_OFFICIAL_WEB_COMMUNITY_UI: "task-board",
      },
      timeoutMs: 90_000,
    });
    const reenabledLine = reenabledOutput.split(/\r?\n/).find((line) => line.startsWith("DSH_OFFICIAL_WEB_RESULT "));
    assert.ok(reenabledLine, `missing re-enabled browser result:\n${reenabledOutput}`);
    const reenabledResult = JSON.parse(reenabledLine.slice("DSH_OFFICIAL_WEB_RESULT ".length));
    assert.equal(reenabledResult.officialWeb, true);
    assert.equal(reenabledResult.taskBoardClientLoaded, true);
    assert.equal(reenabledResult.taskBoardActive, true);
    assert.equal(reenabledResult.taskBoardColumns, 5);
    server.kill("SIGTERM");
    await new Promise((resolveExit) => server.once("exit", resolveExit));
    server = null;

    await service.uninstall(installed.id);
    state = await service.state();
    assert.equal(state.plugins.some((plugin) => plugin.id === installed.id), false);

    server = spawn(process.execPath, [DSH_CLI, "--profile", "web", "--port", "0"], {
      cwd: APP_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const restartedSurface = await waitForOfficialSurface(server);
    const restartedOutput = await runCommand(ELECTRON_EXECUTABLE, [ELECTRON_FIXTURE], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        DSH_OFFICIAL_WEB_URL: restartedSurface,
        DSH_OFFICIAL_WEB_USER_DATA: join(dshHome, "electron-user-data-restarted"),
      },
      timeoutMs: 90_000,
    });
    const restartedLine = restartedOutput.split(/\r?\n/).find((line) => line.startsWith("DSH_OFFICIAL_WEB_RESULT "));
    assert.ok(restartedLine, `missing restarted browser result:\n${restartedOutput}`);
    const restartedResult = JSON.parse(restartedLine.slice("DSH_OFFICIAL_WEB_RESULT ".length));
    assert.equal(restartedResult.officialWeb, true);
    assert.equal(restartedResult.taskBoardClientLoaded, false);
    server.kill("SIGTERM");
    await new Promise((resolveExit) => server.once("exit", resolveExit));
    server = null;

    const restartedService = new DshProfilePluginService({
      env,
      restartRuntime: async () => ({ restarted: false, sessions: [] }),
    });
    const restarted = await restartedService.state();
    assert.equal(restarted.plugins.some((plugin) => plugin.id === installed.id), false);
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolveExit) => server.once("exit", resolveExit));
    }
    await rm(dshHome, { recursive: true, force: true });
  }
});
