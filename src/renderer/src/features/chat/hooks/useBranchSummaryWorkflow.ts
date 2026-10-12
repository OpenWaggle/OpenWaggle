import type { SessionId, SessionNodeId } from '@shared/types/brand'
import { buildComposerDraftContextKey } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import { sessionOperationFailureMessage } from '@/shared/lib/session-operation-failure'
import { setComposerTextValue } from '../lib/composer-text'
import { isSessionModelActionable } from '../lib/session-answered-by'
import { type BranchSummaryPromptState, useBranchSummaryStore } from '../state/branch-summary-store'
import {
  type BranchSummaryWorkflowParams,
  draftBranchComposerContextKey,
  finishBranchSummary,
  isCurrentBranchSummaryPrompt,
  leaveSavedBranchSummary,
  routeToSessionSelection,
} from './useBranchSummaryWorkflow.finish'

interface DraftBranchComposerInput {
  readonly sessionId: SessionId
  readonly sourceNodeId: SessionNodeId
  readonly fallbackText: string
  readonly projectPath: string | null
}

function restoreBranchSummaryChoice(
  prompt: BranchSummaryPromptState,
  previousMode: BranchSummaryPromptState['mode'],
) {
  if (previousMode === 'custom') {
    useBranchSummaryStore.getState().startCustomPrompt(prompt.draftComposerText)
    return
  }
  useBranchSummaryStore.getState().restoreChoice()
}

function switchComposerToDraftBranch(input: DraftBranchComposerInput) {
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

async function navigateWithBranchSummary(
  params: BranchSummaryWorkflowParams,
  prompt: BranchSummaryPromptState,
  customInstructions: string | undefined,
) {
  if (!isSessionModelActionable(prompt.sessionId, params.model)) {
    return { cancelled: true }
  }
  const trimmedInstructions = customInstructions?.trim()
  return api.navigateSessionTree(prompt.sessionId, params.model, prompt.sourceNodeId, {
    summarize: true,
    ...(trimmedInstructions ? { customInstructions: trimmedInstructions } : {}),
  })
}

function cancelBranchSummary(
  prompt: BranchSummaryPromptState,
  previousMode: BranchSummaryPromptState['mode'],
) {
  restoreBranchSummaryChoice(prompt, previousMode)
}

async function materializeBranchSummaryAction(
  params: BranchSummaryWorkflowParams,
  customInstructions?: string,
) {
  const initialPrompt = useBranchSummaryStore.getState().prompt
  if (!initialPrompt) return

  const previousMode = initialPrompt.mode
  useBranchSummaryStore.getState().startSummarizing()
  const prompt = useBranchSummaryStore.getState().prompt
  if (!prompt) return

  const navigation = await navigateWithBranchSummary(params, prompt, customInstructions).catch(
    (error: unknown) => {
      if (!isCurrentBranchSummaryPrompt(prompt)) return null
      params.showToast(sessionOperationFailureMessage('Failed to summarize the branch', error))
      restoreBranchSummaryChoice(prompt, previousMode)
      return null
    },
  )
  if (!navigation || !isCurrentBranchSummaryPrompt(prompt)) return
  if (navigation.cancelled) {
    params.showToast('Branch summarization cancelled.')
    cancelBranchSummary(prompt, previousMode)
    return
  }
  await finishBranchSummary(params, prompt).catch((error: unknown) => {
    leaveSavedBranchSummary(params, prompt, error)
  })
}

export function useBranchSummaryWorkflow(params: BranchSummaryWorkflowParams) {
  return {
    async materializeBranchSummary(customInstructions?: string) {
      await materializeBranchSummaryAction(params, customInstructions)
    },
    async materializeDraftBranchForSend(
      draftBranch: { readonly sessionId: SessionId; readonly sourceNodeId: SessionNodeId } | null,
    ) {
      if (!params.activeSessionId) return true
      if (draftBranch?.sessionId !== params.activeSessionId) return true
      if (!params.model) return true

      const navigation = await api.navigateSessionTree(
        params.activeSessionId,
        params.model,
        draftBranch.sourceNodeId,
      )
      if (navigation.cancelled) {
        params.showToast('Branch source is no longer available.')
        return false
      }
      await params.refreshSessionWorkspace(params.activeSessionId, {
        nodeId: draftBranch.sourceNodeId,
      })
      return true
    },
    cancelBranchSummary() {
      const prompt = useBranchSummaryStore.getState().prompt
      if (!prompt) return
      const restoreContextKey = buildComposerDraftContextKey({
        projectPath: prompt.projectPath,
        sessionId: prompt.sessionId,
        activeBranchId: prompt.restoreSelection.branchId,
        activeNodeId: prompt.restoreSelection.nodeId,
      })
      const appliedDraft = useComposerStore
        .getState()
        .switchScopedDraftContext(
          restoreContextKey,
          { input: prompt.previousComposerText, attachments: [] },
          { input: '', attachments: [] },
        )
      useComposerStore.getState().clearScopedDraft(draftBranchComposerContextKey(prompt))
      useBranchSummaryStore.getState().clearPrompt()
      params.clearDraftBranchForSession(prompt.sessionId)
      setComposerTextValue(appliedDraft.input)
      routeToSessionSelection(params, prompt.sessionId, prompt.restoreSelection)
      void params.refreshSessionWorkspace(prompt.sessionId, prompt.restoreSelection)
    },
    skipBranchSummary() {
      const prompt = useBranchSummaryStore.getState().prompt
      if (!prompt) return
      useBranchSummaryStore.getState().clearPrompt()
      setComposerTextValue(prompt.draftComposerText)
    },
    startCustomBranchSummary() {
      const prompt = useBranchSummaryStore.getState().prompt
      if (!prompt) return
      useBranchSummaryStore.getState().startCustomPrompt(useComposerStore.getState().input)
      setComposerTextValue('')
    },
    switchComposerToDraftBranch(input: DraftBranchComposerInput) {
      return switchComposerToDraftBranch(input)
    },
  }
}
