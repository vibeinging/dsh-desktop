export const LIVE_MODEL_EVIDENCE_VERSION = 'dsh.live-model.evidence.v1'

export const LIVE_MODEL_EVIDENCE_CHECKS = Object.freeze([
  'official-web-launch',
  'session-create',
  'session-history',
])

/** Create a credential-free receipt for one real packaged live-model smoke. */
export function createLiveModelEvidenceReceipt({ app, screenshot, startedAt, completedAt }) {
  return {
    version: LIVE_MODEL_EVIDENCE_VERSION,
    passed: true,
    evidence_level: 'packaged-electron-live-model',
    platform: 'darwin',
    arch: 'arm64',
    app: String(app || ''),
    screenshot: String(screenshot || ''),
    credentials_persisted: false,
    checks: LIVE_MODEL_EVIDENCE_CHECKS.map((name) => ({ name, passed: true })),
    started_at: String(startedAt || ''),
    completed_at: String(completedAt || ''),
  }
}

/** Validate the receipt shape without inspecting or storing the API key. */
export function isLiveModelEvidenceReceipt(value) {
  if (!value || typeof value !== 'object') return false
  if (value.version !== LIVE_MODEL_EVIDENCE_VERSION) return false
  if (value.passed !== true || value.evidence_level !== 'packaged-electron-live-model') return false
  if (value.platform !== 'darwin' || value.arch !== 'arm64') return false
  if (typeof value.app !== 'string' || !value.app) return false
  if (typeof value.screenshot !== 'string' || !value.screenshot) return false
  if (value.credentials_persisted !== false) return false
  if (!Array.isArray(value.checks)) return false
  return LIVE_MODEL_EVIDENCE_CHECKS.every((name) => value.checks.some(
    (item) => item && item.name === name && item.passed === true,
  ))
}
