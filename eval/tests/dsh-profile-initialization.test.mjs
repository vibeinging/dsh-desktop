import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  controlledDshPluginEnvironment,
  dshCommandWorkingDirectory,
  ensureDshProfileInitialized,
  PROFILE_FEATURED_STATE_FILENAME,
  rebasePublishedProfileLinks,
  unlinkStagingProfileFallbacks,
} from "../../server/src/engine/dsh_runtime/profile_initialization.js";
import {
  featuredPluginNames,
  featuredPlugins,
} from "../../server/src/engine/dsh_runtime/featured_plugins.js";

const APP_ROOT = resolve(import.meta.dirname, "../..");
const BASE_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];
const execFileAsync = promisify(execFile);

function profileApi() {
  return {
    PROFILE_TEMPLATES: { web: BASE_BUNDLES },
    DEFAULT_PROFILE_BUNDLES: BASE_BUNDLES,
    resolveProfileDir(name, home) {
      return join(home, "profiles", name);
    },
    initProfile(dir, bundles) {
      if (existsSync(join(dir, "package.json"))) return;
      return mkdir(dir, { recursive: true }).then(async () => {
        await writeFile(join(dir, "package.json"), `${JSON.stringify({
          name: "dsh-profile-web",
          private: true,
          dependencies: {},
          dsh: { profile: { bundles: [...bundles] } },
        }, null, 2)}\n`);
        await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n");
      });
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

async function fixedArtifactEnvironment(home, root) {
  const artifactDir = join(root, "featured-plugins");
  await mkdir(artifactDir, { recursive: true });
  const plugins = [];
  for (const plugin of featuredPlugins()) {
    const tarball = `${plugin.name.replace(/^@/, "").replaceAll("/", "-")}-0.0.1.tgz`;
    const content = Buffer.from(`${plugin.name}:current`, "utf8");
    await writeFile(join(artifactDir, tarball), content);
    plugins.push({
      ...plugin,
      version: "0.0.1",
      tarball,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  await writeFile(join(artifactDir, "manifest.json"), `${JSON.stringify({
    schema_version: 1,
    profile: "web",
    plugins,
  }, null, 2)}\n`);
  return {
    ...process.env,
    DSH_RUNTIME_DISTRIBUTION: "npm",
    DSH_FEATURED_PLUGIN_TARBALL_DIR: artifactDir,
    DSH_FEATURED_PLUGIN_MANIFEST: join(artifactDir, "manifest.json"),
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

test("atomic Profile publication rebases absolute pnpm links and metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-profile-link-rebase-"));
  try {
    const stagingProfile = join(root, "staging", "profiles", "web");
    const finalProfile = join(root, "home", "profiles", "web");
    const packageTarget = join(stagingProfile, "node_modules", ".pnpm", "fixture", "node_modules", "fixture");
    const packageLink = join(stagingProfile, "node_modules", "fixture");
    await mkdir(packageTarget, { recursive: true });
    await writeFile(join(packageTarget, "package.json"), '{"name":"fixture"}\n');
    await symlink(packageTarget, packageLink, process.platform === "win32" ? "junction" : "dir");
    await writeFile(join(stagingProfile, "node_modules", ".modules.yaml"), `${JSON.stringify({
      virtualStoreDir: join(stagingProfile, "node_modules", ".pnpm"),
    }, null, 2)}\n`);
    await mkdir(resolve(finalProfile, ".."), { recursive: true });
    await rename(stagingProfile, finalProfile);
    assert.equal(rebasePublishedProfileLinks(finalProfile, stagingProfile, finalProfile), 1);
    assert.equal(JSON.parse(await readFile(join(finalProfile, "node_modules", "fixture", "package.json"), "utf8")).name, "fixture");
    const modules = await readFile(join(finalProfile, "node_modules", ".modules.yaml"), "utf8");
    assert.doesNotMatch(modules, /staging/);
    assert.equal(JSON.parse(modules).virtualStoreDir, ".pnpm");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic Profile publication sets the final pnpm virtual store without matching the old path spelling", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-profile-virtual-store-rebase-"));
  try {
    const stagingProfile = join(root, "staging", "profiles", "web");
    const finalProfile = join(root, "home", "profiles", "web");
    await mkdir(join(stagingProfile, "node_modules"), { recursive: true });
    await writeFile(
      join(stagingProfile, "node_modules", ".modules.yaml"),
      `${JSON.stringify({
        layoutVersion: 5,
        virtualStoreDir: "C:\\Users\\RUNNER~1\\alternate-staging\\profiles\\web\\node_modules\\.pnpm",
      }, null, 2)}\n`,
    );
    await mkdir(resolve(finalProfile, ".."), { recursive: true });
    await rename(stagingProfile, finalProfile);
    assert.equal(rebasePublishedProfileLinks(finalProfile, stagingProfile, finalProfile), 0);
    const modules = await readFile(join(finalProfile, "node_modules", ".modules.yaml"), "utf8");
    assert.deepEqual(JSON.parse(modules), {
      layoutVersion: 5,
      virtualStoreDir: ".pnpm",
    });
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

test("an existing Profile receives defaults not previously offered without restoring a prior removal", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-profile-default-migration-"));
  try {
    const api = profileApi();
    const profileDir = api.resolveProfileDir("web", home);
    await api.initProfile(profileDir, BASE_BUNDLES);
    const manifestPath = join(profileDir, "package.json");
    const names = featuredPluginNames();
    const installedName = names[0];
    const removedName = names[1];
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dependencies[installedName] = "file:installed.tgz";
    manifest.dsh.profile.bundles.push(installedName);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const library = join(home, "plugin-library", "tarballs");
    await mkdir(library, { recursive: true });
    const removedPrefix = removedName.replace(/^@/, "").replaceAll("/", "-");
    await writeFile(join(library, `${removedPrefix}-0.0.1.tgz`), "previously offered");

    const additions = [];
    const commandRunner = async (_resolved, args) => {
      if (args[0] !== "plugin") return;
      const source = String(args[args.indexOf("-w") + 1] || "").replace(/^file:/, "");
      const packageName = JSON.parse(await readFile(join(source, "package.json"), "utf8")).name;
      additions.push(packageName);
      const current = JSON.parse(await readFile(manifestPath, "utf8"));
      current.dependencies[packageName] = `file:${source}`;
      current.dsh.profile.bundles.push(packageName);
      await writeFile(manifestPath, `${JSON.stringify(current, null, 2)}\n`);
    };

    const result = await ensureDshProfileInitialized({
      resolved: { appBootPath: "unused" },
      dshHome: home,
      env: sourceEnvironment(home),
      appRoot: APP_ROOT,
      profileApi: api,
      commandRunner,
    });
    assert.equal(result.created, false);
    assert.equal(result.migrated, true);
    assert.deepEqual(additions, names.slice(2));
    const migrated = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(Object.hasOwn(migrated.dependencies, removedName), false);
    assert.equal(migrated.dsh.profile.bundles.includes(removedName), false);
    const state = JSON.parse(await readFile(join(profileDir, PROFILE_FEATURED_STATE_FILENAME), "utf8"));
    assert.deepEqual(state.offered, [...names].sort());

    const removedAfterMigration = names[2];
    delete migrated.dependencies[removedAfterMigration];
    migrated.dsh.profile.bundles = migrated.dsh.profile.bundles.filter((name) => name !== removedAfterMigration);
    await writeFile(manifestPath, `${JSON.stringify(migrated, null, 2)}\n`);
    additions.length = 0;
    const restarted = await ensureDshProfileInitialized({
      resolved: { appBootPath: "unused" },
      dshHome: home,
      env: sourceEnvironment(home),
      appRoot: APP_ROOT,
      profileApi: api,
      commandRunner,
    });
    assert.equal(restarted.migrated, false);
    assert.deepEqual(additions, []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("an existing managed default moves to a content-addressed tarball without restoring removed defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-profile-content-migration-"));
  try {
    const home = join(root, "home");
    const api = profileApi();
    const profileDir = api.resolveProfileDir("web", home);
    await api.initProfile(profileDir, BASE_BUNDLES);
    const names = featuredPluginNames();
    const managedName = names[0];
    const userOwnedName = names[1];
    const library = join(home, "plugin-library", "tarballs");
    await mkdir(library, { recursive: true });
    const oldTarball = join(library, `${managedName.replace(/^@/, "").replaceAll("/", "-")}-0.0.1.tgz`);
    await writeFile(oldTarball, "old content");
    const manifestPath = join(profileDir, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.dependencies[managedName] = `file:${oldTarball}`;
    manifest.dependencies[userOwnedName] = "0.0.1";
    manifest.dsh.profile.bundles.push(managedName, userOwnedName);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(profileDir, PROFILE_FEATURED_STATE_FILENAME), `${JSON.stringify({
      schema_version: 1,
      profile: "web",
      offered: [...names].sort(),
    }, null, 2)}\n`);
    const env = await fixedArtifactEnvironment(home, root);
    const commands = [];
    let failAfterManifestWrite = true;
    const commandRunner = async (_resolved, args) => {
      commands.push(args);
      if (args[0] !== "plugin") return;
      const source = String(args[args.indexOf("-w") + 1]);
      const current = JSON.parse(await readFile(manifestPath, "utf8"));
      current.dependencies[managedName] = source;
      await writeFile(manifestPath, `${JSON.stringify(current, null, 2)}\n`);
      if (failAfterManifestWrite) throw new Error("simulated install failure");
    };
    await assert.rejects(
      ensureDshProfileInitialized({
        resolved: { appBootPath: "unused" },
        dshHome: home,
        env,
        appRoot: APP_ROOT,
        profileApi: api,
        commandRunner,
      }),
      /simulated install failure/,
    );
    const failedState = JSON.parse(await readFile(join(profileDir, PROFILE_FEATURED_STATE_FILENAME), "utf8"));
    assert.equal(failedState.schema_version, 2);
    assert.deepEqual(failedState.artifacts, {});

    commands.length = 0;
    failAfterManifestWrite = false;
    const result = await ensureDshProfileInitialized({
      resolved: { appBootPath: "unused" },
      dshHome: home,
      env,
      appRoot: APP_ROOT,
      profileApi: api,
      commandRunner,
    });
    assert.equal(result.migrated, true);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.upgraded, [managedName]);
    assert.equal(commands.length, 2);
    assert.equal(commands[0].includes("--force"), true);
    const migrated = JSON.parse(await readFile(manifestPath, "utf8"));
    const source = migrated.dependencies[managedName];
    const artifact = JSON.parse(await readFile(env.DSH_FEATURED_PLUGIN_MANIFEST, "utf8"))
      .plugins.find((plugin) => plugin.name === managedName);
    assert.equal(source.endsWith(`-${artifact.sha256}.tgz`), true);
    assert.equal(migrated.dependencies[userOwnedName], "0.0.1");
    assert.equal(existsSync(oldTarball), true);
    for (const removedName of names.slice(2)) {
      assert.equal(Object.hasOwn(migrated.dependencies, removedName), false);
    }

    commands.length = 0;
    const restarted = await ensureDshProfileInitialized({
      resolved: { appBootPath: "unused" },
      dshHome: home,
      env,
      appRoot: APP_ROOT,
      profileApi: api,
      commandRunner,
    });
    assert.equal(restarted.migrated, false);
    assert.deepEqual(commands, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an existing Profile retries a default whose first official add failed", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-profile-default-retry-"));
  try {
    const api = profileApi();
    const profileDir = api.resolveProfileDir("web", home);
    await api.initProfile(profileDir, BASE_BUNDLES);
    const manifestPath = join(profileDir, "package.json");
    const names = featuredPluginNames();
    const library = join(home, "plugin-library", "tarballs");
    let failed = false;
    await assert.rejects(
      ensureDshProfileInitialized({
        resolved: { appBootPath: "unused" },
        dshHome: home,
        env: sourceEnvironment(home),
        appRoot: APP_ROOT,
        profileApi: api,
        commandRunner: async (_resolved, args) => {
          if (args[0] !== "plugin") return;
          await mkdir(library, { recursive: true });
          const prefix = names[0].replace(/^@/, "").replaceAll("/", "-");
          await writeFile(join(library, `${prefix}-0.0.1.tgz`), "materialized before add failed");
          failed = true;
          throw new Error("official add failed");
        },
      }),
      /official add failed/,
    );
    assert.equal(failed, true);
    assert.deepEqual(
      JSON.parse(await readFile(join(profileDir, PROFILE_FEATURED_STATE_FILENAME), "utf8")).offered,
      [],
    );

    const additions = [];
    const retried = await ensureDshProfileInitialized({
      resolved: { appBootPath: "unused" },
      dshHome: home,
      env: sourceEnvironment(home),
      appRoot: APP_ROOT,
      profileApi: api,
      commandRunner: async (_resolved, args) => {
        if (args[0] !== "plugin") return;
        const source = String(args[args.indexOf("-w") + 1] || "").replace(/^file:/, "");
        const packageName = JSON.parse(await readFile(join(source, "package.json"), "utf8")).name;
        additions.push(packageName);
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.dependencies[packageName] = `file:${source}`;
        manifest.dsh.profile.bundles.push(packageName);
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    });
    assert.equal(retried.migrated, true);
    assert.deepEqual(additions, names);
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
    const fixturePackage = join(home, "fixture-package");
    const pnpmCli = join(APP_ROOT, "electron", "node_modules", "pnpm", "bin", "pnpm.cjs");
    await mkdir(fixturePackage, { recursive: true });
    await writeFile(join(fixturePackage, "package.json"), '{"name":"profile-fixture","version":"1.0.0"}\n');
    assert.equal(existsSync(pnpmCli), true);
    let additions = 0;
    const commandRunner = async (_resolved, args, env) => {
      if (args[0] !== "plugin") return;
      const dir = api.resolveProfileDir("web", env.DSH_HOME);
      await api.initProfile(dir, BASE_BUNDLES);
      const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      const name = featuredPluginNames()[additions];
      manifest.dependencies[name] = `file:${fixturePackage}`;
      manifest.dsh.profile.bundles = [...BASE_BUNDLES, ...featuredPluginNames().slice(0, additions + 1)];
      additions += 1;
      await writeFile(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      if (additions === featuredPlugins().length) {
        await execFileAsync(process.execPath, [pnpmCli, "install", "--offline", "--ignore-scripts", "--lockfile=false"], {
          cwd: dir,
          env,
        });
      }
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
    assert.deepEqual(
      JSON.parse(await readFile(join(result.profileDir, PROFILE_FEATURED_STATE_FILENAME), "utf8")).offered,
      [...featuredPluginNames()].sort(),
    );
    const modules = await readFile(join(result.profileDir, "node_modules", ".modules.yaml"), "utf8");
    assert.doesNotMatch(modules, /\.dsh-profile-init-/);
    await execFileAsync(process.execPath, [pnpmCli, "remove", featuredPluginNames()[0]], {
      cwd: result.profileDir,
      env: controlledDshPluginEnvironment(process.env, {
        dshHome: home,
        libraryRoot: join(home, "plugin-library"),
      }),
    });
    const removedManifest = JSON.parse(await readFile(join(result.profileDir, "package.json"), "utf8"));
    assert.equal(Object.hasOwn(removedManifest.dependencies, featuredPluginNames()[0]), false);
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
    assert.deepEqual(
      JSON.parse(await readFile(join(result.profileDir, PROFILE_FEATURED_STATE_FILENAME), "utf8")).offered,
      [],
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
