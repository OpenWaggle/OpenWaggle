import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import * as Effect from 'effect/Effect'
import { classifyAgentError, makeErrorInfo } from '../../agent/error-classifier'
import { SessionProjectionRepositoryError } from '../../errors'
import { createLogger } from '../../logger'
import { describeError, userFacingErrorDetail } from '../../utils/describe-error'
import { isRunCancellation } from '../run-cancellation'
import type { PersistedRunResourceNodes } from '../session-resource-node-mapping'
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
  readonly resources?: PersistedRunResourceNodes
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
  const resources = { resourceMessages, resourceNodeIds, resourceBranchIds }
  if (signal.aborted || agentResult.aborted) {
    return {
      outcome: 'aborted',
      ...(resourceMessages.length > 0 ? resources : {}),
      ...(assignedTitle ? { assignedTitle } : {}),
    }
  }
  if (agentResult.terminalError) {
    return terminalErrorOutcome(agentResult.terminalError, {
      sessionId,
      runId,
      model,
      assignedTitle,
      resources,
    })
  }
  if (agentResult.newMessages.length === 0) {
    return {
      outcome: 'aborted',
      ...(resourceMessages.length > 0 ? resources : {}),
      ...(assignedTitle ? { assignedTitle } : {}),
    }
  }
  return {
    outcome: 'success',
    newMessages: agentResult.newMessages,
    ...resources,
    ...(assignedTitle ? { assignedTitle } : {}),
  }
}

/*
 * A turn that could not be saved, as opposed to any other failure after the agent answered.
 *
 * Only the snapshot write itself qualifies: a later projection write, such as anchoring the turn
 * checkpoint, fails after the turn is already durable, and reporting that as "couldn't be saved"
 * would offer a retry for a reply that survives a reload.
 */
function isSnapshotPersistenceFailure(error: unknown, reachedAgent: boolean) {
  return (
    reachedAgent &&
    error instanceof SessionProjectionRepositoryError &&
    error.operation === 'persistSessionSnapshot'
  )
}

/**
 * Classifies a failed classic or Waggle run from its original error (ADR 0037).
 *
 * Tagged repository errors carry an empty `message`; `classifyAgentError` describes those by tag,
 * operation, and cause, while plain errors keep their exact message so patterns such as
 * `terminated` still classify.
 */
export function classifyRunFailure(error: unknown, reachedAgent: boolean) {
  const detail = describeError(error)
  if (isSnapshotPersistenceFailure(error, reachedAgent)) {
    return { classified: makeErrorInfo('persist-failed', detail), detail }
  }
  // Exact message first; a generic wrapper ("request failed") falls back to its described causes.
  const direct = classifyAgentError(error)
  const classified = direct.code === 'unknown' ? classifyAgentError(new Error(detail)) : direct
  return { classified, detail }
}

export function recoverAgentRunFailure({
  error,
  signal,
  assignedTitle,
  sessionId,
  runId,
  model,
  reachedAgent = false,
  resources,
}: BuildAgentRunFailureInput): Effect.Effect<AgentRunResult> {
  if (isRunCancellation(error, signal)) {
    return Effect.succeed({
      outcome: 'aborted' as const,
      ...(resources && resources.resourceMessages.length > 0 ? resources : {}),
      ...(assignedTitle ? { assignedTitle } : {}),
    })
  }
  const { classified, detail } = classifyRunFailure(error, reachedAgent)
  logger.error('Agent run failed before terminal transport event', {
    sessionId,
    runId,
    model,
    code: classified.code,
    error: detail,
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  })
  return Effect.succeed({
    outcome: 'error' as const,
    // The renderer derives the headline from `code`; the message is the detail it shows under it.
    message: userFacingErrorDetail(classified.message),
    code: classified.code,
    /*
     * Marked when the agent already had the message, so a caller is not told a delivered message was refused.
     * Persisting the turn happens after the kernel returns, and a database write failure there is a typed
     * failure recovered here - which used to be indistinguishable from a refusal raised before the prompt was
     * ever sent.
     */
    ...(reachedAgent ? { transportEmitted: true } : {}),
    ...(resources && resources.resourceMessages.length > 0 ? resources : {}),
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
    readonly resources: PersistedRunResourceNodes
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
    message: userFacingErrorDetail(classified.message),
    code: classified.code,
    transportEmitted: true,
    ...(context.resources.resourceMessages.length > 0 ? context.resources : {}),
    ...(context.assignedTitle ? { assignedTitle: context.assignedTitle } : {}),
  }
}
