import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const appRoot = new URL("../..", import.meta.url);
const electronMain = readFileSync(new URL("electron/main.js", appRoot), "utf8");
const electronPackage = JSON.parse(readFileSync(new URL("electron/package.json", appRoot), "utf8"));
const featured = JSON.parse(readFileSync(new URL("server/src/engine/dsh_runtime/featured_plugins.json", appRoot), "utf8"));
const desktopWebPatch = readFileSync(new URL("server/src/engine/dsh_runtime/desktop_web.patch.yml", appRoot), "utf8");
const officialWebFlowSmoke = readFileSync(new URL("electron/scripts/smoke-packaged-official-web-flow.mjs", appRoot), "utf8");
const nativeHostSmoke = readFileSync(new URL("electron/scripts/smoke-packaged-native-host.mjs", appRoot), "utf8");
const defaultDevScript = readFileSync(new URL("scripts/dev.mjs", appRoot), "utf8");
const bootstrapScript = readFileSync(new URL("scripts/bootstrap.mjs", appRoot), "utf8");
const doctorScript = readFileSync(new URL("scripts/doctor.mjs", appRoot), "utf8");
const auditScript = readFileSync(new URL("scripts/audit-production.mjs", appRoot), "utf8");

test("Electron's main window has one official DSH Web surface", () => {
  const createWindowStart = electronMain.indexOf("function createWindow(");
  const appLifecycleStart = electronMain.indexOf("// ── App lifecycle ──");
  assert.ok(createWindowStart >= 0);
  assert.ok(appLifecycleStart > createWindowStart);
  const createWindowSource = electronMain.slice(createWindowStart, appLifecycleStart);

  assert.doesNotMatch(createWindowSource, /preload\s*:/);
  assert.match(electronMain, /rendererSurfaceUrl\s*=\s*await resolveRendererSurface\(\)/);
  assert.match(electronMain, /createWindow\(rendererSurfaceUrl\)/);
  assert.match(electronMain, /profile-preflight/);
  assert.match(electronMain, /更新插件后重试/);
  assert.match(electronMain, /进入安全 Profile/);
  assert.match(electronMain, /稍后更新/);
  assert.doesNotMatch(createWindowSource, /loadFile\([^)]*renderer/);
  assert.doesNotMatch(createWindowSource, /standalone|dsh-work-shell|legacy/i);
});

test("the release package does not ship a product preload bridge", () => {
  assert.equal(electronPackage.build.files.includes("preload.js"), false);
  assert.equal(electronPackage.build.extraResources.some((entry) => String(entry.from || "").includes("renderer")), false);
  assert.doesNotMatch(electronMain, /\bipcMain\b/);
  assert.match(electronMain, /BrowserWorkspaceController/);
  assert.match(electronMain, /desktop-native-request/);
  assert.match(electronMain, /BROWSER_NATIVE_HANDLERS/);
  assert.match(electronMain, /FILE_DIALOG_NATIVE_HANDLERS/);
  assert.match(electronMain, /WINDOW_NATIVE_HANDLERS/);
  assert.match(electronMain, /fileDialogOpenFiles/);
  assert.match(electronMain, /windowRestore/);
  assert.doesNotMatch(electronMain, /showSaveDialog/);
  assert.doesNotMatch(electronMain, /artifact-context-menu|attachment-grants/);
});

test("the default development entry does not rebuild the retired Renderer", () => {
  assert.doesNotMatch(defaultDevScript, /buildDshClientPlugin|build:dsh-client|dsh-work Client Plugin/);
  assert.match(defaultDevScript, /默认开发入口使用官方 DSH Web/);
});

test("the official Web overlay does not disable the community compat shim", () => {
  assert.doesNotMatch(desktopWebPatch, /id:\s*web-ui-compat[\s\S]{0,100}?disabled:\s*true/);
});

test("legacy Renderer is not a default desktop dependency", () => {
  assert.doesNotMatch(bootstrapScript, /name:\s*['"]Renderer['"]/);
  assert.doesNotMatch(doctorScript, /renderer\/node_modules/);
  assert.match(auditScript, /const targets = \['server', 'electron'\]/);
});

test("the recovery page is a local, non-product surface", () => {
  const recovery = readFileSync(new URL("electron/recovery.html", appRoot), "utf8");
  assert.doesNotMatch(recovery, /window\.electronAPI|ipcRenderer|nodeIntegration|dsh-web-app|plugin market|Chat/i);
  for (const action of ["retry", "safe-profile", "open-profile", "export-diagnostics", "remove-plugin"]) {
    assert.match(recovery, new RegExp(`go\\('${action}'`));
  }
});

test("the new Profile input excludes the retired replacement shell and theme pack", () => {
  const names = featured.plugins.map((plugin) => plugin.name);
  assert.equal(names.includes("@vibeinging/dsh-work-shell"), false);
  assert.equal(names.includes("@vibeinging/dsh-theme-pack"), false);
  assert.equal(existsSync(new URL("packages/dsh-theme-pack/package.json", appRoot)), false);
  assert.doesNotMatch(electronMain, /profileThemes|profile_themes|skin-settings-store|dsh-theme-pack/);
});

test("the packaged official Web interaction smoke stays on official question, approval, and queue contracts", () => {
  assert.equal(typeof electronPackage.scripts["smoke:packaged-official-web-interactions"], "string");
  assert.match(electronPackage.scripts["smoke:packaged-official-web-interactions"], /--fake-model/);
  assert.match(officialWebFlowSmoke, /DEEPSEEK_BASE_URL/);
  assert.match(officialWebFlowSmoke, /data-question-key/);
  assert.match(officialWebFlowSmoke, /data-approval-key/);
  assert.match(officialWebFlowSmoke, /data-queue-dock/);
  assert.match(officialWebFlowSmoke, /mode: 'queue'/);
  assert.match(officialWebFlowSmoke, /approvalMarkerPath/);
});

test("the native Host smoke keeps file-dialog coverage behind an explicit manual mode", () => {
  assert.equal(typeof electronPackage.scripts["smoke:native-host:dialogs"], "string");
  assert.match(electronPackage.scripts["smoke:native-host:dialogs"], /--dialogs/);
  assert.match(nativeHostSmoke, /native_host_file_dialog_smoke/);
  assert.match(nativeHostSmoke, /session-bound-file-dialog-open/);
  assert.match(nativeHostSmoke, /session-bound-directory-dialog-open/);
  assert.match(nativeHostSmoke, /native-host-dialogs.*result\.json/);
});
