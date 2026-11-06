import type { AppMigration } from './database-migrations'
import { ORCHESTRATION_UPDATE_TRIGGER_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Who caused each orchestration update: the caller that submitted a Worker's result or set its
 * `needs_attention`, or the agent of the Worker Run whose end recorded it. A Hive wake acts on an
 * update only when that cause may wake the parent (`hive-wake-trigger-authority.ts`), however the
 * wake was asked for. An update recorded before has none, which counts as the Host's own.
 */
export const ORCHESTRATION_UPDATE_TRIGGER_MIGRATION = {
  id: ORCHESTRATION_UPDATE_TRIGGER_MIGRATION_ID,
  name: 'orchestration-update-trigger',
  // A fresh target schema already has the column.
  skipIfColumns: { table: 'session_orchestration_updates', columns: ['trigger_caller_id'] },
  statements: ['ALTER TABLE session_orchestration_updates ADD COLUMN trigger_caller_id TEXT'],
} satisfies AppMigration
