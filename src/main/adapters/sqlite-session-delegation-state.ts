import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  type DelegationContractRow,
  type ExecuteDelegationInput,
  rejectedDelegationOutcome,
  updatedDelegationOutcome,
} from './sqlite-session-delegation-support'
import { recordWorkerOrchestrationUpdate } from './sqlite-session-orchestration-update-insert'

export function updateDelegationState(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (command.operation !== 'delegation-state') return undefined
    if (command.sessionId !== contract.child_session_id) {
      return rejectedDelegationOutcome(input, 'worker_required')
    }
    if (contract.state === 'accepted' || contract.state === 'cancelled') {
      return rejectedDelegationOutcome(input, 'delegation_terminal')
    }
    if (command.reason.trim().length === 0) {
      return rejectedDelegationOutcome(input, 'transition_reason_required')
    }
    // The Worker's own needs_attention asks its parent for help (ADR 0059); any other state it
    // sets, `working` included, ends that request.
    yield* sql`
      INSERT INTO delegation_state_transitions (
        delegation_id, from_state, to_state, reason,
        actor_session_id, authored_by, created_at
      ) VALUES (
        ${contract.id}, ${contract.state}, ${command.state}, ${command.reason},
        ${command.sessionId}, ${input.callerId}, ${input.now}
      )
    `
    yield* sql`
      UPDATE delegation_contracts
      SET state = ${command.state},
        attention_cause = ${command.state === 'needs_attention' ? 'worker_request' : null},
        updated_at = ${input.now}
      WHERE id = ${contract.id}
    `
    if (command.state === 'needs_attention') {
      // The Worker asks its parent for help: the parent hears about it like a result (ADR 0059).
      yield* recordWorkerOrchestrationUpdate(sql, {
        delegationId: contract.id,
        parentSessionId: contract.parent_session_id,
        workerSessionId: contract.child_session_id,
        state: 'needs_attention',
        cause: `worker-request-${input.now}`,
        summary: command.reason,
        now: input.now,
        triggerCallerId: input.callerId,
      })
    }
    return updatedDelegationOutcome(
      input,
      contract,
      command.state,
      contract.latest_submission_revision,
    )
  })
}
