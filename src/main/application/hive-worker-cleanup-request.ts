import { SessionId } from '@shared/types/brand'
import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { HiveWorkerCleanup } from '../ports/hive-worker-cleanup'
import { isHiveAgentCaller } from '../ports/hive-worker-cleanup-repository'

/** Commands through which a user talks to a Session. */
const USER_CONVERSATION_OPERATIONS: ReadonlySet<
  SessionControlMutationRequest['command']['operation']
> = new Set(['message', 'start', 'follow-up', 'replace', 'steer'])

/**
 * Ask the Session Host to run a Hive cleanup pass for `sessionId`, if the runtime provides one.
 * Callers stay independent of the archive machinery and never fail because of cleanup.
 */
export function requestHiveWorkerCleanup(sessionId: SessionId) {
  return Effect.serviceOption(HiveWorkerCleanup).pipe(
    Effect.flatMap((cleanup) =>
      Option.isSome(cleanup) ? cleanup.value.requestReconciliation(sessionId) : Effect.void,
    ),
  )
}

/**
 * After a user's accepted conversation command, restore its Session if Hive cleanup archived it.
 * Must run inside that command's Session serialization; never fails the command.
 */
export function restoreHiveWorkerAfterUserCommand(input: {
  readonly callerId: string
  readonly request: SessionControlMutationRequest
  readonly response: SessionControlMutationResponse
}) {
  const { command } = input.request
  if (
    isHiveAgentCaller(input.callerId) ||
    !USER_CONVERSATION_OPERATIONS.has(command.operation) ||
    input.response.replayed ||
    input.response.outcome.effect === 'rejected'
  ) {
    return Effect.void
  }
  return Effect.serviceOption(HiveWorkerCleanup).pipe(
    Effect.flatMap((cleanup) =>
      Option.isSome(cleanup)
        ? cleanup.value.restoreForUserCommand({
            callerId: input.callerId,
            sessionId: SessionId(command.sessionId),
            idempotencyKey: input.request.idempotencyKey,
          })
        : Effect.void,
    ),
  )
}
