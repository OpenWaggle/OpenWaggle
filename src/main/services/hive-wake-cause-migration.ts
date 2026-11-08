import type { AppMigration } from './database-migrations'
import { HIVE_WAKE_CAUSE_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Who caused each orchestration update, so a Hive wake acts on an update only when that cause
 * may wake the parent (`sqlite-hive-wake-trigger-authority.ts`), however the wake was asked for.
 * `trigger_caller_id` is the caller that submitted a Worker's result or set its `needs_attention`,
 * or the agent of the Worker Run whose end recorded it. `interrupted_by_caller_id` is who stopped
 * a Run, which causes an interrupted Worker Run's update rather than whoever started that Run.
 * A row from before has neither: an update then counts as the Host's own.
 */
export const HIVE_WAKE_CAUSE_MIGRATION = {
  id: HIVE_WAKE_CAUSE_MIGRATION_ID,
  name: 'hive-wake-cause',
  // A fresh target schema already has both columns.
  skipIfColumns: { table: 'session_orchestration_updates', columns: ['trigger_caller_id'] },
  statements: [
    'ALTER TABLE session_orchestration_updates ADD COLUMN trigger_caller_id TEXT',
    'ALTER TABLE session_runs ADD COLUMN interrupted_by_caller_id TEXT',
  ],
} satisfies AppMigration
