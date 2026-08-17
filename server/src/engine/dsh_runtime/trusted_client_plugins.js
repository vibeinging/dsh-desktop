import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const TRUSTED_DSH_PLUGINS = Object.freeze([{
  name: "@deepseek-ai/dsh-work-product-host-ipc",
  envPath: "DSH_WORK_PRODUCT_HOST_IPC_ROOT",
  appPackage: "packages/dsh-work-product-host-ipc",
  browser: false,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-project-tools",
  envPath: "DSH_PROJECT_TOOLS_ROOT",
  appPackage: "packages/dsh-project-tools",
  browser: false,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-canvas-tools",
  envPath: "DSH_CANVAS_TOOLS_ROOT",
  appPackage: "packages/dsh-canvas-tools",
  browser: false,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-structured-ui-tools",
  envPath: "DSH_STRUCTURED_UI_TOOLS_ROOT",
  appPackage: "packages/dsh-structured-ui-tools",
  browser: false,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-model-inheritance",
  envPath: "DSH_MODEL_INHERITANCE_ROOT",
  appPackage: "packages/dsh-model-inheritance",
  browser: false,
  portability: "portable",
}, {
  name: "@deepseek-ai/dsh-product-bridge",
  envPath: "DSH_PRODUCT_BRIDGE_ROOT",
  appPackage: "packages/dsh-product-bridge",
  browser: false,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-office-tools",
  envPath: "DSH_OFFICE_TOOLS_ROOT",
  appPackage: "packages/dsh-office-tools",
  browser: false,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-workbench-pages",
  envPath: "DSH_WORKBENCH_PAGES_ROOT",
  appPackage: "packages/dsh-workbench-pages",
  browser: false,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-theme-pack",
  envPath: "DSH_THEME_PACK_ROOT",
  appPackage: "packages/dsh-theme-pack",
  browser: true,
  portability: "portable",
}, {
  name: "@deepseek-ai/dsh-client-product-commands",
  envPath: "DSH_CLIENT_PRODUCT_COMMANDS_ROOT",
  appPackage: "packages/dsh-client-product-commands",
  browser: true,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-client-product-references",
  envPath: "DSH_CLIENT_PRODUCT_REFERENCES_ROOT",
  appPackage: "packages/dsh-client-product-references",
  browser: true,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-client-product-search-mode",
  envPath: "DSH_CLIENT_PRODUCT_SEARCH_MODE_ROOT",
  appPackage: "packages/dsh-client-product-search-mode",
  browser: true,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-client-product-workspaces",
  envPath: "DSH_CLIENT_PRODUCT_WORKSPACES_ROOT",
  appPackage: "packages/dsh-client-product-workspaces",
  browser: true,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-client-product-attachments",
  envPath: "DSH_CLIENT_PRODUCT_ATTACHMENTS_ROOT",
  appPackage: "packages/dsh-client-product-attachments",
  browser: true,
  portability: "desktop-adapter",
}, {
  name: "@deepseek-ai/dsh-work-shell",
  envPath: "DSH_WORK_SHELL_ROOT",
  appPackage: "packages/dsh-work-shell",
  browser: true,
  portability: "desktop-shell",
}]);

const RETIRED_DSH_PLUGINS = Object.freeze([
  "@deepseek-ai/dsh-product-client",
  "@deepseek-ai/dsh-turn-navigator",
]);

// Reviewed community Client Plugins may run in the product renderer only at
// the exact audited version. Every other user-installed Client stays outside
// the active graph until the separate no-preload renderer is available.
const DSH_WEB_UI_DEPENDENCIES = Object.freeze({
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
});

const REVIEWED_COMMUNITY_CLIENTS = Object.freeze(new Map([
  ["dshmarket", Object.freeze({ version: "1.9.0" })],
  ["@linxin666/dsh-web-ui-all", Object.freeze({
    version: "0.1.20",
    bundlePatch: "./cordis.patch.yml",
    dependencies: DSH_WEB_UI_DEPENDENCIES,
    review: Object.freeze({
      session: "任务看板会读取 Session 与 Workspace，并可从看板启动 Agent 任务",
      capabilities: Object.freeze([
        "读取本地仓库与图片",
        "启动 Git、SSH 与电源保持进程",
        "访问 SSH、远程 Web 和模型服务网络",
      ]),
    }),
  })],
]));

const WEB_PROFILE = "web";

/** Return the bundle names that dsh-work owns inside the Web Profile. */
export function trustedDshProfilePluginNames() {
  return [
    ...TRUSTED_DSH_PLUGINS.map((plugin) => plugin.name),
    ...RETIRED_DSH_PLUGINS,
  ];
}

function inside(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function defaultExport(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.default === "string" ? value.default : null;
}

function resolvePackageFile(root, declared, label) {
  if (typeof declared !== "string" || !declared.startsWith("./")) {
    throw new Error(`${label} 必须是包内相对路径`);
  }
  const path = realpathSync(resolve(root, declared));
  if (!inside(root, path)) throw new Error(`${label} 不能越过插件目录`);
  return path;
}

function readTrustedPlugin(candidate, { name: expectedName, browser, portability }) {
  const root = realpathSync(candidate);
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest?.name !== expectedName) {
    throw new Error(`受信任 DSH client plugin 包名不匹配：期望 ${expectedName}`);
  }
  if (browser && manifest?.dsh?.client?.platform !== "web") {
    throw new Error(`${expectedName} 没有声明 Web dsh.client`);
  }
  if (manifest?.dshWork?.portability?.level !== portability) {
    throw new Error(`${expectedName} 必须声明 dshWork.portability.level=${portability}`);
  }
  const patch = resolvePackageFile(root, manifest?.dsh?.bundle?.patch, `${expectedName} dsh.bundle.patch`);
  const entry = resolvePackageFile(root, manifest?.main, `${expectedName} main`);
  const client = browser
    ? resolvePackageFile(root, defaultExport(manifest?.exports?.["./client"]), `${expectedName} exports[\"./client\"]`)
    : null;
  return { name: expectedName, root, patch, entry, client, portability };
}

function ensureLink(link, target) {
  mkdirSync(dirname(link), { recursive: true });
  if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) {
    const stat = lstatSync(link);
    if (!stat.isSymbolicLink()) {
      throw new Error(`DSH client plugin 解析位已被普通文件占用：${link}`);
    }
    const current = resolve(dirname(link), readlinkSync(link));
    if (current === target) return;
    rmSync(link);
  }
  symlinkSync(target, link, "junction");
}

function removeRetiredLinks(dshHome) {
  for (const name of RETIRED_DSH_PLUGINS) {
    const link = join(resolve(dshHome), "profiles", "node_modules", ...name.split("/"));
    const stat = lstatSync(link, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isSymbolicLink()) {
      throw new Error(`退役 DSH plugin 解析位被普通文件占用：${link}`);
    }
    rmSync(link);
  }
}

function candidatePath(spec, { appRoot, env, runtimeRoot }) {
  const configured = String(env[spec.envPath] || "").trim();
  if (configured) return { path: resolve(configured), required: true };
  if (spec.appPackage) return { path: resolve(appRoot, spec.appPackage), required: false };
  if (env.DSH_RUNTIME_DISTRIBUTION !== "source") return null;
  return { path: resolve(runtimeRoot, "..", spec.sourceSibling), required: false };
}

/**
 * Validate and expose app-reviewed DSH plugins to one profile boot.
 * Only the fixed allowlist can enter the profile module resolver. An explicit
 * path fails loud; a missing source sibling means that optional local plugin
 * is not mounted.
 */
export function prepareTrustedClientPlugins({
  appRoot = APP_ROOT,
  env = process.env,
  runtimeRoot = process.cwd(),
  dshHome = env.DSH_HOME,
} = {}) {
  if (!dshHome) throw new Error("缺少 DSH_HOME，无法准备受信任 client plugin");
  removeRetiredLinks(dshHome);
  const prepared = [];
  for (const spec of TRUSTED_DSH_PLUGINS) {
    const candidate = candidatePath(spec, { appRoot, env, runtimeRoot });
    if (!candidate) continue;
    if (!existsSync(candidate.path)) {
      if (candidate.required) throw new Error(`受信任 DSH client plugin 不存在：${candidate.path}`);
      continue;
    }
    const plugin = readTrustedPlugin(candidate.path, spec);
    const link = join(resolve(dshHome), "profiles", "node_modules", ...plugin.name.split("/"));
    ensureLink(link, plugin.root);
    prepared.push(plugin);
  }
  return prepared;
}

function readProfileBundles(manifest, profileDir) {
  if (manifest?.dsh?.bundle) {
    throw new Error(`DSH Profile manifest 不能同时声明 dsh.bundle：${profileDir}`);
  }
  const bundles = manifest?.dsh?.profile?.bundles;
  if (bundles === undefined) return [];
  if (!Array.isArray(bundles) || bundles.some((name) => typeof name !== "string" || !name.trim())) {
    throw new Error(`DSH Profile bundles 必须是非空包名数组：${profileDir}`);
  }
  return bundles;
}

function sameBundles(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function readInstalledPlugin(api, packageName, installAnchor, profileDir) {
  const root = realpathSync(api.resolveBundleDir(
    "dsh-work",
    packageName,
    installAnchor,
    profileDir,
  ));
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return Object.freeze({ name: packageName, root, manifest });
}

function readReviewedDependency(plugin, name, version) {
  const packageRequire = createRequire(join(plugin.root, "package.json"));
  const manifestPath = realpathSync(packageRequire.resolve(`${name}/package.json`));
  const root = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest?.name !== name || manifest?.version !== version) {
    throw new Error(`已审查社区 Bundle 依赖不匹配：期望 ${name}@${version}`);
  }
  return root;
}

function removeResolverLink(link) {
  const stat = lstatSync(link, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) rmSync(link);
}

function prepareReviewedCommunityResolverLinks(profileDir, reviewed, directDependencies) {
  const active = new Map();
  for (const plugin of reviewed) {
    const policy = REVIEWED_COMMUNITY_CLIENTS.get(plugin.name);
    for (const [name, version] of Object.entries(policy?.dependencies || {})) {
      const previous = active.get(name);
      if (previous && previous.version !== version) {
        throw new Error(`已审查社区 Bundle 的 Profile 依赖版本冲突：${name}`);
      }
      active.set(name, { plugin, version });
    }
  }
  const managedNames = new Set([...REVIEWED_COMMUNITY_CLIENTS.values()]
    .flatMap((policy) => Object.keys(policy.dependencies || {})));
  for (const name of managedNames) {
    const link = join(profileDir, "node_modules", ...name.split("/"));
    const dependency = active.get(name);
    if (dependency) {
      ensureLink(link, readReviewedDependency(dependency.plugin, name, dependency.version));
    } else if (directDependencies[name] === undefined) {
      removeResolverLink(link);
    }
  }
}

function sameDependencyManifest(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return actualEntries.length === expectedEntries.length
    && actualEntries.every(([name, version], index) => (
      name === expectedEntries[index][0] && version === expectedEntries[index][1]
    ));
}

/** Return whether one installed community Client matches the audited release and dependency graph. */
export function isReviewedCommunityClient(plugin) {
  const policy = REVIEWED_COMMUNITY_CLIENTS.get(plugin?.name);
  if (!policy || policy.version !== plugin?.manifest?.version) return false;
  if (policy.bundlePatch !== undefined && plugin?.manifest?.dsh?.bundle?.patch !== policy.bundlePatch) return false;
  if (policy.dependencies !== undefined
    && !sameDependencyManifest(plugin?.manifest?.dependencies, policy.dependencies)) return false;
  return true;
}

/** Return the audited capability projection for one exact reviewed Client release. */
export function reviewedCommunityClientReview(plugin) {
  if (!isReviewedCommunityClient(plugin)) return null;
  return REVIEWED_COMMUNITY_CLIENTS.get(plugin?.name)?.review || null;
}

async function loadProfileApi(appBootPath, profileApi) {
  if (profileApi) return profileApi;
  if (!appBootPath) throw new Error("缺少 DSH app-boot 入口，无法更新 Profile");
  return import(pathToFileURL(appBootPath).href);
}

/**
 * Mount the app-reviewed DSH bundles through the official Profile manifest.
 * The flat resolver links expose package roots; `dsh.profile.bundles` owns
 * composition order. App bundles establish the product frame before reviewed
 * user extensions run. Missing optional packages are removed from the fixed
 * allowlist slice. User-installed browser bundles remain installed but are
 * removed from the active graph until the desktop renderer isolates them.
 */
export async function prepareTrustedProfilePlugins({
  appBootPath,
  installAnchor,
  profileApi,
  profileName = WEB_PROFILE,
  appRoot = APP_ROOT,
  env = process.env,
  runtimeRoot = process.cwd(),
  dshHome = env.DSH_HOME,
} = {}) {
  if (!dshHome) throw new Error("缺少 DSH_HOME，无法准备受信任 Profile plugin");
  const api = await loadProfileApi(appBootPath, profileApi);
  const template = api.PROFILE_TEMPLATES?.[profileName] ?? api.DEFAULT_PROFILE_BUNDLES;
  if (!Array.isArray(template)) throw new Error(`DSH 没有可用的 Profile 模板：${profileName}`);
  const profileDir = api.resolveProfileDir(profileName, resolve(dshHome));
  api.initProfile(profileDir, template);

  const plugins = prepareTrustedClientPlugins({ appRoot, env, runtimeRoot, dshHome });
  const manifest = api.readProfileManifest("dsh-work", profileDir);
  const currentBundles = readProfileBundles(manifest, profileDir);
  const currentDependencies = manifest.dependencies || {};
  const dependencies = Object.fromEntries(Object.entries(currentDependencies)
    .filter(([name]) => !RETIRED_DSH_PLUGINS.includes(name)));
  const managedNames = new Set([
    ...TRUSTED_DSH_PLUGINS.map((plugin) => plugin.name),
    ...RETIRED_DSH_PLUGINS,
  ]);
  const reviewedNames = new Set([...template, ...managedNames]);
  const inspectionAnchor = installAnchor || env.DSH_RUNTIME_INSTALL_ANCHOR || appBootPath;
  if (!inspectionAnchor || typeof api.resolveBundleDir !== "function") {
    throw new Error("DSH Profile API 无法检查社区 Client Bundle 隔离");
  }
  const userNames = [...new Set([
    ...currentBundles,
    ...Object.keys(dependencies),
  ])].filter((name) => !reviewedNames.has(name));
  const userPlugins = userNames
    .map((name) => readInstalledPlugin(api, name, inspectionAnchor, profileDir));
  const quarantined = userPlugins
    .filter((plugin) => plugin.manifest?.dsh?.client !== undefined)
    .filter((plugin) => !isReviewedCommunityClient(plugin));
  const reviewed = userPlugins
    .filter((plugin) => plugin.manifest?.dsh?.client !== undefined)
    .filter(isReviewedCommunityClient);
  prepareReviewedCommunityResolverLinks(profileDir, reviewed, dependencies);
  const quarantinedNames = new Set(quarantined.map((plugin) => plugin.name));
  const templateNames = new Set(template);
  const userBundles = currentBundles.filter((name) => (
    !templateNames.has(name) && !managedNames.has(name) && !quarantinedNames.has(name)
  ));
  const bundles = [
    ...template,
    ...plugins.map((plugin) => plugin.name),
    ...userBundles,
  ];
  const changed = !sameBundles(currentBundles, bundles)
    || Object.keys(dependencies).length !== Object.keys(currentDependencies).length;
  if (changed) {
    api.writeProfileManifest(profileDir, {
      ...manifest,
      dependencies,
      dsh: {
        ...manifest.dsh,
        profile: {
          ...manifest.dsh?.profile,
          bundles,
        },
      },
    });
  }
  return Object.freeze({ profileName, profileDir, plugins, bundles, reviewed, quarantined, changed });
}
