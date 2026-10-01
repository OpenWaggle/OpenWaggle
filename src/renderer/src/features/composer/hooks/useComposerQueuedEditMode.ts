import type { SessionId } from '@shared/types/brand'
import { useComposerActivityStore } from '../state/composer-activity-store'
import { useComposerStore } from '../state/composer-store'
import { isOpenQueuedMessageEdit, type QueuedMessageEdit } from '../state/queued-message-edit-store'
import { attachmentLimitReason } from './composer-submission-support'
import { useAdoptHeldQueuedMessageEdit, useQueuedMessageEdit } from './useQueuedMessageEdit'

export interface ComposerQueuedEditMode {
  /** The edit whose draft is visible: the composer is in edit mode. Includes `beginning`. */
  readonly here: QueuedMessageEdit | null
  /** An edit is open in another draft (another branch) of this Session. */
  readonly elsewhere: boolean
  /** Saving is possible now (content, nothing preparing, within the limits). */
  readonly canSave: boolean
  /** The Session's queue waits on an edit, so an explicit Waggle is queued, not started. */
  readonly waitingOnEdit: boolean
  readonly save: () => void
  readonly cancel: () => void
}

/**
 * Follow-up edit mode as the composer sees it: whether the visible draft is being edited, and the
 * save / cancel actions. Also re-adopts an orphan hold, once per mounted composer.
 */
export function useComposerQueuedEditMode(
  sessionId: SessionId | null,
  onToast: (message: string) => void,
): ComposerQueuedEditMode {
  const queuedEdit = useQueuedMessageEdit(sessionId, onToast)
  useAdoptHeldQueuedMessageEdit(sessionId)
  const input = useComposerStore((state) => state.input)
  const attachments = useComposerStore((state) => state.attachments)
  const preparing = useComposerActivityStore((state) => state.preparingAttachments > 0)
  const here = queuedEdit.isVisible ? queuedEdit.edit : null
  const hasContent = input.trim().length > 0 || attachments.length > 0

  return {
    here,
    elsewhere: queuedEdit.edit !== null && !queuedEdit.isVisible,
    waitingOnEdit: queuedEdit.waitingOnEdit,
    canSave:
      isOpenQueuedMessageEdit(here) &&
      here.phase === 'editing' &&
      hasContent &&
      !preparing &&
      attachmentLimitReason(attachments) === null,
    save: () => void queuedEdit.save(),
    cancel: () => void queuedEdit.cancel(),
  }
}
