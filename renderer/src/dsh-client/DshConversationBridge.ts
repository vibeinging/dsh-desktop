import type { ClientContext, SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

type ComposerDockOwner = OwnerOf<'conversation.composer.dock'>
export type DshWorkComposerInputSnapshot = ComposerDockOwner['input']
type DshSessions = Pick<ClientContext['sessions'], 'list' | 'open' | 'clear' | 'provide'>

export interface DshWorkInputHandlers {
  setDraft: (draft: string) => void
  submit: () => void
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
  readonly #stores = new Map<SessionId, SnapshotStore<DshWorkComposerInputSnapshot>>()
  readonly #actions = new Map<SessionId, DshWorkInputActions>()
  #desiredSessionId: SessionId | null | undefined
  #input = EMPTY_INPUT
  #handlers: DshWorkInputHandlers | null = null
  #disposed = false

  constructor(sessions: DshSessions) {
    this.#sessions = sessions
    this.#unsubscribeSessions = sessions.list.subscribe(() => this.#reconcileSession())
    this.#disposeProvider = sessions.provide({
      hooks: ['input'],
      props: ['inputActions'],
      resolve: (binding) => ({
        hooks: { input: this.#storeFor(binding.sessionId) },
        props: { inputActions: this.#actionsFor(binding.sessionId) }
      })
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
    this.#desiredSessionId = next
    this.#input = { ...EMPTY_INPUT, draftRev: this.#input.draftRev + 1 }
    if (next) this.#storeFor(next).set(this.#input)
    this.#emit()
    this.#reconcileSession()
  }

  /** Publish the App composer's current draft into the read-only Slot owner share. */
  updateDraft(draft: string) {
    if (this.#disposed || this.#input.draft === draft) return
    this.#input = {
      ...this.#input,
      draft,
      draftRev: this.#input.draftRev + 1
    }
    this.#emit()
    if (this.#desiredSessionId) this.#storeFor(this.#desiredSessionId).set(this.#input)
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

  /** Release the list listener and all product subscribers. */
  dispose = () => {
    if (this.#disposed) return
    this.#disposed = true
    this.#disposeProvider()
    this.#unsubscribeSessions()
    this.#listeners.clear()
    this.#stores.clear()
    this.#actions.clear()
  }

  #emit() {
    for (const listener of this.#listeners) listener()
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
          this.#handlers?.setDraft(draft)
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
