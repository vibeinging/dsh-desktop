import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import {
  FEATURED_PLUGIN_APP_ROOT,
  featuredPluginManifest,
  featuredPlugins,
  featuredPluginTarballName,
  resolveFeaturedPackageDir,
} from "../server/src/engine/dsh_runtime/featured_plugins.js"

const execFileAsync = promisify(execFile)
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_OUTPUT_DIR = join(SCRIPT_ROOT, ".desktop-build", "featured-plugins")

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function npmCommand() {
  const npmExecPath = String(process.env.npm_execpath || "").trim()
  return npmExecPath
    ? { file: process.execPath, prefix: [npmExecPath] }
    : { file: "npm", prefix: [] }
}

/** Validate the package contract that backs one curated release input. */
export function validateFeaturedPackageContract(plugin, manifest) {
  if (manifest.name !== plugin.name || typeof manifest.version !== "string") {
    throw new Error(`精选插件清单与包 manifest 不一致: ${plugin.name}`)
  }
  if (String(manifest.main || "").replace(/^\.\//, "") !== plugin.evidence.entry) {
    throw new Error(`精选插件清单与包入口不一致: ${plugin.name}`)
  }
  if (manifest.dsh?.bundle?.patch !== "./cordis.patch.yml") {
    throw new Error(`精选插件必须通过 cordis.patch.yml 挂载: ${plugin.name}`)
  }
  if (plugin.evidence.source_kind === "locked-registry-package") {
    if (plugin.evidence.release_files !== undefined
      && (!Array.isArray(plugin.evidence.release_files)
        || plugin.evidence.release_files.length === 0
        || plugin.evidence.release_files.some((path) => typeof path !== "string"
          || !path.trim()
          || isAbsolute(path)
          || path.split(/[\\/]/).includes("..")))) {
      throw new Error(`精选 registry 插件 release_files 无效: ${plugin.name}`)
    }
    const transform = plugin.evidence.release_transform
    if (transform !== undefined
      && (!transform || typeof transform !== "object" || Array.isArray(transform)
        || ["id", "path", "source_sha256", "output_sha256"]
          .some((field) => typeof transform[field] !== "string" || !transform[field].trim())
        || isAbsolute(transform.path)
        || transform.path.split(/[\\/]/).includes(".."))) {
      throw new Error(`精选 registry 插件 release_transform 无效: ${plugin.name}`)
    }
    if (manifest.license !== plugin.evidence.declared_license) {
      throw new Error(`精选 registry 插件声明许可证漂移: ${plugin.name}`)
    }
    if (manifest.version !== plugin.evidence.package_version
      || JSON.stringify(manifest.dependencies || {}) !== JSON.stringify(plugin.evidence.package_dependencies)) {
      throw new Error(`精选 registry 插件版本或依赖闭包漂移: ${plugin.name}`)
    }
    if (plugin.evidence.release_dependencies !== undefined) {
      const releaseDependencies = plugin.evidence.release_dependencies
      if (!releaseDependencies || typeof releaseDependencies !== "object" || Array.isArray(releaseDependencies)
        || Object.keys(releaseDependencies).length === 0
        || Object.entries(releaseDependencies).some(([name, version]) => (
          plugin.evidence.package_dependencies[name] !== version
        ))) {
        throw new Error(`精选 registry 插件发行依赖投影无效: ${plugin.name}`)
      }
    }
    if (plugin.evidence.release_peer_dependencies !== undefined
      && (!plugin.evidence.release_peer_dependencies
        || typeof plugin.evidence.release_peer_dependencies !== "object"
        || Array.isArray(plugin.evidence.release_peer_dependencies)
        || Object.keys(plugin.evidence.release_peer_dependencies).length === 0
        || Object.values(plugin.evidence.release_peer_dependencies)
          .some((version) => typeof version !== "string" || !version.trim()))) {
      throw new Error(`精选 registry 插件发行 peer 投影无效: ${plugin.name}`)
    }
    const clientExport = manifest.exports?.["./client"]
    const clientEntry = typeof clientExport === "string" ? clientExport : clientExport?.default
    if (manifest.dsh?.client?.platform !== "web"
      || String(clientEntry || "").replace(/^\.\//, "") !== (plugin.evidence.client_entry || "lib/client.js")) {
      throw new Error(`精选 registry 插件缺少官方 Web Client 导出: ${plugin.name}`)
    }
    return { hostRequirements: plugin.permissions }
  }
  if (manifest.license !== plugin.license) {
    throw new Error(`精选插件清单与包许可证不一致: ${plugin.name}`)
  }
  if (manifest.packageManager !== "pnpm@11.22.0") {
    throw new Error(`精选插件必须固定使用 pnpm@11.22.0: ${plugin.name}`)
  }
  const portability = manifest.dshWork?.portability
  if (!portability || portability.level !== plugin.portability) {
    throw new Error(`精选插件清单与包 portability 不一致: ${plugin.name}`)
  }
  if (!Array.isArray(portability.hostRequirements)
    || JSON.stringify(portability.hostRequirements) !== JSON.stringify(plugin.permissions)) {
    throw new Error(`精选插件清单与包 Host 权限不一致: ${plugin.name}`)
  }
  return portability
}

/** Apply the reviewed dependency and peer projection used only by a fixed registry release tarball. */
export function projectFeaturedRegistryManifest(plugin, manifest) {
  if (plugin.evidence.source_kind !== "locked-registry-package") return structuredClone(manifest)
  return {
    ...structuredClone(manifest),
    ...(plugin.evidence.release_dependencies === undefined
      ? {}
      : { dependencies: { ...plugin.evidence.release_dependencies } }),
    ...(plugin.evidence.release_peer_dependencies === undefined
      ? {}
      : { peerDependencies: { ...plugin.evidence.release_peer_dependencies } }),
  }
}

function installedDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function resolveInstalledDependency(parentDir, packageName, serverRoot) {
  let current = parentDir
  for (;;) {
    const candidate = join(current, "node_modules", ...packageName.split("/"))
    if (inside(serverRoot, candidate) && installedDirectory(candidate)) return candidate
    const next = dirname(current)
    if (next === current || !inside(serverRoot, next)) break
    current = next
  }
  throw new Error(`精选 registry 插件依赖没有安装: ${packageName}`)
}

function dependencyLicenseFile(packageDir) {
  const name = readdirSync(packageDir)
    .filter((entry) => /^(license|licence|copying|notice)(\.|$)/i.test(entry))
    .sort((left, right) => left.localeCompare(right))[0]
  return name ? join(packageDir, name) : join(packageDir, "package.json")
}

function dependencyLicenseId(locked, manifest, licenseBytes) {
  const declared = locked?.license || manifest?.license
  if (typeof declared === "string" && declared.trim()) return declared
  const text = licenseBytes.toString("utf8")
  if (/The MIT License \(MIT\)[\s\S]*Permission is hereby granted, free of charge/i.test(text)) return "MIT"
  throw new Error(`精选 registry 插件依赖缺少可核对的 SPDX 许可证: ${manifest?.name || "unknown"}`)
}

/** Resolve one registry Bundle's complete installed dependency tree from the exact server lockfile. */
export function resolveFeaturedOfflineDependencies(plugin, {
  appRoot = SCRIPT_ROOT,
  lockfile = null,
} = {}) {
  if (plugin.evidence.source_kind !== "locked-registry-package") return []
  if (plugin.evidence.offline_dependency_resolution !== "package-lock-closure") {
    return plugin.evidence.offline_dependencies
  }
  const root = resolve(appRoot)
  const serverRoot = join(root, "server")
  const packageRoot = resolveFeaturedPackageDir(plugin, { appRoot: root })
  const packageLock = lockfile || JSON.parse(readFileSync(join(serverRoot, "package-lock.json"), "utf8"))
  const packagePrefix = `${relative(serverRoot, packageRoot).split(sep).join("/")}/`
  const rootDependencies = plugin.evidence.release_dependencies || plugin.evidence.package_dependencies
  const seen = new Map()
  const queue = [{
    dir: packageRoot,
    dependencies: rootDependencies,
    optionalDependencies: {},
  }]
  while (queue.length > 0) {
    const parent = queue.shift()
    const names = [...new Set([
      ...Object.keys(parent.dependencies || {}),
      ...Object.keys(parent.optionalDependencies || {}),
    ])].sort((left, right) => left.localeCompare(right))
    for (const name of names) {
      let packageDir
      try {
        packageDir = resolveInstalledDependency(parent.dir, name, serverRoot)
      } catch (error) {
        if (Object.hasOwn(parent.optionalDependencies || {}, name)) continue
        throw error
      }
      const lockPath = relative(serverRoot, packageDir).split(sep).join("/")
      if (seen.has(lockPath)) continue
      const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
      seen.set(lockPath, { packageDir, manifest })
      queue.push({
        dir: packageDir,
        dependencies: manifest.dependencies || {},
        optionalDependencies: manifest.optionalDependencies || {},
      })
    }
  }
  return [...seen.entries()]
    .map(([lockPath, { packageDir, manifest }]) => {
      const locked = packageLock?.packages?.[lockPath]
      if (!locked || locked.version !== manifest.version
        || typeof locked.integrity !== "string" || !locked.integrity) {
        throw new Error(`精选 registry 插件锁文件缺少完整依赖证据: ${lockPath}`)
      }
      const installPath = lockPath.startsWith(packagePrefix)
        ? lockPath.slice(packagePrefix.length)
        : lockPath
      const licensePath = dependencyLicenseFile(packageDir)
      const licenseBytes = readFileSync(licensePath)
      return {
        name: manifest.name,
        version: manifest.version,
        integrity: locked.integrity,
        license: dependencyLicenseId(locked, manifest, licenseBytes),
        license_path: relative(root, licensePath).split(sep).join("/"),
        license_sha256: sha256(licenseBytes),
        install_path: installPath,
        ...(installPath === lockPath ? {} : { lock_path: lockPath }),
      }
    })
    .sort((left, right) => left.install_path.localeCompare(right.install_path))
}

/** Resolve licenses for the complete upstream dependency tree, including code embedded in Client chunks. */
export function resolveFeaturedLicenseDependencies(plugin, options = {}) {
  if (plugin.evidence.source_kind !== "locked-registry-package") return []
  if (plugin.evidence.offline_dependency_resolution !== "package-lock-closure"
    || plugin.evidence.release_dependencies === undefined) {
    return resolveFeaturedOfflineDependencies(plugin, options)
  }
  return resolveFeaturedOfflineDependencies({
    ...plugin,
    evidence: { ...plugin.evidence, release_dependencies: undefined },
  }, options)
}

/** Verify that a pruned registry release keeps every dependency imported by the built Host entry. */
export function validateFeaturedRegistryReleaseDependencies(plugin, hostSource) {
  if (plugin.evidence.source_kind !== "locked-registry-package"
    || plugin.evidence.release_dependencies === undefined) return
  const sourceDependencies = new Set(Object.keys(plugin.evidence.package_dependencies))
  const imports = new Set([
    ...[...hostSource.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["'];?$/gm)].map((match) => match[1]),
    ...[...hostSource.matchAll(/\brequire(?:Impl)?\(["']([^"']+)["']\)/g)].map((match) => match[1]),
  ].filter((specifier) => sourceDependencies.has(specifier)))
  const expected = Object.keys(plugin.evidence.release_dependencies).sort()
  if (JSON.stringify([...imports].sort()) !== JSON.stringify(expected)) {
    throw new Error(`精选 registry 插件发行依赖与 Host 入口不一致: ${plugin.name}`)
  }
}

/** Apply an exact, hash-bound release adaptation to a registry Client bundle. */
export function transformFeaturedRegistryClient(plugin, sourceText) {
  const transform = plugin.evidence.release_transform
  if (!transform) return sourceText
  if (transform.id !== "smart-attachment-picker-v4") {
    throw new Error(`未知的精选 registry Client 发行适配: ${transform.id}`)
  }
  if (sha256(Buffer.from(sourceText)) !== transform.source_sha256) {
    throw new Error(`精选 registry Client 发行适配源文件漂移: ${plugin.name}`)
  }
  const dropEffect = /\n      React\.useEffect\(\(\) => \{\n        const dragover = event => \{[\s\S]*?\n      \}, \[accept, locked\]\);\n/
  const matches = sourceText.match(new RegExp(dropEffect.source, "g")) || []
  if (matches.length !== 1) throw new Error(`精选 registry Client 发行适配目标不唯一: ${plugin.name}`)
  const pickFunction = /    function pick\(kind, onFiles, onError\) \{[\s\S]*?\n    \}\n\n    function Paperclip\(\) \{/
  const pickMatches = sourceText.match(new RegExp(pickFunction.source, "g")) || []
  if (pickMatches.length !== 1) throw new Error(`精选 registry 图片选择器目标不唯一: ${plugin.name}`)
  const pickerHook = "      const locked = props.input.phase !== 'plain';"
  if (sourceText.split(pickerHook).length !== 2) {
    throw new Error(`精选 registry 图片能力 Hook 目标不唯一: ${plugin.name}`)
  }
  const filesMenuItem = `          h('button', {
            type: 'button',
            role: 'menuitem',
            onClick: () => pick('files', items => void accept(items), cause => setMessage(String(cause))),
          }, 'Choose files'),`
  if (sourceText.split(filesMenuItem).length !== 2) {
    throw new Error(`精选 registry 图片菜单目标不唯一: ${plugin.name}`)
  }
  const pickReplacement = pickMatches[0].replace("\n\n    function Paperclip() {", `

    function pickFiles(mediaTypes, onPick, onError) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.hidden = true;
      input.dataset.dshSmartAttachmentPicker = 'true';
      document.body.appendChild(input);
      const cleanup = () => input.remove();
      input.addEventListener('change', () => {
        try {
          const acceptedImageTypes = new Set(mediaTypes);
          const selected = [...input.files ?? []];
          const images = selected.filter(file => acceptedImageTypes.has(file.type));
          const workspaceFiles = selected.filter(file => !acceptedImageTypes.has(file.type));
          onPick(images, filesFromList(workspaceFiles));
        } catch (cause) {
          onError(cause);
        } finally {
          cleanup();
        }
      }, { once: true });
      input.addEventListener('cancel', cleanup, { once: true });
      input.click();
    }

    function addNativeImages(files) {
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      const event = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      });
      document.dispatchEvent(event);
      if (!event.defaultPrevented) {
        throw new Error('The official image attachment surface is unavailable');
      }
    }

    function Paperclip() {`)
  const smartFilesMenuItem = `          h('button', {
            type: 'button',
            role: 'menuitem',
            onClick: () => pickFiles(imageLimits?.mediaTypes ?? ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], (images, items) => {
              try {
                if (images.length > 0) addNativeImages(images);
                if (items.length > 0) void accept(items);
                else {
                  setMessage('');
                  setOpen(false);
                }
              } catch (cause) {
                setMessage(cause instanceof Error ? cause.message : String(cause));
              }
            }, cause => setMessage(String(cause))),
          }, 'Choose files'),`
  const commandMenuHook = "      const remove = (sessionId, occurrence) => {"
  if (sourceText.split(commandMenuHook).length !== 2) {
    throw new Error(`精选 registry 附件命令菜单目标不唯一: ${plugin.name}`)
  }
  const commandMenuRegistration = `      const attachmentCommands = () => {
        const commandUi = ctx.get('commandUi');
        if (commandUi === undefined) return () => {};
        const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
        const choose = (kind, sessionId) => {
          const fail = cause => console.error('[dsh-multimedia-webui-input] attachment command failed:', cause);
          if (kind === 'folder') {
            pick('folder', items => void add(sessionId, items).catch(fail), fail);
            return;
          }
          pickFiles(['image/png', 'image/jpeg', 'image/webp', 'image/gif'], (images, items) => {
            try {
              if (images.length > 0) addNativeImages(images);
              if (items.length > 0) void add(sessionId, items).catch(fail);
            } catch (cause) {
              fail(cause);
            }
          }, fail);
        };
        const register = (kind, name, description, label) => commandUi.register({
          name,
          description,
          available: session => {
            try {
              return inputFor(String(session.sessionId)).state.getSnapshot().phase === 'plain';
            } catch {
              return false;
            }
          },
          ui: {
            kind: 'popupSelect',
            options: () => Promise.resolve([{ id: kind, label }]),
            onSelect: (_option, session) => choose(kind, String(session.sessionId)),
          },
        });
        const disposers = [
          register('files', 'attach-files', zh ? '从本机选择文件并加入当前消息' : 'Choose files from this device and attach them to the current message', zh ? '选择文件…' : 'Choose files…'),
          register('folder', 'attach-folder', zh ? '从本机选择文件夹并加入当前消息' : 'Choose a folder from this device and attach it to the current message', zh ? '选择文件夹…' : 'Choose folder…'),
        ];
        return () => { for (const dispose of disposers.reverse()) dispose(); };
      };
      ctx.effect(attachmentCommands, 'community-multimedia-webui-input: command menu');

`
  const output = sourceText
    .replace(dropEffect, "\n")
    .replace(pickFunction, pickReplacement)
    .replace(pickerHook, `${pickerHook}\n      const imageLimits = props.useProjection('imageLimits');`)
    .replace(filesMenuItem, smartFilesMenuItem)
    .replace(commandMenuHook, `${commandMenuRegistration}${commandMenuHook}`)
  const outputSha256 = sha256(Buffer.from(output))
  if (outputSha256 !== transform.output_sha256) {
    throw new Error(`精选 registry Client 发行适配输出漂移: ${plugin.name}; expected=${transform.output_sha256}; actual=${outputSha256}`)
  }
  return output
}

/** Validate an exact registry package and its offline dependency closure against server/package-lock.json. */
export function validateFeaturedPackageLock(plugin, lockfile, options = {}) {
  if (plugin.evidence.source_kind !== "locked-registry-package") return
  const offlineDependencies = options.offlineDependencies
    || resolveFeaturedOfflineDependencies(plugin, { ...options, lockfile })
  const dependencyField = plugin.evidence.source_dependency_kind === "devDependency"
    ? "devDependencies"
    : "dependencies"
  const rootDependencies = lockfile?.packages?.[""]?.[dependencyField] || {}
  if (rootDependencies[plugin.name] !== plugin.evidence.package_version) {
    throw new Error(`精选 registry 插件不是 server 的精确直接${dependencyField}: ${plugin.name}`)
  }
  const records = [{
    name: plugin.name,
    version: plugin.evidence.package_version,
    integrity: plugin.evidence.package_integrity,
    license: plugin.evidence.declared_license,
    lock_path: `node_modules/${plugin.name}`,
  }, ...offlineDependencies]
  for (const record of records) {
    const locked = lockfile?.packages?.[record.lock_path || record.install_path]
    if (!locked || locked.version !== record.version || locked.integrity !== record.integrity
      || (locked.license !== undefined && locked.license !== record.license)) {
      throw new Error(`精选 registry 插件锁文件漂移: ${record.name}`)
    }
  }
}

/** Validate the curated composition claim against the package's runtime entry and patch. */
export function validateFeaturedPackageComposition(plugin, sourceText, patchText) {
  const composition = plugin.evidence.composition
  const name = sourceText.match(/^export const name = ["']([^"']+)["'];$/m)?.[1]
  if (plugin.evidence.source_kind === "workspace-package" && name !== composition.plugin_id) {
    throw new Error(`精选插件 composition.plugin_id 与源码 name 不一致: ${plugin.name}`)
  }
  const injectText = sourceText.match(/^export const inject = (\[[^\n]*\]);?$/m)?.[1]
    || sourceText.match(/\bctx\.inject\((\[[^\n]*\])/m)?.[1]
  const inject = injectText
    ? [...injectText.matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
    : null
  if (!inject || JSON.stringify(inject) !== JSON.stringify(composition.requires)) {
    throw new Error(`精选插件 composition.requires 与源码 inject 不一致: ${plugin.name}`)
  }
  const patchId = patchText.match(/^\s+- id:\s*([^\s#]+)$/m)?.[1]
  if (patchId !== composition.plugin_id) {
    throw new Error(`精选插件 composition.plugin_id 与 cordis.patch.yml 不一致: ${plugin.name}`)
  }
}

async function prepareRegistryPackSource(plugin, sourceDir, root) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-featured-registry-package-"))
  const staged = join(temporaryRoot, "package")
  try {
    await cp(sourceDir, staged, { recursive: true })
    const manifestPath = join(staged, "package.json")
    const manifest = projectFeaturedRegistryManifest(
      plugin,
      JSON.parse(await readFile(manifestPath, "utf8")),
    )
    const releaseDependencies = manifest.dependencies || {}
    manifest.bundleDependencies = Object.keys(releaseDependencies)
    if (plugin.evidence.release_files) manifest.files = [...plugin.evidence.release_files]
    await writeFile(manifestPath, json(manifest))
    if (plugin.evidence.release_transform) {
      const clientPath = join(staged, plugin.evidence.release_transform.path)
      const source = await readFile(clientPath, "utf8")
      await writeFile(clientPath, transformFeaturedRegistryClient(plugin, source))
    }
    for (const dependency of plugin.evidence.offline_dependencies) {
      const dependencySource = join(root, "server", dependency.lock_path || dependency.install_path)
      const dependencyManifest = JSON.parse(await readFile(join(dependencySource, "package.json"), "utf8"))
      const dependencyLicensePath = dependencyLicenseFile(dependencySource)
      const dependencyLicense = dependencyLicenseId(
        {},
        dependencyManifest,
        readFileSync(dependencyLicensePath),
      )
      if (dependencyManifest.version !== dependency.version || dependencyLicense !== dependency.license) {
        throw new Error(`精选 registry 插件离线依赖安装态漂移: ${dependency.name}`)
      }
      const target = join(staged, dependency.install_path)
      await mkdir(dirname(target), { recursive: true })
      await cp(dependencySource, target, { recursive: true })
    }
    return { sourceDir: staged, temporaryRoot }
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

function inside(root, target) {
  const path = relative(root, target)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

function licenseArtifactName(name, version, license) {
  const packageName = String(name).replace(/^@/, "").replaceAll("/", "-").replace(/[^A-Za-z0-9._-]/g, "-")
  return `${packageName}-${version}-${license}.txt`
}

function primaryLicenseFile(record) {
  return record.evidence.source_kind === "locked-registry-package"
    ? `licenses/${licenseArtifactName(record.name, record.version, record.package_license)}`
    : `licenses/${record.package_license}.txt`
}

function bundledLicenseFile(dependency) {
  return `licenses/${licenseArtifactName(dependency.name, dependency.version, dependency.license)}`
}

function evaluationRecord(record) {
  return {
    name: record.name,
    version: record.version,
    package_path: record.package_path,
    license: record.package_license,
    portability: record.portability,
    permissions: record.permissions,
    tarball: record.tarball,
    sha256: record.sha256,
    size_bytes: record.size_bytes,
    evidence: record.evidence,
  }
}

async function pack(sourceDir, outputDir) {
  const command = npmCommand()
  const cache = await mkdtemp(join(tmpdir(), "dsh-featured-npm-cache-"))
  try {
    const { stdout } = await execFileAsync(command.file, [
      ...command.prefix,
      "pack",
      ".",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      outputDir,
    ], {
      cwd: sourceDir,
      env: { ...process.env, npm_config_cache: cache },
      maxBuffer: 8 * 1024 * 1024,
    })
    const parsed = JSON.parse(stdout)
    const record = Array.isArray(parsed) ? parsed[0] : parsed
    if (!record?.filename) throw new Error(`npm pack 没有返回 tarball: ${sourceDir}`)
    return resolve(outputDir, basename(record.filename))
  } finally {
    await rm(cache, { recursive: true, force: true })
  }
}

/** Generate fixed local Bundle tarballs and all release-side projections from one list. */
export async function generateFeaturedPluginArtifacts({
  appRoot = FEATURED_PLUGIN_APP_ROOT,
  outputDir = DEFAULT_OUTPUT_DIR,
} = {}) {
  const root = resolve(appRoot)
  const output = resolve(outputDir)
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  const records = []
  const serverLockfile = JSON.parse(await readFile(join(root, "server", "package-lock.json"), "utf8"))
  for (const plugin of featuredPlugins()) {
    const sourceDir = resolveFeaturedPackageDir(plugin, { appRoot: root })
    const manifest = JSON.parse(await readFile(join(sourceDir, "package.json"), "utf8"))
    const portability = validateFeaturedPackageContract(plugin, manifest)
    const offlineDependencies = resolveFeaturedOfflineDependencies(plugin, {
      appRoot: root,
      lockfile: serverLockfile,
    })
    const licenseDependencies = resolveFeaturedLicenseDependencies(plugin, {
      appRoot: root,
      lockfile: serverLockfile,
    })
    const resolvedPlugin = offlineDependencies === plugin.evidence.offline_dependencies
      ? plugin
      : {
          ...plugin,
          evidence: {
            ...plugin.evidence,
            offline_dependencies: offlineDependencies,
            license_dependencies: licenseDependencies,
          },
        }
    validateFeaturedPackageLock(resolvedPlugin, serverLockfile, { offlineDependencies })
    await validateFeaturedPackageComposition(
      plugin,
      await readFile(join(sourceDir, plugin.evidence.source_entry || plugin.evidence.entry), "utf8"),
      await readFile(join(sourceDir, "cordis.patch.yml"), "utf8"),
    )
    validateFeaturedRegistryReleaseDependencies(
      plugin,
      await readFile(join(sourceDir, plugin.evidence.entry), "utf8"),
    )
    const prepared = plugin.evidence.source_kind === "locked-registry-package"
      ? await prepareRegistryPackSource(resolvedPlugin, sourceDir, root)
      : { sourceDir, temporaryRoot: null }
    let packed
    try {
      packed = await pack(prepared.sourceDir, output)
    } finally {
      if (prepared.temporaryRoot) await rm(prepared.temporaryRoot, { recursive: true, force: true })
    }
    const tarball = featuredPluginTarballName(plugin.name, manifest.version)
    const target = join(output, tarball)
    await rename(packed, target)
    const bytes = await readFile(target)
    const file = await stat(target)
    records.push({
      ...resolvedPlugin,
      version: manifest.version,
      tarball,
      sha256: sha256(bytes),
      size_bytes: file.size,
      package_license: plugin.license,
      package_declared_license: manifest.license || plugin.license,
      host_requirements: portability.hostRequirements,
    })
  }

  const manifest = {
    schema_version: 1,
    profile: featuredPluginManifest().profile,
    source_schema: featuredPluginManifest().schema_version,
    plugins: records.map((record) => ({
      ...record,
      license_file: primaryLicenseFile(record),
      bundled_license_files: [...new Set((record.evidence.license_dependencies
        || record.evidence.offline_dependencies || [])
        .map(bundledLicenseFile))],
    })),
  }
  const licenseDir = join(output, "licenses")
  await mkdir(licenseDir, { recursive: true })
  const licenseInputs = new Map()
  for (const record of records) {
    const primaryFile = primaryLicenseFile(record)
    licenseInputs.set(primaryFile, record.evidence.source_kind === "locked-registry-package"
      ? { path: record.evidence.license_path, sha256: record.evidence.license_sha256 }
      : { path: `legal/licenses/${record.package_license}.txt`, sha256: null })
    for (const dependency of record.evidence.license_dependencies
      || record.evidence.offline_dependencies || []) {
      licenseInputs.set(bundledLicenseFile(dependency), {
        path: dependency.license_path,
        sha256: dependency.license_sha256,
      })
    }
  }
  for (const [artifactPath, input] of licenseInputs) {
    const source = resolve(root, input.path)
    if (!inside(root, source)) throw new Error(`精选插件许可证路径越过应用目录: ${input.path}`)
    const licenseBytes = await readFile(source).catch(() => {
      throw new Error(`缺少精选插件许可证原文: ${input.path}`)
    })
    if (input.sha256 && sha256(licenseBytes) !== input.sha256) {
      throw new Error(`精选插件许可证原文漂移: ${input.path}`)
    }
    await writeFile(join(output, artifactPath), licenseBytes)
  }
  await writeFile(join(output, "manifest.json"), json(manifest))
  await writeFile(join(output, "profile-install.json"), json({
    schema_version: 1,
    profile: manifest.profile,
    bundles: records.map(({ name }) => name),
    commands: records.map(({ name, tarball, sha256: hash }) => ({
      args: ["plugin", "--profile", manifest.profile, "add", "-w", `file:plugin-library/tarballs/${tarball}`, "--save-exact", "--offline", "--ignore-scripts"],
      name,
      tarball,
      sha256: hash,
    })),
  }))
  await writeFile(join(output, "permissions.json"), json({
    schema_version: 1,
    plugins: records.map(({ name, version, permissions, host_requirements, portability, user_manageable }) => ({
      name,
      version,
      permissions,
      host_requirements,
      portability,
      user_manageable,
    })),
  }))
  const notices = [
    "# DSH Desktop bundled Profile Bundles",
    "",
    "This file is generated from `server/src/engine/dsh_runtime/featured_plugins.json`.",
    "",
    ...records.flatMap(({ name, version, package_license, package_path, sha256: hash, evidence }) => [
      `- ${name}@${version} — ${package_license}; license ${primaryLicenseFile({ name, version, package_license, evidence })}; source ${package_path}; SHA-256 ${hash}${evidence.declared_license && evidence.declared_license !== package_license ? `; package.json declares ${evidence.declared_license} while bundled LICENSE is ${package_license}` : ""}`,
      ...(evidence.license_dependencies || evidence.offline_dependencies || [])
        .map((dependency) => `  - bundled or embedded dependency ${dependency.name}@${dependency.version} — ${dependency.license}; license ${bundledLicenseFile(dependency)}; registry integrity ${dependency.integrity}`),
    ]),
    "",
  ].join("\n")
  await writeFile(join(output, "THIRD_PARTY_NOTICES.md"), notices)
  await writeFile(join(output, "test-expected.json"), json({
    schema_version: 1,
    profile: manifest.profile,
    bundles: records.map(({ name }) => name),
    tarballs: records.map(({ name, tarball, sha256: hash, size_bytes }) => ({ name, tarball, sha256: hash, size_bytes })),
  }))
  await writeFile(join(output, "evaluation.json"), json({
    schema_version: 1,
    profile: manifest.profile,
    source: "server/src/engine/dsh_runtime/featured_plugins.json",
    measurement_policy: {
      tarball: "per-plugin",
      profile_storage: "must be measured per-plugin; aggregate release smoke is not a substitute",
      cold_start: "must be measured per-plugin; aggregate release smoke is not a substitute",
      client_activation: "required for Client-enabled bundles and verified by packaged Electron smoke",
    },
    plugins: records.map(evaluationRecord),
  }))
  return manifest
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const outputDir = process.argv[2] || DEFAULT_OUTPUT_DIR
  const manifest = await generateFeaturedPluginArtifacts({ outputDir })
  console.log(`[package] 精选插件 tarball 已生成: ${manifest.plugins.length} 个 -> ${outputDir}`)
}
