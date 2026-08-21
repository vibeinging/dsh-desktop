import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MANIFEST = JSON.parse(readFileSync(new URL("./featured_plugins.json", import.meta.url), "utf8"));

function inside(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function validateEvidence(plugin) {
  const evidence = plugin.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error(`${plugin.name} 必须提供逐包评估证据`);
  }
  for (const field of ["source_kind", "release_source", "entry", "patch_id", "network", "profile_install", "profile_uninstall", "cost_measurement"]) {
    if (typeof evidence[field] !== "string" || !evidence[field].trim()) {
      throw new Error(`${plugin.name} 的评估证据缺少 ${field}`);
    }
  }
  if (evidence.source_kind !== "workspace-package" || evidence.release_source !== "fixed-tarball") {
    throw new Error(`${plugin.name} 的评估证据必须指向工作区源码和固定 tarball`);
  }
  if (!evidence.compatibility || typeof evidence.compatibility !== "object"
    || typeof evidence.compatibility.dsh_sdk !== "string"
    || typeof evidence.compatibility.cordis !== "string") {
    throw new Error(`${plugin.name} 的评估证据缺少 DSH/Cordis 兼容性`);
  }
  if (!Array.isArray(evidence.lifecycle_scripts) || evidence.lifecycle_scripts.some((item) => typeof item !== "string")) {
    throw new Error(`${plugin.name} 的 lifecycle_scripts 必须是字符串数组`);
  }
  if (!Array.isArray(evidence.native_dependencies) || evidence.native_dependencies.some((item) => typeof item !== "string")) {
    throw new Error(`${plugin.name} 的 native_dependencies 必须是字符串数组`);
  }
  if (typeof evidence.client !== "boolean") throw new Error(`${plugin.name} 的 client 评估必须是布尔值`);
  if (evidence.desktop_runtime_required !== undefined && typeof evidence.desktop_runtime_required !== "boolean") {
    throw new Error(`${plugin.name} 的 desktop_runtime_required 必须是布尔值`);
  }
  if (!Array.isArray(evidence.regression?.unit) || !Array.isArray(evidence.regression?.profile)
    || !Array.isArray(evidence.regression?.electron)
    || [evidence.regression.unit, evidence.regression.profile, evidence.regression.electron]
      .some((items) => items.length === 0 || items.some((item) => typeof item !== "string" || !item.trim()))) {
    throw new Error(`${plugin.name} 必须为 unit/profile/electron 分别声明回归证据`);
  }
  return evidence;
}

function validateManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== 1) {
    throw new Error("精选插件清单版本无效");
  }
  if (value.profile !== "web" || !Array.isArray(value.plugins) || value.plugins.length === 0) {
    throw new Error("精选插件清单必须声明 web Profile 和非空插件列表");
  }
  const names = new Set();
  for (const plugin of value.plugins) {
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
      throw new Error("精选插件清单中的插件必须是对象");
    }
    if (typeof plugin.name !== "string" || !plugin.name.trim() || names.has(plugin.name)) {
      throw new Error(`精选插件名称无效或重复：${plugin.name || "unknown"}`);
    }
    if (typeof plugin.package_path !== "string" || !plugin.package_path.startsWith("packages/")) {
      throw new Error(`${plugin.name} 的 package_path 必须位于 packages/ 下`);
    }
    if (typeof plugin.license !== "string" || !plugin.license.trim()) {
      throw new Error(`${plugin.name} 必须声明 SPDX 许可证`);
    }
    if (!new Set(["portable", "desktop-adapter"]).has(plugin.portability)) {
      throw new Error(`${plugin.name} 的 portability 无效`);
    }
    if (!Array.isArray(plugin.permissions) || plugin.permissions.some((item) => typeof item !== "string")) {
      throw new Error(`${plugin.name} 的 permissions 必须是字符串数组`);
    }
    if (plugin.default !== true || typeof plugin.user_manageable !== "boolean") {
      throw new Error(`${plugin.name} 必须明确声明为默认，并声明是否可由用户管理`);
    }
    validateEvidence(plugin);
    if (!plugin.user_manageable && plugin.evidence.desktop_runtime_required !== true) {
      throw new Error(`${plugin.name} 不可由用户管理时必须声明 desktop_runtime_required`);
    }
    names.add(plugin.name);
  }
  return Object.freeze({
    schema_version: value.schema_version,
    profile: value.profile,
    plugins: Object.freeze(value.plugins.map((plugin) => Object.freeze({
      ...plugin,
      permissions: Object.freeze([...plugin.permissions]),
      evidence: freeze(structuredClone(plugin.evidence)),
    }))),
  });
}

const FEATURED_PLUGIN_MANIFEST = validateManifest(MANIFEST);
const FEATURED_PLUGINS = FEATURED_PLUGIN_MANIFEST.plugins;
const FEATURED_BY_NAME = new Map(FEATURED_PLUGINS.map((plugin) => [plugin.name, plugin]));

/** Return the immutable release input for the default DSH Desktop bundles. */
export function featuredPluginManifest() {
  return FEATURED_PLUGIN_MANIFEST;
}

/** Return the immutable list of default bundles supplied by DSH Desktop. */
export function featuredPlugins() {
  return FEATURED_PLUGINS;
}

/** Return the default bundle names in Profile installation order. */
export function featuredPluginNames() {
  return FEATURED_PLUGINS.map((plugin) => plugin.name);
}

/** Return one default bundle declaration by its package name. */
export function featuredPluginByName(name) {
  return FEATURED_BY_NAME.get(name) || null;
}

/** Resolve one workspace package from the curated manifest without allowing path escape. */
export function resolveFeaturedPackageDir(plugin, { appRoot = APP_ROOT } = {}) {
  const root = resolve(appRoot);
  const packageDir = resolve(root, plugin.package_path);
  if (!inside(root, packageDir)) throw new Error(`${plugin.name} 的 package_path 越过应用目录`);
  return packageDir;
}

/** Return a stable tarball filename for one exact package version. */
export function featuredPluginTarballName(name, version) {
  const safeName = String(name || "").replace(/^@/, "").replaceAll("/", "-");
  const safeVersion = String(version || "").replace(/[^0-9A-Za-z.+-]/g, "-");
  if (!safeName || !safeVersion) throw new Error("精选插件 tarball 缺少包名或版本");
  return `${safeName}-${safeVersion}.tgz`;
}

export const FEATURED_PLUGIN_APP_ROOT = APP_ROOT;
