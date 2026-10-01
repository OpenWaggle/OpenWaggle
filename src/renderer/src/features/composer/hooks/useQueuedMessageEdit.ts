import type { SessionId } from '@shared/types/brand'
import { useEffect, useEffectEvent } from 'react'
import {
  isLostFollowUpEdit,
  SessionControlRejectedError,
  type SessionFollowUpEdit,
  type SessionFollowUpQueueItem,
  useSessionFollowUpQueue,
} from '@/features/chat/hooks'
import { useBranchSummaryStore } from '@/features/chat/state'
import { isComposerBusy } from '../state/composer-activity-store'
import {
  isHostReferencedAttachment,
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
  DROPPED_ATTACHMENTS_SUFFIX,
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
 * Host-referenced chips stop being protected once they have left the composer.
 */
function endEdit(sessionId: SessionId, open: OpenQueuedMessageEdit, draft: ComposerScopedDraft) {
  const leaving = readComposerDraft(open.contextKey).attachments
  writeComposerDraft(open.contextKey, draft)
  clearStashedDraft(String(sessionId))
  releaseHostReferencedAttachments([...open.based.item.attachments, ...leaving])
  setEdit(sessionId, null)
  focusVisibleEditor(open.contextKey)
}

function restoreStashedDraft(sessionId: SessionId, open: OpenQueuedMessageEdit) {
  endEdit(sessionId, open, readStashedDraft(String(sessionId)))
}

/**
 * A lost edit cannot be saved: keep what the user wrote, out of edit mode, so it can be sent as a
 * new message. Its hold is gone, so its attachments are no longer kept for it: only the set-aside
 * draft's attachments come back.
 */
function keepLostEditAsDraft(
  sessionId: SessionId,
  open: OpenQueuedMessageEdit,
  edited: ComposerScopedDraft,
) {
  const stashed = readStashedDraft(String(sessionId))
  endEdit(sessionId, open, {
    input: mergeText(edited.input.trim(), stashed.input),
    attachments: stashed.attachments,
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
      onToast(
        draft.attachments.length > 0
          ? LOST_EDIT_MESSAGE + DROPPED_ATTACHMENTS_SUFFIX
          : LOST_EDIT_MESSAGE,
      )
      return
    }
    setEdit(id, { ...open, phase: 'editing' })
    if (!(error instanceof SessionControlRejectedError)) {
      // Refused before the Host saw it (a GUI-only command, a broken connection): nothing changed.
      onToast(saveFailureMessage(error))
      return
    }
    // The Host deletes attachments a rejected save added, so their chips would no longer resolve.
    const kept = draft.attachments.filter(isHostReferencedAttachment)
    const dropped = kept.length !== draft.attachments.length
    if (dropped) writeComposerDraft(open.contextKey, { ...draft, attachments: kept })
    onToast(saveFailureMessage(error) + (dropped ? DROPPED_ATTACHMENTS_SUFFIX : ''))
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

  return { edit, isVisible, begin, save, cancel, endWithdrawnEdit }
}

/** The open edit a held queue item represents, when this user holds it and knows its hold. */
function heldEdit(item: SessionFollowUpQueueItem): SessionFollowUpEdit | null {
  const hold = item.editHold
  if (!hold?.heldByCurrentUser || !hold.holdId) return null
  return { followUpId: item.id, holdId: hold.holdId, leaseExpiresAt: hold.leaseExpiresAt, item }
}

/**
 * Never leaves an orphan hold. When the queue shows a message this user holds for editing but
 * this window has no edit open for it (the composer remounted, an error boundary reset it, or the
 * renderer state was rebuilt), the composer re-adopts the edit into its visible draft. Retried
 * whenever the visible draft changes, so a draft that was not ready yet adopts once it is. Mount
 * once per Session composer; this is the only place an edit is adopted.
 */
export function useAdoptHeldQueuedMessageEdit(sessionId: SessionId | null) {
  const { snapshot } = useSessionFollowUpQueue(sessionId)
  const edit = useQueuedMessageEditStore(
    selectQueuedMessageEdit(sessionId ? String(sessionId) : null),
  )
  const visibleKey = useComposerStore((state) => state.activeDraftContextKey)
  const orphan = edit === null ? snapshot.items.map(heldEdit).find((held) => held !== null) : null
  const orphanHoldId = orphan?.holdId ?? null
  const adopt = useEffectEvent(() => {
    if (!sessionId || !orphan || storedEdit(sessionId)) return
    const contextKey = visibleSessionDraftContext(String(sessionId))
    if (contextKey && !contextKey.endsWith(':pending')) openEdit(sessionId, contextKey, orphan)
  })

  useEffect(() => {
    if (orphanHoldId && visibleKey) adopt()
  }, [orphanHoldId, visibleKey])
}

export type QueuedMessageEditController = ReturnType<typeof useQueuedMessageEdit>
