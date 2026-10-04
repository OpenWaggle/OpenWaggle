import type { SessionId } from '@shared/types/brand'
import { useState } from 'react'
import {
  draftBusyReason,
  selectDraftActivity,
  useComposerActivityStore,
} from '../state/composer-activity-store'
import { useComposerStore } from '../state/composer-store'
import { isOpenQueuedMessageEdit, type QueuedMessageEdit } from '../state/queued-message-edit-store'
import { attachmentLimitReason } from './composer-submission-support'
import { readComposerDraft } from './queued-message-edit-drafts'
import { isUnchangedEdit } from './queued-message-edit-transitions'
import { useAdoptHeldQueuedMessageEdit, useQueuedMessageEdit } from './useQueuedMessageEdit'

export interface ComposerQueuedEditMode {
  /** The edit whose draft is visible: the composer is in edit mode. Includes `beginning`. */
  readonly here: QueuedMessageEdit | null
  /** An edit is open in another draft (another branch) of this Session. */
  readonly elsewhere: boolean
  /** Saving is possible now (content, no work in flight for the draft, within the limits). */
  readonly canSave: boolean
  /** The Session's queue waits on an edit, so an explicit Waggle is queued, not started. */
  readonly waitingOnEdit: boolean
  /** A first Escape on a changed edit asks for a second one before discarding the changes. */
  readonly escapeArmed: boolean
  readonly save: () => void
  readonly cancel: () => void
  /** Escape in the input: discards an unchanged edit at once, a changed one on the second press. */
  readonly onEscape: () => void
}

/**
 * Follow-up edit mode as the composer sees it: whether the visible draft is being edited, and the
 * save / cancel / Escape actions. Also re-adopts an orphan hold, once per mounted composer.
 */
export function useComposerQueuedEditMode(
  sessionId: SessionId | null,
  onToast: (message: string) => void,
): ComposerQueuedEditMode {
  const queuedEdit = useQueuedMessageEdit(sessionId, onToast)
  useAdoptHeldQueuedMessageEdit(sessionId)
  const input = useComposerStore((state) => state.input)
  const attachments = useComposerStore((state) => state.attachments)
  const here = queuedEdit.isVisible ? queuedEdit.edit : null
  const activity = useComposerActivityStore(selectDraftActivity(here?.contextKey ?? null))
  // Armed for the hold and draft text it was pressed on: typing again, a new hold (an interrupted
  // edit carried on), or leaving 'editing' (save, cancel) asks again.
  const [armed, setArmed] = useState<{ readonly holdId: string; readonly input: string } | null>(
    null,
  )
  const hasContent = input.trim().length > 0 || attachments.length > 0
  const open = isOpenQueuedMessageEdit(here) ? here : null
  const escapeArmed =
    open?.phase === 'editing' && armed?.holdId === open.based.holdId && armed.input === input

  function handleEscape() {
    if (open?.phase !== 'editing') return
    const unchanged = isUnchangedEdit(readComposerDraft(open.contextKey), open.based.item)
    if (unchanged || escapeArmed) {
      setArmed(null)
      void queuedEdit.cancel()
      return
    }
    setArmed({ holdId: open.based.holdId, input })
  }

  return {
    here,
    elsewhere: queuedEdit.edit !== null && !queuedEdit.isVisible,
    waitingOnEdit: queuedEdit.waitingOnEdit,
    canSave:
      open?.phase === 'editing' &&
      hasContent &&
      draftBusyReason(activity) === null &&
      attachmentLimitReason(attachments) === null,
    escapeArmed,
    save: () => {
      setArmed(null)
      void queuedEdit.save()
    },
    cancel: () => {
      setArmed(null)
      void queuedEdit.cancel()
    },
    onEscape: handleEscape,
  }
}
