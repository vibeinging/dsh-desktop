#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RETIRED_NAMES = ["dsh-work-shell", "dsh-theme-pack", "dsh-workbench-pages"];
const RETIRED_PUBLIC_IMAGE_NAMES = [
  "dsh-product-bridge.jpg",
  "dsh-product-bridge.png",
  "dsh-profile-bundles.jpg",
  "dsh-profile-bundles.png",
  "dsh-trajectory.gif",
  "dsh-trajectory.png",
  "dsh-web-ui-task-board.png",
  "dsh-work-canvas.png",
  "dsh-work-files.png",
  "dsh-work-home-professional-dark.png",
  "dsh-work-home-professional-light.png",
  "dsh-work-home.png",
  "dsh-work-project-session.png",
  "dsh-work-site.png",
  "dsh-work-themes.png",
  "dsh-work-worktree.gif",
  "dsh-work-worktree.png",
];
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
  const defaultDevPath = join(appRoot, "scripts", "dev.mjs");
  const recoveryPath = join(appRoot, "electron", "recovery.html");
  const main = readText(mainPath);
  const preparePackage = readText(preparePackagePath);
  const defaultDev = existsSync(defaultDevPath) ? readText(defaultDevPath) : "";
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
  if (/buildDshClientPlugin|build:dsh-client|dsh-work Client Plugin/.test(defaultDev)) {
    errors.push("默认开发入口仍会构建退役 Renderer 或自研 Client");
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
  errors.push(...inspectPublicReleaseAssets(appRoot));
  errors.push(...inspectFeaturedPluginDocs(appRoot, featured));
  return errors;
}

/** Reject public screenshots that advertise retired Renderer surfaces. */
export function inspectPublicReleaseAssets(root = ROOT) {
  const appRoot = resolve(root);
  const imageRoot = join(appRoot, "docs", "images", "readme");
  return RETIRED_PUBLIC_IMAGE_NAMES
    .filter((name) => existsSync(join(imageRoot, name)))
    .map((name) => `公开素材仍包含退役 UI 图片：docs/images/readme/${name}`);
}

function packageNameFromSource(source) {
  return String(source || "").match(/^((?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+)@/)?.[1] || null;
}

/** Check that the public default-Bundle tables are generated from the curated input. */
function inspectFeaturedPluginDocs(root, featured) {
  const errors = [];
  for (const file of ["README.md", "README.en.md"]) {
    const path = join(root, file);
    if (!existsSync(path)) {
      errors.push(`公开文档不存在：${file}`);
      continue;
    }
    const section = readText(path).match(/<!-- featured-plugins:start -->[\s\S]*?<!-- featured-plugins:end -->/)?.[0];
    if (!section) {
      errors.push(`${file} 缺少精选插件生成区块`);
      continue;
    }
    const rows = section.split("\n").filter((line) => line.startsWith("| `"));
    if (rows.length !== (featured.plugins || []).length) {
      errors.push(`${file} 精选插件表行数与精选清单不一致`);
    }
    for (const plugin of featured.plugins || []) {
      const command = `dsh plugin --profile ${featured.profile} remove ${plugin.name}`;
      const foundationText = file === "README.en.md"
        ? "desktop foundation; uninstall is not offered"
        : "桌面基础服务，不提供卸载";
      const managementText = plugin.user_manageable === false ? foundationText : command;
      if (!section.includes(plugin.name) || !section.includes(managementText)) {
        errors.push(`${file} 缺少精选插件或官方管理方式：${plugin.name}`);
      }
      for (const permission of plugin.permissions || []) {
        if (!section.includes(permission)) errors.push(`${file} 缺少插件权限：${plugin.name}/${permission}`);
      }
    }
  }
  return errors;
}

/** Check that skin and other bundled visual assets have an explicit redistribution decision. */
export function inspectCommunityAssetLicenseBoundary(root = ROOT) {
  const appRoot = resolve(root);
  const registry = readJson(join(appRoot, "server/src/engine/dsh_runtime/community_plugin_registry.json"));
  const featured = readJson(join(appRoot, "server/src/engine/dsh_runtime/featured_plugins.json"));
  const errors = [];
  const featuredNames = new Set((featured.plugins || []).map((plugin) => plugin.name));
  for (const plugin of Array.isArray(registry.plugins) ? registry.plugins : []) {
    const searchable = [
      plugin.id,
      plugin.name,
      plugin.category,
      plugin.source,
      plugin.asset_surface,
      plugin.description,
      plugin.description_zh,
    ].map((value) => String(value || "")).join(" ");
    if (!plugin.asset_surface && !/(?:skin|skins|theme|皮肤|主题)/i.test(searchable)) continue;
    const review = plugin.asset_review;
    if (!review || typeof review !== "object" || Array.isArray(review)) {
      errors.push(`${plugin.id || plugin.name || "社区插件"} 缺少资产许可审查记录`);
      continue;
    }
    if (!new Set(["approved", "blocked"]).has(review.status)) {
      errors.push(`${plugin.id || plugin.name} 的资产许可状态无效`);
    }
    if (!new Set(["approved", "blocked"]).has(review.redistribution)
      || review.redistribution !== review.status) {
      errors.push(`${plugin.id || plugin.name} 的资产再分发状态必须与许可审查状态一致`);
    }
    if (typeof plugin.license !== "string" || !plugin.license.trim()) {
      errors.push(`${plugin.id || plugin.name} 缺少包级 SPDX 许可证`);
    }
    if (!Array.isArray(review.asset_licenses)
      || review.asset_licenses.length === 0
      || review.asset_licenses.some((license) => typeof license !== "string" || !license.trim())) {
      errors.push(`${plugin.id || plugin.name} 缺少资产许可证列表`);
    }
    if (typeof review.reason_zh !== "string" || !review.reason_zh.trim()) {
      errors.push(`${plugin.id || plugin.name} 缺少资产许可结论`);
    }
    if (typeof review.evidence !== "string" || !/^https:\/\//.test(review.evidence)) {
      errors.push(`${plugin.id || plugin.name} 缺少资产许可证据链接`);
    }
    const packageName = packageNameFromSource(plugin.source);
    if (packageName && featuredNames.has(packageName) && review.status !== "approved") {
      errors.push(`${packageName} 的未批准资产不能进入精选清单`);
    }
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
  const expectedPlugins = new Map((featured.plugins || []).map((plugin) => [plugin.name, plugin]));
  const expectedNames = new Set(expectedPlugins.keys());
  const actualNames = new Set((generated.plugins || []).map((plugin) => plugin.name));
  if (expectedNames.size !== actualNames.size || [...expectedNames].some((name) => !actualNames.has(name))) {
    errors.push("随包精选插件 manifest 与源码清单不一致");
  }
  const projectionFiles = ["profile-install.json", "permissions.json", "test-expected.json", "evaluation.json", "THIRD_PARTY_NOTICES.md"];
  for (const file of projectionFiles) {
    if (!existsSync(join(artifactRoot, file))) errors.push(`随包精选插件缺少清单投影：${file}`);
  }
  if (existsSync(join(artifactRoot, "profile-install.json"))) {
    const profileInstall = readJson(join(artifactRoot, "profile-install.json"));
    const installRows = (profileInstall.commands || []).map(({ name, tarball, sha256: hash }) => ({
      name,
      tarball,
      sha256: hash,
    }));
    const actualInstallRows = (generated.plugins || []).map(({ name, tarball, sha256: hash }) => ({
      name,
      tarball,
      sha256: hash,
    }));
    if (profileInstall.profile !== generated.profile
      || JSON.stringify(installRows) !== JSON.stringify(actualInstallRows)) {
      errors.push("profile-install.json 与精选插件 manifest 不一致");
    }
  }
  if (existsSync(join(artifactRoot, "permissions.json"))) {
    const permissions = readJson(join(artifactRoot, "permissions.json"));
    const permissionRows = (permissions.plugins || []).map(({ name, version, permissions: declared, host_requirements, portability, user_manageable }) => ({
      name,
      version,
      permissions: declared,
      host_requirements,
      portability,
      user_manageable,
    }));
    const actualPermissionRows = (generated.plugins || []).map(({ name, version, permissions: declared, host_requirements, portability, user_manageable }) => ({
      name,
      version,
      permissions: declared,
      host_requirements,
      portability,
      user_manageable,
    }));
    if (JSON.stringify(permissionRows) !== JSON.stringify(actualPermissionRows)) {
      errors.push("permissions.json 与精选插件 manifest 不一致");
    }
  }
  if (existsSync(join(artifactRoot, "test-expected.json"))) {
    const expected = readJson(join(artifactRoot, "test-expected.json"));
    const expectedTarballs = expected.tarballs || [];
    const actualTarballs = (generated.plugins || []).map(({ name, tarball, sha256: hash, size_bytes }) => ({
      name,
      tarball,
      sha256: hash,
      size_bytes,
    }));
    if (expected.profile !== generated.profile
      || JSON.stringify(expected.bundles || []) !== JSON.stringify([...actualNames])
      || JSON.stringify(expectedTarballs) !== JSON.stringify(actualTarballs)) {
      errors.push("test-expected.json 与精选插件 manifest 不一致");
    }
  }
  if (existsSync(join(artifactRoot, "evaluation.json"))) {
    const evaluation = readJson(join(artifactRoot, "evaluation.json"));
    const actualEvaluations = (generated.plugins || []).map(({
      name,
      version,
      package_path,
      package_license,
      portability,
      permissions,
      tarball,
      sha256: hash,
      size_bytes,
      evidence,
    }) => ({
      name,
      version,
      package_path,
      license: package_license,
      portability,
      permissions,
      tarball,
      sha256: hash,
      size_bytes,
      evidence,
    }));
    if (evaluation.schema_version !== 1
      || evaluation.profile !== generated.profile
      || evaluation.source !== "server/src/engine/dsh_runtime/featured_plugins.json"
      || JSON.stringify(evaluation.plugins || []) !== JSON.stringify(actualEvaluations)) {
      errors.push("evaluation.json 与精选插件 manifest 不一致");
    }
  }
  for (const plugin of generated.plugins || []) {
    const expected = expectedPlugins.get(plugin.name);
    if (!expected) {
      errors.push(`随包 manifest 包含未精选的插件：${plugin.name}`);
      continue;
    }
    if (plugin.package_path !== expected.package_path || plugin.package_license !== expected.license) {
      errors.push(`${plugin.name} 的源路径或许可证与精选清单不一致`);
    }
    const licenseFile = join(artifactRoot, plugin.license_file || "");
    if (!plugin.license_file || !existsSync(licenseFile)) {
      errors.push(`${plugin.name} 缺少许可证原文：${plugin.license_file || "(未声明)"}`);
    }
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

/** Check that the measured featured-plugin report matches the current source and artifact manifest. */
export function inspectFeaturedMeasurement(root = ROOT, { required = false } = {}) {
  const appRoot = resolve(root);
  const reportPath = join(appRoot, '.desktop-build', 'reports', 'featured-plugin-evaluation.json');
  const sourcePath = join(appRoot, 'server', 'src', 'engine', 'dsh_runtime', 'featured_plugins.json');
  const artifactPath = join(appRoot, '.desktop-build', 'featured-plugins', 'manifest.json');
  if (!existsSync(reportPath)) return required ? ['缺少精选插件逐包测量报告'] : [];
  if (!existsSync(sourcePath) || !existsSync(artifactPath)) return ['精选插件测量报告缺少当前源或产物 manifest'];
  const report = readJson(reportPath);
  const artifact = readJson(artifactPath);
  const errors = [];
  if (report.schema_version !== 2) errors.push('精选插件测量报告 schema_version 不是 2');
  if (report.featured_source?.sha256 !== sha256(sourcePath)) errors.push('精选插件测量报告与当前源 manifest SHA-256 不一致');
  if (report.artifact_manifest?.sha256 !== sha256(artifactPath)) errors.push('精选插件测量报告与当前产物 manifest SHA-256 不一致');
  const commit = spawnSync('git', ['-C', appRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const currentCommit = String(commit.stdout || '').trim().toLowerCase();
  if (/^[0-9a-f]{40}$/.test(currentCommit) && report.git_commit_sha !== currentCommit) {
    errors.push('精选插件测量报告 git_commit_sha 与当前提交不一致');
  }
  const measured = new Map((report.plugins || []).map((plugin) => [plugin.name, plugin]));
  for (const plugin of artifact.plugins || []) {
    const measurement = measured.get(plugin.name);
    if (!measurement) {
      errors.push(`精选插件测量报告缺少 ${plugin.name}`);
      continue;
    }
    if (measurement.tarball !== plugin.tarball || measurement.sha256 !== plugin.sha256) {
      errors.push(`精选插件测量报告与 ${plugin.name} 当前 tarball/hash 不一致`);
    }
    if (measurement.status !== 'passed') {
      errors.push(`精选插件测量报告中的 ${plugin.name} status 不是 passed`);
    }
  }
  if (measured.size !== (artifact.plugins || []).length) errors.push('精选插件测量报告包含未生成的插件');
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
    ...inspectCommunityAssetLicenseBoundary(ROOT),
    ...inspectFeaturedArtifacts(ROOT, { required: args.has("--require-artifacts") }),
    ...(args.has("--syntax") ? checkReleaseJavaScript(ROOT) : []),
  ];
  if (errors.length > 0) fail(errors.join("\n"));
  console.log("[release-boundary] PASS official Web / native Host / curated artifacts boundary");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
