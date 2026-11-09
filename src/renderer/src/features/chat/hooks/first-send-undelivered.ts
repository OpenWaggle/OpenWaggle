import type { SessionId } from '@shared/types/brand'
import { MessageNotDelivered } from '@/features/chat/lib'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useOptimisticUserMessageStore } from '@/features/chat/state/optimistic-user-message-store'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('use-send-message')

/**
 * Clears what a first send that reached no agent left: a cancellation's render snapshot, and for
 * a refusal the message too, which goes back to the composer, and its launch recovery, as there
 * is no launch to recover. A refusal is expected and the composer says why, so it is a warning.
 */
export function forgetUndeliveredFirstSend(
  sessionId: SessionId,
  optimisticId: string,
  error: unknown,
) {
  const undelivered = error instanceof MessageNotDelivered ? error.outcome : undefined
  if (undelivered) useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId)
  if (undelivered === 'refused') {
    useBackgroundRunStore.getState().setFirstSendRecovery(sessionId, null)
    useOptimisticUserMessageStore.getState().remove(sessionId, optimisticId)
  }
  const log = undelivered === 'refused' ? logger.warn : logger.error
  log('First message send failed', {
    sessionId: String(sessionId),
    error: error instanceof Error ? error.message : String(error),
  })
}
