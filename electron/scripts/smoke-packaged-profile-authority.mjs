import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePackagedLayout } from './packaged-layout.mjs'

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

function baseEnv() {
  const env = {
    ...process.env,
    HOME: join(tempDir, 'home'),
    PATH: '/usr/bin',
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

async function runOfficialRemove(packageName) {
  if (!existsSync(dshCli)) throw new Error(`随包 DSH CLI 不存在：${dshCli}`)
  const childOutput = []
  const env = {
    ...baseEnv(),
    PATH: `${pnpmBinDir}:/usr/bin`,
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
  const child = spawn(executable, [dshCli, 'plugin', '--profile', 'web', 'remove', packageName], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => childOutput.push(chunk.toString()))
  child.stderr.on('data', (chunk) => childOutput.push(chunk.toString()))
  const result = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`官方移除 ${packageName} 超时\n${childOutput.join('')}`))
    }, 120_000)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
  if (result.code !== 0) throw new Error(`官方移除 ${packageName} 失败 code=${result.code} signal=${result.signal}\n${childOutput.join('')}`)
}

try {
  const manifestPath = join(dataRoot, 'profiles', 'web', 'package.json')
  await runPackagedApp('首次启动')
  const initial = JSON.parse(await readFile(manifestPath, 'utf8'))
  const featured = JSON.parse(await readFile(join(resourcesDir, 'server', 'src', 'engine', 'dsh_runtime', 'featured_plugins.json'), 'utf8'))
  const target = featured.plugins.find((plugin) => plugin.portability === 'portable')?.name
  if (!target || !initial.dsh?.profile?.bundles?.includes(target)) throw new Error(`没有找到可回归的精选 Bundle：${target || 'unknown'}`)

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
  console.log(`[smoke] PASS 官方卸载后重启、更新回放和精选默认输入均不恢复 ${target}`)
} finally {
  try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    console.warn(`[smoke] 临时目录清理失败(已忽略): ${error.code || error.message}`)
  }
}
