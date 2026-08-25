#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { hostname, release } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import {
  RELEASE_DEVICE_CHECKS,
  createReleaseDeviceEvidenceReceipt,
  readReleaseDeviceEvidenceReceipt,
  validateReleaseDeviceEvidenceReceipt,
} from '../scripts/release-device-evidence.mjs'
import { resolveCommitSha, sha256Path } from '../scripts/release-evidence-receipt.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function commandOutput(command, args, fallback) {
  try {
    return String(execFileSync(command, args, { encoding: 'utf8' })).trim() || fallback
  } catch {
    return fallback
  }
}

function deviceModel() {
  if (process.platform === 'darwin') return commandOutput('/usr/sbin/sysctl', ['-n', 'hw.model'], 'unknown-mac')
  if (process.platform === 'win32') {
    return commandOutput('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-CimInstance Win32_ComputerSystem).Model',
    ], 'unknown-windows-device')
  }
  return 'unsupported-device'
}

function deviceId() {
  return createHash('sha256').update(hostname()).digest('hex')
}

function trackedDirty() {
  try {
    return Boolean(String(execFileSync('git', [
      '-C', ROOT, 'status', '--porcelain', '--untracked-files=no',
    ], { encoding: 'utf8' })).trim())
  } catch {
    return true
  }
}

function enabledEnvironment(name) {
  const value = String(process.env[name] || '').trim().toLowerCase()
  return Boolean(value) && value !== '0' && value !== 'false'
}

function writeJsonAtomically(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function targetFromArtifact(path) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.dmg')) return 'darwin'
  if (lower.endsWith('.exe')) return 'win32'
  throw new Error(`真机 Eval 只接受 DMG 或 EXE 安装包：${path}`)
}

function usage() {
  return [
    '用法:',
    '  npm run eval:release-device -- --artifact <DMG|EXE> --operator <别名>',
    '  npm run eval:release-device:verify -- --receipt <result.json> --artifact <DMG|EXE>',
    '',
    '该流程只能在本地物理设备运行，GitHub Actions、其他 CI 和虚拟机不能生成通过回执。',
  ].join('\n')
}

function evidenceRecord(path, reference) {
  return { reference, sha256: sha256Path(path), bytes: readFileSync(path).length }
}

async function collectEvidence(input, { checkId, runDir, index }) {
  const trimmed = input.trim()
  if (!trimmed) return []
  const evidenceDir = join(runDir, 'evidence')
  mkdirSync(evidenceDir, { recursive: true })
  if (trimmed === 'capture') {
    if (process.platform !== 'darwin') throw new Error('capture 当前只支持 macOS；Windows 请填写截图文件路径')
    const destination = join(evidenceDir, `${checkId}-${index}.png`)
    execFileSync('/usr/sbin/screencapture', ['-x', destination])
    return [evidenceRecord(destination, `evidence/${basename(destination)}`)]
  }
  const sources = trimmed.split(',').map((item) => resolve(item.trim())).filter(Boolean)
  return sources.map((source, evidenceIndex) => {
    if (!existsSync(source)) throw new Error(`证据文件不存在：${source}`)
    const destination = join(evidenceDir, `${checkId}-${index}-${evidenceIndex}-${basename(source)}`)
    copyFileSync(source, destination)
    return evidenceRecord(destination, `evidence/${basename(destination)}`)
  })
}

async function verifyMode() {
  const receiptValue = arg('receipt')
  const artifactValue = arg('artifact')
  if (!receiptValue || !artifactValue) throw new Error(`--verify 需要 --receipt 和 --artifact\n${usage()}`)
  const receiptPath = resolve(receiptValue)
  const artifactPath = resolve(artifactValue)
  const value = readReleaseDeviceEvidenceReceipt(receiptPath)
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const errors = validateReleaseDeviceEvidenceReceipt(value, {
    artifactPath,
    platform: targetFromArtifact(artifactPath),
    appVersion: packageJson.version,
    commitSha: resolveCommitSha(ROOT, process.env, { requireMatch: true }),
    evidenceRoot: dirname(receiptPath),
  })
  if (errors.length > 0) throw new Error(errors.join('\n'))
  console.log(`[release-device-eval] PASS ${value.platform}/${value.arch} 物理设备回执与候选安装包一致`)
}

async function runInteractive() {
  if (enabledEnvironment('CI') || enabledEnvironment('GITHUB_ACTIONS') || enabledEnvironment('RUNNER_ENVIRONMENT')) {
    throw new Error('真机 Eval 拒绝在 CI Runner 中生成通过回执')
  }
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error(`真机 Eval 不支持 ${process.platform}`)
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('真机 Eval 需要交互终端')
  const artifactValue = arg('artifact')
  const artifactPath = resolve(artifactValue)
  if (!artifactValue || !existsSync(artifactPath)) throw new Error(`缺少候选安装包\n${usage()}`)
  if (targetFromArtifact(artifactPath) !== process.platform) {
    throw new Error(`候选安装包与当前物理设备不匹配：${artifactPath}`)
  }
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const startedAt = new Date().toISOString()
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${process.platform}-${process.arch}`
  const runDir = resolve(arg('output', join(ROOT, '.desktop-build', 'release-device-eval', runId)))
  const resultPath = join(runDir, 'result.json')
  mkdirSync(runDir, { recursive: true })

  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log(usage())
    console.log(`候选: ${artifactPath}`)
    console.log(`设备: ${hostname()} / ${deviceModel()} / ${release()}`)
    const physical = (await terminal.question('确认这是本地物理设备，不是 CI 或虚拟机（输入 yes）：')).trim()
    if (physical !== 'yes') throw new Error('未确认物理设备，停止真机 Eval')
    const operatorAlias = arg('operator') || (await terminal.question('操作人别名（不要填写邮箱或真实姓名）：')).trim()
    if (!operatorAlias) throw new Error('缺少操作人别名')
    console.log('截图不得包含 API Key、个人路径、私人会话或其他敏感信息。macOS 可输入 capture 立即截取当前屏幕。')

    const checks = []
    for (const [index, check] of RELEASE_DEVICE_CHECKS.entries()) {
      console.log(`\n[${check.id}] ${check.description}`)
      const answer = (await terminal.question('结果（输入 pass 或 fail）：')).trim()
      const passed = answer === 'pass'
      const note = (await terminal.question('简短说明：')).trim()
      const evidenceInput = await terminal.question(`证据文件${check.visual ? '（必填）' : '（可留空）'}，多个路径用逗号分隔：`)
      const evidence = await collectEvidence(evidenceInput, { checkId: check.id, runDir, index })
      if (passed && check.visual && evidence.length === 0) throw new Error(`${check.id} 缺少截图证据`)
      checks.push({ id: check.id, passed, note, evidence })
    }

    if (checks.some((check) => !check.passed)) {
      writeJsonAtomically(resultPath, {
        version: 'dsh.release.device-eval.failure.v1',
        status: 'failed',
        platform: process.platform,
        arch: process.arch,
        app_version: packageJson.version,
        git_commit_sha: resolveCommitSha(ROOT),
        artifact: { reference: basename(artifactPath), sha256: sha256Path(artifactPath) },
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        checks,
      })
      throw new Error(`真机 Eval 未通过，失败记录已保存：${resultPath}`)
    }

    const receipt = createReleaseDeviceEvidenceReceipt({
      root: runDir,
      artifactPath,
      platform: process.platform,
      arch: process.arch,
      appVersion: packageJson.version,
      commitSha: resolveCommitSha(ROOT, process.env, { requireMatch: true }),
      operatorAlias,
      device: {
        physical_device: true,
        environment: 'local-physical-device',
        device_id_sha256: deviceId(),
        model: deviceModel(),
        os_version: release(),
      },
      startedAt,
      completedAt: new Date().toISOString(),
      checks,
      repositoryDirty: trackedDirty(),
    })
    writeJsonAtomically(resultPath, receipt)
    console.log(`[release-device-eval] PASS 回执：${resultPath}`)
  } finally {
    terminal.close()
  }
}

if (hasFlag('help')) console.log(usage())
else if (hasFlag('verify')) await verifyMode()
else await runInteractive()
