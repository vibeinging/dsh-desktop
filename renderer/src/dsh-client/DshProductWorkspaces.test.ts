import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const plugin = readFileSync(fileURLToPath(new URL(
  '../../../packages/dsh-client-product-workspaces/src/client/index.ts',
  import.meta.url
)), 'utf8')
const conversation = readFileSync(fileURLToPath(new URL(
  '../views/agent/AgentConversation.tsx',
  import.meta.url
)), 'utf8')

describe('dsh product Workspace Hero Client plugin', () => {
  it('owns the standard single Hero Slot while standalone keeps the local picker', () => {
    expect(plugin).toContain("export const inject = ['slots', 'locale', 'dshWorkProductWorkspaces']")
    expect(plugin).toContain("ctx.slots.inject('conversation.hero.workspace'")
    expect(plugin).not.toContain("id: 'dsh-work-workspace-picker'")
    expect(plugin).toContain("'data-dsh-product-workspace-picker': true")
    expect(conversation).toContain('data-dsh-conversation-hero-workspace')
    expect(conversation).toContain('dshClientHost ? (')
    expect(conversation).toContain(') : workspaces.length > 0 && onSelectWorkspace ? (')
  })
})
