import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  featuredPluginLibraryTarballName,
  featuredPluginManifest,
  featuredPlugins,
  resolveFeaturedPackageDir,
} from "./featured_plugins.js";

const execFileAsync = promisify(execFile);
const PROFILE_NAME = featuredPluginManifest().profile;
const OFFICIAL_PROFILE_BUNDLES = Object.freeze([
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
]);
export const PROFILE_FEATURED_STATE_FILENAME = ".dsh-desktop-featured.json";
const initializationQueues = new Map();

function profileError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function readJson(path, code) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("必须是 JSON 对象");
    return value;
  } catch (error) {
    throw profileError(`无法读取精选插件产物清单：${path}（${error?.message || error}）`, code);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function profilePath(api, dshHome) {
  return resolve(api.resolveProfileDir(PROFILE_NAME, resolve(dshHome)));
}

function featuredStatePath(profileDir) {
  return join(profileDir, PROFILE_FEATURED_STATE_FILENAME);
}

function readFeaturedState(profileDir) {
  const path = featuredStatePath(profileDir);
  if (!existsSync(path)) return null;
  let state;
  try {
    state = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw profileError(
      `无法读取默认插件迁移状态：${path}（${error?.message || error}）`,
      "DSH_PROFILE_FEATURED_STATE_INVALID",
    );
  }
  const offered = state.offered;
  const artifacts = state.schema_version === 2 ? state.artifacts : {};
  if (![1, 2].includes(state.schema_version) || state.profile !== PROFILE_NAME
    || !Array.isArray(offered)
    || offered.some((name) => typeof name !== "string" || !name.trim())
    || new Set(offered).size !== offered.length
    || !artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)
    || Object.entries(artifacts).some(([name, artifact]) => !name.trim()
      || !artifact || typeof artifact !== "object" || Array.isArray(artifact)
      || typeof artifact.version !== "string" || !artifact.version.trim()
      || typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256))) {
    throw profileError(`默认插件迁移状态无效：${path}`, "DSH_PROFILE_FEATURED_STATE_INVALID");
  }
  return {
    offered: new Set(offered),
    artifacts: new Map(Object.entries(artifacts)),
  };
}

function writeFeaturedState(profileDir, offered, artifacts = new Map()) {
  const path = featuredStatePath(profileDir);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const state = {
    schema_version: 2,
    profile: PROFILE_NAME,
    offered: [...offered].sort(),
    artifacts: Object.fromEntries([...artifacts.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function tarballPrefix(packageName) {
  return `${packageName.replace(/^@/, "").replaceAll("/", "-")}-`;
}

function dependencyFilePath(spec, profileDir) {
  if (typeof spec !== "string" || !spec.startsWith("file:")) return null;
  const path = spec.slice("file:".length);
  return path ? resolve(profileDir, path) : null;
}

function isManagedFeaturedTarball(spec, plugin, profileDir, libraryRoot) {
  const path = dependencyFilePath(spec, profileDir);
  if (!path || !isWithinPath(join(libraryRoot, "tarballs"), path)) return false;
  const filename = path.split(/[\\/]/).at(-1) || "";
  return filename.startsWith(tarballPrefix(plugin.name)) && filename.endsWith(".tgz");
}

/**
 * Registry version pins (for example "0.1.1") are also featured-managed.
 * Without this recognition an existing Profile keeps a stale registry pin
 * forever — upgrades only re-point file: tarball pins — so a featured plugin
 * shipped through npm stays on its old version across releases even when the
 * manifest moved on, and the stale version can crash a newer runtime.
 */
function isManagedFeaturedRegistryPin(spec, plugin) {
  return typeof spec === "string"
    && spec.trim() !== ""
    && !spec.startsWith("file:")
    && spec.trim() !== plugin.evidence.package_version;
}

function sameFileDependency(left, right, profileDir) {
  const leftPath = dependencyFilePath(left, profileDir);
  const rightPath = dependencyFilePath(right, profileDir);
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

function offeredFeaturedPlugins(profileDir, libraryRoot, manifest) {
  const persisted = readFeaturedState(profileDir);
  const offered = persisted?.offered || new Set();
  const artifacts = persisted?.artifacts || new Map();
  const featuredNames = new Set(featuredPlugins().map((plugin) => plugin.name));
  for (const name of Object.keys(manifest.dependencies || {})) {
    if (featuredNames.has(name)) offered.add(name);
  }
  if (persisted) return { offered, artifacts };
  const tarballsDir = join(libraryRoot, "tarballs");
  const tarballs = existsSync(tarballsDir) ? readdirSync(tarballsDir) : [];
  for (const name of featuredNames) {
    const prefix = tarballPrefix(name);
    if (tarballs.some((filename) => filename.startsWith(prefix) && filename.endsWith(".tgz"))) offered.add(name);
  }
  return { offered, artifacts };
}

function artifactState(input) {
  if (!input?.tarball || typeof input.version !== "string" || typeof input.sha256 !== "string") return null;
  return { version: input.version, sha256: input.sha256 };
}

function sameArtifactState(state, input) {
  const expected = artifactState(input);
  return Boolean(expected && state?.version === expected.version && state?.sha256 === expected.sha256);
}

function artifactManifest(env) {
  if (env.DSH_PROFILE_INITIALIZATION_MODE === "safe") return null;
  const path = String(env.DSH_FEATURED_PLUGIN_MANIFEST || "").trim();
  if (!path) return null;
  if (!existsSync(path)) {
    if (env.DSH_FEATURED_PLUGIN_ALLOW_SOURCE === "1" || env.DSH_RUNTIME_DISTRIBUTION === "source") return null;
    throw profileError(`发行包缺少精选插件产物清单：${path}`, "DSH_FEATURED_PLUGIN_MANIFEST_MISSING");
  }
  const value = readJson(path, "DSH_FEATURED_PLUGIN_MANIFEST_INVALID");
  if (value.schema_version !== 1 || value.profile !== PROFILE_NAME || !Array.isArray(value.plugins)) {
    throw profileError(`精选插件产物清单格式无效：${path}`, "DSH_FEATURED_PLUGIN_MANIFEST_INVALID");
  }
  const expected = new Set(featuredPlugins().map((plugin) => plugin.name));
  const actual = new Set(value.plugins.map((plugin) => plugin?.name));
  if (expected.size !== actual.size || [...expected].some((name) => !actual.has(name))) {
    throw profileError("精选插件产物清单与源码精选列表不一致", "DSH_FEATURED_PLUGIN_MANIFEST_DRIFT");
  }
  return new Map(value.plugins.map((plugin) => [plugin.name, plugin]));
}

function sourceInput(plugin, env, appRoot) {
  const allowSource = env.DSH_FEATURED_PLUGIN_ALLOW_SOURCE === "1"
    || env.DSH_RUNTIME_DISTRIBUTION === "source";
  if (!allowSource) {
    throw profileError(
      `${plugin.name} 缺少固定 tarball；发行态不能从源码目录初始化 Profile`,
      "DSH_FEATURED_PLUGIN_TARBALL_MISSING",
    );
  }
  const sourceRoot = resolve(env.DSH_FEATURED_PLUGIN_SOURCE_ROOT || appRoot);
  const packageDir = resolveFeaturedPackageDir(plugin, { appRoot: sourceRoot });
  if (!existsSync(join(packageDir, "package.json"))) {
    throw profileError(`${plugin.name} 的开发源码包不存在：${packageDir}`, "DSH_FEATURED_PLUGIN_SOURCE_MISSING");
  }
  return { source: `file:${packageDir}`, tarball: null, sha256: null, version: null };
}

function pluginInputs(env, appRoot) {
  if (env.DSH_PROFILE_INITIALIZATION_MODE === "safe") return [];
  const generated = artifactManifest(env);
  const artifactDir = String(env.DSH_FEATURED_PLUGIN_TARBALL_DIR || "").trim();
  const artifactMode = Boolean(generated) || Boolean(artifactDir && existsSync(artifactDir));
  return featuredPlugins().map((plugin) => {
    const artifact = generated?.get(plugin.name);
    if (artifact) {
      if (typeof artifact.tarball !== "string" || typeof artifact.sha256 !== "string" || typeof artifact.version !== "string") {
        throw profileError(`${plugin.name} 的精选插件产物记录不完整`, "DSH_FEATURED_PLUGIN_MANIFEST_INVALID");
      }
      const artifactRoot = resolve(artifactDir || dirname(env.DSH_FEATURED_PLUGIN_MANIFEST));
      const filename = artifact.tarball;
      if (!/^[A-Za-z0-9._+-]+\.tgz$/.test(filename)) {
        throw profileError(`${plugin.name} 的固定 tarball 文件名无效`, "DSH_FEATURED_PLUGIN_TARBALL_INVALID");
      }
      const sourcePath = resolve(artifactRoot, filename);
      const sourceRelative = relative(artifactRoot, sourcePath);
      if (sourceRelative === ".." || sourceRelative.startsWith(`..${sep}`) || isAbsolute(sourceRelative)) {
        throw profileError(`${plugin.name} 的固定 tarball 路径越出产物目录`, "DSH_FEATURED_PLUGIN_TARBALL_INVALID");
      }
      if (!existsSync(sourcePath)) {
        throw profileError(`${plugin.name} 的固定 tarball 不存在：${sourcePath}`, "DSH_FEATURED_PLUGIN_TARBALL_MISSING");
      }
      if (sha256(sourcePath) !== artifact.sha256) {
        throw profileError(`${plugin.name} 的 tarball SHA-256 校验失败`, "DSH_FEATURED_PLUGIN_TARBALL_HASH_MISMATCH");
      }
      return {
        source: `file:${sourcePath}`,
        tarball: sourcePath,
        tarballName: filename,
        sha256: artifact.sha256,
        version: artifact.version,
      };
    }
    if (artifactMode) {
      throw profileError(`${plugin.name} 缺少固定 tarball 产物记录`, "DSH_FEATURED_PLUGIN_MANIFEST_MISSING");
    }
    return sourceInput(plugin, env, appRoot);
  });
}

function materializeTarball(input, plugin, libraryRoot) {
  if (!input.tarball) return input.source;
  const artifactFilename = String(input.tarballName || input.tarball.split(/[\\/]/).at(-1) || "");
  const filename = input.sha256
    ? featuredPluginLibraryTarballName(artifactFilename, input.sha256)
    : artifactFilename;
  if (!/^[A-Za-z0-9._+-]+\.tgz$/.test(filename)) {
    throw profileError(`${plugin.name} 的固定 tarball 文件名无效`, "DSH_FEATURED_PLUGIN_TARBALL_INVALID");
  }
  const tarballsDir = join(libraryRoot, "tarballs");
  mkdirSync(tarballsDir, { recursive: true });
  const target = join(tarballsDir, filename);
  if (!existsSync(target) || (input.sha256 && sha256(target) !== input.sha256)) {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, readFileSync(input.tarball), { mode: 0o600 });
    if (input.sha256 && sha256(temporary) !== input.sha256) {
      rmSync(temporary, { force: true });
      throw profileError(`${plugin.name} 的本地插件库写入后校验失败`, "DSH_FEATURED_PLUGIN_TARBALL_HASH_MISMATCH");
    }
    renameSync(temporary, target);
  }
  if (input.sha256 && sha256(target) !== input.sha256) {
    throw profileError(`${plugin.name} 的本地插件库 SHA-256 校验失败`, "DSH_FEATURED_PLUGIN_TARBALL_HASH_MISMATCH");
  }
  return `file:${target}`;
}

/** Build the environment that makes every DSH plugin command use the bundled pnpm. */
export function controlledDshPluginEnvironment(baseEnv = process.env, { dshHome, libraryRoot } = {}) {
  const binDir = String(baseEnv.DSH_PNPM_BIN_DIR || "").trim();
  if (baseEnv.DSH_PNPM_REQUIRED === "1") {
    const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    if (!binDir || !existsSync(join(binDir, executable))) {
      throw profileError("发行包缺少受控 pnpm；不会回退到系统 pnpm", "DSH_PNPM_MISSING");
    }
  }
  const existingPath = baseEnv.PATH || process.env.PATH || "";
  const storeRoot = resolve(libraryRoot || join(dshHome || baseEnv.DSH_HOME || ".", "plugin-library"), "store");
  return {
    ...baseEnv,
    ...(dshHome ? { DSH_HOME: resolve(dshHome) } : {}),
    DSH_PNPM_NODE_BIN: baseEnv.DSH_PNPM_NODE_BIN || process.execPath,
    PATH: binDir ? `${resolve(binDir)}${delimiter}${existingPath}` : existingPath,
    pnpm_config_store_dir: storeRoot,
    npm_config_store_dir: storeRoot,
    pnpm_config_auto_install_peers: "false",
    npm_config_auto_install_peers: "false",
  };
}

async function defaultCommandRunner(resolved, args, env) {
  try {
    return await execFileAsync(process.execPath, [...resolved.execArgv, resolved.entryPath, ...args], {
      cwd: dshCommandWorkingDirectory(resolved, env),
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const output = [error?.stdout, error?.stderr]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
    throw profileError(output || String(error?.message || error), "DSH_PROFILE_COMMAND_FAILED", {
      exit_code: error?.code ?? null,
      command_output: output || null,
    });
  }
}

/** Keep official plugin commands out of the immutable application install directory. */
export function dshCommandWorkingDirectory(resolved, env = process.env) {
  const dshHome = String(env.DSH_HOME || "").trim();
  return dshHome ? resolve(dshHome) : resolved.root;
}

/** Unlink installation fallback symlinks before removing an atomic staging home. */
export function unlinkStagingProfileFallbacks(stagingHome) {
  const root = join(stagingHome, "profiles", "node_modules");
  if (!existsSync(root)) return 0;
  let removed = 0;
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const target = join(directory, name);
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) {
        unlinkSync(target);
        removed += 1;
      } else if (stat.isDirectory()) {
        visit(target);
      }
    }
  };
  visit(root);
  return removed;
}

function isWithinPath(parent, candidate) {
  const segment = relative(parent, candidate);
  return segment === "" || (segment !== ".." && !segment.startsWith(`..${sep}`) && !isAbsolute(segment));
}

function absoluteLinkTarget(target) {
  const normalized = process.platform === "win32" && target.startsWith("\\\\?\\") ? target.slice(4) : target;
  return isAbsolute(normalized) ? resolve(normalized) : null;
}

function pinPnpmVirtualStore(modulesState) {
  const finalVirtualStore = ".pnpm";
  try {
    const parsed = JSON.parse(modulesState);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      parsed.virtualStoreDir = finalVirtualStore;
      return `${JSON.stringify(parsed, null, 2)}\n`;
    }
  } catch {
    // Older pnpm versions may write YAML instead of JSON.
  }
  return modulesState.replace(
    /^(\s*virtualStoreDir:\s*).*$/mu,
    (_line, prefix) => `${prefix}${JSON.stringify(finalVirtualStore)}`,
  );
}

/** Rebase absolute pnpm links after an atomic Profile directory move. */
export function rebasePublishedProfileLinks(profileDir, fromProfileDir, toProfileDir) {
  const sourceRoot = resolve(fromProfileDir);
  const targetRoot = resolve(toProfileDir);
  let rebased = 0;
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const link = join(directory, name);
      const linkStat = lstatSync(link);
      if (linkStat.isSymbolicLink()) {
        const currentTarget = readlinkSync(link);
        const absoluteTarget = absoluteLinkTarget(currentTarget);
        if (!absoluteTarget || !isWithinPath(sourceRoot, absoluteTarget)) continue;
        const nextTarget = join(targetRoot, relative(sourceRoot, absoluteTarget));
        const targetStat = statSync(nextTarget);
        unlinkSync(link);
        symlinkSync(nextTarget, link, targetStat.isDirectory() ? (process.platform === "win32" ? "junction" : "dir") : "file");
        rebased += 1;
      } else if (linkStat.isDirectory()) {
        visit(link);
      }
    }
  };
  const modulesDir = join(profileDir, "node_modules");
  if (existsSync(modulesDir)) visit(modulesDir);
  const modulesStatePath = join(modulesDir, ".modules.yaml");
  if (existsSync(modulesStatePath)) {
    const before = readFileSync(modulesStatePath, "utf8");
    const replacements = [
      [sourceRoot, targetRoot],
      [sourceRoot.split(sep).join("/"), targetRoot.split(sep).join("/")],
      [sourceRoot.replaceAll("\\", "\\\\"), targetRoot.replaceAll("\\", "\\\\")],
    ];
    const rebasedPaths = replacements.reduce((text, [from, to]) => text.replaceAll(from, to), before);
    const after = pinPnpmVirtualStore(rebasedPaths);
    if (after !== before) writeFileSync(modulesStatePath, after);
  }
  return rebased;
}

function assertInitialProfile(manifest, expectedNames, { requireDependencies = true } = {}) {
  const bundles = manifest?.dsh?.profile?.bundles;
  const dependencies = manifest?.dependencies;
  if (!Array.isArray(bundles) || (requireDependencies && (!dependencies || typeof dependencies !== "object"))) {
    throw profileError(
      requireDependencies
        ? "新 Profile 缺少官方 dsh.profile.bundles 或 dependencies"
        : "安全 Profile 缺少官方 dsh.profile.bundles",
      "DSH_PROFILE_INIT_INVALID",
    );
  }
  const expected = new Set(expectedNames);
  const actual = new Set(bundles);
  if ([...expected].some((name) => !actual.has(name)
    || (requireDependencies && !Object.hasOwn(dependencies, name)))) {
    throw profileError("新 Profile 未包含全部精选插件", "DSH_PROFILE_INIT_INCOMPLETE");
  }
}

async function reconcileExistingProfile({
  resolved,
  home,
  env,
  appRoot,
  api,
  profileDir,
  commandRunner,
}) {
  if (env.DSH_PROFILE_INITIALIZATION_MODE === "safe") {
    return Object.freeze({ created: false, profileDir, initialized: false, migrated: false });
  }
  const manifest = api.readProfileManifest("dsh-work", profileDir);
  const libraryRoot = resolve(env.DSH_PROFILE_PLUGIN_LIBRARY || join(home, "plugin-library"));
  const { offered, artifacts } = offeredFeaturedPlugins(profileDir, libraryRoot, manifest);
  const plugins = featuredPlugins();
  const additions = plugins.filter((plugin) => !offered.has(plugin.name));
  const managedInstalled = plugins.filter((plugin) => offered.has(plugin.name)
    && (isManagedFeaturedTarball(manifest.dependencies?.[plugin.name], plugin, profileDir, libraryRoot)
      || isManagedFeaturedRegistryPin(manifest.dependencies?.[plugin.name], plugin)));
  if (additions.length === 0 && managedInstalled.length === 0) {
    writeFeaturedState(profileDir, offered, artifacts);
    return Object.freeze({ created: false, profileDir, initialized: false, migrated: false });
  }
  if (env.DSH_RUNTIME_DISTRIBUTION === "source" && env.DSH_FEATURED_PLUGIN_ALLOW_SOURCE !== "1") {
    return Object.freeze({ created: false, profileDir, initialized: false });
  }
  const inputsByName = new Map(pluginInputs(env, appRoot).map((input, index) => [
    plugins[index].name,
    input,
  ]));
  const managedReleasePlugins = managedInstalled.filter((plugin) => inputsByName.get(plugin.name)?.tarball);
  const sourcesByName = new Map([...additions, ...managedReleasePlugins].map((plugin) => [
    plugin.name,
    materializeTarball(inputsByName.get(plugin.name), plugin, libraryRoot),
  ]));
  const upgrades = managedReleasePlugins.filter((plugin) => (
    !sameFileDependency(
      manifest.dependencies?.[plugin.name],
      sourcesByName.get(plugin.name),
      profileDir,
    ) || !sameArtifactState(artifacts.get(plugin.name), inputsByName.get(plugin.name))
  ));
  const candidates = [...additions, ...upgrades];
  if (candidates.length === 0) {
    writeFeaturedState(profileDir, offered, artifacts);
    return Object.freeze({ created: false, profileDir, initialized: false, migrated: false });
  }
  const commandEnv = controlledDshPluginEnvironment({
    ...env,
    DSH_HOME: home,
    pnpm_config_lockfile: "false",
  }, { dshHome: home, libraryRoot });
  writeFeaturedState(profileDir, offered, artifacts);
  const added = [];
  const upgraded = [];
  for (const plugin of candidates) {
    const source = sourcesByName.get(plugin.name);
    await commandRunner(resolved, [
      "plugin", "--profile", PROFILE_NAME, "add", "-w", source,
      "--save-exact", "--offline", "--ignore-scripts", "--force",
    ], commandEnv);
    if (additions.includes(plugin)) {
      offered.add(plugin.name);
      added.push(plugin.name);
    } else {
      upgraded.push(plugin.name);
    }
  }
  const migratedManifest = api.readProfileManifest("dsh-work", profileDir);
  assertInitialProfile(migratedManifest, [...added, ...upgraded]);
  await commandRunner(resolved, ["--profile", PROFILE_NAME, "--dump-config"], commandEnv);
  for (const plugin of candidates) {
    const state = artifactState(inputsByName.get(plugin.name));
    if (state) artifacts.set(plugin.name, state);
  }
  writeFeaturedState(profileDir, offered, artifacts);
  return Object.freeze({
    created: false,
    profileDir,
    initialized: false,
    migrated: added.length > 0 || upgraded.length > 0,
    added: Object.freeze(added),
    upgraded: Object.freeze(upgraded),
  });
}

async function initializeUnlocked({
  resolved,
  dshHome,
  env = process.env,
  appRoot,
  profileApi,
  commandRunner = defaultCommandRunner,
} = {}) {
  if (!resolved || !dshHome) throw profileError("缺少 DSH Profile 初始化上下文", "DSH_PROFILE_INIT_CONTEXT_MISSING");
  const api = profileApi || await import(pathToFileURL(resolved.appBootPath).href);
  const home = resolve(dshHome);
  const finalProfileDir = profilePath(api, home);
  const finalManifestPath = join(finalProfileDir, "package.json");
  if (existsSync(finalManifestPath)) {
    return reconcileExistingProfile({
      resolved,
      home,
      env,
      appRoot: appRoot || resolve(env.DSH_APP_ROOT || process.cwd()),
      api,
      profileDir: finalProfileDir,
      commandRunner,
    });
  }
  if (existsSync(finalProfileDir)) {
    throw profileError(`DSH Profile 目录存在但缺少 manifest：${finalProfileDir}`, "DSH_PROFILE_INCOMPLETE");
  }

  const libraryRoot = resolve(env.DSH_PROFILE_PLUGIN_LIBRARY || join(home, "plugin-library"));
  mkdirSync(home, { recursive: true });
  const inputs = pluginInputs(env, appRoot || resolve(env.DSH_APP_ROOT || process.cwd()));
  const sources = inputs.map((input, index) => materializeTarball(input, featuredPlugins()[index], libraryRoot));
  const stagingHome = mkdtempSync(join(dirname(home), ".dsh-profile-init-"));
  const commandEnv = controlledDshPluginEnvironment({
    ...env,
    DSH_PROFILE_INITIALIZATION: "1",
    DSH_HOME: stagingHome,
    pnpm_config_lockfile: "false",
  }, { dshHome: stagingHome, libraryRoot });
  try {
    const stagingProfileDir = profilePath(api, stagingHome);
    const profileTemplate = api.PROFILE_TEMPLATES?.web;
    const templateBundles = Array.isArray(profileTemplate)
      ? profileTemplate
      : profileTemplate?.bundles || api.DEFAULT_PROFILE_BUNDLES || OFFICIAL_PROFILE_BUNDLES;
    const templatePatchReload = Array.isArray(profileTemplate) ? undefined : profileTemplate?.patchReload;
    await api.initProfile(stagingProfileDir, templateBundles, templatePatchReload);
    if (env.DSH_PROFILE_INITIALIZATION_MODE !== "safe") {
      for (const source of sources) {
        await commandRunner(resolved, [
          "plugin", "--profile", PROFILE_NAME, "add", "-w", source,
          "--save-exact", "--offline", "--ignore-scripts",
        ], commandEnv);
      }
    }
    const manifest = api.readProfileManifest("dsh-work", stagingProfileDir);
    const expectedBundles = env.DSH_PROFILE_INITIALIZATION_MODE === "safe"
      ? OFFICIAL_PROFILE_BUNDLES
      : featuredPlugins().map((plugin) => plugin.name);
    assertInitialProfile(manifest, expectedBundles, {
      requireDependencies: env.DSH_PROFILE_INITIALIZATION_MODE !== "safe",
    });
    await commandRunner(resolved, ["--profile", PROFILE_NAME, "--dump-config"], commandEnv);
    writeFeaturedState(
      stagingProfileDir,
      env.DSH_PROFILE_INITIALIZATION_MODE === "safe" ? [] : featuredPlugins().map((plugin) => plugin.name),
      new Map(inputs.flatMap((input, index) => {
        const state = artifactState(input);
        return state ? [[featuredPlugins()[index].name, state]] : [];
      })),
    );
    mkdirSync(dirname(finalProfileDir), { recursive: true });
    if (existsSync(finalManifestPath) || existsSync(finalProfileDir)) {
      throw profileError("DSH Profile 在初始化期间被其他操作创建", "DSH_PROFILE_INIT_RACE");
    }
    renameSync(stagingProfileDir, finalProfileDir);
    try {
      rebasePublishedProfileLinks(finalProfileDir, stagingProfileDir, finalProfileDir);
    } catch (error) {
      renameSync(finalProfileDir, stagingProfileDir);
      throw error;
    }
    return Object.freeze({
      created: true,
      initialized: true,
      profileDir: finalProfileDir,
      pluginLibrary: libraryRoot,
      bundles: Object.freeze([...(manifest.dsh?.profile?.bundles || [])]),
    });
  } finally {
    unlinkStagingProfileFallbacks(stagingHome);
    rmSync(stagingHome, { recursive: true, force: true });
  }
}

/** Initialize a new Web Profile or offer newly bundled defaults to an existing Profile once. */
export function ensureDshProfileInitialized(options = {}) {
  const key = `${resolve(options.dshHome || ".")}\u0000${PROFILE_NAME}`;
  const previous = initializationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => initializeUnlocked(options));
  initializationQueues.set(key, current);
  return current.finally(() => {
    if (initializationQueues.get(key) === current) initializationQueues.delete(key);
  });
}

/** Return the official Web Profile path without creating it. */
export function existingDshProfilePath(profileApi, dshHome) {
  return profilePath(profileApi, dshHome);
}

/** Return the stable package-library directory used by DSH plugin commands. */
export function dshProfilePluginLibraryPath(dshHome, env = process.env) {
  return resolve(env.DSH_PROFILE_PLUGIN_LIBRARY || join(resolve(dshHome), "plugin-library"));
}

export const DSH_PROFILE_NAME = PROFILE_NAME;
export const DSH_OFFICIAL_PROFILE_BUNDLES = OFFICIAL_PROFILE_BUNDLES;
