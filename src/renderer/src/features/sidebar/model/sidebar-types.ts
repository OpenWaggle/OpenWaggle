import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionBranch, SessionTree } from '@shared/types/session'
import type { SidebarProjectGroup } from '../lib/sidebar-project-groups'

export type SidebarView = 'chat' | 'skills' | 'settings'

export interface SidebarDraftBranch {
  readonly sessionId: SessionId
  readonly sourceNodeId: SessionNodeId
}

export interface SidebarSessionActions {
  readonly select: (id: SessionId) => void
  readonly delete: (id: SessionId) => void
  readonly archive: (id: SessionId) => void
  readonly markUnread: (id: SessionId) => void
  readonly clone: (id: SessionId) => void
}

export interface SidebarBranchActions {
  readonly select: (sessionId: string, branch: SessionBranch) => void
  readonly rename: (sessionId: string, branch: SessionBranch, name: string) => void
  readonly archive: (sessionId: string, branch: SessionBranch) => void
  readonly toggle: (sessionId: SessionId, collapsed: boolean) => void
}

export interface SidebarProjectActions {
  readonly newSession: (path: string) => void
  readonly openInFinder: (path: string) => void
  readonly rename: (path: string, name: string) => void
  readonly archiveSessions: (
    path: string,
    sessions: readonly SidebarProjectGroup['sessions'][number][],
  ) => void
  readonly remove: (path: string) => void
  readonly toggleCollapsed: (path: string) => void
}

export interface SidebarProjectRenderState {
  readonly activeBranchId: SessionTree['session']['lastActiveBranchId']
  readonly activeSessionId: SessionId | null
  readonly activeSessionTree: SessionTree | null
  readonly collapsedProjectPaths: ReadonlySet<string>
  readonly draftBranch: SidebarDraftBranch | null
  readonly draftSessionProjectPath: string | null
  readonly projectPath: string | null
}
