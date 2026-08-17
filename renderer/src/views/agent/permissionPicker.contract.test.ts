import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const conversation = readFileSync(fileURLToPath(new URL('./AgentConversation.tsx', import.meta.url)), 'utf8')
const api = readFileSync(fileURLToPath(new URL('../../api/agent.ts', import.meta.url)), 'utf8')
const smoke = readFileSync(fileURLToPath(new URL('../../../../eval/native-multi-agent-ui-smoke.mjs', import.meta.url)), 'utf8')

describe('official DSH session permission surface', () => {
  it('does not keep a second permission projection or picker in the product conversation', () => {
    expect(conversation).not.toContain("import PermissionPicker from './PermissionPicker'")
    expect(conversation).not.toContain('data-testid="dsh-permission-picker"')
    expect(conversation).not.toContain('state?.projections?.permissions')
    expect(conversation).not.toContain('setDshSessionPermission')
    expect(api).not.toContain('export const setDshSessionPermission')
  })

  it('accepts current-session changes only through the official command decoration', () => {
    expect(smoke).toContain("await ui.fill('[data-testid=\"agent-message-input\"]', '/permission')")
    expect(smoke).toContain("'[role=\"listbox\"][aria-label^=\"/permission\"]'")
    expect(smoke).toContain("document.querySelector('[data-testid=\"dsh-permission-picker\"]') === null")
  })
})
