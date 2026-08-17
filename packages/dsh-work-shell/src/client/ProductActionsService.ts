import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { DshConversationBridge } from '../../../../renderer/src/dsh-client/DshConversationBridge'

export interface DshWorkProductActions {
  run(sessionId: SessionId, name: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductActions: DshWorkProductActions
  }
}

/** Narrow Client service used by removable product-action plugins. */
export class DshWorkProductActionsService extends Service implements DshWorkProductActions {
  private readonly conversation: Pick<DshConversationBridge, 'runProductCommand'>

  constructor(ctx: Context, conversation: Pick<DshConversationBridge, 'runProductCommand'>) {
    super(ctx, 'dshWorkProductActions')
    this.conversation = conversation
  }

  run(sessionId: SessionId, name: string) {
    return this.conversation.runProductCommand(sessionId, name)
  }
}
