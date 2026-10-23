import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SCHEDULED_TASK_MIGRATION } from '../scheduled-task-migration'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'

function migratedDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
  database.exec("INSERT INTO sessions VALUES ('session-1')")
  for (const statement of SCHEDULED_TASK_MIGRATION.statements) database.exec(statement)
  return database
}

function insertTask(
  database: DatabaseSync,
  input: { id: string; kind: string; target: string | null },
) {
  database
    .prepare(
      `INSERT INTO scheduled_tasks (id, owner_key, creator_caller_id, creator_kind, creator_label,
        kind, name, prompt, enabled, schedule_json, time_zone, anchor_at, target_session_id,
        target_json, notification_policy, created_at, updated_at)
      VALUES (?, 'local-user', 'gui:local-user', 'local-user', 'You', ?, 'Task', 'Prompt', 1,
        '{}', 'UTC', 0, ?, '{}', 'failures-only', 0, 0)`,
    )
    .run(input.id, input.kind, input.target)
}

describe('Scheduled task migration', () => {
  it('is the newest migration this binary supports', () => {
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(SCHEDULED_TASK_MIGRATION.id)
  })

  it('deletes a Heartbeat with its Session and keeps a run history only with its task', () => {
    const database = migratedDatabase()
    try {
      insertTask(database, { id: 'heartbeat', kind: 'heartbeat', target: 'session-1' })
      database.exec(`INSERT INTO scheduled_task_runs (id, task_id, task_name, trigger, nominal_at,
        fired_at, status, idempotency_key, caller_id) VALUES ('run-1', 'heartbeat', 'Task',
        'schedule', 0, 0, 'started', 'key-1', 'gui:local-user')`)
      database.exec("DELETE FROM sessions WHERE id = 'session-1'")
      expect(database.prepare('SELECT COUNT(*) AS count FROM scheduled_tasks').get()).toEqual({
        count: 0,
      })
      expect(database.prepare('SELECT COUNT(*) AS count FROM scheduled_task_runs').get()).toEqual({
        count: 0,
      })
    } finally {
      database.close()
    }
  })

  it('requires a target Session exactly for Heartbeats', () => {
    const database = migratedDatabase()
    try {
      expect(() => insertTask(database, { id: 'a', kind: 'heartbeat', target: null })).toThrow()
      expect(() => insertTask(database, { id: 'b', kind: 'launch', target: 'session-1' })).toThrow()
      insertTask(database, { id: 'c', kind: 'launch', target: null })
    } finally {
      database.close()
    }
  })
})
