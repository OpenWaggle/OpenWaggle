import { SessionBranchId, type SessionId, SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionWorkspace } from '@shared/types/session'
import { type useNavigate, useRouterState, useSearch } from '@tanstack/react-router'
import { useLayoutEffect, useRef } from 'react'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { api } from '@/shared/lib/ipc'
import { type BranchDraftSelection, createBranchDraftSelection } from '../lib/branch-from-message'
import { maybeOpenBranchSummaryPrompt } from '../lib/branch-summary-prompt-controller'
import { useChatStore } from '../state/chat-store'
import type { useBranchSummaryWorkflow } from './useBranchSummaryWorkflow'

interface BranchFromMessageParams {
  readonly activeSessionId: SessionId | null
  readonly activeWorkspace: SessionWorkspace | null
  readonly messages: readonly UIMessage[]
  readonly projectPath: string | null
  readonly navigate: ReturnType<typeof useNavigate>
  readonly refreshSessionWorkspace: (
    sessionId: SessionId,
    selection?: {
      readonly branchId?: SessionBranchId | null
      readonly nodeId?: SessionNodeId | null
    },
  ) => Promise<void>
  readonly switchComposerToDraftBranch: ReturnType<
    typeof useBranchSummaryWorkflow
  >['switchComposerToDraftBranch']
  readonly showToast: (message: string) => void
}

function applyBranchSelection(
  params: BranchFromMessageParams,
  sessionId: SessionId,
  workspace: SessionWorkspace,
  selection: BranchDraftSelection,
) {
  const previousComposerText = useComposerStore.getState().input
  useSessionStore.getState().setDraftBranch({ sessionId, sourceNodeId: selection.sourceNodeId })
  const draftComposerText = params.switchComposerToDraftBranch({
    sessionId,
    sourceNodeId: selection.sourceNodeId,
    fallbackText: selection.prefillText ?? '',
    projectPath: workspace.tree.session.projectPath,
  })
  maybeOpenBranchSummaryPrompt({
    sessionId,
    sourceNodeId: selection.sourceNodeId,
    restoreSelection: {
      branchId: workspace.activeBranchId,
      nodeId: workspace.activeNodeId,
    },
    previousComposerText,
    draftComposerText,
    activeWorkspace: workspace,
    projectPath: params.projectPath,
  })
  void params.navigate({
    to: '/sessions/$sessionId',
    params: { sessionId: String(sessionId) },
    search: (previous) => ({ ...previous, branch: undefined, node: String(selection.routeNodeId) }),
  })
  void params.refreshSessionWorkspace(sessionId, { nodeId: selection.routeNodeId })
}

export function useBranchFromMessage(params: BranchFromMessageParams) {
  const href = useRouterState({ select: (state) => state.location.href })
  const search = useSearch({ strict: false })
  const requestVersion = useRef(0)
  const sessionId = params.activeSessionId
  const scopeRef = useRef<{
    readonly sessionId: SessionId | null
    readonly href: string
    active: boolean
  } | null>(null)
  useLayoutEffect(() => {
    // Hydration must not cancel the click waiting for it; navigation must.
    const scope = { sessionId, href, active: true }
    scopeRef.current = scope
    return () => {
      scope.active = false
    }
  }, [href, sessionId])

  return function handleBranchFromMessage(messageId: string) {
    if (!sessionId || useChatStore.getState().activeSessionId !== sessionId) return
    const scope = scopeRef.current
    const version = ++requestVersion.current
    const draftBranch = useSessionStore.getState().draftBranch
    const workspace =
      params.activeWorkspace?.tree.session.id === sessionId ? params.activeWorkspace : null
    const selection = createBranchDraftSelection({
      messages: params.messages,
      workspace,
      messageId,
    })
    if (workspace && selection) {
      applyBranchSelection(params, sessionId, workspace, selection)
      return
    }

    function isCurrent() {
      return (
        requestVersion.current === version &&
        scope?.active === true &&
        useChatStore.getState().activeSessionId === sessionId &&
        useSessionStore.getState().draftBranch === draftBranch
      )
    }

    // Read without publishing a workspace: a late result must never replace a
    // different Session or cursor selected while this action was pending.
    void api
      .getSessionWorkspace(sessionId, {
        branchId: search.branch ? SessionBranchId(search.branch) : undefined,
        nodeId: search.node ? SessionNodeId(search.node) : undefined,
      })
      .then((resolvedWorkspace) => {
        if (!isCurrent()) return
        const resolvedSelection =
          resolvedWorkspace?.tree.session.id === sessionId
            ? createBranchDraftSelection({
                messages: params.messages,
                workspace: resolvedWorkspace,
                messageId,
              })
            : null
        if (!resolvedWorkspace || !resolvedSelection) {
          params.showToast(
            'Branch source is not available yet. Wait for the transcript to finish loading and try again.',
          )
          return
        }
        applyBranchSelection(params, sessionId, resolvedWorkspace, resolvedSelection)
      })
      .catch((error: unknown) => {
        if (isCurrent())
          params.showToast(
            `Failed to load branch source: ${error instanceof Error ? error.message : String(error)}`,
          )
      })
  }
}
