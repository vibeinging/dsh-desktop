import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MANIFEST = JSON.parse(readFileSync(new URL("./featured_plugins.json", import.meta.url), "utf8"));

function inside(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
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
    if (plugin.default !== true || plugin.user_manageable !== true) {
      throw new Error(`${plugin.name} 必须明确声明为默认且可由用户管理`);
    }
    names.add(plugin.name);
  }
  return Object.freeze({
    schema_version: value.schema_version,
    profile: value.profile,
    plugins: Object.freeze(value.plugins.map((plugin) => Object.freeze({
      ...plugin,
      permissions: Object.freeze([...plugin.permissions]),
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
