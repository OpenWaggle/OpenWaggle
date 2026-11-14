import { ADOPTION_LIFTED_PAUSE_REASONS } from '@shared/types/session-control-queue'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import { isOwnQueuedMessage } from './own-queued-message'

type SendAsMeQueue = Pick<
  SessionFollowUpQueueSnapshot,
  'state' | 'pauseReason' | 'activeRunId' | 'items'
>

/**
 * Whether "Send as me" on `followUpId` starts it at once, mirroring the Host (`adoptFollowUp` and
 * its `resumesAttentionPause`): the Session idle, and either the message is the queue's first, not
 * held for an edit, and the queue runs after the adoption (it already runs, or its pause is one
 * adoption lifts and this message is the last one that needs attention), or the queue waits on
 * agents' capacity (`parent-limit`), where the adopted message is the person's and starts ahead of
 * theirs (`deliverPersonFollowUpPastCapacity`) unless an edit up to it, or another message of this
 * user's before it, comes first. Otherwise it waits its turn.
 */
export function sendAsMeStartsNow(input: {
  readonly queue: SendAsMeQueue
  readonly followUpId: string
  /** The composer is streaming a Run the Host may not report yet. */
  readonly isStreaming: boolean
}) {
  const { queue, followUpId } = input
  if (input.isStreaming || queue.activeRunId !== null) return false
  if (queue.state === 'paused' && queue.pauseReason === 'parent-limit') {
    const index = queue.items.findIndex((item) => item.id === followUpId)
    const upToIt = queue.items.slice(0, index + 1)
    return (
      index >= 0 &&
      upToIt.every((item) => item.editHold === undefined) &&
      !upToIt.some(
        (item) =>
          item.id !== followUpId && isOwnQueuedMessage(item) && item.deliveryState === 'pending',
      )
    )
  }
  if (queue.items[0]?.id !== followUpId) return false
  // The Host never delivers a held head, and adopting keeps the adopter's own edit hold.
  if (queue.items[0]?.editHold !== undefined) return false
  if (queue.state === 'running') return true
  if (!ADOPTION_LIFTED_PAUSE_REASONS.includes(queue.pauseReason)) return false
  return queue.items.every(
    (item) => item.id === followUpId || item.deliveryState !== 'needs_attention',
  )
}
