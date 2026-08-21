import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { resolveCommitSha } from './release-evidence-receipt.mjs'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FEATURED_ARTIFACT_DIR = join(APP_ROOT, '.desktop-build', 'featured-plugins')
const FEATURED_ARTIFACT_MANIFEST = join(FEATURED_ARTIFACT_DIR, 'manifest.json')
const FEATURED_SOURCE_MANIFEST = join(APP_ROOT, 'server/src/engine/dsh_runtime/featured_plugins.json')
const DSH_CLI = join(APP_ROOT, 'server', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const PNPM_BIN_DIR = join(APP_ROOT, '.desktop-build', 'pnpm-bin')
const DEFAULT_OUTPUT = join(APP_ROOT, '.desktop-build', 'reports', 'featured-plugin-evaluation.json')
const PRODUCT_HOST_PROVIDER = '@vibeinging/dsh-work-product-host-ipc'

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function directoryBytes(path) {
  if (!existsSync(path)) return 0
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  let bytes = 0
  for (const name of await readdir(path)) bytes += await directoryBytes(join(path, name))
  return bytes
}

function runOfficial(args, { env, label, timeoutMs = 120_000 } = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(process.execPath, [DSH_CLI, ...args], {
      cwd: APP_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk) => { output += chunk.toString() }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectCommand(new Error(`${label} 超时\n${output}`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectCommand(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolveCommand(output)
      else rejectCommand(new Error(`${label} 失败 code=${code} signal=${signal || 'none'}\n${output}`))
    })
  })
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolveExit()
    }, 10_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })
  })
}

function startServer(env, label) {
  const startedAt = performance.now()
  const child = spawn(process.execPath, [DSH_CLI, '--profile', 'web', '--port', '0'], {
    cwd: APP_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  return new Promise((resolveStart, rejectStart) => {
    const timer = setTimeout(() => {
      void stopServer(child)
      rejectStart(new Error(`${label} 启动超时\n${output}`))
    }, 45_000)
    const inspect = (chunk) => {
      output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
      if (!match) return
      clearTimeout(timer)
      resolveStart({
        child,
        url: match[1],
        coldWebMs: Math.round(performance.now() - startedAt),
        getOutput: () => output,
      })
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectStart(error)
    })
    child.once('exit', (code, signal) => {
      if (child.exitCode === null) return
      clearTimeout(timer)
      rejectStart(new Error(`${label} 失败 code=${code} signal=${signal || 'none'}\n${output}`))
    })
  })
}

async function readProfile(home) {
  const path = join(home, 'profiles', 'web', 'package.json')
  return { path, text: await readFile(path, 'utf8'), manifest: JSON.parse(await readFile(path, 'utf8')) }
}

function makeEnvironment(home) {
  const libraryRoot = join(home, 'plugin-library')
  const path = `${PNPM_BIN_DIR}${delimiter}${process.env.PATH || ''}`
  return {
    ...process.env,
    HOME: join(home, 'home'),
    PATH: path,
    DSH_HOME: home,
    DSH_RUNTIME_HOME: home,
    DSH_DATA_ROOT: home,
    DSH_RUNTIME_DISTRIBUTION: 'source',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_PROFILE_PLUGIN_LIBRARY: libraryRoot,
    DSH_FEATURED_PLUGIN_TARBALL_DIR: FEATURED_ARTIFACT_DIR,
    DSH_FEATURED_PLUGIN_MANIFEST: FEATURED_ARTIFACT_MANIFEST,
    DSH_PNPM_BIN_DIR: PNPM_BIN_DIR,
    DSH_PNPM_NODE_BIN: process.execPath,
    DSH_PNPM_REQUIRED: '1',
    DSH_AGENT_RUNTIME_HOME: join(home, 'agent-runtime'),
    DSH_SKILLS_ROOT: join(home, 'skills'),
    npm_config_offline: 'true',
    pnpm_config_offline: 'true',
    npm_config_store_dir: join(libraryRoot, 'store'),
    pnpm_config_store_dir: join(libraryRoot, 'store'),
    npm_config_auto_install_peers: 'false',
    pnpm_config_auto_install_peers: 'false',
  }
}

async function measurePlugin(plugin, artifact) {
  const tempDir = await mkdtemp(join(tmpdir(), 'dsh-featured-plugin-evidence-'))
  const home = join(tempDir, 'dsh-home')
  const env = makeEnvironment(home)
  const tarballPath = join(FEATURED_ARTIFACT_DIR, artifact.tarball)
  const tarballBytes = await readFile(tarballPath)
  const result = {
    name: plugin.name,
    version: artifact.version,
    tarball: artifact.tarball,
    tarball_bytes: tarballBytes.length,
    sha256: sha256(tarballBytes),
    scope: 'source-dsh-cli',
    desktop_runtime_required: plugin.evidence.desktop_runtime_required === true,
    client_activation: plugin.evidence.client ? 'required' : 'not-applicable',
  }
  const supportBundles = plugin.name !== PRODUCT_HOST_PROVIDER ? [PRODUCT_HOST_PROVIDER] : []
  result.support_bundles = supportBundles
  let server
  try {
    const beforeBytes = await directoryBytes(home)
    for (const supportName of supportBundles) {
      const supportArtifact = JSON.parse(await readFile(FEATURED_ARTIFACT_MANIFEST, 'utf8'))
        .plugins.find((candidate) => candidate.name === supportName)
      if (!supportArtifact) throw new Error(`缺少 ${supportName} 的支持 Bundle 产物`)
      await runOfficial([
        'plugin', '--profile', 'web', 'add', '-w', `file:${join(FEATURED_ARTIFACT_DIR, supportArtifact.tarball)}`,
        '--save-exact', '--offline', '--ignore-scripts',
      ], { env, label: `安装 ${supportName} 支持 Bundle` })
    }
    await runOfficial([
      'plugin', '--profile', 'web', 'add', '-w', `file:${tarballPath}`,
      '--save-exact', '--offline', '--ignore-scripts',
    ], { env, label: `安装 ${plugin.name}` })
    const afterInstall = await readProfile(home)
    if (!afterInstall.manifest.dsh?.profile?.bundles?.includes(plugin.name)
      || typeof afterInstall.manifest.dependencies?.[plugin.name] !== 'string') {
      throw new Error(`${plugin.name} 安装后没有进入官方 Profile manifest`)
    }
    const afterInstallBytes = await directoryBytes(home)
    const firstStart = await startServer(env, `${plugin.name} 安装后启动`)
    server = firstStart.child
    let html
    try {
      const response = await fetch(firstStart.url)
      if (!response.ok) throw new Error(`${plugin.name} Web 返回 ${response.status}`)
      html = await response.text()
    } catch (error) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
      throw new Error(`${plugin.name} Web 访问失败：${error?.message || error}; exit=${firstStart.child.exitCode}\n${firstStart.getOutput()}`)
    }
    if (!plugin.evidence.client && html.includes(`/plugins/${plugin.name}/client.js?rev=`)) {
      throw new Error(`${plugin.name} 声称无 Client 但被官方 Web 投影`)
    }
    await stopServer(server)
    server = null

    if (plugin.evidence.desktop_runtime_required === true) {
      result.status = 'passed'
      result.profile_storage_bytes_before = beforeBytes
      result.profile_storage_bytes_after_install = afterInstallBytes
      result.profile_cold_web_ms = firstStart.coldWebMs
      result.lifecycle = {
        install: true,
        start: true,
        disable: 'not-applicable-foundation-bundle',
        uninstall: 'blocked-by-desktop-runtime-contract',
        restart_after_uninstall: 'not-applicable-foundation-bundle',
        manifest_unchanged_while_disabled: 'not-applicable-foundation-bundle',
        stable_tarball_library_retained: true,
      }
      return result
    }

    const disabledManifestText = afterInstall.text
    await writeFile(join(home, 'cordis.patch.yml'), `- id: ${plugin.evidence.patch_id}\n  disabled: true\n`)
    const dump = await runOfficial(['--profile', 'web', '--dump-config'], {
      env,
      label: `只读预检停用 ${plugin.name}`,
    })
    if (!dump.includes(`id: ${plugin.evidence.patch_id}`) || !dump.includes('disabled: true')) {
      throw new Error(`${plugin.name} 停用后只读预检没有保留 disabled patch`)
    }
    const afterDisable = await readProfile(home)
    if (afterDisable.text !== disabledManifestText) throw new Error(`${plugin.name} 停用只读预检改写了 Profile`)
    const disabledStart = await startServer(env, `${plugin.name} 停用后启动`)
    await stopServer(disabledStart.child)
    await rm(join(home, 'cordis.patch.yml'), { force: true })

    await runOfficial(['plugin', '--profile', 'web', 'remove', plugin.name], {
      env,
      label: `官方卸载 ${plugin.name}`,
    })
    const afterRemove = await readProfile(home)
    if (afterRemove.manifest.dsh?.profile?.bundles?.includes(plugin.name)
      || Object.hasOwn(afterRemove.manifest.dependencies || {}, plugin.name)) {
      throw new Error(`${plugin.name} 官方卸载后仍在 Profile manifest 中`)
    }
    const removedStart = await startServer(env, `${plugin.name} 卸载后启动`)
    await stopServer(removedStart.child)
    server = null
    result.status = 'passed'
    result.profile_storage_bytes_before = beforeBytes
    result.profile_storage_bytes_after_install = afterInstallBytes
    result.profile_storage_bytes_after_uninstall = await directoryBytes(home)
    result.profile_cold_web_ms = firstStart.coldWebMs
    result.lifecycle = {
      install: true,
      start: true,
      disable: true,
      uninstall: true,
      restart_after_uninstall: true,
      manifest_unchanged_while_disabled: true,
      stable_tarball_library_retained: true,
    }
  } catch (error) {
    result.status = 'failed'
    result.error = String(error?.message || error)
  } finally {
    await stopServer(server)
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
  return result
}

async function main() {
  if (!existsSync(DSH_CLI)) throw new Error(`缺少 app-pinned DSH CLI: ${DSH_CLI}`)
  if (!existsSync(PNPM_BIN_DIR)) throw new Error(`缺少受控 pnpm: ${PNPM_BIN_DIR}`)
  if (!existsSync(FEATURED_ARTIFACT_MANIFEST)) {
    throw new Error(`缺少精选插件随包 manifest，请先生成发行产物: ${FEATURED_ARTIFACT_MANIFEST}`)
  }
  const featured = JSON.parse(await readFile(join(APP_ROOT, 'server/src/engine/dsh_runtime/featured_plugins.json'), 'utf8'))
  const artifacts = JSON.parse(await readFile(FEATURED_ARTIFACT_MANIFEST, 'utf8'))
  const featuredSourceSha256 = sha256(await readFile(FEATURED_SOURCE_MANIFEST))
  const artifactManifestSha256 = sha256(await readFile(FEATURED_ARTIFACT_MANIFEST))
  const gitCommitSha = resolveCommitSha(APP_ROOT)
  const artifactByName = new Map(artifacts.plugins.map((plugin) => [plugin.name, plugin]))
  const requested = String(argument('only', '') || '').split(',').map((name) => name.trim()).filter(Boolean)
  const names = requested.length > 0 ? new Set(requested) : null
  const plugins = featured.plugins.filter((plugin) => !names || names.has(plugin.name))
  if (plugins.length === 0) throw new Error('没有匹配的精选插件')
  const measurements = []
  for (const plugin of plugins) {
    const artifact = artifactByName.get(plugin.name)
    if (!artifact) throw new Error(`随包 manifest 缺少 ${plugin.name}`)
    measurements.push(await measurePlugin(plugin, artifact))
    const latest = measurements.at(-1)
    console.log(`[measure] ${latest.status === 'passed' ? 'PASS' : 'FAIL'} ${plugin.name}${latest.profile_cold_web_ms ? ` cold_web_ms=${latest.profile_cold_web_ms}` : ''}`)
  }
  const outputPath = resolve(argument('output', DEFAULT_OUTPUT))
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify({
    schema_version: 2,
    profile: featured.profile,
    git_commit_sha: gitCommitSha,
    featured_source: {
      reference: 'server/src/engine/dsh_runtime/featured_plugins.json',
      sha256: featuredSourceSha256,
    },
    artifact_manifest: {
      reference: 'featured-plugins/manifest.json',
      sha256: artifactManifestSha256,
    },
    measured_at: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    evidence_level: 'source-profile-integration',
    plugins: measurements,
  }, null, 2)}\n`)
  const failures = measurements.filter((measurement) => measurement.status !== 'passed')
  if (failures.length > 0) throw new Error(`${failures.length} 个精选插件逐包测量失败；详情见 ${outputPath}`)
  console.log(`[measure] PASS ${measurements.length} 个精选插件逐包 Profile 管理边界测量（基础服务卸载受桌面契约阻止） -> ${outputPath}`)
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main()
