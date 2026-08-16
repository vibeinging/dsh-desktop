import { describe, expect, it } from 'vitest'
import { collectDshProducedPaths, parseDshProducedPaths, withDshProducedPaths } from './DshTurnTailAdapter'

describe('DSH turn-tail adapter', () => {
  it('collects successful mutation locations once and ignores reads and failures', () => {
    const produced = collectDshProducedPaths([
      {
        id: 'write',
        type: 'tool',
        content: 'write',
        metadata: {
          status: 'done',
          dshResultSeq: 12,
          dshCallView: { for: 'call', view: { card: 'diff', locations: [{ path: 'report.md' }] } }
        }
      },
      {
        id: 'edit',
        type: 'tool',
        content: 'edit',
        metadata: {
          status: 'done',
          dshResultSeq: 18,
          dshCallView: {
            for: 'call',
            view: { card: 'generic', kind: 'edit', locations: [{ path: 'report.md' }, { path: 'data.csv' }] }
          }
        }
      },
      {
        id: 'read',
        type: 'tool',
        content: 'read',
        metadata: {
          status: 'done',
          dshResultSeq: 20,
          dshCallView: { for: 'call', view: { card: 'generic', kind: 'read', locations: [{ path: 'source.txt' }] } }
        }
      },
      {
        id: 'failed',
        type: 'tool',
        content: 'failed',
        metadata: {
          status: 'error',
          dshResultSeq: 21,
          dshCallView: { for: 'call', view: { card: 'diff', locations: [{ path: 'failed.txt' }] } }
        }
      }
    ])

    expect(produced).toEqual([
      { seq: 12, path: 'report.md' },
      { seq: 18, path: 'data.csv' }
    ])
  })

  it('parses only complete turn-tail facts', () => {
    expect(parseDshProducedPaths(JSON.stringify([
      { seq: 4, path: 'ok.txt' },
      { seq: 'bad', path: 'bad.txt' },
      { seq: 5, path: '' }
    ]))).toEqual([{ seq: 4, path: 'ok.txt' }])
    expect(parseDshProducedPaths('{')).toEqual([])
  })

  it('keeps official timeline data and supplies missing deliverables data', () => {
    const baseData = { custom: true }
    const base = {
      turn: 2,
      start: undefined,
      end: undefined,
      status: 'closed' as const,
      steps: [],
      data: { get: (key: string) => key === 'custom' ? baseData : undefined }
    }
    const turn = withDshProducedPaths(2, [{ seq: 9, path: 'result.txt' }], base as never)

    expect(turn.data.get('custom' as never)).toBe(baseData)
    expect((turn.data as unknown as { get: (key: string) => unknown }).get('deliverables'))
      .toEqual({ produced: [{ seq: 9, path: 'result.txt' }] })
  })
})
