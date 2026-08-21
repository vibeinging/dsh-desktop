import {
  artifactReference,
  createReleaseEvidenceReceipt,
  validateReleaseEvidenceReceipt,
} from './release-evidence-receipt.mjs'

export const LIVE_MODEL_EVIDENCE_VERSION = 'dsh.live-model.evidence.v1'

export const LIVE_MODEL_EVIDENCE_CHECKS = Object.freeze([
  'official-web-launch',
  'session-create',
  'session-history',
])

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
}) {
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
    credentials_persisted: false,
  }
}

/** Validate the receipt shape without inspecting or storing the API key. */
export function isLiveModelEvidenceReceipt(value) {
  if (validateReleaseEvidenceReceipt(value, { kind: 'live-model', verifyContent: false }).length > 0) return false
  if (value.live_model_version !== LIVE_MODEL_EVIDENCE_VERSION) return false
  if (value.platform !== 'darwin' || value.arch !== 'arm64') return false
  if (value.credentials_persisted !== false) return false
  if (!Array.isArray(value.screenshot_refs) || value.screenshot_refs.length === 0) return false
  return LIVE_MODEL_EVIDENCE_CHECKS.every((name) => value.checks.some(
    (item) => item && item.name === name && item.passed === true,
  ))
}
