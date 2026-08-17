import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(new URL('./AgentShell.tsx', import.meta.url), 'utf8')

describe('Agent settings navigation hook order', () => {
  it('runs every AgentShell hook before page takeover returns', () => {
    const settingsTakeover = shell.indexOf('if (showSettings) {')
    const projectTakeover = shell.indexOf('if (configWsId) {')

    expect(settingsTakeover).toBeGreaterThan(0)
    expect(projectTakeover).toBeGreaterThan(settingsTakeover)
    expect(shell.slice(settingsTakeover)).not.toMatch(/\buse(?:Callback|Effect|LayoutEffect|Memo|Reducer|Ref|State|SyncExternalStore)\s*\(/)
  })
})
