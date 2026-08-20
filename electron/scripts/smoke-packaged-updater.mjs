import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import { promisify } from 'node:util'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

import { resolvePackagedLayout } from './packaged-layout.mjs'

const require = createRequire(import.meta.url)
const { createPackage, extractAll, extractFile } = require('@electron/asar')
const run = promisify(execFile)
const appInput = process.argv[2] || '../release/mac-arm64/DSH Desktop.app'
const { appPath } = resolvePackagedLayout(appInput)
const currentApp = appPath || appInput
const targetVersion = '0.0.2'
const tempDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-updater-'))
const oldApp = join(tempDir, 'old', 'DSH Desktop.app')
const updatedApp = join(tempDir, 'updated', 'DSH Desktop.app')
const updateZip = join(tempDir, `dsh-desktop-${targetVersion}-mac-arm64.zip`)
const userDataDir = join(tempDir, 'user-data')
const dataRoot = join(tempDir, 'data')
const output = []
let child
let server
let childExit = null
let childError = null

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runCommand(command, args) {
  return run(command, args, { maxBuffer: 1024 * 1024 * 4 })
}

async function cloneApp(source, destination) {
  await mkdir(join(destination, '..'), { recursive: true })
  try {
    await runCommand('cp', ['-cR', source, destination])
  } catch {
    await runCommand('cp', ['-R', source, destination])
  }
}

async function addUpdaterFixtureConfig(app) {
  await writeFile(
    join(app, 'Contents', 'Resources', 'app-update.yml'),
    'provider: generic\nurl: https://127.0.0.1\n',
  )
  const plistPath = join(app, 'Contents', 'Info.plist')
  try {
    await runCommand('/usr/libexec/PlistBuddy', ['-c', 'Delete :LSEnvironment', plistPath])
  } catch {
    // The fixture starts from a normal Electron bundle without LSEnvironment.
  }
  await runCommand('/usr/libexec/PlistBuddy', ['-c', 'Add :LSEnvironment dict', plistPath])
  for (const [key, value] of [
    ['DSH_USER_DATA_DIR', userDataDir],
    ['DSH_DATA_ROOT', dataRoot],
    ['DSH_AGENT_RUNTIME_HOME', join(tempDir, 'agent-runtime')],
    ['DSH_SKILLS_ROOT', join(dataRoot, 'skills')],
  ]) {
    await runCommand('/usr/libexec/PlistBuddy', ['-c', `Add :LSEnvironment:${key} string ${value}`, plistPath])
  }
}

async function signSmokeApp(app) {
  const identity = String(process.env.DSH_SMOKE_SIGN_IDENTITY || '-').trim() || '-'
  const args = ['--force', '--sign', identity]
  if (identity !== '-') {
    args.push('--options', 'runtime', '--timestamp', '--preserve-metadata=entitlements,requirements,flags')
  }
  args.push(app)
  await runCommand('codesign', args)
}

async function updateAppVersion(app) {
  const asarPath = join(app, 'Contents', 'Resources', 'app.asar')
  const unpackedPath = join(tempDir, 'app-asar-source')
  extractAll(asarPath, unpackedPath)
  const packagePath = join(unpackedPath, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
  packageJson.version = targetVersion
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
  await rm(asarPath, { force: true })
  await createPackage(unpackedPath, asarPath)

  const asarHash = createHash('sha256').update(await readFile(asarPath)).digest('hex')
  const plistPath = join(app, 'Contents', 'Info.plist')
  await runCommand('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleShortVersionString ${targetVersion}`, plistPath])
  await runCommand('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleVersion ${targetVersion}`, plistPath])
  await runCommand('/usr/libexec/PlistBuddy', ['-c', `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${asarHash}`, plistPath])
  await signSmokeApp(app)
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(filePath).on('error', reject).on('end', () => resolve(hash.digest('base64'))).pipe(hash)
  })
}

async function prepareUpdateArchive() {
  await cloneApp(currentApp, oldApp)
  await cloneApp(currentApp, updatedApp)
  await addUpdaterFixtureConfig(oldApp)
  await addUpdaterFixtureConfig(updatedApp)
  await signSmokeApp(oldApp)
  await updateAppVersion(updatedApp)
  await runCommand('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', updatedApp, updateZip])
  const updateStat = await stat(updateZip)
  return { size: updateStat.size, sha512: await hashFile(updateZip) }
}

async function prepareTls() {
  const tlsDir = join(tempDir, 'tls')
  await mkdir(tlsDir, { recursive: true })
  const keyPath = join(tlsDir, 'key.pem')
  const certPath = join(tlsDir, 'cert.pem')
  await runCommand('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', keyPath, '-out', certPath,
  ])
  return { key: await readFile(keyPath), cert: await readFile(certPath) }
}

function startUpdateServer({ tls, archive }) {
  const zipName = `dsh-desktop-${targetVersion}-mac-arm64.zip`
  const feedPath = '/api/desktop/updates/stable/darwin/arm64'
  const latestYaml = [
    `version: ${targetVersion}`,
    'files:',
    `  - url: ${zipName}`,
    `    sha512: ${archive.sha512}`,
    `    size: ${archive.size}`,
    `path: ${zipName}`,
    `sha512: ${archive.sha512}`,
    'releaseDate: 2026-08-20T00:00:00.000Z',
    '',
  ].join('\n')
  const metadata = JSON.stringify({
    data: {
      schema_version: 1,
      checked_at: '2026-08-20T00:00:00.000Z',
      current: { version: '0.0.1' },
      latest: {
        id: 'packaged-updater-smoke',
        version: targetVersion,
        released_at: '2026-08-20T00:00:00.000Z',
        notes: { features: ['真实 updater 替换回归'], improvements: [], fixes: [] },
        min_supported_version: '0.0.1',
        update_available: true,
        mandatory: false,
        feed_url: '',
      },
    },
  })

  server = createServer(tls, (request, response) => {
    const requestPath = new URL(request.url || '/', 'https://127.0.0.1').pathname
    if (requestPath === '/api/desktop/releases/check') {
      const body = Buffer.from(metadata)
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length })
      response.end(body)
      return
    }
    if (requestPath === `${feedPath}/latest-mac.yml`) {
      const body = Buffer.from(latestYaml)
      response.writeHead(200, { 'content-type': 'text/yaml', 'content-length': body.length })
      response.end(body)
      return
    }
    if (requestPath === `/${zipName}` || requestPath === `${feedPath}/${zipName}`) {
      response.writeHead(200, { 'content-type': 'application/zip', 'content-length': archive.size })
      createReadStream(updateZip).on('error', (error) => response.destroy(error)).pipe(response)
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('updater smoke HTTPS 服务没有端口'))
      else resolve(`https://127.0.0.1:${address.port}`)
    })
  })
}

function readHistory() {
  try {
    return JSON.parse(require('node:fs').readFileSync(join(userDataDir, 'app-update-history.json'), 'utf8'))
  } catch {
    return null
  }
}

function terminateTempApps() {
  let pids = []
  try {
    pids = execFileSync('pgrep', ['-f', `${oldApp}/Contents/MacOS/DSH Desktop`], { encoding: 'utf8' })
      .split(/\s+/).filter(Boolean).map(Number)
  } catch {
    // No relaunching temporary app remains.
  }
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
  }
}

try {
  const archive = await prepareUpdateArchive()
  const tls = await prepareTls()
  const apiBaseUrl = await startUpdateServer({ tls, archive })
  const env = { ...process.env }
  for (const key of ['DEEPSEEK_API_KEY', 'ELECTRON_RUN_AS_NODE', 'DB_SQLITE_PATH', 'INTERMEDIATE_DIR', 'DSH_AGENT_SESSION_DIR', 'DSH_YITRACE_DIR']) {
    delete env[key]
  }
  Object.assign(env, {
    HOME: join(tempDir, 'home'),
    PATH: '/usr/bin:/bin',
    DSH_SMOKE_UPDATE: '1',
    DSH_UPDATE_API_BASE_URL: apiBaseUrl,
    DSH_USER_DATA_DIR: userDataDir,
    DSH_DATA_ROOT: dataRoot,
    DSH_AGENT_RUNTIME_HOME: join(tempDir, 'agent-runtime'),
    DSH_SKILLS_ROOT: join(dataRoot, 'skills'),
  })
  child = spawn(join(oldApp, 'Contents', 'MacOS', 'DSH Desktop'), ['--ignore-certificate-errors'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => output.push(chunk.toString()))
  child.stderr.on('data', (chunk) => output.push(chunk.toString()))
  child.once('error', (error) => { childError = error })
  child.once('exit', (code, signal) => { childExit = { code, signal } })

  const deadline = Date.now() + 240_000
  let history = null
  while (Date.now() < deadline) {
    history = readHistory()
    const entry = history?.entries?.[0]
    if (entry?.toVersion === targetVersion) {
      if (entry.result !== 'success') throw new Error(`updater smoke 安装记录不是 success: ${JSON.stringify(entry)}`)
      break
    }
    if (childError) throw new Error(`updater smoke 旧 App 启动失败: ${childError.message}\n${output.join('')}`)
    if (childExit && (childExit.code !== 0 || childExit.signal)) {
      throw new Error(`updater smoke 旧 App 提前退出 code=${childExit.code} signal=${childExit.signal}\n${output.join('')}`)
    }
    await sleep(500)
  }
  const entry = history?.entries?.[0]
  if (entry?.toVersion !== targetVersion || entry.result !== 'success') {
    throw new Error(`updater smoke 未观察到新 App 成功启动和历史回放\n${output.join('')}`)
  }
  const installedInfo = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(oldApp, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim()
  const installedPackage = JSON.parse(extractFile(join(oldApp, 'Contents', 'Resources', 'app.asar'), 'package.json').toString())
  if (installedInfo !== targetVersion || installedPackage.version !== targetVersion) {
    throw new Error(`updater smoke 替换后的 App 版本不一致: plist=${installedInfo} package=${installedPackage.version}`)
  }
  console.log(`[smoke] PASS 真实 electron-updater 下载、Profile 预检、临时 App 替换和新版本历史回放; version=${targetVersion}; archive_bytes=${archive.size}`)
} finally {
  try { child?.kill() } catch { /* ignore */ }
  terminateTempApps()
  try { server?.close() } catch { /* ignore */ }
  try { await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }) } catch (error) {
    console.warn(`[smoke] updater 临时目录清理失败(已忽略): ${error.code || error.message}`)
  }
}
