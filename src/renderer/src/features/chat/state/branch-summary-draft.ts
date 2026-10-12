import type { PreparedAttachment } from '@shared/types/agent'
import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import {
  buildComposerDraftContextKey,
  buildPendingSessionDraftContextKey,
} from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { setComposerTextValue } from '../lib/composer-text'
import { type BranchSummaryPromptState, useBranchSummaryStore } from './branch-summary-store'
import { useChatStore } from './chat-store'

/** Where the composer keeps the message being written on a prompt's draft branch. */
export function draftBranchComposerContextKey(prompt: BranchSummaryPromptState) {
  return buildComposerDraftContextKey({
    projectPath: prompt.projectPath,
    sessionId: prompt.sessionId,
    draftSourceNodeId: prompt.sourceNodeId,
  })
}

function joined(first: string, second: string) {
  return first && second ? `${first}\n\n${second}` : first || second
}

function distinct(attachments: readonly PreparedAttachment[]) {
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()]
}

/**
 * The message being written stays under the prompt's draft branch as the view leaves it, as when
 * no summary is offered: while the prompt is open the composer may show the summary's
 * instructions, or nothing once they were sent, which are never kept in its place.
 */
function keepMessageOnDraftBranch(prompt: BranchSummaryPromptState) {
  const store = useComposerStore.getState()
  const draftKey = draftBranchComposerContextKey(prompt)
  if (store.activeDraftContextKey === draftKey) {
    // The composer files what it shows under the draft branch as the view leaves it.
    setComposerTextValue(prompt.draftComposerText)
    return
  }
  const saved = store.getScopedDraft(draftKey)
  if (saved && saved.input !== prompt.draftComposerText) {
    store.saveScopedDraft(draftKey, { ...saved, input: prompt.draftComposerText })
  }
}

/** Where the view lands for the prompt's Session: its shown branch, or before it is shown. */
function landingKey(prompt: BranchSummaryPromptState, workspace: SessionWorkspace | null) {
  if (workspace?.tree.session.id !== prompt.sessionId) {
    return buildPendingSessionDraftContextKey(prompt.sessionId)
  }
  return buildComposerDraftContextKey({
    projectPath: workspace.tree.session.projectPath,
    sessionId: prompt.sessionId,
    activeBranchId: workspace.activeBranchId,
    activeNodeId: workspace.activeNodeId,
  })
}

/** What is left on the prompt's draft branch besides its message: shown, or saved there. */
function leftOnDraftBranch(prompt: BranchSummaryPromptState) {
  const store = useComposerStore.getState()
  const draftKey = draftBranchComposerContextKey(prompt)
  if (store.activeDraftContextKey === draftKey) {
    return { shown: true, attachments: store.attachments, wagglePreset: store.selectedWagglePreset }
  }
  const saved = store.getScopedDraft(draftKey)
  if (!saved) return null
  return { shown: false, attachments: saved.attachments, wagglePreset: saved.wagglePreset }
}

/**
 * The view of the prompt's draft branch ends, as for a summary saved but not shown: its message,
 * with its attachments, goes to the branch the view lands on, after a draft not sent there yet.
 */
export function moveBranchSummaryDraftToLanding(
  prompt: BranchSummaryPromptState,
  /** The Session's workspace where the view lands; the one shown unless another is given. */
  landing: SessionWorkspace | null = useSessionStore.getState().activeWorkspace,
) {
  const store = useComposerStore.getState()
  const left = leftOnDraftBranch(prompt)
  if (!left) return
  const target = landingKey(prompt, landing)
  if (left.shown) {
    // Emptied, the composer leaves nothing under the draft branch, not even a Waggle preset.
    store.replaceAttachments([])
    store.setSelectedWagglePreset(null)
    setComposerTextValue('')
  }
  store.clearScopedDraft(draftBranchComposerContextKey(prompt))
  const shown = useComposerStore.getState()
  if (shown.activeDraftContextKey === target) {
    // The view is there already: the composer shows the message after what it holds.
    shown.replaceAttachments(distinct([...shown.attachments, ...left.attachments]))
    setComposerTextValue(joined(shown.input, prompt.draftComposerText))
    return
  }
  const existing = store.getScopedDraft(target)
  store.saveScopedDraft(target, {
    input: joined(existing?.input ?? '', prompt.draftComposerText),
    attachments: distinct([...(existing?.attachments ?? []), ...left.attachments]),
    wagglePreset: left.wagglePreset ?? existing?.wagglePreset ?? null,
  })
}

function keepMessageOf(prompt: BranchSummaryPromptState) {
  if (useChatStore.getState().missingSessionIds.has(prompt.sessionId)) {
    // The Host removed the Session meanwhile, and its message went to New session with it.
    useComposerStore.getState().clearScopedDraft(draftBranchComposerContextKey(prompt))
    return
  }
  keepMessageOnDraftBranch(prompt)
}

/**
 * A summary whose prompt something else cleared meanwhile, as the view leaving its draft branch:
 * the message stays under the draft branch. A prompt opened meanwhile owns the view, and is left
 * alone.
 */
export function keepLeftBranchSummaryDraft(prompt: BranchSummaryPromptState) {
  const current = useBranchSummaryStore.getState().prompt
  if (current !== null && current !== prompt) return
  keepMessageOf(prompt)
  if (current === prompt) useBranchSummaryStore.getState().clearPrompt()
}

/** Closes the branch summary prompt as the view leaves its draft branch, keeping its message. */
export function leaveBranchSummaryPrompt() {
  const prompt = useBranchSummaryStore.getState().prompt
  if (prompt) keepMessageOnDraftBranch(prompt)
  useBranchSummaryStore.getState().clearPrompt()
}

/** The view leaves the draft branch, as for another Session or project: its message is kept. */
export function leaveBranchSummaryDraftContext() {
  leaveBranchSummaryPrompt()
  const sessions = useSessionStore.getState()
  if (sessions.draftBranch) sessions.clearDraftBranchForSession(sessions.draftBranch.sessionId)
}

/**
 * Shows the draft branch from `sourceNodeId` in the composer. The message left on the draft
 * branch shown before stays there; with a prompt open the composer shows the summary's
 * instructions in its place, which are not kept.
 */
export function switchComposerToDraftBranch(input: {
  readonly projectPath: string | null
  readonly sessionId: SessionId
  readonly sourceNodeId: SessionNodeId
  readonly fallbackText: string
}) {
  const contextKey = buildComposerDraftContextKey({
    projectPath: input.projectPath,
    sessionId: input.sessionId,
    draftSourceNodeId: input.sourceNodeId,
  })
  const prompt = useBranchSummaryStore.getState().prompt
  // Shown again as the same draft branch, the composer gives back the message, not instructions.
  if (prompt) keepMessageOnDraftBranch(prompt)
  const composer = useComposerStore.getState()
  const leftDraft = prompt
    ? {
        input: prompt.draftComposerText,
        attachments: composer.attachments,
        wagglePreset: composer.selectedWagglePreset,
      }
    : undefined
  const appliedDraft = composer.switchScopedDraftContext(
    contextKey,
    { input: input.fallbackText, attachments: [] },
    leftDraft,
  )
  setComposerTextValue(appliedDraft.input)
  return appliedDraft.input
}
