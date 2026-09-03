import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
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
const { version } = JSON.parse(readFileSync(join(ELECTRON_DIR, 'package.json'), 'utf8'))
const DEFAULT_DMG = join(APP_ROOT, 'release', `dsh-desktop-${version}-mac-arm64.dmg`)
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

async function writeReceiptAtomically(path, receipt) {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
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
  if (resultPath) await rm(resultPath, { force: true })

  const tempDir = await mkdtemp(join(tmpdir(), 'dsh-macos-installer-'))
  const mountPoint = join(tempDir, 'mounted')
  const installedDir = join(tempDir, 'installed')
  const installedApp = join(installedDir, 'DSH Desktop.app')
  const startedAt = new Date().toISOString()
  let mounted = false
  let passed = false
  let receiptContext = null
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
      receiptContext = {
        installedApp,
        dmgPath,
        featuredManifestPath: join(installedLayout.resourcesDir, 'featured-plugins', 'manifest.json'),
        signerIdentity: readSignerIdentity(installedLayout.executable, process.env, { allowOverride: false }),
        screenshotRefs,
        sourceDmg: basename(dmgPath),
        copiedApp: 'DSH Desktop.app',
        communityCandidate: '@linxin666/dsh-client-ui-task-board@0.3.9',
      }
      await mkdir(dirname(resultPath), { recursive: true })
    }
    passed = true
  } finally {
    let detachError = null
    if (mounted) {
      try {
        await runProcess('卸载 DMG', '/usr/bin/hdiutil', ['detach', mountPoint, '-force'], process.env, 60_000)
      } catch (error) {
        detachError = error
      }
      mounted = false
    }
    try {
      if (detachError) {
        passed = false
        if (resultPath) await rm(resultPath, { force: true })
        throw new Error(`DMG 卸载失败，不能生成安装验收回执：${detachError.message}`)
      }
      if (!passed) {
        if (resultPath) await rm(resultPath, { force: true })
      } else {
        if (resultPath && receiptContext) {
          const receipt = {
            ...createReleaseEvidenceReceipt({
              kind: 'macos-dmg-installer',
              evidenceLevel: 'macos-dmg-installer-electron',
              root: APP_ROOT,
              appPath: receiptContext.installedApp,
              dmgPath: receiptContext.dmgPath,
              featuredManifestPath: receiptContext.featuredManifestPath,
              platform: process.platform,
              arch: process.arch,
              signerIdentity: receiptContext.signerIdentity,
              startedAt,
              completedAt: new Date().toISOString(),
              checks: ['mount', 'copy', 'install', 'activate', 'uninstall', 'restart', 'detach']
                .map((name) => ({ name, passed: true })),
              screenshotRefs: receiptContext.screenshotRefs,
            }),
            source_dmg: receiptContext.sourceDmg,
            copied_app: receiptContext.copiedApp,
            runtime: { platform: process.platform, arch: process.arch },
            community_candidate: receiptContext.communityCandidate,
            lifecycle: ['mount', 'copy', 'install', 'activate', 'uninstall', 'restart', 'detach'],
          }
          await writeReceiptAtomically(resultPath, receipt)
        }
        console.log(`[installer-smoke] PASS 从 ${basename(dmgPath)} 挂载、复制、detach 并运行签名 DSH Desktop；默认任务看板激活、官方卸载、重启和随包重装通过`)
      }
    } catch (error) {
      if (resultPath) await rm(resultPath, { force: true }).catch(() => {})
      throw error
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    }
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main()
