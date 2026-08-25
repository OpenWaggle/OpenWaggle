import * as Effect from 'effect/Effect'
import { classifyAgentError } from '../../agent/error-classifier'
import { createLogger } from '../../logger'

const logger = createLogger('waggle-run-outcome')

interface WaggleRunFailure {
  readonly error: unknown
  readonly input: { readonly sessionId: unknown; readonly runId: string }
  readonly reachedAgent: () => boolean
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
export function recoverWaggleRunFailure(failure: WaggleRunFailure) {
  return Effect.sync(() => {
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
