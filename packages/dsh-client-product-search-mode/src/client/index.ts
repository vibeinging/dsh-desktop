import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import * as React from 'react'

type ProductSearchMode = 'auto' | 'required' | 'off'

interface ProductSearchModeService {
  getSnapshot(sessionId: SessionId): ProductSearchMode
  subscribe(sessionId: SessionId, listener: () => void): () => void
  cycle(sessionId: SessionId): boolean
}

interface ProductSearchModeOwner {
  readonly session: Pick<ConversationSnapshot, 'sessionId' | 'running'>
  readonly input: { readonly phase: string }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductSearchMode: ProductSearchModeService
  }
}

export const inject = ['slots', 'locale', 'dshWorkProductSearchMode']

const COPY = {
  zh: {
    auto: { label: '联网自动', title: '联网：自动判断。点击改为本轮必须联网' },
    required: { label: '联网', title: '联网：本轮必须搜索并引用来源。点击关闭' },
    off: { label: '不联网', title: '联网：已关闭。点击恢复自动判断' }
  },
  en: {
    auto: { label: 'Web auto', title: 'Web access is automatic. Click to require it for this turn.' },
    required: { label: 'Web on', title: 'Web search and citations are required. Click to turn it off.' },
    off: { label: 'Web off', title: 'Web access is off. Click to restore automatic mode.' }
  }
} as const

const BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 26,
  padding: '0 8px',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
  background: 'transparent',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8
}

function GlobeIcon() {
  return React.createElement(
    'svg',
    { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', 'aria-hidden': true },
    React.createElement('circle', { cx: 8, cy: 8, r: 5.5, stroke: 'currentColor', strokeWidth: 1.4 }),
    React.createElement('path', { d: 'M2.8 8h10.4M8 2.5c1.6 1.5 2.4 3.3 2.4 5.5S9.6 12 8 13.5C6.4 12 5.6 10.2 5.6 8S6.4 4 8 2.5Z', stroke: 'currentColor', strokeWidth: 1.2 })
  )
}

function ProductSearchModeControl({ ctx, owner }: { ctx: ClientContext & Context; owner: ProductSearchModeOwner }) {
  const sessionId = owner.session.sessionId
  const mode = React.useSyncExternalStore(
    (listener: () => void) => ctx.dshWorkProductSearchMode.subscribe(sessionId, listener),
    () => ctx.dshWorkProductSearchMode.getSnapshot(sessionId),
    () => 'auto' as const
  )
  const locale = React.useSyncExternalStore(
    (listener: () => void) => ctx.locale.subscribe(listener),
    () => ctx.locale.getLocale().active,
    () => 'en'
  )
  const copy = COPY[locale === 'zh' ? 'zh' : 'en'][mode]
  const disabled = owner.session.running || !['plain', 'claimed'].includes(owner.input.phase)
  return React.createElement(
    'button',
    {
      type: 'button',
      disabled,
      title: copy.title,
      'data-dsh-product-search-mode': true,
      'data-search-mode': mode,
      style: { ...BUTTON_STYLE, ...(disabled ? { cursor: 'default', opacity: 0.55 } : {}) },
      onClick: () => ctx.dshWorkProductSearchMode.cycle(sessionId)
    },
    React.createElement(GlobeIcon),
    React.createElement('span', null, copy.label)
  )
}

/** Register the App web policy control in the standard composer tool row. */
export function apply(ctx: ClientContext & Context) {
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    {
      name: 'conversation.input.left',
      id: 'dsh-work-search-mode',
      order: 40,
      label: 'Web search mode'
    },
    (owner: ProductSearchModeOwner) => React.createElement(ProductSearchModeControl, { ctx, owner })
  ))
}
