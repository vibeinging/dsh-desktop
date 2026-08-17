import { describe, expect, it, vi } from 'vitest'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply, inject } from '../../../packages/dsh-client-product-references/src/client/index'

describe('dsh product reference Client plugin', () => {
  it('declares the official input registry and narrow product catalog service', () => {
    expect(inject).toEqual(['inputTriggers', 'dshWorkProductReferences'])
  })

  it('registers file and conversation sources beside the official subagent source', async () => {
    const sources: InputTriggerSource[] = []
    const list = vi.fn(async (_sessionId: string, kind: 'file' | 'conversation') => kind === 'file'
      ? [{ name: 'project/report.md', description: '/work/report.md', text: '@/work/report.md ' }]
      : [{ name: '需求评审', description: '会话', text: '#需求评审 ' }])
    const ctx = {
      inputTriggers: {
        registerSource: vi.fn((source: InputTriggerSource) => {
          sources.push(source)
          return vi.fn()
        })
      },
      dshWorkProductReferences: { list },
      effect: (factory: () => unknown) => factory()
    }

    apply(ctx as never)
    expect(sources.map((source) => [source.trigger, source.name, source.order])).toEqual([
      ['@', 'dsh-work-files', 10],
      ['@', 'dsh-work-conversations', 20]
    ])

    const session = { sessionId: 'session-product-references' }
    const fileCandidate = await sources[0].candidates(session as never, {
      query: 'report',
      position: 'inline',
      signal: new AbortController().signal
    })
    expect(fileCandidate).toEqual([{
      name: 'project/report.md',
      description: '/work/report.md',
      text: '@/work/report.md '
    }])
    expect(sources[0].onPick({ candidate: fileCandidate[0] } as never)).toEqual({ text: '@/work/report.md ' })

    const conversationCandidate = await sources[1].candidates(session as never, {
      query: '需求',
      position: 'inline',
      signal: new AbortController().signal
    })
    expect(conversationCandidate[0]?.name).toBe('需求评审')
    expect(sources[1].onPick({ candidate: conversationCandidate[0] } as never)).toEqual({ text: '#需求评审 ' })
    expect(list).toHaveBeenCalledWith('session-product-references', 'conversation', '需求')
  })
})
