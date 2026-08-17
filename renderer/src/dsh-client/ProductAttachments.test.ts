import { describe, expect, it } from 'vitest'
import { productAttachmentId, productAttachmentSnapshot } from './ProductAttachments'

describe('product attachment projection', () => {
  it('keeps local paths out of ids while projecting image and selection display data', () => {
    const image = { path: '/private/work/chart.png', name: 'chart.png' }
    const selected = {
      path: '/private/work/report.pdf',
      name: 'report.pdf',
      artifactId: 'artifact-1',
      artifactSelections: [{ format: 'pdf', anchor: 'page:2', label: '第 2 页' }]
    }
    const snapshot = productAttachmentSnapshot([image, selected], (attachment) => (
      attachment.artifactSelections?.[0]?.label || ''
    ))

    expect(snapshot).toMatchObject({
      hasImages: true,
      items: [
        { name: 'chart.png', kind: 'image' },
        { name: 'report.pdf', kind: 'pdf', selectionLabel: '第 2 页' }
      ]
    })
    expect(snapshot.items[0]?.previewUrl).toMatch(/^dsh-file:\/\/local\//)
    expect(productAttachmentId(image)).not.toContain('/private/work')
    expect(productAttachmentId(image)).toBe(productAttachmentId({ ...image }))
  })

  it('does not publish a browser URL for a durable DSH attachment reference', () => {
    const snapshot = productAttachmentSnapshot([{
      path: 'dsh-attachment:sha256:abc',
      name: 'history.png',
      mimeType: 'image/png',
      dshAttachment: { appSessionId: 'session-1', attachmentId: 'sha256:abc' }
    }], () => '')

    expect(snapshot.items[0]).toMatchObject({ kind: 'image', name: 'history.png' })
    expect(snapshot.items[0]).not.toHaveProperty('previewUrl')
  })
})
