import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
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
    if (manifest.license !== plugin.evidence.declared_license) {
      throw new Error(`精选 registry 插件声明许可证漂移: ${plugin.name}`)
    }
    if (manifest.version !== plugin.evidence.package_version
      || JSON.stringify(manifest.dependencies || {}) !== JSON.stringify(plugin.evidence.package_dependencies)) {
      throw new Error(`精选 registry 插件版本或依赖闭包漂移: ${plugin.name}`)
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

/** Validate an exact registry package and its offline dependency closure against server/package-lock.json. */
export function validateFeaturedPackageLock(plugin, lockfile) {
  if (plugin.evidence.source_kind !== "locked-registry-package") return
  const rootDependencies = lockfile?.packages?.[""]?.dependencies || {}
  if (rootDependencies[plugin.name] !== plugin.evidence.package_version) {
    throw new Error(`精选 registry 插件不是 server 的精确直接依赖: ${plugin.name}`)
  }
  const records = [{
    name: plugin.name,
    version: plugin.evidence.package_version,
    integrity: plugin.evidence.package_integrity,
    license: plugin.evidence.declared_license,
    lock_path: `node_modules/${plugin.name}`,
  }, ...plugin.evidence.offline_dependencies]
  for (const record of records) {
    const locked = lockfile?.packages?.[record.lock_path || record.install_path]
    if (!locked || locked.version !== record.version || locked.integrity !== record.integrity
      || locked.license !== record.license) {
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
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.bundleDependencies = Object.keys(plugin.evidence.package_dependencies)
    await writeFile(manifestPath, json(manifest))
    for (const dependency of plugin.evidence.offline_dependencies) {
      const dependencySource = join(root, "server", dependency.install_path)
      const dependencyManifest = JSON.parse(await readFile(join(dependencySource, "package.json"), "utf8"))
      if (dependencyManifest.version !== dependency.version || dependencyManifest.license !== dependency.license) {
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
    validateFeaturedPackageLock(plugin, serverLockfile)
    await validateFeaturedPackageComposition(
      plugin,
      await readFile(join(sourceDir, plugin.evidence.source_entry || plugin.evidence.entry), "utf8"),
      await readFile(join(sourceDir, "cordis.patch.yml"), "utf8"),
    )
    const prepared = plugin.evidence.source_kind === "locked-registry-package"
      ? await prepareRegistryPackSource(plugin, sourceDir, root)
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
      ...plugin,
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
      bundled_license_files: [...new Set((record.evidence.offline_dependencies || [])
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
    for (const dependency of record.evidence.offline_dependencies || []) {
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
      ...(evidence.offline_dependencies || []).map((dependency) => `  - bundled dependency ${dependency.name}@${dependency.version} — ${dependency.license}; license ${bundledLicenseFile(dependency)}; registry integrity ${dependency.integrity}`),
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
