import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const plugin = readFileSync(fileURLToPath(new URL(
  '../../../packages/dsh-client-product-attachments/src/client/index.ts',
  import.meta.url
)), 'utf8')
const conversation = readFileSync(fileURLToPath(new URL(
  '../views/agent/AgentConversation.tsx',
  import.meta.url
)), 'utf8')

describe('dsh product attachment Client plugin', () => {
  it('owns the formal attachment view through the standard input dock', () => {
    expect(plugin).toContain("export const inject = ['slots', 'locale', 'dshWorkProductAttachments']")
    expect(plugin).toContain("ctx.slots.inject('conversation.input.dock'")
    expect(plugin).toContain("ctx.slots.inject('dsh-work.composer.pre-session'")
    expect(plugin).toContain("id: 'dsh-work-product-attachments'")
    expect(plugin).toContain('React.createElement(AttachmentRail')
    expect(plugin).toContain("'data-dsh-product-attachments': true")
    expect(conversation).toContain('conversation.updateProductAttachments(productAttachments)')
    expect(conversation).toContain('conversation.bindProductAttachmentHandlers')
    expect(conversation).toContain('attachments.length > 0 && !dshClientHost')
    expect(conversation).toContain('data-dsh-work-pre-session-attachments')
  })
})
