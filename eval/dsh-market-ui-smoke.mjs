import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openSession } from './lib/cdp.mjs'
import { makeUiDriver } from './lib/ui-driver.mjs'

const evalHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-market-ui-smoke-'))
const runtimeHome = path.join(evalHome, '.agent_runtime')

process.env.DSH_EVAL_ISOLATED = '1'
process.env.DSH_EVAL_HOME = evalHome
process.env.DSH_USER_DATA_DIR = path.join(evalHome, 'electron-user-data')
process.env.DSH_RUNTIME_HOME = runtimeHome

let session = null
try {
  session = await openSession({ port: 9361 })
  const ui = makeUiDriver(session)

  await session.evalJs(`
    localStorage.setItem('dsh:onboarding:completed:v1', 'true');
    return true;
  `)
  await session.cdp('Page.reload', { ignoreCache: true }, { timeoutMs: 10_000 })
  await ui.waitFor('button[aria-haspopup="dialog"]', { timeout: 30_000 })
  await ui.click('button[aria-haspopup="dialog"]')

  await ui.waitFor('div[role="dialog"] nav button:last-child', { timeout: 30_000 })
  const nav = await session.evalJs(`
    const element = document.querySelector('div[role="dialog"] nav button:last-child');
    return {
      label: element?.textContent?.trim() || ''
    };
  `)
  assert.match(nav.label, /插件市场|Plugin Market|Market/i)

  await ui.click('div[role="dialog"] nav button:last-child')
  await ui.waitFor('div[role="dialog"] nav button:last-child[aria-current="true"]', { timeout: 15_000 })
  const market = await session.evalJs(`
    const element = document.querySelector('div[role="dialog"]');
    const active = element?.querySelector('nav button[aria-current="true"]');
    const rect = element?.getBoundingClientRect();
    const response = await fetch('/dsh-market/status', { cache: 'no-store' });
    return {
      text: element?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      activeLabel: active?.textContent?.trim() || '',
      visible: Boolean(rect && rect.width > 0 && rect.height > 0),
      responseOk: response.ok,
      status: await response.json()
    };
  `)
  assert.equal(market.visible, true)
  assert.equal(market.responseOk, true)
  assert.equal(market.status.version, '1.17.1')
  assert.equal(market.status.pnpm, true)
  assert.equal(market.status.restart, false)
  assert.match(market.text, /1\.17\.1/)
  assert.match(market.activeLabel, /插件市场|Plugin Market|Market/i)

  console.log('[dsh-market-ui-smoke] PASS 默认市场/官方设置 Slot/受控 pnpm/桌面重启边界/真实 Electron 渲染')
} finally {
  try { await session?.close() } catch { /* ignore */ }
  try { rmSync(evalHome, { recursive: true, force: true }) } catch { /* ignore */ }
}
