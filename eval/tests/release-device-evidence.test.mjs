import assert from 'node:assert/strict'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  RELEASE_DEVICE_CHECKS,
  createReleaseDeviceEvidenceReceipt,
  validateReleaseDeviceEvidenceReceipt,
} from '../../scripts/release-device-evidence.mjs'
import { sha256Path } from '../../scripts/release-evidence-receipt.mjs'

const COMMIT = 'a'.repeat(40)

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-device-eval-'))
  const artifact = join(root, 'dsh-desktop-0.1.8-mac-arm64.dmg')
  const evidenceDir = join(root, 'evidence')
  mkdirSync(evidenceDir)
  writeFileSync(artifact, 'signed-release-candidate')
  const checks = RELEASE_DEVICE_CHECKS.map((check, index) => {
    const evidence = []
    if (check.visual) {
      const path = join(evidenceDir, `${check.id}.png`)
      writeFileSync(path, `visual-${index}`)
      evidence.push({
        reference: `evidence/${check.id}.png`,
        sha256: sha256Path(path),
        bytes: statSync(path).size,
      })
    }
    return { id: check.id, passed: true, note: '通过', evidence }
  })
  const receipt = createReleaseDeviceEvidenceReceipt({
    root,
    artifactPath: artifact,
    platform: 'darwin',
    arch: 'arm64',
    appVersion: '0.1.8',
    commitSha: COMMIT,
    operatorAlias: 'tester',
    device: {
      physical_device: true,
      environment: 'local-physical-device',
      device_id_sha256: 'b'.repeat(64),
      model: 'Mac16,1',
      os_version: '25.6.0',
    },
    startedAt: '2026-08-25T00:00:00.000Z',
    completedAt: '2026-08-25T00:10:00.000Z',
    checks,
  })
  return { root, artifact, receipt }
}

test('physical-device release receipt binds candidate, device, checklist and screenshots', async () => {
  const value = await fixture()
  try {
    assert.deepEqual(validateReleaseDeviceEvidenceReceipt(value.receipt, {
      artifactPath: value.artifact,
      platform: 'darwin',
      arch: 'arm64',
      appVersion: '0.1.8',
      commitSha: COMMIT,
      evidenceRoot: value.root,
    }), [])
  } finally {
    await rm(value.root, { recursive: true, force: true })
  }
})

test('physical-device release receipt rejects CI-like, incomplete, failed and drifted evidence', async () => {
  const value = await fixture()
  try {
    const virtual = { ...value.receipt, device: { ...value.receipt.device, physical_device: false } }
    assert.match(validateReleaseDeviceEvidenceReceipt(virtual, { verifyContent: false }).join('\n'), /物理设备/)

    assert.match(validateReleaseDeviceEvidenceReceipt(value.receipt, {
      appVersion: '0.1.9',
      verifyContent: false,
    }).join('\n'), /版本与候选/)

    const missing = { ...value.receipt, checks: value.receipt.checks.slice(1) }
    assert.match(validateReleaseDeviceEvidenceReceipt(missing, { verifyContent: false }).join('\n'), /缺少检查项/)

    const failed = { ...value.receipt, checks: value.receipt.checks.map((item, index) => index ? item : { ...item, passed: false }) }
    assert.match(validateReleaseDeviceEvidenceReceipt(failed, { verifyContent: false }).join('\n'), /未通过/)

    const noScreenshot = {
      ...value.receipt,
      checks: value.receipt.checks.map((item) => item.id === 'first-launch-official-web'
        ? { ...item, evidence: [] }
        : item),
    }
    assert.match(validateReleaseDeviceEvidenceReceipt(noScreenshot, { verifyContent: false }).join('\n'), /缺少截图/)

    writeFileSync(value.artifact, 'changed-candidate')
    assert.match(validateReleaseDeviceEvidenceReceipt(value.receipt, {
      artifactPath: value.artifact,
      evidenceRoot: value.root,
    }).join('\n'), /安装包 SHA-256/)
  } finally {
    await rm(value.root, { recursive: true, force: true })
  }
})
