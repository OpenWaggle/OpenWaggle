import { matchBy } from '@diegogbrisa/ts-match'
import { type AgentSendReport, getMessageText, type Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import { classifyAgentError } from '../agent/error-classifier'
import { publishSessionHostEvent } from '../session-host/session-host-events'

interface WaggleValidationErrorResult {
  readonly outcome: 'validation-error'
  readonly message: string
  readonly code: string
}

interface WaggleNotFoundResult {
  readonly outcome: 'not-found'
  readonly message: string
  readonly code: string
}

interface WaggleNoProjectResult {
  readonly outcome: 'no-project'
  readonly message: string
  readonly code: string
}

interface WaggleAbortedResult {
  readonly outcome: 'aborted'
}

interface WaggleErrorResult {
  readonly outcome: 'error'
  readonly message: string
  readonly code: string
  readonly transportEmitted?: boolean
}

interface WaggleSuccessResult {
  readonly outcome: 'success'
  readonly newMessages: readonly Message[]
  readonly lastError?: string
}

export type ExplicitWaggleCommandResult =
  | WaggleValidationErrorResult
  | WaggleNotFoundResult
  | WaggleNoProjectResult
  | WaggleAbortedResult
  | WaggleErrorResult
  | WaggleSuccessResult

export function explicitWaggleTerminalResult(result: ExplicitWaggleCommandResult) {
  if (result.outcome === 'success') {
    const assistant = result.newMessages.findLast((message) => message.role === 'assistant')
    const finalResponse = assistant ? getMessageText(assistant).trim() : ''
    return {
      terminalStatus: 'completed' as const,
      ...(finalResponse ? { finalResponse } : {}),
    }
  }
  return {
    terminalStatus: result.outcome === 'aborted' ? ('interrupted' as const) : ('failed' as const),
  }
}

export function describeExplicitWaggleOutcome(
  result: ExplicitWaggleCommandResult,
): AgentSendReport {
  return matchBy(result, 'outcome')
    .with('success', () => ({ outcome: 'delivered' as const }))
    .with('aborted', () => ({ outcome: 'cancelled' as const }))
    .with('error', (value) =>
      value.transportEmitted === true
        ? { outcome: 'delivered' as const }
        : { outcome: 'refused' as const, message: value.message, code: value.code },
    )
    .otherwise((value) => ({
      outcome: 'refused' as const,
      message: value.message,
      code: value.code,
    }))
}

export function publishExplicitWaggleResult(
  sessionId: SessionId,
  runId: string,
  result: ExplicitWaggleCommandResult,
) {
  matchBy(result, 'outcome')
    .with('validation-error', 'not-found', 'no-project', 'error', (value) =>
      publishWaggleError(sessionId, runId, value.message, value.code),
    )
    .with('aborted', () => publishWaggleEnd(sessionId, runId, 'aborted'))
    .with('success', (value) => publishWaggleSuccess(sessionId, runId, value))
    .exhaustive()
}

function publishWaggleSuccess(sessionId: SessionId, runId: string, result: WaggleSuccessResult) {
  if (result.newMessages.every((message) => message.role !== 'assistant') && result.lastError) {
    const classified = classifyAgentError(new Error(result.lastError))
    publishWaggleError(sessionId, runId, classified.userMessage, classified.code)
    return
  }
  publishWaggleEnd(sessionId, runId, 'stop')
}

function publishWaggleEnd(sessionId: SessionId, runId: string, reason: 'aborted' | 'stop') {
  publishSessionHostEvent({
    kind: 'session-transport',
    sessionId,
    event: { type: 'agent_end', timestamp: Date.now(), runId, reason },
  })
}

function publishWaggleError(sessionId: SessionId, runId: string, message: string, code: string) {
  publishSessionHostEvent({
    kind: 'session-transport',
    sessionId,
    event: {
      type: 'agent_end',
      runId,
      reason: 'error',
      error: { message, code },
      timestamp: Date.now(),
    },
  })
}
