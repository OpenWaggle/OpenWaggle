import type { SessionId } from '@shared/types/brand'
import type { SessionFollowUpEdit, SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { useBranchSummaryStore } from '@/features/chat/state'
import { draftActivity, draftBusyReason } from '../state/composer-activity-store'
import { retainHostReferencedAttachments } from '../state/composer-attachment-lifecycle'
import type { ComposerScopedDraft } from '../state/composer-store-types'
import {
  isOpenQueuedMessageEdit,
  type OpenQueuedMessageEdit,
  type QueuedMessageEdit,
  selectQueuedMessageEdit,
  useQueuedMessageEditStore,
} from '../state/queued-message-edit-store'
import { attachmentLimitMessage, attachmentLimitReason } from './composer-submission-support'
import {
  clearStashedDraft,
  focusVisibleEditor,
  queuedMessageDraft,
  readComposerDraft,
  readStashedDraft,
  stashDraftAndLoad,
  visibleSessionDraftContext,
  writeComposerDraft,
} from './queued-message-edit-drafts'
import { BEGIN_BLOCK_COPY, SAVE_BUSY_COPY } from './queued-message-edit-messages'

export function storedEdit(sessionId: SessionId) {
  return selectQueuedMessageEdit(String(sessionId))(useQueuedMessageEditStore.getState())
}

export function currentEdit(sessionId: SessionId) {
  const edit = storedEdit(sessionId)
  return isOpenQueuedMessageEdit(edit) ? edit : null
}

/** After an await: the edit this call started from is still the one the store holds. */
export function stillHolds(sessionId: SessionId, holdId: string) {
  return currentEdit(sessionId)?.based.holdId === holdId
}

export function setEdit(sessionId: SessionId, edit: QueuedMessageEdit | null) {
  useQueuedMessageEditStore.getState().setEdit(String(sessionId), edit)
}

function blocked(message: string) {
  return { kind: 'blocked', message } as const
}

/**
 * Why an edit of this Session's visible draft cannot begin now, with the reason to show, or the
 * draft to begin in. Work in flight for that draft must finish first: it would land in, or clear,
 * the draft the edit takes over.
 */
export function beginTarget(sessionId: SessionId) {
  if (storedEdit(sessionId)) return blocked(BEGIN_BLOCK_COPY.editing)
  const contextKey = visibleSessionDraftContext(String(sessionId))
  if (!contextKey || contextKey.endsWith(':pending')) {
    return blocked(BEGIN_BLOCK_COPY.loading)
  }
  const busy = draftBusyReason(draftActivity(contextKey))
  if (busy) return blocked(BEGIN_BLOCK_COPY[busy])
  if (useBranchSummaryStore.getState().prompt !== null) {
    return blocked(BEGIN_BLOCK_COPY['branch-summary'])
  }
  return { kind: 'ready', contextKey } as const
}

/** Why the draft cannot be saved now (`message` to show, unless there is nothing to save). */
export function saveBlock(contextKey: string, draft: ComposerScopedDraft) {
  if (!draft.input.trim() && draft.attachments.length === 0) return { message: null } as const
  const busy = draftBusyReason(draftActivity(contextKey))
  if (busy) return { message: SAVE_BUSY_COPY[busy] } as const
  const limit = attachmentLimitReason(draft.attachments)
  return limit ? ({ message: attachmentLimitMessage(limit) } as const) : null
}

/** The draft still says exactly what the queued message says (Escape can discard it at once). */
export function isUnchangedEdit(draft: ComposerScopedDraft, item: SessionFollowUpQueueItem) {
  const ids = draft.attachments.map((attachment) => attachment.id)
  return (
    draft.input.trim() === item.text.trim() &&
    ids.length === item.attachments.length &&
    item.attachments.every((attachment, index) => attachment.id === ids[index]) &&
    (draft.wagglePreset?.id ?? null) === (item.waggle?.presetId ?? null)
  )
}

/** Ends the edit: `draft` replaces the edited content, then the stash is released. */
function endEdit(sessionId: SessionId, open: OpenQueuedMessageEdit, draft: ComposerScopedDraft) {
  writeComposerDraft(open.contextKey, draft)
  clearStashedDraft(String(sessionId))
  setEdit(sessionId, null)
  focusVisibleEditor(open.contextKey)
}

export function restoreStashedDraft(sessionId: SessionId, open: OpenQueuedMessageEdit) {
  endEdit(sessionId, open, readStashedDraft(String(sessionId)))
}

function mergeText(edited: string, stashed: string) {
  if (!stashed.trim()) return edited
  return edited ? `${edited}\n\n${stashed}` : stashed
}

function mergeAttachments(
  first: ComposerScopedDraft['attachments'],
  second: ComposerScopedDraft['attachments'],
) {
  return [
    ...new Map([...first, ...second].map((attachment) => [attachment.id, attachment])).values(),
  ]
}

/**
 * The edit can no longer be saved into its message: keep what the user wrote, out of edit mode,
 * together with the set-aside draft. The Host keeps attachments an edit named bindable for a
 * while after the hold is gone, so the edit's attachments come along (protected until their chips
 * leave the composer).
 */
export function keepEditAsDraft(sessionId: SessionId, open: OpenQueuedMessageEdit) {
  const edited = readComposerDraft(open.contextKey)
  const stashed = readStashedDraft(String(sessionId))
  retainHostReferencedAttachments(edited.attachments)
  endEdit(sessionId, open, {
    input: mergeText(edited.input.trim(), stashed.input),
    attachments: mergeAttachments(edited.attachments, stashed.attachments),
    wagglePreset: edited.wagglePreset ?? stashed.wagglePreset ?? null,
  })
}

/**
 * Opens edit mode for an edit this user holds, one just begun or one adopted, in the draft
 * `contextKey`. The draft there is set aside first unless an earlier stash is still waiting.
 */
export function openEdit(sessionId: SessionId, contextKey: string, based: SessionFollowUpEdit) {
  retainHostReferencedAttachments(based.item.attachments)
  stashDraftAndLoad(String(sessionId), contextKey, queuedMessageDraft(based.item))
  setEdit(sessionId, { phase: 'editing', followUpId: based.followUpId, contextKey, based })
  focusVisibleEditor(contextKey)
}

/** A fresh hold on the same message: keep the user's draft as it is and edit on from the new base. */
export function continueEdit(
  sessionId: SessionId,
  open: OpenQueuedMessageEdit,
  based: SessionFollowUpEdit,
) {
  retainHostReferencedAttachments(based.item.attachments)
  setEdit(sessionId, { ...open, phase: 'editing', based })
  focusVisibleEditor(open.contextKey)
}
