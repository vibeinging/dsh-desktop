import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolvePackagedLayout } from './packaged-layout.mjs'

const appInput = process.argv[2] || '../release/mac-arm64/DSH Desktop.app'
const { executable } = resolvePackagedLayout(appInput)
const tempDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-official-web-flow-'))
const workspaceDir = join(tempDir, 'workspace')
const screenshotDir = String(process.env.DSH_SCREENSHOT_DIR || '').trim()
const promptText = 'DSH Desktop 官方 Web 流程烟测'
const timeoutMs = Number(process.env.DSH_OFFICIAL_WEB_FLOW_TIMEOUT_MS || 120_000)
const output = []
let child
let cdp

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
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
      // Electron has not opened DevTools yet.
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
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.socket.removeEventListener('error', onError)
        resolve()
      }
      const onError = (event) => {
        this.socket.removeEventListener('open', onOpen)
        reject(new Error(`CDP 连接失败: ${event?.message || 'unknown error'}`))
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
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
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || '官方 Web JS 执行失败')
  }
  return result?.result?.value
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(predicate)) return
    } catch {
      // The page may be between official Web boot phases.
    }
    await sleep(250)
  }
  let diagnostics = null
  try {
    diagnostics = await evaluate(`({
      url: location.href,
      title: document.title,
      body: (document.body?.innerText || '').slice(0, 4000),
      inputs: [...document.querySelectorAll('textarea')].map((item) => ({ value: item.value, readOnly: item.readOnly })),
      sendButtons: [...document.querySelectorAll('button')]
        .filter((button) => ['发送消息', 'Send message'].includes(button.getAttribute('aria-label')))
        .map((button) => ({ disabled: button.disabled, aria: button.getAttribute('aria-label') })),
    })`)
  } catch {
    // The page may have closed while the diagnostic snapshot was requested.
  }
  throw new Error(`等待官方 Web ${label} 超时\n诊断=${JSON.stringify(diagnostics)}\n${output.join('')}`)
}

async function clickTextIfPresent(texts) {
  const serialized = JSON.stringify(texts)
  return evaluate(`(() => {
    const texts = ${serialized};
    const target = [...document.querySelectorAll('button,[role="button"]')]
      .find((element) => texts.includes((element.innerText || element.textContent || '').trim()));
    if (!target) return false;
    target.click();
    return true;
  })()`)
}

async function clickButtonByAria(texts) {
  const serialized = JSON.stringify(texts)
  const clicked = await evaluate(`(() => {
    const labels = ${serialized};
    const target = [...document.querySelectorAll('button')]
      .find((button) => labels.includes(button.getAttribute('aria-label')));
    if (!target) return false;
    target.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`找不到官方 Web 按钮: ${texts.join(' / ')}`)
}

async function rpc(method, payload = {}) {
  const serializedMethod = JSON.stringify(method)
  const serializedPayload = JSON.stringify(payload)
  const raw = await evaluate(`(() => {
    const method = ${serializedMethod};
    const request = {
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method,
      payload: ${serializedPayload},
    };
    return fetch('/api/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }).then(async (response) => ({ status: response.status, body: await response.text() }));
  })()`)
  if (!raw || raw.status !== 200) throw new Error(`官方 Web RPC ${method} HTTP ${raw?.status || 'unknown'}`)
  const envelope = JSON.parse(raw.body)
  if (!envelope.result?.ok) {
    throw new Error(`官方 Web RPC ${method} 失败: ${JSON.stringify(envelope.result?.error || envelope)}`)
  }
  return envelope.result.value
}

async function pageSummary() {
  return evaluate(`({
    body: (document.body.innerText || '').slice(0, 16000),
    title: document.title,
    hasElectronAPI: Boolean(window.electronAPI),
    hasNodeGlobals: typeof process !== 'undefined' || typeof require !== 'undefined' || typeof Buffer !== 'undefined',
    entries: (window.__DSH_BOOT__?.entries || []).map((entry) => entry.id),
  })`)
}

async function captureScreenshot() {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const destination = join(screenshotDir || tempDir, 'official-web-session-flow.png')
  await mkdir(destination.split('/').slice(0, -1).join('/') || '.', { recursive: true })
  await writeFile(destination, Buffer.from(screenshot.data, 'base64'))
  return destination
}

try {
  await mkdir(workspaceDir, { recursive: true })
  const port = await freePort()
  const env = { ...process.env }
  for (const key of ['DEEPSEEK_API_KEY', 'ELECTRON_RUN_AS_NODE', 'DB_SQLITE_PATH', 'INTERMEDIATE_DIR', 'DSH_AGENT_SESSION_DIR', 'DSH_YITRACE_DIR']) {
    delete env[key]
  }
  Object.assign(env, {
    HOME: join(tempDir, 'home'),
    PATH: '/usr/bin',
    DSH_USER_DATA_DIR: join(tempDir, 'user-data'),
    DSH_DATA_ROOT: join(tempDir, 'data'),
    DSH_AGENT_RUNTIME_HOME: join(tempDir, 'agent-runtime'),
    DSH_SKILLS_ROOT: join(tempDir, 'data', 'skills'),
    DSH_SMOKE_TIMEOUT_MS: String(timeoutMs),
  })
  child = spawn(executable, [`--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => output.push(chunk.toString()))
  child.stderr.on('data', (chunk) => output.push(chunk.toString()))

  const target = await waitForTarget(port)
  cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await waitFor(`Boolean(document.querySelector('#root'))`, '根节点')

  const initial = await pageSummary()
  if (initial.hasElectronAPI || initial.hasNodeGlobals) throw new Error('官方 Web 暴露了 Electron/Node 全局')
  if (!initial.entries.includes('@deepseek-ai/dsh-client-ui-conversation')) throw new Error('官方 Web 未加载会话 Client')
  if (!initial.entries.includes('@deepseek-ai/dsh-client-ui-workspace')) throw new Error('官方 Web 未加载工作区 Client')

  await clickTextIfPresent(['继续', 'Continue'])
  await sleep(300)
  await clickTextIfPresent(['稍后配置', 'Later'])
  await waitFor(`Boolean(document.querySelector('#root')) && !document.body.innerText.includes('内部测试')`, '完成首次提示')

  await rpc('workspace.create', { path: workspaceDir })
  await waitFor(`(document.body.innerText || '').includes('workspace')`, '显示工作区')
  await clickButtonByAria(['新建会话', 'New session'])
  await waitFor(`Boolean([...document.querySelectorAll('textarea')].find((textarea) => !textarea.readOnly))`, '会话输入框')
  await evaluate(`(() => { const textarea = [...document.querySelectorAll('textarea')].find((item) => !item.readOnly); textarea?.focus(); return Boolean(textarea); })()`)
  await cdp.send('Input.insertText', { text: promptText })
  await evaluate(`(() => {
    const textarea = [...document.querySelectorAll('textarea')].find((item) => !item.readOnly);
    if (!textarea || textarea.value) return textarea?.value || '';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(promptText)});
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(promptText)} }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return textarea.value;
  })()`)
  await waitFor(`Boolean([...document.querySelectorAll('button')].find((button) => ['发送消息', 'Send message'].includes(button.getAttribute('aria-label')) && !button.disabled))`, '发送按钮可用')
  await clickButtonByAria(['发送消息', 'Send message'])
  await waitFor(`(document.body.innerText || '').includes(${JSON.stringify(promptText)})`, '会话消息')
  await waitFor(`(document.body.innerText || '').includes('Session log') || (document.body.innerText || '').includes('会话日志')`, 'Session log')

  const sessions = await rpc('session.list')
  const session = sessions.items?.find((item) => item.projections?.values?.title === promptText)
  if (!session?.sessionId) throw new Error('官方 Web session.list 没有返回刚创建的会话')
  const history = await rpc('session.history', { sessionId: session.sessionId, maxMessages: 100 })
  if (!JSON.stringify(history).includes(promptText)) throw new Error('官方 Web session.history 没有返回用户消息')

  await clickTextIfPresent(['轨迹', 'Trajectory'])
  await sleep(250)
  await clickTextIfPresent(['对话', 'Conversation'])
  await sleep(250)
  const final = await pageSummary()
  if (final.hasElectronAPI || final.hasNodeGlobals) throw new Error('官方 Web 会话流程中出现 Electron/Node 全局')
  const screenshot = await captureScreenshot()
  console.log(`[smoke] PASS 官方 Web 启动、无 preload/Node、工作区、Session、Session log 和 history 用户流程; session_id=${session.sessionId}; screenshot=${screenshot}`)
  console.log('[smoke] INFO 审批和队列需要带工具调用的 live-model 环境，本次无密钥 smoke 不宣称已覆盖')
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  try { child?.kill() } catch { /* ignore */ }
  try { await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }) } catch (error) {
    console.warn(`[smoke] 临时目录清理失败(已忽略): ${error.code || error.message}`)
  }
}
