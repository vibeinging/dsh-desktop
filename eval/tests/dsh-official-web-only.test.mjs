import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { findOfficialWebCdpTarget } from "../../electron/scripts/official-web-cdp-target.mjs";
import {
  createOfficialWebSessionFollowFrame,
  createOfficialWebUnaryRequest,
} from "../../electron/scripts/official-web-runtime-api.mjs";
import { nextPatchVersion } from "../../electron/scripts/updater-smoke-version.mjs";

const appRoot = new URL("../..", import.meta.url);
const rootPackage = JSON.parse(readFileSync(new URL("package.json", appRoot), "utf8"));
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

test("packaged smoke selects the loopback official Web instead of local utility pages", () => {
  const target = findOfficialWebCdpTarget([
    {
      type: "page",
      url: "file:///Applications/DSH%20Desktop.app/Contents/Resources/app-update.html",
      webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/update",
    },
    {
      type: "page",
      url: "http://127.0.0.1:43000/",
      webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/official-web",
    },
  ]);

  assert.equal(target?.url, "http://127.0.0.1:43000/");
  assert.equal(findOfficialWebCdpTarget([{
    type: "page",
    url: "http://localhost:43000/",
    webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/wrong-host",
  }]), undefined);
});

test("packaged updater smoke always targets a newer patch version", () => {
  assert.equal(nextPatchVersion("0.2.1"), "0.2.2");
  assert.equal(nextPatchVersion("0.2.1-beta.3"), "0.2.2");
  assert.throws(() => nextPatchVersion("not-a-version"), /不支持的 App 版本/);
});

test("packaged smoke uses the current official Web Remote protocol", () => {
  const listed = createOfficialWebUnaryRequest("session.list", {}, "rpc-list");
  assert.equal(listed.endpoint, "session/list");
  assert.deepEqual(listed.body.payload.args, { _request: {} });

  const created = createOfficialWebUnaryRequest("workspace.create", { path: "/tmp/workspace" }, "rpc-workspace");
  assert.deepEqual(created.body.payload.args, { request: { path: "/tmp/workspace" } });

  const prompted = createOfficialWebUnaryRequest("session.prompt", { sessionId: "session-1" }, "rpc-prompt");
  assert.equal(prompted.body.payload.args.request.requestId, "rpc-prompt");

  assert.deepEqual(createOfficialWebSessionFollowFrame({
    sessionId: "session-1",
    maxMessages: 100,
    streamId: "stream-1",
  }), {
    type: "open",
    streamId: "stream-1",
    endpoint: "session/follow",
    payload: { args: { request: { address: { kind: "session", sessionId: "session-1" }, maxMessages: 100 } } },
  });
});

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

test("macOS window controls use Profile chrome with a native safe fallback", () => {
  const createWindowStart = electronMain.indexOf("function createWindow(");
  const appLifecycleStart = electronMain.indexOf("// ── App lifecycle ──");
  const createWindowSource = electronMain.slice(createWindowStart, appLifecycleStart);

  assert.match(createWindowSource, /titleBarStyle: useIntegratedChrome \? 'hiddenInset' : 'default'/);
  assert.match(createWindowSource, /trafficLightPosition: \{ x: 14, y: 11 \}/);
  assert.doesNotMatch(createWindowSource, /titleBarOverlay\s*:/);
  assert.match(electronMain, /integratedDesktopChrome = response\.json\?\.data\?\.desktop_chrome === true/);
});

test("the official Web entry has no preload or global IPC bridge", () => {
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

test("the embedded official Web never opens a second system browser", () => {
  assert.match(desktopWebPatch, /id:\s*web-runtime[\s\S]{0,240}?openBrowser:\s*false/);
});

test("legacy Renderer source and build entrypoints are retired", () => {
  assert.equal(existsSync(new URL("renderer/package.json", appRoot)), false);
  assert.equal(existsSync(new URL("renderer/vite.config.ts", appRoot)), false);
  assert.equal(rootPackage.scripts["dev:legacy-renderer"], undefined);
  assert.equal(rootPackage.scripts["test:legacy-renderer"], undefined);
  assert.equal(rootPackage.scripts["build:renderer"], undefined);
  assert.equal(typeof rootPackage.scripts["verify:official-web-assets"], "string");
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
  assert.match(officialWebFlowSmoke, /data-composer-input/);
  assert.match(officialWebFlowSmoke, /mode: 'queue'/);
  assert.match(officialWebFlowSmoke, /approvalMarkerPath/);
  assert.match(officialWebFlowSmoke, /name === 'bash' \|\| name === 'pwsh'/);
  assert.match(officialWebFlowSmoke, /Set-Content -LiteralPath/);
  assert.match(officialWebFlowSmoke, /function: \{ name: selectedShellTool/);
  assert.match(officialWebFlowSmoke, /async function dismissOfficialPrompts/);
  assert.doesNotMatch(officialWebFlowSmoke, /function: \{ name: 'bash'/);
});

test("the native Host smoke keeps file-dialog coverage behind an explicit manual mode", () => {
  assert.equal(typeof electronPackage.scripts["smoke:native-host:dialogs"], "string");
  assert.match(electronPackage.scripts["smoke:native-host:dialogs"], /--dialogs/);
  assert.match(nativeHostSmoke, /native_host_file_dialog_smoke/);
  assert.match(nativeHostSmoke, /releaseEvidenceChecks\('native-host', nativeHostMode\)/);
  assert.match(nativeHostSmoke, /nativeHostMode/);
  assert.match(nativeHostSmoke, /data-composer-input/);
  assert.match(nativeHostSmoke, /async function dismissOfficialPrompts/);
  assert.match(nativeHostSmoke, /native-host-dialogs.*result\.json/);
});
