import type { SupportedModelId } from '@shared/types/brand'
import type { SessionNode, SessionTree, SessionWorkspace } from '@shared/types/session'
import { useNavigate } from '@tanstack/react-router'
import {
  createBranchDraftSelectionFromNode,
  isSessionModelActionable,
  maybeOpenBranchSummaryPrompt,
} from '@/features/chat/lib'
import { leaveBranchSummaryPrompt, switchComposerToDraftBranch } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { api } from '@/shared/lib/ipc'
import { sessionOperationFailureMessage } from '@/shared/lib/session-operation-failure'

interface SessionTreeNodeSelectionInput {
  readonly activeWorkspace: SessionWorkspace | null
  readonly selectedModel: SupportedModelId | undefined
  readonly showToast: (message: string) => void
  readonly tree: SessionTree | null
}

export function useSessionTreeNodeSelection(input: SessionTreeNodeSelectionInput) {
  const navigate = useNavigate()
  const setDraftBranch = useSessionStore((state) => state.setDraftBranch)
  const clearDraftBranchForSession = useSessionStore((state) => state.clearDraftBranchForSession)
  const refreshSessionWorkspace = useSessionStore((state) => state.refreshSessionWorkspace)

  function selectMaterializedBranch(
    node: SessionNode,
    branchId: NonNullable<SessionTree['branches'][number]>,
  ) {
    const tree = input.tree
    if (!tree) {
      return
    }
    if (!isSessionModelActionable(tree.session.id, input.selectedModel)) {
      input.showToast('Select a model before switching branches.')
      return
    }

    leaveBranchSummaryPrompt()
    clearDraftBranchForSession(tree.session.id)
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(tree.session.id) },
      search: (previous) => ({
        ...previous,
        branch: String(branchId.id),
        node: String(node.id),
      }),
    })
    void api
      .navigateSessionTree(tree.session.id, input.selectedModel, node.id, { summarize: false })
      .catch((error: unknown) => {
        input.showToast(sessionOperationFailureMessage('Failed to switch session branch', error))
      })
      .finally(() => {
        void refreshSessionWorkspace(tree.session.id, {
          branchId: branchId.id,
          nodeId: node.id,
        })
      })
  }

  function selectDraftBranch(node: SessionNode) {
    const tree = input.tree
    if (!tree) {
      return
    }

    const sessionId = tree.session.id
    const previousComposerText = useComposerStore.getState().input
    const selection = createBranchDraftSelectionFromNode(node)
    const fallbackDraftText = selection.prefillText ?? ''
    setDraftBranch({ sessionId, sourceNodeId: selection.sourceNodeId })
    const draftComposerText = switchComposerToDraftBranch({
      projectPath: tree.session.projectPath ?? null,
      sessionId,
      sourceNodeId: selection.sourceNodeId,
      fallbackText: fallbackDraftText,
    })
    maybeOpenBranchSummaryPrompt({
      sessionId,
      sourceNodeId: selection.sourceNodeId,
      restoreSelection: {
        branchId: input.activeWorkspace?.activeBranchId ?? null,
        nodeId: input.activeWorkspace?.activeNodeId ?? null,
      },
      previousComposerText,
      draftComposerText,
      activeWorkspace: input.activeWorkspace,
      projectPath: tree.session.projectPath ?? null,
    })
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(sessionId) },
      search: (previous) => ({
        ...previous,
        branch: undefined,
        node: String(selection.routeNodeId),
      }),
    })
    void refreshSessionWorkspace(sessionId, { nodeId: selection.routeNodeId })
  }

  function selectNode(node: SessionNode) {
    const materializedBranch = input.tree?.branches.find((branch) => branch.headNodeId === node.id)
    if (materializedBranch) {
      selectMaterializedBranch(node, materializedBranch)
      return
    }
    selectDraftBranch(node)
  }

  return { selectNode }
}
