import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  type DelegationContractRow,
  type ExecuteDelegationInput,
  rejectedDelegationOutcome,
  updatedDelegationOutcome,
} from './sqlite-session-delegation-support'

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
      UPDATE delegation_contracts SET state = ${command.state}, updated_at = ${input.now}
      WHERE id = ${contract.id}
    `
    return updatedDelegationOutcome(
      input,
      contract,
      command.state,
      contract.latest_submission_revision,
    )
  })
}
