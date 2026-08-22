import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import semver from "semver";

import { dataRoot } from "../../config/paths.js";
import { resolveDshRuntimeDistribution } from "./source_locator.js";
import {
  isReviewedCommunityClient,
  reviewedCommunityClientPolicy,
  reviewedCommunityClientReview,
} from "./community_client_review.js";
import {
  controlledDshPluginEnvironment,
  dshProfilePluginLibraryPath,
  existingDshProfilePath,
} from "./profile_initialization.js";
import { featuredPluginByName, featuredPluginNames } from "./featured_plugins.js";

const execFileAsync = promisify(execFile);
const PROFILE_NAME = "web";
const SYSTEM_BUNDLES = new Set(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
const FEATURED_PLUGIN_NAMES = new Set(featuredPluginNames());
const DSH_WORK_WORKBENCH_SLOT = "agent.workbench.tool";
const DSH_WORK_HOST_COMPONENTS = new Map([
  ["review", "dsh-work/review"],
  ["browser", "dsh-work/browser"],
  ["files", "dsh-work/files"],
  ["artifacts", "dsh-work/artifacts"],
  ["sites", "dsh-work/sites"],
]);
const DSH_WORK_HOST_ICONS = new Set(["archive", "dashboard", "file", "terminal", "world"]);
const CURRENT_DSH_SDK_VERSION = "0.1.1-rc.2";
const CURRENT_CORDIS_VERSION = "4.0.1";
const COMMUNITY_PLUGIN_REGISTRY = readJson(new URL("./community_plugin_registry.json", import.meta.url));
const EXACT_REGISTRY_SPEC = /^(?<name>(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+)@(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const EXACT_EXTERNAL_GIT_SPEC = /^github:(?<owner>[a-z0-9._-]+)\/(?<repo>[a-z0-9._-]+)#(?<commit>[0-9a-f]{40})$/i;

function profileError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function inside(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function readJson(path, code = "DSH_PROFILE_MANIFEST_INVALID") {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("必须是 JSON 对象");
    return parsed;
  } catch (error) {
    throw profileError(`无法读取 DSH Profile 包清单：${path}（${error?.message || error}）`, code);
  }
}

/** Validate the versioned dsh-work product descriptor at its package boundary. */
export function validateDshWorkProductDescriptor(descriptor, {
  packageName = "候选插件",
  allowHostComponents = false,
} = {}) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw profileError(`${packageName} 的产品描述必须是对象`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
  }
  if (descriptor.schema_version !== 1) {
    throw profileError(`${packageName} 的产品描述版本必须是 1`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
  }
  if (descriptor.contributions === undefined) return descriptor;
  if (!Array.isArray(descriptor.contributions)) {
    throw profileError(`${packageName} 的产品贡献必须是数组`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
  }
  const ids = new Set();
  descriptor.contributions.forEach((contribution, index) => {
    if (!contribution || typeof contribution !== "object" || Array.isArray(contribution)) {
      throw profileError(`${packageName} 的第 ${index + 1} 个产品贡献必须是对象`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
    }
    const required = ["slot", "id", "component", "label", "icon"];
    for (const field of required) {
      if (typeof contribution[field] !== "string" || !contribution[field].trim()) {
        throw profileError(`${packageName} 的第 ${index + 1} 个产品贡献缺少 ${field}`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
      }
    }
    if (contribution.slot !== DSH_WORK_WORKBENCH_SLOT) {
      throw profileError(`${packageName} 使用了不支持的产品位置：${contribution.slot}`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
    }
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(contribution.id)) {
      throw profileError(`${packageName} 的产品贡献 id 无效：${contribution.id}`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
    }
    if (ids.has(contribution.id)) {
      throw profileError(`${packageName} 的产品贡献 id 重复：${contribution.id}`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
    }
    if (contribution.order !== undefined && !Number.isSafeInteger(contribution.order)) {
      throw profileError(`${packageName} 的产品贡献 order 必须是整数`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
    }
    if (!allowHostComponents) {
      throw profileError(
        `${packageName} 不能请求 DSH Desktop 宿主组件；社区页面贡献必须使用尚未开放的沙箱类型`,
        "DSH_PRODUCT_HOST_COMPONENT_FORBIDDEN",
      );
    }
    if (DSH_WORK_HOST_COMPONENTS.get(contribution.id) !== contribution.component) {
      throw profileError(`${packageName} 请求了未知的 DSH Desktop 宿主组件：${contribution.component}`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
    }
    if (!DSH_WORK_HOST_ICONS.has(contribution.icon)) {
      throw profileError(`${packageName} 请求了未知的工作台图标：${contribution.icon}`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
    }
    ids.add(contribution.id);
  });
  return descriptor;
}

function readProductDescriptor(packageDir, manifest, { allowHostComponents = false } = {}) {
  const declared = manifest?.dshWork?.product;
  if (declared === undefined) return null;
  if (typeof declared !== "string" || !declared.startsWith("./")) {
    throw profileError(`${manifest.name} 的 dshWork.product 必须是包内相对路径`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
  }
  const descriptorPath = realpathSync(resolve(packageDir, declared));
  if (!inside(packageDir, descriptorPath)) {
    throw profileError(`${manifest.name} 的产品描述不能越过包目录`, "DSH_PRODUCT_DESCRIPTOR_INVALID");
  }
  const descriptor = readJson(descriptorPath, "DSH_PRODUCT_DESCRIPTOR_INVALID");
  return validateDshWorkProductDescriptor(descriptor, {
    packageName: manifest.name,
    allowHostComponents,
  });
}

function productInterface(manifest, descriptor) {
  const value = descriptor?.interface || manifest?.dshWork?.interface;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Validate the product-owned portability contract carried by an app Bundle. */
export function readDshWorkPortability(manifest) {
  const value = manifest?.dshWork?.portability;
  if (value === undefined) return null;
  const levels = new Set(["portable", "desktop-adapter"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !levels.has(value.level)
    || !Array.isArray(value.surfaces) || value.surfaces.length === 0
    || value.surfaces.some((surface) => typeof surface !== "string" || !surface.trim())
    || !Array.isArray(value.hostRequirements)
    || value.hostRequirements.some((requirement) => typeof requirement !== "string" || !requirement.trim())
    || (value.compatibilityTest !== undefined
      && (typeof value.compatibilityTest !== "string" || !value.compatibilityTest.trim()))) {
    throw profileError(`${manifest?.name || "App Bundle"} 的 dshWork.portability 无效`, "DSH_PRODUCT_PORTABILITY_INVALID");
  }
  if (value.level === "portable" && (value.hostRequirements.length > 0 || !value.surfaces.includes("official-web"))) {
    throw profileError(
      `${manifest?.name || "App Bundle"} 标记为 portable 时必须支持 official-web 且不能依赖桌面 Host`,
      "DSH_PRODUCT_PORTABILITY_INVALID",
    );
  }
  return Object.freeze({
    level: value.level,
    surfaces: Object.freeze([...value.surfaces]),
    host_requirements: Object.freeze([...value.hostRequirements]),
    compatibility_test: value.compatibilityTest || null,
  });
}

function sourceView(packageName, spec, packageDir, managed) {
  if (managed === "app" || managed === "system") {
    return { type: managed, path: packageDir, label: managed === "app" ? "随 DSH Desktop 提供" : "DSH 内置" };
  }
  if (/^(?:github:|git\+|https?:.*\.git)/i.test(spec)) return { type: "git", spec, label: "Git 固定版本" };
  if (/^(?:file:|link:|\/|[A-Za-z]:[\\/])/.test(spec)) return { type: "local", path: packageDir, spec, label: "本地 Bundle" };
  return { type: "npm", package: packageName, version: spec, label: "npm 固定版本" };
}

function readProfileBundles(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles;
  if (!Array.isArray(bundles) || bundles.some((name) => typeof name !== "string" || !name.trim())) {
    throw profileError(
      "DSH Profile 缺少有效的 dsh.profile.bundles；应用不会替用户补写或修复它",
      "DSH_PROFILE_BUNDLES_INVALID",
    );
  }
  return bundles;
}

function bundleView({
  packageName,
  packageDir,
  manifest,
  dependencySpec,
  index,
  descriptor,
  managed,
  featured = null,
  userManageable = false,
  enabled = true,
}) {
  const ui = productInterface(manifest, descriptor);
  const source = sourceView(packageName, dependencySpec || "", packageDir, managed);
  const version = typeof manifest.version === "string" ? manifest.version : null;
  const dshClient = manifest?.dsh?.client?.platform === "web";
  const portability = readDshWorkPortability(manifest) || (featured ? {
    level: featured.portability,
    surfaces: ["official-web", "dsh-desktop"],
    host_requirements: [...featured.permissions],
    compatibility_test: featured.evidence.regression.electron[0] || null,
  } : null);
  const canUninstall = managed === "user" || (managed === "app" && userManageable);
  return {
    id: packageName,
    name: packageName,
    display_name: String(ui.display_name || ui.displayName || manifest.displayName || packageName),
    description: String(ui.description || manifest.description || "DSH Profile Bundle"),
    long_description: String(ui.long_description || ui.longDescription || manifest.description || ""),
    developer_name: String(ui.developer_name || ui.developerName || ""),
    category: String(ui.category || "DSH Profile"),
    capabilities: Array.isArray(ui.capabilities) ? ui.capabilities.map(String) : [],
    version,
    local_version: version,
    available_version: version,
    update_available: false,
    installed: true,
    enabled,
    blocked_reason: null,
    runtime_kind: "profile_bundle",
    profile_name: PROFILE_NAME,
    profile_order: index,
    managed_by: managed,
    product_plugin: Boolean(descriptor),
    ui_runtime: {
      kind: dshClient ? "dsh_client" : descriptor ? "dsh_work_descriptor" : "host_only",
      client_graph: enabled && dshClient,
    },
    installation: managed === "system" || managed === "app" ? "INSTALLED_BY_DEFAULT" : "AVAILABLE",
    authentication: "ON_USE",
    availability: "AVAILABLE",
    source: source.type,
    source_details: source,
    marketplace_name: `profile:${PROFILE_NAME}`,
    marketplace_path: null,
    readonly: !canUninstall,
    can_install: false,
    can_update: false,
    can_toggle: false,
    can_uninstall: canUninstall,
    skills_count: 0,
    apps_count: 0,
    app_templates_count: 0,
    mcp_count: 0,
    hooks_count: 0,
    scheduled_tasks_count: 0,
    connection_state: "not_required",
    connected_apps_count: 0,
    apps_needing_connection_count: 0,
    product: descriptor,
    portability,
  };
}

/** Reject mutable or unreviewable package selectors before pnpm sees them. */
export function normalizeProfileBundleSource(value, { allowLocal = false } = {}) {
  const source = String(value || "").trim();
  if (!source || source.startsWith("-")) {
    throw profileError("请输入带固定版本的 npm 包，或 GitHub 仓库的精确 commit", "DSH_PROFILE_SOURCE_REQUIRED");
  }
  if (EXACT_REGISTRY_SPEC.test(source) || EXACT_EXTERNAL_GIT_SPEC.test(source)) return source;
  const local = source.startsWith("file:") ? source.slice(5) : source;
  if (allowLocal && isAbsolute(local) && existsSync(join(resolve(local), "package.json"))) {
    return `file:${resolve(local)}`;
  }
  throw profileError(
    "来源必须是精确 npm 版本、github:<owner>/<repo>#<40位commit>，或已允许的本地包目录",
    "DSH_PROFILE_SOURCE_NOT_PINNED",
  );
}

function currentReleaseRange(value, version) {
  const range = String(value || "").trim();
  if (!/^(?:\^|~)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range)) return false;
  return semver.satisfies(version, range);
}

/** Require one coherent official SDK release before a Bundle reaches the live tree. */
export function validateProfileBundleSdk(manifest) {
  const dependencies = { ...manifest?.dependencies, ...manifest?.peerDependencies };
  const optionalLegacyCordisPeer = Boolean(
    manifest?.peerDependencies?.cordis
    && manifest?.peerDependenciesMeta?.cordis?.optional === true
    && dependencies["@deepseek-ai/cordis"],
  );
  if (dependencies.cordis && !optionalLegacyCordisPeer) {
    throw profileError(
      `${manifest.name} 仍使用旧的 cordis 包，需要改用 @deepseek-ai/cordis@${CURRENT_CORDIS_VERSION}`,
      "DSH_PROFILE_LEGACY_SDK",
    );
  }
  if (dependencies["@deepseek-ai/cordis"]
    && !currentReleaseRange(dependencies["@deepseek-ai/cordis"], CURRENT_CORDIS_VERSION)) {
    throw profileError(
      `${manifest.name} 的 @deepseek-ai/cordis 版本不属于当前 ${CURRENT_CORDIS_VERSION} 发布线`,
      "DSH_PROFILE_LEGACY_SDK",
    );
  }
  const mismatchedDsh = Object.entries(dependencies).filter(([name, version]) => {
    if (!name.startsWith("@deepseek-ai/dsh-")) return false;
    const optionalPeer = manifest?.dependencies?.[name] === undefined
      && manifest?.peerDependenciesMeta?.[name]?.optional === true;
    return !optionalPeer && !currentReleaseRange(version, CURRENT_DSH_SDK_VERSION);
  });
  if (mismatchedDsh.length) {
    throw profileError(
      `${manifest.name} 依赖的 DSH SDK 不属于当前 ${CURRENT_DSH_SDK_VERSION} 发布线：${mismatchedDsh.map(([name, version]) => `${name}@${version}`).join("、")}`,
      "DSH_PROFILE_LEGACY_SDK",
    );
  }
}

function clientExportOf(manifest) {
  const declared = manifest?.exports?.["./client"];
  if (typeof declared === "string") return declared;
  if (declared && typeof declared === "object" && !Array.isArray(declared)
    && typeof declared.default === "string") return declared.default;
  return null;
}

function lockfilePackageLine(name, version) {
  return `  /${String(name)}@${String(version)}`;
}

/** Read the registry integrity recorded by pnpm for one installed Profile package. */
export function readProfilePackageIntegrity(profileDir, packageName, version) {
  const marker = lockfilePackageLine(packageName, version);
  const lockfiles = [
    join(profileDir, "pnpm-lock.yaml"),
    join(profileDir, "node_modules", ".pnpm", "lock.yaml"),
  ];
  for (const lockfile of lockfiles) {
    if (!existsSync(lockfile)) continue;
    const lines = readFileSync(lockfile, "utf8").split(/\r?\n/);
    const start = lines.findIndex((line) => {
      if (!line.startsWith(marker)) return false;
      const suffix = line.slice(marker.length);
      return suffix === ":" || /^\([^\n]*\):$/.test(suffix);
    });
    if (start < 0) continue;
    const block = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^  \/.+:$/.test(lines[index])) break;
      block.push(lines[index]);
    }
    const integrity = block.join("\n").match(
      /^\s+resolution:\s*\{[^\n]*\bintegrity:\s*([^,}\s]+)[^\n]*\}/m,
    )?.[1] || block.join("\n").match(/^\s+integrity:\s*([^\s]+)\s*$/m)?.[1];
    if (integrity) return integrity;
  }
  return null;
}

function inspectDshClientManifest(manifest, { clientEntryAvailable = true } = {}) {
  const declaration = manifest?.dsh?.client;
  if (declaration === undefined) return [];
  const packageName = String(manifest?.name || "候选插件");
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)
    || declaration.platform !== "web"
    || (declaration.inject !== undefined
      && (!Array.isArray(declaration.inject) || declaration.inject.some((name) => typeof name !== "string")))
    || (declaration.immediately !== undefined && typeof declaration.immediately !== "boolean")) {
    return [{
      code: "DSH_PROFILE_CLIENT_MANIFEST_INVALID",
      message: `${packageName} 的 package.json#dsh.client 必须声明 web platform，并使用字符串 inject 列表`,
    }];
  }
  const entry = clientExportOf(manifest);
  if (typeof entry !== "string" || !entry.startsWith("./")) {
    return [{
      code: "DSH_PROFILE_CLIENT_EXPORT_MISSING",
      message: `${packageName} 声明了 dsh.client，但没有有效的 exports["./client"] 浏览器入口`,
    }];
  }
  if (!clientEntryAvailable) {
    return [{
      code: "DSH_PROFILE_CLIENT_BUNDLE_MISSING",
      message: `${packageName} 没有提交 exports["./client"] 指向的浏览器构建产物`,
    }];
  }
  return [];
}

/** Admit only exact independent Client releases into the official Web graph. */
export function inspectCommunityClientIsolation(manifest, { integrity = null } = {}) {
  if (manifest?.dsh?.client === undefined) return [];
  const packageName = String(manifest?.name || "候选插件");
  const policy = reviewedCommunityClientPolicy(packageName);
  if (policy?.integrity !== undefined && !integrity) {
    return [{
      code: "DSH_PROFILE_CLIENT_INTEGRITY_MISSING",
      message: `${packageName}@${manifest.version || "unknown"} 没有在 Profile lockfile 中记录固定完整性，不能进入当前 Client 图`,
    }];
  }
  if (policy?.integrity !== undefined && integrity !== policy.integrity) {
    return [{
      code: "DSH_PROFILE_CLIENT_INTEGRITY_MISMATCH",
      message: `${packageName}@${manifest.version || "unknown"} 的 Profile lockfile 完整性与已审查版本不一致`,
    }];
  }
  if (isReviewedCommunityClient({ name: packageName, manifest, integrity })) {
    if (policy?.requiredDshRuntime && policy.requiredDshRuntime !== CURRENT_DSH_SDK_VERSION) {
      return [{
        code: "DSH_PROFILE_CLIENT_SDK_MISMATCH",
        message: `${packageName}@${manifest.version || "unknown"} 需要 DSH ${policy.requiredDshRuntime}，当前发行版固定为 ${CURRENT_DSH_SDK_VERSION}`,
      }];
    }
    return [];
  }
  return [{
    code: "DSH_PROFILE_CLIENT_ISOLATION_REQUIRED",
    message: `${packageName} 包含 dsh.client 浏览器代码；只有经过精确版本和依赖审查的独立 Client Bundle 才能进入官方 Web 图`,
  }];
}

/** Project a Bundle manifest into the product's four independent compatibility gates. */
export function inspectProfileBundleCompatibility(manifest, { integrity = null } = {}) {
  const dependencies = Object.keys({ ...manifest?.dependencies, ...manifest?.peerDependencies });
  const uses = (fragment) => dependencies.some((name) => name.includes(fragment));
  const reviewedCommunity = reviewedCommunityClientReview({
    name: String(manifest?.name || ""),
    manifest,
    integrity,
  });
  const reviewedPolicy = reviewedCommunityClientPolicy(String(manifest?.name || ""));
  const runtimeMismatch = Boolean(
    reviewedPolicy?.requiredDshRuntime && reviewedPolicy.requiredDshRuntime !== CURRENT_DSH_SDK_VERSION,
  );
  const capabilities = [...new Set([
    uses("dsh-tools") ? "Tool" : null,
    uses("dsh-skill") ? "Skill" : null,
    uses("dsh-mcp") ? "MCP" : null,
    uses("dsh-workflow") ? "Workflow" : null,
    uses("dsh-llm") ? "Model Provider" : null,
    ...(reviewedCommunity?.capabilities || []),
  ].filter(Boolean))];
  const sessionAware = Boolean(reviewedCommunity?.session)
    || ["dsh-session", "dsh-agent", "dsh-subagent", "dsh-goal", "dsh-plan"]
      .some((fragment) => uses(fragment));
  const client = manifest?.dsh?.client?.platform === "web";
  const reviewedClient = client && !runtimeMismatch && isReviewedCommunityClient({
    name: String(manifest?.name || ""),
    manifest,
    integrity,
  });
  return [
    {
      id: "host",
      status: "profile_checked",
      label: "Host 与 Profile",
      message: "在隔离候选 Profile 中组合，安装脚本保持禁用",
    },
    {
      id: "session",
      status: reviewedCommunity?.session ? "reviewed" : sessionAware ? "review_required" : "not_detected",
      label: "Session 生命周期",
      message: reviewedCommunity?.session
        ? reviewedCommunity.session
        : sessionAware
        ? "检测到 Session 或 Agent SDK；还需验证 scope、日志和卸载清理"
        : "清单未检测到 Session 或 Agent SDK 依赖",
    },
    {
      id: "capabilities",
      status: reviewedCommunity?.capabilities?.length
        ? "reviewed"
        : capabilities.length > 0 ? "review_required" : "not_detected",
      label: "Tool、Skill 与 MCP",
      message: reviewedCommunity?.capabilities?.length
        ? `已审查的聚合依赖包含：${reviewedCommunity.capabilities.join("、")}`
        : capabilities.length > 0
        ? `检测到 ${capabilities.join("、")}；还需验证 schema、审批、凭据和运行权限`
        : "清单未检测到 Tool、Skill、MCP、Workflow 或模型 Provider SDK",
    },
    {
      id: "client",
      status: reviewedClient
        ? "reviewed"
        : runtimeMismatch ? "sdk_migration_required" : client ? "isolation_required" : "not_detected",
      label: "Client UI",
      message: reviewedClient
        ? "该精确包版本已完成代码审查，可以进入当前 Client 图"
        : runtimeMismatch
        ? `该精确包版本需要 DSH ${reviewedPolicy.requiredDshRuntime}，当前发行版固定为 ${CURRENT_DSH_SDK_VERSION}`
        : client
        ? "检测到浏览器代码；必须继续检查标准 Slot 和 Renderer 权限"
        : "Host-only Bundle，不需要桌面 Slot",
    },
  ];
}

function patchRowView(row, operation) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const configKeys = row.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? Object.keys(row.config).sort()
    : [];
  const lowered = configKeys.map((key) => key.toLowerCase());
  const risks = [
    lowered.some((key) => /key|token|secret|password|credential/.test(key)) ? "credentials" : null,
    lowered.some((key) => /url|host|port|endpoint|proxy/.test(key)) ? "network" : null,
    lowered.some((key) => /command|args|shell|executable|binary/.test(key)) ? "process" : null,
    lowered.some((key) => /path|root|dir|file|workspace/.test(key)) ? "filesystem" : null,
  ].filter(Boolean);
  return {
    id: typeof row.id === "string" ? row.id : null,
    name: typeof row.name === "string" ? row.name : null,
    operation,
    disabled: row.disabled === true,
    config_keys: configKeys,
    risks,
  };
}

function patchRows(patches) {
  const rows = [];
  for (const patch of Array.isArray(patches) ? patches : []) {
    if (typeof patch?.id === "string") rows.push(patch);
    if (Array.isArray(patch?.insert)) rows.push(...patch.insert);
  }
  return rows.filter((row) => row && typeof row.id === "string");
}

function effectiveBundleEnabled(packageName, bundleRows, composedRows, listed) {
  if (!listed) return false;
  const ids = bundleRows.get(packageName) || [];
  if (ids.length === 0) return true;
  const disabledById = new Map(
    composedRows
      .filter((row) => row && typeof row.id === "string")
      .map((row) => [row.id, row.disabled === true]),
  );
  return ids.some((id) => disabledById.get(id) === false);
}

/** Summarize actual Cordis patch rows without returning configuration values or secrets. */
export function inspectProfileBundlePatches(patches) {
  const rows = [];
  for (const patch of Array.isArray(patches) ? patches : []) {
    const override = patchRowView(patch, "override");
    if (override?.id) rows.push(override);
    if (Array.isArray(patch?.insert)) {
      for (const inserted of patch.insert) {
        const view = patchRowView(inserted, "insert");
        if (view) rows.push(view);
      }
    }
  }
  return {
    row_count: rows.length,
    inserted_count: rows.filter((row) => row.operation === "insert").length,
    overridden_count: rows.filter((row) => row.operation === "override").length,
    risk_categories: [...new Set(rows.flatMap((row) => row.risks))].sort(),
    rows,
  };
}

async function defaultCommandRunner(resolved, args, env) {
  try {
    return await execFileAsync(process.execPath, [...resolved.execArgv, resolved.entryPath, ...args], {
      cwd: resolved.root,
      env: { ...process.env, ...env },
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = String(error?.stdout || "").trim();
    const stderr = String(error?.stderr || "").trim();
    const output = [stdout, stderr]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
    if (/ERR_PNPM_FETCH_404/i.test(stdout) && /@deepseek-ai(?:%2f|\/)/i.test(stdout)) {
      const dependencies = [...new Set([...stdout.matchAll(/@deepseek-ai(?:%2f|\/)([a-z0-9._-]+)/ig)]
        .map((match) => `@deepseek-ai/${match[1]}`))];
      throw profileError(
        "候选插件依赖的 DSH SDK 包或版本无法从当前公开 registry 读取",
        "DSH_PROFILE_SDK_UNAVAILABLE",
        { exit_code: error?.code ?? null, dependencies, command_output: output },
      );
    }
    if (/ignored build scripts|blocked build scripts|approve-builds/i.test(stdout)) {
      throw profileError(
        "候选插件需要在安装时执行仓库构建脚本；DSH Desktop 不会自动授予这项主机代码执行权限",
        "DSH_PROFILE_BUILD_APPROVAL_REQUIRED",
        { exit_code: error?.code ?? null, command_output: output },
      );
    }
    throw profileError(
      output || String(error?.message || error).trim() || "DSH Profile 命令失败",
      "DSH_PROFILE_COMMAND_FAILED",
      { exit_code: error?.code ?? null, command_output: output || null },
    );
  }
}

export function inspectProfileBundleManifest(manifest, {
  builtEntryAvailable = true,
  clientEntryAvailable = true,
} = {}) {
  const issues = [];
  const packageName = String(manifest?.name || "候选插件");
  const patch = manifest?.dsh?.bundle?.patch;
  if (typeof patch !== "string" || !patch.startsWith("./")) {
    issues.push({
      code: "DSH_PROFILE_NOT_A_BUNDLE",
      message: `${packageName} 没有声明有效的 package.json#dsh.bundle.patch`,
    });
  }
  if (manifest?.dshClient !== undefined) {
    issues.push({
      code: "DSH_PROFILE_LEGACY_CLIENT_MANIFEST",
      message: `${packageName} 仍使用旧的 package.json#dshClient，需要迁移到当前 dsh.client 清单`,
    });
  }
  if (!builtEntryAvailable && typeof manifest?.scripts?.prepare === "string") {
    issues.push({
      code: "DSH_PROFILE_BUILD_APPROVAL_REQUIRED",
      message: `${packageName} 没有提交运行入口，Git 安装需要执行 prepare 构建脚本`,
    });
  }
  issues.push(...inspectDshClientManifest(manifest, { clientEntryAvailable }));
  try {
    readDshWorkPortability(manifest);
  } catch (error) {
    issues.push({ code: error?.code || "DSH_PRODUCT_PORTABILITY_INVALID", message: error?.message || String(error) });
  }
  try {
    validateProfileBundleSdk(manifest);
  } catch (error) {
    const legacyCount = Object.entries({ ...manifest?.dependencies, ...manifest?.peerDependencies })
      .filter(([name, version]) => name.startsWith("@deepseek-ai/dsh-")
        && !currentReleaseRange(version, CURRENT_DSH_SDK_VERSION))
      .length;
    issues.push({
      code: error?.code || "DSH_PROFILE_LEGACY_SDK",
      message: legacyCount > 0
        ? `${packageName} 有 ${legacyCount} 个 DSH SDK 包不属于当前 ${CURRENT_DSH_SDK_VERSION} 发布线`
        : error?.message || String(error),
    });
  }
  return issues;
}

async function inspectPinnedExternalGitSource(source) {
  const match = EXACT_EXTERNAL_GIT_SPEC.exec(source);
  if (!match?.groups) return null;
  const root = mkdtempSync(join(tmpdir(), "dsh-work-plugin-inspect-"));
  const checkout = join(root, "repository");
  try {
    await execFileAsync("git", [
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--no-checkout",
      `https://github.com/${match.groups.owner}/${match.groups.repo}.git`,
      checkout,
    ], { maxBuffer: 8 * 1024 * 1024 });
    const { stdout } = await execFileAsync("git", [
      "-C", checkout, "show", `${match.groups.commit}:package.json`,
    ], { maxBuffer: 2 * 1024 * 1024 });
    let manifest;
    try {
      manifest = JSON.parse(stdout);
    } catch (error) {
      throw profileError(`候选插件 package.json 无效：${error?.message || error}`, "DSH_PROFILE_MANIFEST_INVALID");
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw profileError("候选插件 package.json 必须是 JSON 对象", "DSH_PROFILE_MANIFEST_INVALID");
    }
    const entry = typeof manifest.main === "string" && manifest.main.startsWith("./")
      ? manifest.main.slice(2)
      : typeof manifest.main === "string" ? manifest.main : "";
    let builtEntryAvailable = true;
    if (entry && !entry.startsWith("../") && !isAbsolute(entry)) {
      try {
        await execFileAsync("git", ["-C", checkout, "cat-file", "-e", `${match.groups.commit}:${entry}`]);
      } catch {
        builtEntryAvailable = false;
      }
    }
    const clientEntry = clientExportOf(manifest);
    let clientEntryAvailable = true;
    if (typeof clientEntry === "string" && clientEntry.startsWith("./")) {
      try {
        await execFileAsync("git", ["-C", checkout, "cat-file", "-e", `${match.groups.commit}:${clientEntry.slice(2)}`]);
      } catch {
        clientEntryAvailable = false;
      }
    }
    return { manifest, builtEntryAvailable, clientEntryAvailable };
  } catch (error) {
    if (error?.code?.startsWith?.("DSH_")) throw error;
    throw profileError(
      `无法读取固定的 GitHub 插件来源：${error?.stderr || error?.message || error}`,
      "DSH_PROFILE_SOURCE_UNAVAILABLE",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function preflightStatus(error) {
  if (error?.code === "DSH_PROFILE_BUILD_APPROVAL_REQUIRED") return "build_approval_required";
  if (error?.code === "DSH_PROFILE_SDK_UNAVAILABLE") return "sdk_unavailable";
  if ([
    "DSH_PROFILE_NOT_A_BUNDLE",
    "DSH_PROFILE_LEGACY_CLIENT_MANIFEST",
    "DSH_PROFILE_CLIENT_MANIFEST_INVALID",
    "DSH_PROFILE_CLIENT_EXPORT_MISSING",
    "DSH_PROFILE_CLIENT_BUNDLE_MISSING",
    "DSH_PROFILE_CLIENT_SDK_MISMATCH",
    "DSH_PROFILE_CLIENT_INTEGRITY_MISSING",
    "DSH_PROFILE_CLIENT_INTEGRITY_MISMATCH",
    "DSH_PROFILE_LEGACY_SDK",
    "DSH_PRODUCT_DESCRIPTOR_INVALID",
    "DSH_PRODUCT_HOST_COMPONENT_FORBIDDEN",
    "DSH_PRODUCT_PORTABILITY_INVALID",
    "DSH_PROFILE_CANDIDATE_INVALID",
  ].includes(error?.code)) return "migration_required";
  if (["DSH_PROFILE_SOURCE_REQUIRED", "DSH_PROFILE_SOURCE_NOT_PINNED"].includes(error?.code)) return "invalid_source";
  if (error?.code === "PLUGIN_ALREADY_INSTALLED") return "already_installed";
  return "unavailable";
}

function preflightFailure(source, error) {
  const issues = Array.isArray(error?.details?.issues) && error.details.issues.length > 0
    ? error.details.issues
    : [{ code: error?.code || "DSH_PROFILE_PREFLIGHT_FAILED", message: error?.message || String(error) }];
  return {
    source,
    status: preflightStatus(error),
    installable: false,
    package_name: error?.details?.package_name || null,
    version: error?.details?.version || null,
    ...(Array.isArray(error?.details?.compatibility_checks)
      ? { compatibility_checks: error.details.compatibility_checks }
      : {}),
    ...(error?.details?.patch_summary ? { patch_summary: error.details.patch_summary } : {}),
    blockers: issues,
  };
}

export class DshProfilePluginService {
  constructor({
    env = process.env,
    commandRunner = defaultCommandRunner,
    restartRuntime = async () => {
      const { restartDshRuntimeClient } = await import("./client.js");
      return restartDshRuntimeClient();
    },
  } = {}) {
    this.env = env;
    this.commandRunner = commandRunner;
    this.restartRuntime = restartRuntime;
    this.mutationQueue = Promise.resolve();
  }

  mutate(task) {
    const running = this.mutationQueue.catch(() => {}).then(task);
    this.mutationQueue = running;
    return running.finally(() => {
      if (this.mutationQueue === running) this.mutationQueue = Promise.resolve();
    });
  }

  distribution() {
    const resolved = resolveDshRuntimeDistribution({ env: this.env });
    if (!resolved) throw profileError("DSH 运行时未启用，无法管理 Profile Bundle", "DSH_RUNTIME_DISABLED");
    return resolved;
  }

  home() {
    return resolve(this.env.DSH_RUNTIME_HOME || this.env.DSH_HOME || dataRoot());
  }

  async profileApi(resolved) {
    return import(pathToFileURL(resolved.appBootPath).href);
  }

  async runtimeContext() {
    const resolved = this.distribution();
    const dshHome = this.home();
    const api = await this.profileApi(resolved);
    return { resolved, dshHome, api, profileDir: existingDshProfilePath(api, dshHome) };
  }

  async state() {
    const context = await this.runtimeContext();
    const { resolved, dshHome, api, profileDir } = context;
    const manifestPath = join(profileDir, "package.json");
    if (!existsSync(manifestPath)) {
      throw profileError(
        `DSH Web Profile 尚未初始化：${profileDir}`,
        "DSH_PROFILE_NOT_INITIALIZED",
      );
    }
    const manifest = api.readProfileManifest("dsh-work", profileDir);
    const dependencies = manifest.dependencies || {};
    const bundles = readProfileBundles(manifest);
    const disabledBundleNames = Object.keys(dependencies).filter((packageName) => !bundles.includes(packageName));
    const projectedBundleNames = [...bundles, ...disabledBundleNames];
    const bundleRows = new Map();
    const bundlePatchLayers = [];
    const activePlugins = projectedBundleNames.map((packageName, index) => {
      const packageDir = realpathSync(api.resolveBundleDir(
        "dsh-work",
        packageName,
        resolved.installAnchor,
        profileDir,
      ));
      const packageManifest = readJson(join(packageDir, "package.json"));
      const featured = featuredPluginByName(packageName);
      const managed = SYSTEM_BUNDLES.has(packageName)
        ? "system"
        : FEATURED_PLUGIN_NAMES.has(packageName) ? "app" : "user";
      const patchPath = packageManifest?.dsh?.bundle?.patch;
      if (typeof patchPath === "string" && patchPath.startsWith("./")) {
        const patches = api.loadOverlayPatches("dsh", resolve(packageDir, patchPath));
        bundlePatchLayers.push(patches);
        bundleRows.set(packageName, patchRows(patches).map((row) => row.id));
      }
      const descriptor = readProductDescriptor(packageDir, packageManifest, {
        allowHostComponents: managed === "app",
      });
      const enabled = bundles.includes(packageName);
      if (!enabled && packageManifest?.dsh?.bundle?.patch === undefined) return null;
      return bundleView({
        packageName,
        packageDir,
        manifest: packageManifest,
        dependencySpec: dependencies[packageName],
        index,
        descriptor,
        managed,
        featured,
        userManageable: featured?.user_manageable === true,
        enabled,
      });
    }).filter(Boolean);
    const profilePatch = api.loadOptionalPatches("dsh", join(profileDir, "cordis.patch.yml")) || [];
    const homePatch = api.loadOptionalPatches("dsh", join(dshHome, "cordis.patch.yml")) || [];
    const composedRows = api.composeEntries([...bundlePatchLayers, profilePatch, homePatch]);
    for (const plugin of activePlugins) {
      const listed = bundles.includes(plugin.id);
      plugin.enabled = effectiveBundleEnabled(plugin.id, bundleRows, composedRows, listed);
      plugin.ui_runtime.client_graph = plugin.enabled && plugin.ui_runtime.kind === "dsh_client";
    }
    return {
      resolved,
      api,
      dshHome,
      profileDir,
      manifest,
      plugins: activePlugins,
    };
  }

  /** Validate the current Profile and final DSH graph without changing user state. */
  async preflightCurrentProfile({ targetVersion = null } = {}) {
    const state = await this.state();
    await this.run(state.resolved, state.dshHome, ["--profile", PROFILE_NAME, "--dump-config"]);
    return {
      ok: true,
      profile: PROFILE_NAME,
      target_version: typeof targetVersion === "string" && targetVersion.trim() ? targetVersion.trim() : null,
      bundles: state.plugins.map((plugin) => ({
        id: plugin.id,
        version: plugin.version,
        managed_by: plugin.managed_by,
        enabled: plugin.enabled,
        ui_runtime: plugin.ui_runtime?.kind || null,
      })),
    };
  }

  async catalog() {
    const state = await this.state();
    return {
      plugins: state.plugins,
      apps: [],
      mcp_servers: [],
      skills: [],
      marketplaces: [{
        id: `profile:${PROFILE_NAME}`,
        name: PROFILE_NAME,
        display_name: "DSH Web Profile",
        plugin_count: state.plugins.length,
        path: state.profileDir,
        source: "profile",
        readonly: true,
        can_upgrade: false,
        can_remove: false,
      }],
      featured_plugin_ids: featuredPluginNames(),
      recommended_plugins: COMMUNITY_PLUGIN_REGISTRY.plugins,
      recommended_plugins_updated_at: COMMUNITY_PLUGIN_REGISTRY.updated_at,
      recommended_plugins_source: COMMUNITY_PLUGIN_REGISTRY.catalog_source,
      catalog_warnings: [],
      catalog_errors: [],
      connection_errors: [],
    };
  }

  async read(packageName) {
    const state = await this.state();
    const plugin = state.plugins.find((item) => item.id === packageName);
    if (!plugin) throw profileError(`Profile Bundle 不存在：${packageName}`, "PLUGIN_NOT_FOUND");
    return {
      plugin,
      skills: [],
      apps: [],
      app_templates: [],
      mcp_servers: [],
      hooks: [],
      scheduled_tasks: [],
      connection_errors: [],
    };
  }

  async run(resolved, dshHome, args) {
    const libraryRoot = dshProfilePluginLibraryPath(dshHome, this.env);
    return this.commandRunner(resolved, args, controlledDshPluginEnvironment({
      ...this.env,
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: this.env.DSH_TELEMETRY_DISABLED || "1",
    }, { dshHome, libraryRoot }));
  }

  /** Verify the authoritative Profile and final DSH graph after an explicit mutation. */
  async verifyMutation({ resolved, dshHome, packageName, installed }) {
    const state = await this.state();
    const present = state.plugins.some((plugin) => plugin.id === packageName);
    if (present !== installed) {
      throw profileError(
        installed
          ? `官方安装命令完成后 Profile 中没有 ${packageName}`
          : `官方卸载命令完成后 Profile 仍包含 ${packageName}`,
        "DSH_PROFILE_MUTATION_VERIFY_FAILED",
      );
    }
    await this.run(resolved, dshHome, ["--profile", PROFILE_NAME, "--dump-config"]);
    return state;
  }

  async validateCandidate(source, context) {
    if (source.startsWith("file:")) {
      const sourceDir = realpathSync(source.slice(5));
      const sourceManifest = readJson(join(sourceDir, "package.json"));
      const sourceIssues = [
        ...inspectProfileBundleManifest(sourceManifest),
        ...inspectCommunityClientIsolation(sourceManifest),
      ];
      if (sourceIssues.length > 0) {
        throw profileError(sourceIssues[0].message, sourceIssues[0].code, {
          package_name: sourceManifest.name || null,
          version: sourceManifest.version || null,
          compatibility_checks: inspectProfileBundleCompatibility(sourceManifest),
          issues: sourceIssues,
        });
      }
    }
    const candidateName = `dsh-work-candidate-${randomUUID()}`;
    const candidateDir = context.api.resolveProfileDir(candidateName, context.dshHome);
    context.api.initProfile(candidateDir, context.api.PROFILE_TEMPLATES?.web || context.api.DEFAULT_PROFILE_BUNDLES);
    try {
      await this.run(context.resolved, context.dshHome, [
        "plugin", "--profile", candidateName, "add", "-w", source, "--save-exact", "--ignore-scripts",
      ]);
      const manifest = context.api.readProfileManifest("dsh-work", candidateDir);
      const dependencyNames = Object.keys(manifest.dependencies || {});
      if (dependencyNames.length !== 1) {
        throw profileError("候选 Profile 没有得到一个明确的 Bundle 包", "DSH_PROFILE_CANDIDATE_INVALID");
      }
      const packageName = dependencyNames[0];
      const packageDir = realpathSync(context.api.resolveBundleDir(
        "dsh-work",
        packageName,
        context.resolved.installAnchor,
        candidateDir,
      ));
      const packageManifest = readJson(join(packageDir, "package.json"));
      if (packageManifest.name !== packageName) {
        throw profileError("候选 Bundle 包名与 Profile 依赖不一致", "DSH_PROFILE_CANDIDATE_INVALID");
      }
      const packageIntegrity = readProfilePackageIntegrity(candidateDir, packageName, packageManifest.version);
      const issues = [
        ...inspectProfileBundleManifest(packageManifest),
        ...inspectCommunityClientIsolation(packageManifest, { integrity: packageIntegrity }),
      ];
      const compatibilityChecks = inspectProfileBundleCompatibility(packageManifest, {
        integrity: packageIntegrity,
      });
      const patch = packageManifest?.dsh?.bundle?.patch;
      let patchSummary = inspectProfileBundlePatches([]);
      if (typeof patch === "string" && patch.startsWith("./")) {
        try {
          const patchPath = realpathSync(resolve(packageDir, patch));
          if (!inside(packageDir, patchPath)) {
            issues.push({ code: "DSH_PROFILE_NOT_A_BUNDLE", message: `${packageName} 的 Bundle patch 越过了包目录` });
          } else {
            patchSummary = inspectProfileBundlePatches(context.api.loadOverlayPatches("dsh-work", patchPath));
          }
        } catch (error) {
          issues.push({
            code: "DSH_PROFILE_NOT_A_BUNDLE",
            message: `${packageName} 的 Bundle patch 不存在或无法读取：${error?.message || error}`,
          });
        }
      }
      const clientEntry = clientExportOf(packageManifest);
      if (typeof clientEntry === "string" && clientEntry.startsWith("./")) {
        try {
          const clientPath = realpathSync(resolve(packageDir, clientEntry));
          if (!inside(packageDir, clientPath)) {
            issues.push({
              code: "DSH_PROFILE_CLIENT_BUNDLE_MISSING",
              message: `${packageName} 的 exports["./client"] 越过了包目录`,
            });
          }
        } catch (error) {
          issues.push({
            code: "DSH_PROFILE_CLIENT_BUNDLE_MISSING",
            message: `${packageName} 的浏览器构建产物不存在或无法读取：${error?.message || error}`,
          });
        }
      }
      let descriptor = null;
      try {
        descriptor = readProductDescriptor(packageDir, packageManifest);
      } catch (error) {
        issues.push({ code: error?.code || "DSH_PRODUCT_DESCRIPTOR_INVALID", message: error?.message || String(error) });
      }
      if (issues.length > 0) {
        throw profileError(issues[0].message, issues[0].code, {
          package_name: packageName,
          version: packageManifest.version || null,
          compatibility_checks: compatibilityChecks,
          patch_summary: patchSummary,
          issues,
        });
      }
      await this.run(context.resolved, context.dshHome, ["--profile", candidateName, "--dump-config"]);
      return {
        packageName,
        version: packageManifest.version || null,
        surface: packageManifest.dsh?.client ? "dsh_web" : "host",
        compatibilityChecks,
        patchSummary,
      };
    } finally {
      const profilesRoot = context.api.resolveProfileDir(PROFILE_NAME, context.dshHome);
      const root = dirname(profilesRoot);
      if (inside(root, candidateDir) && candidateDir !== root) rmSync(candidateDir, { recursive: true, force: true });
    }
  }

  async install(value) {
    return this.mutate(() => this.installUnlocked(value));
  }

  async preflight(value) {
    return this.mutate(() => this.preflightUnlocked(value));
  }

  async preflightUnlocked(value) {
    let source;
    try {
      source = normalizeProfileBundleSource(value, {
        allowLocal: this.env.DSH_PROFILE_ALLOW_LOCAL_PLUGINS === "1",
      });
    } catch (error) {
      return preflightFailure(String(value || "").trim(), error);
    }
    try {
      const inspected = await inspectPinnedExternalGitSource(source);
      if (inspected) {
        const issues = inspectProfileBundleManifest(inspected.manifest, {
          builtEntryAvailable: inspected.builtEntryAvailable,
          clientEntryAvailable: inspected.clientEntryAvailable,
        });
        if (issues.length > 0) {
          return preflightFailure(source, profileError(issues[0].message, issues[0].code, {
          package_name: inspected.manifest.name || null,
          version: inspected.manifest.version || null,
          compatibility_checks: inspectProfileBundleCompatibility(inspected.manifest),
          issues,
          }));
        }
      }
      const context = await this.runtimeContext();
      let state = null;
      try {
        state = await this.state();
      } catch (error) {
        if (error?.code !== "DSH_PROFILE_NOT_INITIALIZED") throw error;
      }
      const candidate = await this.validateCandidate(source, context);
      if (state?.plugins.some((plugin) => plugin.id === candidate.packageName)) {
        return preflightFailure(source, profileError(
          `Profile Bundle 已安装：${candidate.packageName}`,
          "PLUGIN_ALREADY_INSTALLED",
          { package_name: candidate.packageName, version: candidate.version },
        ));
      }
      return {
        source,
        status: "ready",
        installable: true,
        package_name: candidate.packageName,
        version: candidate.version,
        surface: candidate.surface,
        compatibility_checks: candidate.compatibilityChecks,
        patch_summary: candidate.patchSummary,
        blockers: [],
      };
    } catch (error) {
      return preflightFailure(source, error);
    }
  }

  async installUnlocked(value) {
    const source = normalizeProfileBundleSource(value, {
      allowLocal: this.env.DSH_PROFILE_ALLOW_LOCAL_PLUGINS === "1",
    });
    const context = await this.runtimeContext();
    let state = null;
    try {
      state = await this.state();
    } catch (error) {
      if (error?.code !== "DSH_PROFILE_NOT_INITIALIZED") throw error;
    }
    const candidate = await this.validateCandidate(source, context);
    if (state?.plugins.some((plugin) => plugin.id === candidate.packageName)) {
      throw profileError(`Profile Bundle 已安装：${candidate.packageName}`, "PLUGIN_ALREADY_INSTALLED");
    }
    await this.run(context.resolved, context.dshHome, [
      "plugin", "--profile", PROFILE_NAME, "add", "-w", source, "--save-exact", "--ignore-scripts",
    ]);
    await this.restartRuntime();
    await this.verifyMutation({
      resolved: context.resolved,
      dshHome: context.dshHome,
      packageName: candidate.packageName,
      installed: true,
    });
    return {
      id: candidate.packageName,
      pluginId: candidate.packageName,
      name: candidate.packageName,
      version: candidate.version,
      surface: candidate.surface,
    };
  }

  async uninstall(packageName) {
    return this.mutate(() => this.uninstallUnlocked(packageName));
  }

  async uninstallUnlocked(packageName) {
    const state = await this.state();
    const plugin = state.plugins.find((item) => item.id === packageName);
    if (!plugin) throw profileError(`Profile Bundle 不存在：${packageName}`, "PLUGIN_NOT_FOUND");
    const featured = featuredPluginByName(packageName);
    const userManageable = plugin.managed_by === "user"
      || (plugin.managed_by === "app" && featured?.user_manageable === true);
    if (!userManageable || !Object.hasOwn(state.manifest.dependencies || {}, packageName)) {
      throw profileError(`由 ${plugin.managed_by === "app" ? "DSH Desktop" : "DSH"} 提供的 Bundle 不能卸载`, "PLUGIN_UNINSTALL_NOT_ALLOWED");
    }
    await this.run(state.resolved, state.dshHome, ["plugin", "--profile", PROFILE_NAME, "remove", packageName]);
    await this.restartRuntime();
    await this.verifyMutation({
      resolved: state.resolved,
      dshHome: state.dshHome,
      packageName,
      installed: false,
    });
    return {
      id: packageName,
      name: plugin.display_name,
      surface: plugin.ui_runtime?.kind === "dsh_client" ? "dsh_web" : "host",
    };
  }
}

let defaultService = null;

export function getDshProfilePluginService() {
  defaultService ||= new DshProfilePluginService();
  return defaultService;
}

export function resetDshProfilePluginServiceForTests() {
  defaultService = null;
}
