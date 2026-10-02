import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'

/** Why the Session settings cannot change while a Run is going and messages wait behind it. */
export const SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON =
  'Available when the Run ends, or pause the queue'

/** Why the Session settings cannot change while a Run is going. */
export const SESSION_SETTINGS_LOCKED_REASON = 'Available when the Run ends'

export interface SessionSettingsLock {
  readonly locked: boolean
  /** A short reason for the tooltip while locked. */
  readonly reason: string | null
}

const UNLOCKED: SessionSettingsLock = { locked: false, reason: null }

type QueueState = Pick<SessionFollowUpQueueSnapshot, 'state' | 'items'>

/** The queue starts its next message when the current Run ends: a chain of queued Runs. */
function queueContinues(queue: QueueState) {
  const head = queue.items[0]
  return queue.state === 'running' && head?.deliveryState === 'pending' && !head.editHold
}

/**
 * Whether a Session's model and thinking level can change now. The Host refuses either change
 * while a Run is starting, active, or finishing (`canChange` is false then), so the pickers lock
 * for exactly that time and a refusal never surprises the user. A paused queue or a next message
 * held for an edit keeps the Session idle once its Run ends, which is when they unlock; during a
 * chain of queued Runs the reason says pausing the queue gets there. A draft is never locked.
 */
export function sessionSettingsLock(input: {
  readonly hasSession: boolean
  readonly canChange: boolean
  readonly queue: QueueState
}): SessionSettingsLock {
  if (!input.hasSession || input.canChange) return UNLOCKED
  return {
    locked: true,
    reason: queueContinues(input.queue)
      ? SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON
      : SESSION_SETTINGS_LOCKED_REASON,
  }
}
