import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

import { inspectUpdateArtifacts } from '../../scripts/verify-update-artifacts.mjs'

const require = createRequire(import.meta.url)
const {
  AppUpdateController,
  trustedGitHubRepository,
  getOrCreateUpdateClientId,
} = require('../../electron/app-update-controller.js')

class FakeUpdater extends EventEmitter {
  constructor() {
    super()
    this.feed = null
    this.quitArgs = null
  }

  setFeedURL(feed) {
    this.feed = feed
  }

  async checkForUpdates() {
    return { isUpdateAvailable: true, updateInfo: { version: '1.1.0' } }
  }

  async downloadUpdate() {
    this.emit('download-progress', { percent: 48.5, transferred: 485, total: 1000, bytesPerSecond: 100 })
    this.emit('update-downloaded', { version: '1.1.0' })
    return ['/tmp/update.zip']
  }

  quitAndInstall(...args) {
    this.quitArgs = args
  }
}

function updateResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({
      data: {
        schema_version: 1,
        checked_at: '2026-08-12T08:00:00Z',
        current: { version: '1.0.0' },
        latest: {
          id: 'release-1',
          version: '1.1.0',
          released_at: '2026-08-12T07:00:00Z',
          notes: { features: ['自动升级'], improvements: [], fixes: [] },
          min_supported_version: '1.0.0',
          update_available: true,
          mandatory: false,
          feed_url: 'https://updates.dsh.example/api/desktop/updates/stable/darwin/arm64',
        },
      },
    }),
  }
}

test('update client IDs persist across launches and versions but differ across data directories', () => {
  const first = mkdtempSync(join(tmpdir(), 'dsh-update-id-a-'))
  const second = mkdtempSync(join(tmpdir(), 'dsh-update-id-b-'))
  const id = getOrCreateUpdateClientId(first)
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(getOrCreateUpdateClientId(first), id)
  assert.notEqual(getOrCreateUpdateClientId(second), id)
  assert.equal(statSync(join(first, 'app-update-client.json')).mode & 0o777, 0o600)
})

test('anonymous update IDs travel only in headers and never enter updater state or query strings', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-update-id-wire-'))
  const seen = []
  const controller = new AppUpdateController({
    app: { getVersion: () => '1.0.0' }, updater: new FakeUpdater(),
    fetch: async (url, options) => { seen.push({ url, headers: options.headers }); return updateResponse() },
    apiBaseUrl: 'https://updates.dsh.example', platform: 'darwin', arch: 'arm64', userDataPath,
    dataRoot: join(userDataPath, 'data'), isPackaged: true,
    logger: { info() {}, warn() {}, error() {} },
  })
  await controller.check()
  await controller.check()
  const id = getOrCreateUpdateClientId(userDataPath)
  assert.equal(seen.length, 2)
  for (const request of seen) {
    assert.equal(request.headers['X-DSH-Client-Id'], id)
    assert.ok(!request.url.includes(id))
    assert.ok(!request.url.includes('client_id'))
    assert.deepEqual(Object.keys(request.headers).sort(), ['Accept', 'X-DSH-Client-Id'])
  }
  assert.ok(!JSON.stringify(controller.getState()).includes(id))
  controller.destroy()
})

test('opted-out and disabled clients do not create IDs, and damaged IDs are not reported or replaced', async () => {
  for (const mode of ['opt-out', 'development', 'damaged']) {
    const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-update-id-skip-'))
    const idPath = join(userDataPath, 'app-update-client.json')
    if (mode === 'damaged') writeFileSync(idPath, JSON.stringify({ schemaVersion: 1, id: 'person@example.com' }))
    const controller = new AppUpdateController({
      app: { getVersion: () => '1.0.0' }, updater: new FakeUpdater(),
      fetch: async (_url, options) => { assert.equal(options.headers['X-DSH-Client-Id'], undefined); return updateResponse() },
      apiBaseUrl: 'https://updates.dsh.example', platform: 'darwin', arch: 'arm64', userDataPath,
      dataRoot: join(userDataPath, 'data'), isPackaged: mode !== 'development', collectAnonymousStats: mode !== 'opt-out',
      logger: { info() {}, warn() {}, error() {} },
    })
    await controller.check()
    assert.equal(existsSync(idPath), mode === 'damaged')
    if (mode === 'damaged') assert.equal(JSON.parse(readFileSync(idPath, 'utf8')).id, 'person@example.com')
    controller.destroy()
  }
})

test('managed service failures fall back only to the configured GitHub source and recover next check', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-update-fallback-'))
  const updater = new FakeUpdater()
  let available = false
  const controller = new AppUpdateController({
    app: { getVersion: () => '1.0.0' }, updater,
    fetch: async () => { if (!available) throw new Error('service offline'); return updateResponse() },
    apiBaseUrl: 'https://updates.dsh.example', repository: { owner: 'vibeinging', repo: 'dsh-desktop' }, allowGitHubFallback: true,
    platform: 'darwin', arch: 'arm64', userDataPath, dataRoot: join(userDataPath, 'data'), isPackaged: true,
    logger: { info() {}, warn() {}, error() {} },
  })
  assert.equal((await controller.check()).status, 'available')
  assert.equal(controller.getState().updateSource, 'github')
  assert.equal(updater.feed.provider, 'github')
  assert.equal(updater.feed.repo, 'dsh-desktop')
  assert.equal(updater.allowDowngrade, false)
  assert.equal(updater.autoDownload, false)
  available = true
  assert.equal((await controller.check()).updateSource, 'managed')
  assert.equal(updater.feed.provider, 'generic')
  controller.destroy()
})

test('desktop updater checks metadata, downloads on demand, and preserves data paths', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-updater-'))
  const dataRoot = join(userDataPath, 'projects-and-plugins')
  const updater = new FakeUpdater()
  let prepareCalls = 0
  const controller = new AppUpdateController({
    app: { getVersion: () => '1.0.0' },
    updater,
    fetch: async () => updateResponse(),
    apiBaseUrl: 'https://updates.dsh.example',
    platform: 'darwin',
    arch: 'arm64',
    channel: 'stable',
    locale: 'zh-CN',
    userDataPath,
    dataRoot,
    isPackaged: true,
    prepareToInstall: async () => { prepareCalls += 1 },
    logger: { info() {}, warn() {}, error() {} },
  })

  const checked = await controller.check()
  assert.equal(checked.status, 'available')
  assert.deepEqual(updater.feed, {
    provider: 'generic',
    url: 'https://updates.dsh.example/api/desktop/updates/stable/darwin/arm64',
    useMultipleRangeRequest: false,
  })

  await controller.downloadAndInstall()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(prepareCalls, 1)
  assert.deepEqual(updater.quitArgs, [false, true])
  const pending = JSON.parse(readFileSync(join(userDataPath, 'pending-app-update.json'), 'utf8'))
  assert.equal(pending.fromVersion, '1.0.0')
  assert.equal(pending.toVersion, '1.1.0')
  assert.deepEqual(pending.preservedPaths, [userDataPath, dataRoot])
  controller.destroy()
})
test('desktop updater records successful upgrade after the new app starts', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-updater-history-'))
  writeFileSync(join(userDataPath, 'pending-app-update.json'), JSON.stringify({
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
  }))
  const controller = new AppUpdateController({
    app: { getVersion: () => '1.1.0' },
    updater: new FakeUpdater(),
    fetch: async () => updateResponse(),
    apiBaseUrl: 'https://updates.dsh.example',
    platform: 'linux',
    arch: 'x64',
    userDataPath,
    dataRoot: join(userDataPath, 'data'),
    isPackaged: true,
    logger: { info() {}, warn() {}, error() {} },
  })
  assert.equal(controller.getState().enabled, false)
  assert.equal(controller.getState().history[0].result, 'success')
  assert.equal(controller.getState().history[0].toVersion, '1.1.0')
  controller.destroy()
})

test('desktop updater rejects a feed URL from a private or foreign server', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-updater-trust-'))
  const controller = new AppUpdateController({
    app: { getVersion: () => '1.0.0' },
    updater: new FakeUpdater(),
    fetch: async () => {
      const response = updateResponse()
      const payload = JSON.parse(await response.text())
      payload.data.latest.feed_url = 'https://private.example.com/api/desktop/updates/stable/darwin/arm64'
      return { ...response, text: async () => JSON.stringify(payload) }
    },
    apiBaseUrl: 'https://updates.dsh.example',
    platform: 'darwin',
    arch: 'arm64',
    userDataPath,
    dataRoot: join(userDataPath, 'data'),
    isPackaged: true,
    logger: { info() {}, warn() {}, error() {} },
  })
  const state = await controller.check()
  assert.equal(state.status, 'error')
  assert.match(state.error, /不受信任/)
  controller.destroy()
})

test('desktop updater restores cached release notes without trusting them as an install command', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-updater-cache-'))
  writeFileSync(join(userDataPath, 'app-update-metadata-cache.json'), JSON.stringify({
    schema_version: 1,
    checked_at: '2026-08-12T08:00:00Z',
    current: { version: '1.0.0', release: null },
    latest: {
      id: 'cached-release', version: '1.1.0', released_at: '2026-08-12T07:00:00Z',
      notes: { features: ['缓存说明'], improvements: [], fixes: [] },
      update_available: true, mandatory: false,
      feed_url: 'https://updates.dsh.example/api/desktop/updates/stable/darwin/arm64',
    },
  }))
  const updater = new FakeUpdater()
  let downloadCalls = 0
  updater.downloadUpdate = async () => { downloadCalls += 1 }
  const controller = new AppUpdateController({
    app: { getVersion: () => '1.0.0' }, updater,
    fetch: async () => { throw new Error('offline') },
    apiBaseUrl: 'https://updates.dsh.example', platform: 'darwin', arch: 'arm64',
    userDataPath, dataRoot: join(userDataPath, 'data'), isPackaged: true,
    logger: { info() {}, warn() {}, error() {} },
  })
  assert.equal(controller.getState().latest.notes.features[0], '缓存说明')
  await controller.downloadAndInstall()
  assert.equal(downloadCalls, 0)
  assert.equal(controller.getState().status, 'error')
  controller.destroy()
})


test('desktop updater stays disabled until the app has an explicit HTTPS update source', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-updater-disabled-'))
  const controller = new AppUpdateController({
    app: { getVersion: () => '1.0.0' },
    updater: new FakeUpdater(),
    fetch: async () => { throw new Error('must not fetch') },
    apiBaseUrl: '',
    platform: 'darwin',
    arch: 'arm64',
    userDataPath,
    dataRoot: join(userDataPath, 'data'),
    isPackaged: true,
    logger: { info() {}, warn() {}, error() {} },
  })
  assert.equal(controller.getState().enabled, false)
  assert.equal(controller.getState().status, 'disabled')
  controller.destroy()
})

test('desktop updater uses the fixed public GitHub Release source without a private API', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-updater-github-'))
  const updater = new FakeUpdater()
  updater.checkForUpdates = async () => ({
    isUpdateAvailable: true,
    updateInfo: {
      version: '1.1.0',
      releaseDate: '2026-08-25T08:00:00Z',
      releaseNotes: [{ version: '1.1.0', note: 'Better Sidebar 0.16.0' }],
    },
  })
  const controller = new AppUpdateController({
    app: { getVersion: () => '1.0.0' },
    updater,
    fetch: async () => { throw new Error('GitHub mode must not call the private metadata API') },
    apiBaseUrl: '',
    repository: { owner: 'vibeinging', repo: 'dsh-desktop' },
    platform: 'darwin',
    arch: 'arm64',
    userDataPath,
    dataRoot: join(userDataPath, 'data'),
    isPackaged: true,
    logger: { info() {}, warn() {}, error() {} },
  })

  const state = await controller.check()
  assert.equal(state.enabled, true)
  assert.equal(state.updateSource, 'github')
  assert.equal(state.releasePageUrl, 'https://github.com/vibeinging/dsh-desktop/releases/latest')
  assert.equal(state.status, 'available')
  assert.equal(state.latest.version, '1.1.0')
  assert.deepEqual(state.latest.notes.improvements, ['Better Sidebar 0.16.0'])
  assert.deepEqual(updater.feed, {
    provider: 'github',
    owner: 'vibeinging',
    repo: 'dsh-desktop',
    private: false,
    releaseType: 'release',
  })
  controller.destroy()
})

test('desktop updater rejects an invalid GitHub repository identity', () => {
  assert.throws(
    () => trustedGitHubRepository({ owner: 'vibeinging/other', repo: 'dsh-desktop' }),
    /GitHub 更新仓库名无效/,
  )
})

test('packaged desktop exposes update UX and publishes updater metadata for both platforms', () => {
  const electronPackage = JSON.parse(readFileSync(new URL('../../electron/package.json', import.meta.url), 'utf8'))
  const mainSource = readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8')
  const macWorkflow = readFileSync(new URL('../../.github/workflows/macos-release-evidence.yml', import.meta.url), 'utf8')
  const winWorkflow = readFileSync(new URL('../../.github/workflows/windows-release-evidence.yml', import.meta.url), 'utf8')
  const unsignedWinWorkflow = readFileSync(new URL('../../.github/workflows/windows-release.yml', import.meta.url), 'utf8')

  assert.deepEqual(electronPackage.build.publish, [{
    provider: 'github',
    owner: 'vibeinging',
    repo: 'dsh-desktop',
    releaseType: 'release',
  }])
  assert.match(mainSource, /label: '检查更新…'/)
  assert.doesNotMatch(mainSource, /promptForAvailableUpdate|发现新版本/)
  assert.match(mainSource, /handleAppUpdateRequest/)
  assert.equal(electronPackage.build.files.includes('app-update-requests.js'), true)
  assert.match(mainSource, /repository: UPDATE_REPOSITORY/)
  assert.match(electronPackage.scripts['package:mac:project'], /check:update-artifacts:mac/)
  assert.match(electronPackage.scripts['package:win:project'], /check:update-artifacts:win/)
  assert.match(electronPackage.scripts['package:win:unsigned:project'], /check:update-artifacts:win/)
  for (const workflow of [macWorkflow, winWorkflow, unsignedWinWorkflow]) {
    assert.match(workflow, /release\/\*\.yml/)
    assert.match(workflow, /release\/\*\.blockmap/)
  }
})

test('update artifact contract binds metadata to the current downloadable file', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-update-artifacts-'))
  const release = join(root, 'release')
  mkdirSync(release)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  const artifactName = 'dsh-desktop-1.2.3-mac-arm64.zip'
  const artifact = Buffer.from('signed update archive')
  writeFileSync(join(release, artifactName), artifact)
  writeFileSync(join(release, `${artifactName}.blockmap`), 'blockmap')
  writeFileSync(join(release, 'latest-mac.yml'), [
    'version: 1.2.3',
    `path: ${artifactName}`,
    `sha512: ${createHash('sha512').update(artifact).digest('base64')}`,
    '',
  ].join('\n'))

  assert.deepEqual(inspectUpdateArtifacts(root, 'macos'), [])
  writeFileSync(join(release, artifactName), 'tampered archive')
  assert.match(inspectUpdateArtifacts(root, 'macos').join('\n'), /SHA-512/)
})

test('Windows update artifact contract requires the EXE blockmap', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-update-artifacts-win-'))
  const release = join(root, 'release')
  mkdirSync(release)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  const artifactName = 'dsh-desktop-1.2.3-win-x64.exe'
  const artifact = Buffer.from('signed installer')
  writeFileSync(join(release, artifactName), artifact)
  writeFileSync(join(release, 'latest.yml'), [
    'version: 1.2.3',
    `path: ${artifactName}`,
    `sha512: ${createHash('sha512').update(artifact).digest('base64')}`,
    '',
  ].join('\n'))

  assert.match(inspectUpdateArtifacts(root, 'windows').join('\n'), /blockmap/)
  writeFileSync(join(release, `${artifactName}.blockmap`), 'blockmap')
  assert.deepEqual(inspectUpdateArtifacts(root, 'windows'), [])
})

test('desktop updater blocks installation when the authoritative Profile preflight fails', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'dsh-updater-profile-gate-'))
  const updater = new FakeUpdater()
  let prepareCalls = 0
  const blocked = []
  const controller = new AppUpdateController({
    app: { getVersion: () => '1.0.0' },
    updater,
    fetch: async () => updateResponse(),
    apiBaseUrl: 'https://updates.dsh.example',
    platform: 'darwin',
    arch: 'arm64',
    userDataPath,
    dataRoot: join(userDataPath, 'data'),
    isPackaged: true,
    prepareToInstall: async () => { prepareCalls += 1 },
    preflightInstall: async () => ({
      ok: false,
      code: 'DSH_PROFILE_PREFLIGHT_FAILED',
      message: 'Profile 中存在无法解析的 Bundle',
    }),
    onInstallBlocked: async (gate) => { blocked.push(gate) },
    logger: { info() {}, warn() {}, error() {} },
  })

  assert.equal((await controller.check()).status, 'available')
  const state = await controller.downloadAndInstall()
  assert.equal(state.status, 'blocked')
  assert.equal(state.error, 'Profile 中存在无法解析的 Bundle')
  assert.deepEqual(state.updateGate.choices, ['update-plugins', 'defer', 'safe-profile'])
  assert.equal(prepareCalls, 0)
  assert.deepEqual(updater.quitArgs, null)
  assert.equal(blocked.length, 1)
  controller.destroy()
})
