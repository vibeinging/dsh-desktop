import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePackagedLayout } from './packaged-layout.mjs'

const appInput = process.argv[2] || '../release/mac-arm64/DSH Desktop.app'
const { executable, resourcesDir } = resolvePackagedLayout(appInput)
const tempDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-offline-'))
const dataRoot = join(tempDir, 'data')
const output = []
let child
const startedAt = performance.now()
let officialWebAt = null

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function directoryBytes(path) {
  if (!existsSync(path)) return 0
  const info = await lstat(path)
  if (!info.isDirectory()) return info.size
  let bytes = 0
  for (const name of await readdir(path)) bytes += await directoryBytes(join(path, name))
  return bytes
}

try {
  const env = {
    ...process.env,
    HOME: join(tempDir, 'home'),
    PATH: '/usr/bin',
    DSH_SMOKE_TEST: '1',
    DSH_SMOKE_TIMEOUT_MS: '120000',
    DSH_USER_DATA_DIR: join(tempDir, 'user-data'),
    DSH_DATA_ROOT: dataRoot,
    DSH_AGENT_RUNTIME_HOME: join(tempDir, 'agent_runtime'),
    DSH_SKILLS_ROOT: join(dataRoot, 'skills'),
    npm_config_offline: 'true',
    pnpm_config_offline: 'true',
  }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'DB_SQLITE_PATH', 'INTERMEDIATE_DIR', 'DSH_AGENT_SESSION_DIR', 'DSH_YITRACE_DIR']) {
    delete env[key]
  }
  child = spawn(executable, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const collect = (chunk) => {
    const text = chunk.toString()
    output.push(text)
    if (officialWebAt === null && text.includes('[smoke] 官方 DSH Web 已加载')) officialWebAt = performance.now()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const result = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`断网随包 App smoke 超时\n${output.join('')}`))
    }, 150_000)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
  const text = output.join('')
  if (result.code !== 0) throw new Error(`断网随包 App 退出失败 code=${result.code} signal=${result.signal}\n${text}`)
  if (!text.includes('[smoke] 官方 DSH Web 已加载')) throw new Error(`断网随包 App 没有加载官方 Web\n${text}`)
  if (!text.includes('Server 退出 code=0')) throw new Error(`断网随包 Server 没有正常退出\n${text}`)

  const manifestPath = join(dataRoot, 'profiles', 'web', 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const featured = JSON.parse(await readFile(join(resourcesDir, 'server', 'src', 'engine', 'dsh_runtime', 'featured_plugins.json'), 'utf8'))
  const expected = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...featured.plugins.map((plugin) => plugin.name)]
  if (JSON.stringify(manifest.dsh?.profile?.bundles) !== JSON.stringify(expected)) {
    throw new Error(`断网新 Profile Bundle 图不完整：${JSON.stringify(manifest.dsh?.profile?.bundles)}`)
  }
  for (const name of featured.plugins.map((plugin) => plugin.name)) {
    if (typeof manifest.dependencies?.[name] !== 'string') throw new Error(`断网新 Profile 缺少依赖：${name}`)
  }
  const libraryRoot = join(dataRoot, 'plugin-library', 'tarballs')
  const tarballs = (await readdir(libraryRoot)).filter((name) => name.endsWith('.tgz')).sort()
  if (tarballs.length !== featured.plugins.length) throw new Error(`稳定插件库 tarball 数量错误：${tarballs.length}`)
  const artifactRoot = join(resourcesDir, 'featured-plugins')
  const artifactManifest = JSON.parse(await readFile(join(artifactRoot, 'manifest.json'), 'utf8'))
  for (const plugin of artifactManifest.plugins) {
    const tarball = await readFile(join(libraryRoot, plugin.tarball))
    if (sha256(tarball) !== plugin.sha256) throw new Error(`稳定插件库哈希错误：${plugin.name}`)
  }
  const storageBytes = await directoryBytes(dataRoot)
  const coldWebMs = officialWebAt === null ? null : Math.round(officialWebAt - startedAt)
  console.log(`[smoke] PASS 断网新用户 Profile 初始化、固定 tarball 和稳定插件库 (${tarballs.length} 个 Bundle); cold_web_ms=${coldWebMs}; profile_storage_bytes=${storageBytes}`)
  const resultPath = String(process.env.DSH_SMOKE_RESULT_FILE || '').trim()
  if (resultPath) {
    await writeFile(resultPath, `${JSON.stringify({ cold_web_ms: coldWebMs, profile_storage_bytes: storageBytes, tarballs: tarballs.length })}\n`)
  }
} finally {
  try { child?.kill() } catch { /* ignore */ }
  try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    console.warn(`[smoke] 临时目录清理失败(已忽略): ${error.code || error.message}`)
  }
}
