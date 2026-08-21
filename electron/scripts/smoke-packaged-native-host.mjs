import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { resolvePackagedLayout } from './packaged-layout.mjs'
import { pathWithPackagedBin, systemOnlyPath } from './packaged-smoke-environment.mjs'
import {
  artifactReference,
  createReleaseEvidenceReceipt,
  readSignerIdentity,
  releaseEvidenceChecks,
} from '../../scripts/release-evidence-receipt.mjs'

const APP_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const smokeArgs = process.argv.slice(2)
const dialogMode = smokeArgs.includes('--dialogs') || process.env.DSH_NATIVE_HOST_MODE === 'dialogs'
const appInput = smokeArgs.find((argument) => !argument.startsWith('--')) || (process.platform === 'win32'
  ? '../release/win-unpacked'
  : '../release/mac-arm64/DSH Desktop.app')
const packagedLayout = resolvePackagedLayout(appInput)
const { executable, resourcesDir } = packagedLayout
const packagedArtifactPath = resolve(appInput)
const receiptArtifactPath = packagedLayout.platform === 'win32' ? executable : packagedArtifactPath
const featuredManifestPath = join(resourcesDir, 'featured-plugins', 'manifest.json')
const fixture = join(APP_ROOT, 'eval', 'fixtures', 'dsh-native-host-smoke')
const pluginName = '@vibeinging/dsh-native-host-smoke'
const toolName = dialogMode ? 'native_host_file_dialog_smoke' : 'native_host_window_smoke'
const promptText = dialogMode
  ? 'DSH Desktop session-bound native file and directory dialog smoke'
  : 'DSH Desktop session-bound native window Host smoke'
const resultText = dialogMode
  ? 'DSH Desktop native file and directory dialog smoke passed'
  : 'DSH Desktop native window Host smoke passed'
const timeoutMs = Number(process.env.DSH_NATIVE_HOST_TIMEOUT_MS || 180_000)
const defaultResultPath = dialogMode
  ? join(APP_ROOT, 'electron', '.desktop-build', 'evidence', 'native-host-dialogs', 'result.json')
  : ''
const resultPath = String(process.env.DSH_NATIVE_HOST_RESULT_FILE || defaultResultPath).trim()
const keepTemp = process.env.DSH_NATIVE_HOST_KEEP_TEMP === '1'
const tempDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-native-host-'))
const dataRoot = join(tempDir, 'data')
const userDataDir = join(tempDir, 'user-data')
const dialogFile = join(tempDir, 'dialog-file.txt')
const dialogDirectory = join(tempDir, 'dialog-directory')
let expectedDialogFile = dialogFile
let expectedDialogDirectory = dialogDirectory
const serverDir = join(resourcesDir, 'server')
const dshCli = join(serverDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpmBinDir = join(resourcesDir, 'pnpm-bin')
const featuredArtifactDir = join(resourcesDir, 'featured-plugins')
const output = []
const modelObservations = []
const smokeStartedAt = new Date().toISOString()
let appProcess
let cdp
let fakeModel
let toolResult = null
let passed = false

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  await new Promise((resolvePromise) => server.close(resolvePromise))
  if (!address || typeof address === 'string') throw new Error('无法分配 loopback 端口')
  return address.port
}

function baseEnv() {
  const env = {
    ...process.env,
    HOME: join(tempDir, 'home'),
    PATH: systemOnlyPath(),
    DSH_USER_DATA_DIR: userDataDir,
    DSH_DATA_ROOT: dataRoot,
    DSH_AGENT_RUNTIME_HOME: join(tempDir, 'agent-runtime'),
    DSH_SKILLS_ROOT: join(dataRoot, 'skills'),
  }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'DB_SQLITE_PATH', 'INTERMEDIATE_DIR', 'DSH_AGENT_SESSION_DIR', 'DSH_YITRACE_DIR']) {
    delete env[key]
  }
  return env
}

function officialEnv({ offline = false } = {}) {
  return {
    ...baseEnv(),
    PATH: pathWithPackagedBin(pnpmBinDir),
    DSH_HOME: dataRoot,
    DSH_RUNTIME_DISTRIBUTION: 'npm',
    DSH_RUNTIME_HOME: dataRoot,
    DSH_PROFILE_PLUGIN_LIBRARY: join(dataRoot, 'plugin-library'),
    DSH_FEATURED_PLUGIN_TARBALL_DIR: featuredArtifactDir,
    DSH_FEATURED_PLUGIN_MANIFEST: join(featuredArtifactDir, 'manifest.json'),
    DSH_PNPM_BIN_DIR: pnpmBinDir,
    DSH_PNPM_NODE_BIN: executable,
    pnpm_config_store_dir: join(dataRoot, 'plugin-library', 'store'),
    npm_config_store_dir: join(dataRoot, 'plugin-library', 'store'),
    pnpm_config_auto_install_peers: 'false',
    npm_config_auto_install_peers: 'false',
    DSH_PNPM_REQUIRED: '1',
    DSH_RUNTIME_INSTALL_ANCHOR: join(serverDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    ELECTRON_RUN_AS_NODE: '1',
    ...(offline ? { npm_config_offline: 'true', pnpm_config_offline: 'true' } : {}),
  }
}

function runProcess(label, command, args, env, cwd = serverDir) {
  return new Promise((resolveProcess, rejectProcess) => {
    const chunks = []
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => chunks.push(chunk.toString()))
    child.stderr.on('data', (chunk) => chunks.push(chunk.toString()))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectProcess(new Error(`${label} 超时\n${chunks.join('')}`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectProcess(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      const text = chunks.join('')
      if (code === 0) resolveProcess(text)
      else rejectProcess(new Error(`${label} 失败 code=${code} signal=${signal || 'none'}\n${text}`))
    })
  })
}

async function runOfficial(args, label, options = {}) {
  if (!existsSync(dshCli)) throw new Error(`随包 DSH CLI 不存在：${dshCli}`)
  return runProcess(label, executable, [dshCli, ...args], officialEnv(options))
}

async function runPackagedInit() {
  const text = await runProcess('首次启动初始化', executable, [], {
    ...baseEnv(),
    DSH_SMOKE_TEST: '1',
    DSH_SMOKE_TIMEOUT_MS: String(timeoutMs),
  }, process.cwd())
  if (!text.includes('[smoke] 官方 DSH Web 已加载')) throw new Error(`首次启动没有加载官方 Web\n${text}`)
  if (!text.includes('Server 退出 code=0')) throw new Error(`首次启动 Server 没有正常退出\n${text}`)
}

function sseChunk({ model, delta, finishReason = null }) {
  return `data: ${JSON.stringify({
    id: 'dsh-native-host-smoke',
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function startFakeModel() {
  let resolveToolResult;
  let rejectToolResult;
  const toolResultPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveToolResult = resolvePromise;
    rejectToolResult = rejectPromise;
  });
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const body = await readJsonBody(request)
    const messages = Array.isArray(body.messages) ? body.messages : []
    const tools = Array.isArray(body.tools) ? body.tools : []
    const isTitleRequest = messages.some((message) => JSON.stringify(message?.content || '').includes('Create a concise title'))
    modelObservations.push({
      toolNames: tools.map((tool) => tool?.function?.name).filter(Boolean),
      roles: messages.map((message) => message?.role).filter(Boolean),
      toolMessageCount: messages.filter((message) => message?.role === 'tool').length,
    })
    const hasTool = tools.some((tool) => tool?.function?.name === toolName)
    const toolMessages = messages.filter((message) => message?.role === 'tool')
    const toolResultMessage = toolMessages.at(-1)?.content || ''
    response.writeHead(200, {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
    })
    if (isTitleRequest) {
      response.write(sseChunk({
        model: body.model || 'deepseek-v4-flash',
        delta: { role: 'assistant', content: 'DSH Desktop native window Host smoke session' },
      }))
      response.write(sseChunk({
        model: body.model || 'deepseek-v4-flash',
        delta: {},
        finishReason: 'stop',
      }))
    } else if (hasTool && toolMessages.length === 0) {
      response.write(sseChunk({
        model: body.model || 'deepseek-v4-flash',
        delta: {
          role: 'assistant',
          tool_calls: [{
            index: 0,
            id: 'call-dsh-native-host-smoke',
            type: 'function',
            function: { name: toolName, arguments: '{}' },
          }],
        },
      }))
      response.write(sseChunk({
        model: body.model || 'deepseek-v4-flash',
        delta: {},
        finishReason: 'tool_calls',
      }))
    } else {
      toolResult = toolResultMessage
      resolveToolResult(toolResultMessage)
      response.write(sseChunk({
        model: body.model || 'deepseek-v4-flash',
        delta: { role: 'assistant', content: resultText },
      }))
      response.write(sseChunk({
        model: body.model || 'deepseek-v4-flash',
        delta: {},
        finishReason: 'stop',
      }))
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fake DeepSeek 服务没有端口')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
    waitForToolResult: async () => {
      const timer = setTimeout(() => rejectToolResult(new Error(`等待原生 Host 工具结果超时：${JSON.stringify(modelObservations)}`)), timeoutMs)
      try {
        return await toolResultPromise
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

async function waitForTarget(port) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`)
      const targets = await response.json()
      const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
      if (target) return target
    } catch {
      // Electron is still starting.
    }
    await sleep(250)
  }
  throw new Error(`官方 Web CDP 目标启动超时\n${output.join('')}`)
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 0
    this.pending = new Map()
  }

  async open() {
    await new Promise((resolvePromise, reject) => {
      const onOpen = () => {
        this.socket.removeEventListener('error', onError)
        resolvePromise()
      }
      const onError = (event) => {
        this.socket.removeEventListener('open', onOpen)
        reject(new Error(`CDP 连接失败：${event?.message || 'unknown error'}`))
      }
      this.socket.addEventListener('open', onOpen, { once: true })
      this.socket.addEventListener('error', onError, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    try { this.socket.close() } catch { /* already closed */ }
  }
}

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || '官方 Web JS 执行失败')
  return result?.result?.value
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(predicate)) return
    } catch {
      // The page may be between boot phases.
    }
    await sleep(250)
  }
  throw new Error(`等待官方 Web ${label} 超时\n${output.join('')}`)
}

async function rpc(method, payload = {}) {
  const raw = await evaluate(`(() => fetch('/api/${JSON.stringify(method).slice(1, -1)}', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: ${JSON.stringify(method)}, payload: ${JSON.stringify(payload)} }),
  }).then(async (response) => ({ status: response.status, body: await response.text() })))()`)
  if (raw?.status !== 200) throw new Error(`官方 Web RPC ${method} HTTP ${raw?.status || 'unknown'}`)
  const envelope = JSON.parse(raw.body)
  if (!envelope.result?.ok) throw new Error(`官方 Web RPC ${method} 失败：${JSON.stringify(envelope.result?.error || envelope)}`)
  return envelope.result.value
}

async function clickByAria(labels) {
  await waitFor(`Boolean([...document.querySelectorAll('button,[role="button"]')].some((button) => ${JSON.stringify(labels)}.includes(button.getAttribute('aria-label'))))`, `按钮 ${labels.join(' / ')}`)
  const clicked = await evaluate(`(() => {
    const labels = ${JSON.stringify(labels)};
    const target = [...document.querySelectorAll('button')].find((button) => labels.includes(button.getAttribute('aria-label')));
    if (!target) return false;
    target.click();
    return true;
  })()`)
  if (!clicked) {
    const details = await evaluate(`JSON.stringify({
      buttons: [...document.querySelectorAll('button,[role="button"]')].slice(0, 80).map((node) => ({
        aria: node.getAttribute('aria-label'),
        text: (node.innerText || node.textContent || '').trim().slice(0, 120),
      })),
      body: (document.body.innerText || '').slice(0, 2500),
    })`)
    throw new Error(`找不到官方 Web 按钮：${labels.join(' / ')}；页面诊断：${details}；进程输出：${output.join('').slice(-4000)}`)
  }
}

async function fillAndSend(text) {
  await waitFor(`Boolean([...document.querySelectorAll('textarea')].find((textarea) => !textarea.readOnly))`, '会话输入框')
  await evaluate(`(() => {
    const textarea = [...document.querySelectorAll('textarea')].find((item) => !item.readOnly);
    textarea?.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(text)});
    textarea?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
    textarea?.dispatchEvent(new Event('change', { bubbles: true }));
    return Boolean(textarea);
  })()`)
  await waitFor(`([...document.querySelectorAll('textarea')].find((textarea) => !textarea.readOnly)?.value || '') === ${JSON.stringify(text)}`, '输入内容')
  await clickByAria(['发送消息', 'Send message'])
}

try {
  if (!existsSync(fixture)) throw new Error(`缺少测试 Bundle：${fixture}`)
  if (!existsSync(dshCli)) throw new Error(`随包 DSH CLI 不存在：${dshCli}`)
  if (dialogMode) {
    await mkdir(dialogDirectory, { recursive: true })
    await writeFile(dialogFile, 'DSH Desktop native dialog smoke\n', { mode: 0o600 })
    expectedDialogFile = await realpath(dialogFile)
    expectedDialogDirectory = await realpath(dialogDirectory)
  }
  await runPackagedInit()
  await runOfficial(['plugin', '--profile', 'web', 'add', '-w', fixture, '--save-exact', '--ignore-scripts'], `官方安装 ${pluginName}`)
  const manifestPath = join(dataRoot, 'profiles', 'web', 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!manifest.dsh?.profile?.bundles?.includes(pluginName)) throw new Error(`Profile 未安装测试 Bundle：${pluginName}`)

  fakeModel = await startFakeModel()
  const cdpPort = await freePort()
  appProcess = spawn(executable, [`--remote-debugging-port=${cdpPort}`], {
    env: {
      ...baseEnv(),
      DEEPSEEK_API_KEY: 'dsh-native-host-smoke',
      DEEPSEEK_BASE_URL: fakeModel.baseURL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  appProcess.stdout.on('data', (chunk) => output.push(chunk.toString()))
  appProcess.stderr.on('data', (chunk) => output.push(chunk.toString()))
  const target = await waitForTarget(cdpPort)
  cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await waitFor('Boolean(document.querySelector("#root"))', '官方 Web 根节点')
  await evaluate(`(() => {
    for (const text of ['继续', 'Continue', '稍后配置', 'Later']) {
      const target = [...document.querySelectorAll('button,[role="button"]')].find((node) => (node.innerText || node.textContent || '').trim() === text);
      target?.click();
    }
    return true;
  })()`)
  const workspacePath = join(tempDir, 'workspace')
  await mkdir(workspacePath, { recursive: true })
  await rpc('workspace.create', { path: workspacePath })
  await clickByAria(['新建会话', 'New session'])
  await fillAndSend(promptText)
  await waitFor(`(document.body.innerText || '').includes(${JSON.stringify(promptText)})`, '用户消息')
  await fakeModel.waitForToolResult()
  await waitFor(`(document.body.innerText || '').includes(${JSON.stringify(resultText)})`, '原生窗口 Host 结果')
  if (dialogMode) {
    let parsed
    try {
      parsed = JSON.parse(toolResult || '')
    } catch (error) {
      throw new Error(`原生文件对话框工具结果不是 JSON：${error.message}`)
    }
    if (!parsed.files?.filePaths?.includes(expectedDialogFile)
      || !parsed.directory?.filePaths?.includes(expectedDialogDirectory)) {
      throw new Error(`原生文件/目录对话框没有返回测试目标：${JSON.stringify({
        parsed,
        expected: { dialogFile: expectedDialogFile, dialogDirectory: expectedDialogDirectory },
        modelObservations,
        output: output.join('').slice(-4000),
      })}`)
    }
  } else if (!toolResult || !toolResult.includes('"initial"') || !toolResult.includes('"final"')) {
    throw new Error(`原生窗口 Host 工具没有返回完整状态：${JSON.stringify({
        toolResult: toolResult || null,
        modelObservations,
        output: output.join('').slice(-4000),
      })}`)
  }
  await cdp.send('Page.enable')
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const screenshotPath = resultPath ? `${resolve(resultPath)}.png` : ''
  if (screenshotPath) {
    await mkdir(dirname(screenshotPath), { recursive: true })
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'), { mode: 0o600 })
  }
  cdp.close()
  cdp = null
  const runningApp = appProcess
  appProcess = null
  runningApp.kill()
  await new Promise((resolvePromise) => {
    if (runningApp.exitCode !== null) {
      resolvePromise()
      return
    }
    runningApp.once('exit', resolvePromise)
  })
  await runOfficial(['plugin', '--profile', 'web', 'remove', pluginName], `官方卸载 ${pluginName}`, { offline: true })
  const removed = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (removed.dsh?.profile?.bundles?.includes(pluginName) || Object.hasOwn(removed.dependencies || {}, pluginName)) {
    throw new Error(`卸载测试 Bundle 后 Profile 仍包含 ${pluginName}`)
  }
  if (resultPath) {
    const nativeHostMode = dialogMode ? 'dialogs' : 'window'
    const checks = releaseEvidenceChecks('native-host', nativeHostMode)
    await writeFile(resultPath, `${JSON.stringify({
      ...createReleaseEvidenceReceipt({
        kind: 'native-host',
        evidenceLevel: 'packaged-electron-native-host',
        root: APP_ROOT,
        appPath: receiptArtifactPath,
        featuredManifestPath,
        platform: packagedLayout.platform,
        arch: process.arch,
        signerIdentity: readSignerIdentity(executable, process.env, { allowOverride: false }),
        startedAt: smokeStartedAt,
        completedAt: new Date().toISOString(),
        nativeHostMode,
        checks: checks.map((name) => ({ name, passed: true })),
        screenshotRefs: screenshotPath ? [artifactReference(screenshotPath, 'native-host-evidence')] : [],
      }),
      plugin: pluginName,
      lifecycle_checks: checks,
    }, null, 2)}\n`, { mode: 0o600 })
  }
  passed = true
  console.log(dialogMode
    ? `[native-host-smoke] PASS 官方 Web Session 经 DSH Tool 真实调用 Electron file/directory dialog Host，选择测试文件和目录并官方卸载 ${pluginName}`
    : `[native-host-smoke] PASS 官方 Web Session 经 DSH Tool 真实调用 Electron window Host，完成状态/聚焦/最小化/最大化/恢复并官方卸载 ${pluginName}`)
} finally {
  cdp?.close()
  try { appProcess?.kill() } catch { /* ignore */ }
  await fakeModel?.close().catch(() => {})
  if (!passed && resultPath) await rm(resultPath, { force: true }).catch(() => {})
  if (keepTemp) {
    console.warn(`[native-host-smoke] 保留临时目录用于诊断: ${tempDir}`)
  } else {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch((error) => {
      console.warn(`[native-host-smoke] 临时目录清理失败(已忽略): ${error.code || error.message}`)
    })
  }
}
