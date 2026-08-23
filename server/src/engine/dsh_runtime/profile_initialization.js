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
  const filename = String(input.tarballName || input.tarball.split(/[\\/]/).at(-1) || "");
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
    const finalVirtualStore = join(targetRoot, "node_modules", ".pnpm");
    const after = rebasedPaths.replace(
      /^(\s*virtualStoreDir:\s*).*$/mu,
      (_line, prefix) => `${prefix}${JSON.stringify(finalVirtualStore)}`,
    );
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
    return Object.freeze({ created: false, profileDir: finalProfileDir, initialized: false });
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
    const template = api.PROFILE_TEMPLATES?.web || api.DEFAULT_PROFILE_BUNDLES || OFFICIAL_PROFILE_BUNDLES;
    await api.initProfile(stagingProfileDir, template);
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

/** Initialize a new Web Profile once; existing Profile state is never changed. */
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
