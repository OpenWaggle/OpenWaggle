import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import { useChatStore } from '@/features/chat/state/chat-store'
import { useSessionStore } from '@/features/sessions/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { shouldPromptForBranchSummary } from './branch-from-message'

const logger = createRendererLogger('branch-summary-prompt')

interface BranchSummaryPromptSelection {
  readonly branchId: SessionBranchId | null
  readonly nodeId: SessionNodeId | null
}

export interface BranchSummaryPromptOpenRequest {
  readonly sessionId: SessionId
  readonly sourceNodeId: SessionNodeId
  readonly restoreSelection: BranchSummaryPromptSelection
  readonly previousComposerText: string
  readonly draftComposerText: string
  readonly activeWorkspace: SessionWorkspace | null
  readonly projectPath: string | null
}

export function maybeOpenBranchSummaryPrompt(input: BranchSummaryPromptOpenRequest): void {
  useBranchSummaryStore.getState().clearPrompt()

  const workspace = input.activeWorkspace
  if (
    workspace?.tree.session.id !== input.sessionId ||
    !shouldPromptForBranchSummary(workspace, input.sourceNodeId)
  ) {
    return
  }
  const projectPath = workspace.tree.session.projectPath
  const originatingDraft = useSessionStore.getState().draftBranch

  function openIfCurrent() {
    const currentState = useSessionStore.getState()
    const currentDraft = currentState.draftBranch
    if (
      !currentDraft ||
      currentDraft !== originatingDraft ||
      currentDraft.sessionId !== input.sessionId ||
      currentDraft.sourceNodeId !== input.sourceNodeId ||
      useChatStore.getState().activeSessionId !== input.sessionId
    ) {
      return
    }
    useBranchSummaryStore.getState().openPrompt({
      sessionId: input.sessionId,
      projectPath,
      sourceNodeId: input.sourceNodeId,
      restoreSelection: input.restoreSelection,
      previousComposerText: input.previousComposerText,
      draftComposerText: input.draftComposerText,
    })
  }

  if (typeof api.getPiBranchSummarySkipPrompt !== 'function') {
    openIfCurrent()
    return
  }

  void api
    .getPiBranchSummarySkipPrompt(projectPath)
    .then((skipPrompt) => {
      if (!skipPrompt) {
        openIfCurrent()
      }
    })
    .catch((skipPromptError: unknown) => {
      const message =
        skipPromptError instanceof Error ? skipPromptError.message : String(skipPromptError)
      logger.warn('Failed to load branch summary skip-prompt preference', { message })
      openIfCurrent()
    })
}
