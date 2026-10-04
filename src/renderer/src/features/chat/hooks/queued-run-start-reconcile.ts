import type { QueryClient } from '@tanstack/react-query'
import { useQueuedRunStartStore } from '@/features/chat/state/queued-run-start-store'
import { createRendererLogger } from '@/shared/lib/logger'
import { sessionFollowUpQueueOptions } from './useSessionFollowUpQueue'

const logger = createRendererLogger('queued-run-start-reconcile')

/**
 * After a Session Host resync, re-reads the queue of every Session still marked as starting a
 * queued Run and drops the mark where the Host reports no active Run. Marks clear on that Run's
 * `agent_start`, terminal event, or `run-completed`; a resync means some of those may be lost,
 * and a lost event must never leave the Session's pickers locked. Call after the resync
 * invalidated the queue queries, so each read is fresh.
 */
export async function reconcileQueuedRunStarts(queryClient: QueryClient): Promise<void> {
  const marks = [...useQueuedRunStartStore.getState().runIdBySessionId]
  await Promise.all(
    marks.map(async ([sessionId, runId]) => {
      try {
        const queue = await queryClient.query(sessionFollowUpQueueOptions(sessionId))
        if (queue.activeRunId === null)
          useQueuedRunStartStore.getState().settleIdle(sessionId, runId)
      } catch (error) {
        // Unread, the mark stays: its Run's next event or the next resync clears it.
        logger.warn('Could not re-read a queue after a Session Host resync', {
          sessionId: String(sessionId),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }),
  )
}
