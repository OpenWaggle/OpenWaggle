import { ADOPTION_LIFTED_PAUSE_REASONS } from '@shared/types/session-control-queue'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'

type SendAsMeQueue = Pick<
  SessionFollowUpQueueSnapshot,
  'state' | 'pauseReason' | 'activeRunId' | 'items'
>

/**
 * Whether "Send as me" on `followUpId` starts it at once, mirroring the Host (`adoptFollowUp` and
 * its `resumesAttentionPause`): the message must be the queue's first and not held for an edit, the Session idle, and the
 * queue running after the adoption, either because it already runs or because it was paused only
 * for attention and this message is the last one that needs it. Otherwise it waits its turn.
 */
export function sendAsMeStartsNow(input: {
  readonly queue: SendAsMeQueue
  readonly followUpId: string
  /** The composer is streaming a Run the Host may not report yet. */
  readonly isStreaming: boolean
}): boolean {
  const { queue, followUpId } = input
  if (input.isStreaming || queue.activeRunId !== null) return false
  if (queue.items[0]?.id !== followUpId) return false
  // The Host never delivers a held head, and adopting keeps the adopter's own edit hold.
  if (queue.items[0]?.editHold !== undefined) return false
  if (queue.state === 'running') return true
  if (!ADOPTION_LIFTED_PAUSE_REASONS.includes(queue.pauseReason)) return false
  return queue.items.every(
    (item) => item.id === followUpId || item.deliveryState !== 'needs_attention',
  )
}
