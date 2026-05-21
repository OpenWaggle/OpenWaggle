import type {
  SessionBranchId,
  SessionId,
  SessionNodeId,
  SupportedModelId,
} from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import type { useNavigate } from '@tanstack/react-router'
import { useChatStore } from '@/features/chat/state/chat-store'
import { buildComposerDraftContextKey } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { api } from '@/shared/lib/ipc'
import { setComposerTextValue } from '../lib/composer-text'
import { type BranchSummaryPromptState, useBranchSummaryStore } from '../state/branch-summary-store'

type Navigate = ReturnType<typeof useNavigate>

interface BranchSummaryWorkflowParams {
  readonly activeSessionId: SessionId | null
  readonly activeWorkspace: SessionWorkspace | null
  readonly model: SupportedModelId
  readonly projectPath: string | null
  readonly navigate: Navigate
  readonly loadSessions: () => Promise<void>
  readonly refreshSession: (sessionId: SessionId) => Promise<void>
  readonly refreshSessionWorkspace: (
    sessionId: SessionId,
    selection?: {
      readonly branchId?: SessionBranchId | null
      readonly nodeId?: SessionNodeId | null
    },
  ) => Promise<void>
  readonly clearDraftBranchForSession: (sessionId: SessionId) => void
  readonly showToast: (message: string) => void
}

interface DraftBranchComposerInput {
  readonly sessionId: SessionId
  readonly sourceNodeId: SessionNodeId
  readonly fallbackText: string
}

function draftBranchComposerContextKey(
  params: BranchSummaryWorkflowParams,
  sessionId: SessionId,
  sourceNodeId: SessionNodeId,
) {
  return buildComposerDraftContextKey({
    projectPath: params.activeWorkspace?.tree.session.projectPath ?? params.projectPath,
    sessionId,
    draftSourceNodeId: sourceNodeId,
  })
}

function routeToSessionSelection(
  params: BranchSummaryWorkflowParams,
  sessionId: SessionId,
  selection: { readonly branchId?: SessionBranchId | null; readonly nodeId?: SessionNodeId | null },
) {
  void params.navigate({
    to: '/sessions/$sessionId',
    params: { sessionId: String(sessionId) },
    search: (previous) => ({
      ...previous,
      branch: selection.branchId ? String(selection.branchId) : undefined,
      node: selection.nodeId ? String(selection.nodeId) : undefined,
    }),
  })
}

function isCurrentBranchSummaryPrompt(prompt: BranchSummaryPromptState) {
  const currentPrompt = useBranchSummaryStore.getState().prompt
  const currentWorkspace = useSessionStore.getState().activeWorkspace
  const currentSessionId = useChatStore.getState().activeSessionId
  return (
    currentPrompt?.sessionId === prompt.sessionId &&
    currentPrompt.sourceNodeId === prompt.sourceNodeId &&
    currentPrompt.previousComposerText === prompt.previousComposerText &&
    currentPrompt.draftComposerText === prompt.draftComposerText &&
    currentPrompt.mode === 'summarizing' &&
    currentWorkspace?.tree.session.id === prompt.sessionId &&
    String(currentSessionId) === String(prompt.sessionId)
  )
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

function switchComposerToDraftBranch(
  params: BranchSummaryWorkflowParams,
  input: DraftBranchComposerInput,
) {
  const contextKey = draftBranchComposerContextKey(params, input.sessionId, input.sourceNodeId)
  const appliedDraft = useComposerStore.getState().switchScopedDraftContext(contextKey, {
    input: input.fallbackText,
    attachments: [],
  })
  setComposerTextValue(appliedDraft.input)
  return appliedDraft.input
}

async function refreshAfterBranchSummary(
  params: BranchSummaryWorkflowParams,
  prompt: BranchSummaryPromptState,
) {
  await Promise.all([
    params.loadSessions(),
    params.refreshSession(prompt.sessionId),
    params.refreshSessionWorkspace(prompt.sessionId),
  ])
}

function applySummarizedBranchDraft(
  params: BranchSummaryWorkflowParams,
  prompt: BranchSummaryPromptState,
) {
  const workspace = useSessionStore.getState().activeWorkspace
  if (!workspace) return null

  const contextKey = buildComposerDraftContextKey({
    projectPath: workspace.tree.session.projectPath,
    sessionId: prompt.sessionId,
    activeBranchId: workspace.activeBranchId,
    activeNodeId: workspace.activeNodeId,
  })
  const appliedDraft = useComposerStore
    .getState()
    .switchScopedDraftContext(
      contextKey,
      { input: prompt.draftComposerText, attachments: [] },
      { input: prompt.draftComposerText, attachments: useComposerStore.getState().attachments },
    )
  useComposerStore
    .getState()
    .clearScopedDraft(draftBranchComposerContextKey(params, prompt.sessionId, prompt.sourceNodeId))
  setComposerTextValue(appliedDraft.input)
  return workspace
}

async function navigateWithBranchSummary(
  params: BranchSummaryWorkflowParams,
  prompt: BranchSummaryPromptState,
  customInstructions: string | undefined,
) {
  const trimmedInstructions = customInstructions?.trim()
  return api.navigateSessionTree(prompt.sessionId, params.model, prompt.sourceNodeId, {
    summarize: true,
    ...(trimmedInstructions ? { customInstructions: trimmedInstructions } : {}),
  })
}

async function finishBranchSummary(
  params: BranchSummaryWorkflowParams,
  prompt: BranchSummaryPromptState,
) {
  useBranchSummaryStore.getState().clearPrompt()
  params.clearDraftBranchForSession(prompt.sessionId)
  await refreshAfterBranchSummary(params, prompt)
  if (String(useChatStore.getState().activeSessionId) !== String(prompt.sessionId)) return

  const workspace = applySummarizedBranchDraft(params, prompt)
  routeToSessionSelection(params, prompt.sessionId, {
    branchId: workspace?.activeBranchId ?? null,
    nodeId: workspace?.activeNodeId ?? null,
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
  const prompt = useBranchSummaryStore.getState().prompt
  if (!prompt) return

  const previousMode = prompt.mode
  useBranchSummaryStore.getState().startSummarizing()

  try {
    const navigation = await navigateWithBranchSummary(params, prompt, customInstructions)
    if (!isCurrentBranchSummaryPrompt(prompt)) return
    if (navigation.cancelled) {
      params.showToast('Branch summarization cancelled.')
      cancelBranchSummary(prompt, previousMode)
      return
    }

    await finishBranchSummary(params, prompt)
  } catch (error) {
    if (!isCurrentBranchSummaryPrompt(prompt)) return
    params.showToast(error instanceof Error ? error.message : String(error))
    restoreBranchSummaryChoice(prompt, previousMode)
  }
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
        projectPath: params.activeWorkspace?.tree.session.projectPath ?? params.projectPath,
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
      useComposerStore
        .getState()
        .clearScopedDraft(
          draftBranchComposerContextKey(params, prompt.sessionId, prompt.sourceNodeId),
        )
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
      return switchComposerToDraftBranch(params, input)
    },
  }
}
