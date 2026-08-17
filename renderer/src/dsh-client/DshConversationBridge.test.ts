import { describe, expect, it, vi } from 'vitest'
import type {
  ClientContext,
  SessionBinding,
  SessionId,
  SessionListState,
  ToolCallBlock
} from '@deepseek-ai/dsh-client-runtime/client'
import type { MenuState, PickOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
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
  const adjudicate = vi.fn(async (_line: string, _signal: AbortSignal): Promise<PickOutcome> => undefined)
  const controller = {
    serializeReference,
    menu,
    launcher,
    track: vi.fn(),
    arbitrate: vi.fn(() => 'consumed' as const),
    adjudicate,
    onSpace: vi.fn(() => false),
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
    ctx,
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

function createBridge(
  sessions: ConstructorParameters<typeof DshConversationBridge>[0],
  inputTriggers: ConstructorParameters<typeof DshConversationBridge>[1] = {
    sessionOf: (ctx) => ctx.inputTriggers.sessionOf(ctx)
  }
) {
  return new DshConversationBridge(sessions, {
    sessionOf: inputTriggers.sessionOf
  })
}

describe('DshConversationBridge', () => {
  it('opens the bound DSH Session only after the Client list knows it', () => {
    const list = sessionList()
    const open = vi.fn()
    const clear = vi.fn()
    const provide = vi.fn(() => vi.fn())
    const bridge = createBridge({ list, open, clear, provide })
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
    const bridge = createBridge({ list, open: vi.fn(), clear, provide: vi.fn(() => vi.fn()) })
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

  it('resolves input controllers from the injected root service instead of the Agent scope', () => {
    const sessionId = 'dsh-session-root-input-trigger' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const scope = inputScope(sessionId)
    const sessionOf = vi.fn(() => (
      scope.controller as unknown as ReturnType<ClientContext['inputTriggers']['sessionOf']>
    ))
    const bridge = createBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    }, { sessionOf })

    bridge.syncSession(sessionId)
    descriptor!.resolve(scope.binding)

    expect(sessionOf).toHaveBeenCalledWith(scope.ctx)
    expect(scope.ctx.inputTriggers.sessionOf).not.toHaveBeenCalled()
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
    const bridge = createBridge({ list, open: vi.fn(), clear: vi.fn(), provide })
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

  it('backs the official conversation service with the same Session input and blocker state', () => {
    const sessionId = 'dsh-session-official-conversation' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = createBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const setDraft = vi.fn()
    const submit = vi.fn()
    const notify = vi.fn()
    const scope = inputScope(sessionId)
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft, submit, notify })
    descriptor!.resolve(scope.binding)

    const input = bridge.input.for(scope.ctx as unknown as ClientContext)
    input.setDraft('official draft')
    input.submit()
    input.notify('info', 'official notice')

    expect(input.state.getSnapshot().draft).toBe('official draft')
    expect(setDraft).toHaveBeenCalledWith('official draft')
    expect(submit).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith('info', 'official notice')

    const blocker = vi.fn()
    bridge.subscribeComposerBlock(blocker)
    bridge.blocks.set(sessionId, { reason: '请先选择可用模型' })
    expect(bridge.getComposerBlockSnapshot()).toEqual({ reason: '请先选择可用模型' })
    expect(blocker).toHaveBeenCalledOnce()
    bridge.blocks.set(sessionId, undefined)
    expect(bridge.getComposerBlockSnapshot()).toBeUndefined()

    bridge.dispose()
  })

  it('routes standard conversation file actions through the current product handler', () => {
    const list = sessionList()
    const bridge = createBridge({ list, open: vi.fn(), clear: vi.fn(), provide: vi.fn(() => vi.fn()) })
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
    const bridge = createBridge({ list, open: vi.fn(), clear: vi.fn(), provide: vi.fn(() => vi.fn()) })
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

  it('publishes official Tool blocks without storing a second Tool lifecycle', () => {
    const list = sessionList()
    const bridge = createBridge({ list, open: vi.fn(), clear: vi.fn(), provide: vi.fn(() => vi.fn()) })
    const listener = vi.fn()
    const unsubscribe = bridge.subscribeToolCalls(listener)
    const block: ToolCallBlock = {
      callId: 'call-1',
      name: 'bash',
      argsRaw: '{"command":"pwd"}',
      turn: 1,
      step: 1,
      time: 1000,
      callView: null,
      subCalls: []
    }

    const unregister = bridge.registerToolCall(block)
    expect(bridge.getToolCallSnapshot().get('call-1')).toBe(block)
    expect(listener).toHaveBeenCalledOnce()

    unregister()
    expect(bridge.getToolCallSnapshot().has('call-1')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    bridge.dispose()
  })

  it('keeps Tool details selection inside the bound Session and registered call lifetime', async () => {
    const sessionId = 'dsh-session-tool-details' as SessionId
    const otherSessionId = 'dsh-session-other-tool-details' as SessionId
    const list = sessionList()
    const open = vi.fn()
    const bridge = createBridge({ list, open, clear: vi.fn(), provide: vi.fn(() => vi.fn()) })
    const listener = vi.fn()
    bridge.subscribeToolSelection(listener)
    bridge.syncSession(sessionId)
    list.set({
      ...list.getSnapshot(),
      ids: [sessionId, otherSessionId],
      current: otherSessionId,
      byId: {
        [sessionId]: { id: sessionId, displayTitle: 'Tool details', running: true, blank: false, updatedAt: 2 },
        [otherSessionId]: { id: otherSessionId, displayTitle: 'Child', running: false, blank: false, updatedAt: 1 }
      }
    })
    open.mockClear()

    expect(bridge.selectToolCall(sessionId, 'missing-call')).toBe(false)
    const block: ToolCallBlock = {
      callId: 'call-details',
      name: 'bash',
      argsRaw: '{"command":"pwd"}',
      turn: 1,
      step: 1,
      time: 1000,
      callView: null,
      subCalls: []
    }
    const unregister = bridge.registerToolCall(block)

    expect(bridge.selectToolCall(otherSessionId, 'call-details')).toBe(false)
    expect(bridge.selectToolCall(sessionId, 'call-details')).toBe(true)
    expect(open).toHaveBeenCalledWith(sessionId)
    expect(bridge.getToolSelectionSnapshot()).toEqual({ sessionId, callId: 'call-details' })
    expect(listener).toHaveBeenCalledOnce()
    expect(bridge.selectToolCall(sessionId, 'call-details')).toBe(true)
    expect(listener).toHaveBeenCalledOnce()

    const replacement = { ...block, name: 'read' }
    unregister()
    const unregisterReplacement = bridge.registerToolCall(replacement)
    await Promise.resolve()
    expect(bridge.getToolCallSnapshot().get('call-details')).toBe(replacement)
    expect(bridge.getToolSelectionSnapshot()).toEqual({ sessionId, callId: 'call-details' })
    unregisterReplacement()
    await Promise.resolve()
    expect(bridge.getToolSelectionSnapshot()).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)

    const unregisterNext = bridge.registerToolCall({ ...block, callId: 'call-next' })
    expect(bridge.selectToolCall(sessionId, 'call-next')).toBe(true)
    bridge.syncSession(otherSessionId)
    expect(bridge.getToolSelectionSnapshot()).toBeUndefined()
    unregisterNext()
    bridge.dispose()
  })

  it('applies official reference events to the product draft and serializes through the source codec', async () => {
    const sessionId = 'dsh-session-reference' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = createBridge({
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
    const bridge = createBridge({
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
    const bridge = createBridge({
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
    const bridge = createBridge({
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

  it('adjudicates a leading slash and reaches the product sender only on a directory miss', async () => {
    const sessionId = 'dsh-session-adjudicate-miss' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = createBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const submitDefault = vi.fn()
    const scope = inputScope(sessionId)
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft: vi.fn(), submit: vi.fn(), submitDefault })
    descriptor!.resolve(scope.binding)
    bridge.updateDraft('/unknown')

    expect(bridge.submitOfficialInput()).toBe(true)
    expect(bridge.getInputSnapshot().phase).toBe('adjudicating')
    await vi.waitFor(() => expect(bridge.getInputSnapshot().phase).toBe('plain'))
    expect(scope.controller.adjudicate).toHaveBeenCalledWith('/unknown', expect.any(AbortSignal))
    expect(submitDefault).toHaveBeenCalledOnce()
    expect(bridge.getInputSnapshot().draft).toBe('/unknown')

    bridge.updateDraft('ordinary prompt')
    expect(bridge.submitOfficialInput()).toBe(false)
    bridge.dispose()
  })

  it('retains the slash draft when official directory adjudication fails', async () => {
    const sessionId = 'dsh-session-adjudicate-failure' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = createBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const notify = vi.fn()
    const submitDefault = vi.fn()
    const scope = inputScope(sessionId)
    scope.controller.adjudicate.mockRejectedValueOnce(new Error('command catalog unavailable'))
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft: vi.fn(), submit: vi.fn(), submitDefault, notify })
    descriptor!.resolve(scope.binding)
    bridge.updateDraft('/compact')

    expect(bridge.submitOfficialInput()).toBe(true)
    await vi.waitFor(() => expect(bridge.getInputSnapshot().phase).toBe('plain'))
    expect(bridge.getInputSnapshot().draft).toBe('/compact')
    expect(submitDefault).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('error', 'command catalog unavailable')
    bridge.dispose()
  })

  it('submits an adjudicated bare command claim without sending a chat prompt', async () => {
    const sessionId = 'dsh-session-adjudicate-claim' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = createBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const setDraft = vi.fn()
    const submitDefault = vi.fn()
    const scope = inputScope(sessionId)
    const claim = { token: '/goal ', submit: vi.fn(async () => ({ kind: 'success' as const })) }
    scope.controller.adjudicate.mockResolvedValueOnce({ claim })
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft, submit: vi.fn(), submitDefault })
    descriptor!.resolve(scope.binding)
    bridge.updateDraft('/goal')

    expect(bridge.submitOfficialInput()).toBe(true)
    await vi.waitFor(() => expect(bridge.getInputSnapshot().phase).toBe('plain'))
    expect(claim.submit).toHaveBeenCalledWith('', scope.binding.ctx)
    expect(bridge.getInputSnapshot().draft).toBe('')
    expect(setDraft).toHaveBeenLastCalledWith('')
    expect(submitDefault).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('accepts an adjudicator-owned token mutation without replaying the default sender', async () => {
    const sessionId = 'dsh-session-adjudicate-handled' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = createBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const submitDefault = vi.fn()
    const scope = inputScope(sessionId)
    scope.controller.adjudicate.mockImplementationOnce(async () => {
      scope.emit('slash/input-consume-token', { guard: { kind: 'bare-token', token: '/new' } })
      return 'handled'
    })
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft: vi.fn(), submit: vi.fn(), submitDefault })
    descriptor!.resolve(scope.binding)
    bridge.updateDraft('/new')

    expect(bridge.submitOfficialInput()).toBe(true)
    await vi.waitFor(() => expect(bridge.getInputSnapshot().phase).toBe('plain'))
    expect(bridge.getInputSnapshot().draft).toBe('')
    expect(submitDefault).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('aborts and ignores a late adjudication after the product selects another Session', async () => {
    const sessionId = 'dsh-session-adjudicate-old' as SessionId
    const nextSessionId = 'dsh-session-adjudicate-new' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    let settle: ((outcome: PickOutcome) => void) | undefined
    let signal: AbortSignal | undefined
    const bridge = createBridge({
      list,
      open: vi.fn(),
      clear: vi.fn(),
      provide: vi.fn((value) => {
        descriptor = value
        return vi.fn()
      })
    })
    const submitDefault = vi.fn()
    const scope = inputScope(sessionId)
    scope.controller.adjudicate.mockImplementationOnce((_line, attemptSignal) => {
      signal = attemptSignal
      return new Promise<PickOutcome>((resolve) => { settle = resolve })
    })
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft: vi.fn(), submit: vi.fn(), submitDefault })
    descriptor!.resolve(scope.binding)
    bridge.updateDraft('/unknown')
    expect(bridge.submitOfficialInput()).toBe(true)

    bridge.syncSession(nextSessionId)
    bridge.updateDraft('new session draft')
    expect(signal?.aborted).toBe(true)
    settle!(undefined)
    await Promise.resolve()
    await Promise.resolve()

    expect(bridge.getInputSnapshot()).toMatchObject({ draft: 'new session draft', phase: 'plain' })
    expect(submitDefault).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('drops a late command settlement after the product selects another Session', async () => {
    const sessionId = 'dsh-session-command-old' as SessionId
    const nextSessionId = 'dsh-session-command-new' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    let settle: ((value: { kind: 'success'; text: string }) => void) | undefined
    const bridge = createBridge({
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
    const bridge = createBridge({
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

  it('lets an official Space claim replace the leading token in the shared product draft', () => {
    const sessionId = 'dsh-session-space-claim' as SessionId
    const list = sessionList()
    let descriptor: Parameters<ClientContext['sessions']['provide']>[0] | undefined
    const bridge = createBridge({
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
    const claim = { token: '/goal ', hint: '目标内容', submit: vi.fn() }
    bridge.syncSession(sessionId)
    bridge.bindInputHandlers({ setDraft, submit: vi.fn() })
    descriptor!.resolve(scope.binding)
    bridge.updateDraft('/goal')
    const draftRev = bridge.getInputSnapshot().draftRev
    scope.controller.onSpace.mockImplementationOnce(() => {
      scope.emit('slash/input-begin-command', {
        claim,
        span: { start: 0, end: 5, draftRev }
      })
      return true
    })

    expect(bridge.applyInputSpace()).toBe(true)
    expect(bridge.getInputSnapshot()).toMatchObject({
      draft: '/goal ',
      phase: 'claimed',
      claim: { token: '/goal ', hint: '目标内容' }
    })
    expect(setDraft).toHaveBeenCalledWith('/goal ')
    expect(scope.controller.track).toHaveBeenLastCalledWith('/goal ', 6, { tier: 'claimed' }, draftRev + 1)

    scope.controller.onSpace.mockReturnValueOnce(false)
    expect(bridge.applyInputSpace()).toBe(false)
    bridge.dispose()
  })
})
