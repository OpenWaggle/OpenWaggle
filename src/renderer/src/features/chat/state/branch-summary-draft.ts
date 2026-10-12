import type { PreparedAttachment } from '@shared/types/agent'
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
 * The message being written on the prompt's draft branch, with its attachments, kept as the draft
 * its Session owns before its workspace is shown, so the composer moves it to the branch the
 * view lands on. While the prompt is open the composer may show the summary's instructions, or
 * nothing once they were sent; those are not kept. Nothing is kept once the message left the
 * draft branch.
 */
export function keepBranchSummaryDraft(prompt: BranchSummaryPromptState) {
  const store = useComposerStore.getState()
  const draftKey = draftBranchComposerContextKey(prompt)
  const shown = store.activeDraftContextKey === draftKey
  const saved = shown ? null : store.getScopedDraft(draftKey)
  if (!shown && !saved) return
  const pendingKey = buildPendingSessionDraftContextKey(prompt.sessionId)
  const pending = store.getScopedDraft(pendingKey)
  const attachments = shown ? store.attachments : (saved?.attachments ?? [])
  store.saveScopedDraft(pendingKey, {
    input: joined(pending?.input ?? '', prompt.draftComposerText),
    attachments: distinct([...(pending?.attachments ?? []), ...attachments]),
    wagglePreset: (shown ? store.selectedWagglePreset : saved?.wagglePreset) ?? null,
  })
  if (shown) {
    store.replaceAttachments([])
    setComposerTextValue('')
  }
  store.clearScopedDraft(draftKey)
}

function keepMessageOf(prompt: BranchSummaryPromptState) {
  const draftKey = draftBranchComposerContextKey(prompt)
  if (useChatStore.getState().missingSessionIds.has(prompt.sessionId)) {
    // The Host removed the Session meanwhile, and its message went to New session with it.
    useComposerStore.getState().clearScopedDraft(draftKey)
    return
  }
  if (useComposerStore.getState().activeDraftContextKey === draftKey) {
    // Still on its draft branch: the message is shown again in place of the instructions.
    setComposerTextValue(prompt.draftComposerText)
    return
  }
  keepBranchSummaryDraft(prompt)
}

/**
 * A summary whose prompt something else cleared meanwhile, as the view leaving its draft branch:
 * the message stays the Session's. A prompt opened meanwhile owns the view, and is left alone.
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
  if (prompt) keepBranchSummaryDraft(prompt)
  useBranchSummaryStore.getState().clearPrompt()
}

/** The view leaves the draft branch, as for another Session or project: its message is kept. */
export function leaveBranchSummaryDraftContext() {
  leaveBranchSummaryPrompt()
  const sessions = useSessionStore.getState()
  if (sessions.draftBranch) sessions.clearDraftBranchForSession(sessions.draftBranch.sessionId)
}
