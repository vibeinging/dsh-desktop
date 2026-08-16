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
const THEME_PACKAGE = resolve(APP_ROOT, "packages/dsh-theme-pack");
const MODEL_INHERITANCE_PACKAGE = resolve(APP_ROOT, "packages/dsh-model-inheritance");
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

test("our portable Bundles install and run in an unmodified official Web Profile", {
  timeout: 120_000,
  skip: existsSync(DSH_CLI) && existsSync(ELECTRON_EXECUTABLE) && existsSync(resolve(THEME_PACKAGE, "lib/client.js"))
    ? false
    : "missing app-pinned DSH CLI, Electron, or built theme client",
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
      "plugin", "--profile", "web", "add", "-w", THEME_PACKAGE, MODEL_INHERITANCE_PACKAGE,
      "--save-exact", "--ignore-scripts", "--offline",
    ], { cwd: APP_ROOT, env });

    const profileDir = join(dshHome, "profiles", "web");
    const manifest = JSON.parse(await readFile(join(profileDir, "package.json"), "utf8"));
    assert.equal(typeof manifest.dependencies?.["@deepseek-ai/dsh-theme-pack"], "string");
    assert.equal(typeof manifest.dependencies?.["@deepseek-ai/dsh-model-inheritance"], "string");
    assert.equal(manifest.dsh?.profile?.bundles?.includes("@deepseek-ai/dsh-theme-pack"), true);
    assert.equal(manifest.dsh?.profile?.bundles?.includes("@deepseek-ai/dsh-model-inheritance"), true);

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
    assert.match(html, /\/plugins\/@deepseek-ai\/dsh-theme-pack\/client\.js\?rev=/);
    assert.doesNotMatch(html, /\/plugins\/@deepseek-ai\/dsh-model-inheritance\/client\.js\?rev=/);
    assert.doesNotMatch(html, /\/plugins\/@deepseek-ai\/dsh-work-shell\/client\.js\?rev=/);

    const clientUrl = new URL("/plugins/@deepseek-ai/dsh-theme-pack/client.js", surface);
    const client = await fetch(clientUrl).then((response) => {
      assert.equal(response.ok, true);
      return response.text();
    });
    assert.match(client, /theme\.overrideTokens/);
    assert.match(client, /--dsw-alias-brand-primary/);

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
    assert.equal(["#405fd2", "#7b9cff"].includes(result.primary), true);
    assert.equal(["light", "dark"].includes(result.colorScheme), true);
    assert.equal(result.themeClientLoaded, true);
    assert.equal(result.productShellLoaded, false);
    assert.equal(result.bodyChildCount > 0, true);
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolveExit) => server.once("exit", resolveExit));
    }
    await rm(dshHome, { recursive: true, force: true });
  }
});
