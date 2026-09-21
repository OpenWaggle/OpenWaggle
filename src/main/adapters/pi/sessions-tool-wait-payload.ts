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
  if (condition === 'report-delivered') {
    if (!input.reportId) {
      throw new Error('sessions wait requires reportId for report-delivered.')
    }
    const reportId = input.reportId
    return input.sessionIds.map((sessionId) => ({ sessionId, condition, reportId }))
  }
  if (condition === 'correlated-reply') {
    if (!input.correlationId) {
      throw new Error('sessions wait requires correlationId for correlated-reply.')
    }
    const correlationId = input.correlationId
    return input.sessionIds.map((sessionId) => ({
      sessionId,
      condition,
      correlationId,
    }))
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
