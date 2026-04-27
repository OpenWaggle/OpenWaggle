import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type {
  SessionSummary,
  SessionTree,
  SessionWorkspace,
  SessionWorkspaceSelection,
} from '@shared/types/session'
import { create } from 'zustand'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('session-store')

let latestTreeRequestId = 0
let latestWorkspaceRequestId = 0

function handleStoreError(err: unknown, action: string, setError: (message: string) => void): void {
  const message = err instanceof Error ? err.message : String(err)
  logger.error(`Failed to ${action}`, { message })
  setError(`Failed to ${action}: ${message}`)
}

interface DraftBranchState {
  readonly sessionId: SessionId
  readonly sourceNodeId: SessionNodeId
}

interface SessionState {
  sessions: readonly SessionSummary[]
  activeSessionTree: SessionTree | null
  activeWorkspace: SessionWorkspace | null
  draftBranch: DraftBranchState | null
  error: string | null
  loadSessions: () => Promise<void>
  refreshSessionTree: (sessionId: SessionId | null) => Promise<void>
  refreshSessionWorkspace: (
    sessionId: SessionId | null,
    selection?: SessionWorkspaceSelection,
  ) => Promise<void>
  setActiveSessionTree: (tree: SessionTree | null) => void
  setActiveWorkspace: (workspace: SessionWorkspace | null) => void
  setDraftBranch: (draftBranch: DraftBranchState | null) => void
  clearDraftBranchForSession: (sessionId: SessionId) => void
  refreshSessionsAndTree: (sessionId: SessionId | null) => Promise<void>
  refreshSessionsAndWorkspace: (
    sessionId: SessionId | null,
    selection?: SessionWorkspaceSelection,
  ) => Promise<void>
  clearError: () => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionTree: null,
  activeWorkspace: null,
  draftBranch: null,
  error: null,

  async loadSessions() {
    try {
      const sessions = await api.listSessions()
      set({ sessions, error: null })
    } catch (err) {
      handleStoreError(err, 'load sessions', (error) => set({ error }))
    }
  },

  async refreshSessionTree(sessionId) {
    latestTreeRequestId += 1
    const requestId = latestTreeRequestId
    if (!sessionId) {
      latestWorkspaceRequestId += 1
      set({ activeSessionTree: null, activeWorkspace: null })
      return
    }

    try {
      const activeSessionTree = await api.getSessionTree(sessionId)
      if (requestId !== latestTreeRequestId) {
        return
      }
      if (activeSessionTree && activeSessionTree.session.id !== sessionId) {
        return
      }
      set({ activeSessionTree, error: null })
    } catch (err) {
      handleStoreError(err, 'refresh session tree', (error) => set({ error }))
    }
  },

  async refreshSessionWorkspace(sessionId, selection) {
    latestWorkspaceRequestId += 1
    const requestId = latestWorkspaceRequestId
    if (!sessionId) {
      latestTreeRequestId += 1
      set({ activeSessionTree: null, activeWorkspace: null })
      return
    }

    try {
      const activeWorkspace = await api.getSessionWorkspace(sessionId, selection)
      if (requestId !== latestWorkspaceRequestId) {
        return
      }
      if (activeWorkspace && activeWorkspace.tree.session.id !== sessionId) {
        return
      }
      set({
        activeWorkspace,
        activeSessionTree: activeWorkspace?.tree ?? null,
        error: null,
      })
    } catch (err) {
      handleStoreError(err, 'refresh session workspace', (error) => set({ error }))
    }
  },

  setActiveSessionTree(tree) {
    set({ activeSessionTree: tree })
  },

  setActiveWorkspace(workspace) {
    set({ activeWorkspace: workspace, activeSessionTree: workspace?.tree ?? null })
  },

  setDraftBranch(draftBranch) {
    set({ draftBranch })
  },

  clearDraftBranchForSession(sessionId) {
    set((state) => ({
      draftBranch: state.draftBranch?.sessionId === sessionId ? null : state.draftBranch,
    }))
  },

  async refreshSessionsAndTree(sessionId) {
    await get().loadSessions()
    await get().refreshSessionTree(sessionId)
  },

  async refreshSessionsAndWorkspace(sessionId, selection) {
    await get().loadSessions()
    await get().refreshSessionWorkspace(sessionId, selection)
  },

  clearError() {
    set({ error: null })
  },
}))
