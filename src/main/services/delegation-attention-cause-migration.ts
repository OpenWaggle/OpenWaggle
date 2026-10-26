import type { AppMigration } from './database-migrations'
import { DELEGATION_ATTENTION_CAUSE_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Why each Delegation now in `needs_attention` got there, so the Host can clear it when the
 * situation ends (ADR 0059, #380): `run_failed` clears when a new Run starts on the Worker,
 * `worker_request` when the parent delivers anything to it.
 *
 * Before this migration the Host wrote no transition row when it set `needs_attention` for a
 * failed Run; it wrote only the parent's orchestration update. So a Delegation the Worker set
 * itself is one whose latest transition is the Worker's own move to `needs_attention` with no
 * later Host failure update (the rule #364 used at settlement). Every other one is a failed Run.
 */
export const DELEGATION_ATTENTION_CAUSE_BACKFILL_STATEMENT = `
  UPDATE delegation_contracts
  SET attention_cause = CASE WHEN EXISTS (
      SELECT 1 FROM delegation_state_transitions AS transitions
      WHERE transitions.id = (
          SELECT MAX(latest.id) FROM delegation_state_transitions AS latest
          WHERE latest.delegation_id = delegation_contracts.id
        )
        AND transitions.to_state = 'needs_attention'
        AND transitions.actor_session_id = delegation_contracts.child_session_id
        AND NOT EXISTS (
          SELECT 1 FROM session_orchestration_updates AS host_updates
          WHERE host_updates.delegation_id = delegation_contracts.id
            AND host_updates.state = 'needs_attention'
            AND host_updates.created_at > transitions.created_at
        )
    ) THEN 'worker_request' ELSE 'run_failed' END
  WHERE state = 'needs_attention'
`

export const DELEGATION_ATTENTION_CAUSE_MIGRATION = {
  id: DELEGATION_ATTENTION_CAUSE_MIGRATION_ID,
  name: 'delegation-attention-cause',
  // A fresh target schema already has the column, and no Delegation to backfill.
  skipIfColumns: { table: 'delegation_contracts', columns: ['attention_cause'] },
  statements: [
    `ALTER TABLE delegation_contracts ADD COLUMN attention_cause TEXT
      CHECK (attention_cause IN ('run_failed', 'worker_request'))`,
    DELEGATION_ATTENTION_CAUSE_BACKFILL_STATEMENT,
  ],
} satisfies AppMigration
