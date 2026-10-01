import type { SessionId } from '@shared/types/brand'
import { useEffect, useEffectEvent } from 'react'
import {
  isLostFollowUpEdit,
  SessionControlRejectedError,
  type SessionFollowUpEdit,
  type SessionFollowUpQueueItem,
  useSessionFollowUpQueue,
} from '@/features/chat/hooks'
import { retainHostReferencedAttachments } from '../state/composer-attachment-lifecycle'
import { useComposerStore } from '../state/composer-store'
import type { ComposerScopedDraft } from '../state/composer-store-types'
import {
  isOpenQueuedMessageEdit,
  type OpenQueuedMessageEdit,
  type QueuedMessageEdit,
  selectQueuedMessageEdit,
  useQueuedMessageEditStore,
} from '../state/queued-message-edit-store'
import {
  clearStashedDraft,
  editedWaggle,
  queuedMessageDraft,
  readComposerDraft,
  stashDraftAndLoad,
  takeStashedDraft,
  writeComposerDraft,
} from './queued-message-edit-drafts'

const BEGIN_REJECTION_COPY: Readonly<Record<string, string>> = {
  follow_up_edit_held: 'This queued message is already being edited.',
  follow_up_not_found: 'This queued message was already sent or removed.',
  follow_up_not_editable: 'Only messages you queued yourself can be edited.',
  follow_up_edit_requires_desktop_user: 'Queued messages can only be edited in the desktop app.',
}

export const LOST_EDIT_MESSAGE =
  'This queued message was already sent or removed, so your edit was not saved. Your text is back in the composer to send as a new message.'
const DROPPED_ATTACHMENTS_SUFFIX = ' Attach files again if you need them.'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function beginFailureMessage(error: unknown) {
  if (error instanceof SessionControlRejectedError) {
    return BEGIN_REJECTION_COPY[error.code] ?? 'This queued message cannot be edited right now.'
  }
  return errorMessage(error)
}

function saveFailureMessage(error: unknown) {
  // Not a Host answer (a refused GUI-only command, a broken connection): its own words fit.
  if (!(error instanceof SessionControlRejectedError)) return errorMessage(error)
  if (error.code === 'queue_byte_capacity_reached') {
    return 'The edited message is too large for the queue. Shorten it or remove attachments.'
  }
  return 'The edit could not be saved. Try again.'
}

function mergeText(edited: string, stashed: string) {
  if (!stashed.trim()) return edited
  return edited ? `${edited}\n\n${stashed}` : stashed
}

function currentEdit(sessionId: SessionId) {
  const edit = selectQueuedMessageEdit(String(sessionId))(useQueuedMessageEditStore.getState())
  return isOpenQueuedMessageEdit(edit) ? edit : null
}

function setEdit(sessionId: SessionId, edit: QueuedMessageEdit | null) {
  useQueuedMessageEditStore.getState().setEdit(String(sessionId), edit)
}

/** Puts the set-aside draft back; the stash keeps owning its attachments until it is back. */
function restoreStashedDraft(sessionId: SessionId, contextKey: string) {
  writeComposerDraft(contextKey, takeStashedDraft(String(sessionId)))
  clearStashedDraft(String(sessionId))
}

/**
 * A lost edit cannot be saved: keep what the user wrote, out of edit mode, so it can be sent as a
 * new message. The Host already deleted any attachment the edit added, and the queued message's
 * own attachments went with it, so only the set-aside draft's attachments come back.
 */
function keepLostEditAsDraft(
  sessionId: SessionId,
  contextKey: string,
  edited: ComposerScopedDraft,
) {
  const stashed = takeStashedDraft(String(sessionId))
  writeComposerDraft(contextKey, {
    input: mergeText(edited.input.trim(), stashed.input),
    attachments: stashed.attachments,
    wagglePreset: edited.wagglePreset ?? stashed.wagglePreset ?? null,
  })
  clearStashedDraft(String(sessionId))
}

/**
 * Opens edit mode in the composer for an edit this user holds: one just begun, or one adopted.
 * The Session's draft is set aside first (unless an earlier stash is still waiting), so it comes
 * back after save or cancel.
 */
function openEdit(sessionId: SessionId, contextKey: string, based: SessionFollowUpEdit) {
  stashDraftAndLoad(String(sessionId), contextKey, queuedMessageDraft(based.item))
  setEdit(sessionId, { phase: 'editing', followUpId: based.followUpId, based })
}

/** The open edit a held queue item represents, when this user holds it and knows its hold. */
function heldEdit(item: SessionFollowUpQueueItem): SessionFollowUpEdit | null {
  const hold = item.editHold
  if (!hold?.heldByCurrentUser || !hold.holdId) return null
  return {
    followUpId: item.id,
    holdId: hold.holdId,
    leaseExpiresAt: hold.leaseExpiresAt,
    item,
  }
}

/** The composer's visible draft belongs to `sessionId` (not a Session it is switching away from). */
function visibleDraftContext(sessionId: SessionId) {
  const contextKey = useComposerStore.getState().activeDraftContextKey
  return contextKey?.includes(`session:${String(sessionId)}:`) ? contextKey : null
}

/**
 * Editing a queued message in the composer (ADR 0043).
 *
 * Beginning an edit takes a Host hold, sets the composer's draft aside, and loads the queued
 * message in its place; saving or cancelling releases the hold and brings the draft back. The edit
 * is kept per Session, so leaving and returning to the Session reopens it.
 */
export function useQueuedMessageEdit(
  sessionId: SessionId | null,
  onToast: (message: string) => void,
) {
  const queue = useSessionFollowUpQueue(sessionId)
  const edit = useQueuedMessageEditStore(
    selectQueuedMessageEdit(sessionId ? String(sessionId) : null),
  )

  async function begin(followUpId: string) {
    if (
      !sessionId ||
      selectQueuedMessageEdit(String(sessionId))(useQueuedMessageEditStore.getState())
    ) {
      return
    }
    const contextKey = useComposerStore.getState().activeDraftContextKey
    if (!contextKey) return
    setEdit(sessionId, { phase: 'beginning', followUpId })
    try {
      openEdit(sessionId, contextKey, await queue.beginEdit(followUpId))
    } catch (error) {
      setEdit(sessionId, null)
      onToast(beginFailureMessage(error))
    }
  }

  async function save() {
    if (!sessionId) return
    const open = currentEdit(sessionId)
    const contextKey = useComposerStore.getState().activeDraftContextKey
    if (open?.phase !== 'editing' || !contextKey) return
    const draft = readComposerDraft(contextKey)
    const text = draft.input.trim()
    if (!text && draft.attachments.length === 0) return
    setEdit(sessionId, { ...open, phase: 'saving' })
    const { waggle, visualizationContext } = open.based.item
    try {
      await queue.saveEdit(open.based, {
        text,
        attachments: draft.attachments,
        ...withWaggle(editedWaggle(draft.wagglePreset ?? null, waggle)),
        ...(visualizationContext ? { visualizationContext } : {}),
      })
    } catch (error) {
      handleSaveFailure(sessionId, contextKey, draft, open, error)
      return
    }
    // The queued message now references every attachment it carries, including newly added ones.
    retainHostReferencedAttachments(draft.attachments)
    restoreStashedDraft(sessionId, contextKey)
    setEdit(sessionId, null)
  }

  function handleSaveFailure(
    id: SessionId,
    contextKey: string,
    draft: ComposerScopedDraft,
    open: OpenQueuedMessageEdit,
    error: unknown,
  ) {
    if (isLostFollowUpEdit(error)) {
      keepLostEditAsDraft(id, contextKey, draft)
      setEdit(id, null)
      onToast(
        draft.attachments.length > 0
          ? LOST_EDIT_MESSAGE + DROPPED_ATTACHMENTS_SUFFIX
          : LOST_EDIT_MESSAGE,
      )
      return
    }
    // The hold is still in flight, so the Host keeps the edit's attachments: try again as is.
    setEdit(id, { ...open, phase: 'editing' })
    onToast(saveFailureMessage(error))
  }

  async function cancel() {
    if (!sessionId) return
    const open = currentEdit(sessionId)
    const contextKey = useComposerStore.getState().activeDraftContextKey
    if (open?.phase !== 'editing' || !contextKey) return
    setEdit(sessionId, { ...open, phase: 'cancelling' })
    try {
      await queue.cancelEdit(open.based)
    } catch (error) {
      // A lost hold has nothing left to release.
      if (!isLostFollowUpEdit(error)) {
        setEdit(sessionId, { ...open, phase: 'editing' })
        onToast(errorMessage(error))
        return
      }
    }
    restoreStashedDraft(sessionId, contextKey)
    setEdit(sessionId, null)
  }

  /** Withdrawing the message being edited ends the edit: there is nothing left to save into. */
  function endWithdrawnEdit(followUpId: string) {
    if (!sessionId) return
    const open = currentEdit(sessionId)
    const contextKey = useComposerStore.getState().activeDraftContextKey
    if (open?.followUpId !== followUpId || !contextKey) return
    restoreStashedDraft(sessionId, contextKey)
    setEdit(sessionId, null)
  }

  return { edit, begin, save, cancel, endWithdrawnEdit }
}

/**
 * Never leaves an orphan hold. When the queue shows a message this user holds for editing but
 * this window has no edit open for it (the composer remounted, an error boundary reset it, or the
 * renderer state was rebuilt), the composer re-adopts the edit and reopens edit mode with it.
 * Mount once per Session composer; this is the only place an edit is adopted.
 */
export function useAdoptHeldQueuedMessageEdit(sessionId: SessionId | null) {
  const { snapshot } = useSessionFollowUpQueue(sessionId)
  const edit = useQueuedMessageEditStore(
    selectQueuedMessageEdit(sessionId ? String(sessionId) : null),
  )
  const orphan = edit === null ? snapshot.items.map(heldEdit).find((held) => held !== null) : null
  const orphanHoldId = orphan?.holdId ?? null
  const adopt = useEffectEvent(() => {
    if (!sessionId || !orphan) return
    if (selectQueuedMessageEdit(String(sessionId))(useQueuedMessageEditStore.getState())) return
    const contextKey = visibleDraftContext(sessionId)
    if (contextKey) openEdit(sessionId, contextKey, orphan)
  })

  useEffect(() => {
    if (orphanHoldId) adopt()
  }, [orphanHoldId])
}

function withWaggle(waggle: ReturnType<typeof editedWaggle>) {
  return waggle ? { waggle } : {}
}

export type QueuedMessageEditController = ReturnType<typeof useQueuedMessageEdit>
