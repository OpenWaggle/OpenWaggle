import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { Logger } from '@shared/types/logger'
import { WORKTREE_MISSING_REASON } from '@/features/git'

const AUTO_SEND_FAILURE_TOAST =
  'Queued message failed to send automatically. It stayed in the queue.'
const STEER_FAILURE_TOAST = 'Could not steer the queued message. It was returned to the queue.'

interface QueueFailureFeedbackDeps {
  readonly logger: Logger
  readonly showToast: (message: string) => void
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether a failure is main refusing to run because the session's worktree is gone.
 *
 * That failure has a recovery - recreate the worktree, or switch to the opened checkout - and the
 * composer offers both. A queued message is dispatched long after it was written, so it can reach a
 * tree that has since disappeared, and reporting the generic queue message there hid the one piece of
 * information the user could act on.
 */
function isMissingWorktreeFailure(error: unknown) {
  return formatError(error).includes(WORKTREE_MISSING_REASON)
}

export function reportAutoSendQueueFailure(
  deps: QueueFailureFeedbackDeps,
  sessionId: SessionId | null,
  payload: AgentSendPayload,
  error: unknown,
): void {
  deps.logger.error('Failed to auto-send queued message', {
    sessionId,
    error: formatError(error),
    queuedText: payload.text,
  })
  deps.showToast(
    isMissingWorktreeFailure(error) ? WORKTREE_MISSING_REASON : AUTO_SEND_FAILURE_TOAST,
  )
}

export function reportQueuedSteerFailure(
  deps: QueueFailureFeedbackDeps,
  sessionId: SessionId,
  messageId: string,
  error: unknown,
): void {
  deps.logger.error('Failed to steer queued message', {
    sessionId,
    messageId,
    error: formatError(error),
  })
  deps.showToast(STEER_FAILURE_TOAST)
}
