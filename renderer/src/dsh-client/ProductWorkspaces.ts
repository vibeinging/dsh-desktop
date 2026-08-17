export interface DshWorkProductWorkspace {
  readonly id: string
  readonly name: string
  readonly chat: boolean
}

export interface DshWorkProductWorkspaceSnapshot {
  readonly activeId: string
  readonly items: readonly DshWorkProductWorkspace[]
  readonly canOpenFolder: boolean
  readonly canCreateProject: boolean
}

export interface DshWorkProductWorkspaceHandlers {
  select(id: string): boolean
  openFolder(): boolean
  createProject(name: string): Promise<boolean>
}

export const EMPTY_PRODUCT_WORKSPACES: DshWorkProductWorkspaceSnapshot = Object.freeze({
  activeId: '',
  items: Object.freeze([]),
  canOpenFolder: false,
  canCreateProject: false
})
