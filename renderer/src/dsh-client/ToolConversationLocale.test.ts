import { describe, expect, it, vi } from 'vitest'
import { registerToolConversationLocale } from '../../../packages/dsh-work-shell/src/client/ToolConversationLocale'

describe('Tool conversation locale adapter', () => {
  it('owns matching rc.7 Tool dictionaries and releases them in reverse order', () => {
    const disposeZh = vi.fn()
    const disposeEn = vi.fn()
    const registrations: Array<{ namespace: string; locale: string; dictionary: Record<string, string> }> = []
    const locale = {
      register: vi.fn((namespace: string, id: string, dictionary: Record<string, string>) => {
        registrations.push({ namespace, locale: id, dictionary })
        return id === 'zh' ? disposeZh : disposeEn
      })
    } as unknown as Parameters<typeof registerToolConversationLocale>[0]

    const dispose = registerToolConversationLocale(locale)

    expect(registrations.map(({ namespace, locale: id }) => [namespace, id])).toEqual([
      ['conversation', 'zh'],
      ['conversation', 'en']
    ])
    expect(Object.keys(registrations[0].dictionary)).toEqual(Object.keys(registrations[1].dictionary))
    expect(registrations[0].dictionary['ask.rowTitle']).toBe('提问')
    expect(registrations[1].dictionary['terminal.noOutput']).toBe('No output')

    dispose()
    expect(disposeEn.mock.invocationCallOrder[0]).toBeLessThan(disposeZh.mock.invocationCallOrder[0])
  })

  it('releases the first locale if the second registration conflicts', () => {
    const disposeZh = vi.fn()
    const locale = {
      register: vi.fn()
        .mockReturnValueOnce(disposeZh)
        .mockImplementationOnce(() => { throw new Error('duplicate locale') })
    } as unknown as Parameters<typeof registerToolConversationLocale>[0]

    expect(() => registerToolConversationLocale(locale)).toThrow('duplicate locale')
    expect(disposeZh).toHaveBeenCalledOnce()
  })
})
