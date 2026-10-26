import { hivePendingRequestOf, strongerPendingRequest } from '@shared/domain/hive-next-actor'
import type { HivePendingRequest } from '@shared/types/hive-next-actor'
import { listPendingAgentLoopInteractions } from './agent-loop-interaction-broker'

/**
 * The requests Runs have parked for the person, by Session (ADR 0059). They live in the Host
 * process only: a Host restart ends every Run, and with it every parked request.
 */
export function hivePendingRequestsBySession(): ReadonlyMap<string, HivePendingRequest> {
  const bySession = new Map<string, HivePendingRequest>()
  for (const interaction of listPendingAgentLoopInteractions()) {
    const sessionId = String(interaction.sessionId)
    const request = strongerPendingRequest(
      bySession.get(sessionId),
      hivePendingRequestOf(interaction),
    )
    if (request !== null) bySession.set(sessionId, request)
  }
  return bySession
}
