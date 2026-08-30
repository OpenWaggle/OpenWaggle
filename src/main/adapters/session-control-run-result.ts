import { getMessageText } from '@shared/types/agent'
import type { AgentRunResult } from '../application/agent-run/types'
import type { SessionControlRunExecutionInput } from '../ports/session-control-run-executor'
import { publishSessionHostEvent } from '../session-host/session-host-events'

export function publishRunFailure(
  input: SessionControlRunExecutionInput,
  result: Extract<AgentRunResult, { outcome: 'error' | 'invalid-model' | 'not-found' }>,
) {
  publishSessionHostEvent({
    kind: 'session-transport',
    sessionId: input.sessionId,
    event: {
      type: 'agent_end',
      runId: input.runId,
      reason: 'error',
      error: { message: result.message, code: result.code },
      timestamp: Date.now(),
    },
  })
}

export function terminalRunResult(result: AgentRunResult, interactionTimedOut: boolean) {
  const latestAssistantMessage =
    result.outcome === 'success'
      ? result.newMessages.findLast((message) => message.role === 'assistant')
      : undefined
  const finalResponse = latestAssistantMessage ? getMessageText(latestAssistantMessage).trim() : ''
  return {
    terminalStatus: interactionTimedOut
      ? ('interrupted-by-interaction-timeout' as const)
      : result.outcome === 'success'
        ? ('completed' as const)
        : result.outcome === 'aborted'
          ? ('interrupted' as const)
          : ('failed' as const),
    ...(finalResponse ? { finalResponse } : {}),
  }
}
