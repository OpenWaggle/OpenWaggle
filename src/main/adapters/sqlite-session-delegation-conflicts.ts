import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import {
  type DelegationContractRow,
  type ExecuteDelegationInput,
  rejectedDelegationOutcome,
} from './sqlite-session-delegation-support'

interface DelegationConflictRow {
  readonly id: string
  readonly acknowledged_by: string | null
  readonly resolved_at: number | null
}

export function acknowledgeDelegationConflict(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (command.operation !== 'delegation-conflict-acknowledge') return undefined
    if (command.sessionId !== contract.parent_session_id) {
      return rejectedDelegationOutcome(input, 'parent_required')
    }
    if (command.reason.trim().length === 0) {
      return rejectedDelegationOutcome(input, 'conflict_acknowledgement_reason_required')
    }
    const conflicts = yield* sql<DelegationConflictRow>`
      SELECT id, acknowledged_by, resolved_at FROM delegation_conflicts
      WHERE id = ${command.conflictId}
        AND (left_delegation_id = ${contract.id} OR right_delegation_id = ${contract.id})
      LIMIT 1
    `
    const conflict = conflicts[0]
    if (!conflict) return rejectedDelegationOutcome(input, 'delegation_conflict_not_found')
    if (conflict.resolved_at !== null) {
      return rejectedDelegationOutcome(input, 'delegation_conflict_resolved')
    }
    if (conflict.acknowledged_by !== null) {
      return rejectedDelegationOutcome(input, 'delegation_conflict_already_acknowledged')
    }
    yield* sql`
      INSERT INTO delegation_conflict_acknowledgements (
        conflict_id, actor_session_id, authored_by, reason, created_at
      ) VALUES (
        ${conflict.id}, ${command.sessionId}, ${input.callerId},
        ${command.reason.trim()}, ${input.now}
      )
    `
    yield* sql`
      UPDATE delegation_conflicts SET acknowledged_by = ${input.callerId},
        acknowledgement_reason = ${command.reason.trim()}, acknowledged_at = ${input.now}
      WHERE id = ${conflict.id}
    `
    return {
      operation: command.operation,
      effect: 'delegation-conflict-acknowledged',
      sessionId: command.sessionId,
      delegationId: contract.id,
      conflictId: conflict.id,
      acknowledgedAt: input.now,
    } satisfies Extract<
      SessionControlMutationOutcome,
      { readonly effect: 'delegation-conflict-acknowledged' }
    >
  })
}
