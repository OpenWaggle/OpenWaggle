import type { SessionId } from '@shared/types/brand'
import { useEffect, useEffectEvent } from 'react'
import {
  isLostFollowUpEdit,
  SessionControlRejectedError,
  type SessionFollowUpQueueItem,
  useSessionFollowUpQueue,
} from '@/features/chat/hooks'
import { retainHostReferencedAttachments } from '../state/composer-attachment-lifecycle'
import { useComposerStore } from '../state/composer-store'
import {
  isHoldAbandoned,
  type OpenQueuedMessageEdit,
  selectAbandonedHoldIds,
  selectQueuedMessageEdit,
  useQueuedMessageEditStore,
} from '../state/queued-message-edit-store'
import {
  editedWaggle,
  focusVisibleEditor,
  readComposerDraft,
  visibleSessionDraftContext,
} from './queued-message-edit-drafts'
import {
  beginFailureMessage,
  errorMessage,
  INTERRUPTED_EDIT_MESSAGE,
  LOST_EDIT_MESSAGE,
  NOT_EDITABLE_MESSAGE,
  saveFailureMessage,
  WITHDRAWN_EDIT_MESSAGE,
} from './queued-message-edit-messages'
import {
  beginTarget,
  continueEdit,
  currentEdit,
  keepEditAsDraft,
  openEdit,
  restoreStashedDraft,
  saveBlock,
  setEdit,
  stillHolds,
  storedEdit,
} from './queued-message-edit-transitions'

/** The hold was lost but its message may still be queued: a fresh hold can carry the edit on. */
const INTERRUPTED_CODES: ReadonlySet<string> = new Set([
  'follow_up_edit_not_held',
  'follow_up_edit_hold_mismatch',
])

/**
 * Editing a queued message in the composer (ADR 0044). The only adapter to the Follow-up edit
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
    if (!sessionId) return
    const target = beginTarget(sessionId)
    if (target.kind === 'blocked') {
      onToast(target.message)
      return
    }
    const { contextKey } = target
    setEdit(sessionId, { phase: 'beginning', followUpId, contextKey })
    let opened: Awaited<ReturnType<typeof queue.beginEdit>>
    try {
      opened = await queue.beginEdit(followUpId)
    } catch (error) {
      setEdit(sessionId, null)
      onToast(beginFailureMessage(error))
      return
    }
    const pending = storedEdit(sessionId)
    if (pending?.phase !== 'beginning' || pending.followUpId !== followUpId) {
      // Superseded while the Host answered (the draft was cleared): do not leave the hold behind.
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
    const block = saveBlock(open.contextKey, draft)
    if (block) {
      if (block.message) onToast(block.message)
      return
    }
    // The save may commit before anything below runs (or the edit is abandoned mid-save), so
    // protect every chip it names first, as a queued send does. A failed save keeps the chips.
    retainHostReferencedAttachments(draft.attachments)
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
      if (stillHolds(sessionId, open.based.holdId)) await handleSaveFailure(sessionId, open, error)
      return
    }
    if (!stillHolds(sessionId, open.based.holdId)) return
    restoreStashedDraft(sessionId, open)
  }

  async function handleSaveFailure(id: SessionId, open: OpenQueuedMessageEdit, error: unknown) {
    if (isLostFollowUpEdit(error)) {
      await recoverLostEdit(id, open, error)
      return
    }
    // Still held: the Host keeps every attachment the edit named, so retry with the edit as is.
    setEdit(id, { ...open, phase: 'editing' })
    focusVisibleEditor(open.contextKey)
    onToast(saveFailureMessage(error))
  }

  /**
   * The hold is gone. If the message is still queued and editable, take a fresh hold and keep
   * editing; the user's draft stays exactly as it is. Only a message that is really gone turns
   * the edit into a new draft; one that is still queued but no longer editable keeps its place
   * and the text is offered alongside, never as a silent duplicate.
   */
  async function recoverLostEdit(id: SessionId, open: OpenQueuedMessageEdit, error: unknown) {
    const fresh = await queue.refresh().catch(() => undefined)
    if (!stillHolds(id, open.based.holdId)) return
    const item = fresh?.items.find((candidate) => candidate.id === open.followUpId)
    const interrupted =
      error instanceof SessionControlRejectedError && INTERRUPTED_CODES.has(error.code)
    if (item?.editable && interrupted) {
      const reopened = await queue.beginEdit(open.followUpId).catch(() => null)
      if (reopened && stillHolds(id, open.based.holdId)) {
        continueEdit(id, open, reopened)
        onToast(INTERRUPTED_EDIT_MESSAGE)
        return
      }
      if (reopened) await queue.cancelEdit(reopened).catch(() => undefined)
      if (!stillHolds(id, open.based.holdId)) return
    }
    keepEditAsDraft(id, open)
    onToast(item ? NOT_EDITABLE_MESSAGE : LOST_EDIT_MESSAGE)
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
        // Focus stays where the user left it (the Cancel button or the input).
        if (stillHolds(sessionId, open.based.holdId))
          setEdit(sessionId, { ...open, phase: 'editing' })
        onToast(errorMessage(error))
        return
      }
    }
    if (stillHolds(sessionId, open.based.holdId)) restoreStashedDraft(sessionId, open)
  }

  /** Withdrawing the message being edited ends the edit; what the user wrote stays as a draft. */
  function endWithdrawnEdit(followUpId: string) {
    if (!sessionId) return
    const open = currentEdit(sessionId)
    if (open?.phase !== 'editing' || open.followUpId !== followUpId) return
    keepEditAsDraft(sessionId, open)
    onToast(WITHDRAWN_EDIT_MESSAGE)
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
function isOwnHold(item: SessionFollowUpQueueItem, abandonedHoldIds: ReadonlySet<string>) {
  const holdId = item.editHold?.holdId
  return (
    item.editable &&
    item.editHold?.heldByCurrentUser === true &&
    holdId !== undefined &&
    // Given up with its cleared draft; the Host has not processed the release yet.
    !abandonedHoldIds.has(holdId)
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
  // Subscribed, so a hold whose release failed (and is forgotten as abandoned) is adopted again.
  const abandonedHoldIds = useQueuedMessageEditStore(selectAbandonedHoldIds)
  const orphan =
    edit === null
      ? queue.snapshot.items.find((item) => isOwnHold(item, abandonedHoldIds))
      : undefined
  const orphanHoldId = orphan?.editHold?.holdId ?? null
  const adopt = useEffectEvent(async () => {
    const followUpId = orphan?.id
    if (!sessionId || !followUpId || storedEdit(sessionId)) return
    // The hold may have ended since this snapshot; re-adopt only what the Host still shows held.
    await queue.refresh()
    const resumed = queue.resumeEdit(followUpId)
    const contextKey = visibleSessionDraftContext(String(sessionId))
    if (!resumed || storedEdit(sessionId) || !contextKey || contextKey.endsWith(':pending')) return
    if (isHoldAbandoned(resumed.holdId)) return
    // This window now renews the hold and releases it when it closes (ADR 0044).
    if (!(await queue.adoptEdit(resumed).catch(() => false))) return
    if (storedEdit(sessionId) || visibleSessionDraftContext(String(sessionId)) !== contextKey)
      return
    openEdit(sessionId, contextKey, resumed)
  })

  useEffect(() => {
    if (orphanHoldId && visibleKey) void adopt()
  }, [orphanHoldId, visibleKey])
}

export type QueuedMessageEditController = ReturnType<typeof useQueuedMessageEdit>
