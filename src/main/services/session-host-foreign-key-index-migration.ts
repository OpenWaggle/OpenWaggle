import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { AppMigration } from './database-migrations'
import {
  SESSION_HOST_FOREIGN_KEY_INDEX_MIGRATION_ID,
  SESSION_HOST_FOREIGN_KEY_INDEX_MIGRATION_NAME,
} from './session-host-schema-identity'

/**
 * Foreign-key child columns no index led. SQLite finds a deleted parent's children through the
 * child column, so without one every delete scanned the whole child table. The costly one was
 * `session_nodes.parent_id`: each node delete scanned every stored transcript, about 170 ms on a
 * 1.2 GB database, so deleting a 770-node Session blocked the Session Host for 160 s, and
 * snapshot reconciliation stalled it for seconds while Runs streamed. The rest are small tables
 * today, indexed so that no cascade from `sessions`, `session_runs`, or a delegation scans.
 * `database-foreign-key-indexes.integration.test.ts` keeps every new foreign key indexed.
 *
 * Some cutover targets from old revisions never gained every table, so an index is created only
 * where its table exists.
 */
const FOREIGN_KEY_COLUMNS = [
  ['session_nodes', 'parent_id'],
  ['session_branches', 'head_node_id'],
  ['session_branches', 'source_node_id'],
  ['session_export_selected_paths', 'selected_head_node_id'],
  ['session_export_selected_paths', 'session_id'],
  ['session_active_runs', 'session_id'],
  ['session_active_runs', 'branch_id'],
  ['session_authorization_requests', 'session_id'],
  ['session_control_states', 'active_run_id'],
  ['session_output_retries', 'session_id'],
  ['session_spawn_lineage', 'parent_run_id'],
  ['session_transcript_semantic_leases', 'session_id'],
  ['session_orchestration_updates', 'delivered_run_id'],
  ['session_orchestration_updates', 'source_run_id'],
  ['session_orchestration_updates', 'worker_session_id'],
  ['cross_session_report_deliveries', 'delivered_run_id'],
  ['cross_session_reports', 'reply_to_report_id'],
  ['cross_session_reports', 'source_run_id'],
  ['cross_session_reports', 'source_session_id'],
  ['delegation_amendment_proposals', 'actor_session_id'],
  ['delegation_claim_revisions', 'actor_session_id'],
  ['delegation_conflict_acknowledgements', 'actor_session_id'],
  ['delegation_conflicts', 'right_delegation_id'],
  ['delegation_reviews', 'reviewer_session_id'],
  ['delegation_specification_updates', 'delivered_run_id'],
  ['delegation_specification_updates', 'parent_session_id'],
  ['delegation_state_transitions', 'actor_session_id'],
  ['delegation_submissions', 'source_run_id'],
  ['delegation_undeclared_writes', 'worker_session_id'],
  ['delegation_verifications', 'verifier_session_id'],
  ['derived_child_management_grants', 'parent_session_id'],
  ['project_action_run_requests', 'run_id'],
] as const

export const SESSION_HOST_FOREIGN_KEY_INDEX_MIGRATION = {
  id: SESSION_HOST_FOREIGN_KEY_INDEX_MIGRATION_ID,
  name: SESSION_HOST_FOREIGN_KEY_INDEX_MIGRATION_NAME,
  statements: [],
  run: (sql: SqlClient.SqlClient) =>
    Effect.gen(function* () {
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `
      const present = new Set(tables.map((table) => table.name))
      for (const [table, column] of FOREIGN_KEY_COLUMNS) {
        if (!present.has(table)) continue
        yield* sql.unsafe(
          `CREATE INDEX IF NOT EXISTS idx_fk_${table}_${column} ON ${table} (${column})`,
        )
      }
    }),
} satisfies AppMigration
