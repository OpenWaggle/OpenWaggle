import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'
import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import { SessionDelegationRepository } from '../ports/session-delegation-repository'
import { updateDelegationCoordination } from './sqlite-session-delegation-coordination'
import { reviewDelegation } from './sqlite-session-delegation-review'
import { updateDelegationState } from './sqlite-session-delegation-state'
import {
  type DelegationContractRow,
  type DelegationReplayRow,
  delegationOperationScope,
  delegationRepositoryError,
  delegationResponse,
  type ExecuteDelegationInput,
  rejectedDelegationOutcome,
  updatedDelegationOutcome,
} from './sqlite-session-delegation-support'

function storeOutcome(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  requestJson: string,
  outcome: SessionControlMutationOutcome,
) {
  return sql`
    INSERT INTO session_operations (
      caller_id, operation, target_scope, idempotency_key, request_json,
      status, outcome_json, created_at, updated_at
    ) VALUES (
      ${input.callerId}, ${input.request.command.operation}, ${delegationOperationScope(input)},
      ${input.request.idempotencyKey}, ${requestJson}, ${'completed'},
      ${JSON.stringify(outcome)}, ${input.now}, ${input.now}
    )
  `
}

function findReplay(sql: SqlClient.SqlClient, input: ExecuteDelegationInput, requestJson: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<DelegationReplayRow>`
      SELECT request_json, status, outcome_json FROM session_operations
      WHERE caller_id = ${input.callerId}
        AND operation = ${input.request.command.operation}
        AND target_scope = ${delegationOperationScope(input)}
        AND idempotency_key = ${input.request.idempotencyKey}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return undefined
    if (row.request_json !== requestJson || row.status !== 'completed' || !row.outcome_json) {
      return yield* Effect.fail(
        delegationRepositoryError('delegation-idempotency-conflict', { row }),
      )
    }
    return delegationResponse(
      input,
      true,
      decodeSessionControlMutationOutcome(JSON.parse(row.outcome_json)),
    )
  })
}

function loadContract(sql: SqlClient.SqlClient, delegationId: string) {
  return sql<DelegationContractRow>`
    SELECT contracts.id, contracts.parent_session_id, contracts.child_session_id,
      contracts.state, contracts.current_specification_revision,
      COALESCE(MAX(submissions.revision), 0) AS latest_submission_revision
    FROM delegation_contracts AS contracts
    LEFT JOIN delegation_submissions AS submissions ON submissions.delegation_id = contracts.id
    WHERE contracts.id = ${delegationId}
    GROUP BY contracts.id
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]))
}

function submitDelegation(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (command.operation !== 'delegation-submit') return undefined
    if (command.sessionId !== contract.child_session_id) {
      return rejectedDelegationOutcome(input, 'worker_required')
    }
    if (!['working', 'waiting', 'needs_attention', 'revision_requested'].includes(contract.state)) {
      return rejectedDelegationOutcome(input, 'delegation_not_contributable')
    }
    if (command.summary.trim().length === 0) {
      return rejectedDelegationOutcome(input, 'submission_empty')
    }
    const revision = contract.latest_submission_revision + 1
    yield* sql`
      INSERT INTO delegation_submissions (
        delegation_id, revision, specification_revision, summary, submitted_by,
        provenance, created_at
      ) VALUES (
        ${contract.id}, ${revision}, ${contract.current_specification_revision},
        ${command.summary}, ${input.callerId}, ${'agent-submitted'}, ${input.now}
      )
    `
    for (const [ordinal, evidence] of command.evidence.entries()) {
      yield* sql`
        INSERT INTO delegation_evidence (
          delegation_id, submission_revision, ordinal, kind, summary,
          reference, provenance_json, created_at
        ) VALUES (
          ${contract.id}, ${revision}, ${ordinal}, ${evidence.kind}, ${evidence.summary},
          ${evidence.reference ?? null},
          ${evidence.provenance ? JSON.stringify(evidence.provenance) : null}, ${input.now}
        )
      `
    }
    yield* sql`
      UPDATE delegation_contracts SET state = ${'ready_for_review'}, updated_at = ${input.now}
      WHERE id = ${contract.id}
    `
    return updatedDelegationOutcome(input, contract, 'ready_for_review', revision)
  })
}

function transitionDelegation(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (command.operation !== 'delegation-reopen' && command.operation !== 'delegation-cancel') {
      return undefined
    }
    if (command.sessionId !== contract.parent_session_id) {
      return rejectedDelegationOutcome(input, 'parent_required')
    }
    if (command.reason.trim().length === 0) {
      return rejectedDelegationOutcome(input, 'transition_reason_required')
    }
    if (command.operation === 'delegation-reopen' && contract.state !== 'accepted') {
      return rejectedDelegationOutcome(input, 'delegation_not_accepted')
    }
    if (
      command.operation === 'delegation-cancel' &&
      (contract.state === 'accepted' || contract.state === 'cancelled')
    ) {
      return rejectedDelegationOutcome(input, 'delegation_not_cancellable')
    }
    const state = command.operation === 'delegation-reopen' ? 'revision_requested' : 'cancelled'
    yield* sql`
      INSERT INTO delegation_state_transitions (
        delegation_id, from_state, to_state, reason,
        actor_session_id, authored_by, created_at
      ) VALUES (
        ${contract.id}, ${contract.state}, ${state}, ${command.reason},
        ${command.sessionId}, ${input.callerId}, ${input.now}
      )
    `
    if (command.operation === 'delegation-reopen') {
      yield* sql`
        INSERT INTO delegation_reviews (
          delegation_id, submission_revision, decision, feedback,
          reviewer_session_id, reviewed_by, specification_revision, created_at
        ) VALUES (
          ${contract.id}, ${contract.latest_submission_revision}, ${'revision_requested'},
          ${command.reason}, ${command.sessionId}, ${input.callerId},
          ${contract.current_specification_revision}, ${input.now}
        )
      `
    }
    yield* sql`
      UPDATE delegation_contracts SET state = ${state}, updated_at = ${input.now}
      WHERE id = ${contract.id}
    `
    return updatedDelegationOutcome(input, contract, state, contract.latest_submission_revision)
  })
}

function execute(sql: SqlClient.SqlClient, input: ExecuteDelegationInput) {
  const requestJson = canonicalJson(input.request.command)
  return sql.withTransaction(
    Effect.gen(function* () {
      const replay = yield* findReplay(sql, input, requestJson)
      if (replay) return replay
      const contract = yield* loadContract(sql, input.request.command.delegationId)
      let outcome: SessionControlMutationOutcome | undefined = contract
        ? yield* transitionDelegation(sql, input, contract)
        : rejectedDelegationOutcome(input, 'delegation_not_found')
      if (outcome === undefined && contract) outcome = yield* submitDelegation(sql, input, contract)
      if (outcome === undefined && contract) {
        outcome = yield* updateDelegationCoordination(sql, input, contract)
      }
      if (outcome === undefined && contract) {
        outcome = yield* updateDelegationState(sql, input, contract)
      }
      if (outcome === undefined && contract) outcome = yield* reviewDelegation(sql, input, contract)
      if (outcome === undefined) {
        outcome = rejectedDelegationOutcome(input, 'delegation_operation_invalid')
      }
      yield* storeOutcome(sql, input, requestJson, outcome)
      return delegationResponse(input, false, outcome)
    }),
  )
}

export const SqliteSessionDelegationRepositoryLive = Layer.effect(
  SessionDelegationRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionDelegationRepository.of({
      execute: (input) =>
        execute(sql, input).pipe(
          Effect.mapError((cause) =>
            cause instanceof SessionControlRepositoryError
              ? cause
              : delegationRepositoryError('execute-delegation', cause),
          ),
        ),
    })
  }),
)
