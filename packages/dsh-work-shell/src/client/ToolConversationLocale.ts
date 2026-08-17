const TOOL_CONVERSATION_NAMESPACE = 'conversation'

interface ToolLocaleRegistry {
  register: (namespace: string, locale: string, dictionary: Readonly<Record<string, string>>) => () => void
}

const zh = Object.freeze({
  'details.running': '运行中…',
  'todo.title': '任务',
  'todo.progress.done': '{done} 已完成',
  'todo.progress.active': '{active} 进行中',
  'todo.progress.pending': '{pending} 待处理',
  'todo.rowTitle': '更新任务清单',
  'todo.completed': '{done}/{total} 已完成',
  'ask.rowTitle': '提问',
  'ask.waiting': '等待回答',
  'ask.cancelled': '已取消',
  'ask.interrupted': '已中断',
  'ask.answered': '{answered}/{total} 已回答',
  'bash.running': '运行中',
  'bash.failed': '失败',
  'bash.stopped': '已停止',
  'row.running': '运行中',
  'row.failed': '失败',
  'row.stopped': '已停止',
  'terminal.signal': '信号 {signal}',
  'terminal.exitCode': '退出码 {code}',
  'terminal.running': '运行中',
  'terminal.failed': '失败',
  'terminal.done': '已完成',
  'terminal.noOutput': '无输出',
  'terminal.collapseAria': '收起输出',
  'terminal.expandAria': '展开其余 {n} 行输出',
  'terminal.expandRest': '… 其余 {n} 行'
})

const en = Object.freeze({
  'details.running': 'Running…',
  'todo.title': 'To-dos',
  'todo.progress.done': '{done} completed',
  'todo.progress.active': '{active} in progress',
  'todo.progress.pending': '{pending} pending',
  'todo.rowTitle': 'Update to-do list',
  'todo.completed': '{done}/{total} completed',
  'ask.rowTitle': 'Ask question',
  'ask.waiting': 'waiting',
  'ask.cancelled': 'cancelled',
  'ask.interrupted': 'interrupted',
  'ask.answered': '{answered}/{total} answered',
  'bash.running': 'Running',
  'bash.failed': 'Failed',
  'bash.stopped': 'Stopped',
  'row.running': 'Running',
  'row.failed': 'Failed',
  'row.stopped': 'Stopped',
  'terminal.signal': 'signal {signal}',
  'terminal.exitCode': 'exit code {code}',
  'terminal.running': 'Running',
  'terminal.failed': 'Failed',
  'terminal.done': 'Done',
  'terminal.noOutput': 'No output',
  'terminal.collapseAria': 'Collapse output',
  'terminal.expandAria': 'Expand the remaining {n} output lines',
  'terminal.expandRest': '… {n} more lines'
})

/** Register the rc.6 Tool subset whose original dictionary lives in the disabled page shell. */
export function registerToolConversationLocale(locale: ToolLocaleRegistry) {
  const disposeZh = locale.register(TOOL_CONVERSATION_NAMESPACE, 'zh', zh)
  try {
    const disposeEn = locale.register(TOOL_CONVERSATION_NAMESPACE, 'en', en)
    return () => {
      disposeEn()
      disposeZh()
    }
  } catch (error) {
    disposeZh()
    throw error
  }
}
