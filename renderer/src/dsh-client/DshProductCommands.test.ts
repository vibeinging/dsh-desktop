import { describe, expect, it, vi } from 'vitest'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject } from '../../../packages/dsh-client-product-commands/src/client/index'

describe('dsh product command Client plugin', () => {
  it('declares every Client service read by the command path', () => {
    expect(inject).toEqual(['sessions', 'inputTriggers', 'locale', 'dshWorkProductActions'])
  })

  it('registers one Session-fenced input source and dispatches through the narrow product service', async () => {
    let source: InputTriggerSource | undefined
    let allowConsume = true
    const run = vi.fn(() => true)
    const registerLocale = vi.fn(() => vi.fn())
    const registerSource = vi.fn((value: InputTriggerSource) => {
      source = value
      return vi.fn()
    })
    const actx = { bail: vi.fn(() => allowConsume) }
    const ctx = {
      locale: {
        bind: () => (key: string) => `translated:${key}`,
        register: registerLocale
      },
      sessions: { scope: () => actx },
      inputTriggers: { registerSource },
      dshWorkProductActions: { run },
      effect: (factory: () => unknown) => factory()
    }

    apply(ctx as never)
    expect(registerLocale).toHaveBeenCalledOnce()
    expect(registerSource).toHaveBeenCalledOnce()
    expect(source?.name).toBe('dsh-work')

    const candidates = await source?.candidates({} as never, {
      query: 'tr',
      position: 'leading'
    } as never)
    expect(candidates).toEqual([{ name: 'trace', description: 'translated:command.trace' }])

    const sessionId = 'session-product-command'
    const outcome = source?.onPick?.({
      candidate: { name: 'trace' },
      session: { sessionId },
      span: { start: 0, end: 3, draftRev: 1 }
    } as never)
    expect(outcome).toBe('handled')
    await Promise.resolve()
    expect(run).toHaveBeenCalledWith(sessionId, 'trace')

    allowConsume = false
    await expect(source?.matchEnter?.(
      { sessionId } as never,
      '/runs',
      new AbortController().signal
    )).rejects.toThrow('could not consume /runs')
    expect(run).toHaveBeenCalledOnce()
  })
})
