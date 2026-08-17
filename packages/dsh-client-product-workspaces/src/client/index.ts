import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import * as React from 'react'

interface ProductWorkspace {
  readonly id: string
  readonly name: string
  readonly chat: boolean
}

interface ProductWorkspaceSnapshot {
  readonly activeId: string
  readonly items: readonly ProductWorkspace[]
  readonly canOpenFolder: boolean
  readonly canCreateProject: boolean
}

interface ProductWorkspacesService {
  getSnapshot(): ProductWorkspaceSnapshot
  subscribe(listener: () => void): () => void
  select(id: string): boolean
  openFolder(): boolean
  createProject(name: string): Promise<boolean>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshWorkProductWorkspaces: ProductWorkspacesService
  }
}

export const inject = ['slots', 'locale', 'dshWorkProductWorkspaces']

const COPY = {
  zh: {
    choose: '选择项目',
    search: '搜索项目',
    empty: '没有匹配的项目',
    noProject: '不使用项目',
    project: '项目',
    createFromFolder: '从文件夹创建项目…',
    addFolder: '添加文件夹到当前项目…',
    create: '创建项目…',
    createPlaceholder: '项目名称，回车创建',
    createFailed: '项目创建失败，请重试。'
  },
  en: {
    choose: 'Choose project',
    search: 'Search projects',
    empty: 'No matching projects',
    noProject: 'No project',
    project: 'Project',
    createFromFolder: 'Create project from folder…',
    addFolder: 'Add folder to current project…',
    create: 'Create project…',
    createPlaceholder: 'Project name, press Enter',
    createFailed: 'Could not create the project. Try again.'
  }
} as const

const ROOT_STYLE: React.CSSProperties = { position: 'relative', minWidth: 0 }
const TRIGGER_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  maxWidth: 240,
  padding: '0 9px',
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-fill-l2)',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 8,
  cursor: 'pointer'
}
const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 34,
  left: 0,
  zIndex: 1200,
  width: 292,
  padding: 8,
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-bg-l1)',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 12,
  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.18)'
}
const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 32,
  padding: '6px 8px',
  color: 'inherit',
  textAlign: 'left',
  background: 'transparent',
  border: 0,
  borderRadius: 7,
  cursor: 'pointer'
}
const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: '0 8px',
  color: 'inherit',
  background: 'var(--dsw-alias-fill-l1)',
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 7,
  outline: 'none'
}

function Icon({ kind }: { kind: 'chat' | 'folder' | 'chevron' | 'check' | 'plus' }) {
  const path = kind === 'chat'
    ? 'M3 3.5h10v7H7l-3.5 2v-2H3v-7Z'
    : kind === 'folder'
      ? 'M2.5 4h4l1.3 1.5h5.7v6.5h-11V4Z'
      : kind === 'chevron'
        ? 'm5 6 3 3 3-3'
        : kind === 'check'
          ? 'm4 8 2.5 2.5L12 5'
          : 'M8 3v10M3 8h10'
  return React.createElement(
    'svg',
    { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', 'aria-hidden': true },
    React.createElement('path', {
      d: path,
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    })
  )
}

function ProductWorkspacePicker({ ctx }: { ctx: ClientContext & Context }) {
  const snapshot = React.useSyncExternalStore(
    (listener: () => void) => ctx.dshWorkProductWorkspaces.subscribe(listener),
    () => ctx.dshWorkProductWorkspaces.getSnapshot(),
    () => ctx.dshWorkProductWorkspaces.getSnapshot()
  )
  const locale = React.useSyncExternalStore(
    (listener: () => void) => ctx.locale.subscribe(listener),
    () => ctx.locale.getLocale().active,
    () => 'en'
  )
  const copy = COPY[locale === 'zh' ? 'zh' : 'en']
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [name, setName] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const root = React.useRef<HTMLDivElement>(null)
  const active = snapshot.items.find((item) => item.id === snapshot.activeId)
  const keyword = query.trim().toLowerCase()
  const filtered = snapshot.items.filter((item) => !keyword || item.name.toLowerCase().includes(keyword))

  React.useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  React.useEffect(() => {
    if (open) return
    setQuery('')
    setCreating(false)
    setName('')
    setError('')
  }, [open])

  const createProject = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      if (!await ctx.dshWorkProductWorkspaces.createProject(trimmed)) {
        setError(copy.createFailed)
        return
      }
      setOpen(false)
    } catch {
      setError(copy.createFailed)
    } finally {
      setSaving(false)
    }
  }

  return React.createElement(
    'div',
    { ref: root, style: ROOT_STYLE, 'data-dsh-product-workspace-picker': true },
    React.createElement(
      'button',
      {
        type: 'button',
        style: TRIGGER_STYLE,
        'data-dsh-product-workspace-trigger': true,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => setOpen((current) => !current)
      },
      React.createElement(Icon, { kind: active?.chat ? 'chat' : 'folder' }),
      React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, active?.name || copy.choose),
      React.createElement(Icon, { kind: 'chevron' })
    ),
    open && React.createElement(
      'div',
      { style: PANEL_STYLE, role: 'menu', 'data-dsh-product-workspace-menu': true },
      React.createElement('input', {
        autoFocus: true,
        value: query,
        placeholder: copy.search,
        style: INPUT_STYLE,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)
      }),
      React.createElement(
        'div',
        { style: { maxHeight: 220, overflowY: 'auto', paddingTop: 6 } },
        filtered.length
          ? filtered.map((item) => React.createElement(
              'button',
              {
                key: item.id,
                type: 'button',
                role: 'menuitem',
                style: {
                  ...ROW_STYLE,
                  ...(item.id === snapshot.activeId ? { background: 'var(--dsw-alias-fill-l2)' } : {})
                },
                'data-workspace-id': item.id,
                onClick: () => {
                  if (ctx.dshWorkProductWorkspaces.select(item.id)) setOpen(false)
                }
              },
              React.createElement(Icon, { kind: item.chat ? 'chat' : 'folder' }),
              React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, item.name),
              item.chat && React.createElement('small', { style: { opacity: 0.62 } }, copy.noProject),
              item.id === snapshot.activeId && React.createElement(Icon, { kind: 'check' })
            ))
          : React.createElement('div', { style: { padding: '12px 8px', opacity: 0.62, fontSize: 12 } }, copy.empty)
      ),
      (snapshot.canOpenFolder || snapshot.canCreateProject) && React.createElement('div', {
        style: { height: 1, margin: '6px 0', background: 'var(--dsw-alias-border-l1)' }
      }),
      (snapshot.canOpenFolder || snapshot.canCreateProject) && React.createElement('div', {
        style: { padding: '2px 8px 5px', fontSize: 11, opacity: 0.58, textTransform: 'uppercase' }
      }, copy.project),
      snapshot.canOpenFolder && React.createElement(
        'button',
        {
          type: 'button',
          style: ROW_STYLE,
          onClick: () => {
            if (ctx.dshWorkProductWorkspaces.openFolder()) setOpen(false)
          }
        },
        React.createElement(Icon, { kind: 'folder' }),
        React.createElement('span', null, active?.chat ? copy.createFromFolder : copy.addFolder)
      ),
      snapshot.canCreateProject && (creating
        ? React.createElement(
            'div',
            { style: { display: 'flex', gap: 6, paddingTop: 4 } },
            React.createElement('input', {
              autoFocus: true,
              value: name,
              disabled: saving,
              placeholder: copy.createPlaceholder,
              style: INPUT_STYLE,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => setName(event.currentTarget.value),
              onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void createProject()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setCreating(false)
                  setName('')
                  setError('')
                }
              }
            })
          )
        : React.createElement(
            'button',
            { type: 'button', style: ROW_STYLE, onClick: () => setCreating(true) },
            React.createElement(Icon, { kind: 'plus' }),
            React.createElement('span', null, copy.create)
          )),
      error && React.createElement('div', { role: 'alert', style: { padding: '5px 8px 2px', color: 'var(--dsw-alias-red)', fontSize: 12 } }, error)
    )
  )
}

/** Register the App project selector in the standard root-scoped Workspace Hero Slot. */
export function apply(ctx: ClientContext & Context) {
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace'
    },
    () => React.createElement(ProductWorkspacePicker, { ctx })
  ))
}
