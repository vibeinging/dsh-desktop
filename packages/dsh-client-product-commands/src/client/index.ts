import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConsumeTokenRequest, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

interface DshWorkProductActions {
  run(sessionId: SessionId, name: string): boolean
}

type ProductCommandLocaleKey = 'command.new' | 'command.runs' | 'command.trace'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-work-product-commands': ProductCommandLocaleKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductActions: DshWorkProductActions
  }
}

const NS = 'dsh-work-product-commands'
const COMMANDS = [
  { name: 'new', description: 'command.new' },
  { name: 'runs', description: 'command.runs' },
  { name: 'trace', description: 'command.trace' }
] as const

export const inject = ['sessions', 'inputTriggers', 'locale', 'dshWorkProductActions']

function consume(
  ctx: ClientContext & Context,
  sessionId: SessionId,
  name: string,
  guard: ConsumeTokenRequest['guard']
) {
  const actx = ctx.sessions.scope(sessionId)
  if (!actx || actx.bail(actx, 'slash/input-consume-token', { guard }) !== true) return false
  queueMicrotask(() => ctx.dshWorkProductActions.run(sessionId, name))
  return true
}

/** Register App-owned commands through the official Session input source registry. */
export function apply(ctx: ClientContext & Context) {
  const t = ctx.locale.bind(NS)
  const source: InputTriggerSource = {
    trigger: '/',
    name: 'dsh-work',
    order: -10,
    candidates: (_session, request) => Promise.resolve(
      request.position === 'leading'
        ? COMMANDS
          .filter((command) => command.name.startsWith(request.query.toLowerCase()))
          .map((command) => ({ name: command.name, description: t(command.description) }))
        : []
    ),
    onPick: ({ candidate, session, span }) => {
      if (!COMMANDS.some((command) => command.name === candidate.name)) return undefined
      return consume(ctx, session.sessionId, candidate.name, { kind: 'span', span })
        ? 'handled'
        : undefined
    },
    matchEnter: async (session, line, signal) => {
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('DSH command adjudication aborted')
      }
      const trimmed = line.trim()
      const command = COMMANDS.find((candidate) => trimmed === `/${candidate.name}`)
      if (!command) return undefined
      if (!consume(ctx, session.sessionId, command.name, { kind: 'bare-token', token: trimmed })) {
        throw new Error(`DSH Session could not consume /${command.name}`)
      }
      return 'handled'
    }
  }

  ctx.effect(() => ctx.locale.register(NS, {
    zh: {
      'command.new': '新建空白对话',
      'command.runs': '打开当前对话的 DSH 运行记录',
      'command.trace': '查看当前对话的 DSH 事件、耗时和 Token'
    },
    en: {
      'command.new': 'Start a blank conversation',
      'command.runs': 'Open DSH runs for this conversation',
      'command.trace': 'Inspect DSH events, timing, and tokens'
    }
  }), 'dsh-work product command dictionaries')
  ctx.effect(() => ctx.inputTriggers.registerSource(source), 'dsh-work product command source')
}
