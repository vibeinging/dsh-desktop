import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
  isReviewedCommunityClient,
  prepareTrustedClientPlugins,
  prepareTrustedProfilePlugins,
  reviewedCommunityClientReview,
} from "../../server/src/engine/dsh_runtime/trusted_client_plugins.js";

async function fixture(root, name = "@deepseek-ai/dsh-product-bridge", { client = false, version = "1.0.0" } = {}) {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "index.js"), "export default function apply() {}\n");
  await writeFile(join(root, "cordis.patch.yml"), "- insert: []\n");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name,
    version,
    type: "module",
    main: "./src/index.js",
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      ...(client ? { client: { platform: "web" } } : {}),
    },
    dshWork: {
      portability: {
        level: name === "@deepseek-ai/dsh-product-bridge" ? "desktop-adapter" : "portable",
        surfaces: name === "@deepseek-ai/dsh-product-bridge" ? ["dsh-desktop"] : ["official-web", "dsh-desktop"],
        hostRequirements: name === "@deepseek-ai/dsh-product-bridge" ? ["product-host"] : [],
      },
    },
  }, null, 2)}\n`);
}

const DSH_WEB_UI_DEPENDENCIES = {
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
};

test("only audited community Client releases may enter the product Client graph", () => {
  assert.equal(isReviewedCommunityClient({
    name: "dshmarket",
    manifest: { version: "1.9.0" },
  }), true);
  assert.equal(isReviewedCommunityClient({
    name: "dshmarket",
    manifest: { version: "1.9.1" },
  }), false);
  assert.equal(isReviewedCommunityClient({
    name: "another-client",
    manifest: { version: "1.9.0" },
  }), false);
  assert.equal(isReviewedCommunityClient({
    name: "another-client",
    manifest: {},
  }), false);
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-web-ui-all",
    manifest: {
      version: "0.1.20",
      dependencies: DSH_WEB_UI_DEPENDENCIES,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
  }), true);
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-web-ui-all",
    manifest: {
      version: "0.1.20",
      dependencies: { ...DSH_WEB_UI_DEPENDENCIES, "@linxin666/dsh-ssh": "0.1.21" },
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
  }), false);
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-web-ui-all",
    manifest: {
      version: "0.1.20",
      dependencies: DSH_WEB_UI_DEPENDENCIES,
      dsh: { bundle: { patch: "./other.patch.yml" } },
    },
  }), false);
  assert.deepEqual(reviewedCommunityClientReview({
    name: "@linxin666/dsh-web-ui-all",
    manifest: {
      version: "0.1.20",
      dependencies: DSH_WEB_UI_DEPENDENCIES,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
  }), {
    session: "任务看板会读取 Session 与 Workspace，并可从看板启动 Agent 任务",
    capabilities: [
      "读取本地仓库与图片",
      "启动 Git、SSH 与电源保持进程",
      "访问 SSH、远程 Web 和模型服务网络",
    ],
  });
});

test("reviewed aggregate dependencies are exposed to and removed from the Profile resolver", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-reviewed-aggregate-"));
  const home = join(root, "home");
  const profileDir = join(home, "profiles", "web");
  const aggregateRoot = join(root, "aggregate");
  try {
    await mkdir(join(aggregateRoot, "node_modules"), { recursive: true });
    await writeFile(join(aggregateRoot, "package.json"), `${JSON.stringify({
      name: "@linxin666/dsh-web-ui-all",
      version: "0.1.20",
      dependencies: DSH_WEB_UI_DEPENDENCIES,
      dsh: {
        bundle: { patch: "./cordis.patch.yml" },
        client: { platform: "web" },
      },
    }, null, 2)}\n`);
    await writeFile(join(aggregateRoot, "cordis.patch.yml"), "- insert: []\n");
    for (const [name, version] of Object.entries(DSH_WEB_UI_DEPENDENCIES)) {
      const dependencyRoot = join(aggregateRoot, "node_modules", ...name.split("/"));
      await mkdir(dependencyRoot, { recursive: true });
      await writeFile(join(dependencyRoot, "package.json"), `${JSON.stringify({ name, version })}\n`);
    }
    await mkdir(join(profileDir, "node_modules", "@linxin666"), { recursive: true });
    await symlink(aggregateRoot, join(profileDir, "node_modules", "@linxin666", "dsh-web-ui-all"), "junction");
    await writeFile(join(profileDir, "package.json"), `${JSON.stringify({
      name: "dsh-profile-web",
      private: true,
      dependencies: { "@linxin666/dsh-web-ui-all": "0.1.20" },
      dsh: { profile: { bundles: [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@linxin666/dsh-web-ui-all",
      ] } },
    }, null, 2)}\n`);

    const api = profileApi();
    const first = await prepareTrustedProfilePlugins({
      profileApi: api,
      installAnchor: join(root, "anchor.js"),
      appRoot: join(root, "app"),
      env: { DSH_HOME: home },
      runtimeRoot: join(root, "runtime"),
      dshHome: home,
    });
    assert.deepEqual(first.reviewed.map((plugin) => plugin.name), ["@linxin666/dsh-web-ui-all"]);
    for (const name of Object.keys(DSH_WEB_UI_DEPENDENCIES)) {
      const link = join(profileDir, "node_modules", ...name.split("/"));
      assert.equal((await lstat(link)).isSymbolicLink(), true, name);
      assert.equal(await realpath(link), await realpath(join(aggregateRoot, "node_modules", ...name.split("/"))), name);
    }

    await writeFile(join(profileDir, "package.json"), `${JSON.stringify({
      name: "dsh-profile-web",
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } },
    }, null, 2)}\n`);
    await prepareTrustedProfilePlugins({
      profileApi: api,
      installAnchor: join(root, "anchor.js"),
      appRoot: join(root, "app"),
      env: { DSH_HOME: home },
      runtimeRoot: join(root, "runtime"),
      dshHome: home,
    });
    for (const name of Object.keys(DSH_WEB_UI_DEPENDENCIES)) {
      assert.equal(existsSync(join(profileDir, "node_modules", ...name.split("/"))), false, name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function profileApi() {
  return {
    PROFILE_TEMPLATES: {
      web: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
    },
    DEFAULT_PROFILE_BUNDLES: ["@deepseek-ai/dsh-base"],
    resolveProfileDir(name, home) {
      return join(home, "profiles", name);
    },
    initProfile(dir, bundles) {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, "package.json");
      if (!existsSync(path)) {
        writeFileSync(path, `${JSON.stringify({
          name: "dsh-profile-web",
          private: true,
          dependencies: {},
          dsh: { profile: { bundles: [...bundles] } },
        }, null, 2)}\n`);
      }
    },
    readProfileManifest(_name, dir) {
      return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    },
    writeProfileManifest(dir, manifest) {
      writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    },
    resolveBundleDir(_name, packageName, _installAnchor, dir) {
      return join(dir, "node_modules", ...packageName.split("/"));
    },
  };
}

test("trusted DSH plugins use an exact allowlist and profile resolver link", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-trusted-client-"));
  const pluginRoot = join(root, "plugin");
  const dshHome = join(root, "home");
  try {
    await fixture(pluginRoot);
    const retiredLink = join(dshHome, "profiles", "node_modules", "@deepseek-ai", "dsh-turn-navigator");
    await mkdir(dirname(retiredLink), { recursive: true });
    await symlink(pluginRoot, retiredLink, "junction");
    const prepared = prepareTrustedClientPlugins({
      appRoot: join(root, "app"),
      env: { DSH_HOME: dshHome, DSH_PRODUCT_BRIDGE_ROOT: pluginRoot },
      runtimeRoot: join(root, "runtime"),
      dshHome,
    });
    const realPluginRoot = await realpath(pluginRoot);
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].name, "@deepseek-ai/dsh-product-bridge");
    assert.equal(prepared[0].portability, "desktop-adapter");
    assert.equal(prepared[0].patch, resolve(realPluginRoot, "cordis.patch.yml"));
    assert.equal(prepared[0].entry, resolve(realPluginRoot, "src/index.js"));
    const link = join(dshHome, "profiles", "node_modules", "@deepseek-ai", "dsh-product-bridge");
    assert.equal((await lstat(link)).isSymbolicLink(), true);
    assert.equal(resolve(dirname(link), await readlink(link)), realPluginRoot);
    assert.equal(existsSync(retiredLink), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("trusted app Bundles fail when their portability boundary drifts", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-trusted-portability-"));
  const pluginRoot = join(root, "plugin");
  try {
    await fixture(pluginRoot);
    const manifestPath = join(pluginRoot, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dshWork.portability.level = "portable";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => prepareTrustedClientPlugins({
      appRoot: join(root, "app"),
      env: { DSH_HOME: join(root, "home"), DSH_PRODUCT_BRIDGE_ROOT: pluginRoot },
      runtimeRoot: join(root, "runtime"),
    }), /portability\.level=desktop-adapter/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("trusted client plugins reject a configured package with the wrong identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-trusted-client-bad-"));
  const pluginRoot = join(root, "plugin");
  try {
    await fixture(pluginRoot, "@example/not-trusted");
    assert.throws(() => prepareTrustedClientPlugins({
      appRoot: join(root, "app"),
      env: { DSH_HOME: join(root, "home"), DSH_PRODUCT_BRIDGE_ROOT: pluginRoot },
      runtimeRoot: join(root, "runtime"),
    }), /包名不匹配/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing optional app package leaves the profile unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-trusted-client-missing-"));
  try {
    assert.deepEqual(prepareTrustedClientPlugins({
      appRoot: join(root, "app"),
      env: { DSH_HOME: join(root, "home"), DSH_RUNTIME_DISTRIBUTION: "source" },
      runtimeRoot: join(root, "runtime"),
    }), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("trusted DSH plugins are composed by the official Profile bundle list", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-trusted-profile-"));
  const pluginRoot = join(root, "plugin");
  const dshHome = join(root, "home");
  const profileDir = join(dshHome, "profiles", "web");
  try {
    await fixture(pluginRoot);
    await mkdir(profileDir, { recursive: true });
    await fixture(join(profileDir, "node_modules", "@example", "user-bundle"), "@example/user-bundle");
    await fixture(
      join(profileDir, "node_modules", "@example", "community-ui"),
      "@example/community-ui",
      { client: true },
    );
    await fixture(
      join(profileDir, "node_modules", "dshmarket"),
      "dshmarket",
      { client: true, version: "1.9.0" },
    );
    await writeFile(join(profileDir, "package.json"), `${JSON.stringify({
      name: "dsh-profile-web",
      private: true,
      dependencies: {
        "@deepseek-ai/dsh-product-client": "file:/retired-product-client",
        "@deepseek-ai/dsh-turn-navigator": "file:/retired-turn-navigator",
        "@example/user-bundle": "1.0.0",
        "@example/community-ui": "1.0.0",
        dshmarket: "1.9.0",
      },
      dsh: { profile: { bundles: [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-product-client",
        "@deepseek-ai/dsh-turn-navigator",
        "@example/user-bundle",
        "@example/community-ui",
        "dshmarket",
      ] } },
    }, null, 2)}\n`);

    const first = await prepareTrustedProfilePlugins({
      profileApi: profileApi(),
      installAnchor: join(root, "dsh", "package.json"),
      appRoot: join(root, "app"),
      env: { DSH_HOME: dshHome, DSH_PRODUCT_BRIDGE_ROOT: pluginRoot },
      runtimeRoot: join(root, "runtime"),
      dshHome,
    });
    assert.equal(first.changed, true);
    assert.deepEqual(first.bundles, [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "@deepseek-ai/dsh-product-bridge",
      "@example/user-bundle",
      "dshmarket",
    ]);
    assert.deepEqual(first.quarantined.map((plugin) => plugin.name), ["@example/community-ui"]);
    const stored = JSON.parse(await readFile(join(profileDir, "package.json"), "utf8"));
    assert.deepEqual(stored.dependencies, {
      "@example/user-bundle": "1.0.0",
      "@example/community-ui": "1.0.0",
      dshmarket: "1.9.0",
    });
    assert.deepEqual(stored.dsh.profile.bundles, first.bundles);
    assert.equal(first.bundles.includes("dshmarket"), true);
    assert.deepEqual(first.reviewed.map((plugin) => plugin.name), ["dshmarket"]);

    const second = await prepareTrustedProfilePlugins({
      profileApi: profileApi(),
      installAnchor: join(root, "dsh", "package.json"),
      appRoot: join(root, "app"),
      env: { DSH_HOME: dshHome, DSH_PRODUCT_BRIDGE_ROOT: pluginRoot },
      runtimeRoot: join(root, "runtime"),
      dshHome,
    });
    assert.equal(second.changed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
