import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { WaggleConfig } from '@shared/types/waggle'
import { MessageNotDelivered } from '@/features/chat/lib'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useFirstSendPendingStore } from '@/features/chat/state/first-send-pending-store'
import { useOptimisticUserMessageStore } from '@/features/chat/state/optimistic-user-message-store'
import { useWaggleStore } from '@/features/waggle/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { refusalLeavesNothingToRecover } from './useAgentChat.send-without-run'

const logger = createRendererLogger('use-send-message')

/** Ends a first send that failed, before its failure goes back to the caller. */
export function endFailedFirstSend(
  sessionId: SessionId,
  config: WaggleConfig | null,
  optimisticMessageId: UIMessage['id'],
  error: unknown,
) {
  useFirstSendPendingStore.getState().clear(sessionId)
  if (config) useWaggleStore.getState().stopCollaboration(sessionId)
  const outcome = error instanceof MessageNotDelivered ? error.outcome : undefined
  if (outcome === 'cancelled') useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId)
  // Back in the composer: it leaves the transcript too. The composer logs the refusal.
  if (refusalLeavesNothingToRecover(sessionId, error)) {
    useBackgroundRunStore.getState().setFirstSendRecovery(sessionId, null)
    useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId)
    useOptimisticUserMessageStore.getState().remove(sessionId, optimisticMessageId)
    return
  }
  logger.error('First message send failed', {
    sessionId: String(sessionId),
    error: error instanceof Error ? error.message : String(error),
  })
}
