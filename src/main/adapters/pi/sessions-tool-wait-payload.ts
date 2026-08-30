import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import type { SessionsToolParameters } from './sessions-tool-parameters'

function waitTargets(input: Extract<SessionsToolParameters, { action: 'wait' }>) {
  const condition = input.condition ?? 'idle'
  if (condition === 'state-revision-after') {
    if (input.afterStateRevision === undefined) {
      throw new Error('sessions wait requires afterStateRevision for state-revision-after.')
    }
    return input.sessionIds.map((sessionId) => ({
      sessionId,
      condition,
      afterStateRevision: input.afterStateRevision ?? 0,
    }))
  }
  if (condition === 'queue-empty') {
    return input.sessionIds.map((sessionId) => ({ sessionId, condition }))
  }
  return input.sessionIds.map((sessionId) => ({ sessionId, condition: 'idle' as const }))
}

export function buildSessionsToolWaitPayload(
  input: Extract<SessionsToolParameters, { action: 'wait' }>,
): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: { operation: 'wait', targets: waitTargets(input), timeoutMs: input.timeoutMs },
    },
  }
}
