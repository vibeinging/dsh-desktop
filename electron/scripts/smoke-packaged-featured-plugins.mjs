import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { resolvePackagedLayout } from './packaged-layout.mjs'
import { pathWithPackagedBin, systemOnlyPath } from './packaged-smoke-environment.mjs'

const appInput = process.argv[2] || '../release/mac-arm64/DSH Desktop.app'
const { executable, resourcesDir } = resolvePackagedLayout(appInput)
const tempDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-featured-plugins-'))
const serverDir = join(resourcesDir, 'server')
const dshCli = join(serverDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpmBinDir = join(resourcesDir, 'pnpm-bin')
const featuredArtifactDir = join(resourcesDir, 'featured-plugins')
const featuredArtifactManifest = join(featuredArtifactDir, 'manifest.json')
const featuredSourceManifest = join(serverDir, 'src', 'engine', 'dsh_runtime', 'featured_plugins.json')
const PRODUCT_HOST_PROVIDER = '@vibeinging/dsh-work-product-host-ipc'

function requestedOnly() {
  const index = process.argv.indexOf('--only')
  if (index < 0) return null
  const names = String(process.argv[index + 1] || '').split(',').map((name) => name.trim()).filter(Boolean)
  return names.length > 0 ? new Set(names) : null
}

async function directoryBytes(path) {
  if (!existsSync(path)) return 0
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  let bytes = 0
  for (const name of await readdir(path)) bytes += await directoryBytes(join(path, name))
  return bytes
}

function baseEnv(tempRoot, dataRoot, userDataDir) {
  const env = {
    ...process.env,
    HOME: join(tempRoot, 'home'),
    PATH: systemOnlyPath(),
    DSH_USER_DATA_DIR: userDataDir,
    DSH_DATA_ROOT: dataRoot,
    DSH_AGENT_RUNTIME_HOME: join(tempRoot, 'agent-runtime'),
    DSH_SKILLS_ROOT: join(dataRoot, 'skills'),
  }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'DB_SQLITE_PATH', 'INTERMEDIATE_DIR', 'DSH_AGENT_SESSION_DIR', 'DSH_YITRACE_DIR']) {
    delete env[key]
  }
  return env
}

function officialEnv(tempRoot, dataRoot, userDataDir, { offline = false } = {}) {
  const libraryRoot = join(dataRoot, 'plugin-library')
  return {
    ...baseEnv(tempRoot, dataRoot, userDataDir),
    PATH: pathWithPackagedBin(pnpmBinDir),
    DSH_HOME: dataRoot,
    DSH_RUNTIME_DISTRIBUTION: 'npm',
    DSH_RUNTIME_HOME: dataRoot,
    DSH_PROFILE_PLUGIN_LIBRARY: libraryRoot,
    DSH_FEATURED_PLUGIN_TARBALL_DIR: featuredArtifactDir,
    DSH_FEATURED_PLUGIN_MANIFEST: featuredArtifactManifest,
    DSH_PNPM_BIN_DIR: pnpmBinDir,
    DSH_PNPM_NODE_BIN: executable,
    DSH_PNPM_REQUIRED: '1',
    DSH_RUNTIME_INSTALL_ANCHOR: join(serverDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    pnpm_config_store_dir: join(libraryRoot, 'store'),
    npm_config_store_dir: join(libraryRoot, 'store'),
    pnpm_config_auto_install_peers: 'false',
    npm_config_auto_install_peers: 'false',
    ...(offline ? { pnpm_config_offline: 'true', npm_config_offline: 'true' } : {}),
    ELECTRON_RUN_AS_NODE: '1',
  }
}

function runProcess(label, args, env, { timeoutMs = 180_000 } = {}) {
  return new Promise((resolveProcess, rejectProcess) => {
    const startedAt = performance.now()
    const child = spawn(executable, args, { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const output = []
    child.stdout.on('data', (chunk) => output.push(chunk.toString()))
    child.stderr.on('data', (chunk) => output.push(chunk.toString()))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectProcess(new Error(`${label} 超时\n${output.join('')}`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectProcess(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      const text = output.join('')
      if (code === 0) resolveProcess({ text, durationMs: Math.round(performance.now() - startedAt) })
      else rejectProcess(new Error(`${label} 失败 code=${code} signal=${signal || 'none'}\n${text}`))
    })
  })
}

async function runOfficial(args, env, label) {
  const result = await runProcess(label, [dshCli, ...args], env, { timeoutMs: 120_000 })
  return result.text
}

async function runPackagedApp(env, label, { clientPlugin = null } = {}) {
  const appEnv = { ...env }
  delete appEnv.ELECTRON_RUN_AS_NODE
  if (clientPlugin === '@linxin666/dsh-client-ui-task-board') {
    appEnv.DSH_SMOKE_CLICK_SELECTORS = JSON.stringify(['[data-dsh-taskboard-entry]'])
    appEnv.DSH_SMOKE_EXPECT_SELECTOR = '[data-dsh-taskboard-board]'
  }
  if (clientPlugin === '@vibeinging/dsh-desktop-chrome') {
    appEnv.DSH_SMOKE_EXPECT_SELECTOR = '[data-dsh-desktop-titlebar]'
  }
  const result = await runProcess(label, [], {
    ...appEnv,
    DSH_SMOKE_TEST: '1',
    DSH_SMOKE_DISMISS_ONBOARDING: '1',
    DSH_SMOKE_EXPECT_RECOVERY: '1',
    DSH_SMOKE_TIMEOUT_MS: '150000',
  })
  if (!result.text.includes('[smoke] 官方 DSH Web 已加载')) {
    throw new Error(`${label} 没有完成官方 Web 加载\n${result.text}`)
  }
  if (!result.text.includes('Server 退出 code=0')) {
    throw new Error(`${label} Server 没有正常退出\n${result.text}`)
  }
  return result
}

async function readProfile(dataRoot) {
  const path = join(dataRoot, 'profiles', 'web', 'package.json')
  return { path, text: await readFile(path, 'utf8'), manifest: JSON.parse(await readFile(path, 'utf8')) }
}

function supportBundles(plugin) {
  return plugin.name !== PRODUCT_HOST_PROVIDER ? [PRODUCT_HOST_PROVIDER] : []
}

async function measurePlugin(plugin, artifact, sourceArtifactByName) {
  const pluginDirName = plugin.name.replace(/[^A-Za-z0-9._-]+/g, '-')
  const pluginRoot = join(tempDir, pluginDirName)
  const dataRoot = join(pluginRoot, 'data')
  const userDataDir = join(pluginRoot, 'user-data')
  await mkdir(pluginRoot, { recursive: true })
  const env = officialEnv(pluginRoot, dataRoot, userDataDir, { offline: true })
  const result = {
    name: plugin.name,
    version: artifact.version,
    tarball: artifact.tarball,
    tarball_bytes: artifact.size_bytes,
    scope: 'packaged-electron',
    support_bundles: supportBundles(plugin),
    desktop_runtime_required: plugin.evidence?.desktop_runtime_required === true,
    client_activation: plugin.evidence?.client ? 'required' : 'not-applicable',
  }
  try {
    const beforeBytes = await directoryBytes(dataRoot)
    for (const supportName of result.support_bundles) {
      const supportArtifact = sourceArtifactByName.get(supportName)
      if (!supportArtifact) throw new Error(`缺少 ${supportName} 的随包 tarball`)
      await runOfficial([
        'plugin', '--profile', 'web', 'add', '-w', `file:${join(featuredArtifactDir, supportArtifact.tarball)}`,
        '--save-exact', '--offline', '--ignore-scripts',
      ], env, `随包安装支持 Bundle ${supportName}`)
    }
    await runOfficial([
      'plugin', '--profile', 'web', 'add', '-w', `file:${join(featuredArtifactDir, artifact.tarball)}`,
      '--save-exact', '--offline', '--ignore-scripts',
    ], env, `随包安装 ${plugin.name}`)
    const installed = await readProfile(dataRoot)
    if (!installed.manifest.dsh?.profile?.bundles?.includes(plugin.name)
      || !Object.hasOwn(installed.manifest.dependencies || {}, plugin.name)) {
      throw new Error(`${plugin.name} 安装后不在 Profile manifest 中`)
    }
    const storageAfterInstall = await directoryBytes(dataRoot)
    const appStart = await runPackagedApp(env, `${plugin.name} 安装后 Electron 启动`, {
      clientPlugin: plugin.evidence?.client ? plugin.name : null,
    })
    if (await readFile(installed.path, 'utf8') !== installed.text) {
      throw new Error(`${plugin.name} Electron 启动改写了已有 Profile`)
    }

    if (plugin.evidence?.desktop_runtime_required === true) {
      result.status = 'passed'
      result.tarball_sha256 = artifact.sha256
      result.profile_storage_bytes_before = beforeBytes
      result.profile_storage_bytes_after_install = storageAfterInstall
      result.electron_cold_web_ms = appStart.durationMs
      result.lifecycle = {
        install: true,
        start: true,
        disable: 'not-applicable-foundation-bundle',
        uninstall: 'blocked-by-desktop-runtime-contract',
        restart_after_uninstall: 'not-applicable-foundation-bundle',
        manifest_unchanged_while_disabled: 'not-applicable-foundation-bundle',
      }
      return result
    }

    await writeFile(join(dataRoot, 'cordis.patch.yml'), `- id: ${plugin.evidence.patch_id}\n  disabled: true\n`)
    const dump = await runOfficial(['--profile', 'web', '--dump-config'], env, `随包只读预检停用 ${plugin.name}`)
    if (!dump.includes(`id: ${plugin.evidence.patch_id}`) || !dump.includes('disabled: true')) {
      throw new Error(`${plugin.name} 停用后只读预检没有保留 disabled patch`)
    }
    const afterDisable = await readProfile(dataRoot)
    if (afterDisable.text !== installed.text) throw new Error(`${plugin.name} 停用只读预检改写了 Profile`)
    await runPackagedApp(env, `${plugin.name} 停用后 Electron 重启`)
    await rm(join(dataRoot, 'cordis.patch.yml'), { force: true })

    await runOfficial(['plugin', '--profile', 'web', 'remove', plugin.name], env, `随包官方卸载 ${plugin.name}`)
    const removed = await readProfile(dataRoot)
    if (removed.manifest.dsh?.profile?.bundles?.includes(plugin.name)
      || Object.hasOwn(removed.manifest.dependencies || {}, plugin.name)) {
      throw new Error(`${plugin.name} 官方卸载后仍在 Profile manifest 中`)
    }
    const appAfterUninstall = await runPackagedApp(env, `${plugin.name} 卸载后 Electron 重启`)
    if (await readFile(removed.path, 'utf8') !== removed.text) {
      throw new Error(`${plugin.name} 卸载后 Electron 重启改写了 Profile`)
    }
    result.status = 'passed'
    result.tarball_sha256 = artifact.sha256
    result.profile_storage_bytes_before = beforeBytes
    result.profile_storage_bytes_after_install = storageAfterInstall
    result.electron_cold_web_ms = appStart.durationMs
    result.electron_cold_web_ms_after_uninstall = appAfterUninstall.durationMs
    result.lifecycle = {
      install: true,
      start: true,
      disable: true,
      uninstall: true,
      restart_after_uninstall: true,
      manifest_unchanged_while_disabled: true,
    }
  } catch (error) {
    result.status = 'failed'
    result.error = String(error?.message || error)
  }
  return result
}

async function main() {
  if (!existsSync(executable) || !existsSync(dshCli)) throw new Error(`随包 Electron 或 DSH CLI 不存在: ${executable}`)
  if (!existsSync(featuredArtifactManifest) || !existsSync(featuredSourceManifest)) {
    throw new Error('随包精选插件 manifest 或源码清单缺失')
  }
  const featured = JSON.parse(await readFile(featuredSourceManifest, 'utf8'))
  const artifacts = JSON.parse(await readFile(featuredArtifactManifest, 'utf8'))
  const artifactByName = new Map(artifacts.plugins.map((plugin) => [plugin.name, plugin]))
  const only = requestedOnly()
  const plugins = featured.plugins.filter((plugin) => !only || only.has(plugin.name))
  if (plugins.length === 0) throw new Error('没有匹配的精选插件')
  const measurements = []
  for (const plugin of plugins) {
    const artifact = artifactByName.get(plugin.name)
    if (!artifact) throw new Error(`随包 manifest 缺少 ${plugin.name}`)
    measurements.push(await measurePlugin(plugin, artifact, artifactByName))
    const latest = measurements.at(-1)
    console.log(`[packaged-measure] ${latest.status === 'passed' ? 'PASS' : 'FAIL'} ${plugin.name}${latest.electron_cold_web_ms ? ` electron_cold_web_ms=${latest.electron_cold_web_ms}` : ''}`)
  }
  const failures = measurements.filter((measurement) => measurement.status !== 'passed')
  const outputPath = process.env.DSH_PACKAGED_FEATURED_RESULT_FILE
    ? resolve(process.env.DSH_PACKAGED_FEATURED_RESULT_FILE)
    : null
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify({
      schema_version: 1,
      profile: featured.profile,
      app: resolve(appInput),
      evidence_level: 'packaged-electron-profile-integration',
      runtime: { platform: process.platform, arch: process.arch },
      plugins: measurements,
    }, null, 2)}\n`)
  }
  if (failures.length > 0) throw new Error(`${failures.length} 个精选插件打包版 Electron 测量失败${outputPath ? `；详情见 ${outputPath}` : ''}`)
  console.log(`[packaged-measure] PASS ${measurements.length} 个精选插件完成打包版 Electron Profile 管理边界测量（基础服务卸载受桌面契约阻止）`)
}

try {
  await main()
} finally {
  if (process.env.DSH_PACKAGED_FEATURED_KEEP_TEMP === '1') {
    console.log(`[packaged-measure] 保留临时目录用于诊断: ${tempDir}`)
  } else {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch((error) => {
      console.warn(`[packaged-measure] 临时目录清理失败(已忽略): ${error.code || error.message}`)
    })
  }
}
