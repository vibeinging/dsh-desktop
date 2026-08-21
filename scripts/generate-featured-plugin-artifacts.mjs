import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
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
  if (manifest.main !== `./${plugin.evidence.entry}`) {
    throw new Error(`精选插件清单与包入口不一致: ${plugin.name}`)
  }
  if (manifest.packageManager !== "pnpm@11.22.0") {
    throw new Error(`精选插件必须固定使用 pnpm@11.22.0: ${plugin.name}`)
  }
  if (manifest.dsh?.bundle?.patch !== "./cordis.patch.yml") {
    throw new Error(`精选插件必须通过 cordis.patch.yml 挂载: ${plugin.name}`)
  }
  if (manifest.license !== plugin.license) {
    throw new Error(`精选插件清单与包许可证不一致: ${plugin.name}`)
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
  const { stdout } = await execFileAsync(command.file, [
    ...command.prefix,
    "pack",
    sourceDir,
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    outputDir,
  ], { cwd: SCRIPT_ROOT, maxBuffer: 8 * 1024 * 1024 })
  const parsed = JSON.parse(stdout)
  const record = Array.isArray(parsed) ? parsed[0] : parsed
  if (!record?.filename) throw new Error(`npm pack 没有返回 tarball: ${sourceDir}`)
  return resolve(outputDir, basename(record.filename))
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
  for (const plugin of featuredPlugins()) {
    const sourceDir = resolveFeaturedPackageDir(plugin, { appRoot: root })
    const manifest = JSON.parse(await readFile(join(sourceDir, "package.json"), "utf8"))
    const portability = validateFeaturedPackageContract(plugin, manifest)
    const packed = await pack(sourceDir, output)
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
      package_license: manifest.license || plugin.license,
      host_requirements: portability.hostRequirements,
    })
  }

  const manifest = {
    schema_version: 1,
    profile: featuredPluginManifest().profile,
    source_schema: featuredPluginManifest().schema_version,
    plugins: records.map((record) => ({
      ...record,
      license_file: `licenses/${record.package_license}.txt`,
    })),
  }
  const licenseIds = new Set(records.map(({ package_license }) => package_license))
  const licenseDir = join(output, "licenses")
  await mkdir(licenseDir, { recursive: true })
  for (const licenseId of licenseIds) {
    if (!/^[A-Za-z0-9.-]+$/.test(licenseId)) throw new Error(`精选插件许可证标识无效: ${licenseId}`)
    const licensePath = join(SCRIPT_ROOT, "legal", "licenses", `${licenseId}.txt`)
    const licenseText = await readFile(licensePath, "utf8").catch(() => {
      throw new Error(`缺少精选插件许可证原文: ${licenseId}`)
    })
    await writeFile(join(licenseDir, `${licenseId}.txt`), licenseText)
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
    ...records.map(({ name, version, package_license, package_path, sha256: hash }) => `- ${name}@${version} — ${package_license}; license licenses/${package_license}.txt; source ${package_path}; SHA-256 ${hash}`),
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
      client_activation: "not-applicable for the current host-only curated set",
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
