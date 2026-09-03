import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WINDOWS_ACCEPTANCE_CHECKS,
  createWindowsAcceptanceReceipt,
} from '../../scripts/windows-acceptance-receipt.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ELECTRON_DIR = resolve(SCRIPT_DIR, '..')
const APP_DIR = resolve(ELECTRON_DIR, '..')
const RELEASE_DIR = join(APP_DIR, 'release')
const RECEIPT_PATH = join(RELEASE_DIR, 'windows-x64-acceptance.json')
const DEFAULT_UNPACKED_APP = join(RELEASE_DIR, 'win-unpacked')
const configuredTimeoutMs = Number(process.env.DSH_WINDOWS_ACCEPTANCE_TIMEOUT_MS)
const DEFAULT_TIMEOUT_MS = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
  ? configuredTimeoutMs
  : 600_000

function argumentValue(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function repoRelative(path) {
  return relative(APP_DIR, path).split(sep).join('/')
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function resolveInputPath(input) {
  if (!input) return null
  if (input.startsWith('/') || /^[A-Za-z]:[\\/]/.test(input)) return resolve(input)
  const fromCwd = resolve(process.cwd(), input)
  return existsSync(fromCwd) ? fromCwd : resolve(APP_DIR, input)
}

async function findInstaller(input) {
  if (input) {
    const installer = resolveInputPath(input)
    if (!existsSync(installer) || extname(installer).toLowerCase() !== '.exe') {
      throw new Error(`找不到 Windows NSIS 安装器: ${installer}`)
    }
    return installer
  }
  const names = (await readdir(RELEASE_DIR))
    .filter((name) => extname(name).toLowerCase() === '.exe')
    .filter((name) => !/^(uninstall|elevate|squirrel)/i.test(name))
    .sort()
  if (names.length !== 1) {
    throw new Error(`无法唯一确定 Windows NSIS 安装器，请传入 --installer；候选: ${names.join(', ') || '无'}`)
  }
  return join(RELEASE_DIR, names[0])
}

function runProcess(command, args, { cwd = ELECTRON_DIR, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    const output = []
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => output.push(chunk.toString()))
    child.stderr.on('data', (chunk) => output.push(chunk.toString()))
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* 子进程可能已经退出。 */ }
      reject(new Error(`${basename(command)} ${args.join(' ')} 超时(${timeoutMs}ms)\n${output.join('')}`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      const text = output.join('')
      if (code !== 0) {
        reject(new Error(`${basename(command)} ${args.join(' ')} 失败 code=${code} signal=${signal || 'none'}\n${text}`))
        return
      }
      resolvePromise(text)
    })
  })
}

async function waitForPath(path, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(`${label} 超时: ${path}`)
}

async function waitForGone(paths, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (paths.every((path) => !existsSync(path))) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(`${label} 超时: ${paths.filter((path) => existsSync(path)).join(', ')}`)
}

async function runNodeSmoke(scriptName, appPath, label, extraArgs = [], extraEnv = {}) {
  return runProcess(process.execPath, [join(SCRIPT_DIR, scriptName), appPath, ...extraArgs], {
    env: {
      ...process.env,
      DSH_SMOKE_TIMEOUT_MS: process.env.DSH_SMOKE_TIMEOUT_MS || '180000',
      ...extraEnv,
    },
  }).then((output) => {
    console.log(`[windows-acceptance] ${label}\n${output.trim()}`)
    return output
  })
}

async function runChecked(name, checks, action) {
  const started = performance.now()
  try {
    await action()
    checks.push({ name, passed: true, duration_ms: Math.round(performance.now() - started) })
  } catch (error) {
    checks.push({ name, passed: false, duration_ms: Math.round(performance.now() - started), error: errorText(error) })
    throw error
  }
}

async function locateUninstaller(installDir) {
  const names = (await readdir(installDir))
    .filter((name) => extname(name).toLowerCase() === '.exe')
    .filter((name) => /^uninstall/i.test(name))
  if (names.length !== 1) {
    throw new Error(`无法唯一确定已安装程序的卸载器: ${names.join(', ') || '无'}`)
  }
  return join(installDir, names[0])
}

export async function runWindowsAcceptance({
  installerPath = argumentValue('installer'),
  unpackedAppPath = argumentValue('unpacked', DEFAULT_UNPACKED_APP),
} = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(`Windows x64 自动验收必须在 Windows x64 运行环境执行，当前为 ${process.platform}/${process.arch}`)
  }
  const installer = await findInstaller(installerPath)
  const unpackedApp = resolve(ELECTRON_DIR, unpackedAppPath)
  if (!existsSync(unpackedApp)) throw new Error(`找不到 win-unpacked 目录: ${unpackedApp}`)
  const startedAt = new Date().toISOString()
  const checks = []
  const acceptanceRoot = await mkdtemp(join(tmpdir(), 'dsh-windows-acceptance-'))
  const installDir = join(acceptanceRoot, 'installed')
  const dataRoot = join(acceptanceRoot, 'dsh-data')
  const profileManifest = join(dataRoot, 'profiles', 'web', 'package.json')
  const installedExecutable = join(installDir, 'DSH Desktop.exe')
  const installedResources = join(installDir, 'resources')
  const temporaryReceipt = `${RECEIPT_PATH}.tmp-${process.pid}`
  let passed = false

  try {
    await rm(RECEIPT_PATH, { force: true })
    await mkdir(installDir, { recursive: true })

    await runChecked('installer-custom-directory', checks, async () => {
      await runProcess(installer, ['/S', `/D=${installDir}`])
      await waitForPath(installedExecutable, 'NSIS 安装后的主程序')
      await waitForPath(installedResources, 'NSIS 安装后的 resources')
    })
    await runChecked('installed-server-smoke', checks, () => runNodeSmoke('smoke-packaged-server.mjs', installDir, '随安装程序 Server smoke 通过'))
    await runChecked('installed-app-smoke', checks, () => runNodeSmoke(
      'smoke-packaged-app.mjs',
      installDir,
      '随安装程序 App smoke 通过',
      [],
      { DSH_SMOKE_DATA_ROOT: dataRoot },
    ))
    await runChecked('installed-data-root-separation', checks, async () => {
      await waitForPath(profileManifest, '安装目录之外的 DSH Profile')
    })
    await runChecked('installed-official-web-permission-smoke', checks, () => runNodeSmoke(
      'smoke-packaged-official-web-flow.mjs',
      installDir,
      '随安装程序官方 Web 问题、沙箱、审批和队列 smoke 通过',
      ['--fake-model'],
    ))
    await runChecked('installed-offline-profile-smoke', checks, () => runNodeSmoke('smoke-packaged-offline.mjs', installDir, '随安装程序断网 Profile smoke 通过'))
    await runChecked('installed-recovery-smoke', checks, () => runNodeSmoke('smoke-packaged-recovery.mjs', installDir, '随安装程序恢复 smoke 通过'))
    await runChecked('installed-profile-authority-smoke', checks, () => runNodeSmoke('smoke-packaged-profile-authority.mjs', installDir, '随安装程序 Profile authority smoke 通过'))

    const uninstaller = await locateUninstaller(installDir)
    await runChecked('uninstaller', checks, async () => {
      await runProcess(uninstaller, ['/S'])
      await waitForGone([installedExecutable, installedResources, uninstaller], 'NSIS 卸载后的文件')
    })
    await runChecked('dsh-data-preserved-after-uninstall', checks, async () => {
      await waitForPath(profileManifest, '卸载后保留的 DSH Profile', 30_000)
    })
    await runChecked('cleanup', checks, async () => {
      await rm(acceptanceRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
      await waitForGone([acceptanceRoot], 'Windows 验收临时目录清理', 30_000)
    })

    const receipt = createWindowsAcceptanceReceipt({
      installer: repoRelative(installer),
      unpackedApp: repoRelative(unpackedApp),
      checks,
      startedAt,
      completedAt: new Date().toISOString(),
    })
    await writeFile(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`)
    await rename(temporaryReceipt, RECEIPT_PATH)
    passed = true
    console.log(`[windows-acceptance] PASS Windows x64 自定义目录安装、运行、独立 DSH 数据、断网 Profile、恢复、权限边界、卸载保留和清理；回执=${RECEIPT_PATH}`)
    return receipt
  } finally {
    if (!passed) {
      await rm(RECEIPT_PATH, { force: true })
    }
    await rm(temporaryReceipt, { force: true })
    await rm(acceptanceRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }).catch((error) => {
      console.warn(`[windows-acceptance] 临时目录清理失败(已忽略): ${error.code || error.message}`)
    })
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    await runWindowsAcceptance()
  } catch (error) {
    console.error(`[windows-acceptance] BLOCK ${errorText(error)}`)
    process.exitCode = 1
  }
}

if (WINDOWS_ACCEPTANCE_CHECKS.length !== 11) {
  throw new Error('Windows 验收项数量发生漂移，请同步回执校验和验收脚本')
}
