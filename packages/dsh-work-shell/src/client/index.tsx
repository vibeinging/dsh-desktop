import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  type PropsRenderSlots,
  type PropsRuntime,
  type OwnerOf
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ThemePreference, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
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
import styles from './DshWorkSettings.module.css'

const STANDARD_ROOT_SLOTS = [
  'sidebar',
  'conversation',
  'details',
  'settings.section',
  'shell.overlay'
] as const
type DshWorkRootSlot = typeof WORKBENCH_SLOT | (typeof STANDARD_ROOT_SLOTS)[number]
type DshWorkRootProps = PropsRuntime<'root'> & PropsRenderSlots<DshWorkRootSlot>
type DshWorkSidebarProps = PropsRuntime<'sidebar'> & PropsRenderSlots<'sidebar.footer.action'>
type DshWorkGeneralProps = PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'>
type DshWorkConversationSlot =
  | 'conversation.session.header.actions'
  | 'conversation.session.header.utilities'
  | 'conversation.input.overlay'
  | 'conversation.input.dock'
  | 'conversation.composer.dock'
  | 'conversation.input.left'
  | 'conversation.input.right'
  | 'conversation.chat.assistant-actions'
  | 'conversation.chat.turnTail'
type DshWorkConversationProps = PropsRuntime<'conversation'> & PropsRenderSlots<DshWorkConversationSlot>
type DshAssistantActionOwner = Pick<PropsRuntime<'conversation.chat.assistant-actions'>, 'messageId'>
type DshAssistantActionTarget = DshAssistantActionOwner & { element: Element }
type DshTurnTailOwner = OwnerOf<'conversation.chat.turnTail'>
type DshTurnTailTarget = Pick<DshTurnTailOwner, 'seq'> & {
  element: Element
  turnNumber: number
  produced: DshProducedPath[]
}

export const inject = ['slots', 'sessions', 'theme', 'locale', 'inputTriggers']

const APP_MAPPED_GENERAL_ITEMS = new Set(['appearance', 'composer-enter', 'language', 'permission'])

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
  const conversation = new DshConversationBridge(ctx.sessions)
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
        {renderSlot('sidebar', { collapsed: false, width: 263 }, { only: 'dsh-work-sidebar' })}
        {renderSlot('conversation', {}, { only: 'dsh-work-conversation' })}
        <DshWorkDetails renderSlot={renderSlot} />
      </DshClientHostProvider>
    )
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

  function DshWorkConversation({ sessionId, useSession, renderSlot, renderSlotChain }: DshWorkConversationProps) {
    const host = useDshClientHost()
    const session = useSession((snapshot) => snapshot)
    const input = useSyncExternalStore(
      conversation.subscribeInput,
      conversation.getInputSnapshot,
      conversation.getInputSnapshot
    )
    const [targets, setTargets] = useState<Record<DshWorkConversationSlot, Element | null>>({
      'conversation.session.header.actions': null,
      'conversation.session.header.utilities': null,
      'conversation.input.overlay': null,
      'conversation.input.dock': null,
      'conversation.composer.dock': null,
      'conversation.input.left': null,
      'conversation.input.right': null,
      'conversation.chat.assistant-actions': null,
      'conversation.chat.turnTail': null
    })
    const [assistantActionTargets, setAssistantActionTargets] = useState<DshAssistantActionTarget[]>([])
    const [turnTailTargets, setTurnTailTargets] = useState<DshTurnTailTarget[]>([])
    useLayoutEffect(() => {
      const selectors: Record<Exclude<DshWorkConversationSlot, 'conversation.chat.assistant-actions' | 'conversation.chat.turnTail'>, string> = {
        'conversation.session.header.actions': '[data-dsh-session-header-actions]',
        'conversation.session.header.utilities': '[data-dsh-session-header-utilities]',
        'conversation.input.overlay': '[data-dsh-conversation-input-overlay]',
        'conversation.input.dock': '[data-dsh-conversation-input-dock]',
        'conversation.composer.dock': '[data-dsh-conversation-composer-dock]',
        'conversation.input.left': '[data-dsh-conversation-input-left]',
        'conversation.input.right': '[data-dsh-conversation-input-right]'
      }
      const syncTarget = () => setTargets((current) => {
        const next = Object.fromEntries(Object.entries(selectors).map(([slot, selector]) => (
          [slot, document.querySelector(selector)]
        ))) as Record<Exclude<DshWorkConversationSlot, 'conversation.chat.assistant-actions' | 'conversation.chat.turnTail'>, Element | null>
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
    if (!host || !sessionId || !session) return null
    if (host.conversation.getSessionId() !== sessionId) return null
    const inputZone = { session, input }
    return (
      <>
        {targets['conversation.session.header.actions'] && createPortal(
          renderSlot('conversation.session.header.actions', {}),
          targets['conversation.session.header.actions']
        )}
        {targets['conversation.session.header.utilities'] && createPortal(
          renderSlot('conversation.session.header.utilities', {}),
          targets['conversation.session.header.utilities']
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
  ctx.effect(() => ctx.reflect.provide('layout', layout), 'dsh-work shell layout adapter')

  ctx.effect(() => ctx.slots.register({
    name: 'root',
    priority: -100,
    children: {
      [WORKBENCH_SLOT]: { kind: 'list', scope: 'root' },
      'sidebar': { kind: 'single', scope: 'root' },
      'conversation': { kind: 'single', scope: 'session-maybe' },
      'details': { kind: 'single', scope: 'session' },
      'settings.section': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' }
    }
  }, DshWorkRoot), 'dsh-work shell root registration')

  ctx.effect(() => ctx.slots.register({
    name: 'sidebar',
    id: 'dsh-work-sidebar',
    priority: 100,
    children: {
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' }
    }
  }, DshWorkSidebar), 'dsh-work sidebar adapter')

  ctx.effect(() => ctx.slots.register({
    name: 'conversation',
    id: 'dsh-work-conversation',
    priority: -100,
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
      'conversation.chat.turnTail': { kind: 'chain', scope: 'session' }
    }
  }, DshWorkConversation), 'dsh-work conversation adapter')

  ctx.effect(() => ctx.slots.register({
    name: 'settings.section',
    id: 'general',
    order: 0,
    priority: -100,
    label: '常规',
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } }
  }, DshWorkGeneralSettings), 'dsh-work general settings section')

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
