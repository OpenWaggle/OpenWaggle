import type * as SqlClient from '@effect/sql/SqlClient'
import {
  type SessionHostRefusalCode,
  sessionHostRefusal,
} from '@shared/domain/session-host-refusals'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { DelegationState } from '@shared/types/session-collaboration'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlDelegationMutationRequest,
  type SessionControlMutationOutcome,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'
import { revisionDeliveryRefusal } from './sqlite-delegation-revision-admission'

export interface ExecuteDelegationInput {
  readonly callerId: string
  /** The live caller, when a transport authenticated it; its own authority is checked too. */
  readonly caller?: LocalSessionCallerIdentity
  readonly request: SessionControlDelegationMutationRequest
  readonly now: number
}

export interface DelegationContractRow {
  readonly id: string
  readonly parent_session_id: string
  readonly child_session_id: string
  readonly state: DelegationState
  readonly current_specification_revision: number
  readonly latest_submission_revision: number
}

export interface DelegationReplayRow {
  readonly request_json: string
  readonly status: string
  readonly outcome_json: string | null
}

export function delegationRepositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

export function delegationResponse(
  input: ExecuteDelegationInput,
  replayed: boolean,
  outcome: SessionControlMutationOutcome,
) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: input.request.requestId,
    idempotencyKey: input.request.idempotencyKey,
    replayed,
    outcome,
  } as const
}

export function delegationOperationScope(input: ExecuteDelegationInput) {
  return `delegation:${input.request.command.delegationId}:actor:${input.request.command.sessionId}`
}

export function rejectedDelegationOutcome(
  input: ExecuteDelegationInput,
  code: SessionHostRefusalCode,
) {
  return {
    operation: input.request.command.operation,
    effect: 'rejected',
    sessionId: input.request.command.sessionId,
    ...sessionHostRefusal(code),
  } as const
}

export function updatedDelegationOutcome(
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
  state:
    | 'working'
    | 'waiting'
    | 'needs_attention'
    | 'ready_for_review'
    | 'revision_requested'
    | 'accepted'
    | 'cancelled',
  submissionRevision: number,
  specificationRevision = contract.current_specification_revision,
  specificationChanged = false,
): Extract<SessionControlMutationOutcome, { readonly effect: 'delegation-updated' }> {
  const operation = input.request.command.operation
  if (
    operation === 'delegation-claim' ||
    operation === 'delegation-conflict-acknowledge' ||
    operation === 'delegation-dependency' ||
    operation === 'delegation-propose-amendment' ||
    operation === 'delegation-amend' ||
    operation === 'delegation-verify'
  ) {
    throw delegationRepositoryError('invalid-delegation-updated-operation', { operation })
  }
  return {
    operation,
    effect: 'delegation-updated',
    sessionId: input.request.command.sessionId,
    delegationId: contract.id,
    parentSessionId: contract.parent_session_id,
    workerSessionId: contract.child_session_id,
    delegationState: state,
    specificationRevision,
    submissionRevision,
    ...(specificationChanged ? { specificationChanged: true } : {}),
  } as const
}

/**
 * A command that sends the Worker back to work does so through the reviewer's Follow-up
 * (`delegation-revision-follow-up.ts`), so that Follow-up must be able to reach the Worker: the
 * reviewer may message it, and an idle Worker's Run fits the Worker limits
 * (`revisionDeliveryRefusal`). Otherwise the command is refused: recording it would leave the
 * Worker `revision_requested`, next actor the Worker, with nothing to work on (#454).
 */
export function workerMessageRefusal(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return revisionDeliveryRefusal(sql, {
    callerId: input.callerId,
    ...(input.caller ? { caller: input.caller } : {}),
    workerSessionId: contract.child_session_id,
    operation: input.request.command.operation,
    idempotencyKey: input.request.idempotencyKey,
  }).pipe(Effect.map((code) => (code ? rejectedDelegationOutcome(input, code) : undefined)))
}

/** States in which the parent is the next actor and the Worker waits for it, not on the task. */
const WAITING_ON_PARENT: ReadonlySet<DelegationState> = new Set([
  'ready_for_review',
  'needs_attention',
  'waiting',
])

/**
 * What a task change (`delegation-amend`, `delegation-dependency`) reports when it sends back to
 * work a Worker that had submitted and was waiting for its parent (`ready_for_review`,
 * `needs_attention` or `waiting`): the Delegation moves to `revision_requested`, so the Worker gets
 * a revision request as the reviewer's Follow-up, as for `delegation-request-revision`. A Worker
 * still on the task (`working`, `revision_requested`) gets the new specification in its current or
 * next Run instead, so it is not started twice.
 */
export function taskChangeRevisionRequest(contract: DelegationContractRow) {
  return WAITING_ON_PARENT.has(contract.state) && contract.latest_submission_revision > 0
    ? {
        revisionRequest: {
          parentSessionId: contract.parent_session_id,
          submissionRevision: contract.latest_submission_revision,
        },
      }
    : {}
}

/** `workerMessageRefusal` for a task change, only when it sends the Worker back to work. */
export function taskChangeMessageRefusal(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return 'revisionRequest' in taskChangeRevisionRequest(contract)
    ? workerMessageRefusal(sql, input, contract)
    : Effect.succeed(undefined)
}
