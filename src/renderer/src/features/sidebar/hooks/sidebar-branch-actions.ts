import type { SupportedModelId } from '@shared/types/brand'
import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type {
  SessionBranch,
  SessionSummary,
  SessionTree,
  SessionWorkspaceSelection,
} from '@shared/types/session'
import type { useNavigate } from '@tanstack/react-router'
import { useBranchSummaryStore, useChatStore } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import { errorMessage } from './sidebar-action-utils'

type Navigate = ReturnType<typeof useNavigate>

interface SidebarBranchActionDeps {
  readonly activeBranchId: SessionTree['session']['lastActiveBranchId']
  readonly activeSessionId: SessionId | null
  readonly archiveSession: (sessionId: SessionId) => void
  readonly clearDraftBranchForSession: (sessionId: SessionId) => void
  readonly navigate: Navigate
  readonly refreshAfterSessionMutation: (sessionId: SessionId) => Promise<void>
  readonly refreshSessionWorkspace: (
    sessionId: SessionId | null,
    selection?: SessionWorkspaceSelection,
  ) => Promise<void>
  readonly selectedModel: SupportedModelId | undefined
  /** The global settings default — the fallback for a target session that never picked. */
  readonly defaultModel: SupportedModelId
  readonly sessions: readonly SessionSummary[]
  readonly showToast: (message: string) => void
}

function navigateToSessionBranch(
  deps: SidebarBranchActionDeps,
  sessionId: string,
  branch: SessionBranch,
) {
  const targetBranchId = String(branch.id)
  const headNodeId = branch.headNodeId ? String(branch.headNodeId) : null

  void deps.navigate({
    to: '/sessions/$sessionId',
    params: { sessionId },
    search: (previous) => {
      const { node: _node, ...rest } = previous
      return headNodeId
        ? { ...rest, branch: targetBranchId, node: headNodeId }
        : { ...rest, branch: targetBranchId }
    },
  })

  return { headNodeId, targetBranchId }
}

function refreshBranchWorkspace(
  deps: SidebarBranchActionDeps,
  sessionId: SessionId,
  branchId: string,
  nodeId: SessionNodeId,
) {
  void deps.refreshSessionWorkspace(sessionId, {
    branchId: SessionBranchId(branchId),
    nodeId,
  })
}

function switchSessionBranch(
  deps: SidebarBranchActionDeps,
  sessionId: string,
  branch: SessionBranch,
) {
  const targetSessionId = SessionId(sessionId)
  const { headNodeId, targetBranchId } = navigateToSessionBranch(deps, sessionId, branch)

  useBranchSummaryStore.getState().clearPrompt()
  if (deps.activeSessionId) deps.clearDraftBranchForSession(deps.activeSessionId)
  deps.clearDraftBranchForSession(targetSessionId)
  useChatStore.getState().setActiveSession(targetSessionId)

  if (!headNodeId) return

  const targetNodeId = SessionNodeId(headNodeId)
  // Switching branches must not retarget the run to whatever model the last-touched session used:
  // resolve the target session's own pick, falling back to the global default (deps.defaultModel,
  // not deps.selectedModel — that is the active session's resolved model, not this target's).
  const targetSession = deps.sessions.find((item) => String(item.id) === sessionId)
  void api
    .navigateSessionTree(
      targetSessionId,
      targetSession?.selectedModel ?? deps.defaultModel,
      targetNodeId,
      { summarize: false },
    )
    .catch((error: unknown) => {
      deps.showToast(`Failed to switch session branch: ${errorMessage(error)}`)
    })
    .finally(() => refreshBranchWorkspace(deps, targetSessionId, targetBranchId, targetNodeId))
}

function navigateToMainBranchAfterArchive(deps: SidebarBranchActionDeps, sessionId: string) {
  const session = deps.sessions.find((item) => String(item.id) === sessionId)
  const mainBranch = session?.branches?.find((branch) => branch.isMain)
  if (mainBranch) {
    switchSessionBranch(deps, sessionId, mainBranch)
    return
  }

  void deps.navigate({ to: '/sessions/$sessionId', params: { sessionId } })
}

export function createSidebarBranchActions(deps: SidebarBranchActionDeps) {
  return {
    archive(sessionId: string, branch: SessionBranch) {
      const targetSessionId = SessionId(sessionId)
      if (branch.isMain) {
        deps.archiveSession(targetSessionId)
        return
      }

      void api
        .archiveSessionBranch(targetSessionId, branch.id)
        .then(() =>
          useComposerStore.getState().clearScopedDraftsForBranch(sessionId, String(branch.id)),
        )
        .then(() => deps.refreshAfterSessionMutation(targetSessionId))
        .then(() => {
          if (deps.activeBranchId === branch.id) navigateToMainBranchAfterArchive(deps, sessionId)
        })
        .catch((error: unknown) => {
          deps.showToast(`Failed to archive branch: ${errorMessage(error)}`)
        })
    },
    rename(sessionId: string, branch: SessionBranch, name: string) {
      const targetSessionId = SessionId(sessionId)
      void api
        .renameSessionBranch(targetSessionId, branch.id, name)
        .then(() => deps.refreshAfterSessionMutation(targetSessionId))
        .catch((error: unknown) => {
          deps.showToast(`Failed to rename branch: ${errorMessage(error)}`)
        })
    },
    select(sessionId: string, branch: SessionBranch) {
      switchSessionBranch(deps, sessionId, branch)
    },
    toggle(sessionId: SessionId, collapsed: boolean) {
      void api
        .updateSessionTreeUiState(sessionId, { branchesSidebarCollapsed: collapsed })
        .then(() => deps.refreshAfterSessionMutation(sessionId))
        .catch((error: unknown) => {
          deps.showToast(`Failed to update branch list: ${errorMessage(error)}`)
        })
    },
  }
}
