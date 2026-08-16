import type {
  ClientContext,
  SessionBinding,
  SessionId,
  SnapshotStore
} from '@deepseek-ai/dsh-client-runtime/client'
import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ArbitrateKey,
  ArbitrateOutcome,
  BeginCommandRequest,
  CommandClaim,
  ConsumeTokenRequest,
  InsertReferenceRequest,
  InputTriggerController,
  TokenSpan
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

type ComposerDockOwner = OwnerOf<'conversation.composer.dock'>
export type DshWorkComposerInputSnapshot = ComposerDockOwner['input']
type DshSessions = Pick<ClientContext['sessions'], 'list' | 'open' | 'clear' | 'provide'>
type DshWorkOccurrence = DshWorkComposerInputSnapshot['occurrences'][number]
type ScopeDisposer = () => Promise<void>

export interface DshWorkInputHandlers {
  setDraft: (draft: string) => void
  submit: () => void
  notify?: (level: 'info' | 'error', text: string) => void
  runCommand?: (name: string) => void
}

interface DshWorkInputActions {
  setDraft: (draft: string) => void
  addImages: (ids: readonly string[]) => boolean
  removeImage: (id: string) => void
  pruneImages: (ids: readonly string[]) => void
  submit: () => void
}

const EMPTY_INPUT: DshWorkComposerInputSnapshot = Object.freeze({
  draft: '',
  imageIds: Object.freeze([]),
  draftRev: 0,
  phase: 'plain',
  occurrences: Object.freeze([]),
  queue: Object.freeze([])
})
const REFERENCE_PLACEHOLDER = '\uFFFC'

interface EditRange {
  start: number
  end: number
  insertedLength: number
}

interface InsertTextRequest {
  readonly text: string
  readonly span: TokenSpan
}

interface DshWorkCommandAttempt {
  readonly seq: number
  readonly draft: string
}

interface DshWorkCommandState {
  readonly claim: CommandClaim
  readonly actx: ClientContext
  readonly attempt?: DshWorkCommandAttempt
}

function diffEdit(previous: string, next: string): EditRange {
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1

  let previousEnd = previous.length
  let nextEnd = next.length
  while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd -= 1
    nextEnd -= 1
  }
  return { start, end: previousEnd, insertedLength: nextEnd - start }
}

function reconcileOccurrences(
  occurrences: readonly DshWorkOccurrence[],
  range: EditRange
): readonly DshWorkOccurrence[] {
  const delta = range.insertedLength - (range.end - range.start)
  const kept: DshWorkOccurrence[] = []
  for (const occurrence of occurrences) {
    if (occurrence.offset < range.start) kept.push(occurrence)
    else if (occurrence.offset >= range.end) {
      kept.push(delta === 0 ? occurrence : { ...occurrence, offset: occurrence.offset + delta })
    }
  }
  return kept
}

function expandReferences(
  draft: string,
  occurrences: readonly DshWorkOccurrence[],
  project: (occurrence: DshWorkOccurrence) => string
) {
  let result = ''
  let cursor = 0
  for (const occurrence of occurrences) {
    result += draft.slice(cursor, occurrence.offset) + project(occurrence)
    cursor = occurrence.offset + REFERENCE_PLACEHOLDER.length
  }
  return result + draft.slice(cursor)
}

function argsAfter(draft: string, token: string) {
  const trimmed = draft.trimStart()
  if (trimmed.startsWith(token)) return trimmed.slice(token.length)
  const base = token.trimEnd()
  if (!trimmed.startsWith(base)) return ''
  const rest = trimmed.slice(base.length)
  return /^\s/.test(rest) ? rest.slice(1) : rest
}

function releaseClaim(snapshot: DshWorkComposerInputSnapshot): DshWorkComposerInputSnapshot {
  const { claim: _claim, ...plain } = snapshot
  return { ...plain, phase: 'plain' }
}

class BridgeInputStore implements SnapshotStore<DshWorkComposerInputSnapshot> {
  readonly #listeners = new Set<() => void>()
  #snapshot: DshWorkComposerInputSnapshot

  constructor(snapshot: DshWorkComposerInputSnapshot) {
    this.#snapshot = snapshot
  }

  getSnapshot = () => this.#snapshot

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  set(next: DshWorkComposerInputSnapshot) {
    if (next === this.#snapshot) return
    this.#snapshot = next
    for (const listener of this.#listeners) listener()
  }

  update(mutator: (draft: DshWorkComposerInputSnapshot) => void) {
    const next = { ...this.#snapshot }
    mutator(next)
    this.set(next)
  }
}

/**
 * Keep the product-selected App conversation bound to the matching DSH Client
 * Session without creating another session or queue store.
 */
export class DshConversationBridge {
  readonly #sessions: DshSessions
  readonly #listeners = new Set<() => void>()
  readonly #unsubscribeSessions: () => void
  readonly #disposeProvider: () => void
  readonly #stores = new Map<SessionId, BridgeInputStore>()
  readonly #actions = new Map<SessionId, DshWorkInputActions>()
  readonly #inputControllers = new Map<SessionId, InputTriggerController>()
  readonly #scopeDisposers = new Map<SessionId, ScopeDisposer>()
  readonly #inputTriggerListeners = new Set<() => void>()
  readonly #commandStates = new Map<SessionId, DshWorkCommandState>()
  #desiredSessionId: SessionId | null | undefined
  #input = EMPTY_INPUT
  #occurrenceSeq = 0
  #commandSeq = 0
  #handlers: DshWorkInputHandlers | null = null
  #openFileHandler: ((path: string) => void) | null = null
  #disposed = false

  constructor(sessions: DshSessions) {
    this.#sessions = sessions
    this.#unsubscribeSessions = sessions.list.subscribe(() => this.#reconcileSession())
    this.#disposeProvider = sessions.provide({
      hooks: ['input'],
      props: ['inputActions'],
      resolve: (binding) => {
        this.#ensureInputScope(binding)
        return {
          hooks: { input: this.#storeFor(binding.sessionId) },
          props: { inputActions: this.#actionsFor(binding.sessionId) }
        }
      }
    })
  }

  /** Select the exact DSH Session bound to the current App conversation. */
  syncSession(sessionId: string | null) {
    if (this.#disposed) return
    const next = sessionId ? sessionId as SessionId : null
    if (this.#desiredSessionId === next) {
      this.#reconcileSession()
      return
    }
    if (this.#desiredSessionId) this.#commandStates.delete(this.#desiredSessionId)
    this.#desiredSessionId = next
    this.#input = { ...EMPTY_INPUT, draftRev: this.#input.draftRev + 1 }
    if (next) this.#storeFor(next).set(this.#input)
    this.#emit()
    this.#emitInputTrigger()
    this.#reconcileSession()
  }

  /** Publish the App composer's current draft into the standard input snapshot. */
  updateDraft(draft: string) {
    if (this.#disposed || this.#input.draft === draft) return
    this.#replaceDraft(draft, false)
  }

  /** Project placeholder references into the text used for product display and persistence. */
  projectDraft(draft: string) {
    if (this.#disposed) return draft
    if (this.#input.draft !== draft) this.#replaceDraft(draft, false)
    return expandReferences(this.#input.draft, this.#input.occurrences, (occurrence) => occurrence.clipboardText)
  }

  /** Serialize every official input reference through the source that owns it. */
  async serializeDraft(draft: string) {
    if (this.#disposed) throw new Error('DSH 输入桥已经关闭')
    if (this.#input.draft !== draft) this.#replaceDraft(draft, false)
    const snapshot = this.#input
    if (snapshot.occurrences.length === 0) return snapshot.draft.trim()
    const sessionId = this.#desiredSessionId
    const controller = sessionId ? this.#inputControllers.get(sessionId) : undefined
    if (!controller) throw new Error('当前 DSH Session 尚未准备好引用序列化器')

    const abort = new AbortController()
    const parts = await Promise.all(snapshot.occurrences.map(async (occurrence) => ({
      occurrence,
      text: await controller.serializeReference(occurrence.source, occurrence.ref, abort.signal)
    }))).catch((error: unknown) => {
      abort.abort()
      throw error
    })
    if (this.#disposed || this.#input.draftRev !== snapshot.draftRev) {
      abort.abort()
      throw new Error('草稿在引用处理期间发生了变化，请重新发送')
    }
    return expandReferences(snapshot.draft, snapshot.occurrences, (occurrence) => {
      const part = parts.find((candidate) => candidate.occurrence.occurrenceId === occurrence.occurrenceId)
      if (!part) throw new Error(`引用 ${occurrence.label} 没有序列化结果`)
      return part.text
    }).trim()
  }

  /** Publish the current DSH Session queue into the standard input snapshot. */
  updateQueue(queue: DshWorkComposerInputSnapshot['queue']) {
    if (this.#disposed || this.#input.queue === queue) return
    this.#input = { ...this.#input, queue }
    this.#emit()
    if (this.#desiredSessionId) this.#storeFor(this.#desiredSessionId).set(this.#input)
  }

  /** Bind the product textarea and submit action to the standard DSH input face. */
  bindInputHandlers(handlers: DshWorkInputHandlers) {
    this.#handlers = handlers
    return () => {
      if (this.#handlers === handlers) this.#handlers = null
    }
  }

  /** Run one App-owned command contributed through the official input-trigger registry. */
  runProductCommand(sessionId: SessionId, name: string) {
    if (this.#disposed || this.#desiredSessionId !== sessionId) return
    this.#handlers?.runCommand?.(name)
  }

  /** Bind standard conversation file actions to the product Files workbench. */
  bindOpenFileHandler(handler: (path: string) => void) {
    this.#openFileHandler = handler
    return () => {
      if (this.#openFileHandler === handler) this.#openFileHandler = null
    }
  }

  /** Open a Session-authorized path through the product's current workspace. */
  openFile = (path: string) => {
    this.#openFileHandler?.(path)
  }

  /** Return the Session identity the product currently expects the Client to stage. */
  getSessionId() {
    return this.#desiredSessionId
  }

  /** Return the stable input snapshot consumed by useSyncExternalStore. */
  getInputSnapshot = () => this.#input

  /** Subscribe to product composer draft changes. */
  subscribeInput = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Feed the product draft and caret into the selected Session's official trigger controller. */
  trackInputTrigger(draft: string, caret: number, options: { reserveLeadingSlash?: boolean } = {}) {
    if (this.#disposed) return false
    if (this.#input.draft !== draft) this.#replaceDraft(draft, false)
    const controller = this.#selectedInputController()
    if (!controller) return false
    if (options.reserveLeadingSlash) {
      controller.dismiss()
      return false
    }
    const boundedCaret = Math.max(0, Math.min(caret, this.#input.draft.length))
    const tier = this.#input.phase === 'plain' || this.#input.phase === 'claimed'
      ? this.#input.phase
      : 'frozen'
    controller.track(this.#input.draft, boundedCaret, { tier }, this.#input.draftRev)
    return this.getInputTriggerActive()
  }

  /** Let the official menu own navigation only after it has content or an explicit launcher. */
  arbitrateInputTrigger(key: ArbitrateKey, composing: boolean): ArbitrateOutcome {
    const controller = this.#selectedInputController()
    if (!controller || !this.getInputTriggerActive()) return 'pass'
    return controller.arbitrate(key, composing)
  }

  /** Execute the selected Session's claimed command instead of sending it as a prompt. */
  submitCommandClaim() {
    if (this.#disposed) return false
    if (this.#input.phase === 'submitting') return true
    if (this.#input.phase !== 'claimed') return false
    const sessionId = this.#desiredSessionId
    const state = sessionId ? this.#commandStates.get(sessionId) : undefined
    if (!sessionId || !state || !this.#input.draft.startsWith(state.claim.token)) return false

    this.#commandSeq += 1
    const attempt = { seq: this.#commandSeq, draft: this.#input.draft }
    this.#commandStates.set(sessionId, { ...state, attempt })
    this.#publishInput({ ...this.#input, phase: 'submitting' })
    this.#selectedInputController()?.track(this.#input.draft, 0, { tier: 'frozen' }, this.#input.draftRev)
    Promise.resolve()
      .then(() => state.claim.submit(argsAfter(attempt.draft, state.claim.token), state.actx))
      .then(
        (outcome) => this.#settleCommand(sessionId, attempt, outcome.kind === 'success', outcome.text),
        (error: unknown) => this.#settleCommand(
          sessionId,
          attempt,
          false,
          error instanceof Error ? error.message : String(error)
        )
      )
    return true
  }

  /** Report whether the official input menu currently owns product keyboard input. */
  getInputTriggerActive = () => {
    const controller = this.#selectedInputController()
    if (!controller) return false
    if (controller.launcher.getSnapshot() !== null) return true
    const menu = controller.menu.getSnapshot()
    return menu.open && menu.groups.some((group) => group.status === 'ready' && group.items.length > 0)
  }

  /** Subscribe to official input-menu ownership changes for the selected Session. */
  subscribeInputTrigger = (listener: () => void) => {
    this.#inputTriggerListeners.add(listener)
    return () => this.#inputTriggerListeners.delete(listener)
  }

  /** Release the list listener and product handlers. */
  dispose = () => {
    if (this.#disposed) return
    this.#disposed = true
    this.#disposeProvider()
    this.#unsubscribeSessions()
    this.#listeners.clear()
    this.#inputTriggerListeners.clear()
    this.#stores.clear()
    this.#actions.clear()
    this.#commandStates.clear()
    for (const dispose of this.#scopeDisposers.values()) void dispose()
    this.#scopeDisposers.clear()
    this.#inputControllers.clear()
    this.#handlers = null
    this.#openFileHandler = null
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }

  #emitInputTrigger() {
    for (const listener of this.#inputTriggerListeners) listener()
  }

  #selectedInputController() {
    return this.#desiredSessionId ? this.#inputControllers.get(this.#desiredSessionId) : undefined
  }

  #publishInput(next: DshWorkComposerInputSnapshot) {
    let normalized = next
    const sessionId = this.#desiredSessionId
    if (next.phase === 'claimed') {
      const state = sessionId ? this.#commandStates.get(sessionId) : undefined
      if (!state || !next.draft.startsWith(state.claim.token)) {
        if (sessionId) this.#commandStates.delete(sessionId)
        normalized = releaseClaim(next)
      }
    } else if (next.phase === 'plain' && next.claim !== undefined) {
      normalized = releaseClaim(next)
    }
    this.#input = normalized
    this.#emit()
    if (sessionId) this.#storeFor(sessionId).set(normalized)
  }

  #replaceDraft(draft: string, notifyProduct: boolean) {
    const occurrences = reconcileOccurrences(this.#input.occurrences, diffEdit(this.#input.draft, draft))
    this.#publishInput({
      ...this.#input,
      draft,
      occurrences,
      draftRev: this.#input.draftRev + 1
    })
    if (notifyProduct) this.#handlers?.setDraft(draft)
  }

  #spanMatches(span: { start: number; end: number; draftRev: number }) {
    return span.draftRev === this.#input.draftRev &&
      span.start >= 0 && span.start <= span.end && span.end <= this.#input.draft.length
  }

  #insertReference(sessionId: SessionId, request: InsertReferenceRequest) {
    if (this.#disposed || this.#desiredSessionId !== sessionId || !this.#spanMatches(request.span)) return false
    if (this.#input.phase !== 'plain' && this.#input.phase !== 'claimed') return false
    const tail = this.#input.draft.slice(request.span.end)
    const inserted = REFERENCE_PLACEHOLDER + (tail.length === 0 || tail[0] !== ' ' ? ' ' : '')
    const occurrences = reconcileOccurrences(this.#input.occurrences, {
      start: request.span.start,
      end: request.span.end,
      insertedLength: inserted.length
    })
    this.#occurrenceSeq += 1
    const occurrence: DshWorkOccurrence = {
      occurrenceId: this.#occurrenceSeq,
      source: request.reference.source,
      ref: request.reference.ref,
      offset: request.span.start,
      label: request.reference.label,
      clipboardText: request.reference.clipboardText
    }
    const draft = this.#input.draft.slice(0, request.span.start) + inserted + tail
    this.#publishInput({
      ...this.#input,
      draft,
      occurrences: [...occurrences, occurrence].sort((left, right) => left.offset - right.offset),
      draftRev: this.#input.draftRev + 1
    })
    this.#handlers?.setDraft(draft)
    return true
  }

  #consumeToken(sessionId: SessionId, request: ConsumeTokenRequest) {
    if (this.#disposed || this.#desiredSessionId !== sessionId) return false
    if (request.guard.kind === 'bare-token') {
      if (this.#input.draft.trim() !== request.guard.token) return false
      this.#replaceDraft('', true)
      return true
    }
    const { span } = request.guard
    if (!this.#spanMatches(span) || span.start === span.end) return false
    this.#replaceDraft(this.#input.draft.slice(0, span.start) + this.#input.draft.slice(span.end), true)
    return true
  }

  #insertText(sessionId: SessionId, request: InsertTextRequest) {
    if (this.#disposed || this.#desiredSessionId !== sessionId || !this.#spanMatches(request.span)) return false
    const draft = this.#input.draft.slice(0, request.span.start) + request.text + this.#input.draft.slice(request.span.end)
    this.#replaceDraft(draft, true)
    return true
  }

  #beginCommand(sessionId: SessionId, actx: ClientContext, request: BeginCommandRequest) {
    if (this.#disposed || this.#desiredSessionId !== sessionId || !this.#spanMatches(request.span)) return false
    if (this.#input.phase !== 'plain' && this.#input.phase !== 'claimed') return false
    if (this.#input.draft.slice(0, request.span.start).trim() !== '') return false
    const draft = request.claim.token + this.#input.draft.slice(request.span.end)
    const occurrences = reconcileOccurrences(this.#input.occurrences, {
      start: 0,
      end: request.span.end,
      insertedLength: request.claim.token.length
    })
    this.#commandStates.set(sessionId, { claim: request.claim, actx })
    this.#publishInput({
      ...this.#input,
      draft,
      occurrences,
      draftRev: this.#input.draftRev + 1,
      phase: 'claimed',
      claim: {
        token: request.claim.token,
        ...(request.claim.hint !== undefined ? { hint: request.claim.hint } : {})
      }
    })
    this.#handlers?.setDraft(draft)
    return true
  }

  #settleCommand(sessionId: SessionId, attempt: DshWorkCommandAttempt, success: boolean, text?: string) {
    const state = this.#commandStates.get(sessionId)
    if (!state || state.attempt?.seq !== attempt.seq) return
    if (this.#disposed || this.#desiredSessionId !== sessionId) {
      this.#commandStates.delete(sessionId)
      return
    }
    if (success) {
      this.#commandStates.delete(sessionId)
      this.#publishInput({
        ...releaseClaim(this.#input),
        draft: '',
        occurrences: [],
        draftRev: this.#input.draftRev + 1
      })
      this.#handlers?.setDraft('')
      if (text) this.#handlers?.notify?.('info', text)
      return
    }

    const keepClaim = this.#input.draft === attempt.draft && this.#input.draft.startsWith(state.claim.token)
    if (keepClaim) {
      this.#commandStates.set(sessionId, { claim: state.claim, actx: state.actx })
      this.#publishInput({ ...this.#input, phase: 'claimed' })
    } else {
      this.#commandStates.delete(sessionId)
      this.#publishInput(releaseClaim(this.#input))
    }
    this.#handlers?.notify?.('error', text || '命令执行失败')
  }

  #ensureInputScope(binding: SessionBinding) {
    if (this.#inputControllers.has(binding.sessionId)) return
    const controller = binding.ctx.inputTriggers.sessionOf(binding.ctx)
    this.#inputControllers.set(binding.sessionId, controller)
    if (binding.sessionId === this.#desiredSessionId) this.#emitInputTrigger()
    const disposer = binding.ctx.effect(() => {
      const offMenu = controller.menu.subscribe(() => {
        if (binding.sessionId === this.#desiredSessionId) this.#emitInputTrigger()
      })
      const offLauncher = controller.launcher.subscribe(() => {
        if (binding.sessionId === this.#desiredSessionId) this.#emitInputTrigger()
      })
      const offs = [
        binding.ctx.on('slash/input-begin-command', (request) =>
          this.#beginCommand(binding.sessionId, binding.ctx, request) ? true : undefined),
        binding.ctx.on('slash/input-insert-reference', (request) =>
          this.#insertReference(binding.sessionId, request) ? true : undefined),
        binding.ctx.on('slash/input-consume-token', (request) =>
          this.#consumeToken(binding.sessionId, request) ? true : undefined),
        binding.ctx.on('slash/input-insert-text', (request) =>
          this.#insertText(binding.sessionId, request) ? true : undefined)
      ]
      return () => {
        offMenu()
        offLauncher()
        for (const off of offs) off()
        if (this.#inputControllers.get(binding.sessionId) === controller) {
          this.#inputControllers.delete(binding.sessionId)
          this.#scopeDisposers.delete(binding.sessionId)
          const releasedClaim = this.#commandStates.delete(binding.sessionId)
          if (releasedClaim && binding.sessionId === this.#desiredSessionId && !this.#disposed) {
            this.#publishInput(releaseClaim(this.#input))
          }
          if (binding.sessionId === this.#desiredSessionId) this.#emitInputTrigger()
        }
      }
    }, 'dsh-work.input: official reference bridge')
    this.#scopeDisposers.set(binding.sessionId, disposer)
  }

  #reconcileSession() {
    if (this.#disposed || this.#desiredSessionId === undefined) return
    const list = this.#sessions.list.getSnapshot()
    if (this.#desiredSessionId === null) {
      if (list.current !== undefined) this.#sessions.clear()
      return
    }
    if (list.current === this.#desiredSessionId) return
    if (list.byId[this.#desiredSessionId]) this.#sessions.open(this.#desiredSessionId)
  }

  #storeFor(sessionId: SessionId) {
    let store = this.#stores.get(sessionId)
    if (!store) {
      store = new BridgeInputStore({
        ...EMPTY_INPUT,
        ...(sessionId === this.#desiredSessionId ? this.#input : {})
      })
      this.#stores.set(sessionId, store)
    }
    return store
  }

  #actionsFor(sessionId: SessionId) {
    let actions = this.#actions.get(sessionId)
    if (!actions) {
      actions = {
        setDraft: (draft) => {
          if (this.#desiredSessionId !== sessionId) return
          if (this.#input.draft === draft) return
          this.#replaceDraft(draft, true)
        },
        addImages: () => false,
        removeImage: () => {},
        pruneImages: () => {},
        submit: () => {
          if (this.#desiredSessionId === sessionId) this.#handlers?.submit()
        }
      }
      this.#actions.set(sessionId, actions)
    }
    return actions
  }
}
