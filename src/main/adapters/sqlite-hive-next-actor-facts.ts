import type * as SqlClient from '@effect/sql/SqlClient'
import type { SqlError } from '@effect/sql/SqlError'
import type { HiveNextActorFacts } from '@shared/domain/hive-next-actor'
import { HIVE_ATTENTION_CAUSES, type HiveAttentionCause } from '@shared/types/hive-next-actor'
import type { DelegationState } from '@shared/types/session-collaboration'
import * as Effect from 'effect/Effect'

/**
 * Whether the parent of the Delegation row `contracts` will pick its Worker up on its own
 * (ADR 0059): it has an active Run, or a running queue with a Follow-up to deliver. A paused queue
 * waits on the person, so it does not count. Derived at read time, never stored, so it follows the
 * parent's Runs and queue live and a Host restart reads the same answer.
 */
export function parentWillActSql(contracts: string) {
  return `COALESCE((
    SELECT parent_state.active_run_id IS NOT NULL OR (
      parent_state.queue_state = 'running' AND EXISTS (
        SELECT 1 FROM session_follow_ups AS parent_queue
        WHERE parent_queue.session_id = parent_state.session_id
          AND parent_queue.delivery_state = 'pending'
      )
    )
    FROM session_control_states AS parent_state
    WHERE parent_state.session_id = ${contracts}.parent_session_id
  ), 0)`
}

/** The persisted cause, read only while the Delegation row `contracts` is `needs_attention`. */
export function attentionCauseSql(contracts: string) {
  return `CASE WHEN ${contracts}.state = 'needs_attention' THEN ${contracts}.attention_cause END`
}

interface FactsRow {
  readonly session_id: string
  readonly delegation_state: DelegationState
  readonly attention_cause: string | null
  readonly parent_will_act: number
}

/** A stored cause, or null for anything the Host does not write. */
export function decodeAttentionCause(value: string | null | undefined): HiveAttentionCause | null {
  return HIVE_ATTENTION_CAUSES.find((cause) => cause === value) ?? null
}

/** The stored half of the next-actor facts for each Worker with a Delegation (ADR 0059). */
export interface HiveStoredNextActorFacts extends HiveNextActorFacts {
  readonly delegationState: DelegationState
  readonly attentionCause: HiveAttentionCause | null
  readonly parentWillAct: boolean
}

export function loadHiveNextActorFacts(
  sql: SqlClient.SqlClient,
  sessionIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, HiveStoredNextActorFacts>, SqlError> {
  if (sessionIds.length === 0) return Effect.succeed(new Map())
  return sql<FactsRow>`
    SELECT contracts.child_session_id AS session_id, contracts.state AS delegation_state,
      ${sql.literal(attentionCauseSql('contracts'))} AS attention_cause,
      ${sql.literal(parentWillActSql('contracts'))} AS parent_will_act
    FROM delegation_contracts AS contracts
    WHERE contracts.child_session_id IN ${sql.in(sessionIds)}
  `.pipe(
    Effect.map(
      (rows) =>
        new Map(
          rows.map((row) => [
            row.session_id,
            {
              delegationState: row.delegation_state,
              attentionCause: decodeAttentionCause(row.attention_cause),
              parentWillAct: row.parent_will_act === 1,
            } satisfies HiveStoredNextActorFacts,
          ]),
        ),
    ),
  )
}
