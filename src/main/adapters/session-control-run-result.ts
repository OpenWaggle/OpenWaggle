import { getMessageText } from '@shared/types/agent'
import type { AgentRunResult } from '../application/agent-run/types'
import type { SessionControlRunExecutionInput } from '../ports/session-control-run-executor'
import { describeLocalSessionServerError } from '../session-host/local-session-server-frame'
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

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

/**
 * End a Run that failed before it reached Pi, such as when its authority, execution profile,
 * or project configuration could not be loaded. Without this terminal event the Run settled
 * as failed with no reason any client could show.
 */
export function publishRunStartFailure(input: SessionControlRunExecutionInput, error: unknown) {
  const code = errorCode(error)
  publishSessionHostEvent({
    kind: 'session-transport',
    sessionId: input.sessionId,
    event: {
      type: 'agent_end',
      runId: input.runId,
      reason: 'error',
      error: {
        message: describeLocalSessionServerError(error),
        ...(code ? { code } : {}),
      },
      timestamp: Date.now(),
    },
  })
}

export function terminalRunResult(result: AgentRunResult, interactionTimedOut: boolean) {
  const latestAssistantMessage =
    result.outcome === 'success'
      ? result.newMessages.findLast(
          (message: { readonly role: string }) => message.role === 'assistant',
        )
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
