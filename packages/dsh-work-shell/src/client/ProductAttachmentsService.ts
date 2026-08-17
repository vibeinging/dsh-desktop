import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { DshConversationBridge } from '../../../../renderer/src/dsh-client/DshConversationBridge'
import type { DshWorkProductAttachmentSnapshot } from '../../../../renderer/src/dsh-client/ProductAttachments'

export interface DshWorkProductAttachmentsServiceContract {
  getSnapshot(sessionId: SessionId | null): DshWorkProductAttachmentSnapshot
  subscribe(sessionId: SessionId | null, listener: () => void): () => void
  remove(sessionId: SessionId | null, id: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductAttachments: DshWorkProductAttachmentsServiceContract
  }
}

/** Session-scoped display projection for App-owned draft attachments. */
export class DshWorkProductAttachmentsService extends Service implements DshWorkProductAttachmentsServiceContract {
  private readonly conversation: Pick<
    DshConversationBridge,
    'getProductAttachmentSnapshot' | 'subscribeProductAttachments' | 'removeProductAttachment'
  >

  constructor(
    ctx: Context,
    conversation: Pick<
      DshConversationBridge,
      'getProductAttachmentSnapshot' | 'subscribeProductAttachments' | 'removeProductAttachment'
    >
  ) {
    super(ctx, 'dshWorkProductAttachments')
    this.conversation = conversation
  }

  getSnapshot(sessionId: SessionId | null) {
    return this.conversation.getProductAttachmentSnapshot(sessionId)
  }

  subscribe(sessionId: SessionId | null, listener: () => void) {
    return this.conversation.subscribeProductAttachments(sessionId, listener)
  }

  remove(sessionId: SessionId | null, id: string) {
    return this.conversation.removeProductAttachment(sessionId, id)
  }
}
