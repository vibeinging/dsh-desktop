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
  await ui.waitFor('[data-dsh-open-settings]', { timeout: 30_000 })
  await ui.click('[data-dsh-open-settings]')

  await ui.waitFor('#settings-nav-plugins', { timeout: 15_000 })
  await ui.click('#settings-nav-plugins')
  await ui.waitFor('[data-community-plugin-install="dshmarket"]', { timeout: 15_000 })
  await ui.click('[data-community-plugin-install="dshmarket"]')
  await ui.waitFor('input[value="dshmarket@1.9.0"]', { timeout: 5_000 })
  await ui.click('[data-profile-install-check]')
  await ui.waitFor('[data-profile-preflight="ready"]', { timeout: 30_000 })
  await ui.click('[data-profile-install-submit]')

  await ui.waitFor('[data-dsh-open-settings]', { timeout: 45_000 })
  await ui.click('[data-dsh-open-settings]')

  await ui.waitFor('#dsh-settings-nav-market', { timeout: 30_000 })
  const nav = await session.evalJs(`
    const element = document.querySelector('#dsh-settings-nav-market');
    return {
      plugin: element?.getAttribute('data-plugin-name') || '',
      label: element?.textContent?.trim() || ''
    };
  `)
  assert.equal(nav.plugin, 'dsh-market')
  assert.ok(nav.label.length > 0)

  await ui.click('#dsh-settings-nav-market')
  await ui.waitFor('[data-dsh-standard-settings-section="market"]', { timeout: 15_000 })
  const market = await session.evalJs(`
    const element = document.querySelector('[data-dsh-standard-settings-section="market"]');
    const rect = element?.getBoundingClientRect();
    return {
      text: element?.textContent?.trim() || '',
      visible: Boolean(rect && rect.width > 0 && rect.height > 0)
    };
  `)
  assert.equal(market.visible, true)
  assert.ok(market.text.length > 0)

  await ui.click('#settings-nav-plugins')
  await ui.waitFor('[data-profile-bundle="dshmarket"]', { timeout: 15_000 })
  await ui.click('[data-profile-bundle-detail="dshmarket"]')
  await ui.waitFor('[data-dsh-client-partial-slots]', { timeout: 15_000 })
  const clientSurface = await session.evalJs(`
    const detail = document.querySelector('[data-dsh-client-surface-status]');
    return detail?.textContent?.replace(/\\s+/g, ' ').trim() || '';
  `)
  assert.match(clientSurface, /conversation\.composer/)
  assert.match(clientSurface, /conversation\.hero\.agentPreset/)
  assert.match(clientSurface, /conversation\.details\.tool/)
  assert.match(clientSurface, /conversation\.chat\.node/)
  assert.match(clientSurface, /tool-call/)
  assert.match(clientSurface, /conversation\.view/)
  await ui.press('Escape')
  await ui.waitUntil(
    () => !document.querySelector('[data-dsh-client-partial-slots]'),
    { timeout: 5_000, label: 'Bundle 详情弹窗关闭' }
  )
  await ui.click('[data-profile-bundle-uninstall="dshmarket"]')
  await new Promise((resolve) => setTimeout(resolve, 300))
  if (!await ui.exists('[data-profile-uninstall-confirm="dshmarket"]')) {
    await ui.click('[data-profile-bundle-uninstall="dshmarket"]')
  }
  await ui.waitFor('[data-profile-uninstall-confirm="dshmarket"]', { timeout: 5_000 })
  await ui.click('[data-profile-uninstall-confirm="dshmarket"]')

  await ui.waitFor('[data-dsh-open-settings]', { timeout: 45_000 })
  await ui.click('[data-dsh-open-settings]')
  await ui.waitFor('#settings-nav-plugins', { timeout: 15_000 })
  assert.equal(await ui.exists('#dsh-settings-nav-market'), false)
  await ui.click('#settings-nav-plugins')
  await ui.waitFor('[data-community-plugin-install="dshmarket"]', { timeout: 15_000 })
  assert.equal(await ui.exists('[data-profile-bundle="dshmarket"]'), false)

  console.log('[dsh-market-ui-smoke] PASS 插件中心预检/安装/Client图刷新/Slot能力分组/settings.section/卸载/真实Electron渲染')
} finally {
  try { await session?.close() } catch { /* ignore */ }
  try { rmSync(evalHome, { recursive: true, force: true }) } catch { /* ignore */ }
}
