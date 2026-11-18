import type { AppMigration } from './database-migrations'
import { SCHEDULED_TASK_MIGRATION_ID } from './session-host-schema-identity'

/**
 * Scheduled tasks (ADR 0057, ADR 0058) and their run history live only in the Session Host's
 * database. A Heartbeat references its target Session, so deleting the Session deletes it; a
 * run keeps the Session it produced as plain text, so its history outlives that Session.
 * `idempotency_key` is the key of the Session Control request a run sends, which names the run
 * that request starts in that Run's Host-authored identity.
 */
export const SCHEDULED_TASK_MIGRATION = {
  id: SCHEDULED_TASK_MIGRATION_ID,
  name: 'scheduled-tasks',
  statements: [
    `CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      creator_caller_id TEXT NOT NULL,
      creator_kind TEXT NOT NULL CHECK (creator_kind IN ('local-user', 'profile', 'session-agent')),
      creator_label TEXT NOT NULL,
      creator_session_id TEXT,
      creator_working_directory TEXT,
      create_idempotency_key TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('heartbeat', 'launch')),
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      schedule_json TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      anchor_at INTEGER NOT NULL,
      ends_at INTEGER,
      max_runs INTEGER,
      target_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      target_json TEXT NOT NULL,
      project_path TEXT,
      notification_policy TEXT NOT NULL CHECK (notification_policy IN ('every-run', 'failures-only')),
      attention_reason TEXT,
      attention_message TEXT,
      attention_since INTEGER,
      next_run_at INTEGER,
      next_nominal_at INTEGER,
      waiting_since INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK ((kind = 'heartbeat') = (target_session_id IS NOT NULL))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due
      ON scheduled_tasks (next_run_at) WHERE enabled = 1`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_owner
      ON scheduled_tasks (owner_key, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_target_session
      ON scheduled_tasks (target_session_id) WHERE target_session_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_tasks_create_key
      ON scheduled_tasks (owner_key, create_idempotency_key)
      WHERE create_idempotency_key IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      task_name TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'catch-up', 'run-now')),
      nominal_at INTEGER NOT NULL,
      fired_at INTEGER NOT NULL,
      missed_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('dispatching', 'started', 'skipped', 'failed')),
      reason TEXT,
      message TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      caller_id TEXT NOT NULL,
      session_id TEXT,
      run_id TEXT,
      previous_session_id TEXT,
      previous_fired_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task
      ON scheduled_task_runs (task_id, fired_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_dispatching
      ON scheduled_task_runs (status) WHERE status = 'dispatching'`,
  ],
} satisfies AppMigration
