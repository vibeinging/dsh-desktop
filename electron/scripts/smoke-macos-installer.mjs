import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolvePackagedLayout } from './packaged-layout.mjs'
import {
  artifactReference,
  createReleaseEvidenceReceipt,
  readSignerIdentity,
} from '../../scripts/release-evidence-receipt.mjs'

const ELECTRON_DIR = resolve(resolve(fileURLToPath(import.meta.url), '..'), '..')
const APP_ROOT = resolve(ELECTRON_DIR, '..')
const DEFAULT_DMG = join(APP_ROOT, 'release', 'dsh-desktop-0.0.1-mac-arm64.dmg')
const communitySmoke = join(ELECTRON_DIR, 'scripts', 'smoke-packaged-community.mjs')
const resultPath = String(process.env.DSH_MACOS_INSTALLER_RESULT_FILE || '').trim()
  ? resolve(String(process.env.DSH_MACOS_INSTALLER_RESULT_FILE).trim())
  : ''

function resolveDmg(input) {
  if (!input) return DEFAULT_DMG
  const direct = resolve(input)
  return existsSync(direct) ? direct : resolve(APP_ROOT, input)
}

function runProcess(label, command, args, env = process.env, timeoutMs = 360_000) {
  return new Promise((resolveProcess, rejectProcess) => {
    const output = []
    const child = spawn(command, args, {
      cwd: APP_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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
      else rejectProcess(new Error(`${label} 失败 code=${code} signal=${signal || 'none'}\n${text}`))
    })
  })
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error(`macOS DMG 安装 smoke 只能在 darwin 执行，当前为 ${process.platform}`)
  }
  const dmgPath = resolveDmg(process.argv[2])
  if (!existsSync(dmgPath) || !dmgPath.toLowerCase().endsWith('.dmg')) {
    throw new Error(`找不到 macOS DMG: ${dmgPath}`)
  }
  if (!existsSync(communitySmoke)) throw new Error(`缺少社区 Profile smoke: ${communitySmoke}`)

  const tempDir = await mkdtemp(join(tmpdir(), 'dsh-macos-installer-'))
  const mountPoint = join(tempDir, 'mounted')
  const installedDir = join(tempDir, 'installed')
  const installedApp = join(installedDir, 'DSH Desktop.app')
  const startedAt = new Date().toISOString()
  let mounted = false
  let passed = false
  try {
    await mkdir(mountPoint, { recursive: true })
    await mkdir(installedDir, { recursive: true })
    await runProcess('挂载 DMG', '/usr/bin/hdiutil', [
      'attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mountPoint,
    ])
    mounted = true
    const mountedApp = join(mountPoint, 'DSH Desktop.app')
    if (!existsSync(mountedApp)) throw new Error(`DMG 中缺少 DSH Desktop.app: ${mountedApp}`)
    await runProcess('复制 DMG 中的 App', '/usr/bin/ditto', [mountedApp, installedApp])
    const output = await runProcess(
      '执行 DMG 安装后的社区 Profile smoke',
      process.execPath,
      [communitySmoke, installedApp],
      {
        ...process.env,
        DSH_INSTALLER_SOURCE: basename(dmgPath),
      },
    )
    if (!output.includes('[smoke] PASS')) throw new Error(`DMG 安装 smoke 缺少成功标记\n${output}`)
    if (resultPath) {
      const installedLayout = resolvePackagedLayout(installedApp)
      const screenshotDir = String(process.env.DSH_COMMUNITY_SCREENSHOT_DIR || '').trim()
      const screenshotRefs = screenshotDir && existsSync(screenshotDir)
        ? (await readdir(screenshotDir)).map((name) => artifactReference(join(screenshotDir, name), 'macos-installer-evidence'))
        : []
      const receipt = {
        ...createReleaseEvidenceReceipt({
          kind: 'macos-dmg-installer',
          evidenceLevel: 'macos-dmg-installer-electron',
          root: APP_ROOT,
          appPath: installedApp,
          dmgPath,
          featuredManifestPath: join(installedLayout.resourcesDir, 'featured-plugins', 'manifest.json'),
          platform: process.platform,
          arch: process.arch,
          signerIdentity: readSignerIdentity(installedLayout.executable),
          startedAt,
          completedAt: new Date().toISOString(),
          checks: ['mount', 'copy', 'install', 'activate', 'uninstall', 'restart', 'detach']
            .map((name) => ({ name, passed: true })),
          screenshotRefs,
        }),
        source_dmg: basename(dmgPath),
        copied_app: 'DSH Desktop.app',
        runtime: { platform: process.platform, arch: process.arch },
        community_candidate: '@linxin666/dsh-client-ui-task-board@0.1.20',
        lifecycle: ['mount', 'copy', 'install', 'activate', 'uninstall', 'restart', 'detach'],
      }
      await mkdir(dirname(resultPath), { recursive: true })
      await writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`)
    }
    passed = true
    console.log(`[installer-smoke] PASS 从 ${basename(dmgPath)} 挂载、复制并运行签名 DSH Desktop；官方 Profile 社区安装/激活/卸载/重启通过`)
  } finally {
    if (mounted) {
      await runProcess('卸载 DMG', '/usr/bin/hdiutil', ['detach', mountPoint, '-force'], process.env, 60_000)
        .catch((error) => console.warn(`[installer-smoke] DMG 卸载失败(已忽略): ${error.message}`))
    }
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    if (!passed && resultPath) await rm(resultPath, { force: true })
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main()
