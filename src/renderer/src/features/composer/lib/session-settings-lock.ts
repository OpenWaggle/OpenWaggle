import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import { isOwnQueuedMessage } from './own-queued-message'

/** Why the Session settings cannot change while a Run is going and messages wait behind it. */
export const SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON =
  'Available when the Run ends, or pause the queue'

/** Why they cannot change while the Host runs this user's queued messages past agents' ones. */
export const SESSION_SETTINGS_LOCKED_BY_OWN_QUEUE_REASON =
  'Available when your queued messages have run'

/** Why the Session settings cannot change while a Run is going. */
export const SESSION_SETTINGS_LOCKED_REASON = 'Available when the Run ends'

/** Why a draft's settings wait while its first message creates the Session. */
export const SESSION_SETTINGS_MATERIALIZING_REASON = 'Available once the new Session is created'

export interface SessionSettingsLock {
  readonly locked: boolean
  /** A short reason for the tooltip while locked. */
  readonly reason: string | null
}

const UNLOCKED: SessionSettingsLock = { locked: false, reason: null }

type QueueState = Pick<SessionFollowUpQueueSnapshot, 'state' | 'items' | 'pauseReason'>

/** The queue starts its next message when the current Run ends: a chain of queued Runs. */
function queueContinues(queue: QueueState) {
  const head = queue.items[0]
  return queue.state === 'running' && head?.deliveryState === 'pending' && !head.editHold
}

/**
 * A queue waiting on agents' capacity still starts this user's first pending message when the Run
 * ends, unless an edit up to it holds it (`deliverPersonFollowUpPastCapacity`); it cannot be
 * paused, so only that message running gets there.
 */
function ownMessageContinues(queue: QueueState) {
  if (queue.state !== 'paused' || queue.pauseReason !== 'parent-limit') return false
  const index = queue.items.findIndex(
    (item) => isOwnQueuedMessage(item) && item.deliveryState === 'pending',
  )
  return index >= 0 && queue.items.slice(0, index + 1).every((item) => !item.editHold)
}

/**
 * Whether a Session's model and thinking level can change now. The Host refuses either change
 * while a Run is starting, active, or finishing (`canChange` is false then), so the pickers lock
 * for exactly that time and a refusal never surprises the user. A paused queue or a next message
 * held for an edit keeps the Session idle once its Run ends, which is when they unlock; during a
 * chain of queued Runs the reason says pausing the queue gets there. A draft is locked only while
 * its first message creates the Session: a pick then would land on neither the draft nor it.
 */
export function sessionSettingsLock(input: {
  readonly hasSession: boolean
  readonly canChange: boolean
  readonly draftMaterializing: boolean
  readonly queue: QueueState
}) {
  if (!input.hasSession) {
    return (
      input.draftMaterializing
        ? { locked: true, reason: SESSION_SETTINGS_MATERIALIZING_REASON }
        : UNLOCKED
    ) satisfies SessionSettingsLock
  }
  if (input.canChange) return UNLOCKED
  return {
    locked: true,
    reason: queueContinues(input.queue)
      ? SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON
      : ownMessageContinues(input.queue)
        ? SESSION_SETTINGS_LOCKED_BY_OWN_QUEUE_REASON
        : SESSION_SETTINGS_LOCKED_REASON,
  } satisfies SessionSettingsLock
}
