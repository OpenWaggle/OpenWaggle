import type { AppMigration } from './database-migrations'
import { SESSION_RUN_AGENT_WORK_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Whether each Run is an agent's work (`isAgentWorkRun`), stored when it starts so Active Workers
 * counts an agent's Run in a Session the person made with one indexed lookup (ADR 0030, amended
 * 2026-11-10). A Run from before has none: it counts as the person's, as it did when it started.
 */
export const SESSION_RUN_AGENT_WORK_MIGRATION = {
  id: SESSION_RUN_AGENT_WORK_MIGRATION_ID,
  name: 'session-run-agent-work',
  // A fresh target schema already has the column.
  skipIfColumns: { table: 'session_runs', columns: ['work_by_agent'] },
  statements: ['ALTER TABLE session_runs ADD COLUMN work_by_agent INTEGER NOT NULL DEFAULT 0'],
} satisfies AppMigration
