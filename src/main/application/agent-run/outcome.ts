import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { classifyAgentError } from '../../agent/error-classifier'
import { createLogger } from '../../logger'
import { isRunCancellation } from '../run-cancellation'
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
  readonly resourceMessages?: readonly Message[]
  readonly resourceNodeIds?: Readonly<Record<string, string>>
  readonly resourceBranchIds?: Readonly<Record<string, string | null>>
}

interface BuildAgentRunFailureInput {
  readonly error: unknown
  readonly signal: AbortSignal
  /** Whether the agent already had the message when this failed - see the outcome below. */
  readonly reachedAgent?: boolean
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
  resourceMessages = agentResult.newMessages,
  resourceNodeIds = Object.fromEntries(
    agentResult.newMessages.map((message) => [String(message.id), String(message.id)]),
  ),
  resourceBranchIds = {},
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
    resourceMessages,
    resourceNodeIds,
    resourceBranchIds,
    ...(assignedTitle ? { assignedTitle } : {}),
  }
}

export function recoverAgentRunFailure({
  error,
  signal,
  assignedTitle,
  sessionId,
  runId,
  model,
  reachedAgent = false,
}: BuildAgentRunFailureInput): Effect.Effect<AgentRunResult> {
  if (isRunCancellation(error, signal)) {
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
    /*
     * Marked when the agent already had the message, so a caller is not told a delivered message was refused.
     * Persisting the turn happens after the kernel returns, and a database write failure there is a typed
     * failure recovered here - which used to be indistinguishable from a refusal raised before the prompt was
     * ever sent.
     */
    ...(reachedAgent ? { transportEmitted: true } : {}),
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
