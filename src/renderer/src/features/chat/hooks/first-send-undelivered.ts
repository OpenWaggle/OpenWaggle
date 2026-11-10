import type { SessionId } from '@shared/types/brand'
import { MessageNotDelivered } from '@/features/chat/lib'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useOptimisticUserMessageStore } from '@/features/chat/state/optimistic-user-message-store'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('use-send-message')

/**
 * Clears what a first send that reached no agent left: a cancellation's render snapshot, and for
 * a refusal the message too, which goes back to the composer, and its first-send recovery. A
 * worktree launch keeps all of it: its row owns the message then (Retry, Work locally, Cancel),
 * and the composer does not take the draft back. A refusal is expected and the composer says why,
 * so it is a warning.
 */
export function forgetUndeliveredFirstSend(
  sessionId: SessionId,
  optimisticId: string,
  error: unknown,
) {
  const undelivered = error instanceof MessageNotDelivered ? error.outcome : undefined
  const runs = useBackgroundRunStore.getState()
  if (undelivered === 'cancelled') runs.clearRunRenderSnapshot(sessionId)
  if (undelivered === 'refused' && runs.getWorktreeLaunch(sessionId) === null) {
    runs.clearRunRenderSnapshot(sessionId)
    runs.setFirstSendRecovery(sessionId, null)
    useOptimisticUserMessageStore.getState().remove(sessionId, optimisticId)
  }
  const log = undelivered === 'refused' ? logger.warn : logger.error
  log('First message send failed', {
    sessionId: String(sessionId),
    error: error instanceof Error ? error.message : String(error),
  })
}

/**
 * A refused first message in a Session that already exists goes back to the composer, which
 * restores it there whatever launch it had. So nothing else may offer to send it again: its
 * first-send recovery and its worktree launch row (Retry, Work locally) both go, or the message
 * could be sent twice.
 */
export function forgetRefusedFirstMessage(
  error: unknown,
  sessionId: SessionId,
  setFirstSendRecovery: (sessionId: SessionId, recovery: null) => void,
) {
  if (!(error instanceof MessageNotDelivered) || error.outcome !== 'refused') return
  setFirstSendRecovery(sessionId, null)
  const runs = useBackgroundRunStore.getState()
  if (runs.getWorktreeLaunch(sessionId) !== null) runs.setWorktreeLaunch(sessionId, null)
}
