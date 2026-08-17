import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openSession } from './lib/cdp.mjs'
import { makeDriver } from './lib/driver.mjs'
import { makeUiDriver } from './lib/ui-driver.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outputDir = path.join(root, 'docs', 'images', 'readme')
const screenshotPath = path.join(outputDir, 'dsh-web-ui-task-board.png')
const evalHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-web-ui-readme-'))

mkdirSync(outputDir, { recursive: true })
process.env.DSH_EVAL_ISOLATED = '1'
process.env.DSH_EVAL_HOME = evalHome
process.env.DSH_USER_DATA_DIR = path.join(evalHome, 'electron-user-data')
process.env.DSH_RUNTIME_HOME = path.join(evalHome, '.agent_runtime')

async function dismissNotifications(session, ui) {
  await session.evalJs(`
    for (const notification of document.querySelectorAll('[role="alert"]')) {
      const buttons = [...notification.querySelectorAll('button')];
      const close = buttons.find((button) => /close|关闭/i.test(button.getAttribute('aria-label') || '')) || buttons.at(-1);
      close?.click();
    }
    return true;
  `)
  await ui.waitUntil(`() => document.querySelectorAll('[role="alert"]').length === 0`, {
    timeout: 10_000,
    label: '安装通知已经收起',
  })
}

let session = null
try {
  session = await openSession({ port: 9377, isolate: true })
  const driver = makeDriver(session)
  const ui = makeUiDriver(session)

  await driver.login()
  await session.evalJs(`localStorage.setItem('dsh:onboarding:completed:v1', 'true'); return true;`)
  await ui.goto('/agent')
  await ui.waitFor('[data-dsh-open-settings]', { timeout: 30_000 })
  await ui.click('[data-dsh-open-settings]')
  await ui.waitFor('#settings-nav-plugins', { timeout: 15_000 })
  await ui.click('#settings-nav-plugins')

  await ui.waitFor('[data-community-plugin-install="dsh-web-ui"]', { timeout: 20_000 })
  const registryProof = await session.evalJs(`
    const response = await window.electronAPI.apiRequest({ method: 'GET', url: '/api/agent/plugins', headers: {}, body: null });
    const plugin = response?.json?.data?.recommended_plugins?.find((item) => item.id === 'dsh-web-ui');
    return plugin ? { source: plugin.source, permissions: plugin.permissions, review: plugin.review_note_zh } : null;
  `)
  assert.equal(registryProof?.source, '@linxin666/dsh-web-ui-all@0.1.20')
  assert.equal(registryProof?.permissions?.length, 3)
  assert.match(registryProof?.review || '', /13 个同版本依赖/)
  await ui.click('[data-community-plugin-install="dsh-web-ui"]')
  await ui.waitFor('input[value="@linxin666/dsh-web-ui-all@0.1.20"]', { timeout: 5_000 })
  await ui.waitFor('[data-community-plugin-permissions]', { timeout: 5_000 })
  const permissionText = await session.evalJs(`
    return document.querySelector('[data-community-plugin-permissions]')?.textContent?.replace(/\\s+/g, ' ').trim() || '';
  `)
  assert.match(permissionText, /SSH/)
  assert.match(permissionText, /本地仓库与图片/)

  await ui.click('[data-profile-install-check]')
  try {
    await ui.waitFor('[data-profile-preflight="ready"]', { timeout: 180_000 })
  } catch (error) {
    const diagnostic = await session.evalJs(`
      return {
        preflight: document.querySelector('[data-profile-preflight]')?.getAttribute('data-profile-preflight') || null,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent?.replace(/\\s+/g, ' ').trim() || ''),
        dialog: document.querySelector('[role="dialog"]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      };
    `).catch((diagnosticError) => ({ error: diagnosticError.message }))
    throw new Error(`${error.message}\n${JSON.stringify(diagnostic, null, 2)}`)
  }
  const compatibility = await session.evalJs(`
    return [...document.querySelectorAll('[data-profile-compatibility-checks] [data-check-status]')]
      .map((item) => ({ status: item.getAttribute('data-check-status'), text: item.textContent?.replace(/\\s+/g, ' ').trim() || '' }));
  `)
  assert.equal(compatibility.filter((check) => check.status === 'reviewed').length, 3)
  assert.ok(compatibility.some((check) => /任务看板会读取 Session/.test(check.text)), JSON.stringify(compatibility))
  assert.ok(compatibility.some((check) => /Git、SSH 与电源保持进程/.test(check.text)), JSON.stringify(compatibility))
  const installed = await driver.raw.api('POST', '/api/agent/profile-bundles', {
    source: '@linxin666/dsh-web-ui-all@0.1.20',
  })
  assert.equal(installed.status, 200, JSON.stringify(installed.json))
  assert.equal(installed.json?.data?.pluginId, '@linxin666/dsh-web-ui-all')
  await session.cdp('Page.reload', { ignoreCache: true }, { timeoutMs: 10_000 })
  try {
  await ui.waitFor('[data-dsh-frame] [data-pane="sidebar"]', { timeout: 60_000 })
  } catch (error) {
    const diagnostic = await session.evalJs(`
      return {
        href: location.href,
        title: document.title,
        text: document.body?.innerText?.slice(0, 2000) || '',
        html: document.body?.innerHTML?.slice(0, 2000) || '',
        preload: Boolean(window.electronAPI),
        bootEntries: Object.keys(window.__DSH_BOOT__?.entries || {}),
      };
    `).catch((diagnosticError) => ({ error: diagnosticError.message }))
    throw new Error(`${error.message}\n${JSON.stringify(diagnostic, null, 2)}`)
  }
  await ui.waitFor('[data-dsh-taskboard-entry]', { timeout: 60_000 })
  await ui.waitFor('[data-dsh-ssh-entry]', { timeout: 30_000 })
  if (await ui.exists('[data-edge-toggle="nav"][data-collapsed="true"]')) {
    await ui.click('[data-edge-toggle="nav"][data-collapsed="true"]')
    await ui.waitUntil(`() => !document.querySelector('[data-dsh-frame][data-sidebar-collapsed]')`, {
      timeout: 10_000,
      label: '截图前侧栏已经展开',
    })
  }
  await dismissNotifications(session, ui)
  await ui.click('[data-dsh-taskboard-entry]')
  await ui.waitFor('[data-dsh-taskboard-board]', { timeout: 20_000 })
  if (await ui.exists('.aionui-collapse-chevron')) {
    await ui.click('.aionui-collapse-chevron')
    try {
      await ui.waitUntil(`() => {
        const column = document.querySelector('[data-aionui-explorer-col]');
        return !column || column.getBoundingClientRect().width <= 1;
      }`, {
        timeout: 10_000,
        label: '截图前社区文件面板已经收起',
      })
    } catch (error) {
      const diagnostic = await session.evalJs(`
        const column = document.querySelector('[data-aionui-explorer-col]');
        const frame = document.querySelector('[data-dsh-frame]');
        return {
          column: column?.getBoundingClientRect().toJSON() || null,
          frameStyle: frame?.getAttribute('style') || null,
          keys: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('project-panel-collapse:'))),
          buttons: [...document.querySelectorAll('.aionui-collapse-chevron')].map((button) => ({
            label: button.getAttribute('aria-label'),
            rect: button.getBoundingClientRect().toJSON(),
          })),
        };
      `).catch((diagnosticError) => ({ error: diagnosticError.message }))
      throw new Error(`${error.message}\n${JSON.stringify(diagnostic, null, 2)}`)
    }
  }
  if (await ui.exists('[data-edge-toggle="workspace"][data-collapsed="false"]')) {
    await ui.click('[data-edge-toggle="workspace"][data-collapsed="false"]')
    await ui.waitUntil(`() => {
      const toggle = document.querySelector('[data-edge-toggle="workspace"]');
      const pane = document.querySelector('[data-dsh-frame] [data-pane="details"]');
      return toggle?.getAttribute('data-collapsed') === 'true'
        && (!pane || pane.getBoundingClientRect().width < 1);
    }`, {
      timeout: 10_000,
      label: '截图前右侧面板已经收起',
    })
  }
  try {
    await ui.waitUntil(`() => {
      const board = document.querySelector('[data-dsh-taskboard-board]');
      const rect = board?.getBoundingClientRect();
      return document.documentElement.hasAttribute('data-dsh-taskboard-active')
        && Boolean(rect && rect.width > 350 && rect.height > 220);
    }`, { timeout: 20_000, label: '社区任务看板已经接管中间工作区' })
  } catch (error) {
    const diagnostic = await session.evalJs(`
      const view = document.querySelector('[data-dsh-taskboard-view]');
      const board = document.querySelector('[data-dsh-taskboard-board]');
      const pane = document.querySelector('[data-dsh-frame] [data-pane="conversation"]');
      const entry = document.querySelector('[data-dsh-taskboard-entry]');
      const describe = (element) => {
        const rect = element?.getBoundingClientRect();
        const style = element ? getComputedStyle(element) : null;
        return { rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null, display: style?.display, position: style?.position, overflow: style?.overflow };
      };
      return {
        active: document.documentElement.hasAttribute('data-dsh-taskboard-active'),
        entryActive: entry?.getAttribute('data-active'),
        entry: describe(entry),
        pane: describe(pane),
        view: describe(view),
        board: describe(board),
        paneChildren: [...(pane?.children || [])].map((child) => ({ tag: child.tagName, attrs: [...child.attributes].map((item) => [item.name, item.value]) })),
      };
    `)
    throw new Error(`${error.message}\n${JSON.stringify(diagnostic, null, 2)}`)
  }

  const proof = await session.evalJs(`
    const board = document.querySelector('[data-dsh-taskboard-board]');
    const entry = document.querySelector('[data-dsh-taskboard-entry]');
    const ssh = document.querySelector('[data-dsh-ssh-entry]');
    const pane = document.querySelector('[data-dsh-frame] [data-pane="conversation"]');
    const frame = document.querySelector('[data-dsh-frame]');
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
    };
    const describe = (element) => element ? {
      tag: element.tagName,
      className: String(element.className || ''),
      attributes: [...element.attributes].map((item) => [item.name, item.value]),
      rect: rect(element),
    } : null;
    return {
      title: board?.querySelector('h2')?.textContent?.trim() || '',
      columns: [...(board?.querySelectorAll('[data-status]') || [])]
        .filter((element) => element.tagName === 'SECTION').length,
      taskBoardEntry: entry?.textContent?.trim() || '',
      sshEntry: ssh?.textContent?.trim() || '',
      conversationPane: Boolean(pane),
      boardInsideProductFrame: Boolean(board?.closest('[data-dsh-frame]')),
      entriesInsideProductFrame: Boolean(entry?.closest('[data-dsh-frame]') && ssh?.closest('[data-dsh-frame]')),
      foreignPaneHooks: [...document.querySelectorAll('[data-pane]')]
        .filter((element) => !element.closest('[data-dsh-frame]')).length,
      geometry: {
        frame: rect(frame),
        frameStyle: frame ? {
          inline: frame.getAttribute('style'),
          grid: getComputedStyle(frame).gridTemplateColumns,
          sidebarCollapsed: frame.getAttribute('data-sidebar-collapsed'),
          savedNavWidth: localStorage.getItem('dsh-layout-nav-width'),
        } : null,
        sidebar: describe(document.querySelector('[data-dsh-frame] [data-pane="sidebar"]')),
        pane: rect(pane),
        details: describe(document.querySelector('[data-dsh-frame] [data-pane="details"]')),
        board: rect(board),
        boardView: describe(board?.closest('[data-dsh-taskboard-view]')),
        boardParent: describe(board?.closest('[data-dsh-taskboard-view]')?.parentElement),
        entryParent: describe(entry?.parentElement),
        frameParent: describe(frame?.parentElement),
      },
      bundleEntries: (window.__DSH_BOOT__?.entries || []).filter((entry) => JSON.stringify(entry).includes('web-ui')).length,
      dialog: Boolean(document.querySelector('[role="dialog"]')),
      alerts: document.querySelectorAll('[role="alert"]').length,
    };
  `)
  assert.match(proof.title, /任务看板|Task Board/)
  assert.equal(proof.columns, 5)
  assert.match(proof.taskBoardEntry, /任务看板|Task Board/)
  assert.match(proof.sshEntry, /SSH/)
  assert.equal(proof.conversationPane, true)
  assert.equal(proof.boardInsideProductFrame, true)
  assert.equal(proof.entriesInsideProductFrame, true)
  assert.equal(proof.foreignPaneHooks, 0)
  assert.equal(proof.dialog, false)
  assert.equal(proof.alerts, 0)

  await session.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1380, y: 880 })
  const shot = await session.cdp('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'))

  console.log(JSON.stringify({
    source: '@linxin666/dsh-web-ui-all@0.1.20 installed through the rc.7 Profile service in real isolated Electron',
    screenshot: screenshotPath,
    proof,
  }, null, 2))
} finally {
  try { await session?.close() } catch { /* ignore */ }
  try { rmSync(evalHome, { recursive: true, force: true }) } catch { /* ignore */ }
}
