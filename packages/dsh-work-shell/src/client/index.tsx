import type {
  ChatConversationViewNode,
  ClientContext,
  ToolCallBlock
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  type PropsRenderSlots,
  type PropsRuntime,
  type OwnerOf
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ThemePreference, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import DshWorkApp from '../../../../renderer/src/DshWorkApp'
import {
  DSH_WORK_LAYOUT_EVENT,
  DshClientHostProvider,
  useDshClientHost,
  type DshClientRuntimeBridge,
  type DshWorkLayoutAction
} from '../../../../renderer/src/dsh-client/DshClientHost'
import { DshConversationBridge } from '../../../../renderer/src/dsh-client/DshConversationBridge'
import {
  parseDshProducedPaths,
  withDshProducedPaths,
  type DshProducedPath
} from '../../../../renderer/src/dsh-client/DshTurnTailAdapter'
import { createDshThemePresenter } from '../../../../renderer/src/theme/dshRuntimeTheme'
import { WORKBENCH_SLOT } from '../../../../renderer/src/views/agent/workbenchContributions'
import '../../../../renderer/src/views/agent/workbenchSlotRuntime'
import { DshWorkConversationService } from './ConversationService'
import { DshWorkProductActionsService } from './ProductActionsService'
import { DshWorkProductReferencesService } from './ProductReferencesService'
import { DshWorkProductSearchModeService } from './ProductSearchModeService'
import { DshWorkProductWorkspacesService } from './ProductWorkspacesService'
import { DshWorkProductAttachmentsService } from './ProductAttachmentsService'
import { registerToolConversationLocale } from './ToolConversationLocale'
import styles from './DshWorkSettings.module.css'

const STANDARD_ROOT_SLOTS = [
  'sidebar',
  'conversation',
  'details',
  'settings.section',
  'shell.overlay'
] as const
const PRE_SESSION_ATTACHMENTS_SLOT = 'dsh-work.composer.pre-session' as const
type DshWorkRootSlot = typeof WORKBENCH_SLOT | typeof PRE_SESSION_ATTACHMENTS_SLOT | (typeof STANDARD_ROOT_SLOTS)[number]
type DshWorkRootProps = PropsRuntime<'root'> & PropsRenderSlots<DshWorkRootSlot>
type DshWorkSidebarProps = PropsRuntime<'sidebar'> & PropsRenderSlots<'sidebar.footer.action'>
type DshWorkGeneralProps = PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'>
type DshWorkToolDetailsProps = PropsRuntime<'details'> & PropsRenderSlots<'conversation.details.tool'>
type DshWorkConversationSlot =
  | 'conversation.session.header.actions'
  | 'conversation.session.header.utilities'
  | 'conversation.composer'
  | 'conversation.input.overlay'
  | 'conversation.input.dock'
  | 'conversation.composer.dock'
  | 'conversation.input.left'
  | 'conversation.input.right'
  | 'conversation.input.plan'
  | 'conversation.input.model'
  | 'conversation.hero.workspace'
  | 'conversation.hero.agentPreset'
  | 'conversation.chat.node'
  | 'conversation.chat.assistant-actions'
  | 'conversation.chat.turnTail'
type DshWorkConversationProps = PropsRuntime<'conversation'> & PropsRenderSlots<DshWorkConversationSlot>
type DshAssistantActionOwner = Pick<PropsRuntime<'conversation.chat.assistant-actions'>, 'messageId'>
type DshAssistantActionTarget = DshAssistantActionOwner & { element: Element }
type DshToolCallTarget = { element: Element; callId: string }
type DshTurnTailOwner = OwnerOf<'conversation.chat.turnTail'>
type DshTurnTailTarget = Pick<DshTurnTailOwner, 'seq'> & {
  element: Element
  turnNumber: number
  produced: DshProducedPath[]
}

function dshToolChatNode(block: ToolCallBlock): ChatConversationViewNode {
  const seq = 'kind' in block ? block.seq : 0
  return {
    key: `tool-call:${block.callId}`,
    kind: 'tool-call',
    id: block.callId,
    target: 'chat',
    anchorSeq: seq,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: { root: block }
  }
}

function toolCallName(block: ToolCallBlock) {
  return 'kind' in block ? block.call?.name || block.callId : block.name
}

function toolCallArgs(block: ToolCallBlock) {
  const raw = 'kind' in block ? block.call?.argsRaw : block.argsRaw
  if (raw === undefined) return null
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function rawToolResult(block: ToolCallBlock) {
  if (!('kind' in block)) return ''
  const parts = block.content.map((item) => {
    if (item.type === 'text') return item.text
    return JSON.stringify(item, null, 2) ?? String(item)
  })
  if (parts.length === 0 && block.error) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n')
}

export const inject = ['slots', 'sessions', 'theme', 'locale', 'inputTriggers']

const APP_MAPPED_GENERAL_ITEMS = new Set(['appearance', 'composer-enter', 'language', 'permission'])
const TOOL_DETAILS_COPY = {
  zh: { title: '工具详情', close: '关闭工具详情', input: '输入', output: '输出', running: '工具仍在运行' },
  en: { title: 'Tool details', close: 'Close tool details', input: 'Input', output: 'Output', running: 'Tool is still running' }
} as const

class DshWorkLayoutAdapter implements ILayout {
  #dispatch(action: DshWorkLayoutAction) {
    window.dispatchEvent(new CustomEvent(DSH_WORK_LAYOUT_EVENT, { detail: { action } }))
  }

  toggleSidebar() {
    this.#dispatch('toggle-sidebar')
  }

  openDetails() {
    this.#dispatch('open-details')
  }

  closeDetails() {
    this.#dispatch('close-details')
  }
}

/** Register the dsh-work product shell into the shared DSH root Slot. */
export function apply(ctx: ClientContext) {
  const layout = new DshWorkLayoutAdapter()
  const conversation = new DshConversationBridge(ctx.sessions, ctx.inputTriggers)
  const runtime: DshClientRuntimeBridge = {
    conversation,
    locale: {
      getSnapshot: () => ctx.locale.getLocale(),
      subscribe: (listener) => ctx.locale.subscribe(listener),
      setLocale: (id) => ctx.locale.setLocale(id)
    },
    theme: {
      getSnapshot: () => ctx.theme.getTheme(),
      subscribe: (listener) => ctx.on('theme/change', () => listener()),
      setTheme: (preference: ThemePreference) => ctx.theme.setTheme(preference)
    }
  }

  function DshWorkRoot({ renderSlot }: DshWorkRootProps) {
    return (
      <DshClientHostProvider slots={ctx.slots} renderSlot={renderSlot} runtime={runtime}>
        <DshWorkApp />
        <DshWorkPreSessionAttachments renderSlot={renderSlot} />
        {renderSlot('sidebar', { collapsed: false, width: 263 }, { only: 'dsh-work-sidebar' })}
        {renderSlot('conversation', {}, { only: 'dsh-work-conversation' })}
        <DshWorkDetails renderSlot={renderSlot} />
      </DshClientHostProvider>
    )
  }

  function DshWorkPreSessionAttachments({ renderSlot }: Pick<DshWorkRootProps, 'renderSlot'>) {
    const [target, setTarget] = useState<Element | null>(null)
    useLayoutEffect(() => {
      const syncTarget = () => setTarget(document.querySelector('[data-dsh-work-pre-session-attachments]'))
      syncTarget()
      const observer = new MutationObserver(syncTarget)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])
    return target
      ? createPortal(renderSlot(PRE_SESSION_ATTACHMENTS_SLOT, {}), target)
      : null
  }

  function DshWorkDetails({ renderSlot }: Pick<DshWorkRootProps, 'renderSlot'>) {
    const [target, setTarget] = useState<Element | null>(null)
    useLayoutEffect(() => {
      const syncTarget = () => setTarget(document.querySelector('[data-dsh-standard-details]'))
      syncTarget()
      const observer = new MutationObserver(syncTarget)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])
    if (!target) return null
    return createPortal(
      <div data-dsh-standard-details-content>
        {renderSlot('details', {})}
      </div>,
      target
    )
  }

  function DshWorkSidebar({ renderSlot }: DshWorkSidebarProps) {
    const [target, setTarget] = useState<Element | null>(null)
    useLayoutEffect(() => {
      const syncTarget = () => setTarget(document.querySelector('[data-dsh-sidebar-footer-actions]'))
      syncTarget()
      const observer = new MutationObserver(syncTarget)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])
    if (!target) return null
    return createPortal(renderSlot('sidebar.footer.action', { wide: true }), target)
  }

  function DshWorkGeneralSettings({ renderSlot }: DshWorkGeneralProps) {
    const version = useSyncExternalStore(
      (listener) => ctx.slots.subscribe('settings.general.item', listener),
      () => ctx.slots.getVersion('settings.general.item'),
      () => 0
    )
    const ids = useMemo(() => {
      const seen = new Set<string>()
      return ctx.slots.entriesOfSlot('settings.general.item').flatMap((entry) => {
        const id = String(entry.options.id || '').trim()
        if (!id || seen.has(id) || APP_MAPPED_GENERAL_ITEMS.has(id)) return []
        seen.add(id)
        return [id]
      })
    }, [version])
    if (!ids.length) return null
    return (
      <section className={styles.generalRows} data-dsh-work-general-plugin-settings>
        {ids.map((id) => <div key={id}>{renderSlot('settings.general.item', {}, { only: id })}</div>)}
      </section>
    )
  }

  function DshWorkToolDetails({ sessionId, renderSlot }: DshWorkToolDetailsProps) {
    const hadSelection = useRef(false)
    const locale = useSyncExternalStore(
      (listener) => ctx.locale.subscribe(listener),
      () => ctx.locale.getSnapshot(),
      () => ctx.locale.getSnapshot()
    )
    const copy = locale.active === 'zh' ? TOOL_DETAILS_COPY.zh : TOOL_DETAILS_COPY.en
    const selection = useSyncExternalStore(
      conversation.subscribeToolSelection,
      conversation.getToolSelectionSnapshot,
      conversation.getToolSelectionSnapshot
    )
    const toolCalls = useSyncExternalStore(
      conversation.subscribeToolCalls,
      conversation.getToolCallSnapshot,
      conversation.getToolCallSnapshot
    )
    const sessions = useSyncExternalStore(
      (listener) => ctx.sessions.list.subscribe(listener),
      () => ctx.sessions.list.getSnapshot(),
      () => ctx.sessions.list.getSnapshot()
    )
    const block = selection ? toolCalls.get(selection.callId) : undefined
    const selected = selection !== undefined
    const close = () => {
      conversation.clearToolSelection(selection?.sessionId ?? sessionId)
      layout.closeDetails()
    }
    useLayoutEffect(() => {
      if (selected) {
        hadSelection.current = true
        return
      }
      if (hadSelection.current) {
        hadSelection.current = false
        layout.closeDetails()
      }
    }, [selected])
    if (!block) return null
    const args = toolCallArgs(block)
    const cwd = sessions.byId[selection.sessionId]?.cwd
    return (
      <aside className={styles.toolDetails} data-dsh-standard-tool-details data-call-id={block.callId}>
        <header className={styles.toolDetailsHeader}>
          <strong className={styles.toolDetailsTitle}>{toolCallName(block) || copy.title}</strong>
          <button
            type="button"
            className={styles.toolDetailsClose}
            aria-label={copy.close}
            data-dsh-standard-tool-details-close
            onClick={close}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className={styles.toolDetailsBody}>
          {args !== null && (
            <section className={styles.toolDetailsSection}>
              <div className={styles.toolDetailsLabel}>{copy.input}</div>
              <pre className={styles.toolDetailsCode}>{args}</pre>
            </section>
          )}
          <section className={styles.toolDetailsSection}>
            <div className={styles.toolDetailsLabel}>{copy.output}</div>
            <div data-dsh-standard-tool-details-output>
              {renderSlot('conversation.details.tool', { block, cwd }, {
                fallback: 'kind' in block
                  ? (
                    <pre
                      className={styles.toolDetailsCode}
                      data-dsh-product-tool-details-fallback
                      data-error={block.isError || undefined}
                    >
                      {rawToolResult(block)}
                    </pre>
                  )
                  : <div className={styles.toolDetailsEmpty} data-dsh-product-tool-details-fallback>{copy.running}</div>
              })}
            </div>
          </section>
        </div>
      </aside>
    )
  }

  function DshWorkConversation({ sessionId, useSession, renderSlot, renderSlotChain }: DshWorkConversationProps) {
    const host = useDshClientHost()
    const session = useSession((snapshot) => snapshot)
    const input = useSyncExternalStore(
      conversation.subscribeInput,
      conversation.getInputSnapshot,
      conversation.getInputSnapshot
    )
    const toolCalls = useSyncExternalStore(
      conversation.subscribeToolCalls,
      conversation.getToolCallSnapshot,
      conversation.getToolCallSnapshot
    )
    const [targets, setTargets] = useState<Record<DshWorkConversationSlot, Element | null>>({
      'conversation.session.header.actions': null,
      'conversation.session.header.utilities': null,
      'conversation.composer': null,
      'conversation.input.overlay': null,
      'conversation.input.dock': null,
      'conversation.composer.dock': null,
      'conversation.input.left': null,
      'conversation.input.right': null,
      'conversation.input.plan': null,
      'conversation.input.model': null,
      'conversation.hero.workspace': null,
      'conversation.hero.agentPreset': null,
      'conversation.chat.node': null,
      'conversation.chat.assistant-actions': null,
      'conversation.chat.turnTail': null
    })
    const [assistantActionTargets, setAssistantActionTargets] = useState<DshAssistantActionTarget[]>([])
    const [toolCallTargets, setToolCallTargets] = useState<DshToolCallTarget[]>([])
    const [turnTailTargets, setTurnTailTargets] = useState<DshTurnTailTarget[]>([])
    useLayoutEffect(() => {
      const selectors: Record<Exclude<DshWorkConversationSlot, 'conversation.chat.node' | 'conversation.chat.assistant-actions' | 'conversation.chat.turnTail'>, string> = {
        'conversation.session.header.actions': '[data-dsh-session-header-actions]',
        'conversation.session.header.utilities': '[data-dsh-session-header-utilities]',
        'conversation.composer': '[data-dsh-conversation-composer-takeover]',
        'conversation.input.overlay': '[data-dsh-conversation-input-overlay]',
        'conversation.input.dock': '[data-dsh-conversation-input-dock]',
        'conversation.composer.dock': '[data-dsh-conversation-composer-dock]',
        'conversation.input.left': '[data-dsh-conversation-input-left]',
        'conversation.input.right': '[data-dsh-conversation-input-right]',
        'conversation.input.plan': '[data-dsh-conversation-input-plan]',
        'conversation.input.model': '[data-dsh-conversation-input-model]',
        'conversation.hero.workspace': '[data-dsh-conversation-hero-workspace]',
        'conversation.hero.agentPreset': '[data-dsh-conversation-hero-agent-preset]'
      }
      const syncTarget = () => setTargets((current) => {
        const next = Object.fromEntries(Object.entries(selectors).map(([slot, selector]) => (
          [slot, document.querySelector(selector)]
        ))) as Record<Exclude<DshWorkConversationSlot, 'conversation.chat.node' | 'conversation.chat.assistant-actions' | 'conversation.chat.turnTail'>, Element | null>
        return Object.keys(selectors).every((slot) => (
          current[slot as DshWorkConversationSlot] === next[slot as DshWorkConversationSlot]
        )) ? current : { ...current, ...next }
      })
      syncTarget()
      const observer = new MutationObserver(syncTarget)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])
    useLayoutEffect(() => {
      const syncTargets = () => setToolCallTargets((current) => {
        const next = Array.from(document.querySelectorAll('[data-dsh-tool-call-takeover]')).flatMap((element) => {
          const callId = String(element.getAttribute('data-dsh-tool-call-takeover') || '').trim()
          return callId ? [{ element, callId }] : []
        })
        return next.length === current.length && next.every((target, index) => (
          target.element === current[index]?.element && target.callId === current[index]?.callId
        )) ? current : next
      })
      syncTargets()
      const observer = new MutationObserver(syncTargets)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])
    useLayoutEffect(() => {
      const syncTargets = () => setAssistantActionTargets((current) => {
        const next = Array.from(document.querySelectorAll('[data-dsh-assistant-actions]')).flatMap((element) => {
          const messageId = String(element.getAttribute('data-dsh-assistant-message-id') || '').trim()
          return messageId ? [{ element, messageId: messageId as DshAssistantActionOwner['messageId'] }] : []
        })
        return next.length === current.length && next.every((target, index) => (
          target.element === current[index]?.element && target.messageId === current[index]?.messageId
        )) ? current : next
      })
      syncTargets()
      const observer = new MutationObserver(syncTargets)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])
    useLayoutEffect(() => {
      const syncTargets = () => setTurnTailTargets((current) => {
        const next = Array.from(document.querySelectorAll('[data-dsh-turn-tail]')).flatMap((element) => {
          const turnNumber = Number(element.getAttribute('data-dsh-turn'))
          const seq = Number(element.getAttribute('data-dsh-closing-seq'))
          const produced = parseDshProducedPaths(element.getAttribute('data-dsh-produced-paths'))
          return Number.isInteger(turnNumber) && Number.isInteger(seq)
            ? [{ element, turnNumber, seq, produced }]
            : []
        })
        return next.length === current.length && next.every((target, index) => (
          target.element === current[index]?.element
          && target.turnNumber === current[index]?.turnNumber
          && target.seq === current[index]?.seq
          && JSON.stringify(target.produced) === JSON.stringify(current[index]?.produced)
        )) ? current : next
      })
      syncTargets()
      const observer = new MutationObserver(syncTargets)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])
    useLayoutEffect(() => {
      if (session) conversation.updateQueue(session.queue)
    }, [session?.queue])
    const heroWorkspace = targets['conversation.hero.workspace'] && createPortal(
      renderSlot('conversation.hero.workspace', {}),
      targets['conversation.hero.workspace']
    )
    const heroAgentPreset = targets['conversation.hero.agentPreset'] && createPortal(
      renderSlot('conversation.hero.agentPreset', {}),
      targets['conversation.hero.agentPreset']
    )
    const hero = <>{heroWorkspace}{heroAgentPreset}</>
    if (!host || !sessionId || !session) return hero
    if (host.conversation.getSessionId() !== sessionId) return hero
    const inputZone = { session, input }
    return (
      <>
        {hero}
        {targets['conversation.session.header.actions'] && createPortal(
          renderSlot('conversation.session.header.actions', {}),
          targets['conversation.session.header.actions']
        )}
        {targets['conversation.session.header.utilities'] && createPortal(
          renderSlot('conversation.session.header.utilities', {}),
          targets['conversation.session.header.utilities']
        )}
        {targets['conversation.composer'] && createPortal(
          <div data-dsh-standard-conversation-composer-chain>
            {renderSlotChain(
              'conversation.composer',
              { interactions: session.pending, session },
              { fallback: <span data-dsh-product-composer-resident /> }
            )}
          </div>,
          targets['conversation.composer']
        )}
        {targets['conversation.input.overlay'] && createPortal(
          renderSlot('conversation.input.overlay', {}),
          targets['conversation.input.overlay']
        )}
        {targets['conversation.input.dock'] && createPortal(
          renderSlot('conversation.input.dock', inputZone),
          targets['conversation.input.dock']
        )}
        {targets['conversation.composer.dock'] && createPortal(
          <div data-dsh-standard-conversation-composer-dock>
            {renderSlot('conversation.composer.dock', inputZone)}
          </div>,
          targets['conversation.composer.dock']
        )}
        {targets['conversation.input.left'] && createPortal(
          renderSlot('conversation.input.left', inputZone),
          targets['conversation.input.left']
        )}
        {targets['conversation.input.right'] && createPortal(
          renderSlot('conversation.input.right', inputZone),
          targets['conversation.input.right']
        )}
        {targets['conversation.input.plan'] && createPortal(
          renderSlot('conversation.input.plan', { locked: session.removed }),
          targets['conversation.input.plan']
        )}
        {targets['conversation.input.model'] && createPortal(
          renderSlot('conversation.input.model', { locked: session.removed }),
          targets['conversation.input.model']
        )}
        {toolCallTargets.map(({ element, callId }) => {
          const block = toolCalls.get(callId)
          if (!block) return null
          const node = dshToolChatNode(block)
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          return createPortal(
            <div data-dsh-standard-tool-call-node>
              {renderSlot('conversation.chat.node', {
                node,
                cwd,
                openFile: conversation.openFile,
                inspectCall: (callId) => {
                  if (conversation.selectToolCall(sessionId, callId)) layout.openDetails()
                },
                forkAt: () => {},
                loadImage: () => Promise.reject(new Error('工具行不提供消息图片读取')),
                fileMentions: () => undefined
              }, {
                entryKey: 'tool-call',
                fallback: <span data-dsh-product-tool-call-resident />
              })}
            </div>,
            element,
            callId
          )
        })}
        {assistantActionTargets.map(({ element, messageId }) => createPortal(
          renderSlot('conversation.chat.assistant-actions', { messageId }),
          element,
          String(messageId)
        ))}
        {turnTailTargets.map(({ element, turnNumber, seq, produced }) => {
          const turn = withDshProducedPaths(
            turnNumber,
            produced,
            session.chat.timeline.turns.get(turnNumber)
          )
          return createPortal(
            <div data-dsh-standard-turn-tail-owner style={{ display: 'contents' }}>
              {renderSlotChain('conversation.chat.turnTail', { turn, seq, openFile: conversation.openFile })}
            </div>,
            element,
            `${turnNumber}:${seq}`
          )
        })}
      </>
    )
  }

  ctx.effect(() => conversation.dispose, 'dsh-work conversation bridge')
  ctx.effect(
    () => registerToolConversationLocale(ctx.locale),
    'dsh-work shell Tool conversation dictionaries'
  )
  ctx.effect(() => ctx.reflect.provide('layout', layout), 'dsh-work shell layout adapter')

  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(ctx.slots.register({
        name: 'root',
        priority: -100,
        children: {
          [WORKBENCH_SLOT]: { kind: 'list', scope: 'root' },
          [PRE_SESSION_ATTACHMENTS_SLOT]: { kind: 'list', scope: 'root' },
          'sidebar': { kind: 'single', scope: 'root' },
          'conversation': { kind: 'single', scope: 'session-maybe' },
          'details': { kind: 'single', scope: 'session' },
          'settings.section': { kind: 'list', scope: 'root' },
          'shell.overlay': { kind: 'list', scope: 'root' }
        }
      }, DshWorkRoot))
      disposers.push(ctx.slots.register({
        name: 'sidebar',
        id: 'dsh-work-sidebar',
        priority: 100,
        children: {
          'sidebar.workspaces': { kind: 'single', scope: 'root' },
          'sidebar.settings': { kind: 'single', scope: 'root' },
          'sidebar.footer.action': { kind: 'list', scope: 'root' }
        }
      }, DshWorkSidebar))
      disposers.push(ctx.slots.register({
        name: 'conversation',
        id: 'dsh-work-conversation',
        priority: -100,
        children: {
          'conversation.session.header.actions': { kind: 'list', scope: 'session' },
          'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
          'conversation.composer': { kind: 'chain', scope: 'session' },
          'conversation.input.overlay': { kind: 'list', scope: 'session' },
          'conversation.input.dock': { kind: 'list', scope: 'session' },
          'conversation.composer.dock': { kind: 'list', scope: 'session' },
          'conversation.input.left': { kind: 'list', scope: 'session' },
          'conversation.input.right': { kind: 'list', scope: 'session' },
          'conversation.input.plan': { kind: 'single', scope: 'session' },
          'conversation.input.model': { kind: 'single', scope: 'session' },
          'conversation.hero.workspace': { kind: 'single', scope: 'root' },
          'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
          'conversation.chat.node': { kind: 'keyed', scope: 'session' },
          'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
          'conversation.chat.turnTail': { kind: 'chain', scope: 'session' }
        }
      }, DshWorkConversation))
      disposers.push(ctx.slots.register({
        name: 'details',
        id: 'dsh-work-tool-details',
        priority: -100,
        children: {
          'conversation.details.tool': { kind: 'single', scope: 'session' }
        }
      }, DshWorkToolDetails))
      disposers.push(ctx.slots.register({
        name: 'settings.section',
        id: 'general',
        order: 0,
        priority: -100,
        label: '常规',
        children: { 'settings.general.item': { kind: 'list', scope: 'root' } }
      }, DshWorkGeneralSettings))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'dsh-work shell slot tree')

  new DshWorkConversationService(ctx, {
    input: conversation.input,
    blocks: conversation.blocks,
    sessions: ctx.sessions
  })
  new DshWorkProductActionsService(ctx, conversation)
  new DshWorkProductReferencesService(ctx, conversation)
  new DshWorkProductSearchModeService(ctx, conversation)
  new DshWorkProductWorkspacesService(ctx, conversation)
  new DshWorkProductAttachmentsService(ctx, conversation)

  ctx.effect(() => {
    const presenter = createDshThemePresenter(document)
    const themeColorMeta = document.createElement('meta')
    themeColorMeta.name = 'theme-color'
    const present = (snapshot: ThemeSnapshot) => {
      presenter.present(snapshot)
      themeColorMeta.content = getComputedStyle(document.body).backgroundColor
      if (!themeColorMeta.isConnected) document.head.append(themeColorMeta)
    }
    present(ctx.theme.getTheme())
    const off = ctx.on('theme/change', present)
    return () => {
      off()
      presenter.dispose()
      themeColorMeta.remove()
    }
  }, 'dsh-work shell theme presenter')
}
