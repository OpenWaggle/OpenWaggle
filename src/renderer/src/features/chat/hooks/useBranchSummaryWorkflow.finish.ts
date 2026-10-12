import { ATTACHMENT } from '@shared/constants/resource-limits'
import type {
  SessionBranchId,
  SessionId,
  SessionNodeId,
  SupportedModelId,
} from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import type { useNavigate } from '@tanstack/react-router'
import { useChatStore } from '@/features/chat/state/chat-store'
import {
  buildComposerDraftContextKey,
  buildPendingSessionDraftContextKey,
} from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { sessionOperationFailureMessage } from '@/shared/lib/session-operation-failure'
import { setComposerTextValue } from '../lib/composer-text'
import { type BranchSummaryPromptState, useBranchSummaryStore } from '../state/branch-summary-store'

// Where a branch summary lands once Pi saved it: shown on its branch, or left there.

type Navigate = ReturnType<typeof useNavigate>

export interface BranchSummaryWorkflowParams {
  readonly activeSessionId: SessionId | null
  readonly activeWorkspace: SessionWorkspace | null
  readonly model: SupportedModelId | undefined
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

export function draftBranchComposerContextKey(prompt: BranchSummaryPromptState) {
  return buildComposerDraftContextKey({
    projectPath: prompt.projectPath,
    sessionId: prompt.sessionId,
    draftSourceNodeId: prompt.sourceNodeId,
  })
}

export function routeToSessionSelection(
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

export function isCurrentBranchSummaryPrompt(prompt: BranchSummaryPromptState) {
  const currentPrompt = useBranchSummaryStore.getState().prompt
  const currentDraft = useSessionStore.getState().draftBranch
  const currentSessionId = useChatStore.getState().activeSessionId
  return (
    currentPrompt === prompt &&
    prompt.mode === 'summarizing' &&
    currentDraft?.sessionId === prompt.sessionId &&
    currentDraft.sourceNodeId === prompt.sourceNodeId &&
    String(currentSessionId) === String(prompt.sessionId)
  )
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
  if (workspace?.tree.session.id !== prompt.sessionId) {
    throw new Error('The summarized branch workspace is not available. Please try again.')
  }

  const contextKey = buildComposerDraftContextKey({
    projectPath: workspace.tree.session.projectPath,
    sessionId: prompt.sessionId,
    activeBranchId: workspace.activeBranchId,
    activeNodeId: workspace.activeNodeId,
  })
  const sourceAttachments = useComposerStore.getState().attachments
  const appliedDraft = useComposerStore
    .getState()
    .switchScopedDraftContext(
      contextKey,
      { input: prompt.draftComposerText, attachments: sourceAttachments },
      { input: prompt.draftComposerText, attachments: sourceAttachments },
    )
  const attachments = [
    ...new Map(
      [...appliedDraft.attachments, ...sourceAttachments].map((attachment) => [
        attachment.id,
        attachment,
      ]),
    ).values(),
  ]
  if (attachments.length !== appliedDraft.attachments.length) {
    useComposerStore.getState().replaceAttachments(attachments)
  }
  const exceedsCount = attachments.length > ATTACHMENT.MAX_COUNT
  const exceedsSize =
    attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0) >
    ATTACHMENT.MAX_TOTAL_SIZE_BYTES
  if (exceedsCount) {
    params.showToast('Your draft has too many attachments to send. Remove some before retrying.')
  }
  if (!exceedsCount && exceedsSize) {
    params.showToast('Your draft exceeds the 20 MB attachment limit. Remove some before retrying.')
  }
  useComposerStore.getState().clearScopedDraft(draftBranchComposerContextKey(prompt))
  setComposerTextValue(appliedDraft.input)
  return workspace
}

export async function finishBranchSummary(
  params: BranchSummaryWorkflowParams,
  prompt: BranchSummaryPromptState,
) {
  await refreshAfterBranchSummary(params, prompt)
  if (!isCurrentBranchSummaryPrompt(prompt)) return

  const workspace = applySummarizedBranchDraft(params, prompt)
  useBranchSummaryStore.getState().clearPrompt()
  params.clearDraftBranchForSession(prompt.sessionId)
  routeToSessionSelection(params, prompt.sessionId, {
    branchId: workspace.activeBranchId,
    nodeId: workspace.activeNodeId,
  })
}

/**
 * The message being written on the draft branch, kept for the Session as a draft it owns before
 * its workspace is shown, so the composer moves it to the branch the view lands on. The composer
 * shows the summary's instructions or choice meanwhile, which are not kept.
 */
function keepDraftForSession(prompt: BranchSummaryPromptState) {
  const store = useComposerStore.getState()
  store.saveScopedDraft(buildPendingSessionDraftContextKey(prompt.sessionId), {
    input: prompt.draftComposerText,
    attachments: store.attachments,
    wagglePreset: store.selectedWagglePreset,
  })
  store.replaceAttachments([])
  setComposerTextValue('')
  store.clearScopedDraft(draftBranchComposerContextKey(prompt))
}

/**
 * The summary is saved, but showing it failed: it is not offered again, which would save a second
 * one. While the Session is read again the prompt stays summarizing, which keeps the composer
 * disabled; then, if nothing moved the view meanwhile, it goes where the summary left it, on its
 * saved branch, with the message being written. Otherwise the message stays where it is.
 */
export async function leaveSavedBranchSummary(
  params: BranchSummaryWorkflowParams,
  prompt: BranchSummaryPromptState,
  error: unknown,
) {
  if (!isCurrentBranchSummaryPrompt(prompt)) return
  params.showToast(
    sessionOperationFailureMessage(
      'The branch summary was saved, but it could not be shown',
      error,
    ),
  )
  await Promise.allSettled([
    params.loadSessions(),
    params.refreshSession(prompt.sessionId),
    params.refreshSessionWorkspace(prompt.sessionId),
  ])
  if (!isCurrentBranchSummaryPrompt(prompt)) {
    // A prompt opened meanwhile is another's; this one, left summarizing, would stay stuck.
    if (useBranchSummaryStore.getState().prompt === prompt) {
      useBranchSummaryStore.getState().clearPrompt()
    }
    return
  }
  keepDraftForSession(prompt)
  useBranchSummaryStore.getState().clearPrompt()
  params.clearDraftBranchForSession(prompt.sessionId)
  routeToSessionSelection(params, prompt.sessionId, {})
}
