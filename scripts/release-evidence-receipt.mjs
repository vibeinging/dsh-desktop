import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'

export const RELEASE_EVIDENCE_RECEIPT_VERSION = 'dsh.release.evidence.v2'
export const RELEASE_EVIDENCE_SOURCE_MANIFEST = 'server/src/engine/dsh_runtime/featured_plugins.json'
export const RELEASE_EVIDENCE_KINDS = Object.freeze([
  'live-model',
  'macos-dmg-notarization',
  'macos-dmg-installer',
  'native-host',
])

/** The fixed evidence contract for each release receipt kind. */
export const RELEASE_EVIDENCE_CONTRACTS = Object.freeze({
  'live-model': Object.freeze({
    evidenceLevel: 'packaged-electron-live-model',
    requiredChecks: Object.freeze([
      'official-web-launch',
      'session-create',
      'session-history',
      'provider-success',
      'model-response-success',
    ]),
    allowedArtifacts: Object.freeze(['app']),
  }),
  'macos-dmg-notarization': Object.freeze({
    evidenceLevel: 'macos-dmg-notarization',
    requiredChecks: Object.freeze([
      'notarytool-accepted',
      'dmg-stapled',
      'dmg-stapler-validate',
      'payload-stapler-validate',
      'payload-gatekeeper-execute',
    ]),
    allowedArtifacts: Object.freeze(['app', 'dmg']),
  }),
  'macos-dmg-installer': Object.freeze({
    evidenceLevel: 'macos-dmg-installer-electron',
    requiredChecks: Object.freeze([
      'mount',
      'copy',
      'install',
      'activate',
      'uninstall',
      'restart',
      'detach',
    ]),
    allowedArtifacts: Object.freeze(['app', 'dmg']),
  }),
  'native-host': Object.freeze({
    evidenceLevel: 'packaged-electron-native-host',
    modeChecks: Object.freeze({
      window: Object.freeze([
        'profile-install',
        'official-web-tool',
        'session-bound-window-get-state',
        'focus',
        'minimize',
        'maximize',
        'restore',
        'profile-uninstall',
      ]),
      dialogs: Object.freeze([
        'profile-install',
        'official-web-tool',
        'session-bound-file-dialog-open',
        'session-bound-directory-dialog-open',
        'profile-uninstall',
      ]),
    }),
    allowedChecks: Object.freeze([
      'profile-install',
      'official-web-tool',
      'session-bound-window-get-state',
      'session-bound-file-dialog-open',
      'session-bound-directory-dialog-open',
      'focus',
      'minimize',
      'maximize',
      'restore',
      'profile-uninstall',
    ]),
    allowedArtifacts: Object.freeze(['app']),
  }),
})

const HASH_PATTERN = /^[0-9a-f]{64}$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i

function hashPathInto(hash, path, entry = '.') {
  const info = lstatSync(path)
  if (info.isSymbolicLink()) {
    hash.update(`link\0${entry}\0${readlinkSync(path)}\n`)
    return
  }
  if (info.isDirectory()) {
    hash.update(`directory\0${entry}\n`)
    for (const name of readdirSync(path).sort()) {
      hashPathInto(hash, join(path, name), entry === '.' ? name : `${entry}/${name}`)
    }
    return
  }
  if (!info.isFile()) throw new Error(`发行回执只支持普通文件、目录或符号链接：${path}`)
  hash.update(`file\0${entry}\0${info.size}\n`)
  hash.update(readFileSync(path))
}

/** Hash a file or directory with stable names, types, ordering and contents. */
export function sha256Path(path) {
  const hash = createHash('sha256')
  hashPathInto(hash, resolve(path))
  return hash.digest('hex')
}

/** Convert a local evidence path to a relative artifact reference. */
export function artifactReference(path, prefix) {
  const name = basename(String(path || '').replaceAll('\\', sep))
  const normalizedPrefix = String(prefix || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  if (!name || !normalizedPrefix) throw new Error(`发行回执缺少安全 artifact 引用：${path}`)
  return `${normalizedPrefix}/${name}`
}

/** Return the current checkout commit, optionally requiring the CI value to match it. */
export function resolveCommitSha(root, environment = process.env, { requireMatch = false } = {}) {
  const supplied = String(environment.DSH_RELEASE_COMMIT_SHA || '').trim()
  const actual = String(spawnSync('git', ['-C', resolve(root), 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).stdout || '').trim()
  if (requireMatch && !COMMIT_PATTERN.test(actual)) {
    throw new Error(`当前 checkout 没有有效 git commit SHA：${actual || 'missing'}`)
  }
  if (requireMatch && supplied && supplied.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(`发行回执环境 commit SHA 与当前 checkout 不一致：${supplied} != ${actual}`)
  }
  const output = supplied || actual
  if (!COMMIT_PATTERN.test(output)) throw new Error(`发行回执缺少有效 commit SHA：${output || 'missing'}`)
  return output.toLowerCase()
}

/** Read the exact macOS signing authority from a packaged App. */
export function readSignerIdentity(appPath, environment = process.env, { allowOverride = true } = {}) {
  const supplied = String(environment.DSH_SIGNING_IDENTITY || '').trim()
  if (allowOverride && supplied) return supplied
  if (!appPath) return ''
  if (process.platform === 'darwin') {
    const result = spawnSync('codesign', ['-dv', '--verbose=4', resolve(appPath)], { encoding: 'utf8' })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    return output.match(/^Authority=(.+)$/m)?.[1]?.trim() || ''
  }
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-AuthenticodeSignature -FilePath '${String(resolve(appPath)).replaceAll("'", "''")}').SignerCertificate.Subject`,
    ], { encoding: 'utf8' })
    return String(result.stdout || '').trim()
  }
  return ''
}

function safeReference(value) {
  const text = String(value || '').replaceAll('\\', '/')
  return Boolean(text)
    && !text.startsWith('/')
    && !/^[A-Za-z]:\//.test(text)
    && !text.split('/').includes('..')
    && !/(^|\/)tmp(\/|$)/i.test(text)
    && !text.includes('.desktop-build')
}

function hashRecord(reference, path) {
  if (!path || !existsSync(path)) throw new Error(`发行回执 artifact 不存在：${path || 'missing'}`)
  return { reference, sha256: sha256Path(path) }
}

function checkTime(value, label) {
  const text = String(value || '').trim()
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error(`发行回执时间无效：${label}`)
  return text
}

function receiptContract(kind) {
  return RELEASE_EVIDENCE_CONTRACTS[kind] || null
}

/** Return the fixed checks for a receipt kind and native Host mode. */
export function releaseEvidenceChecks(kind, mode = '') {
  const contract = receiptContract(kind)
  const normalizedMode = String(mode || '').trim()
  const checks = contract?.modeChecks
    ? contract.modeChecks[normalizedMode]
    : contract?.requiredChecks
  if (!checks) throw new Error(`发行回执没有可用的检查合同：${kind}/${normalizedMode || 'missing'}`)
  return [...checks]
}

function checkNames(kind, checks, errors, nativeHostMode = '') {
  const contract = receiptContract(kind)
  if (!Array.isArray(checks) || checks.length === 0) {
    errors.push('发行回执缺少检查项')
    return
  }
  const normalizedMode = String(nativeHostMode || '').trim()
  const modeChecks = contract?.modeChecks
  if (modeChecks && !Object.hasOwn(modeChecks, normalizedMode)) {
    errors.push(`发行回执 native_host_mode 无效：${normalizedMode || 'missing'}`)
  }
  const requiredChecks = modeChecks
    ? (modeChecks[normalizedMode] || [])
    : (contract?.requiredChecks || [])
  const allowed = new Set(modeChecks
    ? requiredChecks
    : (contract?.allowedChecks || requiredChecks))
  const seen = new Set()
  for (const item of checks) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push('发行回执 checks 必须是对象数组')
      continue
    }
    const name = String(item.name || '').trim()
    if (!name) errors.push('发行回执检查项缺少 name')
    else if (seen.has(name)) errors.push(`发行回执检查项重复：${name}`)
    else seen.add(name)
    if (item.passed !== true) errors.push(`发行回执检查项未通过：${name || 'unknown'}`)
    if (contract && !allowed.has(name)) errors.push(`发行回执包含未知检查项：${name || 'unknown'}`)
  }
  for (const name of requiredChecks) {
    if (!seen.has(name)) errors.push(`发行回执缺少必需检查项：${name}`)
  }
}

/** Create the shared identity portion and evidence fields for a release receipt. */
export function createReleaseEvidenceReceipt({
  kind,
  evidenceLevel,
  root,
  appPath,
  dmgPath,
  featuredManifestPath,
  commitSha,
  platform = process.platform,
  arch = process.arch,
  signerIdentity,
  startedAt,
  completedAt,
  checks = [],
  screenshotRefs = [],
  nativeHostMode = '',
}) {
  const contract = receiptContract(kind)
  if (!contract) throw new Error(`发行回执类型无效：${kind || 'missing'}`)
  if (String(evidenceLevel || '') !== contract.evidenceLevel) {
    throw new Error(`发行回执 evidence_level 不匹配：${evidenceLevel || 'missing'} != ${contract.evidenceLevel}`)
  }
  const sourcePath = join(resolve(root), RELEASE_EVIDENCE_SOURCE_MANIFEST)
  const artifactManifest = featuredManifestPath
  const started = checkTime(startedAt, 'started_at')
  const completed = checkTime(completedAt, 'completed_at')
  if (Date.parse(completed) < Date.parse(started)) throw new Error('发行回执 completed_at 早于 started_at')
  const commit = commitSha || resolveCommitSha(root)
  if (!COMMIT_PATTERN.test(commit)) throw new Error(`发行回执 commit SHA 无效：${commit}`)
  const signer = String(signerIdentity || readSignerIdentity(appPath, process.env, { allowOverride: false })).trim()
  if (!signer) throw new Error('发行回执缺少签名身份')
  const checkErrors = []
  checkNames(kind, checks, checkErrors, nativeHostMode)
  if (checkErrors.length > 0) throw new Error(checkErrors.join('；'))
  if (!artifactManifest) throw new Error('发行回执缺少精选插件产物 manifest')

  const artifacts = {}
  if (appPath) artifacts.app = hashRecord(artifactReference(appPath, 'app'), appPath)
  if (dmgPath) artifacts.dmg = hashRecord(artifactReference(dmgPath, 'installer'), dmgPath)
  for (const name of contract.allowedArtifacts) {
    if (!artifacts[name]) throw new Error(`发行回执缺少必需 artifact：${name}`)
  }
  const screenshotReferences = screenshotRefs.map((reference) => String(reference || '').trim())
  if (screenshotReferences.some((reference) => !safeReference(reference))) {
    throw new Error('发行回执截图引用必须是 artifact 内的相对路径')
  }

  return {
    schema_version: 2,
    version: RELEASE_EVIDENCE_RECEIPT_VERSION,
    kind,
    status: 'passed',
    passed: true,
    evidence_level: String(evidenceLevel || ''),
    git_commit_sha: String(commit).toLowerCase(),
    platform: String(platform),
    arch: String(arch),
    signer_identity: signer,
    started_at: started,
    completed_at: completed,
    artifacts,
    featured_manifest: {
      source: {
        reference: RELEASE_EVIDENCE_SOURCE_MANIFEST,
        sha256: sha256Path(sourcePath),
      },
      artifact: {
        reference: 'featured-plugins/manifest.json',
        sha256: sha256Path(artifactManifest),
      },
    },
    checks,
    screenshot_refs: screenshotReferences,
    ...(kind === 'native-host' ? { native_host_mode: String(nativeHostMode || '').trim() } : {}),
  }
}

function requireHash(value, label, errors) {
  if (!HASH_PATTERN.test(String(value || ''))) errors.push(`${label} 缺少有效 SHA-256`)
}

function validateReference(value, label, errors) {
  if (!safeReference(value)) errors.push(`${label} 必须是 artifact 内相对引用`)
}

/** Validate a receipt against the exact current checkout and packaged artifacts. */
export function validateReleaseEvidenceReceipt(value, {
  root = process.cwd(),
  kind,
  appPath,
  dmgPath,
  featuredManifestPath,
  commitSha,
  platform,
  arch,
  signerIdentity,
  nativeHostMode,
  verifyContent = true,
} = {}) {
  const errors = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['发行回执不是对象']
  if (value.schema_version !== 2 || value.version !== RELEASE_EVIDENCE_RECEIPT_VERSION) errors.push('发行回执版本不受支持')
  if (!RELEASE_EVIDENCE_KINDS.includes(value.kind)) errors.push('发行回执 kind 无效')
  if (kind && value.kind !== kind) errors.push(`发行回执 kind 不匹配：${value.kind} != ${kind}`)
  if (value.status !== 'passed' || value.passed !== true) errors.push('发行回执没有 passed 状态')
  const contract = receiptContract(value.kind)
  if (!String(value.evidence_level || '').trim()) errors.push('发行回执缺少 evidence_level')
  else if (contract && value.evidence_level !== contract.evidenceLevel) {
    errors.push(`发行回执 evidence_level 不匹配：${value.evidence_level} != ${contract.evidenceLevel}`)
  }
  if (!COMMIT_PATTERN.test(String(value.git_commit_sha || ''))) errors.push('发行回执缺少有效 git_commit_sha')
  if (commitSha && String(value.git_commit_sha).toLowerCase() !== String(commitSha).toLowerCase()) {
    errors.push('发行回执 git_commit_sha 与当前提交不一致')
  }
  if (!String(value.platform || '').trim()) errors.push('发行回执缺少 platform')
  if (!String(value.arch || '').trim()) errors.push('发行回执缺少 arch')
  if (platform && value.platform !== platform) errors.push(`发行回执 platform 不匹配：${value.platform} != ${platform}`)
  if (arch && value.arch !== arch) errors.push(`发行回执 arch 不匹配：${value.arch} != ${arch}`)
  if (!String(value.signer_identity || '').trim()) errors.push('发行回执缺少 signer_identity')
  if (signerIdentity && value.signer_identity !== signerIdentity) errors.push('发行回执 signer_identity 与产物不一致')
  let started
  let completed
  try {
    started = checkTime(value.started_at, 'started_at')
    completed = checkTime(value.completed_at, 'completed_at')
    if (Date.parse(completed) < Date.parse(started)) errors.push('发行回执 completed_at 早于 started_at')
  } catch (error) {
    errors.push(error.message)
  }

  const artifacts = value.artifacts
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    errors.push('发行回执缺少 artifacts')
  } else {
    for (const [name, record] of Object.entries(artifacts)) {
      if (!record || typeof record !== 'object') {
        errors.push(`发行回执 artifacts.${name} 无效`)
        continue
      }
      validateReference(record.reference, `发行回执 artifacts.${name}.reference`, errors)
      requireHash(record.sha256, `发行回执 artifacts.${name}.sha256`, errors)
    }
    for (const name of contract?.allowedArtifacts || []) {
      if (!artifacts[name]) errors.push(`发行回执缺少必需 artifact：${name}`)
    }
    for (const name of Object.keys(artifacts)) {
      if (contract && !contract.allowedArtifacts.includes(name)) {
        errors.push(`发行回执包含未知 artifact：${name}`)
      }
    }
  }
  if (verifyContent && appPath) {
    const actual = existsSync(appPath) ? sha256Path(appPath) : ''
    if (!actual) errors.push(`当前 App 不存在：${appPath}`)
    else if (artifacts?.app?.sha256 !== actual) errors.push('发行回执 App SHA-256 与当前产物不一致')
  }
  if (verifyContent && dmgPath) {
    const actual = existsSync(dmgPath) ? sha256Path(dmgPath) : ''
    if (!actual) errors.push(`当前 DMG 不存在：${dmgPath}`)
    else if (artifacts?.dmg?.sha256 !== actual) errors.push('发行回执 DMG SHA-256 与当前产物不一致')
  }

  const featured = value.featured_manifest
  if (!featured || typeof featured !== 'object') {
    errors.push('发行回执缺少 featured_manifest')
  } else {
    validateReference(featured.source?.reference, 'featured_manifest.source.reference', errors)
    validateReference(featured.artifact?.reference, 'featured_manifest.artifact.reference', errors)
    if (featured.source?.reference !== RELEASE_EVIDENCE_SOURCE_MANIFEST) {
      errors.push('发行回执精选源 manifest 引用不匹配')
    }
    if (featured.artifact?.reference !== 'featured-plugins/manifest.json') {
      errors.push('发行回执精选产物 manifest 引用不匹配')
    }
    requireHash(featured.source?.sha256, 'featured_manifest.source.sha256', errors)
    requireHash(featured.artifact?.sha256, 'featured_manifest.artifact.sha256', errors)
    if (verifyContent) {
      const expectedSource = join(resolve(root), RELEASE_EVIDENCE_SOURCE_MANIFEST)
      if (!existsSync(expectedSource)) {
        errors.push(`当前精选源 manifest 不存在：${expectedSource}`)
      } else if (featured.source?.sha256 !== sha256Path(expectedSource)) {
        errors.push('发行回执精选源 manifest SHA-256 与当前源码不一致')
      }
      if (!featuredManifestPath) {
        errors.push('当前精选产物 manifest 路径缺失')
      } else if (!existsSync(featuredManifestPath)) {
        errors.push(`当前精选产物 manifest 不存在：${featuredManifestPath}`)
      } else if (featured.artifact?.sha256 !== sha256Path(featuredManifestPath)) {
        errors.push('发行回执精选产物 manifest SHA-256 与当前产物不一致')
      }
    }
  }
  if (value.kind === 'native-host' && nativeHostMode
    && value.native_host_mode !== nativeHostMode) {
    errors.push(`发行回执 native_host_mode 与当前检查不一致：${value.native_host_mode || 'missing'} != ${nativeHostMode}`)
  }
  checkNames(value.kind, value.checks, errors, value.native_host_mode)
  if (!Array.isArray(value.screenshot_refs) || value.screenshot_refs.some((reference) => !safeReference(reference))) {
    errors.push('发行回执 screenshot_refs 必须是 artifact 内相对引用')
  }
  return errors
}

/** Return whether a value satisfies the shared receipt contract without external paths. */
export function isReleaseEvidenceReceipt(value) {
  return validateReleaseEvidenceReceipt(value, { verifyContent: false }).length === 0
}

function isReceiptKind(value, kind, options = {}) {
  return validateReleaseEvidenceReceipt(value, { kind, verifyContent: false, ...options }).length === 0
}

/** Validate the macOS DMG notarization receipt shape without local artifacts. */
export function isMacosDmgNotarizationEvidenceReceipt(value) {
  return isReceiptKind(value, 'macos-dmg-notarization')
}

/** Validate the macOS DMG installer receipt shape without local artifacts. */
export function isMacosDmgInstallerEvidenceReceipt(value) {
  return isReceiptKind(value, 'macos-dmg-installer')
}

/** Validate the packaged native Host receipt shape without local artifacts. */
export function isNativeHostEvidenceReceipt(value, { mode } = {}) {
  return isReceiptKind(value, 'native-host', { nativeHostMode: mode })
}
