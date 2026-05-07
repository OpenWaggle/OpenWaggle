import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { useBranchSummaryStore } from '@/stores/branch-summary-store'
import { useSessionStore } from '@/stores/session-store'
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

  if (!shouldPromptForBranchSummary(input.activeWorkspace, input.sourceNodeId)) {
    return
  }

  function openIfCurrent(): void {
    const currentState = useSessionStore.getState()
    const currentDraft = currentState.draftBranch
    const currentWorkspace = currentState.activeWorkspace
    if (
      !currentDraft ||
      currentDraft.sessionId !== input.sessionId ||
      currentDraft.sourceNodeId !== input.sourceNodeId ||
      currentWorkspace?.tree.session.id !== input.sessionId
    ) {
      return
    }
    useBranchSummaryStore.getState().openPrompt({
      sessionId: input.sessionId,
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
    .getPiBranchSummarySkipPrompt(
      input.activeWorkspace?.tree.session.projectPath ?? input.projectPath,
    )
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
