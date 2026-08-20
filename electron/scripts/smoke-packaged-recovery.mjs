import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePackagedLayout } from './packaged-layout.mjs'

const appInput = process.argv[2] || '../release/mac-arm64/DSH Desktop.app'
const { executable } = resolvePackagedLayout(appInput)
const tempDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-recovery-'))
const dataRoot = join(tempDir, 'data')
const profileDir = join(dataRoot, 'profiles', 'web')
const brokenPackage = '@test/dsh-broken-client'
const brokenPackageDir = join(profileDir, 'node_modules', '@test', 'dsh-broken-client')
const output = []
let child

try {
  await mkdir(brokenPackageDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: { [brokenPackage]: 'file:../../broken-client' },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', brokenPackage],
      },
    },
  }, null, 2)}\n`)
  await writeFile(join(profileDir, 'cordis.patch.yml'), '# untouched user layer\n[]\n')
  await writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  await writeFile(join(brokenPackageDir, 'package.json'), JSON.stringify({
    name: brokenPackage,
    version: '1.0.0',
    type: 'module',
    main: './index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2))
  await writeFile(join(brokenPackageDir, 'index.js'), 'export default {}\n')
  await writeFile(join(brokenPackageDir, 'cordis.patch.yml'), '- insert: [\n')
  const originalProfile = await readFile(join(profileDir, 'package.json'), 'utf8')

  const env = {
    ...process.env,
    HOME: join(tempDir, 'home'),
    PATH: '/usr/bin',
    DSH_SMOKE_TEST: '1',
    DSH_SMOKE_EXPECT_RECOVERY: '1',
    DSH_SMOKE_TIMEOUT_MS: '120000',
    DSH_USER_DATA_DIR: join(tempDir, 'user-data'),
    DSH_DATA_ROOT: dataRoot,
    DSH_AGENT_RUNTIME_HOME: join(tempDir, 'agent_runtime'),
    DSH_SKILLS_ROOT: join(dataRoot, 'skills'),
  }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'DB_SQLITE_PATH', 'INTERMEDIATE_DIR', 'DSH_AGENT_SESSION_DIR', 'DSH_YITRACE_DIR']) {
    delete env[key]
  }
  child = spawn(executable, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => output.push(chunk.toString()))
  child.stderr.on('data', (chunk) => output.push(chunk.toString()))
  const result = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`损坏 Bundle 恢复 smoke 超时\n${output.join('')}`))
    }, 150_000)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
  const text = output.join('')
  if (result.code !== 0) throw new Error(`恢复 smoke 退出失败 code=${result.code} signal=${result.signal}\n${text}`)
  if (!text.includes('[smoke] 恢复页已加载')) throw new Error(`没有真实加载恢复页\n${text}`)
  const recoveryStatePath = join(tempDir, 'user-data', 'runtime-recovery.json')
  if (!existsSync(recoveryStatePath)) throw new Error('恢复状态文件没有写入')
  const recoveryState = JSON.parse(await readFile(recoveryStatePath, 'utf8'))
  if (recoveryState.status !== 'failed' || !recoveryState.last_failure?.stage) {
    throw new Error(`恢复状态不完整：${JSON.stringify(recoveryState)}`)
  }
  if (await readFile(join(profileDir, 'package.json'), 'utf8') !== originalProfile) {
    throw new Error('恢复流程改写了原 Profile')
  }
  console.log(`[smoke] PASS 损坏 Bundle 进入真实恢复页并保留原 Profile (${brokenPackage})`)
} finally {
  try { child?.kill() } catch { /* ignore */ }
  try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    console.warn(`[smoke] 临时目录清理失败(已忽略): ${error.code || error.message}`)
  }
}
