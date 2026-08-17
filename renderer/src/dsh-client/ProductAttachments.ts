import type { Attachment } from '../views/agent/ComposerActions'
import { attachmentArtifactSelections } from '../views/agent/conversation/messageState'
import {
  attachmentPreviewKind,
  imageSrcFromPath,
  isRenderableImageSrc,
  type AttachmentPreviewKind
} from '../views/agent/stream/uiCapabilities'

export interface DshWorkProductAttachmentItem {
  readonly id: string
  readonly name: string
  readonly kind: AttachmentPreviewKind
  readonly previewUrl?: string
  readonly selectionLabel?: string
}

export interface DshWorkProductAttachmentSnapshot {
  readonly items: readonly DshWorkProductAttachmentItem[]
  readonly hasImages: boolean
}

export interface DshWorkProductAttachmentHandlers {
  remove(id: string): boolean
}

export const EMPTY_PRODUCT_ATTACHMENTS: DshWorkProductAttachmentSnapshot = Object.freeze({
  items: Object.freeze([]),
  hasImages: false
})

function hashAttachmentIdentity(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** Return a display-safe identity that does not expose the local path to Client plugins. */
export function productAttachmentId(attachment: Attachment) {
  const selections = attachmentArtifactSelections(attachment)
    .map((selection) => selection.anchor)
    .join('\u0000')
  return `product-attachment-${hashAttachmentIdentity([
    attachment.path,
    attachment.artifactId || '',
    attachment.artifactVersionId || '',
    selections
  ].join('\u0001'))}`
}

/** Project App-owned draft attachments into the narrow Client service shape. */
export function productAttachmentSnapshot(
  attachments: readonly Attachment[],
  selectionLabel: (attachment: Attachment) => string
): DshWorkProductAttachmentSnapshot {
  const items = attachments.map((attachment) => {
    const kind = attachmentPreviewKind(attachment)
    const previewUrl = kind === 'image' && !attachment.dshAttachment
      ? imageSrcFromPath(attachment.path)
      : ''
    return Object.freeze({
      id: productAttachmentId(attachment),
      name: attachment.name,
      kind,
      ...(previewUrl && isRenderableImageSrc(previewUrl) ? { previewUrl } : {}),
      ...(selectionLabel(attachment) ? { selectionLabel: selectionLabel(attachment) } : {})
    })
  })
  return Object.freeze({
    items: Object.freeze(items),
    hasImages: items.some((item) => item.kind === 'image')
  })
}
