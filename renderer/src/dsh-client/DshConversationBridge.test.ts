import { describe, expect, it, vi } from 'vitest'
import type { ClientContext, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { DshConversationBridge } from './DshConversationBridge'

function sessionList() {
  let snapshot: SessionListState = {
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next: SessionListState) {
      snapshot = next
      for (const listener of listeners) listener()
    }
  }
}

describe('DshConversationBridge', () => {
  it('opens the bound DSH Session only after the Client list knows it', () => {
    const list = sessionList()
    const open = vi.fn()
    const clear = vi.fn()
    const provide = vi.fn(() => vi.fn())
    const bridge = new DshConversationBridge({ list, open, clear, provide })
    const sessionId = 'dsh-session-1' as SessionId

    bridge.syncSession(sessionId)
    expect(open).not.toHaveBeenCalled()

    list.set({
      ...list.getSnapshot(),
      ids: [sessionId],
      byId: {
        [sessionId]: {
          id: sessionId,
          displayTitle: 'Session',
          running: false,
          blank: false,
          updatedAt: 1
        }
      }
    })
    expect(open).toHaveBeenCalledWith(sessionId)
    expect(clear).not.toHaveBeenCalled()

    bridge.dispose()
    expect(provide).toHaveBeenCalledOnce()
  })

  it('publishes one stable read-only draft and clears the staged Session explicitly', () => {
    const sessionId = 'dsh-session-2' as SessionId
    const list = sessionList()
    list.set({
      ...list.getSnapshot(),
      ids: [sessionId],
      current: sessionId,
      byId: {
        [sessionId]: {
          id: sessionId,
          displayTitle: 'Session',
          running: false,
          blank: false,
          updatedAt: 1
        }
      }
    })
    const clear = vi.fn()
    const bridge = new DshConversationBridge({ list, open: vi.fn(), clear, provide: vi.fn(() => vi.fn()) })
    const listener = vi.fn()
    bridge.subscribeInput(listener)

    bridge.syncSession(sessionId)
    bridge.updateDraft('hello')
    const snapshot = bridge.getInputSnapshot()
    bridge.updateDraft('hello')

    expect(snapshot).toMatchObject({ draft: 'hello', draftRev: 2, phase: 'plain', queue: [] })
    expect(listener).toHaveBeenCalledTimes(2)

    bridge.syncSession(null)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(bridge.getInputSnapshot().draft).toBe('')

    bridge.dispose()
  })

  it('provides the App input through the standard per-Session DSH kit', () => {
    const sessionId = 'dsh-session-3' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const provide = vi.fn((value) => {
      descriptor = value
      return vi.fn()
    })
    const bridge = new DshConversationBridge({ list, open: vi.fn(), clear: vi.fn(), provide })
    const setDraft = vi.fn()
    const submit = vi.fn()
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft, submit })

    const resolved = descriptor!.resolve({ sessionId } as never)
    const props = resolved.props as {
      inputActions: { setDraft: (draft: string) => void; submit: () => void }
    }
    const hooks = resolved.hooks as unknown as {
      input: { getSnapshot: () => { draft: string } }
    }
    props.inputActions.setDraft('from plugin')
    props.inputActions.submit()

    expect(hooks.input.getSnapshot().draft).toBe('')
    expect(setDraft).toHaveBeenCalledWith('from plugin')
    expect(submit).toHaveBeenCalledOnce()
    bridge.dispose()
  })
})
