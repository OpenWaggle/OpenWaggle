import type { SessionId } from '@shared/types/brand'
import { SessionControlRejectedError, useSessionFollowUpQueue } from '@/features/chat/hooks'
import { reorderedFollowUpIds } from '../lib/queued-message-order'

export const MOVE_NOT_APPLIED_MESSAGE =
  'The queue changed before your move could be applied. Check the order and try again.'

function isStaleRevision(error: unknown) {
  return error instanceof SessionControlRejectedError && error.code === 'queue_revision_changed'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Follow-up reordering from the queue dock, by drag or by Move up / Move down.
 *
 * Moves are revision-guarded. When another change landed first, the move is replayed once against
 * the refetched queue; the user hears about it only when it still cannot be applied (the message
 * left the queue, or its target slot no longer exists).
 */
export function useQueuedMessageReorder(
  sessionId: SessionId | null,
  lockedIds: ReadonlySet<string>,
  onToast: (message: string) => void,
) {
  const { snapshot, refresh, reorder } = useSessionFollowUpQueue(sessionId)

  async function move(followUpId: string, targetIndex: number) {
    const ids = snapshot.items.map((item) => item.id)
    const order = reorderedFollowUpIds(ids, lockedIds, followUpId, targetIndex)
    if (!order) return
    try {
      await reorder(order, snapshot.revision)
    } catch (error) {
      if (!isStaleRevision(error)) {
        onToast(errorMessage(error))
        return
      }
      await retryAgainstFreshQueue(followUpId, targetIndex)
    }
  }

  async function retryAgainstFreshQueue(followUpId: string, targetIndex: number) {
    try {
      const fresh = await refresh()
      const freshIds = fresh?.items.map((item) => item.id) ?? []
      const currentIndex = freshIds.filter((id) => !lockedIds.has(id)).indexOf(followUpId)
      // Someone else already made this exact move.
      if (currentIndex === targetIndex) return
      const order = fresh
        ? reorderedFollowUpIds(freshIds, lockedIds, followUpId, targetIndex)
        : null
      if (!fresh || !order) {
        onToast(MOVE_NOT_APPLIED_MESSAGE)
        return
      }
      await reorder(order, fresh.revision)
    } catch (error) {
      onToast(isStaleRevision(error) ? MOVE_NOT_APPLIED_MESSAGE : errorMessage(error))
    }
  }

  return { move }
}
