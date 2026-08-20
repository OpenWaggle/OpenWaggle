import type { RepositoryPath, SessionId } from '@shared/types/brand'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import { useEffect } from 'react'
import { useBranchSummaryStore } from '@/features/chat/state'
import { resolvePinnedDropNeighbours } from '../lib/pinned-sessions'
import { usePinnedSessionsStore } from '../state/pinned-sessions-store'
import { createSidebarBranchActions } from './sidebar-branch-actions'
import { createSidebarProjectActions } from './sidebar-project-actions'
import { createSidebarSessionActions } from './sidebar-session-actions'
import { useSidebarState } from './useSidebarState'

function createDomainActions(
  state: ReturnType<typeof useSidebarState>,
  clearTransientDraftContext: () => void,
  refreshGit: (path: RepositoryPath | null) => void,
  refreshAfterSessionMutation: (sessionId: SessionId) => Promise<void>,
) {
  const session = createSidebarSessionActions({
    activeSessionId: state.activeSessionId,
    clearTransientDraftContext,
    deleteSession: state.chat.deleteSession,
    loadChatSessions: state.chat.loadSessions,
    loadSessionTrees: state.sessions.loadSessions,
    matchingActiveSessionTree: state.matchingActiveSessionTree,
    matchingActiveWorkspace: state.matchingActiveWorkspace,
    navigate: state.navigate,
    projectPath: state.project.projectPath,
    refreshSessionWorkspace: state.sessions.refreshSessionWorkspace,
    selectedModel: state.preferences.selectedModel,
    showToast: state.showToast,
    startDraftSession: state.chat.startDraftSession,
    togglePin(sessionId: SessionId) {
      const store = usePinnedSessionsStore.getState()
      const isPinned = store.pins.some((pin) => String(pin.sessionId) === String(sessionId))
      void (isPinned ? store.unpinSession(sessionId) : store.pinSession(sessionId))
    },
  })
  const branch = createSidebarBranchActions({
    activeBranchId: state.activeBranchId,
    activeSessionId: state.activeSessionId,
    archiveSession: session.archive,
    clearDraftBranchForSession: state.sessions.clearDraftBranchForSession,
    navigate: state.navigate,
    refreshAfterSessionMutation,
    refreshSessionWorkspace: state.sessions.refreshSessionWorkspace,
    selectedModel: state.preferences.selectedModel,
    sessions: state.sessions.sessions,
    showToast: state.showToast,
  })
  const project = createSidebarProjectActions({
    activeSessionId: state.activeSessionId ? String(state.activeSessionId) : null,
    clearTransientDraftContext,
    displayProjectName: state.displayProjectName,
    expandProject(path) {
      state.setProjectExpanded(path, true)
    },
    loadChatSessions: state.chat.loadSessions,
    loadSessionTrees: state.sessions.loadSessions,
    navigate: state.navigate,
    projectPath: state.project.projectPath,
    refreshGit,
    removeProjectReferences: state.preferences.removeProjectReferences,
    selectFolder: state.project.selectFolder,
    sessions: state.sessions.sessions,
    setProjectDisplayName: state.preferences.setProjectDisplayName,
    setProjectPath: state.project.setProjectPath,
    showToast: state.showToast,
    startDraftSession: state.chat.startDraftSession,
  })

  return { branch, project, session }
}

function buildControllerOutput(
  state: ReturnType<typeof useSidebarState>,
  actions: ReturnType<typeof createDomainActions>,
  clearTransientDraftContext: () => void,
) {
  return {
    ...state,
    draftBranch: state.sessions.draftBranch,
    draftSessionProjectPath: state.chat.draftSession?.projectPath ?? null,
    handleArchiveBranch: actions.branch.archive,
    handleArchiveProjectSessions: actions.project.archiveSessions,
    handleArchiveSession: actions.session.archive,
    handleCloneSession: actions.session.clone,
    handleDeleteSession: actions.session.delete,
    handleNewSession() {
      clearTransientDraftContext()
      state.chat.startDraftSession(state.project.projectPath)
      void state.navigate({ to: '/' })
    },
    handleOpenProject: actions.project.openProject,
    handleOpenProjectInFinder: actions.project.openInFinder,
    handleOpenSettings() {
      void state.navigate({ to: '/settings' })
    },
    handleOpenSkills() {
      void state.navigate({ to: '/skills' })
    },
    handleRemoveProject: actions.project.remove,
    handleRenameBranch: actions.branch.rename,
    handleRenameProject: actions.project.rename,
    handleSelectBranch: actions.branch.select,
    handleSelectProjectPath: actions.project.selectProjectPath,
    handleSelectSession: actions.session.select,
    handleToggleBranches: actions.branch.toggle,
    handleTogglePinnedSession: actions.session.togglePin,
    handleToggleProjectCollapsed(path: string) {
      state.toggleProjectExpanded(path)
    },
    /**
     * Commit a Pinned section drag. Neighbours are resolved from the rendered rows, so a
     * drop expresses "between these two" rather than an index the main process would have
     * to reinterpret.
     */
    handleReorderPinnedSession(sessionId: SessionId, targetIndex: number) {
      const neighbours = resolvePinnedDropNeighbours(
        state.pinnedRows,
        String(sessionId),
        targetIndex,
      )
      void usePinnedSessionsStore.getState().movePin(sessionId, neighbours)
    },
    projectPath: state.project.projectPath,
  }
}

export function useSidebarController() {
  const state = useSidebarState()
  const loadPins = usePinnedSessionsStore((s) => s.loadPins)

  useEffect(() => {
    void loadPins()
  }, [loadPins])

  function refreshGit(path: RepositoryPath | null) {
    // A project switch: branches are repository-level, and with no session context the
    // working tree is the checkout itself. resolveSessionWorkingDir stays the sole
    // WorkingPath producer rather than coercing the repository path directly.
    void Promise.all([
      state.git.refreshStatus(resolveSessionWorkingDir(null, path)),
      state.git.refreshBranches(path),
    ])
  }

  function clearTransientDraftContext() {
    useBranchSummaryStore.getState().clearPrompt()
    if (state.sessions.draftBranch) {
      state.sessions.clearDraftBranchForSession(state.sessions.draftBranch.sessionId)
    }
  }

  async function refreshAfterSessionMutation(sessionId: SessionId) {
    await state.sessions.loadSessions()
    await state.sessions.refreshSessionTree(sessionId)
  }

  const actions = createDomainActions(
    state,
    clearTransientDraftContext,
    refreshGit,
    refreshAfterSessionMutation,
  )
  return buildControllerOutput(state, actions, clearTransientDraftContext)
}
