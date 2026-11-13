import type * as SqlClient from '@effect/sql/SqlClient'
import {
  type SessionHostRefusalCode,
  sessionHostRefusal,
} from '@shared/domain/session-host-refusals'
import type { DelegationState } from '@shared/types/session-collaboration'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlDelegationMutationRequest,
  type SessionControlMutationOutcome,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'
import { messageCallerBlockReason } from './session-follow-up-authorization'

export interface ExecuteDelegationInput {
  readonly callerId: string
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
 * A revision request or reopen sends the Worker back to work through the reviewer's Follow-up
 * (`delegation-revision-follow-up.ts`), so the reviewer must be allowed to message the Worker, by
 * the check queued Follow-up delivery makes. Otherwise the review is refused: recording it would
 * leave the Worker `revision_requested`, next actor the Worker, with nothing to work on (#454).
 */
export function workerMessageRefusal(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return messageCallerBlockReason(sql, contract.child_session_id, input.callerId).pipe(
    Effect.map((blocked) =>
      blocked ? rejectedDelegationOutcome(input, 'worker_message_denied') : undefined,
    ),
  )
}
