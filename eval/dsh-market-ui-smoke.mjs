import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DshProfilePluginService } from '../server/src/engine/dsh_runtime/profile_plugin_service.js'
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
  const profiles = new DshProfilePluginService({
    env: {
      ...process.env,
      DSH_RUNTIME_DISTRIBUTION: 'npm',
      DSH_RUNTIME_HOME: runtimeHome,
      DSH_HOME: runtimeHome
    },
    restartRuntime: async () => ({ restarted: false, sessions: [] })
  })
  const installed = await profiles.install('dshmarket@1.9.0')
  assert.equal(installed.id, 'dshmarket')
  assert.equal(installed.version, '1.9.0')

  session = await openSession({ port: 9361 })
  const ui = makeUiDriver(session)

  await session.evalJs(`
    localStorage.setItem('dsh:onboarding:completed:v1', 'true');
    return true;
  `)
  await session.cdp('Page.reload', { ignoreCache: true }, { timeoutMs: 10_000 })
  await ui.waitFor('[data-dsh-open-settings]', { timeout: 30_000 })
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

  console.log('[dsh-market-ui-smoke] PASS npm固定版本/Profile安装/Client图/settings.section/真实Electron渲染')
} finally {
  try { await session?.close() } catch { /* ignore */ }
  try { rmSync(evalHome, { recursive: true, force: true }) } catch { /* ignore */ }
}
