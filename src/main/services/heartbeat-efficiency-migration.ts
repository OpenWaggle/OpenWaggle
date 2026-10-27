import type { AppMigration } from './database-migrations'
import { HEARTBEAT_EFFICIENCY_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Heartbeat Wake checks, Stop conditions, Run outcomes and Auto-pause (#388, ADR 0057
 * amendment). A Heartbeat must now have a way to finish; one created before that rule with no end
 * date and no run limit is grandfathered as `indefinite`, so it keeps firing and the app says it
 * has no end. A run's `context_json` snapshots what its Run identity tells the agent (run number,
 * idle count, Stop condition, Wake check output, model), taken when the firing was sent.
 */
export const HEARTBEAT_EFFICIENCY_GRANDFATHER_STATEMENT = `
  UPDATE scheduled_tasks SET indefinite = 1
  WHERE kind = 'heartbeat' AND ends_at IS NULL AND max_runs IS NULL
`

export const HEARTBEAT_EFFICIENCY_MIGRATION = {
  id: HEARTBEAT_EFFICIENCY_MIGRATION_ID,
  name: 'heartbeat-efficiency',
  statements: [
    'ALTER TABLE scheduled_tasks ADD COLUMN stop_when TEXT',
    `ALTER TABLE scheduled_tasks ADD COLUMN indefinite INTEGER NOT NULL DEFAULT 0
      CHECK (indefinite IN (0, 1))`,
    `ALTER TABLE scheduled_tasks ADD COLUMN idle_pause_after INTEGER NOT NULL DEFAULT 3
      CHECK (idle_pause_after BETWEEN 1 AND 20)`,
    'ALTER TABLE scheduled_tasks ADD COLUMN consecutive_idle_runs INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE scheduled_tasks ADD COLUMN wake_check_command TEXT',
    `ALTER TABLE scheduled_tasks ADD COLUMN wake_check_on_failure TEXT NOT NULL DEFAULT 'wake'
      CHECK (wake_check_on_failure IN ('wake', 'skip'))`,
    'ALTER TABLE scheduled_tasks ADD COLUMN wake_check_approved_command TEXT',
    'ALTER TABLE scheduled_tasks ADD COLUMN wake_check_pending_since INTEGER',
    `ALTER TABLE scheduled_tasks ADD COLUMN auto_pause_reason TEXT
      CHECK (auto_pause_reason IN ('done', 'idle'))`,
    'ALTER TABLE scheduled_tasks ADD COLUMN auto_pause_message TEXT',
    'ALTER TABLE scheduled_tasks ADD COLUMN auto_paused_at INTEGER',
    `ALTER TABLE scheduled_task_runs ADD COLUMN wake_check TEXT
      CHECK (wake_check IN ('idle', 'woke', 'failed'))`,
    `ALTER TABLE scheduled_task_runs ADD COLUMN outcome TEXT
      CHECK (outcome IN ('acted', 'idle', 'done'))`,
    `ALTER TABLE scheduled_task_runs ADD COLUMN outcome_source TEXT
      CHECK (outcome_source IN ('reported', 'inferred'))`,
    'ALTER TABLE scheduled_task_runs ADD COLUMN outcome_note TEXT',
    'ALTER TABLE scheduled_task_runs ADD COLUMN context_json TEXT',
    `CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_session_run
      ON scheduled_task_runs (run_id) WHERE run_id IS NOT NULL`,
    HEARTBEAT_EFFICIENCY_GRANDFATHER_STATEMENT,
  ],
} satisfies AppMigration
