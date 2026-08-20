import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolvePackagedLayout } from './packaged-layout.mjs'
import { pathWithPackagedBin, systemOnlyPath } from './packaged-smoke-environment.mjs'

const appInput = process.argv[2] || '../release/mac-arm64/DSH Desktop.app'
const { executable, resourcesDir } = resolvePackagedLayout(appInput)
const tempDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-profile-authority-'))
const dataRoot = join(tempDir, 'data')
const userDataDir = join(tempDir, 'user-data')

const serverDir = join(resourcesDir, 'server')
const dshCli = join(serverDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpmBinDir = join(resourcesDir, 'pnpm-bin')
const featuredArtifactDir = join(resourcesDir, 'featured-plugins')
const appVersion = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')).version
const execFileAsync = promisify(execFile)

function baseEnv() {
  const env = {
    ...process.env,
    HOME: join(tempDir, 'home'),
    PATH: systemOnlyPath(),
    DSH_USER_DATA_DIR: userDataDir,
    DSH_DATA_ROOT: dataRoot,
    DSH_AGENT_RUNTIME_HOME: join(tempDir, 'agent_runtime'),
    DSH_SKILLS_ROOT: join(dataRoot, 'skills'),
    npm_config_offline: 'true',
    pnpm_config_offline: 'true',
  }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'DB_SQLITE_PATH', 'INTERMEDIATE_DIR', 'DSH_AGENT_SESSION_DIR', 'DSH_YITRACE_DIR']) {
    delete env[key]
  }
  return env
}

async function runPackagedApp(label) {
  const childOutput = []
  const child = spawn(executable, [], {
    env: { ...baseEnv(), DSH_SMOKE_TEST: '1', DSH_SMOKE_TIMEOUT_MS: '120000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => childOutput.push(chunk.toString()))
  child.stderr.on('data', (chunk) => childOutput.push(chunk.toString()))
  const result = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${label} 超时\n${childOutput.join('')}`))
    }, 150_000)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
  const text = childOutput.join('')
  if (result.code !== 0) throw new Error(`${label} 退出失败 code=${result.code} signal=${result.signal}\n${text}`)
  if (!text.includes('[smoke] 官方 DSH Web 已加载')) throw new Error(`${label} 没有加载官方 Web\n${text}`)
  if (!text.includes('Server 退出 code=0')) throw new Error(`${label} Server 没有正常退出\n${text}`)
}

async function runOfficial(args, label) {
  if (!existsSync(dshCli)) throw new Error(`随包 DSH CLI 不存在：${dshCli}`)
  const childOutput = []
  const env = {
    ...baseEnv(),
    PATH: pathWithPackagedBin(pnpmBinDir),
    DSH_HOME: dataRoot,
    DSH_RUNTIME_DISTRIBUTION: 'npm',
    DSH_RUNTIME_HOME: dataRoot,
    DSH_PROFILE_PLUGIN_LIBRARY: join(dataRoot, 'plugin-library'),
    DSH_FEATURED_PLUGIN_TARBALL_DIR: featuredArtifactDir,
    DSH_FEATURED_PLUGIN_MANIFEST: join(featuredArtifactDir, 'manifest.json'),
    DSH_PNPM_BIN_DIR: pnpmBinDir,
    DSH_PNPM_NODE_BIN: executable,
    pnpm_config_store_dir: join(dataRoot, 'plugin-library', 'store'),
    npm_config_store_dir: join(dataRoot, 'plugin-library', 'store'),
    pnpm_config_auto_install_peers: 'false',
    npm_config_auto_install_peers: 'false',
    DSH_PNPM_REQUIRED: '1',
    ELECTRON_RUN_AS_NODE: '1',
    DSH_RUNTIME_INSTALL_ANCHOR: join(serverDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
  }
  const child = spawn(executable, [dshCli, ...args], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => childOutput.push(chunk.toString()))
  child.stderr.on('data', (chunk) => childOutput.push(chunk.toString()))
  const result = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${label} 超时\n${childOutput.join('')}`))
    }, 120_000)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
  if (result.code !== 0) throw new Error(`${label} 失败 code=${result.code} signal=${result.signal}\n${childOutput.join('')}`)
  return childOutput.join('')
}

async function runOfficialRemove(packageName) {
  await runOfficial(['plugin', '--profile', 'web', 'remove', packageName], `官方移除 ${packageName}`)
}

try {
  const manifestPath = join(dataRoot, 'profiles', 'web', 'package.json')
  await runPackagedApp('首次启动')
  const initialText = await readFile(manifestPath, 'utf8')
  const initial = JSON.parse(initialText)
  const featured = JSON.parse(await readFile(join(resourcesDir, 'server', 'src', 'engine', 'dsh_runtime', 'featured_plugins.json'), 'utf8'))
  const targetPlugin = featured.plugins.find((plugin) => plugin.portability === 'portable')
  const target = targetPlugin?.name
  if (!target || !initial.dsh?.profile?.bundles?.includes(target)) throw new Error(`没有找到可回归的精选 Bundle：${target || 'unknown'}`)

  const artifacts = JSON.parse(await readFile(join(featuredArtifactDir, 'manifest.json'), 'utf8'))
  const targetArtifact = artifacts.plugins.find((plugin) => plugin.name === target)
  if (!targetArtifact?.tarball) throw new Error(`没有找到 ${target} 的固定 tarball 记录`)
  const targetTarballPath = join(featuredArtifactDir, targetArtifact.tarball)
  const { stdout: targetPatch } = await execFileAsync('tar', [
    '-xOf', targetTarballPath, 'package/cordis.patch.yml',
  ], { maxBuffer: 1024 * 1024 })
  const targetPatchId = targetPatch.match(/^\s*-?\s*id:\s*([^\s#]+)\s*$/m)?.[1]
  if (!targetPatchId) throw new Error(`无法解析 ${target} 的 Bundle patch id：${targetTarballPath}`)
  const homePatchPath = join(dataRoot, 'cordis.patch.yml')
  await writeFile(homePatchPath, `- id: ${targetPatchId}\n  disabled: true\n`)
  const disabledDump = await runOfficial(['--profile', 'web', '--dump-config'], '停用 Bundle 的官方只读预检')
  if (!disabledDump.includes(`id: ${targetPatchId}`) || !disabledDump.includes('disabled: true')) {
    throw new Error(`官方 dump-config 没有保留用户停用的 ${targetPatchId}`)
  }
  const afterDisable = await readFile(manifestPath, 'utf8')
  if (afterDisable !== initialText) {
    throw new Error('停用只读预检改写了已有 Profile')
  }
  await runPackagedApp('用户停用后重启')
  if (await readFile(manifestPath, 'utf8') !== afterDisable) throw new Error('用户停用后重启恢复或改写了 Profile')

  const disabledUpdatePath = join(userDataDir, 'pending-app-update.json')
  await writeFile(disabledUpdatePath, `${JSON.stringify({
    schemaVersion: 1,
    fromVersion: appVersion,
    toVersion: appVersion,
    requestedAt: new Date().toISOString(),
    preservedPaths: [userDataDir, dataRoot],
  }, null, 2)}\n`)
  await runPackagedApp('用户停用后更新回放')
  if (await readFile(manifestPath, 'utf8') !== afterDisable) throw new Error('应用更新恢复或改写了用户停用的 Profile')
  await rm(homePatchPath, { force: true })

  await runOfficialRemove(target)
  const afterRemove = await readFile(manifestPath, 'utf8')
  const removed = JSON.parse(afterRemove)
  if (removed.dsh.profile.bundles.includes(target) || Object.hasOwn(removed.dependencies || {}, target)) {
    throw new Error(`官方移除后 Profile 仍包含 ${target}`)
  }

  const pendingPath = join(userDataDir, 'pending-app-update.json')
  await writeFile(pendingPath, `${JSON.stringify({
    schemaVersion: 1,
    fromVersion: appVersion,
    toVersion: appVersion,
    requestedAt: new Date().toISOString(),
    preservedPaths: [userDataDir, dataRoot],
  }, null, 2)}\n`)
  await runPackagedApp('更新后重启回放')
  if (await readFile(manifestPath, 'utf8') !== afterRemove) throw new Error('更新后重启恢复了已卸载的 Bundle 或改写了 Profile')
  console.log(`[smoke] PASS 用户停用后重启/更新、官方卸载后重启/更新和精选默认输入均不恢复 ${target}`)
} finally {
  try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    console.warn(`[smoke] 临时目录清理失败(已忽略): ${error.code || error.message}`)
  }
}
