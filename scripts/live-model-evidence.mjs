import {
  artifactReference,
  createReleaseEvidenceReceipt,
  validateReleaseEvidenceReceipt,
} from './release-evidence-receipt.mjs'

export const LIVE_MODEL_EVIDENCE_VERSION = 'dsh.live-model.evidence.v1'
export const LIVE_MODEL_PROVIDER = 'deepseek-official'
export const LIVE_MODEL_PROVIDER_NAME = 'DeepSeek'

export const LIVE_MODEL_EVIDENCE_CHECKS = Object.freeze([
  'official-web-launch',
  'session-create',
  'session-history',
  'provider-success',
  'model-response-success',
])

const FAILURE_KIND_PATTERN = /^(?:aborted|blocked|cancelled|canceled|error|failed|interrupted|timeout)$/i
const FAILURE_TEXT_PATTERN = /(?:AUTH(?:ORIZATION|ENTICATION)?|CREDENTIAL|EMPTY[_ -]?RESPONSE|INVALID[_ -]?KEY|MISSING[_ -]?CREDENTIAL|PROVIDER|QUOTA|RATE[_ -]?LIMIT|TRANSPORT)/i

function historyEntries(history) {
  if (Array.isArray(history?.entries)) return history.entries
  if (Array.isArray(history?.events)) {
    return history.events.map((entry) => (
      entry?.event && typeof entry.event === 'object' ? entry : { event: entry }
    ))
  }
  return []
}

function textFromBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim()
}

function structuredFailureTexts(event) {
  const data = event?.data && typeof event.data === 'object' ? event.data : {}
  const reason = data.reason && typeof data.reason === 'object' ? data.reason : {}
  const error = data.error && typeof data.error === 'object' ? data.error : {}
  const reasonError = reason.error && typeof reason.error === 'object' ? reason.error : {}
  return [
    data.code,
    error.code,
    error.name,
    error.message,
    reason.kind,
    reason.code,
    reasonError.code,
    reasonError.name,
    reasonError.message,
  ].map((value) => String(value || '').trim()).filter(Boolean)
}

function pushUnique(errors, value) {
  if (value && !errors.includes(value)) errors.push(value)
}

/** Inspect authoritative DSH history for a completed response from DeepSeek. */
export function inspectLiveModelHistory(history, {
  responseMarker,
  expectedProvider = LIVE_MODEL_PROVIDER,
} = {}) {
  const marker = String(responseMarker || '').trim()
  const entries = historyEntries(history)
  const errors = []
  const assistantCandidates = []
  const completedTurns = new Set()
  let assistantText = ''
  let provider = ''
  let completed = false
  let terminalFailure = false

  if (!marker) pushUnique(errors, 'live-model response marker 缺失')
  if (entries.length === 0) pushUnique(errors, 'session.history 没有返回事件')

  for (const entry of entries) {
    const event = entry?.event
    if (!event || typeof event !== 'object') continue
    const failureTexts = structuredFailureTexts(event)
    const reasonKind = String(event.data?.reason?.kind || '').trim()
    if (event.type === 'turn/end') {
      if (reasonKind === 'completed') completedTurns.add(String(event.data?.turn ?? ''))
      else if (FAILURE_KIND_PATTERN.test(reasonKind)) {
        terminalFailure = true
        pushUnique(errors, `DSH turn 以 ${reasonKind} 结束`)
      }
    }
    if (event.type === 'error' || /(?:^|\/)(?:error|failed)$/.test(String(event.type || ''))) {
      terminalFailure = true
      pushUnique(errors, `DSH 事件报告失败：${event.type}`)
    }
    for (const text of failureTexts) {
      if (FAILURE_TEXT_PATTERN.test(text)) {
        terminalFailure = true
        pushUnique(errors, `DSH provider/credential failure：${text}`)
      }
    }
    if (event.type !== 'assistant/message') continue
    const message = event.data?.message
    const text = textFromBlocks(message?.content)
    if (!text) continue
    const source = message?.source
    assistantCandidates.push({
      text,
      provider: String(source?.provider || '').trim(),
      sourceKind: String(source?.kind || '').trim(),
      turn: String(event.data?.turn ?? ''),
    })
  }

  const markerCandidate = [...assistantCandidates].reverse().find((candidate) => candidate.text.includes(marker))
  const candidate = markerCandidate || assistantCandidates.at(-1)
  assistantText = candidate?.text || ''
  provider = candidate?.provider || ''
  if (!assistantText) pushUnique(errors, 'session.history 缺少非空 assistant 文本')
  else if (!markerCandidate) pushUnique(errors, 'assistant 文本没有包含唯一 response marker')
  if (candidate?.sourceKind !== 'model') pushUnique(errors, 'assistant/message 没有 model source')
  if (!provider) pushUnique(errors, 'assistant/message 缺少 provider')
  else if (provider !== expectedProvider) {
    pushUnique(errors, `assistant/message provider 不匹配：${provider} != ${expectedProvider}`)
  }
  completed = Boolean(candidate && (completedTurns.has(candidate.turn) || (!candidate.turn && completedTurns.size > 0)))
  if (!completed) pushUnique(errors, 'session.history 没有 completed turn/end')
  return {
    ok: errors.length === 0,
    completed,
    terminalFailure,
    assistantText,
    provider,
    providerName: LIVE_MODEL_PROVIDER_NAME,
    errors,
  }
}

/** Create a credential-free receipt for one real packaged live-model smoke. */
export function createLiveModelEvidenceReceipt({
  root = process.cwd(),
  app,
  appPath = app,
  screenshot,
  screenshotReference = artifactReference(screenshot, 'live-model-evidence'),
  featuredManifestPath,
  commitSha,
  platform = 'darwin',
  arch = 'arm64',
  signerIdentity,
  startedAt,
  completedAt,
  history,
  responseMarker,
  provider = LIVE_MODEL_PROVIDER,
}) {
  const marker = String(responseMarker || '').trim()
  const historyCheck = inspectLiveModelHistory(history, { responseMarker: marker, expectedProvider: provider })
  if (!historyCheck.ok) throw new Error(`真实 DeepSeek live-model 未完成：${historyCheck.errors.join('；')}`)
  if (provider !== LIVE_MODEL_PROVIDER) throw new Error(`live-model provider 不受支持：${provider}`)
  return {
    ...createReleaseEvidenceReceipt({
      kind: 'live-model',
      evidenceLevel: 'packaged-electron-live-model',
      root,
      appPath,
      featuredManifestPath,
      commitSha,
      platform,
      arch,
      signerIdentity,
      startedAt,
      completedAt,
      checks: LIVE_MODEL_EVIDENCE_CHECKS.map((name) => ({ name, passed: true })),
      screenshotRefs: [screenshotReference],
    }),
    live_model_version: LIVE_MODEL_EVIDENCE_VERSION,
    provider,
    provider_name: LIVE_MODEL_PROVIDER_NAME,
    model_response_marker: marker,
    credentials_persisted: false,
  }
}

/** Validate the receipt shape without inspecting or storing the API key. */
export function isLiveModelEvidenceReceipt(value) {
  if (validateReleaseEvidenceReceipt(value, { kind: 'live-model', verifyContent: false }).length > 0) return false
  if (value.live_model_version !== LIVE_MODEL_EVIDENCE_VERSION) return false
  if (value.platform !== 'darwin' || value.arch !== 'arm64') return false
  if (value.credentials_persisted !== false) return false
  if (value.provider !== LIVE_MODEL_PROVIDER || value.provider_name !== LIVE_MODEL_PROVIDER_NAME) return false
  if (!String(value.model_response_marker || '').trim()) return false
  if (!Array.isArray(value.screenshot_refs) || value.screenshot_refs.length === 0) return false
  return LIVE_MODEL_EVIDENCE_CHECKS.every((name) => value.checks.some(
    (item) => item && item.name === name && item.passed === true,
  ))
}
