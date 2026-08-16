import type { TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentBlock } from '../views/agent/stream/types'

export interface DshProducedPath {
  seq: number
  path: string
}

function integer(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function producedLocations(block: AgentBlock): DshProducedPath[] {
  if (block.type !== 'tool' || block.metadata?.status !== 'done') return []
  const view = block.metadata?.dshCallView?.view
  const producesFile = view?.card === 'diff' || (view?.card === 'generic' && view?.kind === 'edit')
  if (!producesFile || !Array.isArray(view?.locations)) return []
  const seq = integer(block.metadata?.dshResultSeq)
  if (seq === null) return []
  return view.locations.flatMap((location: unknown) => {
    const path = typeof (location as { path?: unknown })?.path === 'string'
      ? String((location as { path: string }).path).trim()
      : ''
    return path ? [{ seq, path }] : []
  })
}

/** Project successful DSH mutation views into official deliverables turn data. */
export function collectDshProducedPaths(blocks: readonly AgentBlock[]) {
  const seen = new Set<string>()
  return blocks.flatMap((block) => producedLocations(block).filter(({ path }) => {
    if (seen.has(path)) return false
    seen.add(path)
    return true
  }))
}

/** Parse the JSON-safe turn data carried by the product response-tail anchor. */
export function parseDshProducedPaths(value: string | null): DshProducedPath[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      const seq = integer(item?.seq)
      const path = typeof item?.path === 'string' ? item.path.trim() : ''
      return seq === null || !path ? [] : [{ seq, path }]
    })
  } catch {
    return []
  }
}

/**
 * Add the product-folded deliverables value to an engine Turn. The official
 * timeline remains the first source for every other Turn data key.
 */
export function withDshProducedPaths(
  turnNumber: number,
  produced: readonly DshProducedPath[],
  base?: TurnLocation
): TurnLocation {
  const fallback = { produced }
  const data = {
    get(key: string) {
      const value = base?.data.get(key as never)
      if (value !== undefined) return value
      return key === 'deliverables' ? fallback : undefined
    }
  } as unknown as TurnLocation['data']
  return {
    turn: turnNumber,
    start: base?.start,
    end: base?.end,
    status: base?.status || 'closed',
    steps: base?.steps || [],
    data
  }
}
