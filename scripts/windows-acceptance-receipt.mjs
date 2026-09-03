export const WINDOWS_ACCEPTANCE_RECEIPT_VERSION = 'dsh.windows-x64-acceptance.v2'

export const WINDOWS_ACCEPTANCE_CHECKS = Object.freeze([
  'installer-custom-directory',
  'installed-server-smoke',
  'installed-app-smoke',
  'installed-data-root-separation',
  'installed-official-web-permission-smoke',
  'installed-offline-profile-smoke',
  'installed-recovery-smoke',
  'installed-profile-authority-smoke',
  'uninstaller',
  'dsh-data-preserved-after-uninstall',
  'cleanup',
])

export function createWindowsAcceptanceReceipt({
  installer,
  unpackedApp,
  checks,
  startedAt,
  completedAt,
}) {
  return {
    version: WINDOWS_ACCEPTANCE_RECEIPT_VERSION,
    passed: true,
    platform: 'win32',
    arch: 'x64',
    artifacts: {
      installer,
      unpacked_app: unpackedApp,
    },
    checks,
    started_at: startedAt,
    completed_at: completedAt,
  }
}

export function isWindowsAcceptanceReceipt(value) {
  if (!value || typeof value !== 'object') return false
  if (value.version !== WINDOWS_ACCEPTANCE_RECEIPT_VERSION) return false
  if (value.passed !== true || value.platform !== 'win32' || value.arch !== 'x64') return false
  if (!value.artifacts || typeof value.artifacts !== 'object') return false
  if (typeof value.artifacts.installer !== 'string' || typeof value.artifacts.unpacked_app !== 'string') return false
  if (!Array.isArray(value.checks)) return false
  return WINDOWS_ACCEPTANCE_CHECKS.every((name) => value.checks.some(
    (item) => item && item.name === name && item.passed === true,
  ))
}
