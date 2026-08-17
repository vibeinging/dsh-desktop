import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { DshConversationBridge } from '../../../../renderer/src/dsh-client/DshConversationBridge'
import type {
  DshWorkProductReference,
  DshWorkProductReferenceKind
} from '../../../../renderer/src/dsh-client/ProductReferences'

export interface DshWorkProductReferences {
  list(
    sessionId: SessionId,
    kind: DshWorkProductReferenceKind,
    query: string
  ): Promise<readonly DshWorkProductReference[]>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductReferences: DshWorkProductReferences
  }
}

/** Narrow Client service used by removable product reference sources. */
export class DshWorkProductReferencesService extends Service implements DshWorkProductReferences {
  private readonly conversation: Pick<DshConversationBridge, 'listProductReferences'>

  constructor(ctx: Context, conversation: Pick<DshConversationBridge, 'listProductReferences'>) {
    super(ctx, 'dshWorkProductReferences')
    this.conversation = conversation
  }

  list(sessionId: SessionId, kind: DshWorkProductReferenceKind, query: string) {
    return this.conversation.listProductReferences(sessionId, kind, query)
  }
}
