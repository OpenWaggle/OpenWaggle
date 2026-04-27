import type { SessionId } from '@shared/types/brand'
import type { SessionWorkspaceSelection } from '@shared/types/session'
import { useSessionStore } from '@/stores/session-store'

interface SessionsReturn {
  sessions: ReturnType<typeof useSessionStore.getState>['sessions']
  activeSessionTree: ReturnType<typeof useSessionStore.getState>['activeSessionTree']
  activeWorkspace: ReturnType<typeof useSessionStore.getState>['activeWorkspace']
  draftBranch: ReturnType<typeof useSessionStore.getState>['draftBranch']
  loadSessions: () => Promise<void>
  refreshSessionTree: (sessionId: SessionId | null) => Promise<void>
  refreshSessionWorkspace: (
    sessionId: SessionId | null,
    selection?: SessionWorkspaceSelection,
  ) => Promise<void>
  refreshSessionsAndTree: (sessionId: SessionId | null) => Promise<void>
  refreshSessionsAndWorkspace: (
    sessionId: SessionId | null,
    selection?: SessionWorkspaceSelection,
  ) => Promise<void>
  clearDraftBranchForSession: (sessionId: SessionId) => void
}

export function useSessions(): SessionsReturn {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionTree = useSessionStore((s) => s.activeSessionTree)
  const activeWorkspace = useSessionStore((s) => s.activeWorkspace)
  const draftBranch = useSessionStore((s) => s.draftBranch)
  const loadSessions = useSessionStore((s) => s.loadSessions)
  const refreshSessionTree = useSessionStore((s) => s.refreshSessionTree)
  const refreshSessionWorkspace = useSessionStore((s) => s.refreshSessionWorkspace)
  const refreshSessionsAndTree = useSessionStore((s) => s.refreshSessionsAndTree)
  const refreshSessionsAndWorkspace = useSessionStore((s) => s.refreshSessionsAndWorkspace)
  const clearDraftBranchForSession = useSessionStore((s) => s.clearDraftBranchForSession)

  return {
    sessions,
    activeSessionTree,
    activeWorkspace,
    draftBranch,
    loadSessions,
    refreshSessionTree,
    refreshSessionWorkspace,
    refreshSessionsAndTree,
    refreshSessionsAndWorkspace,
    clearDraftBranchForSession,
  }
}
