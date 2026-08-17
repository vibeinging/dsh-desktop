import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { DshConversationBridge } from '../../../../renderer/src/dsh-client/DshConversationBridge'
import type { DshWorkProductSearchMode } from '../../../../renderer/src/dsh-client/ProductSearchMode'

export interface DshWorkProductSearchModeServiceContract {
  getSnapshot(sessionId: SessionId): DshWorkProductSearchMode
  subscribe(sessionId: SessionId, listener: () => void): () => void
  cycle(sessionId: SessionId): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductSearchMode: DshWorkProductSearchModeServiceContract
  }
}

/** Narrow observable service used by the removable product search-mode control. */
export class DshWorkProductSearchModeService extends Service implements DshWorkProductSearchModeServiceContract {
  private readonly conversation: Pick<
    DshConversationBridge,
    'getProductSearchModeSnapshot' | 'subscribeProductSearchMode' | 'cycleProductSearchMode'
  >

  constructor(
    ctx: Context,
    conversation: Pick<
      DshConversationBridge,
      'getProductSearchModeSnapshot' | 'subscribeProductSearchMode' | 'cycleProductSearchMode'
    >
  ) {
    super(ctx, 'dshWorkProductSearchMode')
    this.conversation = conversation
  }

  getSnapshot(sessionId: SessionId) {
    return this.conversation.getProductSearchModeSnapshot(sessionId)
  }

  subscribe(sessionId: SessionId, listener: () => void) {
    return this.conversation.subscribeProductSearchMode(sessionId, listener)
  }

  cycle(sessionId: SessionId) {
    return this.conversation.cycleProductSearchMode(sessionId)
  }
}
