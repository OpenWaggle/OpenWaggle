import type { SessionId } from '@shared/types/brand'
import {
  SessionControlRejectedError,
  type SessionFollowUpQueueSnapshot,
  useSessionFollowUpQueue,
} from '@/features/chat/hooks'
import { selectPendingSteerFollowUps, useOptimisticSteerStore } from '@/features/chat/state'
import {
  moveQueuedMessage,
  type QueuedMessageAnchor,
  type QueuedMessageMove,
} from '../lib/queued-message-order'

export const MOVE_NOT_APPLIED_MESSAGE =
  'The queue changed before your move could be applied. Check the order and try again.'

function isStaleRevision(error: unknown) {
  return error instanceof SessionControlRejectedError && error.code === 'queue_revision_changed'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Messages reserved by a pending steering promotion, read now: they are locked in place. */
function lockedIds(sessionId: SessionId) {
  return new Set(selectPendingSteerFollowUps(sessionId)(useOptimisticSteerStore.getState()))
}

function planMove(
  sessionId: SessionId,
  snapshot: SessionFollowUpQueueSnapshot,
  followUpId: string,
  anchor: QueuedMessageAnchor,
) {
  const ids = snapshot.items.map((item) => item.id)
  return moveQueuedMessage(ids, lockedIds(sessionId), followUpId, anchor)
}

/**
 * Follow-up reordering from the queue dock, by drag or by Move up / Move down.
 *
 * Moves are revision-guarded. When another change landed first, the move is replayed once against
 * the refetched queue (same neighbour, fresh locks); the user hears about it only when it still
 * cannot be applied (either message left the queue). Resolves with where the message ended up.
 */
export function useQueuedMessageReorder(
  sessionId: SessionId | null,
  onToast: (message: string) => void,
) {
  const { snapshot, refresh, reorder } = useSessionFollowUpQueue(sessionId)

  async function move(
    followUpId: string,
    anchor: QueuedMessageAnchor,
  ): Promise<QueuedMessageMove | null> {
    if (!sessionId) return null
    const planned = planMove(sessionId, snapshot, followUpId, anchor)
    if (!planned) return null
    try {
      await reorder(planned.order, snapshot.revision)
      return planned
    } catch (error) {
      if (isStaleRevision(error)) return retryAgainstFreshQueue(sessionId, followUpId, anchor)
      onToast(errorMessage(error))
      return null
    }
  }

  async function retryAgainstFreshQueue(
    id: SessionId,
    followUpId: string,
    anchor: QueuedMessageAnchor,
  ) {
    try {
      const fresh = await refresh()
      const locks = lockedIds(id)
      const movable = new Set(
        fresh?.items.map((item) => item.id).filter((item) => !locks.has(item)),
      )
      if (!fresh || !movable.has(followUpId) || !movable.has(anchor.followUpId)) {
        onToast(MOVE_NOT_APPLIED_MESSAGE)
        return null
      }
      const planned = planMove(id, fresh, followUpId, anchor)
      // Null here means the queue already has this order: someone made the same move.
      if (!planned) return null
      await reorder(planned.order, fresh.revision)
      return planned
    } catch (error) {
      onToast(isStaleRevision(error) ? MOVE_NOT_APPLIED_MESSAGE : errorMessage(error))
      return null
    }
  }

  return { move }
}
