import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_ARTIFACT_ROOT = join(APP_ROOT, ".desktop-build", "featured-plugins")

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

async function run(label, command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: APP_ROOT,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10 * 60 * 1_000,
      ...options,
    })
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`.trim()
    throw new Error(`${label}失败：${output.slice(-4_000) || error.message}`)
  }
}

async function regularFiles(root) {
  const files = []
  const queue = [root]
  while (queue.length > 0) {
    const directory = queue.shift()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        queue.push(path)
        continue
      }
      if (!entry.isFile()) continue
      files.push(path)
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

const MACHO_MAGICS = new Set([
  "cafebabe", "bebafeca", "cafebabf", "bfbafeca",
  "feedface", "cefaedfe", "feedfacf", "cffaedfe",
])

/** Return whether four leading bytes identify a thin or universal Mach-O file. */
export function isMachOMagic(bytes) {
  return Buffer.from(bytes || []).subarray(0, 4).toString("hex").length === 8
    && MACHO_MAGICS.has(Buffer.from(bytes).subarray(0, 4).toString("hex"))
}

async function isMachOFile(path) {
  const handle = await open(path, "r")
  try {
    const bytes = Buffer.alloc(4)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    return bytesRead === 4 && isMachOMagic(bytes)
  } finally {
    await handle.close()
  }
}

/** Return whether macOS `file` output describes a Mach-O binary. */
export function isMachODescription(description) {
  return /\bMach-O\b/.test(String(description || ""))
}

async function atomicJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, json(value))
  await rename(temporary, path)
}

/** Recompute modified tarball hashes and keep every generated projection synchronized. */
export async function synchronizeFeaturedArtifactProjections(artifactRoot = DEFAULT_ARTIFACT_ROOT) {
  const root = resolve(artifactRoot)
  const manifestPath = join(root, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const previousHashes = new Map()
  for (const plugin of manifest.plugins || []) {
    const tarballPath = join(root, basename(plugin.tarball || ""))
    if (!plugin.tarball || !existsSync(tarballPath)) {
      throw new Error(`精选插件缺少待同步 tarball：${plugin.name || "unknown"}`)
    }
    previousHashes.set(plugin.name, plugin.sha256)
    const bytes = await readFile(tarballPath)
    plugin.sha256 = sha256(bytes)
    plugin.size_bytes = (await stat(tarballPath)).size
  }

  const byName = new Map((manifest.plugins || []).map((plugin) => [plugin.name, plugin]))
  const profilePath = join(root, "profile-install.json")
  const profile = JSON.parse(await readFile(profilePath, "utf8"))
  for (const command of profile.commands || []) {
    const plugin = byName.get(command.name)
    if (!plugin) throw new Error(`profile-install.json 包含未知插件：${command.name}`)
    command.sha256 = plugin.sha256
  }

  const expectedPath = join(root, "test-expected.json")
  const expected = JSON.parse(await readFile(expectedPath, "utf8"))
  for (const tarball of expected.tarballs || []) {
    const plugin = byName.get(tarball.name)
    if (!plugin) throw new Error(`test-expected.json 包含未知插件：${tarball.name}`)
    tarball.sha256 = plugin.sha256
    tarball.size_bytes = plugin.size_bytes
  }

  const evaluationPath = join(root, "evaluation.json")
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"))
  for (const row of evaluation.plugins || []) {
    const plugin = byName.get(row.name)
    if (!plugin) throw new Error(`evaluation.json 包含未知插件：${row.name}`)
    row.sha256 = plugin.sha256
    row.size_bytes = plugin.size_bytes
  }

  const noticesPath = join(root, "THIRD_PARTY_NOTICES.md")
  let notices = await readFile(noticesPath, "utf8")
  for (const plugin of manifest.plugins || []) {
    const previous = previousHashes.get(plugin.name)
    if (!previous || previous === plugin.sha256) continue
    const marker = `SHA-256 ${previous}`
    if (notices.split(marker).length !== 2) {
      throw new Error(`THIRD_PARTY_NOTICES.md 缺少 ${plugin.name} 的唯一旧哈希`)
    }
    notices = notices.replace(marker, `SHA-256 ${plugin.sha256}`)
  }

  await atomicJson(manifestPath, manifest)
  await atomicJson(profilePath, profile)
  await atomicJson(expectedPath, expected)
  await atomicJson(evaluationPath, evaluation)
  await writeFile(noticesPath, notices)
  return manifest
}

/** Sign every nested Mach-O file before curated tarballs enter a notarized macOS App. */
export async function signFeaturedMacosNativeArtifacts({
  artifactRoot = DEFAULT_ARTIFACT_ROOT,
  identity = process.env.CSC_NAME,
} = {}) {
  if (process.platform !== "darwin") {
    throw new Error(`精选插件 macOS 原生文件签名只能在 darwin 执行，当前为 ${process.platform}`)
  }
  const signer = String(identity || "").trim()
  if (!signer) throw new Error("精选插件 macOS 原生文件签名缺少 CSC_NAME")
  const root = resolve(artifactRoot)
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"))
  const signed = []

  for (const plugin of manifest.plugins || []) {
    const tarballPath = join(root, basename(plugin.tarball || ""))
    const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-featured-macos-sign-"))
    const extracted = join(temporaryRoot, "extracted")
    const replacement = join(temporaryRoot, basename(tarballPath))
    try {
      await run("解压精选插件 ", "/usr/bin/tar", ["-xzf", tarballPath, "-C", temporaryRoot])
      const packageRoot = join(temporaryRoot, "package")
      if (!existsSync(packageRoot)) throw new Error(`精选插件 tarball 缺少 package 根目录：${plugin.name}`)
      await rename(packageRoot, extracted)
      const signedPaths = []
      for (const path of await regularFiles(extracted)) {
        if (!await isMachOFile(path)) continue
        const { stdout } = await run("识别精选插件原生文件 ", "/usr/bin/file", ["-b", path], { timeout: 120_000 })
        if (!isMachODescription(stdout)) throw new Error(`Mach-O 文件识别结果不一致：${path}`)
        if (/\bexecutable\b/.test(stdout)) await chmod(path, 0o755)
        await run("签署精选插件原生文件 ", "/usr/bin/codesign", [
          "--force", "--timestamp", "--options", "runtime", "--sign", signer, path,
        ], { timeout: 120_000 })
        await run("验证精选插件原生文件签名 ", "/usr/bin/codesign", [
          "--verify", "--strict", "--verbose=2", path,
        ], { timeout: 120_000 })
        signedPaths.push(relative(extracted, path).split("\\").join("/"))
      }
      if (signedPaths.length === 0) continue
      await rename(extracted, packageRoot)
      await run("重建精选插件 tarball ", "/usr/bin/tar", [
        "-czf", replacement, "-C", temporaryRoot, "package",
      ])
      const { stdout: listing } = await run("验证精选插件 tarball ", "/usr/bin/tar", ["-tzf", replacement])
      if (!String(listing).split("\n").includes("package/package.json")) {
        throw new Error(`重建后的精选插件 tarball 缺少 package/package.json：${plugin.name}`)
      }
      const verificationRoot = join(temporaryRoot, "verification")
      await run("创建精选插件签名复核目录 ", "/bin/mkdir", ["-p", verificationRoot])
      await run("解压精选插件签名复核包 ", "/usr/bin/tar", ["-xzf", replacement, "-C", verificationRoot])
      for (const signedPath of signedPaths) {
        await run("复核归档后的精选插件原生文件签名 ", "/usr/bin/codesign", [
          "--verify", "--strict", "--verbose=2", join(verificationRoot, "package", signedPath),
        ], { timeout: 120_000 })
      }
      await rename(replacement, tarballPath)
      signed.push({ name: plugin.name, paths: signedPaths })
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }

  await synchronizeFeaturedArtifactProjections(root)
  console.log(`[featured-macos-sign] PASS ${signed.reduce((count, plugin) => count + plugin.paths.length, 0)} 个 Mach-O 文件已签名，涉及 ${signed.length} 个 Bundle`)
  return signed
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await signFeaturedMacosNativeArtifacts()
}
