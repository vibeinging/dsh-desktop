import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePackagedLayout } from './packaged-layout.mjs'
import { pathWithPackagedBin, systemOnlyPath } from './packaged-smoke-environment.mjs'

const appInput = process.argv[2] || '../release/mac-arm64/DSH Desktop.app'
const { executable, resourcesDir } = resolvePackagedLayout(appInput)
const tempDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-community-'))
const dataRoot = join(tempDir, 'data')
const userDataDir = join(tempDir, 'user-data')
const serverDir = join(resourcesDir, 'server')
const dshCli = join(serverDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpmBinDir = join(resourcesDir, 'pnpm-bin')
const featuredArtifactDir = join(resourcesDir, 'featured-plugins')
const candidate = '@linxin666/dsh-client-ui-task-board@0.1.20'
const candidateName = '@linxin666/dsh-client-ui-task-board'

function baseEnv() {
  const env = {
    ...process.env,
    HOME: join(tempDir, 'home'),
    PATH: systemOnlyPath(),
    DSH_USER_DATA_DIR: userDataDir,
    DSH_DATA_ROOT: dataRoot,
    DSH_AGENT_RUNTIME_HOME: join(tempDir, 'agent_runtime'),
    DSH_SKILLS_ROOT: join(dataRoot, 'skills'),
  }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'DB_SQLITE_PATH', 'INTERMEDIATE_DIR', 'DSH_AGENT_SESSION_DIR', 'DSH_YITRACE_DIR']) {
    delete env[key]
  }
  return env
}

function officialEnv({ offline = false } = {}) {
  return {
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
    DSH_RUNTIME_INSTALL_ANCHOR: join(serverDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    ...(offline ? { npm_config_offline: 'true', pnpm_config_offline: 'true' } : {}),
    ELECTRON_RUN_AS_NODE: '1',
  }
}

function runProcess(label, command, args, env, timeoutMs = 180_000) {
  return new Promise((resolveProcess, rejectProcess) => {
    const output = []
    const child = spawn(command, args, { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
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
      if (code === 0) resolveProcess(text)
      else rejectProcess(new Error(`${label} 失败 code=${code} signal=${signal}\n${text}`))
    })
  })
}

async function runOfficial(args, label, { offline = false } = {}) {
  if (!existsSync(dshCli)) throw new Error(`随包 DSH CLI 不存在：${dshCli}`)
  return runProcess(label, executable, [dshCli, ...args], officialEnv({ offline }), 120_000)
}

async function runPackagedApp(label, overrides = {}) {
  const text = await runProcess(label, executable, [], {
    ...baseEnv(),
    DSH_SMOKE_TEST: '1',
    DSH_SMOKE_TIMEOUT_MS: '120000',
    ...overrides,
  })
  if (!text.includes('[smoke] 官方 DSH Web 已加载')) throw new Error(`${label} 没有完成官方 Web 加载\n${text}`)
  if (!text.includes('Server 退出 code=0')) throw new Error(`${label} Server 没有正常退出\n${text}`)
  return text
}

try {
  // The App owns first-use initialization. This ordering proves a community
  // install augments an existing Profile instead of becoming its initializer.
  await runPackagedApp('首次启动')
  await runOfficial([
    'plugin', '--profile', 'web', 'add', '-w', candidate,
    '--save-exact', '--ignore-scripts',
  ], `官方安装 ${candidateName}`)

  const manifestPath = join(dataRoot, 'profiles', 'web', 'package.json')
  const installed = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!installed.dsh?.profile?.bundles?.includes(candidateName)
    || !Object.hasOwn(installed.dependencies || {}, candidateName)) {
    throw new Error(`官方安装后 Profile 未包含 ${candidateName}`)
  }

  await runPackagedApp('候选插件启动', {
    DSH_SMOKE_EXPECT_SELECTOR: '[data-dsh-taskboard-board]',
    DSH_SMOKE_CLICK_SELECTORS: JSON.stringify(['[data-dsh-taskboard-entry]']),
  })

  await runOfficial(['plugin', '--profile', 'web', 'remove', candidateName], `官方卸载 ${candidateName}`, { offline: true })
  const removed = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (removed.dsh?.profile?.bundles?.includes(candidateName)
    || Object.hasOwn(removed.dependencies || {}, candidateName)) {
    throw new Error(`官方卸载后 Profile 仍包含 ${candidateName}`)
  }

  await runPackagedApp('卸载后重启', {
    DSH_SMOKE_REJECT_SELECTOR: '[data-dsh-taskboard-entry]',
  })
  console.log(`[smoke] PASS 打包版先初始化精选 Profile，再通过官方命令安装/激活/卸载/重启 ${candidateName}`)
} finally {
  await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch((error) => {
    console.warn(`[smoke] 临时目录清理失败(已忽略): ${error.code || error.message}`)
  })
}
