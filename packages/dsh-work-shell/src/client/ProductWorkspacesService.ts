import { Service, type Context } from '@deepseek-ai/cordis'
import type { DshConversationBridge } from '../../../../renderer/src/dsh-client/DshConversationBridge'
import type { DshWorkProductWorkspaceSnapshot } from '../../../../renderer/src/dsh-client/ProductWorkspaces'

export interface DshWorkProductWorkspacesServiceContract {
  getSnapshot(): DshWorkProductWorkspaceSnapshot
  subscribe(listener: () => void): () => void
  select(id: string): boolean
  openFolder(): boolean
  createProject(name: string): Promise<boolean>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductWorkspaces: DshWorkProductWorkspacesServiceContract
  }
}

/** Root-scoped product workspace catalog behind the standard Hero Slot. */
export class DshWorkProductWorkspacesService extends Service implements DshWorkProductWorkspacesServiceContract {
  private readonly conversation: Pick<
    DshConversationBridge,
    | 'getProductWorkspaceSnapshot'
    | 'subscribeProductWorkspaces'
    | 'selectProductWorkspace'
    | 'openProductWorkspaceFolder'
    | 'createProductWorkspace'
  >

  constructor(
    ctx: Context,
    conversation: Pick<
      DshConversationBridge,
      | 'getProductWorkspaceSnapshot'
      | 'subscribeProductWorkspaces'
      | 'selectProductWorkspace'
      | 'openProductWorkspaceFolder'
      | 'createProductWorkspace'
    >
  ) {
    super(ctx, 'dshWorkProductWorkspaces')
    this.conversation = conversation
  }

  getSnapshot() {
    return this.conversation.getProductWorkspaceSnapshot()
  }

  subscribe(listener: () => void) {
    return this.conversation.subscribeProductWorkspaces(listener)
  }

  select(id: string) {
    return this.conversation.selectProductWorkspace(id)
  }

  openFolder() {
    return this.conversation.openProductWorkspaceFolder()
  }

  createProject(name: string) {
    return this.conversation.createProductWorkspace(name)
  }
}
