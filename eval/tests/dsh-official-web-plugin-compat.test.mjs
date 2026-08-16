import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DSH_CLI = resolve(APP_ROOT, "server/node_modules/@deepseek-ai/dsh/lib/bin.js");
const APP_BOOT = resolve(APP_ROOT, "server/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js");
const THEME_PACKAGE = resolve(APP_ROOT, "packages/dsh-theme-pack");

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

test("our theme Bundle boots in an unmodified official Web Profile", {
  timeout: 60_000,
  skip: existsSync(DSH_CLI) && existsSync(APP_BOOT) && existsSync(resolve(THEME_PACKAGE, "lib/client.js"))
    ? false
    : "missing app-pinned DSH CLI or built theme client",
}, async () => {
  const dshHome = await mkdtemp(join(tmpdir(), "dsh-official-web-plugin-"));
  let child;
  try {
    const profileApi = await import(pathToFileURL(APP_BOOT).href);
    const profileDir = profileApi.resolveProfileDir("web", dshHome);
    profileApi.initProfile(profileDir, profileApi.PROFILE_TEMPLATES.web);

    const link = join(dshHome, "profiles", "node_modules", "@deepseek-ai", "dsh-theme-pack");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(THEME_PACKAGE, link, "junction");

    const manifest = profileApi.readProfileManifest("compatibility-test", profileDir);
    manifest.dependencies["@deepseek-ai/dsh-theme-pack"] = `file:${THEME_PACKAGE}`;
    manifest.dsh.profile.bundles.push("@deepseek-ai/dsh-theme-pack");
    profileApi.writeProfileManifest(profileDir, manifest);

    child = spawn(process.execPath, [DSH_CLI, "--profile", "web", "--port", "0"], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: "",
        DSH_HOME: dshHome,
        DSH_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const surface = await waitForOfficialSurface(child);
    const html = await fetch(surface).then((response) => {
      assert.equal(response.ok, true);
      return response.text();
    });
    assert.match(html, /\/plugins\/@deepseek-ai\/dsh-theme-pack\/client\.js\?rev=/);
    assert.doesNotMatch(html, /\/plugins\/@deepseek-ai\/dsh-work-shell\/client\.js\?rev=/);

    const clientUrl = new URL("/plugins/@deepseek-ai/dsh-theme-pack/client.js", surface);
    const client = await fetch(clientUrl).then((response) => {
      assert.equal(response.ok, true);
      return response.text();
    });
    assert.match(client, /theme\.overrideTokens/);
    assert.match(client, /--dsw-alias-brand-primary/);
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolveExit) => child.once("exit", resolveExit));
    }
    await rm(dshHome, { recursive: true, force: true });
  }
});
