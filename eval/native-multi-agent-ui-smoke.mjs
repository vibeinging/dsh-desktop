import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openSession } from './lib/cdp.mjs'
import { makeDriver } from './lib/driver.mjs'
import { makeUiDriver } from './lib/ui-driver.mjs'
import { encodeDshModelRoute } from '../server/src/engine/dsh_runtime/model_route.js'

const evalHome = mkdtempSync(path.join(os.tmpdir(), 'native-multi-agent-ui-smoke-'))
const stamp = Date.now()
const conversationTitle = `DSH 协作验收 ${stamp}`
const parentPrompt = `委派一个子任务并等待它完成-${stamp}`
const childPrompt = `只返回子任务完成口令 child-ui-${stamp}`
const childAnswer = `child-ui-done-${stamp}`
const parentAnswer = `parent-ui-done-${stamp}`
const questionPrompt = `使用官方提问工具让我选择验收结果-${stamp}`
const questionText = `官方 Composer Chain 是否已经接管输入区-${stamp}`
const questionOption = `已经接管-${stamp}`
const questionAnswer = `question-ui-done-${stamp}`
const skillName = `desktop-skill-${stamp}`
const skillPromptTail = `使用官方 Skill 完成验收-${stamp}`
const skillPrompt = `/${skillName} ${skillPromptTail}`
const skillAnswer = `skill-ui-done-${stamp}`
const providerId = 'native-multi-agent-ui-eval'
const modelId = 'native-multi-agent-ui-model'
const credentialRef = 'NATIVE_MULTI_AGENT_UI_API_KEY'
const modelRoute = encodeDshModelRoute(providerId, modelId)

process.env.DSH_EVAL_ISOLATED = '1'
process.env.DSH_EVAL_HOME = evalHome
process.env.DSH_USER_DATA_DIR = path.join(evalHome, 'electron-user-data')

const skillDirectory = path.join(evalHome, '.dsh', 'skills', skillName)
mkdirSync(skillDirectory, { recursive: true })
writeFileSync(path.join(skillDirectory, 'SKILL.md'), [
  '---',
  `name: ${skillName}`,
  'description: 验证桌面端使用 DSH 原生 Skill 目录和输入源',
  '---',
  '',
  '按用户要求返回验收结果。',
  '',
].join('\n'))

function chatChunk(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content || '')
  return content.map((part) => part?.text || part?.content || '').join('')
}

function lastUserMessage(body) {
  return [...(body.messages || [])].reverse().find((message) => message?.role === 'user')
}

function toolName(body, suffix) {
  return (body.tools || [])
    .map((tool) => tool?.function?.name || '')
    .find((name) => name === suffix || name.endsWith(`__${suffix}`)) || ''
}

function sendToolCall(response, { id, name, arguments: args }) {
  chatChunk(response, {
    id: `chatcmpl_${id}`,
    model: modelId,
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
      finish_reason: null,
    }],
  })
  chatChunk(response, {
    id: `chatcmpl_${id}`,
    model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  })
  response.end('data: [DONE]\n\n')
}

function sendText(response, id, value) {
  chatChunk(response, {
    id: `chatcmpl_${id}`,
    model: modelId,
    choices: [{ index: 0, delta: { role: 'assistant', content: value }, finish_reason: null }],
  })
  chatChunk(response, {
    id: `chatcmpl_${id}`,
    model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
  })
  response.end('data: [DONE]\n\n')
}

async function startFakeModel() {
  const requests = []
  const handlerErrors = []
  let skillRequestHandled = false
  const server = createServer(async (request, response) => {
    try {
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

      const serializedMessages = JSON.stringify(body.messages || [])
      if (!skillRequestHandled && serializedMessages.includes(skillPromptTail)) {
        skillRequestHandled = true
        assert.ok(serializedMessages.includes(`/${skillName}`), serializedMessages)
        sendText(response, 'skill_ui_done', skillAnswer)
        return
      }
      if (serializedMessages.includes(questionPrompt)) {
        if (!serializedMessages.includes('call_dsh_question')) {
          const askUserQuestion = toolName(body, 'ask_user_question')
          assert.ok(askUserQuestion, `DSH ask_user_question tool is unavailable: ${JSON.stringify(body.tools || [])}`)
          sendToolCall(response, {
            id: 'call_dsh_question',
            name: askUserQuestion,
            arguments: {
              questions: [{
                id: 'composer-chain',
                header: '官方 UI 插件验收',
                question: questionText,
                options: [
                  { label: questionOption, description: '由 ui-question 插件提交结构化答案。' },
                  { label: `尚未接管-${stamp}`, description: '产品输入框仍在占用当前位置。' },
                ],
              }],
            },
          })
          return
        }
        const toolOutput = (body.messages || []).find((message) => (
          message?.role === 'tool' && message?.tool_call_id === 'call_dsh_question'
        ))
        assert.ok(messageText(toolOutput?.content).includes(questionOption), JSON.stringify(toolOutput || null))
        sendText(response, 'question_ui_done', questionAnswer)
        return
      }
      if (serializedMessages.includes(childPrompt) && !serializedMessages.includes(parentPrompt)) {
        sendText(response, 'child_ui_done', childAnswer)
        return
      }

      assert.ok(serializedMessages.includes(parentPrompt), `unexpected model request: ${serializedMessages}`)
      if (!serializedMessages.includes('call_dsh_subagent')) {
        const subagent = toolName(body, 'subagent')
        assert.ok(subagent, `DSH subagent tool is unavailable: ${JSON.stringify(body.tools || [])}`)
        sendToolCall(response, {
          id: 'call_dsh_subagent',
          name: subagent,
          arguments: {
            description: '桌面协作验收',
            prompt: childPrompt,
            run_in_background: false,
          },
        })
        return
      }

      const toolOutput = (body.messages || []).find((message) => (
        message?.role === 'tool' && message?.tool_call_id === 'call_dsh_subagent'
      ))
      const toolContent = String(toolOutput?.content || '')
      sendText(response, 'parent_ui_done', toolContent.includes(childAnswer) ? parentAnswer : `parent-ui-child-error:${toolContent}`)
    } catch (error) {
      handlerErrors.push(error)
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain' })
      response.end(error?.stack || error?.message || String(error))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    handlerErrors,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

let session = null
let fakeModel = null
let modelProviderSaved = false
const rendererErrors = []
try {
  fakeModel = await startFakeModel()
  session = await openSession({ port: 9368 })
  session.onEvent('Runtime.consoleAPICalled', (event) => {
    const message = (event.args || []).map((arg) => arg.value ?? arg.description).filter(Boolean).join(' ')
    if (event?.type === 'error') rendererErrors.push(message)
  })
  const driver = makeDriver(session)
  const ui = makeUiDriver(session)
  await driver.login()
  await session.evalJs(`localStorage.setItem('dsh:onboarding:completed:v1', 'true'); return true;`)

  const snapshot = await driver.raw.api('GET', '/api/dsh/models')
  const llmNamespace = snapshot.json?.data?.namespaces?.find((item) => item.ns === 'llm-pi-ai')
  assert.equal(typeof llmNamespace?.revision, 'number', JSON.stringify(snapshot.json))
  const credential = await driver.raw.api('POST', '/api/dsh/models/credentials', {
    ref: credentialRef,
    value: 'native-multi-agent-ui-key',
  })
  assert.equal(credential.status, 200, JSON.stringify(credential.json))
  const configuredModel = await driver.raw.api('POST', '/api/dsh/models/settings/mutate', {
    ns: 'llm-pi-ai',
    expected_revision: llmNamespace.revision,
    ops: [{
      op: 'set',
      path: ['providers', providerId],
      value: {
        displayName: 'DSH 协作桌面假模型',
        apiKeyEnv: credentialRef,
        api: 'openai-completions',
        baseURL: fakeModel.baseUrl,
        models: [{ id: modelId, name: 'DSH 协作桌面假模型' }],
      },
    }],
  })
  assert.equal(configuredModel.status, 200, JSON.stringify(configuredModel.json))
  modelProviderSaved = true

  const officialAgentPreset = '[data-dsh-conversation-hero-agent-preset] button[aria-haspopup="menu"]'
  const officialWorkspacePicker = '[data-dsh-product-workspace-picker]'
  try {
    await ui.waitFor(officialWorkspacePicker, { timeout: 15_000 })
  } catch (error) {
    const workspaceDiagnostics = await session.evalJs(`return {
      placeholder: Boolean(document.querySelector('[data-dsh-conversation-hero-workspace]')),
      localPicker: Boolean(document.querySelector('[data-product-workspace-picker-local]')),
      bootHasProductWorkspaces: JSON.stringify(window.__DSH_BOOT__ || {}).includes('dsh-client-product-workspaces'),
      productWorkspaceResources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('product-workspaces')),
      bodyText: document.body.innerText.slice(-1000)
    }`)
    throw new Error(`${error.message}; workspace diagnostics=${JSON.stringify({ workspaceDiagnostics, rendererErrors })}`)
  }
  assert.equal(await session.evalJs(`return document.querySelector('[data-product-workspace-picker-local]') === null`), true)
  await ui.click('[data-dsh-product-workspace-trigger]')
  await ui.waitFor('[data-dsh-product-workspace-menu]', { timeout: 10_000 })
  await ui.click('[data-dsh-product-workspace-menu] [data-workspace-id="__chat__"]')
  await ui.waitUntil(`async () => document.querySelector('[data-dsh-product-workspace-menu]') === null`, {
    timeout: 10_000,
    label: '产品 Workspace 插件选择当前聊天并回收菜单',
  })
  await ui.waitFor(officialAgentPreset, { timeout: 15_000 })
  await ui.click(officialAgentPreset)
  await ui.waitFor('[role="menu"]', { timeout: 15_000 })
  await ui.press('Escape')

  await session.evalJs(`
    const input = document.querySelector('[data-testid="agent-message-input"]')
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'attachment-plugin-smoke '.repeat(240))
    input.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    }))
  `)
  try {
    await ui.waitFor('[data-dsh-product-attachments]', { timeout: 15_000 })
  } catch (error) {
    const attachmentDiagnostics = await session.evalJs(`return {
      bootHasProductAttachments: JSON.stringify(window.__DSH_BOOT__ || {}).includes('dsh-client-product-attachments'),
      productAttachmentResources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('product-attachments')),
      inputValue: document.querySelector('[data-testid="agent-message-input"]')?.value || '',
      localAttachments: [...document.querySelectorAll('[data-attachment-path]')].map((node) => node.getAttribute('data-attachment-name')),
      bodyText: document.body.innerText.slice(-1200)
    }`)
    throw new Error(`${error.message}; attachment diagnostics=${JSON.stringify({ attachmentDiagnostics, rendererErrors })}`)
  }
  assert.equal(await session.evalJs(`return document.querySelector('[data-attachment-path]') === null`), true)
  assert.equal(await session.evalJs(`return JSON.stringify(window.__DSH_BOOT__ || {}).includes('dsh-client-product-attachments')`), true)
  await ui.click('[data-dsh-product-attachment-file] button')
  await ui.waitUntil(`async () => document.querySelector('[data-dsh-product-attachments]') === null`, {
    timeout: 10_000,
    label: '附件插件移除草稿附件并回收标准 Slot',
  })
  await ui.fill('[data-testid="agent-message-input"]', '')

  const result = await driver.askAgent('__chat__', parentPrompt, {
    title: conversationTitle,
    model: modelRoute,
    timeoutMs: 45_000,
  })
  assert.deepEqual(fakeModel.handlerErrors, [])
  assert.equal(fakeModel.requests.length, 3, JSON.stringify(fakeModel.requests.map((request) => ({
    messages: (request.messages || []).map((message) => ({ role: message.role, text: messageText(message.content).slice(0, 200) })),
  }))))
  const childRequest = fakeModel.requests.find((request) => (
    JSON.stringify(request.messages || []).includes(childPrompt)
    && !JSON.stringify(request.messages || []).includes(parentPrompt)
  ))
  assert.equal(childRequest?.model, modelId)
  assert.ok(result.blocks.some((block) => (
    block.type === 'tool' && block.metadata?.tool_name === 'subagent'
    && String(block.metadata?.resultText || '').includes(childAnswer)
  )), JSON.stringify(result.blocks))
  assert.ok(result.blocks.some((block) => String(block.content || '').includes(parentAnswer)), JSON.stringify(result.blocks))

  const trajectory = await driver.raw.api('GET', `/api/agent/projects/__chat__/threads/${result.sid}/dsh-trajectory`)
  assert.equal(trajectory.status, 200, JSON.stringify(trajectory.json))
  assert.equal(trajectory.json?.data?.source, 'session.history')
  const events = trajectory.json?.data?.events || []
  assert.ok(events.some((entry) => entry?.event?.type === 'tool/call' && entry.event.data?.name === 'subagent'))
  assert.ok(events.some((entry) => (
    entry?.event?.type === 'tool/result'
    && JSON.stringify(entry.event.data || '').includes(childAnswer)
  )), JSON.stringify(events))

  await session.cdp('Page.reload', { ignoreCache: true }, { timeoutMs: 10_000 })
  await ui.waitFor(`[data-agent-conv-id="${result.sid}"]`, { timeout: 30_000 })
  await ui.click(`[data-agent-conv-id="${result.sid}"]`)
  await ui.waitUntil(`async () => document.body.innerText.includes(${JSON.stringify(parentAnswer)})`, {
    timeout: 15_000,
    label: '对话显示 DSH 协作最终回答',
  })
  const officialModelTrigger = '[data-dsh-conversation-input-model] button[aria-haspopup="menu"]'
  await ui.waitFor(officialModelTrigger, { timeout: 15_000 })
  await ui.click(officialModelTrigger)
  await ui.waitFor('[data-dsh-conversation-input-model] [role="menu"]', { timeout: 15_000 })
  await ui.press('Escape')
  await ui.fill('[data-testid="agent-message-input"]', '@DSH')
  const officialConversationReference = '[role="option"][id^="dsh-slash-option-dsh-work-conversations-"]'
  try {
    await ui.waitFor(officialConversationReference, { timeout: 10_000 })
  } catch (error) {
    const referenceDiagnostics = await session.evalJs(`return {
      input: document.querySelector('[data-testid="agent-message-input"]')?.value || '',
      options: [...document.querySelectorAll('[role="option"]')].map((node) => ({ id: node.id, text: node.innerText })),
      listboxes: [...document.querySelectorAll('[role="listbox"]')].map((node) => node.innerText),
      conversationTitles: [...document.querySelectorAll('[data-agent-conv-id]')].map((node) => node.innerText),
      bootHasProductReferences: JSON.stringify(window.__DSH_BOOT__ || {}).includes('dsh-client-product-references'),
      productReferenceResources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('product-references')),
      productReferenceScripts: [...document.scripts].map((node) => node.src).filter((src) => src.includes('product-references')),
      bodyText: document.body.innerText.slice(-1200)
    }`)
    throw new Error(`${error.message}; product reference diagnostics=${JSON.stringify({ referenceDiagnostics, rendererErrors })}`)
  }
  assert.equal(await session.evalJs(`return document.querySelector('[data-mention-picker]') === null`), true)
  assert.match(
    await session.evalJs(`return document.querySelector(${JSON.stringify(officialConversationReference)})?.innerText || ''`),
    new RegExp(`^DSH 协作验收 ${stamp}\\b`)
  )
  await ui.click(officialConversationReference)
  await ui.waitUntil(`async () => document.querySelector('[data-testid="agent-message-input"]')?.value === ${JSON.stringify(`#${conversationTitle} `)}`, {
    timeout: 10_000,
    label: '产品会话引用通过官方 InputTrigger 写回共享草稿',
  })
  await ui.fill('[data-testid="agent-message-input"]', '')
  const officialSearchMode = '[data-dsh-product-search-mode]'
  await ui.waitFor(`${officialSearchMode}[data-search-mode="auto"]`, { timeout: 10_000 })
  assert.equal(await session.evalJs(`return document.querySelectorAll('[data-search-mode]').length`), 1)
  await ui.click(officialSearchMode)
  await ui.waitFor(`${officialSearchMode}[data-search-mode="required"]`, { timeout: 10_000 })
  await ui.click(officialSearchMode)
  await ui.waitFor(`${officialSearchMode}[data-search-mode="off"]`, { timeout: 10_000 })
  await ui.click(officialSearchMode)
  await ui.waitFor(`${officialSearchMode}[data-search-mode="auto"]`, { timeout: 10_000 })
  const skillCatalog = await driver.raw.api('GET', `/api/agent/projects/__chat__/threads/${result.sid}/dsh-skills`)
  assert.equal(skillCatalog.status, 200, JSON.stringify(skillCatalog.json))
  assert.equal(skillCatalog.json?.data?.some((skill) => skill?.name === skillName), true, JSON.stringify(skillCatalog.json))
  const skillRequestCount = fakeModel.requests.length
  await ui.fill('[data-testid="agent-message-input"]', `/${skillName}`)
  const officialSkillCandidate = '[role="option"][id^="dsh-slash-option-skill-"]'
  await ui.waitFor(officialSkillCandidate, { timeout: 10_000 })
  assert.equal(await session.evalJs(`return document.querySelector('[data-slash-menu]') === null`), true)
  assert.match(
    await session.evalJs(`return document.querySelector(${JSON.stringify(officialSkillCandidate)})?.innerText || ''`),
    new RegExp(`^${skillName}\\b`)
  )
  await ui.click(officialSkillCandidate)
  await ui.waitUntil(`async () => document.querySelector('[data-testid="agent-message-input"]')?.value === ${JSON.stringify(`/${skillName} `)}`, {
    timeout: 10_000,
    label: '官方 Skill 输入源把字面引用写回共享草稿',
  })
  await ui.typeText(skillPromptTail)
  assert.equal(await session.evalJs(`return document.querySelector('[data-testid="agent-message-input"]')?.value || ''`), skillPrompt)
  await ui.press('Enter')
  await ui.waitUntil(`async () => document.body.innerText.includes(${JSON.stringify(skillAnswer)})`, {
    timeout: 15_000,
    label: '官方 Skill 引用随普通提示进入 DSH Session',
  })
  assert.ok(fakeModel.requests.length > skillRequestCount, '官方 Skill 提示没有进入模型请求')
  const modelRequestCount = fakeModel.requests.length
  await ui.fill('[data-testid="agent-message-input"]', '/plan')
  const officialPlanCommand = '[role="option"][id^="dsh-slash-option-command-"]'
  await ui.waitFor(officialPlanCommand, { timeout: 10_000 })
  assert.match(await session.evalJs(`return document.querySelector(${JSON.stringify(officialPlanCommand)})?.innerText || ''`), /^plan\b/)
  await ui.click(officialPlanCommand)
  await ui.waitFor('[data-dsh-command-hint]', { timeout: 10_000 })
  await ui.press('Enter')
  const officialPlanTrigger = '[data-dsh-conversation-input-plan] button'
  await ui.waitFor(officialPlanTrigger, { timeout: 15_000 })
  await ui.fill('[data-testid="agent-message-input"]', `保留当前 DSH plan mode-${stamp}`)
  await ui.press('Enter')
  const requestDeadline = Date.now() + 15_000
  while (fakeModel.requests.length <= modelRequestCount && Date.now() < requestDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(fakeModel.requests.length > modelRequestCount, 'plan mode 下的普通消息没有进入 DSH Session')
  await ui.waitFor(officialPlanTrigger, { timeout: 15_000 })
  await ui.click(officialPlanTrigger)
  await ui.waitUntil(`async () => !document.querySelector(${JSON.stringify(officialPlanTrigger)})`, {
    timeout: 15_000,
    label: '官方 Plan 插件关闭当前 Session 的 plan mode',
  })
  assert.equal(await session.evalJs(`return document.querySelector('[data-testid="dsh-permission-picker"]') === null`), true)
  await ui.fill('[data-testid="agent-message-input"]', '/permission')
  const officialPermissionCommand = '[role="option"][id^="dsh-slash-option-command-"]'
  await ui.waitFor(officialPermissionCommand, { timeout: 10_000 })
  assert.match(await session.evalJs(`return document.querySelector(${JSON.stringify(officialPermissionCommand)})?.innerText || ''`), /^permission\b/)
  await ui.click(officialPermissionCommand)
  const officialPermissionList = '[role="listbox"][aria-label^="/permission"]'
  await ui.waitFor(officialPermissionList, { timeout: 10_000 })
  assert.ok(await session.evalJs(`return document.querySelector(${JSON.stringify(officialPermissionList)})?.querySelectorAll('[role="option"]').length || 0`))
  await ui.click('[data-testid="agent-message-input"]')
  await ui.waitUntil(`async () => !document.querySelector(${JSON.stringify(officialPermissionList)})`, {
    timeout: 10_000,
    label: '官方 permission decoration 关闭',
  })
  assert.equal(await session.evalJs(`return document.querySelector('[data-testid="dsh-permission-picker"]') === null`), true)
  const goalObjective = `验证官方 Goal UI 插件-${stamp}`
  await ui.fill('[data-testid="agent-message-input"]', '/goal')
  const officialGoalCommand = '[role="option"][id^="dsh-slash-option-command-"]'
  await ui.waitFor(officialGoalCommand, { timeout: 10_000 })
  assert.match(await session.evalJs(`return document.querySelector(${JSON.stringify(officialGoalCommand)})?.innerText || ''`), /^goal\b/)
  await ui.click(officialGoalCommand)
  await ui.waitFor('[data-dsh-command-hint]', { timeout: 10_000 })
  await ui.click('[data-testid="agent-message-input"]')
  await ui.press('End')
  await ui.typeText(goalObjective)
  await ui.press('Enter')
  await ui.waitFor('[data-goal-bar]', { timeout: 15_000 })
  assert.equal(await session.evalJs(`return document.querySelector('[data-goal-bar]')?.innerText.includes(${JSON.stringify(goalObjective)}) || false`), true)
  await ui.click('[data-goal-bar] button[aria-label="暂停目标"]')
  await ui.waitFor('[data-goal-bar] button[aria-label="恢复目标"]', { timeout: 15_000 })
  await ui.click('[data-goal-bar] button[aria-label="清除目标"]')
  await ui.waitUntil(`async () => !document.querySelector('[data-goal-bar]')`, {
    timeout: 15_000,
    label: '官方 Goal 插件清除当前 Session 目标',
  })
  const questionRequestCount = fakeModel.requests.length
  await ui.fill('[data-testid="agent-message-input"]', questionPrompt)
  await ui.press('Enter')
  await ui.waitFor('[data-question-key]', { timeout: 15_000 })
  await ui.waitFor('[data-dsh-standard-tool-call-node] [data-chat-call-id="call_dsh_question"]', { timeout: 15_000 })
  const questionToolText = await session.evalJs(`return document.querySelector('[data-chat-call-id="call_dsh_question"]')?.innerText || ''`)
  assert.match(questionToolText, /提问/)
  assert.doesNotMatch(questionToolText, /ask\.(?:rowTitle|waiting)|row\.running/)
  assert.equal(await session.evalJs(`return document.querySelector('[data-question-key]')?.innerText.includes(${JSON.stringify(questionText)}) || false`), true)
  assert.equal(await session.evalJs(`return document.querySelector('[data-dsh-tool-call-takeover="call_dsh_question"] + [data-dsh-product-tool-call-surface]')?.offsetParent === null`), true)
  assert.equal(await session.evalJs(`return document.querySelector('[data-testid="agent-message-input"]')?.offsetParent === null`), true)
  const questionToolRow = '[data-dsh-standard-tool-call-node] [data-chat-call-id="call_dsh_question"]'
  await ui.click(`${questionToolRow} [data-disclosure-row]`)
  await ui.waitUntil(`async () => Array.from(document.querySelector(${JSON.stringify(questionToolRow)})?.querySelectorAll('button') || []).some((candidate) => candidate.textContent?.trim() === 'Inspect')`, {
    timeout: 10_000,
    label: '官方工具行展开后显示 Inspect',
  })
  const inspectedQuestionCall = await session.evalJs(`
    const row = document.querySelector(${JSON.stringify(questionToolRow)});
    const button = Array.from(row?.querySelectorAll('button') || []).find((candidate) => candidate.textContent?.trim() === 'Inspect');
    button?.click();
    return {
      clicked: Boolean(button),
      buttons: Array.from(row?.querySelectorAll('button') || []).map((candidate) => candidate.textContent?.trim() || ''),
    };
  `)
  assert.equal(inspectedQuestionCall.clicked, true, JSON.stringify(inspectedQuestionCall))
  const toolDetailsDeadline = Date.now() + 15_000
  let toolDetailsState = null
  while (Date.now() < toolDetailsDeadline) {
    toolDetailsState = await session.evalJs(`
      const frame = document.querySelector('[data-dsh-standard-details]');
      const panel = document.querySelector('[data-dsh-standard-tool-details]');
      return {
        ready: Boolean(frame && !frame.hidden && panel?.getAttribute('data-call-id') === 'call_dsh_question'),
        frameExists: Boolean(frame),
        frameHidden: frame?.hidden ?? null,
        content: frame?.textContent?.trim() || '',
        html: (frame?.innerHTML || '').slice(0, 2000),
        panelCallId: panel?.getAttribute('data-call-id') || '',
        detailsSlots: document.querySelectorAll('[data-slot="details"]').length,
        toolRowExists: Boolean(document.querySelector('[data-chat-call-id="call_dsh_question"]')),
      };
    `)
    if (toolDetailsState.ready) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(toolDetailsState?.ready, true, JSON.stringify(toolDetailsState))
  assert.equal(await session.evalJs(`return !document.querySelector('[data-dsh-standard-tool-details] [data-dsh-product-tool-details-fallback]')`), true)
  assert.equal(await session.evalJs(`return document.querySelector('[data-dsh-standard-tool-details-output]')?.innerText.trim().length > 0`), true)
  assert.equal(await session.evalJs(`return !document.querySelector('[data-dsh-standard-tool-details-output]')?.innerText.includes('details.running')`), true)
  const closedToolDetails = await session.evalJs(`
    const button = document.querySelector('[data-dsh-standard-tool-details-close]');
    button?.click();
    return Boolean(button);
  `)
  assert.equal(closedToolDetails, true)
  await ui.waitUntil(`async () => document.querySelector('[data-dsh-standard-details]')?.hidden === true`, {
    timeout: 10_000,
    label: '官方工具详情关闭并恢复产品工作台',
  })
  await ui.click(`[data-question-key] [role="radio"][aria-label=${JSON.stringify(questionOption)}]`)
  await ui.waitUntil(`async () => document.querySelector('[data-question-key] [role="radio"][aria-label=${JSON.stringify(questionOption)}]')?.getAttribute('aria-checked') === 'true'`, {
    timeout: 10_000,
    label: '官方 ui-question 选项状态落下',
  })
  const submittedQuestion = await session.evalJs(`
    const buttons = Array.from(document.querySelectorAll('[data-question-key] footer button')).filter((button) => button.offsetParent !== null);
    const submit = buttons.at(-1);
    submit?.click();
    return { clicked: Boolean(submit), disabled: submit?.disabled || false, labels: buttons.map((button) => button.textContent?.trim() || '') };
  `)
  assert.equal(submittedQuestion.clicked, true, JSON.stringify(submittedQuestion))
  assert.equal(submittedQuestion.disabled, false, JSON.stringify(submittedQuestion))
  await ui.waitUntil(`async () => !document.querySelector('[data-question-key]')`, {
    timeout: 15_000,
    label: '官方 ui-question Composer Chain 提交并退出接管',
  })
  const questionAnswerDeadline = Date.now() + 15_000
  while (fakeModel.requests.length < questionRequestCount + 2
    && fakeModel.handlerErrors.length === 0
    && Date.now() < questionAnswerDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.deepEqual(fakeModel.handlerErrors, [])
  assert.ok(fakeModel.requests.length >= questionRequestCount + 2, JSON.stringify(
    fakeModel.requests.slice(questionRequestCount).map((request) => request.messages || [])
  ))
  let questionTrajectory = null
  const questionHistoryDeadline = Date.now() + 15_000
  while (Date.now() < questionHistoryDeadline) {
    questionTrajectory = await driver.raw.api('GET', `/api/agent/projects/__chat__/threads/${result.sid}/dsh-trajectory`)
    if (JSON.stringify(questionTrajectory.json?.data?.events || []).includes(questionAnswer)) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(
    JSON.stringify(questionTrajectory?.json?.data?.events || []).includes(questionAnswer),
    JSON.stringify(questionTrajectory?.json || null)
  )
  await ui.waitUntil(`async () => document.body.innerText.includes(${JSON.stringify(questionAnswer)})`, {
    timeout: 15_000,
    label: '提问工具答案返回 DSH Agent 并完成最终回答',
  })
  assert.equal(await session.evalJs(`return document.querySelector('[data-testid="agent-message-input"]')?.offsetParent !== null`), true)
  await ui.fill('[data-testid="agent-message-input"]', '/runs')
  await ui.waitFor('[role="listbox"]', { timeout: 10_000 })
  assert.equal(await session.evalJs(`return document.querySelector('[data-slash-menu]') === null`), true)
  const productCommand = '[role="option"][id^="dsh-slash-option-dsh-work-"]'
  await ui.waitFor(productCommand, { timeout: 10_000 })
  assert.match(await session.evalJs(`return document.querySelector(${JSON.stringify(productCommand)})?.innerText || ''`), /^runs\b/)
  assert.equal(await session.evalJs(`return document.querySelector(${JSON.stringify(productCommand)})?.getAttribute('aria-selected') || ''`), 'true')
  await ui.click(productCommand)
  try {
    await ui.waitFor('[data-dsh-trajectory][data-dsh-trajectory-source="session.history"]', { timeout: 15_000 })
  } catch (error) {
    const diagnostics = await session.evalJs(`return {
      input: document.querySelector('[data-testid="agent-message-input"]')?.value || '',
      optionVisible: Boolean(document.querySelector(${JSON.stringify(productCommand)})?.offsetParent),
      listboxVisible: Boolean(document.querySelector('[role="listbox"]')?.offsetParent),
      reviewTab: document.querySelector('[data-workbench-tab="review"]')?.getAttribute('aria-selected') || '',
      workbenchText: document.querySelector('[data-workbench-panel="review"]')?.innerText.slice(0, 500) || '',
      bodyText: document.body.innerText.slice(-1000)
    }`)
    throw new Error(`${error.message}; product command diagnostics=${JSON.stringify(diagnostics)}`)
  }
  await ui.waitFor('[data-dsh-trajectory-event][data-dsh-event-type="tool/call"]', { timeout: 15_000 })
  await ui.waitFor('[data-dsh-trajectory-event][data-dsh-event-type="tool/result"]', { timeout: 15_000 })
  assert.equal(await session.evalJs(`return document.querySelector('[data-dsh-trajectory]')?.innerText.includes('subagent') || false`), true)

  console.log('[native-multi-agent-ui-smoke] PASS DSH Workspace/附件/Agent Preset/子任务/产品引用/联网模式/Skill/Goal/工具插件/提问插件/父级回答/session.history 轨迹')
} finally {
  if (session && modelProviderSaved) {
    const driver = makeDriver(session)
    await driver.raw.api('POST', '/api/dsh/models/settings/mutate', {
      ns: 'llm-pi-ai',
      ops: [{ op: 'unset', path: ['providers', providerId] }],
    }).catch(() => null)
  }
  if (session) {
    const driver = makeDriver(session)
    await driver.raw.api('DELETE', `/api/dsh/models/credentials/${encodeURIComponent(credentialRef)}`).catch(() => null)
  }
  try { await session?.close() } catch { /* ignore */ }
  try { await fakeModel?.close() } catch { /* ignore */ }
  if (process.env.DSH_EVAL_RETAIN !== '1') rmSync(evalHome, { recursive: true, force: true })
}
