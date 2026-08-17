import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

type DshWorkSessions = Pick<ClientContext['sessions'], 'scopeOf' | 'binding'>

/** Official conversation service face backed by the active DSH Session runtime. */
export class DshWorkConversationService extends Service implements IConversation {
  readonly input: IConversation['input']
  readonly blocks: IConversation['blocks']
  readonly #sessions: DshWorkSessions

  constructor(ctx: Context, config: {
    input: IConversation['input']
    blocks: IConversation['blocks']
    sessions: DshWorkSessions
  }) {
    super(ctx, 'conversation')
    this.input = config.input
    this.blocks = config.blocks
    this.#sessions = config.sessions
  }

  async send(text: string) {
    const result = await this.#session('send').prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
  }

  async updateQueue(
    itemId: Parameters<IConversation['updateQueue']>[0],
    action: Parameters<IConversation['updateQueue']>[1]
  ) {
    const result = await this.#session('updateQueue').updateQueue(itemId, action)
    if (result.ok) return
    if (
      action.kind === 'steer'
      && (result.error.code === 'steer-unavailable' || result.error.code === 'queue-item-not-found')
    ) return
    throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
  }

  async cancel() {
    const result = await this.#session('cancel').cancel()
    if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`)
  }

  async loadOlder() {
    await this.#session('loadOlder').loadOlder()
  }

  #session(operation: string) {
    const sessionId = this.#sessions.scopeOf(this.ctx)
    if (!sessionId) {
      throw new Error(`conversation.${operation} requires a session scope`)
    }
    const binding = this.#sessions.binding(sessionId)
    if (!binding) {
      throw new Error(`conversation.${operation}: session "${sessionId}" resolved no binding`)
    }
    return binding.session
  }
}
