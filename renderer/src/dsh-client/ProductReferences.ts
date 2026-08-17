import type { AgentFileRoot, FileNode } from '@/api/agent'

export type DshWorkProductReferenceKind = 'file' | 'conversation'

/** Renderer-safe reference candidate returned through the narrow Shell service. */
export interface DshWorkProductReference {
  readonly name: string
  readonly description?: string
  readonly text: string
}

export interface DshWorkProductReferenceHandlers {
  list(kind: DshWorkProductReferenceKind, query: string): Promise<readonly DshWorkProductReference[]>
}

function joinLocalPath(root: string, relativePath: string) {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${relativePath.replace(/^[\\/]+/, '')}`
}

/** Flatten the current product workspace roots into official input candidates. */
export function productFileReferences(roots: readonly AgentFileRoot[]): DshWorkProductReference[] {
  const references: DshWorkProductReference[] = []
  const walk = (root: AgentFileRoot, nodes: readonly FileNode[]) => {
    for (const node of nodes) {
      if (node.type === 'dir') {
        walk(root, node.children || [])
        continue
      }
      const path = joinLocalPath(root.path, node.path)
      references.push({
        name: `${root.name}/${node.path}`,
        description: path,
        text: `@${path} `
      })
    }
  }
  for (const root of roots) walk(root, root.tree || [])
  return references
}

/** Project App conversation titles into the same official `@` candidate menu. */
export function productConversationReferences(
  conversations: readonly { id: string; title: string }[]
): DshWorkProductReference[] {
  return conversations.map((conversation) => {
    const title = conversation.title || '新对话'
    return { name: title, description: '会话', text: `#${title} ` }
  })
}

/** Apply the source query without hiding useful path and description matches. */
export function filterProductReferences(
  references: readonly DshWorkProductReference[],
  query: string,
  limit = 60
) {
  const keyword = query.trim().toLowerCase()
  return references
    .filter((reference) => !keyword || `${reference.name} ${reference.description || ''}`.toLowerCase().includes(keyword))
    .slice(0, limit)
}
