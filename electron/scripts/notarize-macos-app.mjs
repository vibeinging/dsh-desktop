import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  parseNotaryResult,
  resolveNotaryCredentialArgs,
} from './notarize-macos-dmg.mjs'

const execFileAsync = promisify(execFile)
const ELECTRON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_ROOT = resolve(ELECTRON_DIR, '..')

function readOption(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : fallback
}

export function resolveMacAppPath(root, arch, exists = existsSync) {
  const normalizedArch = String(arch || '').trim()
  if (!['arm64', 'x64'].includes(normalizedArch)) {
    throw new Error(`macOS App 公证架构无效：${normalizedArch || 'missing'}`)
  }
  const directory = normalizedArch === 'arm64' ? 'mac-arm64' : 'mac'
  const appPath = join(root, 'release', directory, 'DSH Desktop.app')
  if (!exists(appPath)) throw new Error(`找不到已签名 macOS App：${appPath}`)
  return appPath
}

async function run(label, command, args, timeoutMs = 45 * 60 * 1_000) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: APP_ROOT,
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs,
    })
    return String(result.stdout || '')
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim()
    throw new Error(`${label} 失败：${output.slice(-4_000) || error.message}`)
  }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error(`macOS App 公证只能在 darwin 执行，当前为 ${process.platform}`)
  const arch = readOption('--arch', process.arch === 'x64' ? 'x64' : 'arm64')
  const packageJson = JSON.parse(await readFile(join(APP_ROOT, 'package.json'), 'utf8'))
  const appPath = resolveMacAppPath(APP_ROOT, arch)
  const tempDir = await mkdtemp(join(tmpdir(), 'dsh-macos-app-notary-'))
  const archivePath = join(tempDir, `dsh-desktop-${packageJson.version}-mac-${arch}.zip`)
  try {
    await run('验证 Developer ID 签名', 'codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], 120_000)
    await run('压缩待公证 App', '/usr/bin/ditto', [
      '-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archivePath,
    ], 10 * 60 * 1_000)
    const rawResult = await run('提交 macOS App 公证', 'xcrun', [
      'notarytool', 'submit', archivePath,
      ...resolveNotaryCredentialArgs(),
      '--wait', '--output-format', 'json',
    ])
    const submission = parseNotaryResult(rawResult)
    if (submission.status !== 'Accepted') {
      throw new Error(`App 公证未通过：${submission.status || 'unknown'}${submission.id ? ` (${submission.id})` : ''}`)
    }
    await run('附加 App 公证票据', 'xcrun', ['stapler', 'staple', appPath], 120_000)
    await run('验证 App 公证票据', 'xcrun', ['stapler', 'validate', appPath], 120_000)
    await run('验证 App Gatekeeper', 'spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], 120_000)
    console.log(`[macos-app-notary] PASS DSH Desktop.app ${arch} Developer ID、票据和 Gatekeeper 验收通过${submission.id ? ` (${submission.id})` : ''}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main()
