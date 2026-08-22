import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  createReleaseEvidenceReceipt,
  readSignerIdentity,
  releaseEvidenceChecks,
} from '../../scripts/release-evidence-receipt.mjs'

const execFileAsync = promisify(execFile)
const ELECTRON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP_ROOT = resolve(ELECTRON_DIR, '..')

function readOption(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : fallback
}

/** Return the exact DMG produced by the current package version and target architecture. */
export function resolveDmgPath(root, version, arch, exists = existsSync) {
  const normalizedArch = String(arch || '').trim()
  if (!['arm64', 'x64'].includes(normalizedArch)) {
    throw new Error(`macOS DMG 公证架构无效：${normalizedArch || 'missing'}`)
  }
  const dmgPath = join(root, 'release', `dsh-desktop-${version}-mac-${normalizedArch}.dmg`)
  if (!exists(dmgPath)) throw new Error(`找不到当前版本的 macOS DMG：${dmgPath}`)
  return dmgPath
}

/** Extract the credential-free status and submission id returned by notarytool. */
export function parseNotaryResult(output) {
  let value
  try {
    value = JSON.parse(String(output || ''))
  } catch {
    value = {}
  }
  return Object.freeze({
    status: String(value.status || value.notarizationStatus || '').trim(),
    id: String(value.id || value.submissionId || '').trim() || null,
  })
}

function requireCredential(environment, name) {
  const value = String(environment[name] || '').trim()
  if (!value) throw new Error(`缺少 macOS 公证凭据：${name}`)
  return value
}

/** Build notarytool authentication arguments, preferring credentials stored in Keychain. */
export function resolveNotaryCredentialArgs(environment = process.env) {
  const keychainProfile = String(environment.APPLE_KEYCHAIN_PROFILE || '').trim()
  if (keychainProfile) {
    const keychain = String(environment.APPLE_KEYCHAIN || '').trim()
    return keychain
      ? ['--keychain', keychain, '--keychain-profile', keychainProfile]
      : ['--keychain-profile', keychainProfile]
  }
  return [
    '--apple-id', requireCredential(environment, 'APPLE_ID'),
    '--team-id', requireCredential(environment, 'APPLE_TEAM_ID'),
    '--password', requireCredential(environment, 'APPLE_APP_SPECIFIC_PASSWORD'),
  ]
}

async function run(label, command, args, options = {}) {
  const { timeoutMs, ...execOptions } = options
  try {
    const result = await execFileAsync(command, args, {
      cwd: APP_ROOT,
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs || 45 * 60 * 1_000,
      ...execOptions,
    })
    return String(result.stdout || '')
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim()
    throw new Error(`${label} 失败：${output.slice(-4_000) || error.message}`)
  }
}

async function writeReceipt(resultPath, receipt) {
  if (!resultPath) return
  await mkdir(dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`)
}

async function main() {
  if (process.platform !== 'darwin') throw new Error(`macOS DMG 公证只能在 darwin 执行，当前为 ${process.platform}`)
  const arch = readOption('--arch', process.arch === 'x64' ? 'x64' : 'arm64')
  const packageJson = JSON.parse(await readFile(join(APP_ROOT, 'package.json'), 'utf8'))
  const dmgPath = resolveDmgPath(APP_ROOT, packageJson.version, arch)
  const startedAt = new Date().toISOString()
  const credentialArgs = resolveNotaryCredentialArgs()
  const resultPath = String(process.env.DSH_MACOS_DMG_NOTARY_RESULT_FILE || '').trim()
    ? resolve(String(process.env.DSH_MACOS_DMG_NOTARY_RESULT_FILE).trim())
    : ''
  const tempDir = await mkdtemp(join(tmpdir(), 'dsh-macos-dmg-notary-'))
  const mountPoint = join(tempDir, 'mounted')
  let mounted = false
  try {
    const rawResult = await run('提交 macOS DMG 公证', 'xcrun', [
      'notarytool', 'submit', dmgPath,
      ...credentialArgs,
      '--wait',
      '--output-format', 'json',
    ])
    const submission = parseNotaryResult(rawResult)
    if (submission.status !== 'Accepted') {
      throw new Error(`DMG 公证未通过：${submission.status || 'unknown'}${submission.id ? ` (${submission.id})` : ''}`)
    }
    await run('附加 DMG 公证票据', 'xcrun', ['stapler', 'staple', dmgPath], { timeoutMs: 120_000 })
    await run('验证 DMG 公证票据', 'xcrun', ['stapler', 'validate', dmgPath], { timeoutMs: 120_000 })

    await mkdir(mountPoint, { recursive: true })
    await run('挂载已公证 DMG', 'hdiutil', ['attach', dmgPath, '-readonly', '-nobrowse', '-mountpoint', mountPoint], { timeoutMs: 120_000 })
    mounted = true
    const appPath = join(mountPoint, 'DSH Desktop.app')
    if (!existsSync(appPath)) throw new Error(`已公证 DMG 缺少 DSH Desktop.app：${appPath}`)
    await run('验证 DMG 载荷公证票据', 'xcrun', ['stapler', 'validate', appPath], { timeoutMs: 120_000 })
    await run('验证 DMG 载荷 Gatekeeper', 'spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath], { timeoutMs: 120_000 })
    await writeReceipt(resultPath, {
      ...createReleaseEvidenceReceipt({
        kind: 'macos-dmg-notarization',
        evidenceLevel: 'macos-dmg-notarization',
        root: APP_ROOT,
        appPath,
        dmgPath,
        featuredManifestPath: join(appPath, 'Contents', 'Resources', 'featured-plugins', 'manifest.json'),
        platform: 'darwin',
        arch,
        signerIdentity: readSignerIdentity(appPath, process.env, { allowOverride: false }),
        startedAt,
        completedAt: new Date().toISOString(),
        checks: releaseEvidenceChecks('macos-dmg-notarization')
          .map((name) => ({ name, passed: true })),
      }),
      dmg: dmgPath.replace(`${APP_ROOT}/`, ''),
      arch,
      submission_id: submission.id,
    })
    console.log(`[macos-notary] PASS ${dmgPath.split('/').pop()} DMG 票据与 App Gatekeeper 验收通过`)
  } finally {
    if (mounted) await run('卸载 DMG', 'hdiutil', ['detach', mountPoint, '-force'], { timeoutMs: 120_000 }).catch(() => {})
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main()
