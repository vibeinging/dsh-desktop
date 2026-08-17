import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { AttachmentRail, type AttachmentRailItem } from '@deepseek-ai/dsh-client-ui-attachment'
import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import * as React from 'react'
import { createPortal } from 'react-dom'

type AttachmentKind = 'image' | 'video' | 'audio' | 'pdf' | 'file' | 'folder'

interface ProductAttachmentItem {
  readonly id: string
  readonly name: string
  readonly kind: AttachmentKind
  readonly previewUrl?: string
  readonly selectionLabel?: string
}

interface ProductAttachmentSnapshot {
  readonly items: readonly ProductAttachmentItem[]
  readonly hasImages: boolean
}

interface ProductAttachmentsService {
  getSnapshot(sessionId: SessionId | null): ProductAttachmentSnapshot
  subscribe(sessionId: SessionId | null, listener: () => void): () => void
  remove(sessionId: SessionId | null, id: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductAttachments: ProductAttachmentsService
  }
}

export const inject = ['slots', 'locale', 'dshWorkProductAttachments']

const COPY = {
  zh: {
    group: '待发送图片',
    open: '预览原图',
    scrollLeft: '向左查看更多图片',
    scrollRight: '向右查看更多图片',
    remove: '移除附件',
    dialog: '图片预览',
    close: '关闭图片预览',
    hint: '图片将通过 DSH 发送；如果当前模型不支持，DSH 会拒绝本次发送'
  },
  en: {
    group: 'Images ready to send',
    open: 'Preview original image',
    scrollLeft: 'Show earlier images',
    scrollRight: 'Show later images',
    remove: 'Remove attachment',
    dialog: 'Image preview',
    close: 'Close image preview',
    hint: 'Images are sent through DSH. DSH rejects the request if the selected model does not support images.'
  }
} as const

const PLUGIN_CSS = `
[data-dsh-product-attachments] { display: grid; gap: 6px; width: min(860px, 100%); margin: 0 auto 6px; }
[data-dsh-product-attachment-images] > div { position: relative; }
[data-dsh-product-attachment-images] > div > div[role='group'] { display: flex; gap: 8px; overflow-x: auto; padding: 2px; scrollbar-width: none; }
[data-dsh-product-attachment-images] > div > div[role='group']::-webkit-scrollbar { display: none; }
[data-dsh-product-attachment-images] > div > div[role='group'] > div { position: relative; flex: none; width: 64px; height: 64px; }
[data-dsh-product-attachment-images] > div > div[role='group'] > div > button:first-child { display: block; width: 64px; height: 64px; padding: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-fill-l1); cursor: zoom-in; }
[data-dsh-product-attachment-images] > div > div[role='group'] > div > button:first-child img { display: block; width: 100%; height: 100%; object-fit: cover; }
[data-dsh-product-attachment-images] > div > div[role='group'] > div > button:last-child { position: absolute; top: 3px; right: 3px; display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; color: white; background: color-mix(in srgb, black 68%, transparent); cursor: pointer; opacity: 0; }
[data-dsh-product-attachment-images] > div > div[role='group'] > div:hover > button:last-child,
[data-dsh-product-attachment-images] > div > div[role='group'] > div > button:last-child:focus-visible { opacity: 1; }
@media (pointer: coarse) { [data-dsh-product-attachment-images] > div > div[role='group'] > div > button:last-child { opacity: 1; } }
[data-dsh-product-attachment-images] > div > button { position: absolute; top: 23px; z-index: 2; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 50%; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-l1); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.14); cursor: pointer; }
[data-dsh-product-attachment-images] > div > button:has(+ div[role='group']) { left: -9px; }
[data-dsh-product-attachment-images] > div > div[role='group'] + button { right: -9px; }
[data-dsh-product-attachment-files] { display: flex; flex-wrap: wrap; gap: 6px; }
[data-dsh-product-attachment-file] { display: inline-flex; align-items: center; gap: 6px; max-width: 260px; min-height: 32px; padding: 4px 6px 4px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-fill-l1); font-size: 12px; }
[data-dsh-product-attachment-file] > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-dsh-product-attachment-file] > small { flex: none; padding: 1px 5px; border-radius: 999px; color: var(--dsw-alias-primary); background: color-mix(in srgb, var(--dsw-alias-primary) 10%, transparent); }
[data-dsh-product-attachment-file] > button { display: grid; flex: none; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px; color: inherit; background: transparent; cursor: pointer; }
[data-dsh-product-attachment-hint] { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.4; }
[data-dsh-product-attachment-lightbox] { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 48px; background: color-mix(in srgb, black 76%, transparent); backdrop-filter: blur(8px); }
[data-dsh-product-attachment-lightbox] > img { display: block; max-width: min(92vw, 1400px); max-height: 88vh; object-fit: contain; border-radius: 8px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42); }
[data-dsh-product-attachment-lightbox] > button { position: absolute; top: 22px; right: 22px; width: 34px; height: 34px; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 50%; color: white; background: rgba(0, 0, 0, 0.3); font-size: 22px; line-height: 1; cursor: pointer; }
`

function Icon({ kind }: { kind: AttachmentKind }) {
  const path = kind === 'folder'
    ? 'M2.5 4h4l1.4 1.5h6.6v6.5h-12V4Z'
    : kind === 'image'
      ? 'M3 3h10v10H3V3Zm1.5 8 2.8-3 1.8 1.8 1.4-1.4 2 2'
      : 'M4 2.5h5l3 3v8H4v-11Zm5 0v3h3'
  return React.createElement(
    'svg',
    { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', 'aria-hidden': true },
    React.createElement('path', {
      d: path,
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    })
  )
}

function CloseIcon() {
  return React.createElement(
    'svg',
    { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', 'aria-hidden': true },
    React.createElement('path', {
      d: 'm4 4 8 8m0-8-8 8',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round'
    })
  )
}

function ProductAttachmentView({ ctx, sessionId }: {
  ctx: ClientContext & Context
  sessionId: SessionId | null
}) {
  const snapshot = React.useSyncExternalStore(
    (listener: () => void) => ctx.dshWorkProductAttachments.subscribe(sessionId, listener),
    () => ctx.dshWorkProductAttachments.getSnapshot(sessionId),
    () => ctx.dshWorkProductAttachments.getSnapshot(sessionId)
  )
  const locale = React.useSyncExternalStore(
    (listener: () => void) => ctx.locale.subscribe(listener),
    () => ctx.locale.getLocale().active,
    () => 'en'
  )
  const copy = COPY[locale === 'zh' ? 'zh' : 'en']
  const [preview, setPreview] = React.useState<ProductAttachmentItem | null>(null)
  const images = snapshot.items.filter((item): item is ProductAttachmentItem & { previewUrl: string } => (
    item.kind === 'image' && Boolean(item.previewUrl) && !item.selectionLabel
  ))
  const files = snapshot.items.filter((item) => !images.includes(item as ProductAttachmentItem & { previewUrl: string }))
  const railItems: Array<AttachmentRailItem & ProductAttachmentItem> = images.map((item) => ({
    ...item,
    previewUrl: item.previewUrl,
    alt: item.name,
    removeLabel: `${copy.remove}: ${item.name}`
  }))

  React.useEffect(() => {
    if (preview && !snapshot.items.some((item) => item.id === preview.id)) setPreview(null)
  }, [preview, snapshot.items])

  if (snapshot.items.length === 0) return null
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      { 'data-dsh-product-attachments': true },
      railItems.length > 0 && React.createElement(
        'div',
        { 'data-dsh-product-attachment-images': true },
        React.createElement(AttachmentRail, {
          items: railItems,
          labels: {
            group: copy.group,
            open: copy.open,
            scrollLeft: copy.scrollLeft,
            scrollRight: copy.scrollRight
          },
          onOpen: (item) => setPreview(item),
          onRemove: (item) => ctx.dshWorkProductAttachments.remove(sessionId, item.id)
        })
      ),
      files.length > 0 && React.createElement(
        'div',
        { 'data-dsh-product-attachment-files': true },
        files.map((item) => React.createElement(
          'div',
          { key: item.id, 'data-dsh-product-attachment-file': item.kind },
          React.createElement(Icon, { kind: item.kind }),
          React.createElement('span', { title: item.name }, item.name),
          item.selectionLabel && React.createElement('small', null, item.selectionLabel),
          React.createElement(
            'button',
            {
              type: 'button',
              title: `${copy.remove}: ${item.name}`,
              'aria-label': `${copy.remove}: ${item.name}`,
              onClick: () => ctx.dshWorkProductAttachments.remove(sessionId, item.id)
            },
            React.createElement(CloseIcon)
          )
        ))
      ),
      snapshot.hasImages && React.createElement(
        'div',
        { 'data-dsh-product-attachment-hint': true },
        copy.hint
      )
    ),
    preview && createPortal(
      React.createElement(
        'div',
        {
          role: 'dialog',
          'aria-modal': true,
          'aria-label': copy.dialog,
          'data-dsh-product-attachment-lightbox': true,
          onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
            if (event.target === event.currentTarget) setPreview(null)
          }
        },
        React.createElement('img', { src: preview.previewUrl, alt: preview.name }),
        React.createElement(
          'button',
          { type: 'button', 'aria-label': copy.close, onClick: () => setPreview(null) },
          '×'
        )
      ),
      document.body
    )
  )
}

/** Register the desktop attachment projection into the standard input dock. */
export function apply(ctx: ClientContext & Context) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@deepseek-ai/dsh-client-product-attachments'
    style.textContent = PLUGIN_CSS
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-work product attachment styles')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-work-product-attachments',
    order: -100,
    label: 'Product attachments'
  }, (owner: OwnerOf<'conversation.input.dock'>) => React.createElement(ProductAttachmentView, {
    ctx,
    sessionId: owner.session.sessionId
  })))
  ctx.slots.inject('dsh-work.composer.pre-session', () => ctx.slots.register({
    name: 'dsh-work.composer.pre-session',
    id: 'dsh-work-product-attachments-pre-session',
    order: -100,
    label: 'Product attachments before Session creation'
  }, () => React.createElement(ProductAttachmentView, { ctx, sessionId: null })))
}
