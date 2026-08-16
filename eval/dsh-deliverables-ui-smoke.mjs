import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openSession } from './lib/cdp.mjs'
import { makeDriver } from './lib/driver.mjs'
import { makeUiDriver } from './lib/ui-driver.mjs'
import { encodeDshModelRoute } from '../server/src/engine/dsh_runtime/model_route.js'

const evalHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-deliverables-ui-smoke-'))
const workspaceRoot = path.join(evalHome, 'workspace')
const producedName = 'produced-by-dsh.txt'
const producedPath = path.join(workspaceRoot, producedName)
const stamp = Date.now()
const projectName = `DSH 产物验收 ${stamp}`
const conversationTitle = `产物对话 ${stamp}`
const providerId = 'dsh-deliverables-eval'
const modelId = 'dsh-deliverables-model'
const credentialRef = 'DSH_DELIVERABLES_EVAL_API_KEY'
const requests = []
const rendererErrors = []

mkdirSync(workspaceRoot, { recursive: true })
process.env.DSH_EVAL_ISOLATED = '1'
process.env.DSH_EVAL_HOME = evalHome
process.env.DSH_USER_DATA_DIR = path.join(evalHome, 'electron-user-data')

function chatChunk(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function toolName(body, suffix) {
  return (body.tools || [])
    .map((tool) => String(tool?.function?.name || ''))
    .find((name) => name === suffix || name.endsWith(`__${suffix}`)) || ''
}

function streamWrite(response, name) {
  chatChunk(response, {
    id: 'chatcmpl_dsh_deliverable_tool',
    model: modelId,
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: 'call_dsh_deliverable_write',
          type: 'function',
          function: {
            name,
            arguments: JSON.stringify({ file_path: producedName, content: 'turn-tail-ok\n' }),
          },
        }],
      },
      finish_reason: null,
    }],
  })
  chatChunk(response, {
    id: 'chatcmpl_dsh_deliverable_tool',
    model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  })
  response.end('data: [DONE]\n\n')
}

function streamAnswer(response) {
  chatChunk(response, {
    id: 'chatcmpl_dsh_deliverable_answer',
    model: modelId,
    choices: [{ index: 0, delta: { role: 'assistant', content: '产物文件已经生成。' }, finish_reason: null }],
  })
  chatChunk(response, {
    id: 'chatcmpl_dsh_deliverable_answer',
    model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
  })
  response.end('data: [DONE]\n\n')
}

async function startFakeModel() {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'not found' } }))
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    requests.push(body)
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const toolMessages = (body.messages || []).filter((message) => message?.role === 'tool')
    if (toolMessages.length === 0) {
      const name = toolName(body, 'write')
      assert.ok(name, `write is unavailable: ${JSON.stringify(body.tools || [])}`)
      streamWrite(response, name)
      return
    }
    streamAnswer(response)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function apiJson(session, request) {
  return session.evalJs(`
    const response = await window.electronAPI.apiRequest(${JSON.stringify(request)});
    return response.json;
  `, { timeoutMs: 20_000 })
}

let session = null
let fakeModel = null
let providerSaved = false
let projectId = ''
try {
  fakeModel = await startFakeModel()
  session = await openSession({ port: 9361 })
  session.onEvent('Runtime.consoleAPICalled', (event) => {
    const values = (event?.args || []).map((arg) => arg.value ?? arg.description).filter(Boolean)
    if (event?.type === 'error' || values.some((value) => /error|failed|duplicate/i.test(String(value)))) {
      rendererErrors.push(values.map(String).join(' '))
    }
  })
  const driver = makeDriver(session)
  const ui = makeUiDriver(session)
  await driver.login()
  await session.evalJs(`localStorage.setItem('dsh:onboarding:completed:v1', 'true'); return true;`)

  projectId = await driver.ensureProjectRecord(projectName)
  const folders = await driver.raw.api('PUT', `/api/projects/${projectId}/source-folders`, {
    folders: [{ path: workspaceRoot, name: 'workspace', access_mode: 'write', write_target: true }],
  })
  assert.equal(folders.status, 200, JSON.stringify(folders.json))

  const snapshot = await driver.raw.api('GET', '/api/dsh/models')
  const namespace = snapshot.json?.data?.namespaces?.find((item) => item.ns === 'llm-pi-ai')
  const credential = await driver.raw.api('POST', '/api/dsh/models/credentials', {
    ref: credentialRef,
    value: 'dsh-deliverables-key',
  })
  assert.equal(credential.status, 200, JSON.stringify(credential.json))
  const configured = await driver.raw.api('POST', '/api/dsh/models/settings/mutate', {
    ns: 'llm-pi-ai',
    expected_revision: namespace.revision,
    ops: [{
      op: 'set',
      path: ['providers', providerId],
      value: {
        displayName: 'DSH 产物假模型',
        apiKeyEnv: credentialRef,
        api: 'openai-completions',
        baseURL: fakeModel.baseUrl,
        models: [{ id: modelId, name: 'DSH 产物假模型' }],
      },
    }],
  })
  assert.equal(configured.status, 200, JSON.stringify(configured.json))
  providerSaved = true

  const result = await driver.askAgent(projectId, `创建 ${producedName}`, {
    title: conversationTitle,
    model: encodeDshModelRoute(providerId, modelId),
    approval: 'ask',
    autoApprove: true,
  })
  assert.equal(requests.length, 2)
  assert.equal(readFileSync(producedPath, 'utf8'), 'turn-tail-ok\n')
  const trajectory = await driver.raw.api('GET', `/api/agent/projects/${projectId}/threads/${result.sid}/dsh-trajectory`)
  assert.equal(trajectory.status, 200, JSON.stringify(trajectory.json))

  await session.cdp('Page.reload', { ignoreCache: true }, { timeoutMs: 10_000 })
  try {
    await ui.waitFor('[data-testid="agent-message-input"]', { timeout: 30_000 })
  } catch (error) {
    const page = await session.evalJs(`return { text: document.body.innerText.slice(0, 4000), html: document.body.innerHTML.slice(0, 4000) }`).catch(() => null)
    console.error('[dsh-deliverables-ui-smoke] boot diagnostics', JSON.stringify({ rendererErrors, page }))
    throw error
  }
  const inputCount = await session.evalJs(`return document.querySelectorAll('[data-testid="agent-message-input"]').length`)
  assert.equal(inputCount, 1, 'the product must keep one visible composer')
  assert.equal(
    rendererErrors.some((message) => /failed to apply|duplicate hook|already declared/i.test(message)),
    false,
    JSON.stringify(rendererErrors)
  )
  await ui.waitFor(`[data-agent-workspace-id="${projectId}"]`, { timeout: 15_000 })
  const conversationVisible = await session.evalJs(`return Boolean(document.querySelector(${JSON.stringify(`[data-agent-conv-id="${result.sid}"]`)}))`)
  if (!conversationVisible) await ui.click(`[data-agent-workspace-id="${projectId}"]`)
  await ui.waitFor(`[data-agent-conv-id="${result.sid}"]`, { timeout: 15_000 })
  await ui.click(`[data-agent-conv-id="${result.sid}"]`)
  await ui.waitUntil(`async () => document.body.innerText.includes('产物文件已经生成。')`, {
    timeout: 20_000,
    label: 'DSH 产物回答恢复完成',
  })
  let tail
  try {
    tail = await ui.waitUntil(`async () => {
      const row = document.querySelector('[data-produced-files-row]');
      const host = row?.closest('[data-dsh-turn-tail]');
      const button = row?.querySelector('button');
      if (!row || !host || !button) return false;
      return {
        text: row.textContent || '',
        turn: host.getAttribute('data-dsh-turn') || '',
        seq: host.getAttribute('data-dsh-closing-seq') || '',
        label: button.getAttribute('aria-label') || ''
      };
    }`, { timeout: 15_000, label: '官方 produced-files turnTail 进入现有回答尾部' })
  } catch (error) {
    const diagnostics = await session.evalJs(`return {
      anchors: [...document.querySelectorAll('[data-dsh-turn-tail]')].map((element) => ({
        turn: element.getAttribute('data-dsh-turn'),
        seq: element.getAttribute('data-dsh-closing-seq'),
        html: element.innerHTML.slice(0, 1000)
      })),
      owners: document.querySelectorAll('[data-dsh-standard-turn-tail-owner]').length,
      missingTurns: [...document.querySelectorAll('[data-dsh-missing-turn]')].map((element) => ({
        turn: element.getAttribute('data-dsh-missing-turn'),
        available: element.getAttribute('data-dsh-available-turns')
      })),
      deliverablesStyle: Boolean(document.querySelector('style[data-plugin*="ui-deliverables"]')),
      bootEntries: JSON.stringify(window.__DSH_BOOT__ || {}).includes('ui-deliverables'),
      text: document.body.innerText.slice(0, 4000)
    }`)
    console.error('[dsh-deliverables-ui-smoke] diagnostics', JSON.stringify({
      ...diagnostics,
      events: (trajectory.json?.data?.events || []).map((entry) => ({
        type: entry?.type || entry?.event?.type,
        data: entry?.data || entry?.event?.data,
        view: entry?.view
      })).filter((entry) => ['tool/call', 'tool/result'].includes(entry.type))
    }))
    throw error
  }
  assert.ok(tail.text.includes(producedName), JSON.stringify(tail))
  assert.ok(Number.isInteger(Number(tail.turn)), JSON.stringify(tail))
  assert.ok(Number.isInteger(Number(tail.seq)), JSON.stringify(tail))

  await ui.click('[data-produced-files-row] button')
  await ui.waitFor('[data-workbench-tab="files"][aria-selected="true"]', { timeout: 10_000 })
  await ui.waitUntil(`async () => document.body.innerText.includes('turn-tail-ok')`, {
    timeout: 15_000,
    label: '官方产物动作打开现有 Files 工作台',
  })

  console.log('[dsh-deliverables-ui-smoke] PASS 官方 turnTail + produced files + 现有 Files 工作台')
} finally {
  if (session && providerSaved) {
    await apiJson(session, {
      method: 'POST',
      url: '/api/dsh/models/settings/mutate',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', providerId] }] }),
    }).catch(() => null)
  }
  if (session) await apiJson(session, {
    method: 'DELETE',
    url: `/api/dsh/models/credentials/${encodeURIComponent(credentialRef)}`,
    headers: {},
    body: null,
  }).catch(() => null)
  try { await session?.close() } catch { /* ignore */ }
  try { await fakeModel?.close() } catch { /* ignore */ }
  try { rmSync(evalHome, { recursive: true, force: true }) } catch { /* ignore */ }
}
