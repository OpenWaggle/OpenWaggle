import type { ScheduledTaskAttention } from '@shared/types/scheduled-task'

/** A Scheduled task the Host just stopped and marked as needing attention. */
export interface ScheduledTaskAttentionSignal {
  readonly taskId: string
  readonly taskName: string
  readonly kind: 'heartbeat' | 'launch'
  readonly projectPath: string | null
  /** A Heartbeat's Session; a Launch schedule has none. */
  readonly targetSessionId: string | null
  readonly attention: ScheduledTaskAttention
}

type ScheduledTaskAttentionListener = (signal: ScheduledTaskAttentionSignal) => void

let scheduledTaskAttentionListener: ScheduledTaskAttentionListener | null = null

/**
 * Scheduled task attention is Host bookkeeping with no event of its own, so the bookkeeping tells
 * the Desktop notification observer directly. Without an observer installed nothing happens.
 */
export function signalScheduledTaskAttention(signal: ScheduledTaskAttentionSignal) {
  scheduledTaskAttentionListener?.(signal)
}

export function installScheduledTaskAttentionListener(listener: ScheduledTaskAttentionListener) {
  scheduledTaskAttentionListener = listener
  return () => {
    if (scheduledTaskAttentionListener === listener) scheduledTaskAttentionListener = null
  }
}
