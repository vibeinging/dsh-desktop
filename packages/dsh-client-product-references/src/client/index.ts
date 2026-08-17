import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerCandidate,
  InputTriggerSource
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

type ProductReferenceKind = 'file' | 'conversation'

interface ProductReference {
  readonly name: string
  readonly description?: string
  readonly text: string
}

interface ProductReferenceCandidate extends InputTriggerCandidate {
  readonly text: string
}

interface DshWorkProductReferences {
  list(
    sessionId: SessionId,
    kind: ProductReferenceKind,
    query: string
  ): Promise<readonly ProductReference[]>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductReferences: DshWorkProductReferences
  }
}

export const inject = ['inputTriggers', 'dshWorkProductReferences']

function source(
  ctx: ClientContext & Context,
  name: string,
  kind: ProductReferenceKind,
  order: number
): InputTriggerSource {
  return {
    trigger: '@',
    name,
    order,
    async candidates(session, { query, signal }) {
      const references = await ctx.dshWorkProductReferences.list(session.sessionId, kind, query)
      if (signal.aborted) return []
      return references.map((reference): ProductReferenceCandidate => ({
        name: reference.name,
        ...(reference.description ? { description: reference.description } : {}),
        text: reference.text
      }))
    },
    onPick({ candidate }) {
      const text = (candidate as ProductReferenceCandidate).text
      return text ? { text } : undefined
    }
  }
}

/** Register App file and conversation references through the official input source registry. */
export function apply(ctx: ClientContext & Context) {
  ctx.effect(
    () => ctx.inputTriggers.registerSource(source(ctx, 'dsh-work-files', 'file', 10)),
    'dsh-work file reference source'
  )
  ctx.effect(
    () => ctx.inputTriggers.registerSource(source(ctx, 'dsh-work-conversations', 'conversation', 20)),
    'dsh-work conversation reference source'
  )
}
