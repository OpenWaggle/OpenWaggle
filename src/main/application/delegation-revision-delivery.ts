import type {
  SessionControlFollowUpMutationRequest,
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { delegationRevisionFollowUp } from '../domain/session-control/delegation-revision-follow-up'
import { createLogger } from '../logger'
import { SessionDelegationRepository } from '../ports/session-delegation-repository'
import { publishControlResponse } from './session-control-event-projection'

const logger = createLogger('delegation-revision')

/**
 * After a revision request or reopen sent the Worker back to work (`revision_requested`, next
 * actor the Worker), queue its Host-authored revision request as the reviewer's Follow-up
 * (`delegationRevisionFollowUp`), which starts a Run on an idle Worker and waits behind a busy
 * Worker's current Run. Sent only when the reviewer may message the Worker, checked as Follow-up
 * delivery checks a queued Follow-up's caller, because a Follow-up that starts a Run at once is
 * not checked again. `execute` is Session Control's own command path: this runs after the review
 * committed, outside the parent's serialization, as a separate command on the Worker. A refusal or
 * failure is logged and never fails the review. Does nothing for any other command.
 */
export function sendDelegationRevisionToWorker<R>(input: {
  readonly callerId: string
  readonly review: SessionControlMutationRequest
  readonly response: SessionControlMutationResponse
  readonly execute: (
    request: SessionControlFollowUpMutationRequest,
  ) => Effect.Effect<SessionControlMutationResponse, unknown, R>
}): Effect.Effect<void, never, R | SessionDelegationRepository> {
  const request = delegationRevisionFollowUp(input.review, input.response)
  if (!request) return Effect.void
  const workerSessionId = request.command.sessionId
  const unsent = (details: Readonly<Record<string, unknown>>) =>
    Effect.sync(() =>
      logger.warn('A Delegation revision request did not reach its Worker', {
        workerSessionId,
        ...details,
      }),
    )
  return Effect.gen(function* () {
    const repository = yield* SessionDelegationRepository
    const blocked = repository.messageBlockReason
      ? yield* repository.messageBlockReason({
          sessionId: workerSessionId,
          callerId: input.callerId,
        })
      : 'message-authority-unavailable'
    if (blocked) return yield* unsent({ code: blocked })
    const response = yield* input.execute(request)
    publishControlResponse(response)
    if (response.outcome.effect === 'rejected') yield* unsent({ code: response.outcome.code })
  }).pipe(Effect.catchAllCause((cause) => unsent({ cause: Cause.pretty(cause) })))
}
