import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { sha256Path } from './release-evidence-receipt.mjs'

export const RELEASE_DEVICE_EVIDENCE_VERSION = 'dsh.release.device-eval.v1'

export const RELEASE_DEVICE_CHECKS = Object.freeze([
  Object.freeze({ id: 'candidate-install', description: '从候选安装包完成安装', visual: false }),
  Object.freeze({ id: 'first-launch-official-web', description: '首次启动进入官方 Web，窗口没有白屏或错误覆盖层', visual: true }),
  Object.freeze({ id: 'live-model-roundtrip', description: '真实 DeepSeek 模型完成一轮用户消息和助手回复', visual: true }),
  Object.freeze({ id: 'image-rendering', description: '会话中的图片可见且尺寸正常', visual: true }),
  Object.freeze({ id: 'file-attachment', description: '文件选择按钮、原生面板和附件发送可用', visual: true }),
  Object.freeze({ id: 'directory-selection', description: '目录选择按钮和原生面板可用', visual: true }),
  Object.freeze({ id: 'plugin-center', description: '插件中心可查看并管理当前 Profile 插件', visual: true }),
  Object.freeze({ id: 'better-sidebar', description: 'Better Sidebar 正常加载且不与官方 Web 冲突', visual: true }),
  Object.freeze({ id: 'update-check', description: '应用更新检查给出明确的最新、可更新或错误状态', visual: true }),
  Object.freeze({ id: 'native-window-controls', description: '关闭、最小化、最大化或全屏操作正常且不遮挡界面', visual: true }),
  Object.freeze({ id: 'restart-persistence', description: '退出并重新启动后 Profile 和用户选择保持不变', visual: true }),
  Object.freeze({ id: 'uninstall-cleanup', description: '卸载流程可完成且不会误删用户 Profile', visual: false }),
])

const HASH_PATTERN = /^[0-9a-f]{64}$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const TARGETS = Object.freeze({ darwin: ['arm64', 'x64'], win32: ['x64'] })

function validTime(value) {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

function safeReference(value) {
  const text = String(value || '').replaceAll('\\', '/')
  return Boolean(text)
    && !text.startsWith('/')
    && !/^[A-Za-z]:\//.test(text)
    && !text.split('/').includes('..')
}

function artifactKind(platform) {
  return platform === 'darwin' ? 'dmg' : 'exe'
}

function expectedExtension(platform) {
  return platform === 'darwin' ? '.dmg' : '.exe'
}

function contentRecord(reference, path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`真机验收证据文件不存在：${path}`)
  return { reference, sha256: sha256Path(path), bytes: statSync(path).size }
}

function validateChecks(checks, errors) {
  if (!Array.isArray(checks)) {
    errors.push('真机验收缺少 checks')
    return
  }
  const expected = new Map(RELEASE_DEVICE_CHECKS.map((item) => [item.id, item]))
  const seen = new Set()
  for (const check of checks) {
    if (!check || typeof check !== 'object' || Array.isArray(check)) {
      errors.push('真机验收 checks 必须是对象数组')
      continue
    }
    const id = String(check.id || '')
    if (!expected.has(id)) errors.push(`真机验收包含未知检查项：${id || 'missing'}`)
    if (seen.has(id)) errors.push(`真机验收检查项重复：${id}`)
    seen.add(id)
    if (check.passed !== true) errors.push(`真机验收检查项未通过：${id || 'missing'}`)
    if (!Array.isArray(check.evidence)) {
      errors.push(`真机验收检查项缺少 evidence：${id || 'missing'}`)
      continue
    }
    if (expected.get(id)?.visual && check.evidence.length === 0) {
      errors.push(`真机验收可见检查项缺少截图：${id}`)
    }
    for (const evidence of check.evidence) {
      if (!evidence || typeof evidence !== 'object') {
        errors.push(`真机验收 evidence 无效：${id}`)
        continue
      }
      if (!safeReference(evidence.reference)) errors.push(`真机验收 evidence 引用无效：${id}`)
      if (!HASH_PATTERN.test(String(evidence.sha256 || ''))) errors.push(`真机验收 evidence 缺少 SHA-256：${id}`)
      if (!Number.isInteger(evidence.bytes) || evidence.bytes <= 0) errors.push(`真机验收 evidence 大小无效：${id}`)
    }
  }
  for (const id of expected.keys()) {
    if (!seen.has(id)) errors.push(`真机验收缺少检查项：${id}`)
  }
}

export function createReleaseDeviceEvidenceReceipt({
  root,
  artifactPath,
  platform,
  arch,
  appVersion,
  commitSha,
  operatorAlias,
  device,
  startedAt,
  completedAt,
  checks,
  repositoryDirty = false,
}) {
  const target = String(platform || '')
  const artifact = resolve(artifactPath)
  if (!TARGETS[target]?.includes(arch)) throw new Error(`不支持的真机发行目标：${target}/${arch}`)
  if (!artifact.toLowerCase().endsWith(expectedExtension(target))) {
    throw new Error(`真机验收安装包类型不匹配：${artifact}`)
  }
  if (!String(basename(artifact)).includes(String(appVersion || ''))) {
    throw new Error(`真机验收安装包文件名没有绑定版本 ${appVersion}`)
  }
  const receipt = {
    version: RELEASE_DEVICE_EVIDENCE_VERSION,
    status: 'passed',
    passed: true,
    evidence_level: 'physical-device-release-candidate',
    platform: target,
    arch: String(arch),
    app_version: String(appVersion || ''),
    git_commit_sha: String(commitSha || '').toLowerCase(),
    repository_dirty: repositoryDirty === true,
    operator_alias: String(operatorAlias || '').trim(),
    device: {
      physical_device: device?.physical_device === true,
      environment: String(device?.environment || ''),
      device_id_sha256: String(device?.device_id_sha256 || ''),
      model: String(device?.model || ''),
      os_version: String(device?.os_version || ''),
    },
    started_at: String(startedAt || ''),
    completed_at: String(completedAt || ''),
    artifact: {
      kind: artifactKind(target),
      ...contentRecord(`installer/${basename(artifact)}`, artifact),
    },
    checks,
  }
  const errors = validateReleaseDeviceEvidenceReceipt(receipt, {
    artifactPath: artifact,
    platform: target,
    arch,
    appVersion,
    commitSha,
    evidenceRoot: root,
  })
  if (errors.length > 0) throw new Error(errors.join('；'))
  return receipt
}

export function validateReleaseDeviceEvidenceReceipt(value, {
  artifactPath,
  platform,
  arch,
  appVersion,
  commitSha,
  evidenceRoot,
  verifyContent = true,
} = {}) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['真机验收回执不是对象']
  if (value.version !== RELEASE_DEVICE_EVIDENCE_VERSION) errors.push('真机验收回执版本不受支持')
  if (value.status !== 'passed' || value.passed !== true) errors.push('真机验收回执没有 passed 状态')
  if (value.evidence_level !== 'physical-device-release-candidate') errors.push('真机验收 evidence_level 无效')
  if (!TARGETS[value.platform]?.includes(value.arch)) errors.push('真机验收平台或架构无效')
  if (platform && value.platform !== platform) errors.push(`真机验收平台不匹配：${value.platform} != ${platform}`)
  if (arch && value.arch !== arch) errors.push(`真机验收架构不匹配：${value.arch} != ${arch}`)
  if (!String(value.app_version || '').trim()) errors.push('真机验收缺少 app_version')
  if (appVersion && value.app_version !== String(appVersion)) errors.push('真机验收版本与候选不一致')
  if (!COMMIT_PATTERN.test(String(value.git_commit_sha || ''))) errors.push('真机验收缺少有效 git_commit_sha')
  if (commitSha && value.git_commit_sha !== String(commitSha).toLowerCase()) errors.push('真机验收 commit 与候选不一致')
  if (value.repository_dirty !== false) errors.push('真机验收不是从干净源码候选生成')
  if (!String(value.operator_alias || '').trim()) errors.push('真机验收缺少操作人别名')
  if (value.device?.physical_device !== true || value.device?.environment !== 'local-physical-device') {
    errors.push('真机验收必须来自本地物理设备，不能使用 CI 或虚拟机回执')
  }
  for (const key of ['device_id_sha256', 'model', 'os_version']) {
    if (!String(value.device?.[key] || '').trim()) errors.push(`真机验收缺少 device.${key}`)
  }
  if (!HASH_PATTERN.test(String(value.device?.device_id_sha256 || ''))) errors.push('真机验收设备标识哈希无效')
  if (/^(unknown|unsupported)/i.test(String(value.device?.model || ''))) errors.push('真机验收没有识别出物理设备型号')
  if (!validTime(value.started_at) || !validTime(value.completed_at)) errors.push('真机验收时间无效')
  else if (Date.parse(value.completed_at) < Date.parse(value.started_at)) errors.push('真机验收完成时间早于开始时间')
  if (value.artifact?.kind !== artifactKind(value.platform)) errors.push('真机验收安装包类型无效')
  if (!safeReference(value.artifact?.reference)) errors.push('真机验收安装包引用无效')
  if (!String(value.artifact?.reference || '').toLowerCase().endsWith(expectedExtension(value.platform))) {
    errors.push('真机验收安装包引用扩展名无效')
  }
  if (value.app_version && !String(value.artifact?.reference || '').includes(value.app_version)) {
    errors.push('真机验收安装包引用没有绑定版本')
  }
  if (!HASH_PATTERN.test(String(value.artifact?.sha256 || ''))) errors.push('真机验收安装包缺少 SHA-256')
  if (!Number.isInteger(value.artifact?.bytes) || value.artifact.bytes <= 0) errors.push('真机验收安装包大小无效')
  validateChecks(value.checks, errors)

  if (verifyContent) {
    if (!artifactPath || !existsSync(artifactPath)) errors.push(`找不到待核对安装包：${artifactPath || 'missing'}`)
    else {
      if (value.artifact?.reference !== `installer/${basename(artifactPath)}`) errors.push('真机验收安装包引用与候选不一致')
      if (value.artifact?.sha256 !== sha256Path(artifactPath)) errors.push('真机验收安装包 SHA-256 与候选不一致')
      if (value.artifact?.bytes !== statSync(artifactPath).size) errors.push('真机验收安装包大小与候选不一致')
    }
    if (!evidenceRoot) errors.push('真机验收缺少 evidenceRoot')
    else {
      for (const check of value.checks || []) {
        for (const evidence of check.evidence || []) {
          const path = resolve(evidenceRoot, evidence.reference)
          const root = `${resolve(evidenceRoot)}/`
          if (!`${path}/`.startsWith(root)) errors.push(`真机验收 evidence 越出回执目录：${evidence.reference}`)
          else if (!existsSync(path)) errors.push(`真机验收 evidence 不存在：${evidence.reference}`)
          else if (evidence.sha256 !== sha256Path(path)) errors.push(`真机验收 evidence 内容已变化：${evidence.reference}`)
          else if (evidence.bytes !== statSync(path).size) errors.push(`真机验收 evidence 大小已变化：${evidence.reference}`)
        }
      }
    }
  }
  return errors
}

export function readReleaseDeviceEvidenceReceipt(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
