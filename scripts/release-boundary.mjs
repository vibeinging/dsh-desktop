#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RETIRED_NAMES = ["dsh-work-shell", "dsh-theme-pack", "dsh-workbench-pages"];
const JS_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function walkFiles(path, output = []) {
  if (!existsSync(path)) return output;
  const info = statSync(path);
  if (info.isFile()) {
    output.push(path);
    return output;
  }
  for (const name of readdirSync(path)) {
    if (["node_modules", "release", ".desktop-build"].includes(name)) continue;
    walkFiles(join(path, name), output);
  }
  return output;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fail(message) {
  throw new Error(`[release-boundary] ${message}`);
}

/** Check that the packaged app has one official Web entry and no old product bridge. */
export function inspectOfficialWebReleaseBoundary(root = ROOT) {
  const appRoot = resolve(root);
  const mainPath = join(appRoot, "electron", "main.js");
  const packagePath = join(appRoot, "electron", "package.json");
  const preparePackagePath = join(appRoot, "electron", "scripts", "prepare-package.mjs");
  const recoveryPath = join(appRoot, "electron", "recovery.html");
  const main = readText(mainPath);
  const preparePackage = readText(preparePackagePath);
  const electronPackage = readJson(packagePath);
  const files = Array.isArray(electronPackage.build?.files) ? electronPackage.build.files : [];
  const featured = readJson(join(appRoot, "server", "src", "engine", "dsh_runtime", "featured_plugins.json"));
  const errors = [];

  if (!/rendererSurfaceUrl\s*=\s*await resolveRendererSurface\(\)/.test(main)) {
    errors.push("Electron 主窗口没有使用官方 DSH Web surface");
  }
  if (!/profile-preflight/.test(main)) {
    errors.push("应用更新没有调用 DSH Profile 只读预检");
  }
  if (/\bipcMain\b|\bpreload\s*:|window\.electronAPI/.test(main)) {
    errors.push("官方 Web 主窗口仍包含通用 IPC、preload 或 electronAPI");
  }
  if (files.some((entry) => /(^|\/)preload\.js$|(^|\/)renderer(\/|$)/.test(String(entry)))) {
    errors.push("发行包仍包含旧 Renderer 或 preload");
  }
  if (!files.includes("runtime-recovery.js") || !files.includes("recovery.html")) {
    errors.push("发行包缺少本地恢复页");
  }
  if (!/DSH_PNPM_NODE_BIN is required/.test(preparePackage)
    || /DSH_PNPM_NODE_BIN:-node/.test(preparePackage)) {
    errors.push("随包 pnpm 仍可能回退到系统 Node");
  }
  if (!existsSync(recoveryPath) || /window\.electronAPI|ipcRenderer|nodeIntegration|dsh-web-app|plugin market/i.test(readText(recoveryPath))) {
    errors.push("恢复页不是纯本地最小安全页面");
  }
  const names = Array.isArray(featured.plugins) ? featured.plugins.map((plugin) => plugin.name) : [];
  for (const name of names) {
    if (!name.startsWith("@vibeinging/")) errors.push(`自研精选包没有使用自有 scope：${name}`);
    if (RETIRED_NAMES.some((retired) => name.endsWith(`/${retired}`))) {
      errors.push(`精选清单仍包含退役包：${name}`);
    }
  }
  if (names.length === 0 || featured.profile !== "web") errors.push("精选清单不是非空 web Profile 输入");
  if (existsSync(join(appRoot, "packages", "dsh-theme-pack", "package.json"))) errors.push("自研主题包仍存在");
  for (const path of [
    "server/src/engine/dsh_runtime/profile_theme_manifest.js",
    "server/src/engine/dsh_runtime/theme_default.js",
    "electron/skin-settings-store.js",
  ]) {
    if (existsSync(join(appRoot, path))) errors.push(`主题运行时状态仍存在：${path}`);
  }
  if (existsSync(join(appRoot, "server/src/engine/dsh_runtime/trusted_client_plugins.js"))) {
    errors.push("旧的重复精选插件清单仍存在");
  }
  return errors;
}

/** Check generated tarballs, hashes, and names against the one curated input. */
export function inspectFeaturedArtifacts(root = ROOT, { required = false } = {}) {
  const appRoot = resolve(root);
  const artifactRoot = join(appRoot, ".desktop-build", "featured-plugins");
  if (!existsSync(artifactRoot)) return required ? ["缺少 .desktop-build/featured-plugins"] : [];
  const errors = [];
  const featured = readJson(join(appRoot, "server/src/engine/dsh_runtime/featured_plugins.json"));
  const manifestPath = join(artifactRoot, "manifest.json");
  if (!existsSync(manifestPath)) return ["随包精选插件缺少 manifest.json"];
  const generated = readJson(manifestPath);
  const expectedNames = new Set((featured.plugins || []).map((plugin) => plugin.name));
  const actualNames = new Set((generated.plugins || []).map((plugin) => plugin.name));
  if (expectedNames.size !== actualNames.size || [...expectedNames].some((name) => !actualNames.has(name))) {
    errors.push("随包精选插件 manifest 与源码清单不一致");
  }
  for (const plugin of generated.plugins || []) {
    const tarball = join(artifactRoot, plugin.tarball || "");
    if (!existsSync(tarball)) {
      errors.push(`${plugin.name} 缺少固定 tarball`);
      continue;
    }
    if (sha256(tarball) !== plugin.sha256) errors.push(`${plugin.name} tarball SHA-256 不一致`);
    if (RETIRED_NAMES.some((retired) => String(plugin.name).endsWith(`/${retired}`))) {
      errors.push(`随包产物仍包含退役包：${plugin.name}`);
    }
  }
  return errors;
}

/** Run Node syntax checks over the source plane used by the release. */
export function checkReleaseJavaScript(root = ROOT) {
  const appRoot = resolve(root);
  const paths = [
    join(appRoot, "electron"),
    join(appRoot, "server", "src"),
    join(appRoot, "packages"),
    join(appRoot, "scripts"),
  ];
  const errors = [];
  for (const path of paths.flatMap((entry) => walkFiles(entry))) {
    if (!JS_EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) continue;
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    if (result.status !== 0) {
      errors.push(`${relative(appRoot, path)}: ${(result.stderr || result.stdout || "syntax error").trim()}`);
    }
  }
  return errors;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const errors = [
    ...inspectOfficialWebReleaseBoundary(ROOT),
    ...inspectFeaturedArtifacts(ROOT, { required: args.has("--require-artifacts") }),
    ...(args.has("--syntax") ? checkReleaseJavaScript(ROOT) : []),
  ];
  if (errors.length > 0) fail(errors.join("\n"));
  console.log("[release-boundary] PASS official Web / native Host / curated artifacts boundary");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
