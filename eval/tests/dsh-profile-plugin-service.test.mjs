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
import {
  generateFeaturedPluginArtifacts,
  projectFeaturedRegistryManifest,
} from "../../scripts/generate-featured-plugin-artifacts.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DSH_NPM_ROOT = resolve(APP_ROOT, "server/node_modules/@deepseek-ai/dsh");
const DSH_MARKET_INTEGRITY = "sha512-DQRK0dg0duXhDOqw6LWy5m6GkG3oLiTXC9pM6W9mi1gCbqM1ofgSPuyPOGCsE+06qHsiF65j/urpvCyvhhCPNw==";
const DSH_MARKET_DEPENDENCIES = { "js-yaml": "^4.1.0", undici: "^7.29.0" };

async function writeReviewedMarketFixture(root) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "index.js"), "export default function apply() {}\n");
  await writeFile(join(root, "client.js"), "export default function apply() {}\n");
  await writeFile(join(root, "cordis.patch.yml"), "- insert:\n    - id: reviewed-market-fixture\n      name: dshmarket\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "dshmarket",
    version: "1.17.1",
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
    dependencies: DSH_MARKET_DEPENDENCIES,
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

test("Profile mutations reject success when the final graph does not match", async () => {
  const service = new DshProfilePluginService({ env: {} });
  service.state = async () => ({ plugins: [] });
  service.run = async () => {};
  await assert.rejects(
    service.verifyMutation({
      resolved: {},
      dshHome: "/tmp/dsh-profile-verification",
      packageName: "@example/plugin",
      installed: true,
    }),
    { code: "DSH_PROFILE_MUTATION_VERIFY_FAILED" },
  );
});

test("Profile mutations propagate final DSH graph failures", async () => {
  const service = new DshProfilePluginService({ env: {} });
  service.state = async () => ({ plugins: [{ id: "@example/plugin" }] });
  service.run = async () => { throw new Error("final graph rejected"); };
  await assert.rejects(
    service.verifyMutation({
      resolved: {},
      dshHome: "/tmp/dsh-profile-verification",
      packageName: "@example/plugin",
      installed: true,
    }),
    /final graph rejected/,
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
      "@deepseek-ai/dsh-agent": "^0.1.5-rc.1",
      "@deepseek-ai/dsh-tools": "^0.1.5-rc.1",
      "@deepseek-ai/dsh-mcp-client": "^0.1.5-rc.1",
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
    version: "1.17.1",
    dependencies: DSH_MARKET_DEPENDENCIES,
    dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
  }, {
    integrity: DSH_MARKET_INTEGRITY,
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
      "@deepseek-ai/cordis": "^4.0.2",
      "@deepseek-ai/dsh-tools": "^0.1.5-rc.1",
    },
  }));
  assert.doesNotThrow(() => validateProfileBundleSdk({
    name: "@example/current-compatible-prerelease-range",
    peerDependencies: {
      "@deepseek-ai/dsh-agent": "^0.1.5-rc.1",
      "@deepseek-ai/dsh-commands": "^0.1.5-rc.1",
    },
  }));
  assert.doesNotThrow(() => validateProfileBundleSdk({
    name: "ds-harness-remote",
    version: "0.4.1",
    dependencies: {
      "@deepseek-ai/schemastery": "^3.18.1",
      qrcode: "^1.5.4",
      werift: "0.24.4",
      zod: "^3.24.1",
    },
    peerDependencies: {
      "@deepseek-ai/cordis": ">=4.0.1 <5",
      "@deepseek-ai/dsh-api-gateway": ">=0.1.1-rc.2 <0.1.2 || >=0.1.5-rc.1 <0.2.0",
      "@deepseek-ai/dsh-settings": ">=0.1.0-rc.6 <0.1.2 || >=0.1.5-rc.1 <0.2.0",
    },
    dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
  }));
  assert.throws(() => validateProfileBundleSdk({
    name: "@example/older-prerelease-line",
    peerDependencies: { "@deepseek-ai/dsh-agent": "^0.1.0-rc.8" },
  }), { code: "DSH_PROFILE_LEGACY_SDK" });
  assert.throws(() => validateProfileBundleSdk({
    name: "@example/unbounded-sdk-range",
    peerDependencies: { "@deepseek-ai/dsh-agent": "*" },
  }), { code: "DSH_PROFILE_LEGACY_SDK" });
  assert.doesNotThrow(() => validateProfileBundleSdk({
    name: "@example/current-with-optional-legacy-peer",
    peerDependencies: {
      "@deepseek-ai/cordis": "^4.0.2",
      "@deepseek-ai/dsh-tools": "^0.1.5-rc.1",
      cordis: "^4.0.0-rc.7",
    },
    peerDependenciesMeta: { cordis: { optional: true } },
  }));
  assert.throws(() => validateProfileBundleSdk({
    name: "@example/legacy-runtime-cordis",
    dependencies: {
      "@deepseek-ai/cordis": "^4.0.2",
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
      message: "dsh-better-sidebar 有 1 个 DSH SDK 包不属于当前 0.1.5-rc.1 发布线",
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
        inject: ["@deepseek-ai/dsh-client-ui-slots"],
      },
    },
    exports: { "./client": { default: "./lib/client.js" } },
    peerDependencies: {
      "@deepseek-ai/cordis": "^4.0.2",
      "@deepseek-ai/dsh-client-ui-slots": "^0.1.5-rc.1",
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
    version: "1.17.1",
    dependencies: DSH_MARKET_DEPENDENCIES,
    dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
  }, { integrity: DSH_MARKET_INTEGRITY }), []);
  assert.equal(inspectCommunityClientIsolation({
    name: "dshmarket",
    version: "1.17.0",
    dsh: { client: { platform: "web" } },
  }, { integrity: DSH_MARKET_INTEGRITY })[0].code, "DSH_PROFILE_CLIENT_ISOLATION_REQUIRED");
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
    message: "@linxin666/dsh-chat-recovery@0.2.5 需要 DSH 0.1.0-rc.8，当前发行版固定为 0.1.5-rc.1",
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
    const sourceManifest = JSON.parse(readFileSync(join(APP_ROOT, plugin.package_path, "package.json"), "utf8"));
    const manifest = projectFeaturedRegistryManifest(plugin, sourceManifest);
    assert.doesNotThrow(() => validateProfileBundleSdk(manifest));
    if (plugin.evidence.source_kind === "workspace-package") {
      assert.equal(manifest.peerDependencies["@deepseek-ai/cordis"], "^4.0.1");
      assert.equal(manifest.peerDependencies.cordis, undefined);
    }
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

test("a local package cannot impersonate the reviewed bundled market", {
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
    assert.equal(result.status, "migration_required");
    assert.equal(result.installable, false);
    assert.equal(result.blockers[0].code, "DSH_PROFILE_CLIENT_INTEGRITY_MISSING");
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
  timeout: 120_000,
  skip: existsSync(join(DSH_NPM_ROOT, "package.json"))
    ? false
    : `missing app-pinned DSH package: ${DSH_NPM_ROOT}`,
}, async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-work-profile-catalog-"));
  try {
    const artifactDir = join(home, "featured-plugins");
    await generateFeaturedPluginArtifacts({ appRoot: APP_ROOT, outputDir: artifactDir });
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
        DSH_FEATURED_PLUGIN_MANIFEST: join(artifactDir, "manifest.json"),
        DSH_FEATURED_PLUGIN_TARBALL_DIR: artifactDir,
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
    for (const featured of featuredPlugins()) {
      const plugin = catalog.plugins.find((item) => item.id === featured.name);
      const packageManifest = JSON.parse(readFileSync(
        join(APP_ROOT, featured.package_path, "package.json"),
        "utf8",
      ));
      const portability = packageManifest.dshWork?.portability;
      assert.equal(plugin.runtime_kind, "profile_bundle");
      assert.equal(plugin.managed_by, "app");
      assert.deepEqual(plugin.portability, portability ? {
        level: portability.level,
        surfaces: portability.surfaces,
        host_requirements: portability.hostRequirements,
        compatibility_test: portability.compatibilityTest || null,
      } : {
        level: featured.portability,
        surfaces: ["official-web", "dsh-desktop"],
        host_requirements: featured.permissions,
        compatibility_test: featured.evidence.regression.electron[0],
      });
    }
    const productBridge = catalog.plugins.find((plugin) => plugin.id.endsWith("/dsh-product-bridge"));
    assert.equal(productBridge.can_uninstall, true);
    const productHost = catalog.plugins.find((plugin) => plugin.id === "@vibeinging/dsh-work-product-host-ipc");
    assert.equal(productHost.can_uninstall, false);
    assert.equal(productHost.readonly, true);
    await assert.rejects(
      () => service.uninstall("@vibeinging/dsh-work-product-host-ipc"),
      { code: "PLUGIN_UNINSTALL_NOT_ALLOWED" },
    );
    assert.equal(productBridge.product, null);
    assert.equal(catalog.recommended_plugins_updated_at, "2026-08-31");
    assert.equal(catalog.recommended_plugins_source, "https://github.com/awesome-dsh-plugin/awesome-dsh-plugin");
    assert.equal(catalog.recommended_plugins[0].source, "dshmarket@1.17.1");
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
        source: "@linxin666/dsh-client-ui-task-board@0.3.9",
        compatibility: "bundled-default-alpha-native",
        release_policy: "bundled-default",
        reviewed_at: "2026-08-31",
        package_integrity: "sha512-xkjPPZCLH4AjNnTb2RGG9nMXzsFuCBFdcucYnL3UMaHs6/G+rADZpneyHNKeVggGlqSkbZ7qnM43zEYfudzjgw==",
        package_size_bytes: 1193256,
        license: "Apache-2.0",
        permissions: ["读取当前 DSH Session、Workspace 与完成历史", "在 DSH_HOME 写入任务账本和执行记录", "按用户操作或 Host cron 启动 DSH Session 任务", "可选启动固定的跨平台防休眠 helper"],
        native_dependencies: [],
        install_scripts: [],
        review_note_zh: "作为独立 Bundle 内置，不安装聚合包；0.3.9 原生声明 DSH >=0.1.5-rc.1，并改用 Typert Gateway 与 Workspace Registry。Host 侧持有任务账本、cron 调度和默认关闭的防休眠 helper，不创建 Electron 启停器、插件市场或通用原生桥。",
        priority: 21,
      },
    );
    assert.deepEqual(
      catalog.recommended_plugins.find((plugin) => plugin.id === "ds-harness-remote"),
      {
        id: "ds-harness-remote",
        name: "DSH Remote",
        description: "Continue the current Harness from Android, Remote Web, or another Desktop over an encrypted remote channel.",
        description_zh: "通过加密远程通道，从 Android、Remote Web 或另一台 Desktop 继续使用当前 Harness。",
        repository: "https://github.com/liguobao/ds-harness-remote",
        stars: 130,
        category: "remote",
        source: "ds-harness-remote@0.4.1",
        compatibility: "bundled-default-alpha-reviewed",
        release_policy: "bundled-default-user-manageable",
        reviewed_at: "2026-08-31",
        reviewed_commit: "814a0dd45f1c971995c0cc93319fdced20c69749",
        package_integrity: "sha512-W5VHmYNbvieggO4vDvvhG2dT401/TcS+fnVuJbWzLQR5D9HTAeYy+oO/Dlknr4/FVm9RnlUYEjDJk7bUpqz4Kg==",
        package_size_bytes: 3417598,
        license: "MIT",
        license_note_zh: "上游 npm 包的 package.json 没有 license 字段，但 tarball 内 LICENSE 是 MIT 原文；发行投影补写 MIT，并按 LICENSE SHA-256 固定。",
        permissions: [
          "连接 dsh.r2049.cn 的外部账号、设备目录、信令、TURN 与 Relay 服务",
          "从同一账号下的 Web、Android 或另一台 Desktop 读取并控制当前 Harness 的 Workspace、Session、模型、权限、设置与凭据写入",
          "使用长期 X25519 设备身份和 Noise IK 端到端加密；托管服务仍可见账号、设备、连接时间、流量大小与必要网络元数据",
          "通过固定 Harness API 白名单运行远程请求；不开放直接 Shell、PTY 或通用文件 RPC，但 Harness Agent 仍可按原权限运行工具",
        ],
        native_dependencies: ["可选 @roamhq/wrtc 原生 WebRTC；安装脚本禁用时自动回退到纯 TypeScript werift 或加密 Relay"],
        ignored_dependency_lifecycle_scripts: ["@roamhq/wrtc 可选原生构建脚本"],
        review_note_zh: "作为可卸载的默认 Bundle 固定到 npm 0.4.1，并通过完整性、依赖、Client 图、Profile 初始化和 Electron 启动检查。Host 不开放公网监听端口，业务流量使用 Noise IK 加密，并在 WebRTC 不可用时回退加密 Relay。插件默认连接第三方 dsh.r2049.cn；只有用户登录并启用当前电脑后才提供远程访问。该项目尚无受支持的自建 Server，独立密码安全审查、真实双机跨网和长期稳定性验证仍未完成。",
        priority: 22,
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
        preflight_blocker: "Two DSH SDK dependency ranges do not match the exact 0.1.5-rc.1 release line.",
      }, {
        id: "distill",
        stars: 19,
        compatibility: "sdk-migration-required",
        checked_at: "2026-08-16",
        checked_commit: "d2aaa395adeffe88e429be796c12d829752cbad1",
        preflight_blocker: "Six DSH SDK dependencies still target the 0.1.0-rc.5 release line.",
      }],
    );
    assert.deepEqual(catalog.plugins.find((plugin) => plugin.id === "@linxin666/dsh-client-ui-task-board").ui_runtime, {
      kind: "dsh_client",
      client_graph: true,
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
