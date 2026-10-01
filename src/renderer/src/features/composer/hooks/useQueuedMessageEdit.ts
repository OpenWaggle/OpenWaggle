import type { SessionId } from '@shared/types/brand'
import { useEffect, useEffectEvent } from 'react'
import {
  isLostFollowUpEdit,
  type SessionFollowUpEdit,
  type SessionFollowUpQueueItem,
  useSessionFollowUpQueue,
} from '@/features/chat/hooks'
import { useBranchSummaryStore } from '@/features/chat/state'
import { isComposerBusy } from '../state/composer-activity-store'
import {
  releaseHostReferencedAttachments,
  retainHostReferencedAttachments,
} from '../state/composer-attachment-lifecycle'
import { useComposerStore } from '../state/composer-store'
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
  editedWaggle,
  focusVisibleEditor,
  queuedMessageDraft,
  readComposerDraft,
  readStashedDraft,
  stashDraftAndLoad,
  visibleSessionDraftContext,
  writeComposerDraft,
} from './queued-message-edit-drafts'
import {
  beginFailureMessage,
  errorMessage,
  LOST_EDIT_MESSAGE,
  saveFailureMessage,
} from './queued-message-edit-messages'

function mergeText(edited: string, stashed: string) {
  if (!stashed.trim()) return edited
  return edited ? `${edited}\n\n${stashed}` : stashed
}

function storedEdit(sessionId: SessionId) {
  return selectQueuedMessageEdit(String(sessionId))(useQueuedMessageEditStore.getState())
}

function currentEdit(sessionId: SessionId) {
  const edit = storedEdit(sessionId)
  return isOpenQueuedMessageEdit(edit) ? edit : null
}

/** After an await: the edit this call started from is still the one the store holds. */
function stillHolds(sessionId: SessionId, holdId: string) {
  return currentEdit(sessionId)?.based.holdId === holdId
}

function setEdit(sessionId: SessionId, edit: QueuedMessageEdit | null) {
  useQueuedMessageEditStore.getState().setEdit(String(sessionId), edit)
}

/** Composer work in flight that an edit must not interleave with (see `composer-activity-store`). */
export function editBlockedByComposer() {
  return isComposerBusy() || useBranchSummaryStore.getState().prompt !== null
}

/**
 * Ends the edit: `draft` replaces the edited content, the stash is released after it, and the
 * Host-referenced chips stop being protected once they have left the composer (a lost edit kept as
 * a new draft keeps them, and their protection, until they leave too).
 */
function endEdit(sessionId: SessionId, open: OpenQueuedMessageEdit, draft: ComposerScopedDraft) {
  const leaving = readComposerDraft(open.contextKey).attachments
  writeComposerDraft(open.contextKey, draft)
  clearStashedDraft(String(sessionId))
  const staying = new Set(draft.attachments.map((attachment) => attachment.id))
  releaseHostReferencedAttachments(
    [...open.based.item.attachments, ...leaving].filter(
      (attachment) => !staying.has(attachment.id),
    ),
  )
  setEdit(sessionId, null)
  focusVisibleEditor(open.contextKey)
}

function restoreStashedDraft(sessionId: SessionId, open: OpenQueuedMessageEdit) {
  endEdit(sessionId, open, readStashedDraft(String(sessionId)))
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
 * A lost edit cannot be saved: keep what the user wrote, out of edit mode, so it can be sent as a
 * new message, together with the set-aside draft. The Host keeps attachments an edit named
 * bindable for a while after the hold is gone, so the edit's attachments come along.
 */
function keepLostEditAsDraft(
  sessionId: SessionId,
  open: OpenQueuedMessageEdit,
  edited: ComposerScopedDraft,
) {
  const stashed = readStashedDraft(String(sessionId))
  // Still Host-referenced, so composer cleanup must not discard them if their chips are removed.
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
function openEdit(sessionId: SessionId, contextKey: string, based: SessionFollowUpEdit) {
  retainHostReferencedAttachments(based.item.attachments)
  stashDraftAndLoad(String(sessionId), contextKey, queuedMessageDraft(based.item))
  setEdit(sessionId, { phase: 'editing', followUpId: based.followUpId, contextKey, based })
  focusVisibleEditor(contextKey)
}

/** Why the draft cannot be saved right now, or null. Mirrors what sending checks. */
function saveBlock(draft: ComposerScopedDraft) {
  if (!draft.input.trim() && draft.attachments.length === 0) return { silent: true } as const
  if (isComposerBusy()) return { silent: true } as const
  const limit = attachmentLimitReason(draft.attachments)
  return limit ? ({ silent: false, message: attachmentLimitMessage(limit) } as const) : null
}

/**
 * Editing a queued message in the composer (ADR 0043). The only adapter to the Follow-up edit
 * API of `useSessionFollowUpQueue`.
 *
 * Beginning an edit takes a Host hold, sets the composer's draft aside, and loads the queued
 * message in its place; saving or cancelling releases the hold and brings the draft back. The edit
 * is kept per Session and bound to one draft, so leaving and returning reopens it.
 */
export function useQueuedMessageEdit(
  sessionId: SessionId | null,
  onToast: (message: string) => void,
) {
  const queue = useSessionFollowUpQueue(sessionId)
  const edit = useQueuedMessageEditStore(
    selectQueuedMessageEdit(sessionId ? String(sessionId) : null),
  )
  const visibleKey = useComposerStore((state) => state.activeDraftContextKey)
  const isVisible = edit !== null && edit.contextKey === visibleKey

  async function begin(followUpId: string) {
    if (!sessionId || storedEdit(sessionId) || editBlockedByComposer()) return
    const contextKey = visibleSessionDraftContext(String(sessionId))
    if (!contextKey || contextKey.endsWith(':pending')) return
    setEdit(sessionId, { phase: 'beginning', followUpId, contextKey })
    let opened: SessionFollowUpEdit
    try {
      opened = await queue.beginEdit(followUpId)
    } catch (error) {
      setEdit(sessionId, null)
      onToast(beginFailureMessage(error))
      return
    }
    const pending = storedEdit(sessionId)
    if (pending?.phase !== 'beginning' || pending.followUpId !== followUpId) {
      // Superseded while the Host answered: do not leave the hold behind.
      await queue.cancelEdit(opened).catch(() => undefined)
      return
    }
    openEdit(sessionId, contextKey, opened)
  }

  async function save() {
    if (!sessionId) return
    const open = currentEdit(sessionId)
    if (open?.phase !== 'editing' || open.contextKey !== visibleKey) return
    const draft = readComposerDraft(open.contextKey)
    const block = saveBlock(draft)
    if (block) {
      if (!block.silent) onToast(block.message)
      return
    }
    setEdit(sessionId, { ...open, phase: 'saving' })
    const { waggle, visualizationContext } = open.based.item
    const nextWaggle = editedWaggle(draft.wagglePreset ?? null, waggle)
    try {
      await queue.saveEdit(open.based, {
        text: draft.input.trim(),
        attachments: draft.attachments,
        ...(nextWaggle ? { waggle: nextWaggle } : {}),
        ...(visualizationContext ? { visualizationContext } : {}),
      })
    } catch (error) {
      if (stillHolds(sessionId, open.based.holdId)) handleSaveFailure(sessionId, draft, open, error)
      return
    }
    if (!stillHolds(sessionId, open.based.holdId)) return
    // The queued message now carries these; they must not be discarded while leaving the composer.
    retainHostReferencedAttachments(draft.attachments)
    restoreStashedDraft(sessionId, open)
  }

  function handleSaveFailure(
    id: SessionId,
    draft: ComposerScopedDraft,
    open: OpenQueuedMessageEdit,
    error: unknown,
  ) {
    if (isLostFollowUpEdit(error)) {
      keepLostEditAsDraft(id, open, draft)
      onToast(LOST_EDIT_MESSAGE)
      return
    }
    // Still held: the Host keeps every attachment the edit named, so retry with the edit as is.
    setEdit(id, { ...open, phase: 'editing' })
    onToast(saveFailureMessage(error))
  }

  async function cancel() {
    if (!sessionId) return
    const open = currentEdit(sessionId)
    if (open?.phase !== 'editing') return
    setEdit(sessionId, { ...open, phase: 'cancelling' })
    try {
      await queue.cancelEdit(open.based)
    } catch (error) {
      // A lost hold has nothing left to release.
      if (!isLostFollowUpEdit(error)) {
        if (stillHolds(sessionId, open.based.holdId))
          setEdit(sessionId, { ...open, phase: 'editing' })
        onToast(errorMessage(error))
        return
      }
    }
    if (stillHolds(sessionId, open.based.holdId)) restoreStashedDraft(sessionId, open)
  }

  /** Withdrawing the message being edited ends the edit: there is nothing left to save into. */
  function endWithdrawnEdit(followUpId: string) {
    if (!sessionId) return
    const open = currentEdit(sessionId)
    if (open?.phase !== 'editing' || open.followUpId !== followUpId) return
    restoreStashedDraft(sessionId, open)
  }

  return {
    edit,
    isVisible,
    /** The queue waits on an edit (any window's): an explicit Waggle must queue behind it. */
    waitingOnEdit: queue.snapshot.waitingOnEdit,
    begin,
    save,
    cancel,
    endWithdrawnEdit,
  }
}

/** A message this user holds for editing, which an edit could be re-adopted for. */
function isOwnHold(item: SessionFollowUpQueueItem) {
  return (
    item.editable && item.editHold?.heldByCurrentUser === true && item.editHold.holdId !== undefined
  )
}

/**
 * Never leaves an orphan hold. When the queue shows a message this user holds for editing but
 * this window has no edit open for it (the composer remounted, an error boundary reset it, or the
 * renderer state was rebuilt), the composer re-adopts the edit into its visible draft. Retried
 * whenever the visible draft changes, so a draft that was not ready yet adopts once it is. Mount
 * once per Session composer; this is the only place an edit is adopted.
 */
export function useAdoptHeldQueuedMessageEdit(sessionId: SessionId | null) {
  const queue = useSessionFollowUpQueue(sessionId)
  const edit = useQueuedMessageEditStore(
    selectQueuedMessageEdit(sessionId ? String(sessionId) : null),
  )
  const visibleKey = useComposerStore((state) => state.activeDraftContextKey)
  const orphan = edit === null ? queue.snapshot.items.find(isOwnHold) : undefined
  const orphanHoldId = orphan?.editHold?.holdId ?? null
  const adopt = useEffectEvent(async () => {
    const followUpId = orphan?.id
    if (!sessionId || !followUpId || storedEdit(sessionId)) return
    // The hold may have ended since this snapshot; re-adopt only what the Host still shows held.
    await queue.refresh()
    const resumed = queue.resumeEdit(followUpId)
    const contextKey = visibleSessionDraftContext(String(sessionId))
    if (!resumed || storedEdit(sessionId) || !contextKey || contextKey.endsWith(':pending')) return
    openEdit(sessionId, contextKey, resumed)
  })

  useEffect(() => {
    if (orphanHoldId && visibleKey) void adopt()
  }, [orphanHoldId, visibleKey])
}

export type QueuedMessageEditController = ReturnType<typeof useQueuedMessageEdit>
