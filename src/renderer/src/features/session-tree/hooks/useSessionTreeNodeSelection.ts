import type { SupportedModelId } from '@shared/types/brand'
import type {
  SessionTranscriptNode,
  SessionTree,
  SessionTreeNode,
  SessionWorkspace,
} from '@shared/types/session'
import { useNavigate } from '@tanstack/react-router'
import {
  createBranchDraftSelectionFromNode,
  isSessionModelActionable,
  maybeOpenBranchSummaryPrompt,
  setComposerTextValue,
} from '@/features/chat/lib'
import { useBranchSummaryStore } from '@/features/chat/state'
import { buildComposerDraftContextKey } from '@/features/composer/lib'
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

function switchComposerToDraftBranch(input: {
  readonly projectPath: string | null
  readonly sessionId: SessionTreeNode['sessionId']
  readonly sourceNodeId: SessionTreeNode['id']
  readonly fallbackText: string
}) {
  const contextKey = buildComposerDraftContextKey({
    projectPath: input.projectPath,
    sessionId: input.sessionId,
    draftSourceNodeId: input.sourceNodeId,
  })
  const appliedDraft = useComposerStore.getState().switchScopedDraftContext(contextKey, {
    input: input.fallbackText,
    attachments: [],
  })
  setComposerTextValue(appliedDraft.input)
  return appliedDraft.input
}

export function useSessionTreeNodeSelection(input: SessionTreeNodeSelectionInput) {
  const navigate = useNavigate()
  const setDraftBranch = useSessionStore((state) => state.setDraftBranch)
  const clearDraftBranchForSession = useSessionStore((state) => state.clearDraftBranchForSession)
  const refreshSessionWorkspace = useSessionStore((state) => state.refreshSessionWorkspace)

  function selectMaterializedBranch(
    node: SessionTreeNode,
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

    useBranchSummaryStore.getState().clearPrompt()
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

  /**
   * A branch drafted from a user message is prefilled with its text, which the tree does not carry
   * (B5): read the one entry from the Host first. Any other node drafts at once.
   */
  function selectDraftBranch(node: SessionTreeNode) {
    if (node.kind !== 'user_message' || !node.hasMessage || 'message' in node) {
      draftBranchFrom(node)
      return
    }
    void api
      .getSessionWorkspace(node.sessionId, { nodeId: node.id }, { window: { minEntries: 1 } })
      .catch(() => null)
      .then((workspace) => {
        const entry = workspace?.transcriptPath.at(-1)
        draftBranchFrom(entry?.node.id === node.id && entry.node.message ? entry.node : node)
      })
  }

  function draftBranchFrom(node: SessionTranscriptNode) {
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

  function selectNode(node: SessionTreeNode) {
    const materializedBranch = input.tree?.branches.find((branch) => branch.headNodeId === node.id)
    if (materializedBranch) {
      selectMaterializedBranch(node, materializedBranch)
      return
    }
    selectDraftBranch(node)
  }

  return { selectNode }
}
