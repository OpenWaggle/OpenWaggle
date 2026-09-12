import * as Effect from 'effect/Effect'
import { classifyAgentError, makeErrorInfo } from '../../agent/error-classifier'
import { createLogger } from '../../logger'
import type { AgentKernelRunResult } from '../../ports/agent-kernel-service'
import { isRunCancellation } from '../run-cancellation'

const logger = createLogger('waggle-run-outcome')

export function waggleValidationErrorOutcome() {
  return {
    outcome: 'validation-error' as const,
    message: 'Invalid Waggle mode configuration',
    code: 'validation-error',
  }
}

export function waggleSessionNotFoundOutcome() {
  const errorInfo = makeErrorInfo('session-not-found', 'Session not found')
  return {
    outcome: 'not-found' as const,
    message: errorInfo.userMessage,
    code: errorInfo.code,
  }
}

export function waggleNoProjectOutcome() {
  return {
    outcome: 'no-project' as const,
    message: 'Please select a project folder before starting Waggle mode.',
    code: 'no-project',
  }
}

export function waggleNoInheritedModelOutcome() {
  return {
    outcome: 'validation-error' as const,
    message: 'Select a model before starting Waggle mode.',
    code: 'validation-error',
  }
}

interface WaggleRunFailure {
  readonly error: unknown
  readonly input: {
    readonly sessionId: unknown
    readonly runId: string
    readonly signal: AbortSignal
  }
  readonly reachedAgent: () => boolean
}

type WaggleRunFailureOutcome =
  | { readonly outcome: 'aborted' }
  | {
      readonly outcome: 'error'
      readonly message: string
      readonly code: ReturnType<typeof classifyAgentError>['code']
      readonly transportEmitted?: true
    }

/**
 * Turn a failed Waggle run into a reported outcome, as the classic path does.
 *
 * Without this a kernel failure - a session whose worktree has gone, a failed `worktree add`, a provider error -
 * failed the Effect, so the invoke rejected and the caller learned nothing about *why*: it could not tell a
 * refusal it should report from a turn that ran and then failed. Those need opposite handling for work submitted
 * alongside the message, which is why `transportEmitted` is carried here too: set, it means the agent took the
 * turn and already has the message, so handing that work back would offer it twice.
 */
export function recoverWaggleRunFailure(
  failure: WaggleRunFailure,
): Effect.Effect<WaggleRunFailureOutcome> {
  return Effect.sync((): WaggleRunFailureOutcome => {
    if (isRunCancellation(failure.error, failure.input.signal)) {
      return { outcome: 'aborted' }
    }
    const classified = classifyAgentError(failure.error)
    const reachedAgent = failure.reachedAgent()
    logger.error('Waggle run failed', {
      sessionId: String(failure.input.sessionId),
      runId: failure.input.runId,
      code: classified.code,
      reachedAgent,
    })
    return {
      outcome: 'error' as const,
      message: classified.userMessage,
      code: classified.code,
      ...(reachedAgent ? { transportEmitted: true } : {}),
    }
  })
}

export function createWaggleSuccessOutcome(input: {
  readonly sessionId: unknown
  readonly assignedTitle?: string
  readonly result: AgentKernelRunResult
}) {
  logger.info('Pi-native Waggle collaboration finished', {
    sessionId: input.sessionId,
    aborted: input.result.aborted ?? false,
    terminalError: input.result.terminalError ?? null,
    assistantMessages: input.result.newMessages.filter((message) => message.role === 'assistant')
      .length,
  })
  return {
    outcome: 'success' as const,
    newMessages: input.result.newMessages,
    ...(input.result.terminalError ? { lastError: input.result.terminalError } : {}),
    ...(input.assignedTitle ? { assignedTitle: input.assignedTitle } : {}),
  }
}
