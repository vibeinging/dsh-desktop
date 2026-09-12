import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolvePackagedLayout } from './packaged-layout.mjs'
import { systemOnlyPath } from './packaged-smoke-environment.mjs'
import { findOfficialWebCdpTarget } from './official-web-cdp-target.mjs'
import {
  createOfficialWebSessionFollowFrame,
  createOfficialWebUnaryRequest,
} from './official-web-runtime-api.mjs'
import {
  createLiveModelEvidenceReceipt,
  inspectLiveModelHistory,
} from '../../scripts/live-model-evidence.mjs'

const appInput = process.argv[2] || '../release/mac-arm64/DSH Desktop.app'
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { executable, resourcesDir } = resolvePackagedLayout(appInput)
const featuredManifestPath = join(resourcesDir, 'featured-plugins', 'manifest.json')
const tempDir = await mkdtemp(join(tmpdir(), 'dsh-packaged-official-web-flow-'))
const workspaceDir = join(tempDir, 'workspace')
const approvalMarkerPath = join(tempDir, 'approval-marker')
const screenshotDir = String(process.env.DSH_SCREENSHOT_DIR || '').trim()
const liveModelResultPath = String(process.env.DSH_LIVE_MODEL_RESULT_FILE || '').trim()
const keepTemp = process.env.DSH_OFFICIAL_WEB_FLOW_KEEP_TEMP === '1'
const fakeModelEnabled = process.env.DSH_OFFICIAL_WEB_FLOW_FAKE_MODEL === '1' || process.argv.includes('--fake-model')
const liveModelEnabled = process.env.DSH_OFFICIAL_WEB_FLOW_LIVE_MODEL === '1' || process.argv.includes('--live-model')
const showcaseModelEnabled = process.env.DSH_OFFICIAL_WEB_FLOW_SHOWCASE_MODEL === '1' || process.argv.includes('--showcase-model')
const realModelEnabled = liveModelEnabled || showcaseModelEnabled
const liveModelResponseMarker = liveModelEnabled ? `DSH-LIVE-MODEL-${randomUUID()}` : ''
const showcaseResponseMarker = 'DSH Desktop'
const promptText = fakeModelEnabled
  ? 'DSH Desktop 官方 Web 审批烟测'
  : liveModelEnabled
    ? `DSH Desktop 官方 Web live-model 烟测。请用一句完整的话确认当前会话已启动，并原样包含唯一回执标记 ${liveModelResponseMarker}。`
    : showcaseModelEnabled
      ? '请用一句话说说 DSH Desktop 能怎样帮助我的开发工作，并举三个例子。'
      : 'DSH Desktop 官方 Web 流程烟测'
const queuedPromptText = 'DSH Desktop 官方 Web 排队烟测'
const questionText = '是否继续执行审批烟测？'
const questionOptionText = '继续执行'
const approvalResultText = 'DSH Desktop 官方 Web 审批已完成：approved'
const queuedResultText = 'DSH Desktop 官方 Web 排队已完成'
const timeoutMs = Number(process.env.DSH_OFFICIAL_WEB_FLOW_TIMEOUT_MS || 120_000)
const output = []
let child
let cdp
let fakeModel
let interactionScreenshots = []
let liveModelResultWritten = false
const smokeStartedAt = new Date().toISOString()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function approvalMarkerCommand(toolName) {
  if (toolName === 'pwsh') {
    const literalPath = `'${approvalMarkerPath.replaceAll("'", "''")}'`
    return `Set-Content -LiteralPath ${literalPath} -Value 'approved'`
  }
  return `printf 'approved\\n' > ${JSON.stringify(approvalMarkerPath)}`
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

function fakeSseChunk({ model, delta, finishReason = null }) {
  return `data: ${JSON.stringify({
    id: 'dsh-desktop-official-web-smoke',
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function startFakeModel() {
  let resolveToolRequest
  let rejectToolRequest
  let releaseToolRequest
  const toolRequest = new Promise((resolve, reject) => {
    resolveToolRequest = resolve
    rejectToolRequest = reject
  })
  const release = new Promise((resolve) => {
    releaseToolRequest = resolve
  })
  const requests = []
  let toolCallCount = 0
  let questionSent = false
  let shellToolSent = false
  let selectedShellTool = null
  let escalationSent = false
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions') {
      response.writeHead(404).end()
      return
    }
    try {
      const body = await readRequestBody(request)
      const messages = Array.isArray(body.messages) ? body.messages : []
      const tools = Array.isArray(body.tools) ? body.tools : []
      const lastUserText = [...messages].reverse().find((message) => message?.role === 'user')?.content || ''
      const hasPrompt = messages.some((message) => String(message?.content || '').includes(promptText))
      const hasToolResult = messages.some((message) => message?.role === 'tool')
      const shellToolName = tools
        .map((tool) => tool?.function?.name)
        .find((name) => name === 'bash' || name === 'pwsh')
      const hasAskQuestionTool = tools.some((tool) => tool?.function?.name === 'ask_user_question')
      const toolResultText = messages.filter((message) => message?.role === 'tool').map((message) => message.content || '').join('\n')
      const isInitialQuestionRequest = !questionSent && !hasToolResult && hasAskQuestionTool && hasPrompt
      const isShellRequest = questionSent && !shellToolSent && hasToolResult && Boolean(shellToolName)
      const isEscalationRequest = shellToolSent && toolCallCount === 1 && hasToolResult
      const record = {
        shellToolName,
        hasAskQuestionTool,
        hasToolResult,
        questionAnswered: hasToolResult && toolResultText.includes(questionOptionText),
        toolNames: tools.map((tool) => tool?.function?.name),
        lastUserText: String(lastUserText),
        messageRoles: messages.map((message) => message?.role),
      }
      requests.push(record)
      response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
      })
      if (isInitialQuestionRequest) {
        questionSent = true
        resolveToolRequest(record)
        await release
        const argumentsText = JSON.stringify({
          questions: [{
            id: 'approval-choice',
            header: 'Approval smoke',
            question: questionText,
            options: [
              { label: questionOptionText, description: '继续执行后续审批和工具 smoke。' },
              { label: '停止执行', description: '停止本次 smoke。' },
            ],
            multi_select: false,
          }],
        })
        response.write(fakeSseChunk({
          model: body.model || 'deepseek-v4-flash',
          delta: {
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call-dsh-desktop-question-smoke',
              type: 'function',
              function: { name: 'ask_user_question', arguments: argumentsText },
            }],
          },
        }))
        response.write(fakeSseChunk({
          model: body.model || 'deepseek-v4-flash',
          delta: {},
          finishReason: 'tool_calls',
        }))
      } else if (isShellRequest) {
        shellToolSent = true
        selectedShellTool = shellToolName
        toolCallCount += 1
        const argumentsText = JSON.stringify({
          command: approvalMarkerCommand(selectedShellTool),
          description: 'Print approval smoke result',
        })
        response.write(fakeSseChunk({
          model: body.model || 'deepseek-v4-flash',
          delta: {
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call-dsh-desktop-approval-smoke',
              type: 'function',
              function: { name: selectedShellTool, arguments: argumentsText },
            }],
          },
        }))
        response.write(fakeSseChunk({
          model: body.model || 'deepseek-v4-flash',
          delta: {},
          finishReason: 'tool_calls',
        }))
      } else if (isEscalationRequest) {
        toolCallCount += 1
        escalationSent = true
        const argumentsText = JSON.stringify({
          command: approvalMarkerCommand(selectedShellTool),
          description: 'Print approval smoke result',
          sandbox_permissions: 'danger-full-access',
          justification: 'The smoke test writes one temporary marker outside the workspace.',
        })
        response.write(fakeSseChunk({
          model: body.model || 'deepseek-v4-flash',
          delta: {
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call-dsh-desktop-approval-smoke-escalation',
              type: 'function',
              function: { name: selectedShellTool, arguments: argumentsText },
            }],
          },
        }))
        response.write(fakeSseChunk({
          model: body.model || 'deepseek-v4-flash',
          delta: {},
          finishReason: 'tool_calls',
        }))
      } else {
        const content = hasToolResult
          ? (String(lastUserText).includes(queuedPromptText) ? queuedResultText : approvalResultText)
          : 'DSH Desktop 官方 Web smoke 标题'
        response.write(fakeSseChunk({
          model: body.model || 'deepseek-v4-flash',
          delta: { role: 'assistant', content },
        }))
        response.write(fakeSseChunk({
          model: body.model || 'deepseek-v4-flash',
          delta: {},
          finishReason: 'stop',
        }))
      }
      response.end('data: [DONE]\n\n')
    } catch (error) {
      rejectToolRequest(error)
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('本地 fake DeepSeek 服务没有分配端口')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
    get shellToolSent() { return shellToolSent },
    get selectedShellTool() { return selectedShellTool },
    get escalationSent() { return escalationSent },
    get questionAnswered() { return requests.some((request) => request.questionAnswered) },
    get questionSent() { return questionSent },
    waitForToolRequest: async () => {
      const timer = setTimeout(() => rejectToolRequest(new Error(`等待 fake DeepSeek 工具请求超时: ${JSON.stringify(requests)}`)), timeoutMs)
      try {
        return await toolRequest
      } finally {
        clearTimeout(timer)
      }
    },
    releaseToolRequest: () => releaseToolRequest(),
    close: () => {
      releaseToolRequest()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

async function waitForTarget(port) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`)
      const targets = await response.json()
      const target = findOfficialWebCdpTarget(targets)
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
      inputs: [...document.querySelectorAll('[data-composer-input]')].map((item) => ({ text: item.textContent, editable: item.contentEditable })),
      queueDocks: document.querySelectorAll('[data-queue-dock]').length,
      approvals: document.querySelectorAll('[data-approval-key]').length,
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

async function dismissPrompt({ labels, bodyNeedles, description }) {
  const startedAt = Date.now()
  const deadline = startedAt + 15_000
  let observed = false
  let latest = null
  while (Date.now() < deadline) {
    latest = await evaluate(`(() => {
      const labels = new Set(${JSON.stringify(labels)});
      const bodyNeedles = ${JSON.stringify(bodyNeedles)};
      const body = document.body.innerText || '';
      const present = bodyNeedles.some((needle) => body.includes(needle));
      if (!present) return { present: false, button: null };
      const target = [...document.querySelectorAll('button,[role="button"]')].find((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || '').trim();
        return rect.width > 0 && rect.height > 0 && !element.disabled && labels.has(text);
      });
      target?.click();
      return { present: true, button: target ? (target.innerText || target.textContent || '').trim() : null };
    })()`)
    if (latest?.present) observed = true
    else if (observed || Date.now() - startedAt >= 5_000) return
    await sleep(200)
  }
  throw new Error(`${description}未在超时前关闭: ${JSON.stringify(latest)}`)
}

async function dismissOfficialPrompts() {
  await dismissPrompt({
    labels: ['继续', 'Continue'],
    bodyNeedles: ['内测声明', 'Internal testing'],
    description: '官方 Web 首次提示',
  })
  await dismissPrompt({
    labels: ['稍后配置', 'Later'],
    bodyNeedles: ['添加一个 API Key 开始使用', 'Add an API Key to get started'],
    description: '官方 Web 模型配置提示',
  })
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
  if (method === 'session.history') return readSessionHistory(payload)
  const request = createOfficialWebUnaryRequest(method, payload, randomUUID())
  const raw = await evaluate(`(() => {
    const request = ${JSON.stringify(request.body)};
    return fetch(${JSON.stringify(`/api/${request.endpoint}`)}, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }).then(async (response) => ({ status: response.status, body: await response.text() }));
  })()`)
  if (!raw || raw.status !== 200) throw new Error(`官方 Web RPC ${method} HTTP ${raw?.status || 'unknown'}`)
  const envelope = JSON.parse(raw.body)
  if (envelope.rpcId !== request.body.rpcId) throw new Error(`官方 Web RPC ${method} 返回了错误 rpcId`)
  if (!envelope.result?.ok) {
    throw new Error(`官方 Web RPC ${method} 失败: ${JSON.stringify(envelope.result?.error || envelope)}`)
  }
  return envelope.result.value
}

async function readSessionHistory(payload) {
  const streamId = randomUUID()
  const frame = createOfficialWebSessionFollowFrame({
    sessionId: String(payload.sessionId || ''),
    maxMessages: payload.maxMessages,
    streamId,
  })
  const raw = await evaluate(`(() => new Promise((resolve) => {
    const streamId = ${JSON.stringify(streamId)};
    const socketUrl = new URL('/api/remote.mux', location.href);
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(socketUrl);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'session/follow timeout' }), 20000);
    socket.addEventListener('open', () => socket.send(${JSON.stringify(JSON.stringify(frame))}));
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.streamId !== streamId) return;
      if (message.type === 'item') {
        try { socket.send(JSON.stringify({ type: 'cancel', streamId })); } catch {}
        finish({ ok: true, value: message.value });
      } else if (message.type === 'error') {
        finish({ ok: false, error: message.error?.message || 'session/follow error' });
      } else if (message.type === 'end') {
        finish({ ok: false, error: 'session/follow ended without snapshot' });
      }
    });
    socket.addEventListener('error', () => finish({ ok: false, error: 'session/follow websocket error' }));
  }))()`)
  if (!raw?.ok || raw.value?.type !== 'snapshot') {
    throw new Error(`官方 Web session/follow 失败: ${raw?.error || JSON.stringify(raw?.value || raw)}`)
  }
  return {
    events: Array.isArray(raw.value.records) ? raw.value.records : [],
    hasMore: raw.value.hasMore === true,
    projections: raw.value.projections,
  }
}

async function findSmokeSession() {
  const deadline = Date.now() + timeoutMs
  let lastLiveErrors = []
  while (Date.now() < deadline) {
    const sessions = await rpc('session.list')
    for (const candidate of [...(sessions.items || [])].reverse()) {
      if (!candidate?.sessionId) continue
      const candidateHistory = await rpc('session.history', { sessionId: candidate.sessionId, maxMessages: 100 })
      const serialized = JSON.stringify(candidateHistory)
      if (!serialized.includes(promptText)) continue
      if (!realModelEnabled) {
        return { session: candidate, history: candidateHistory, liveCheck: null }
      }
      const liveCheck = inspectLiveModelHistory(candidateHistory, {
        responseMarker: liveModelEnabled ? liveModelResponseMarker : showcaseResponseMarker,
      })
      if (liveCheck.ok) return { session: candidate, history: candidateHistory, liveCheck }
      lastLiveErrors = liveCheck.errors
      if (liveCheck.terminalFailure || liveCheck.completed) {
        throw new Error(`真实 DeepSeek live-model 已结束但未满足成功契约：${liveCheck.errors.join('；')}`)
      }
    }
    await sleep(500)
  }
  throw new Error(`官方 Web session.history 未在超时前形成可验收会话${realModelEnabled ? `；real-model=${lastLiveErrors.join('；')}` : ''}`)
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

async function captureScreenshot(name = 'official-web-session-flow.png') {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const destination = join(screenshotDir || tempDir, name)
  await mkdir(destination.split('/').slice(0, -1).join('/') || '.', { recursive: true })
  await writeFile(destination, Buffer.from(screenshot.data, 'base64'))
  return destination
}

async function fillComposer(text) {
  const selector = '[data-composer-input][contenteditable="true"]'
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, '会话输入框')
  await evaluate(`(() => {
    const editor = document.querySelector(${JSON.stringify(selector)});
    editor?.focus();
    return Boolean(editor);
  })()`)
  await cdp.send('Input.insertText', { text })
  // CDP insertText can be a no-op on some platforms (notably Windows runners). Fall
  // back to the contenteditable command so the composer still receives the text and
  // the Send button becomes enabled, matching the v0.2.0 textarea fallback behaviour.
  await evaluate(`(() => {
    const editor = document.querySelector(${JSON.stringify(selector)});
    if (!editor || (editor.textContent || '').trim() === ${JSON.stringify(text)}) return (editor?.textContent || '').trim();
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const inserted = document.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!inserted && (editor.textContent || '').trim() !== ${JSON.stringify(text)}) {
      editor.textContent = ${JSON.stringify(text)};
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
    }
    return (editor.textContent || '').trim();
  })()`)
  await waitFor(`(document.querySelector(${JSON.stringify(selector)})?.textContent || '').trim() === ${JSON.stringify(text)}`, '输入内容')
}

async function clearComposer() {
  const selector = '[data-composer-input][contenteditable="true"]'
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', commands: ['deleteBackward'] })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' })
  await waitFor(`!(document.querySelector(${JSON.stringify(selector)})?.textContent || '').trim()`, '清空输入内容')
}

try {
  if (liveModelResultPath) await rm(liveModelResultPath, { force: true })
  if (fakeModelEnabled && realModelEnabled) throw new Error('不能同时启用 fake-model 和真实模型')
  if (liveModelEnabled && showcaseModelEnabled) throw new Error('不能同时启用 live-model 和 showcase-model')
  if (realModelEnabled && !String(process.env.DEEPSEEK_API_KEY || '').trim()) {
    throw new Error('真实模型流程需要用户主动提供 DEEPSEEK_API_KEY；当前没有发送请求')
  }
  await mkdir(workspaceDir, { recursive: true })
  if (fakeModelEnabled) fakeModel = await startFakeModel()
  const port = await freePort()
  const env = { ...process.env }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'DB_SQLITE_PATH', 'INTERMEDIATE_DIR', 'DSH_AGENT_SESSION_DIR', 'DSH_YITRACE_DIR']) {
    delete env[key]
  }
  if (fakeModelEnabled) {
    env.DEEPSEEK_API_KEY = 'dsh-desktop-official-web-smoke'
    env.DEEPSEEK_BASE_URL = fakeModel.baseURL
  } else if (!realModelEnabled) {
    delete env.DEEPSEEK_API_KEY
    delete env.DEEPSEEK_BASE_URL
  }
  Object.assign(env, {
    HOME: join(tempDir, 'home'),
    PATH: systemOnlyPath(),
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

  await dismissOfficialPrompts()

  await rpc('workspace.create', { path: workspaceDir })
  await waitFor(`(document.body.innerText || '').includes('workspace')`, '显示工作区')
  await clickButtonByAria(['新建会话', 'New session'])
  // The official Web renders its onboarding notices asynchronously; on slower
  // runners (Windows CI) they can appear after the first dismiss pass has already
  // given up. Dismiss again once the workspace and composer are actually present so
  // the modal overlay never swallows composer focus or leaves Send disabled.
  await dismissOfficialPrompts()
  await fillComposer(promptText)
  await waitFor(`Boolean([...document.querySelectorAll('button')].find((button) => ['发送消息', 'Send message'].includes(button.getAttribute('aria-label')) && !button.disabled))`, '发送按钮可用')
  await clickButtonByAria(['发送消息', 'Send message'])
  await waitFor(`(document.body.innerText || '').includes(${JSON.stringify(promptText)})`, '会话消息')
  if (fakeModelEnabled) {
    await fakeModel.waitForToolRequest()
    const runningSessions = await rpc('session.list')
    const queueSession = [...(runningSessions.items || [])].reverse()[0]
    if (!queueSession?.sessionId) throw new Error('官方 Web session.list 没有返回运行中的会话，无法测试 queue RPC')
    const queued = await rpc('session.prompt', {
      sessionId: queueSession.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: queuedPromptText }],
    })
    if (!queued?.accepted) throw new Error(`官方 Web queue prompt 没有返回 accepted: ${JSON.stringify(queued)}`)
    output.push(`[smoke] DEBUG 官方 queue RPC accepted; session_id=${queueSession.sessionId}; sessions=${JSON.stringify(runningSessions.items?.map((item) => ({ sessionId: item.sessionId, title: item.projections?.values?.title })) || [])}`)
    await waitFor(`Boolean(document.querySelector('[data-queue-dock]')) && (document.body.innerText || '').includes(${JSON.stringify(queuedPromptText)})`, '官方消息队列')
    const queuedScreenshot = await captureScreenshot('official-web-approval-queue.png')
    fakeModel.releaseToolRequest()
    await waitFor(`Boolean(document.querySelector('[data-question-key]')) && (document.body.innerText || '').includes(${JSON.stringify(questionText)})`, '官方问题面板')
    const question = await evaluate(`({
      card: Boolean(document.querySelector('[data-question-key]')),
      option: [...document.querySelectorAll('button,[role="radio"]')].some((button) => (button.getAttribute('aria-label') || button.innerText || '').trim() === ${JSON.stringify(questionOptionText)}),
      body: (document.body.innerText || '').slice(-3000),
    })`)
    if (!question.card || !question.option) throw new Error(`官方 Web 问题面板缺少预期选项: ${JSON.stringify(question)}`)
    const questionScreenshot = await captureScreenshot('official-web-question-pending.png')
    interactionScreenshots = [queuedScreenshot, questionScreenshot]
    await clickButtonByAria([questionOptionText])
    await waitFor(`Boolean(document.querySelector('[data-question-key]')) && [...document.querySelectorAll('button')].some((button) => !button.disabled && ['提交', 'Submit', 'submit'].includes((button.innerText || '').trim()))`, '问题提交按钮')
    if (!await clickTextIfPresent(['提交', 'Submit', 'submit'])) throw new Error('找不到官方 Web 问题提交按钮')
    await waitFor(`!document.querySelector('[data-question-key]')`, '问题回答完成')
    await waitFor(`Boolean(document.querySelector('[data-approval-key]'))`, '官方审批面板')
    const approval = await evaluate(`({
      detail: Boolean(document.querySelector('[aria-label="审批详情"],[aria-label="Approval details"]')),
      allow: [...document.querySelectorAll('button')].some((button) => ['允许一次', 'Allow once'].includes((button.innerText || '').trim())),
      reject: [...document.querySelectorAll('button')].some((button) => ['拒绝', 'Reject'].includes((button.innerText || '').trim())),
      body: (document.body.innerText || '').slice(-3000),
    })`)
    if (!approval.detail || !approval.allow || !approval.reject) throw new Error(`官方 Web 审批面板缺少完整控件: ${JSON.stringify(approval)}`)
    const approvalScreenshot = await captureScreenshot('official-web-approval-pending.png')
    interactionScreenshots = [queuedScreenshot, questionScreenshot, approvalScreenshot]
    if (!await clickTextIfPresent(['允许一次', 'Allow once'])) throw new Error('找不到官方 Web 允许一次按钮')
    await waitFor(`(document.body.innerText || '').includes(${JSON.stringify(approvalResultText)})`, '审批后的模型结果')
    await waitFor(`(document.body.innerText || '').includes(${JSON.stringify(queuedResultText)})`, '排队消息的模型结果')
    await waitFor(`!document.querySelector('[data-queue-dock]')`, '排队消息完成')
    await access(approvalMarkerPath)
    if ((await readFile(approvalMarkerPath, 'utf8')).trim() !== 'approved') throw new Error('审批后的 shell 命令没有写入预期临时文件')
    const requestSummary = {
      questionRequest: fakeModel.questionSent,
      questionAnswer: fakeModel.questionAnswered,
      toolRequest: fakeModel.shellToolSent,
      shellTool: fakeModel.selectedShellTool,
      toolResult: fakeModel.requests.some((request) => request.hasToolResult),
      queuedPrompt: fakeModel.requests.some((request) => request.lastUserText.includes(queuedPromptText)),
      escalation: fakeModel.escalationSent,
    }
    if (!requestSummary.questionRequest || !requestSummary.questionAnswer || !requestSummary.toolRequest || !['bash', 'pwsh'].includes(requestSummary.shellTool) || !requestSummary.toolResult || !requestSummary.queuedPrompt || !requestSummary.escalation) {
      throw new Error(`fake DeepSeek 没有形成完整问题/审批/队列请求链: ${JSON.stringify(requestSummary)}`)
    }
    output.push(`[smoke] INFO 问题/审批/队列请求链已由本地 fake DeepSeek 驱动; queue_screenshot=${queuedScreenshot}; question_screenshot=${questionScreenshot}; approval_screenshot=${approvalScreenshot}`)
  }
  await waitFor(`['Session log', 'Session 日志', '会话日志', '轨迹', 'Trajectory'].some((label) => (document.body.innerText || '').includes(label))`, 'Session log')

  const smokeSession = await findSmokeSession()
  const session = smokeSession.session
  const history = smokeSession.history
  if (!session?.sessionId) throw new Error('官方 Web session.list 没有返回刚创建的会话')
  if (!JSON.stringify(history).includes(promptText)) throw new Error('官方 Web session.history 没有返回用户消息')
  if (fakeModelEnabled && !JSON.stringify(history).includes(queuedPromptText)) throw new Error('官方 Web session.history 没有返回排队后的用户消息')

  await clickTextIfPresent(['轨迹', 'Trajectory'])
  await sleep(250)
  await clickTextIfPresent(['对话', 'Conversation'])
  await sleep(250)
  if (showcaseModelEnabled) await clearComposer()
  const final = await pageSummary()
  if (final.hasElectronAPI || final.hasNodeGlobals) throw new Error('官方 Web 会话流程中出现 Electron/Node 全局')
  const screenshot = await captureScreenshot()
  if (liveModelEnabled && liveModelResultPath) {
    await mkdir(dirname(liveModelResultPath), { recursive: true })
    await writeFile(liveModelResultPath, `${JSON.stringify(createLiveModelEvidenceReceipt({
      root: APP_ROOT,
      appPath: appInput,
      screenshot,
      featuredManifestPath,
      startedAt: smokeStartedAt,
      completedAt: new Date().toISOString(),
      history,
      responseMarker: liveModelResponseMarker,
    }), null, 2)}\n`, { mode: 0o600 })
    liveModelResultWritten = true
  }
  console.log(`[smoke] PASS 官方 Web 启动、无 preload/Node、工作区、Session、Session log 和 history 用户流程${fakeModelEnabled ? '、问题、审批、允许一次和消息队列' : ''}${liveModelEnabled ? '、真实 DeepSeek live-model' : ''}${showcaseModelEnabled ? '、真实 DeepSeek 展示对话' : ''}; session_id=${session.sessionId}; screenshot=${screenshot}`)
  if (fakeModelEnabled) console.log(`[smoke] INFO 审批/队列截图=${interactionScreenshots.join(', ')}`)
  if (!fakeModelEnabled && !realModelEnabled) console.log('[smoke] INFO 审批和队列需要带工具调用的 live-model 环境，本次无密钥 smoke 不宣称已覆盖')
  if (realModelEnabled) console.log('[smoke] INFO 真实模型凭据仅用于本次临时流程，未写入 Profile 或截图')
} finally {
  if (liveModelResultPath && !liveModelResultWritten) {
    try { await rm(liveModelResultPath, { force: true }) } catch { /* stale evidence must not survive a failed smoke */ }
  }
  try { cdp?.close() } catch { /* ignore */ }
  try { child?.kill() } catch { /* ignore */ }
  try { await fakeModel?.close() } catch { /* ignore */ }
  if (keepTemp) {
    console.log(`[smoke] INFO 保留诊断目录=${tempDir}`)
  } else {
    try { await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }) } catch (error) {
      console.warn(`[smoke] 临时目录清理失败(已忽略): ${error.code || error.message}`)
    }
  }
}
