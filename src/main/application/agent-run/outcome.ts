import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { classifyAgentError } from '../../agent/error-classifier'
import { createLogger } from '../../logger'
import type { AgentRunResult } from './types'

const logger = createLogger('agent-run-service')

interface AgentKernelOutcomeInput {
  readonly terminalError?: string | null
  readonly aborted?: boolean
  readonly newMessages: readonly Message[]
}

interface BuildAgentRunOutcomeInput {
  readonly agentResult: AgentKernelOutcomeInput
  readonly signal: AbortSignal
  readonly assignedTitle?: string
  readonly sessionId: SessionId
  readonly runId: string
  readonly model: SupportedModelId
}

interface BuildAgentRunFailureInput {
  readonly error: unknown
  readonly assignedTitle?: string
  readonly sessionId: SessionId
  readonly runId: string
  readonly model: SupportedModelId
}

export function buildAgentRunOutcome({
  agentResult,
  signal,
  assignedTitle,
  sessionId,
  runId,
  model,
}: BuildAgentRunOutcomeInput): AgentRunResult {
  if (agentResult.terminalError) {
    return terminalErrorOutcome(agentResult.terminalError, {
      sessionId,
      runId,
      model,
      assignedTitle,
    })
  }
  if (signal.aborted || agentResult.aborted || agentResult.newMessages.length === 0) {
    return { outcome: 'aborted', ...(assignedTitle ? { assignedTitle } : {}) }
  }
  return {
    outcome: 'success',
    newMessages: agentResult.newMessages,
    ...(assignedTitle ? { assignedTitle } : {}),
  }
}

export function recoverAgentRunFailure({
  error,
  assignedTitle,
  sessionId,
  runId,
  model,
}: BuildAgentRunFailureInput): Effect.Effect<AgentRunResult> {
  if (error instanceof Error && error.message === 'aborted') {
    return Effect.succeed({
      outcome: 'aborted' as const,
      ...(assignedTitle ? { assignedTitle } : {}),
    })
  }
  const classified = classifyAgentError(error)
  logger.error('Agent run failed before terminal transport event', {
    sessionId,
    runId,
    model,
    code: classified.code,
    error: formatErrorMessage(error),
  })
  return Effect.succeed({
    outcome: 'error' as const,
    message: classified.userMessage,
    code: classified.code,
    ...(assignedTitle ? { assignedTitle } : {}),
  })
}

function terminalErrorOutcome(
  terminalError: string,
  context: {
    readonly sessionId: SessionId
    readonly runId: string
    readonly model: SupportedModelId
    readonly assignedTitle?: string
  },
): AgentRunResult {
  const classified = classifyAgentError(new Error(terminalError))
  logger.error('Agent run ended with terminal error', {
    sessionId: context.sessionId,
    runId: context.runId,
    model: context.model,
    code: classified.code,
    error: terminalError,
  })
  return {
    outcome: 'error',
    message: classified.userMessage,
    code: classified.code,
    transportEmitted: true,
    ...(context.assignedTitle ? { assignedTitle: context.assignedTitle } : {}),
  }
}
