import { describe, expect, it } from 'vitest'
import {
  filterProductReferences,
  productConversationReferences,
  productFileReferences
} from './ProductReferences'

describe('product reference catalogs', () => {
  it('flattens authorized file roots without losing the absolute insertion path', () => {
    const references = productFileReferences([{
      id: 'source',
      name: 'project',
      path: '/work/project',
      kind: 'source_folder',
      tree: [{
        name: 'docs',
        path: 'docs',
        type: 'dir',
        children: [{ name: 'report.md', path: 'docs/report.md', type: 'file' }]
      }]
    }])
    expect(references).toEqual([{
      name: 'project/docs/report.md',
      description: '/work/project/docs/report.md',
      text: '@/work/project/docs/report.md '
    }])
  })

  it('keeps conversation text compatible while sharing the official at-sign menu', () => {
    const references = productConversationReferences([{ id: 'conversation-1', title: '需求评审' }])
    expect(references).toEqual([{ name: '需求评审', description: '会话', text: '#需求评审 ' }])
    expect(filterProductReferences(references, '评审')).toEqual(references)
    expect(filterProductReferences(references, '不存在')).toEqual([])
  })
})
