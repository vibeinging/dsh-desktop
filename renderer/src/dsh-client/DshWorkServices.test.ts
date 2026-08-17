import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import { DshWorkConversationService } from '../../../packages/dsh-work-shell/src/client/ConversationService'
import { DshWorkProductActionsService } from '../../../packages/dsh-work-shell/src/client/ProductActionsService'
import { DshWorkProductReferencesService } from '../../../packages/dsh-work-shell/src/client/ProductReferencesService'
import { DshWorkProductSearchModeService } from '../../../packages/dsh-work-shell/src/client/ProductSearchModeService'

describe('dsh-work Client services', () => {
  it('keeps product actions reachable through a caller plugin Context proxy', () => {
    const root = new Context()
    const runProductCommand = vi.fn(() => true)
    new DshWorkProductActionsService(root, { runProductCommand })

    const caller = root.extend()
    const sessionId = 'session-product-action' as SessionId
    expect(caller.dshWorkProductActions.run(sessionId, 'runs')).toBe(true)
    expect(runProductCommand).toHaveBeenCalledWith(sessionId, 'runs')
  })

  it('keeps official conversation methods reachable through a Session-scoped Context proxy', async () => {
    const root = new Context()
    const prompt = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const sessionId = 'session-conversation-service' as SessionId
    const caller = root.extend()
    new DshWorkConversationService(root, {
      input: {} as never,
      blocks: {} as never,
      sessions: {
        scopeOf: () => sessionId,
        binding: (id) => id === sessionId ? { session: { prompt } } as never : undefined
      }
    })

    await caller.conversation.send('hello')
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'hello' }], 'queue')
  })

  it('keeps product reference catalogs reachable through a caller plugin Context proxy', async () => {
    const root = new Context()
    const listProductReferences = vi.fn(async () => [{ name: 'project/report.md', text: '@/work/report.md ' }])
    new DshWorkProductReferencesService(root, { listProductReferences })

    const caller = root.extend()
    const sessionId = 'session-product-references' as SessionId
    await expect(caller.dshWorkProductReferences.list(sessionId, 'file', 'report')).resolves.toEqual([
      { name: 'project/report.md', text: '@/work/report.md ' }
    ])
    expect(listProductReferences).toHaveBeenCalledWith(sessionId, 'file', 'report')
  })

  it('keeps the product search-mode projection reachable through a caller plugin Context proxy', () => {
    const root = new Context()
    const subscribeProductSearchMode = vi.fn(() => vi.fn())
    const cycleProductSearchMode = vi.fn(() => true)
    const getProductSearchModeSnapshot = vi.fn(() => 'required' as const)
    new DshWorkProductSearchModeService(root, {
      subscribeProductSearchMode,
      cycleProductSearchMode,
      getProductSearchModeSnapshot
    })

    const caller = root.extend()
    const sessionId = 'session-product-search-mode' as SessionId
    expect(caller.dshWorkProductSearchMode.getSnapshot(sessionId)).toBe('required')
    expect(caller.dshWorkProductSearchMode.cycle(sessionId)).toBe(true)
    const listener = vi.fn()
    const off = caller.dshWorkProductSearchMode.subscribe(sessionId, listener)
    expect(subscribeProductSearchMode).toHaveBeenCalledWith(sessionId, listener)
    off()
  })
})
