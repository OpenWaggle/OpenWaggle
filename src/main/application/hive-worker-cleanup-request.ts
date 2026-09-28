import { SessionId } from '@shared/types/brand'
import type {
  SessionControlDelegationMutationRequest,
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { HiveWorkerCleanup } from '../ports/hive-worker-cleanup'
import { withSessionCommandSerialization } from './session-command-serialization'

/** Commands through which a user or agent resumes a conversation with the addressed Session. */
const RESUMING_CONVERSATION_OPERATIONS: ReadonlySet<
  SessionControlMutationRequest['command']['operation']
> = new Set(['message', 'start', 'follow-up', 'replace', 'steer'])

/** Delegation reviews that send the Worker back to work. */
const RESUMING_DELEGATION_OPERATIONS: ReadonlySet<
  SessionControlDelegationMutationRequest['command']['operation']
> = new Set(['delegation-reopen', 'delegation-request-revision'])

/**
 * Ask the Session Host to run a Hive cleanup pass for `sessionId`, if the runtime provides one.
 * Never fails the caller.
 */
export function requestHiveWorkerCleanup(sessionId: SessionId) {
  return Effect.serviceOption(HiveWorkerCleanup).pipe(
    Effect.flatMap((cleanup) =>
      Option.isSome(cleanup) ? cleanup.value.requestReconciliation(sessionId) : Effect.void,
    ),
  )
}

function restoreHiveWorker(input: {
  readonly callerId: string
  readonly sessionId: SessionId
  readonly idempotencyKey: string
}) {
  return Effect.serviceOption(HiveWorkerCleanup).pipe(
    Effect.flatMap((cleanup) =>
      Option.isSome(cleanup) ? cleanup.value.restoreForCommand(input) : Effect.void,
    ),
  )
}

/**
 * After an accepted conversation command from a user or an agent, restore its Session if Hive
 * cleanup archived it. Must run inside that command's Session serialization; never fails it.
 */
export function restoreHiveWorkerAfterCommand(input: {
  readonly callerId: string
  readonly request: SessionControlMutationRequest
  readonly response: SessionControlMutationResponse
}) {
  const { command } = input.request
  if (
    !RESUMING_CONVERSATION_OPERATIONS.has(command.operation) ||
    input.response.replayed ||
    input.response.outcome.effect === 'rejected'
  ) {
    return Effect.void
  }
  return restoreHiveWorker({
    callerId: input.callerId,
    sessionId: SessionId(command.sessionId),
    idempotencyKey: input.request.idempotencyKey,
  })
}

/**
 * After a reopen or revision request sends a Worker back to work, restore that Worker if Hive
 * cleanup archived it. The command runs under its parent Session's serialization, so this takes
 * the Worker's serialization too (always parent before Worker, as lineage is a tree) to order
 * the restore against a concurrent cleanup archive of the Worker. Never fails the command.
 */
export function restoreHiveWorkerAfterDelegationReview(input: {
  readonly callerId: string
  readonly request: SessionControlDelegationMutationRequest
  readonly response: SessionControlMutationResponse
}) {
  const { outcome } = input.response
  if (
    !RESUMING_DELEGATION_OPERATIONS.has(input.request.command.operation) ||
    input.response.replayed ||
    outcome.effect !== 'delegation-updated' ||
    outcome.delegationState !== 'revision_requested'
  ) {
    return Effect.void
  }
  const workerSessionId = SessionId(outcome.workerSessionId)
  return withSessionCommandSerialization(
    workerSessionId,
    restoreHiveWorker({
      callerId: input.callerId,
      sessionId: workerSessionId,
      idempotencyKey: input.request.idempotencyKey,
    }),
  )
}
