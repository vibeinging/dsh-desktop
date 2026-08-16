import { describe, expect, it, vi } from 'vitest'
import type {
  ClientContext,
  SessionBinding,
  SessionId,
  SessionListState
} from '@deepseek-ai/dsh-client-runtime/client'
import type { MenuState } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { DshConversationBridge } from './DshConversationBridge'

function inputScope(sessionId: SessionId) {
  const listeners = new Map<string, (request: unknown) => unknown>()
  const serializeReference = vi.fn(async (source: string, ref: string) => `<${source}>${ref}</${source}>`)
  const snapshotStore = <T,>(initial: T) => {
    let snapshot = initial
    const storeListeners = new Set<() => void>()
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        storeListeners.add(listener)
        return () => storeListeners.delete(listener)
      },
      set(next: T) {
        snapshot = next
        for (const listener of storeListeners) listener()
      }
    }
  }
  const menu = snapshotStore<MenuState>({
    open: false,
    hit: null,
    generation: 0,
    groups: [],
    highlight: null
  })
  const launcher = snapshotStore<string | null>(null)
  const controller = {
    serializeReference,
    menu,
    launcher,
    track: vi.fn(),
    arbitrate: vi.fn(() => 'consumed' as const),
    dismiss: vi.fn()
  }
  const ctx = {
    inputTriggers: { sessionOf: vi.fn(() => controller) },
    on: vi.fn((name: string, listener: (request: unknown) => unknown) => {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    }),
    effect: vi.fn((execute: () => void | (() => void)) => {
      const cleanup = execute()
      return async () => {
        if (typeof cleanup === 'function') cleanup()
      }
    })
  }
  return {
    binding: { sessionId, ctx, session: {} } as unknown as SessionBinding,
    controller,
    emit: (name: string, request: unknown) => listeners.get(name)?.(request)
  }
}

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

    const resolved = descriptor!.resolve(inputScope(sessionId).binding)
    const props = resolved.props as {
      inputActions: { setDraft: (draft: string) => void; submit: () => void }
    }
    const hooks = resolved.hooks as unknown as {
      input: { getSnapshot: () => { draft: string } }
    }
    props.inputActions.setDraft('from plugin')
    props.inputActions.submit()

    expect(hooks.input.getSnapshot().draft).toBe('from plugin')
    expect(setDraft).toHaveBeenCalledWith('from plugin')
    expect(submit).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it('routes standard conversation file actions through the current product handler', () => {
    const list = sessionList()
    const bridge = new DshConversationBridge({ list, open: vi.fn(), clear: vi.fn(), provide: vi.fn(() => vi.fn()) })
    const first = vi.fn()
    const second = vi.fn()
    const unbindFirst = bridge.bindOpenFileHandler(first)

    bridge.openFile('report.md')
    expect(first).toHaveBeenCalledWith('report.md')

    bridge.bindOpenFileHandler(second)
    unbindFirst()
    bridge.openFile('result.csv')
    expect(second).toHaveBeenCalledWith('result.csv')

    bridge.dispose()
    bridge.openFile('ignored.txt')
    expect(second).toHaveBeenCalledOnce()
  })

  it('routes App-owned command contributions only through the selected Session', () => {
    const sessionId = 'dsh-session-product-command' as SessionId
    const otherSessionId = 'dsh-session-other-command' as SessionId
    const list = sessionList()
    const bridge = new DshConversationBridge({ list, open: vi.fn(), clear: vi.fn(), provide: vi.fn(() => vi.fn()) })
    const runCommand = vi.fn()
    bridge.bindInputHandlers({ setDraft: vi.fn(), submit: vi.fn(), runCommand })
    bridge.syncSession(sessionId)

    bridge.runProductCommand(otherSessionId, 'trace')
    expect(runCommand).not.toHaveBeenCalled()
    bridge.runProductCommand(sessionId, 'trace')
    expect(runCommand).toHaveBeenCalledWith('trace')

    bridge.dispose()
    bridge.runProductCommand(sessionId, 'runs')
    expect(runCommand).toHaveBeenCalledOnce()
  })

  it('applies official reference events to the product draft and serializes through the source codec', async () => {
    const sessionId = 'dsh-session-reference' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = new DshConversationBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const setDraft = vi.fn()
    const scope = inputScope(sessionId)
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft, submit: vi.fn() })
    bridge.updateDraft('@report')
    descriptor!.resolve(scope.binding)
    const draftRev = bridge.getInputSnapshot().draftRev

    const applied = scope.emit('slash/input-insert-reference', {
      reference: {
        source: 'files',
        ref: 'uploads/report.csv',
        label: 'report.csv',
        clipboardText: 'uploads/report.csv'
      },
      span: { start: 0, end: 7, draftRev }
    })

    expect(applied).toBe(true)
    expect(bridge.getInputSnapshot()).toMatchObject({
      draft: '\uFFFC ',
      occurrences: [{
        occurrenceId: 1,
        source: 'files',
        ref: 'uploads/report.csv',
        offset: 0,
        label: 'report.csv'
      }]
    })
    expect(setDraft).toHaveBeenCalledWith('\uFFFC ')
    expect(bridge.projectDraft('\uFFFC ')).toBe('uploads/report.csv ')
    await expect(bridge.serializeDraft('\uFFFC ')).resolves.toBe('<files>uploads/report.csv</files>')
    expect(scope.controller.serializeReference).toHaveBeenCalledWith(
      'files',
      'uploads/report.csv',
      expect.any(AbortSignal)
    )

    expect(scope.emit('slash/input-insert-reference', {
      reference: { source: 'files', ref: 'stale', label: 'stale', clipboardText: 'stale' },
      span: { start: 0, end: 0, draftRev }
    })).toBeUndefined()
    bridge.dispose()
  })

  it('keeps occurrence offsets aligned with product edits and drops deleted placeholders', () => {
    const sessionId = 'dsh-session-edit' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = new DshConversationBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const scope = inputScope(sessionId)
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft: vi.fn(), submit: vi.fn() })
    bridge.updateDraft('open @x please')
    const resolved = descriptor!.resolve(scope.binding)
    const actions = resolved.props?.inputActions as { setDraft: (draft: string) => void }
    scope.emit('slash/input-insert-reference', {
      reference: { source: 'files', ref: 'x', label: 'x', clipboardText: 'x' },
      span: { start: 5, end: 7, draftRev: bridge.getInputSnapshot().draftRev }
    })

    actions.setDraft('say open \uFFFC please')
    expect(bridge.getInputSnapshot().occurrences).toMatchObject([{ offset: 9, ref: 'x' }])

    actions.setDraft('say open  please')
    expect(bridge.getInputSnapshot().occurrences).toEqual([])
    bridge.dispose()
  })

  it('routes plain-text and token events only through the selected Session scope', () => {
    const sessionId = 'dsh-session-selected' as SessionId
    const otherSessionId = 'dsh-session-other' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = new DshConversationBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const selected = inputScope(sessionId)
    const other = inputScope(otherSessionId)
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft: vi.fn(), submit: vi.fn() })
    bridge.updateDraft('@x')
    descriptor!.resolve(selected.binding)
    descriptor!.resolve(other.binding)
    const draftRev = bridge.getInputSnapshot().draftRev

    expect(other.emit('slash/input-insert-text', {
      text: 'wrong ',
      span: { start: 0, end: 2, draftRev }
    })).toBeUndefined()
    expect(selected.emit('slash/input-insert-text', {
      text: 'file ',
      span: { start: 0, end: 2, draftRev }
    })).toBe(true)
    expect(bridge.getInputSnapshot().draft).toBe('file ')

    expect(selected.emit('slash/input-consume-token', {
      guard: { kind: 'bare-token', token: 'other' }
    })).toBeUndefined()
    expect(selected.emit('slash/input-consume-token', {
      guard: {
        kind: 'span',
        span: { start: 0, end: 4, draftRev: bridge.getInputSnapshot().draftRev }
      }
    })).toBe(true)
    expect(bridge.getInputSnapshot().draft).toBe(' ')
    bridge.dispose()
  })

  it('keeps official command claims scoped, integrity-watched, and retryable', async () => {
    const sessionId = 'dsh-session-command' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = new DshConversationBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const setDraft = vi.fn()
    const notify = vi.fn()
    const submit = vi.fn()
      .mockResolvedValueOnce({ kind: 'error', text: '参数无效' })
      .mockResolvedValueOnce({ kind: 'success', text: '目标已创建' })
    const claim = { token: '/goal ', hint: '目标内容', submit }
    const scope = inputScope(sessionId)
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft, submit: vi.fn(), notify })
    descriptor!.resolve(scope.binding)

    bridge.updateDraft('say /go')
    expect(scope.emit('slash/input-begin-command', {
      claim,
      span: { start: 4, end: 7, draftRev: bridge.getInputSnapshot().draftRev }
    })).toBeUndefined()
    bridge.updateDraft('/go')
    expect(scope.emit('slash/input-begin-command', {
      claim,
      span: { start: 0, end: 3, draftRev: bridge.getInputSnapshot().draftRev - 1 }
    })).toBeUndefined()

    expect(scope.emit('slash/input-begin-command', {
      claim,
      span: { start: 0, end: 3, draftRev: bridge.getInputSnapshot().draftRev }
    })).toBe(true)
    expect(bridge.getInputSnapshot()).toMatchObject({
      draft: '/goal ',
      phase: 'claimed',
      claim: { token: '/goal ', hint: '目标内容' }
    })
    expect(setDraft).toHaveBeenCalledWith('/goal ')

    bridge.updateDraft('/goal write docs')
    expect(bridge.getInputSnapshot().phase).toBe('claimed')
    expect(bridge.submitCommandClaim()).toBe(true)
    expect(bridge.getInputSnapshot().phase).toBe('submitting')
    await vi.waitFor(() => expect(bridge.getInputSnapshot().phase).toBe('claimed'))
    expect(submit).toHaveBeenNthCalledWith(1, 'write docs', scope.binding.ctx)
    expect(notify).toHaveBeenCalledWith('error', '参数无效')

    expect(bridge.submitCommandClaim()).toBe(true)
    await vi.waitFor(() => expect(bridge.getInputSnapshot().phase).toBe('plain'))
    expect(submit).toHaveBeenNthCalledWith(2, 'write docs', scope.binding.ctx)
    expect(bridge.getInputSnapshot().draft).toBe('')
    expect(setDraft).toHaveBeenLastCalledWith('')
    expect(notify).toHaveBeenCalledWith('info', '目标已创建')

    bridge.updateDraft('/go')
    expect(scope.emit('slash/input-begin-command', {
      claim,
      span: { start: 0, end: 3, draftRev: bridge.getInputSnapshot().draftRev }
    })).toBe(true)
    bridge.updateDraft('/other')
    expect(bridge.getInputSnapshot()).toMatchObject({ draft: '/other', phase: 'plain' })
    expect(bridge.getInputSnapshot().claim).toBeUndefined()
    expect(bridge.submitCommandClaim()).toBe(false)
    bridge.dispose()
  })

  it('drops a late command settlement after the product selects another Session', async () => {
    const sessionId = 'dsh-session-command-old' as SessionId
    const nextSessionId = 'dsh-session-command-new' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    let settle: ((value: { kind: 'success'; text: string }) => void) | undefined
    const bridge = new DshConversationBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const notify = vi.fn()
    const scope = inputScope(sessionId)
    const claim = {
      token: '/goal ',
      submit: vi.fn(() => new Promise<{ kind: 'success'; text: string }>((resolve) => { settle = resolve }))
    }
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft: vi.fn(), submit: vi.fn(), notify })
    bridge.updateDraft('/go')
    descriptor!.resolve(scope.binding)
    scope.emit('slash/input-begin-command', {
      claim,
      span: { start: 0, end: 3, draftRev: bridge.getInputSnapshot().draftRev }
    })
    expect(bridge.submitCommandClaim()).toBe(true)

    bridge.syncSession(nextSessionId)
    bridge.updateDraft('new session draft')
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'))
    settle!({ kind: 'success', text: 'late result' })
    await Promise.resolve()
    await Promise.resolve()

    expect(bridge.getInputSnapshot()).toMatchObject({ draft: 'new session draft', phase: 'plain' })
    expect(notify).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('lets ready official candidates own keyboard input without replacing the product slash menu', () => {
    const sessionId = 'dsh-session-trigger' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = new DshConversationBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const listener = vi.fn()
    const scope = inputScope(sessionId)
    bridge.syncSession(sessionId)
    bridge.subscribeInputTrigger(listener)
    descriptor!.resolve(scope.binding)

    expect(bridge.trackInputTrigger('@re', 99)).toBe(false)
    expect(scope.controller.track).toHaveBeenCalledWith('@re', 3, { tier: 'plain' }, 2)
    expect(bridge.arbitrateInputTrigger('down', false)).toBe('pass')
    expect(scope.controller.arbitrate).not.toHaveBeenCalled()

    scope.controller.menu.set({
      open: true,
      hit: {
        trigger: '@',
        query: 're',
        position: 'leading',
        span: { start: 0, end: 3, draftRev: 2 }
      },
      generation: 1,
      groups: [{ source: 'files', status: 'ready', items: [{ name: 'report.csv' }] }],
      highlight: { source: 'files', index: 0 }
    })
    expect(bridge.getInputTriggerActive()).toBe(true)
    expect(bridge.arbitrateInputTrigger('down', false)).toBe('consumed')
    expect(scope.controller.arbitrate).toHaveBeenCalledWith('down', false)

    scope.controller.menu.set({
      open: false,
      hit: null,
      generation: 2,
      groups: [],
      highlight: null
    })
    scope.controller.launcher.set('files')
    expect(bridge.getInputTriggerActive()).toBe(true)

    const tracked = scope.controller.track.mock.calls.length
    expect(bridge.trackInputTrigger('/new', 4, { reserveLeadingSlash: true })).toBe(false)
    expect(scope.controller.dismiss).toHaveBeenCalledOnce()
    expect(scope.controller.track).toHaveBeenCalledTimes(tracked)
    expect(listener).toHaveBeenCalled()
    bridge.dispose()
  })
})
