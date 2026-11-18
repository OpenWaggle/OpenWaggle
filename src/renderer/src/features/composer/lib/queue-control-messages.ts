import { SessionControlRejectedError } from '@/features/chat/hooks'

/** A queue action from the dock header or a queued row that the user may hear failed. */
export type QueueControlAction = 'pause' | 'resume' | 'send-as-me'

const FAILED_COPY = {
  pause: 'Could not pause the queue. Try again.',
  resume: 'Could not resume the queue. Try again.',
  'send-as-me': 'Could not send this message as you. Try again.',
} as const satisfies Record<QueueControlAction, string>

/** The queue changed again while the action was retried against a fresh read. */
const STILL_CHANGING_COPY = {
  pause: 'The queue changed before it could be paused. Check it and try again.',
  resume: 'The queue changed before it could be resumed. Check it and try again.',
  'send-as-me':
    'The queue changed before this message could be sent as you. Check it and try again.',
} as const satisfies Record<QueueControlAction, string>

export const QUEUE_CONTROL_COPY = {
  messageGone: 'This message is no longer in the queue.',
  resumeBlocked: 'Send the first message as you or dismiss it before resuming the queue.',
  editHeld: 'This message is being edited. Save or cancel the edit first.',
} as const

function rejectionCode(error: unknown) {
  return error instanceof SessionControlRejectedError ? error.code : null
}

export function isStaleQueueRevision(error: unknown) {
  return rejectionCode(error) === 'queue_revision_changed'
}

/**
 * What the user reads when a queue action is refused: never the Host's raw rejection
 * ("Session Control rejected …"), which names an operation and code instead of what happened.
 */
export function queueControlFailureMessage(action: QueueControlAction, error: unknown) {
  const code = rejectionCode(error)
  if (code === 'queue_revision_changed') return STILL_CHANGING_COPY[action]
  if (code === 'follow_up_not_found') return QUEUE_CONTROL_COPY.messageGone
  if (code === 'follow_up_edit_held') return QUEUE_CONTROL_COPY.editHeld
  return FAILED_COPY[action]
}
