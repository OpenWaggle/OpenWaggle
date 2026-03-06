import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Logger } from '@shared/types/logger'

const AUTO_SEND_FAILURE_TOAST =
  'Queued message failed to send automatically. It stayed in the queue.'
const STEER_FAILURE_TOAST = 'Could not steer the queued message. It was returned to the queue.'

interface QueueFailureFeedbackDeps {
  readonly logger: Logger
  readonly showToast: (message: string) => void
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function reportAutoSendQueueFailure(
  deps: QueueFailureFeedbackDeps,
  conversationId: ConversationId | null,
  payload: AgentSendPayload,
  error: unknown,
): void {
  deps.logger.error('Failed to auto-send queued message', {
    conversationId,
    error: formatError(error),
    queuedText: payload.text,
  })
  deps.showToast(AUTO_SEND_FAILURE_TOAST)
}

export function reportQueuedSteerFailure(
  deps: QueueFailureFeedbackDeps,
  conversationId: ConversationId,
  messageId: string,
  error: unknown,
): void {
  deps.logger.error('Failed to steer queued message', {
    conversationId,
    messageId,
    error: formatError(error),
  })
  deps.showToast(STEER_FAILURE_TOAST)
}
