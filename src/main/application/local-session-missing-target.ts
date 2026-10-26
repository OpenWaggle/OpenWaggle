import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { SessionAuthorizationTargetRepositoryError } from '../errors'

type MissingTargetCode = 'session_not_found' | 'delegation_not_found'

function missingTargetCode(error: unknown): MissingTargetCode | undefined {
  if (!(error instanceof SessionAuthorizationTargetRepositoryError)) return undefined
  if (error.operation === 'session-not-found') return 'session_not_found'
  if (error.operation === 'delegation-not-found') return 'delegation_not_found'
  return undefined
}

function isMissingTarget(error: unknown): error is SessionAuthorizationTargetRepositoryError {
  return missingTargetCode(error) !== undefined
}

const MISSING_TARGET_MESSAGE: Readonly<Record<MissingTargetCode, string>> = {
  session_not_found: 'The Session was not found.',
  delegation_not_found: 'The Delegation was not found.',
}

/**
 * The one not-found answer of every Session Control action (#351): the structured refusal of
 * its own contract, `outcome.error.code` for a query and a `rejected` outcome for a command,
 * with `session_not_found` or `delegation_not_found`. Before, only some queries answered so and
 * other actions failed with the raw repository tag.
 *
 * An ID that exists outside the caller's scope still answers `target_scope_denied`. Session and
 * Delegation IDs are random UUIDs, so telling the two apart reveals nothing about an ID the caller
 * did not already hold, and the precise answer tells a script whether to retry with more access.
 */
export function missingTargetResult(
  payload: LocalSessionCommandPayload,
  code: MissingTargetCode,
): LocalSessionCommandResult | undefined {
  if (payload.contract === 'session-query-v2') {
    return {
      contract: 'session-query-v2',
      response: {
        contractVersion: payload.request.contractVersion,
        requestId: payload.request.requestId,
        outcome: {
          operation: payload.request.query.operation,
          error: { code, message: MISSING_TARGET_MESSAGE[code] },
        },
      },
    }
  }
  if (payload.contract === 'session-control-v2') {
    return {
      contract: 'session-control-v2',
      response: {
        contractVersion: payload.request.contractVersion,
        requestId: payload.request.requestId,
        idempotencyKey: payload.request.idempotencyKey,
        replayed: false,
        outcome: {
          operation: payload.request.command.operation,
          effect: 'rejected',
          sessionId: payload.request.command.sessionId,
          code,
        },
      },
    }
  }
  if (payload.contract === 'session-lifecycle-v2') {
    return {
      contract: 'session-lifecycle-v2',
      response: {
        contractVersion: payload.request.contractVersion,
        requestId: payload.request.requestId,
        idempotencyKey: payload.request.idempotencyKey,
        replayed: false,
        outcome: {
          operation: payload.request.command.operation,
          effect: 'rejected',
          code,
          retryable: false,
        },
      },
    }
  }
  return undefined
}

/** Answers a missing Session or Delegation target with `missingTargetResult`. */
export function answerMissingTarget(payload: LocalSessionCommandPayload) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchIf(isMissingTarget, (error) => {
        const code = missingTargetCode(error)
        const result = code ? missingTargetResult(payload, code) : undefined
        return result ? Effect.succeed(result) : Effect.fail(error)
      }),
    )
}
