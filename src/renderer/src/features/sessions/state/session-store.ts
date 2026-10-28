import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type {
  SessionSummary,
  SessionTree,
  SessionWorkspace,
  SessionWorkspaceSelection,
} from '@shared/types/session'
import { create } from 'zustand'
import { createRendererLogger } from '@/shared/lib/logger'
import {
  createSessionCatalogState,
  type SessionCatalogState,
} from './session-catalog-store-actions'
import { createSessionWorkspaceReads } from './session-workspace-reads'

const _logger = createRendererLogger('session-store')

function retitleSummaries(
  summaries: readonly SessionSummary[],
  sessionId: SessionId,
  title: string,
) {
  if (!summaries.some((summary) => summary.id === sessionId && summary.title !== title)) {
    return summaries
  }
  return summaries.map((summary) => (summary.id === sessionId ? { ...summary, title } : summary))
}

function retitleTree(tree: SessionTree | null, sessionId: SessionId, title: string) {
  if (tree?.session.id !== sessionId || tree.session.title === title) return tree
  return { ...tree, session: { ...tree.session, title } }
}

function applySessionTitleToState(state: SessionState, sessionId: SessionId, title: string) {
  const activeWorkspace = state.activeWorkspace
  const workspaceTree = activeWorkspace ? retitleTree(activeWorkspace.tree, sessionId, title) : null
  return {
    sessions: retitleSummaries(state.sessions, sessionId, title),
    archivedSessions: retitleSummaries(state.archivedSessions, sessionId, title),
    hiveSessions: retitleSummaries(state.hiveSessions, sessionId, title),
    activeSessionTree: retitleTree(state.activeSessionTree, sessionId, title),
    activeWorkspace:
      activeWorkspace && workspaceTree && workspaceTree !== activeWorkspace.tree
        ? { ...activeWorkspace, tree: workspaceTree }
        : activeWorkspace,
  }
}

export interface DraftBranchState {
  readonly sessionId: SessionId
  readonly sourceNodeId: SessionNodeId
}

export interface SessionState extends SessionCatalogState {
  activeSessionTree: SessionTree | null
  activeWorkspace: SessionWorkspace | null
  draftBranch: DraftBranchState | null
  error: string | null
  refreshSessionTree: (sessionId: SessionId | null) => Promise<void>
  refreshSessionWorkspace: (
    sessionId: SessionId | null,
    selection?: SessionWorkspaceSelection,
  ) => Promise<void>
  /**
   * The workspace a view shows: read unless this window already shows it or is reading it. A
   * refresh after a change uses `refreshSessionWorkspace`, which always reads.
   */
  showSessionWorkspace: (
    sessionId: SessionId | null,
    selection?: SessionWorkspaceSelection,
  ) => Promise<void>
  /** Reads the next older page of the shown transcript window from the Host (ADR 0036). */
  loadEarlierTranscript: (sessionId: SessionId) => Promise<void>
  /** Reads the shown transcript window back to `nodeId`, for a saved reading position. */
  loadTranscriptThrough: (sessionId: SessionId, nodeId: SessionNodeId) => Promise<void>
  setActiveSessionTree: (tree: SessionTree | null) => void
  setActiveWorkspace: (workspace: SessionWorkspace | null) => void
  setDraftBranch: (draftBranch: DraftBranchState | null) => void
  clearDraftBranchForSession: (sessionId: SessionId) => void
  /**
   * Patch one Session's title wherever this store holds it, without reloading or touching
   * `updatedAt`, so a title change never moves the Session in the sidebar.
   */
  applySessionTitle: (sessionId: SessionId, title: string) => void
  refreshSessionsAndTree: (sessionId: SessionId | null) => Promise<void>
  refreshSessionsAndWorkspace: (
    sessionId: SessionId | null,
    selection?: SessionWorkspaceSelection,
  ) => Promise<void>
  clearError: () => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  ...createSessionCatalogState(set, get),
  activeSessionTree: null,
  activeWorkspace: null,
  draftBranch: null,
  error: null,

  ...createSessionWorkspaceReads(set, get),

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

  applySessionTitle(sessionId, title) {
    set((state) => applySessionTitleToState(state, sessionId, title))
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
