import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";

import {
  controlledDshPluginEnvironment,
  dshCommandWorkingDirectory,
  ensureDshProfileInitialized,
  unlinkStagingProfileFallbacks,
} from "../../server/src/engine/dsh_runtime/profile_initialization.js";
import {
  featuredPluginNames,
  featuredPlugins,
} from "../../server/src/engine/dsh_runtime/featured_plugins.js";

const APP_ROOT = resolve(import.meta.dirname, "../..");
const BASE_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];

function profileApi() {
  return {
    PROFILE_TEMPLATES: { web: BASE_BUNDLES },
    DEFAULT_PROFILE_BUNDLES: BASE_BUNDLES,
    resolveProfileDir(name, home) {
      return join(home, "profiles", name);
    },
    initProfile(dir, bundles) {
      if (existsSync(join(dir, "package.json"))) return;
      return mkdir(dir, { recursive: true }).then(() => writeFile(join(dir, "package.json"), `${JSON.stringify({
        name: "dsh-profile-web",
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: [...bundles] } },
      }, null, 2)}\n`));
    },
    readProfileManifest(_name, dir) {
      return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    },
  };
}

function sourceEnvironment(home) {
  return {
    ...process.env,
    DSH_RUNTIME_DISTRIBUTION: "source",
    DSH_FEATURED_PLUGIN_ALLOW_SOURCE: "1",
    DSH_FEATURED_PLUGIN_SOURCE_ROOT: APP_ROOT,
    DSH_PROFILE_PLUGIN_LIBRARY: join(home, "plugin-library"),
    DSH_HOME: home,
  };
}

test("official plugin commands use DSH Home instead of the application install directory", () => {
  assert.equal(
    dshCommandWorkingDirectory({ root: "/read-only/app/dsh" }, { DSH_HOME: "/user/data/dsh" }),
    resolve("/user/data/dsh"),
  );
  assert.equal(
    dshCommandWorkingDirectory({ root: "/read-only/app/dsh" }, {}),
    "/read-only/app/dsh",
  );
});

test("atomic Profile cleanup unlinks installation fallbacks without deleting their targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-profile-fallback-cleanup-"));
  try {
    const stagingHome = join(root, "staging");
    const installedPackage = join(root, "application", "node_modules", "@deepseek-ai", "dsh");
    const fallback = join(stagingHome, "profiles", "node_modules", "@deepseek-ai", "dsh");
    await mkdir(installedPackage, { recursive: true });
    await mkdir(resolve(fallback, ".."), { recursive: true });
    await writeFile(join(installedPackage, "package.json"), '{"name":"@deepseek-ai/dsh"}\n');
    await symlink(installedPackage, fallback, process.platform === "win32" ? "junction" : "dir");
    assert.equal(unlinkStagingProfileFallbacks(stagingHome), 1);
    assert.equal(existsSync(fallback), false);
    assert.equal(existsSync(join(installedPackage, "package.json")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("controlled plugin commands use the packaged pnpm path and stable store", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-controlled-pnpm-"));
  try {
    const binDir = join(root, "pnpm-bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "pnpm"), "#!/bin/sh\n");
    const env = controlledDshPluginEnvironment({
      PATH: "/system/path",
      DSH_PNPM_BIN_DIR: binDir,
      DSH_PNPM_REQUIRED: "1",
      DSH_HOME: root,
    }, { dshHome: root, libraryRoot: join(root, "library") });
    assert.equal(env.PATH.startsWith(`${binDir}${delimiter}`), true);
    assert.equal(env.DSH_PNPM_NODE_BIN, process.execPath);
    assert.equal(env.pnpm_config_store_dir, resolve(root, "library", "store"));
    assert.equal(env.npm_config_auto_install_peers, "false");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an existing Profile is read-only even when the release inputs are unavailable", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-profile-existing-readonly-"));
  try {
    const api = profileApi();
    const profileDir = api.resolveProfileDir("web", home);
    await api.initProfile(profileDir, BASE_BUNDLES);
    const before = await readFile(join(profileDir, "package.json"), "utf8");
    let commands = 0;
    const result = await ensureDshProfileInitialized({
      resolved: { appBootPath: "unused" },
      dshHome: home,
      env: {
        ...sourceEnvironment(home),
        DSH_FEATURED_PLUGIN_ALLOW_SOURCE: "0",
        DSH_FEATURED_PLUGIN_MANIFEST: join(home, "missing-manifest.json"),
      },
      appRoot: APP_ROOT,
      profileApi: api,
      commandRunner: async () => { commands += 1; },
    });
    assert.deepEqual(result, {
      created: false,
      profileDir,
      initialized: false,
    });
    assert.equal(commands, 0);
    assert.equal(await readFile(join(profileDir, "package.json"), "utf8"), before);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a user-disabled Bundle stays out of the layer list on restart", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-profile-disabled-readonly-"));
  try {
    const api = profileApi();
    const profileDir = api.resolveProfileDir("web", home);
    await api.initProfile(profileDir, BASE_BUNDLES);
    const manifestPath = join(profileDir, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dependencies = { [featuredPluginNames()[0]]: "file:../plugin-library/tarballs/disabled.tgz" };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const before = await readFile(manifestPath, "utf8");
    let commands = 0;
    const result = await ensureDshProfileInitialized({
      resolved: { appBootPath: "unused" },
      dshHome: home,
      env: {
        ...sourceEnvironment(home),
        DSH_FEATURED_PLUGIN_ALLOW_SOURCE: "0",
        DSH_FEATURED_PLUGIN_MANIFEST: join(home, "missing-manifest.json"),
      },
      appRoot: APP_ROOT,
      profileApi: api,
      commandRunner: async () => { commands += 1; },
    });
    assert.equal(result.created, false);
    assert.equal(commands, 0);
    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")).dsh.profile.bundles, BASE_BUNDLES);
    assert.equal(await readFile(manifestPath, "utf8"), before);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("new Profile publication is atomic when an official command fails", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-profile-atomic-failure-"));
  try {
    const api = profileApi();
    await assert.rejects(
      ensureDshProfileInitialized({
        resolved: { appBootPath: "unused" },
        dshHome: home,
        env: sourceEnvironment(home),
        appRoot: APP_ROOT,
        profileApi: api,
        commandRunner: async () => {
          throw new Error("official command failed");
        },
      }),
      /official command failed/,
    );
    assert.equal(existsSync(join(home, "profiles", "web", "package.json")), false);
    const entries = await readdir(resolve(home, ".."));
    assert.equal(entries.some((entry) => entry.startsWith(".dsh-profile-init-")), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("tarball hashes are checked before a new Profile can be published", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-profile-hash-"));
  try {
    const artifactDir = join(root, "featured-plugins");
    await mkdir(artifactDir, { recursive: true });
    const records = [];
    for (const plugin of featuredPlugins()) {
      const tarball = `${plugin.name.replace(/^@/, "").replaceAll("/", "-")}.tgz`;
      const content = Buffer.from(plugin.name, "utf8");
      await writeFile(join(artifactDir, tarball), content);
      records.push({
        ...plugin,
        version: "0.0.1",
        tarball,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
    await writeFile(join(artifactDir, "manifest.json"), `${JSON.stringify({
      schema_version: 1,
      profile: "web",
      plugins: records,
    }, null, 2)}\n`);
    await writeFile(join(artifactDir, records[0].tarball), "corrupted");
    const home = join(root, "home");
    await assert.rejects(
      ensureDshProfileInitialized({
        resolved: { appBootPath: "unused" },
        dshHome: home,
        env: {
          ...process.env,
          DSH_RUNTIME_DISTRIBUTION: "npm",
          DSH_FEATURED_PLUGIN_TARBALL_DIR: artifactDir,
          DSH_FEATURED_PLUGIN_MANIFEST: join(artifactDir, "manifest.json"),
          DSH_PROFILE_PLUGIN_LIBRARY: join(home, "plugin-library"),
        },
        profileApi: profileApi(),
        commandRunner: async () => {
          throw new Error("must not run after hash failure");
        },
      }),
      { code: "DSH_FEATURED_PLUGIN_TARBALL_HASH_MISMATCH" },
    );
    assert.equal(existsSync(join(home, "profiles", "web", "package.json")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixed tarball inputs cannot escape the stable plugin library", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-profile-tarball-path-"));
  try {
    const artifactDir = join(root, "featured-plugins");
    await mkdir(artifactDir, { recursive: true });
    const records = [];
    for (const [index, plugin] of featuredPlugins().entries()) {
      const tarball = index === 0
        ? "../escape.tgz"
        : `${plugin.name.replace(/^@/, "").replaceAll("/", "-")}.tgz`;
      const content = Buffer.from(plugin.name, "utf8");
      await writeFile(join(index === 0 ? root : artifactDir, index === 0 ? "escape.tgz" : tarball), content);
      records.push({
        ...plugin,
        version: "0.0.1",
        tarball,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
    await writeFile(join(artifactDir, "manifest.json"), `${JSON.stringify({
      schema_version: 1,
      profile: "web",
      plugins: records,
    }, null, 2)}\n`);
    await assert.rejects(
      ensureDshProfileInitialized({
        resolved: { appBootPath: "unused" },
        dshHome: join(root, "home"),
        env: {
          ...process.env,
          DSH_RUNTIME_DISTRIBUTION: "npm",
          DSH_FEATURED_PLUGIN_TARBALL_DIR: artifactDir,
          DSH_FEATURED_PLUGIN_MANIFEST: join(artifactDir, "manifest.json"),
        },
        profileApi: profileApi(),
        commandRunner: async () => { throw new Error("must not run for an invalid tarball path"); },
      }),
      { code: "DSH_FEATURED_PLUGIN_TARBALL_INVALID" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the fake official command path receives every curated input in order", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-profile-atomic-success-"));
  try {
    const api = profileApi();
    let additions = 0;
    const commandRunner = async (_resolved, args, env) => {
      if (args[0] !== "plugin") return;
      const dir = api.resolveProfileDir("web", env.DSH_HOME);
      await api.initProfile(dir, BASE_BUNDLES);
      const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      const name = featuredPluginNames()[additions];
      manifest.dependencies[name] = args[args.indexOf("-w") + 1];
      manifest.dsh.profile.bundles = [...BASE_BUNDLES, ...featuredPluginNames().slice(0, additions + 1)];
      additions += 1;
      await writeFile(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    };
    const result = await ensureDshProfileInitialized({
      resolved: { appBootPath: "unused" },
      dshHome: home,
      env: sourceEnvironment(home),
      appRoot: APP_ROOT,
      profileApi: api,
      commandRunner,
    });
    assert.equal(result.created, true);
    assert.equal(additions, featuredPlugins().length);
    const finalManifest = JSON.parse(await readFile(join(result.profileDir, "package.json"), "utf8"));
    assert.deepEqual(finalManifest.dsh.profile.bundles.slice(2), featuredPluginNames());
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a safe Profile initializes only the official base and web bundles", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-safe-profile-"));
  try {
    const commands = [];
    const result = await ensureDshProfileInitialized({
      resolved: { appBootPath: "unused" },
      dshHome: home,
      env: {
        ...sourceEnvironment(home),
        DSH_PROFILE_INITIALIZATION_MODE: "safe",
        DSH_FEATURED_PLUGIN_MANIFEST: join(home, "missing-manifest.json"),
      },
      appRoot: APP_ROOT,
      profileApi: profileApi(),
      commandRunner: async (_resolved, args) => { commands.push(args); },
    });
    assert.equal(result.created, true);
    assert.deepEqual(result.bundles, BASE_BUNDLES);
    assert.deepEqual(commands, [["--profile", "web", "--dump-config"]]);
    const manifest = JSON.parse(await readFile(join(result.profileDir, "package.json"), "utf8"));
    assert.deepEqual(manifest.dsh.profile.bundles, BASE_BUNDLES);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
