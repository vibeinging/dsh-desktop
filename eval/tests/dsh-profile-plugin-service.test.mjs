import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DshProfilePluginService,
  inspectCommunityClientIsolation,
  inspectProfileBundleCompatibility,
  inspectProfileBundleManifest,
  inspectProfileBundlePatches,
  normalizeProfileBundleSource,
  readProfilePackageIntegrity,
  readDshWorkPortability,
  validateDshWorkProductDescriptor,
  validateProfileBundleSdk,
} from "../../server/src/engine/dsh_runtime/profile_plugin_service.js";
import { ensureDshProfileInitialized } from "../../server/src/engine/dsh_runtime/profile_initialization.js";
import {
  featuredPluginNames,
  featuredPlugins,
} from "../../server/src/engine/dsh_runtime/featured_plugins.js";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DSH_NPM_ROOT = resolve(APP_ROOT, "server/node_modules/@deepseek-ai/dsh");

async function writeReviewedMarketFixture(root) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "index.js"), "export default function apply() {}\n");
  await writeFile(join(root, "client.js"), "export default function apply() {}\n");
  await writeFile(join(root, "cordis.patch.yml"), "- insert:\n    - id: reviewed-market-fixture\n      name: dshmarket\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "dshmarket",
    version: "1.9.0",
    private: true,
    type: "module",
    main: "./index.js",
    exports: {
      ".": "./index.js",
      "./client": "./client.js",
    },
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web" },
    },
    peerDependencies: {
      "@deepseek-ai/cordis": "^4.0.1",
    },
  }, null, 2)}\n`);
}

test("Profile Bundle sources must be immutable or explicitly local", () => {
  assert.equal(
    normalizeProfileBundleSource("@example/dsh-report@1.2.3"),
    "@example/dsh-report@1.2.3",
  );
  assert.equal(
    normalizeProfileBundleSource(`github:example/dsh-report#${"a".repeat(40)}`),
    `github:example/dsh-report#${"a".repeat(40)}`,
  );
  assert.throws(
    () => normalizeProfileBundleSource("@example/dsh-report@latest"),
    { code: "DSH_PROFILE_SOURCE_NOT_PINNED" },
  );
  assert.throws(
    () => normalizeProfileBundleSource("github:dsh-external/dsh-report#main"),
    { code: "DSH_PROFILE_SOURCE_NOT_PINNED" },
  );
  assert.throws(
    () => normalizeProfileBundleSource(APP_ROOT),
    { code: "DSH_PROFILE_SOURCE_NOT_PINNED" },
  );
  assert.equal(
    normalizeProfileBundleSource(APP_ROOT, { allowLocal: true }),
    `file:${APP_ROOT}`,
  );
});

test("reviewed community Client integrity must come from the Profile lockfile", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-profile-integrity-"));
  const integrity = "sha512-test-integrity";
  try {
    await writeFile(join(home, "pnpm-lock.yaml"), `lockfileVersion: '6.0'\n\npackages:\n\n  /@example/client@1.2.3:\n    resolution: {integrity: ${integrity}}\n    dev: false\n\n  /@example/other@1.0.0:\n    resolution: {integrity: sha512-other}\n    dev: false\n`);
    assert.equal(readProfilePackageIntegrity(home, "@example/client", "1.2.3"), integrity);
    assert.equal(readProfilePackageIntegrity(home, "@example/client", "1.2.4"), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Profile Bundle compatibility separates Host, Session, capabilities, and Client UI", () => {
  assert.deepEqual(inspectProfileBundleCompatibility({
    name: "@example/mixed-plugin",
    dsh: { client: { platform: "web" } },
    peerDependencies: {
      "@deepseek-ai/dsh-agent": "^0.1.0-rc.7",
      "@deepseek-ai/dsh-tools": "^0.1.0-rc.7",
      "@deepseek-ai/dsh-mcp-client": "^0.1.0-rc.7",
    },
  }).map(({ id, status }) => ({ id, status })), [
    { id: "host", status: "profile_checked" },
    { id: "session", status: "review_required" },
    { id: "capabilities", status: "review_required" },
    { id: "client", status: "isolation_required" },
  ]);
  assert.equal(inspectProfileBundleCompatibility({ dependencies: {} })[3].message, "Host-only Bundle，不需要桌面 Slot");
  assert.deepEqual(inspectProfileBundleCompatibility({
    name: "dshmarket",
    version: "1.9.0",
    dsh: { client: { platform: "web" } },
  })[3], {
    id: "client",
    status: "reviewed",
    label: "Client UI",
    message: "该精确包版本已完成代码审查，可以进入当前 Client 图",
  });
  const reviewedWebUi = inspectProfileBundleCompatibility({
    name: "@linxin666/dsh-web-ui-all",
    version: "0.1.20",
    dependencies: {
      "@linxin666/dsh-client-ui-community-plugins": "0.1.20",
      "@linxin666/dsh-client-ui-aionui-panel": "0.1.20",
      "@linxin666/dsh-client-ui-task-board": "0.1.20",
      "@linxin666/dsh-client-ui-git-graph": "0.1.20",
      "@linxin666/dsh-pet": "0.1.20",
      "@linxin666/dsh-remote-web-ui": "0.1.20",
      "@linxin666/dsh-live-stats": "0.1.20",
      "@linxin666/dsh-ssh": "0.1.20",
      "@linxin666/dsh-tool-describe-image": "0.1.20",
      "@linxin666/dsh-liangshen": "0.1.20",
      "@linxin666/dsh-client-ui-web-ui-settings": "0.1.20",
      "@linxin666/dsh-skins": "0.1.20",
      "@linxin666/dsh-client-ui-skin-center": "0.1.20",
    },
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web" },
    },
  }, {
    integrity: "sha512-mPMXmPfO0rc/3hmv8Aw71UOJqTDVW2T3VWuN6dIgiMpDlRQp9O0BCaLh13j6LjH0WB9fAS+9DmUVix8sLLwNLA==",
  });
  assert.deepEqual(reviewedWebUi.map(({ id, status }) => ({ id, status })), [
    { id: "host", status: "profile_checked" },
    { id: "session", status: "reviewed" },
    { id: "capabilities", status: "reviewed" },
    { id: "client", status: "reviewed" },
  ]);
  assert.match(reviewedWebUi[2].message, /Git、SSH 与电源保持进程/);
});

test("Profile Bundle patch inspection reports rows and risk names without configuration values", () => {
  assert.deepEqual(inspectProfileBundlePatches([
    { id: "existing", config: { apiKey: "must-not-leak", root: "/private" } },
    { insert: [{ id: "tool", name: "@example/tool", config: { endpoint: "https://example.com", command: "run" } }] },
  ]), {
    row_count: 2,
    inserted_count: 1,
    overridden_count: 1,
    risk_categories: ["credentials", "filesystem", "network", "process"],
    rows: [
      {
        id: "existing",
        name: null,
        operation: "override",
        disabled: false,
        config_keys: ["apiKey", "root"],
        risks: ["credentials", "filesystem"],
      },
      {
        id: "tool",
        name: "@example/tool",
        operation: "insert",
        disabled: false,
        config_keys: ["command", "endpoint"],
        risks: ["network", "process"],
      },
    ],
  });
});

test("app Bundle portability distinguishes reusable features from desktop host boundaries", () => {
  assert.deepEqual(readDshWorkPortability({
    name: "@example/portable",
    dshWork: {
      portability: {
        level: "portable",
        surfaces: ["official-web", "dsh-desktop"],
        hostRequirements: [],
        compatibilityTest: "eval/portable.test.mjs",
      },
    },
  }), {
    level: "portable",
    surfaces: ["official-web", "dsh-desktop"],
    host_requirements: [],
    compatibility_test: "eval/portable.test.mjs",
  });
  assert.throws(() => readDshWorkPortability({
    name: "@example/not-portable",
    dshWork: {
      portability: {
        level: "portable",
        surfaces: ["dsh-desktop"],
        hostRequirements: ["electron"],
      },
    },
  }), { code: "DSH_PRODUCT_PORTABILITY_INVALID" });
});

test("Profile Bundle validation rejects the retired pre-release SDK shape", () => {
  assert.throws(() => validateProfileBundleSdk({
    name: "@example/legacy",
    peerDependencies: { "@deepseek-ai/cordis": "4.0.1-rc.1" },
  }), { code: "DSH_PROFILE_LEGACY_SDK" });
  assert.throws(() => validateProfileBundleSdk({
    name: "@example/legacy-rc",
    peerDependencies: {
      cordis: "^4.0.0-rc.7",
      "@deepseek-ai/dsh-tools": "0.0.1-rc.2",
    },
  }), { code: "DSH_PROFILE_LEGACY_SDK" });
  assert.doesNotThrow(() => validateProfileBundleSdk({
    name: "@example/current",
    peerDependencies: {
      "@deepseek-ai/cordis": "^4.0.1",
      "@deepseek-ai/dsh-tools": "^0.1.0-rc.7",
    },
  }));
  assert.doesNotThrow(() => validateProfileBundleSdk({
    name: "@example/current-with-optional-legacy-peer",
    peerDependencies: {
      "@deepseek-ai/cordis": "^4.0.1",
      "@deepseek-ai/dsh-tools": "^0.1.0-rc.7",
      cordis: "^4.0.0-rc.7",
    },
    peerDependenciesMeta: { cordis: { optional: true } },
  }));
  assert.throws(() => validateProfileBundleSdk({
    name: "@example/legacy-runtime-cordis",
    dependencies: {
      "@deepseek-ai/cordis": "^4.0.1",
      cordis: "^4.0.0-rc.7",
    },
  }), { code: "DSH_PROFILE_LEGACY_SDK" });
});

test("community plugin manifests report every current DSH migration blocker", () => {
  assert.throws(() => validateProfileBundleSdk({
    name: "dsh-files",
    peerDependencies: {
      "@deepseek-ai/cordis": "*",
    },
  }), { code: "DSH_PROFILE_LEGACY_SDK" });
  assert.deepEqual(inspectProfileBundleManifest({
    name: "dsh-better-sidebar",
    version: "0.9.0",
    dsh: { client: { inject: ["@deepseek-ai/dsh-client-runtime"] } },
    peerDependencies: {
      "@deepseek-ai/dsh-client-runtime": "^0.0.1-rc.1",
      cordis: "^4.0.0-rc.7",
    },
  }), [
    {
      code: "DSH_PROFILE_NOT_A_BUNDLE",
      message: "dsh-better-sidebar 没有声明有效的 package.json#dsh.bundle.patch",
    },
    {
      code: "DSH_PROFILE_CLIENT_MANIFEST_INVALID",
      message: "dsh-better-sidebar 的 package.json#dsh.client 必须声明 web platform，并使用字符串 inject 列表",
    },
    {
      code: "DSH_PROFILE_LEGACY_SDK",
      message: "dsh-better-sidebar 有 1 个 DSH SDK 包不属于当前 0.1.0-rc.7 发布线",
    },
  ]);
  assert.deepEqual(inspectProfileBundleManifest({
    name: "dsh-source-only",
    main: "lib/index.js",
    scripts: { prepare: "tsdown" },
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
  }, { builtEntryAvailable: false }), [{
    code: "DSH_PROFILE_BUILD_APPROVAL_REQUIRED",
    message: "dsh-source-only 没有提交运行入口，Git 安装需要执行 prepare 构建脚本",
  }]);
});

test("current DSH browser plugins declare one verifiable client bundle", () => {
  assert.deepEqual(inspectProfileBundleManifest({
    name: "dsh-browser-plugin",
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: {
        platform: "web",
        inject: ["@deepseek-ai/dsh-client-runtime"],
      },
    },
    exports: { "./client": { default: "./lib/client.js" } },
    peerDependencies: {
      "@deepseek-ai/cordis": "^4.0.1",
      "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.7",
    },
  }), []);
  assert.deepEqual(inspectProfileBundleManifest({
    name: "dsh-browser-plugin",
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web" },
    },
    exports: { "./client": "./lib/client.js" },
  }, { clientEntryAvailable: false }), [{
    code: "DSH_PROFILE_CLIENT_BUNDLE_MISSING",
    message: "dsh-browser-plugin 没有提交 exports[\"./client\"] 指向的浏览器构建产物",
  }]);
});

test("community dsh.client Bundles stay out of the privileged Electron renderer", () => {
  assert.deepEqual(inspectCommunityClientIsolation({
    name: "@example/community-ui",
    dsh: { client: { platform: "web" } },
  }), [{
    code: "DSH_PROFILE_CLIENT_ISOLATION_REQUIRED",
    message: "@example/community-ui 包含 dsh.client 浏览器代码；只有经过精确版本和依赖审查的独立 Client Bundle 才能进入官方 Web 图",
  }]);
  assert.deepEqual(inspectCommunityClientIsolation({
    name: "@example/host-only",
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
  }), []);
  assert.deepEqual(inspectCommunityClientIsolation({
    name: "dshmarket",
    version: "1.9.0",
    dsh: { client: { platform: "web" } },
  }), []);
  assert.equal(inspectCommunityClientIsolation({
    name: "dshmarket",
    version: "1.8.0",
    dsh: { client: { platform: "web" } },
  })[0].code, "DSH_PROFILE_CLIENT_ISOLATION_REQUIRED");
  assert.deepEqual(inspectCommunityClientIsolation({
    name: "@linxin666/dsh-chat-recovery",
    version: "0.2.5",
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web" },
    },
  }, {
    integrity: "sha512-vuPCcZfBgJijpVyNpb9VJgSuIB+7Zo+4RsZiDN3m6We3T7uekDcr1FlbcB4+xNKFCnxaJKCKb1ROBCoXbyCfbQ==",
  }), [{
    code: "DSH_PROFILE_CLIENT_SDK_MISMATCH",
    message: "@linxin666/dsh-chat-recovery@0.2.5 需要 DSH 0.1.0-rc.8，当前发行版固定为 0.1.0-rc.7",
  }]);
  assert.equal(inspectCommunityClientIsolation({
    name: "@linxin666/dsh-client-ui-task-board",
    version: "0.1.20",
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web" },
    },
  })[0].code, "DSH_PROFILE_CLIENT_INTEGRITY_MISSING");
  assert.equal(inspectProfileBundleCompatibility({
    name: "@linxin666/dsh-chat-recovery",
    version: "0.2.5",
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web" },
    },
  })[3].status, "sdk_migration_required");
});

test("only app-managed Bundles may request dsh-work host components", () => {
  const descriptor = {
    schema_version: 1,
    contributions: [{
      slot: "agent.workbench.tool",
      id: "browser",
      component: "dsh-work/browser",
      label: "浏览器",
      icon: "world",
      order: 20,
    }],
  };
  assert.throws(
    () => validateDshWorkProductDescriptor(descriptor, { packageName: "@example/community" }),
    { code: "DSH_PRODUCT_HOST_COMPONENT_FORBIDDEN" },
  );
  assert.doesNotThrow(() => validateDshWorkProductDescriptor(descriptor, {
    packageName: "@vibeinging/dsh-product-bridge",
    allowHostComponents: true,
  }));
});

test("Profile Bundle preflight rejects mutable sources without touching DSH", async () => {
  const service = new DshProfilePluginService({
    env: {},
    commandRunner: async () => { throw new Error("command runner must not be called"); },
  });
  assert.deepEqual(await service.preflight("github:dsh-external/DSH-better-sidebar#main"), {
    source: "github:dsh-external/DSH-better-sidebar#main",
    status: "invalid_source",
    installable: false,
    package_name: null,
    version: null,
    blockers: [{
      code: "DSH_PROFILE_SOURCE_NOT_PINNED",
      message: "来源必须是精确 npm 版本、github:<owner>/<repo>#<40位commit>，或已允许的本地包目录",
    }],
  });
});

test("the app-owned Profile Bundles use the current public SDK names", () => {
  for (const plugin of featuredPlugins()) {
    const packageDir = plugin.package_path.replace(/^packages\//, "");
    const manifest = JSON.parse(readFileSync(join(APP_ROOT, "packages", packageDir, "package.json"), "utf8"));
    assert.doesNotThrow(() => validateProfileBundleSdk(manifest));
    assert.equal(manifest.peerDependencies["@deepseek-ai/cordis"], "^4.0.1");
    assert.equal(manifest.peerDependencies.cordis, undefined);
  }
});

test("a current local Bundle passes the real isolated Profile preflight", {
  timeout: 30_000,
  skip: existsSync(join(DSH_NPM_ROOT, "package.json"))
    ? false
    : `missing app-pinned DSH package: ${DSH_NPM_ROOT}`,
}, async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-work-profile-preflight-"));
  try {
    const service = new DshProfilePluginService({
      env: {
        ...process.env,
        DSH_RUNTIME_DISTRIBUTION: "npm",
        DSH_RUNTIME_HOME: home,
        DSH_HOME: home,
        DSH_PROFILE_ALLOW_LOCAL_PLUGINS: "1",
      },
      restartRuntime: async () => ({ restarted: false, sessions: [] }),
    });
    const source = resolve(APP_ROOT, "eval", "fixtures", "dsh-profile-bundle");
    assert.deepEqual(await service.preflight(source), {
      source: `file:${source}`,
      status: "ready",
      installable: true,
      package_name: "dsh-work-profile-fixture",
      version: "1.0.0",
      surface: "host",
      compatibility_checks: [
        {
          id: "host",
          status: "profile_checked",
          label: "Host 与 Profile",
          message: "在隔离候选 Profile 中组合，安装脚本保持禁用",
        },
        {
          id: "session",
          status: "not_detected",
          label: "Session 生命周期",
          message: "清单未检测到 Session 或 Agent SDK 依赖",
        },
        {
          id: "capabilities",
          status: "not_detected",
          label: "Tool、Skill 与 MCP",
          message: "清单未检测到 Tool、Skill、MCP、Workflow 或模型 Provider SDK",
        },
        {
          id: "client",
          status: "not_detected",
          label: "Client UI",
          message: "Host-only Bundle，不需要桌面 Slot",
        },
      ],
      patch_summary: {
        row_count: 0,
        inserted_count: 0,
        overridden_count: 0,
        risk_categories: [],
        rows: [],
      },
      blockers: [],
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("the reviewed market release passes the real isolated Client preflight", {
  timeout: 30_000,
  skip: existsSync(join(DSH_NPM_ROOT, "package.json"))
    ? false
    : `missing app-pinned DSH package: ${DSH_NPM_ROOT}`,
}, async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-work-market-preflight-"));
  const source = join(home, "reviewed-market");
  try {
    await writeReviewedMarketFixture(source);
    const service = new DshProfilePluginService({
      env: {
        ...process.env,
        DSH_RUNTIME_DISTRIBUTION: "npm",
        DSH_RUNTIME_HOME: home,
        DSH_HOME: home,
        DSH_PROFILE_ALLOW_LOCAL_PLUGINS: "1",
      },
      restartRuntime: async () => ({ restarted: false, sessions: [] }),
    });
    const result = await service.preflight(source);
    assert.equal(result.status, "ready");
    assert.equal(result.installable, true);
    assert.equal(result.package_name, "dshmarket");
    assert.equal(result.version, "1.9.0");
    assert.equal(result.surface, "dsh_web");
    assert.equal(result.compatibility_checks.at(-1).status, "reviewed");
    assert.deepEqual(await service.install(source), {
      id: "dshmarket",
      pluginId: "dshmarket",
      name: "dshmarket",
      version: "1.9.0",
      surface: "dsh_web",
    });
    assert.deepEqual(await service.uninstall("dshmarket"), {
      id: "dshmarket",
      name: "dshmarket",
      surface: "dsh_web",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("known dsh-external samples are refused until their SDK pins are updated", {
  skip: ["dsh-agent-budget", "dsh-tool-search"].every((name) => (
    existsSync(resolve(APP_ROOT, "..", name, "package.json"))
  )) ? false : "dsh-external sample checkouts are not present",
}, () => {
  for (const packageDir of ["dsh-agent-budget", "dsh-tool-search"]) {
    const manifest = JSON.parse(readFileSync(resolve(APP_ROOT, "..", packageDir, "package.json"), "utf8"));
    assert.throws(() => validateProfileBundleSdk(manifest), { code: "DSH_PROFILE_LEGACY_SDK" });
  }
});

test("the Profile catalog is projected from the official Web Profile order", {
  timeout: 30_000,
  skip: existsSync(join(DSH_NPM_ROOT, "package.json"))
    ? false
    : `missing app-pinned DSH package: ${DSH_NPM_ROOT}`,
}, async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-work-profile-catalog-"));
  try {
    const service = new DshProfilePluginService({
      env: {
        ...process.env,
        DSH_RUNTIME_DISTRIBUTION: "npm",
        DSH_RUNTIME_HOME: home,
        DSH_HOME: home,
      },
      restartRuntime: async () => ({ restarted: false, sessions: [] }),
    });
    await ensureDshProfileInitialized({
      resolved: service.distribution(),
      dshHome: home,
      env: {
        ...service.env,
        DSH_HOME: home,
        DSH_FEATURED_PLUGIN_ALLOW_SOURCE: "1",
        DSH_FEATURED_PLUGIN_SOURCE_ROOT: APP_ROOT,
        DSH_FEATURED_PLUGIN_MANIFEST: "",
        DSH_FEATURED_PLUGIN_TARBALL_DIR: "",
        DSH_PROFILE_PLUGIN_LIBRARY: join(home, "plugin-library"),
      },
      appRoot: APP_ROOT,
    });
    const catalog = await service.catalog();
    assert.deepEqual(catalog.plugins.slice(0, 2).map((plugin) => plugin.id), [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
    ]);
    assert.deepEqual(catalog.plugins.slice(2).map((plugin) => plugin.id), featuredPluginNames());
    const productHostIpc = catalog.plugins.find((plugin) => plugin.id === "@vibeinging/dsh-work-product-host-ipc");
    assert.equal(productHostIpc.runtime_kind, "profile_bundle");
    assert.equal(productHostIpc.managed_by, "app");
    assert.deepEqual(productHostIpc.portability, {
      level: "desktop-adapter",
      surfaces: ["dsh-desktop"],
      host_requirements: ["dsh-work-parent-ipc", "browser-workspace-host"],
      compatibility_test: null,
    });
    const projectTools = catalog.plugins.find((plugin) => plugin.id === "@vibeinging/dsh-project-tools");
    assert.equal(projectTools.runtime_kind, "profile_bundle");
    assert.equal(projectTools.managed_by, "app");
    assert.deepEqual(projectTools.portability, {
      level: "desktop-adapter",
      surfaces: ["dsh-desktop"],
      host_requirements: ["product-host"],
      compatibility_test: null,
    });
    const canvasTools = catalog.plugins.find((plugin) => plugin.id === "@vibeinging/dsh-canvas-tools");
    assert.equal(canvasTools.runtime_kind, "profile_bundle");
    assert.equal(canvasTools.managed_by, "app");
    assert.deepEqual(canvasTools.portability, {
      level: "desktop-adapter",
      surfaces: ["dsh-desktop"],
      host_requirements: ["product-host"],
      compatibility_test: null,
    });
    const structuredUiTools = catalog.plugins.find((plugin) => plugin.id === "@vibeinging/dsh-structured-ui-tools");
    assert.equal(structuredUiTools.runtime_kind, "profile_bundle");
    assert.equal(structuredUiTools.managed_by, "app");
    assert.deepEqual(structuredUiTools.portability, {
      level: "desktop-adapter",
      surfaces: ["dsh-desktop"],
      host_requirements: ["product-host"],
      compatibility_test: null,
    });
    const modelInheritance = catalog.plugins.find((plugin) => plugin.id === "@vibeinging/dsh-model-inheritance");
    assert.equal(modelInheritance.runtime_kind, "profile_bundle");
    assert.equal(modelInheritance.managed_by, "app");
    assert.deepEqual(modelInheritance.portability, {
      level: "portable",
      surfaces: ["official-web", "dsh-desktop"],
      host_requirements: [],
      compatibility_test: "eval/tests/dsh-official-web-plugin-compat.test.mjs",
    });
    const productBridge = catalog.plugins.find((plugin) => plugin.id === "@vibeinging/dsh-product-bridge");
    assert.equal(productBridge.runtime_kind, "profile_bundle");
    assert.equal(productBridge.managed_by, "app");
    assert.equal(productBridge.can_uninstall, true);
    assert.deepEqual(productBridge.portability, {
      level: "desktop-adapter",
      surfaces: ["dsh-desktop"],
      host_requirements: ["product-host"],
      compatibility_test: null,
    });
    assert.equal(productBridge.product, null);
    const officeTools = catalog.plugins.find((plugin) => plugin.id === "@vibeinging/dsh-office-tools");
    assert.equal(officeTools.runtime_kind, "profile_bundle");
    assert.equal(officeTools.managed_by, "app");
    assert.deepEqual(officeTools.portability, {
      level: "desktop-adapter",
      surfaces: ["dsh-desktop"],
      host_requirements: ["office-artifact-host"],
      compatibility_test: null,
    });
    assert.equal(catalog.recommended_plugins_updated_at, "2026-08-21");
    assert.equal(catalog.recommended_plugins_source, "https://github.com/awesome-dsh-plugin/awesome-dsh-plugin");
    assert.equal(catalog.recommended_plugins[0].source, "dshmarket@1.9.0");
    assert.deepEqual(
      catalog.recommended_plugins.find((plugin) => plugin.id === "dsh-web-ui"),
      {
        id: "dsh-web-ui",
        name: "DSH Web UI",
        description: "Experiment-only aggregate Bundle; use independently reviewed child packages for release decisions.",
        description_zh: "仅用于兼容性实验的聚合 Bundle；发行决策必须基于独立审查的子包。",
        repository: "https://github.com/zhu1090093659/dsh-web-ui",
        stars: 2278,
        category: "collection",
        source: "@linxin666/dsh-web-ui-all@0.1.20",
        compatibility: "experiment-only-high-capability",
        release_policy: "never-default",
        reviewed_at: "2026-08-17",
        reviewed_commit: "92655dbefeaf08cb60429f4b487c33137889a3f7",
        package_integrity: "sha512-mPMXmPfO0rc/3hmv8Aw71UOJqTDVW2T3VWuN6dIgiMpDlRQp9O0BCaLh13j6LjH0WB9fAS+9DmUVix8sLLwNLA==",
        license: "Apache-2.0",
        asset_surface: "skin-assets",
        asset_review: {
          status: "blocked",
          redistribution: "blocked",
          asset_licenses: ["Apache-2.0", "CC-BY-NC-SA-4.0"],
          reason_zh: "上游皮肤包明确说明 Maid Atelier 资产使用 CC BY-NC-SA 4.0；当前没有可核对的商业再分发授权，因此聚合包不能进入发行包。",
          evidence: "https://www.npmjs.com/package/%40linxin666/dsh-skins",
          reviewed_at: "2026-08-21",
        },
        permissions: ["读取本地仓库与图片", "启动 Git、SSH 与电源保持进程", "访问 SSH、远程 Web 和模型服务网络"],
        review_note_zh: "全家桶含主机侧高权限能力。只允许精确的 0.1.20 包和 13 个同版本依赖进入 Client 图；安装前请确认这些权限符合你的环境。",
        priority: 20,
      },
    );
    assert.deepEqual(
      catalog.recommended_plugins.find((plugin) => plugin.id === "dsh-web-ui-task-board"),
      {
        id: "dsh-web-ui-task-board",
        name: "DSH Web UI Task Board",
        description: "Independent task-board Client Bundle for official DSH Web sessions.",
        description_zh: "面向官方 DSH Web Session 的独立任务看板 Client Bundle。",
        repository: "https://github.com/zhu1090093659/dsh-web-ui",
        stars: 2278,
        category: "productivity",
        source: "@linxin666/dsh-client-ui-task-board@0.1.20",
        compatibility: "reviewed-independent-client-candidate",
        release_policy: "optional-after-e2e",
        reviewed_at: "2026-08-20",
        reviewed_commit: "92655dbefeaf08cb60429f4b487c33137889a3f7",
        package_integrity: "sha512-7Llft+DOb8aPX8wz+5CVtkK8YoZSVBPQech+0pS7F2+YYlzgp6NWL5mEjtXhIlSjTplNwi5GC3c6BD1DzYm3EA==",
        license: "Apache-2.0",
        permissions: ["读取当前 DSH Session 与 Workspace", "写入任务看板数据", "按用户操作启动 DSH Session 任务"],
        review_note_zh: "独立于聚合包安装；不创建 Electron 启停器、插件市场或通用原生桥。完整发行资格仍需当前官方 Web 和 Electron 的安装、启动、停用、卸载、重启回归。",
        priority: 21,
      },
    );
    const skinCenter = catalog.recommended_plugins.find((plugin) => plugin.id === "dsh-web-ui-skin-center");
    assert.equal(skinCenter.compatibility, "asset-license-blocked");
    assert.equal(skinCenter.release_policy, "blocked-asset-redistribution");
    assert.deepEqual(skinCenter.asset_review, {
      status: "blocked",
      redistribution: "blocked",
      asset_licenses: ["Apache-2.0", "CC-BY-NC-SA-4.0"],
      reason_zh: "皮肤中心包内含 Maid Atelier 等内建资产；上游说明其中至少一组资产使用 CC BY-NC-SA 4.0，当前没有可核对的商业再分发授权。",
      evidence: "https://www.npmjs.com/package/%40linxin666/dsh-skins",
      reviewed_at: "2026-08-21",
    });
    assert.deepEqual(
      catalog.recommended_plugins.find((plugin) => plugin.id === "dsh-files"),
      {
        id: "dsh-files",
        name: "DSH Files",
        description: "File uploads, composer attachment cards, and document reading for PDF, DOCX, XLSX, and text.",
        description_zh: "提供文件上传、输入框附件卡，以及 PDF、DOCX、XLSX 和文本读取。",
        repository: "https://github.com/taxueseek/dsh-files",
        stars: 5,
        category: "files",
        source: "github:taxueseek/dsh-files#06ac5e2021344e95be0dabbeffecf7c28639c850",
        compatibility: "sdk-migration-required",
        checked_at: "2026-08-16",
        checked_commit: "06ac5e2021344e95be0dabbeffecf7c28639c850",
        preflight_blocker: "The package is not published to npm, and its @deepseek-ai/cordis peer range is '*' instead of the reviewed ^4.0.1 release line.",
        priority: 80,
      },
    );
    assert.deepEqual(
      catalog.recommended_plugins.find((plugin) => plugin.id === "dsh-native-memory"),
      {
        id: "dsh-native-memory",
        name: "DSH Native Memory",
        description: "Per-workspace long-term memory on official DSH storage, Session query, approval, Tool, and system-prompt seams.",
        description_zh: "基于官方 DSH 存储、Session 查询、审批、Tool 和系统提示词接口的工作区长期记忆。",
        repository: "https://github.com/highland0971/dsh-native-memory",
        stars: 0,
        category: "memory",
        source: "dsh-native-memory@0.2.0",
        compatibility: "profile-ready-host-reviewed",
        reviewed_at: "2026-08-16",
        reviewed_commit: "9acd2ca676fc58a8c8d7a17e59f2d39fcb4c9b58",
        package_integrity: "sha512-/GUOdYhZxlk+IiWPzVERWmwBq2zM60pV6nJAHBJIAoeRnsKiJi2a8aqKzxM9ZCaRvNEmUkiJvrpzvCuBTGQ3EQ==",
        priority: 95,
      },
    );
    assert.deepEqual(
      catalog.recommended_plugins.filter((plugin) => ["dsh-toolkit", "distill"].includes(plugin.id)).map((plugin) => ({
        id: plugin.id,
        stars: plugin.stars,
        compatibility: plugin.compatibility,
        checked_at: plugin.checked_at,
        checked_commit: plugin.checked_commit,
        preflight_blocker: plugin.preflight_blocker,
      })),
      [{
        id: "dsh-toolkit",
        stars: 19,
        compatibility: "sdk-migration-required",
        checked_at: "2026-08-16",
        checked_commit: "5d4628929aa2695cab7b4534670c0ca3c9cd7652",
        preflight_blocker: "Two DSH SDK dependency ranges do not match the exact 0.1.0-rc.7 release line.",
      }, {
        id: "distill",
        stars: 19,
        compatibility: "sdk-migration-required",
        checked_at: "2026-08-16",
        checked_commit: "d2aaa395adeffe88e429be796c12d829752cbad1",
        preflight_blocker: "Six DSH SDK dependencies still target the 0.1.0-rc.5 release line.",
      }],
    );
    assert.deepEqual(catalog.plugins.at(-1).ui_runtime, {
      kind: "host_only",
      client_graph: false,
    });
    const preflight = await service.preflightCurrentProfile({ targetVersion: "1.1.0" });
    assert.equal(preflight.ok, true);
    assert.equal(preflight.target_version, "1.1.0");
    assert.deepEqual(preflight.bundles.map((bundle) => bundle.id), catalog.plugins.map((plugin) => plugin.id));
    const manifestPath = join(home, "profiles", "web", "package.json");
    const manifestAfterPreflight = JSON.parse(await readFile(manifestPath, "utf8"));
    const disabledName = featuredPluginNames()[0];
    manifestAfterPreflight.dsh.profile.bundles = manifestAfterPreflight.dsh.profile.bundles.filter((name) => name !== disabledName);
    await writeFile(manifestPath, `${JSON.stringify(manifestAfterPreflight, null, 2)}\n`);
    const disabledState = await service.state();
    assert.equal(disabledState.plugins.find((plugin) => plugin.id === disabledName)?.enabled, false);
    assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).dsh.profile.bundles.includes(disabledName), false);
    assert.equal(catalog.plugins.some((plugin) => plugin.id === "@vibeinging/dsh-work-shell"), false);
    assert.equal(catalog.marketplaces[0].name, "web");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("an existing community dsh.client remains in the authoritative graph without app mutation", {
  timeout: 30_000,
  skip: existsSync(join(DSH_NPM_ROOT, "package.json"))
    ? false
    : `missing app-pinned DSH package: ${DSH_NPM_ROOT}`,
}, async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-work-profile-readonly-"));
  const profileDir = join(home, "profiles", "web");
  const packageDir = join(profileDir, "node_modules", "@example", "community-client");
  try {
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, "package.json"), `${JSON.stringify({
      name: "@example/community-client",
      version: "1.0.0",
      description: "Existing community Client fixture",
      dsh: {
        bundle: { patch: "./cordis.patch.yml" },
        client: { platform: "web" },
      },
      exports: { "./client": "./client.js" },
    }, null, 2)}\n`);
    await writeFile(join(packageDir, "cordis.patch.yml"), "- insert:\n    - id: example-community-client\n      name: '@example/community-client'\n");
    await writeFile(join(packageDir, "client.js"), "export default function apply() {}\n");
    await writeFile(join(profileDir, "package.json"), `${JSON.stringify({
      name: "dsh-profile-web",
      private: true,
      dependencies: { "@example/community-client": "1.0.0" },
      dsh: { profile: { bundles: [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@example/community-client",
      ] } },
    }, null, 2)}\n`);
    const before = await readFile(join(profileDir, "package.json"), "utf8");

    const service = new DshProfilePluginService({
      env: {
        ...process.env,
        DSH_RUNTIME_DISTRIBUTION: "npm",
        DSH_RUNTIME_HOME: home,
        DSH_HOME: home,
      },
      restartRuntime: async () => ({ restarted: false, sessions: [] }),
    });
    const catalog = await service.catalog();
    const plugin = catalog.plugins.find((item) => item.id === "@example/community-client");
    assert.equal(plugin.enabled, true);
    assert.equal(plugin.can_uninstall, true);
    assert.equal(plugin.ui_runtime.client_graph, true);
    assert.equal(plugin.ui_runtime.isolation, undefined);

    const stored = JSON.parse(await readFile(join(profileDir, "package.json"), "utf8"));
    assert.equal(await readFile(join(profileDir, "package.json"), "utf8"), before);
    assert.equal(stored.dsh.profile.bundles.includes("@example/community-client"), true);
    assert.equal(stored.dependencies["@example/community-client"], "1.0.0");

    await writeFile(join(home, "cordis.patch.yml"), "- id: example-community-client\n  disabled: true\n");
    const disabledCatalog = await service.catalog();
    const disabledPlugin = disabledCatalog.plugins.find((item) => item.id === "@example/community-client");
    assert.equal(disabledPlugin.enabled, false);
    assert.equal(disabledPlugin.ui_runtime.client_graph, false);
    assert.equal(await readFile(join(profileDir, "package.json"), "utf8"), before);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a user-removed curated Bundle is not restored by a read-only catalog query", {
  timeout: 30_000,
  skip: existsSync(join(DSH_NPM_ROOT, "package.json"))
    ? false
    : `missing app-pinned DSH package: ${DSH_NPM_ROOT}`,
}, async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-work-profile-user-removed-"));
  const profileDir = join(home, "profiles", "web");
  try {
    await mkdir(profileDir, { recursive: true });
    const manifest = {
      name: "dsh-profile-web",
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } },
    };
    const before = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(profileDir, "package.json"), before);
    const service = new DshProfilePluginService({
      env: {
        ...process.env,
        DSH_RUNTIME_DISTRIBUTION: "npm",
        DSH_RUNTIME_HOME: home,
        DSH_HOME: home,
      },
      restartRuntime: async () => ({ restarted: false, sessions: [] }),
    });
    const catalog = await service.catalog();
    assert.deepEqual(catalog.plugins.map((plugin) => plugin.id), manifest.dsh.profile.bundles);
    assert.deepEqual(catalog.featured_plugin_ids, featuredPluginNames());
    assert.equal(await readFile(join(profileDir, "package.json"), "utf8"), before);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
