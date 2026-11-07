import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { APP_MIGRATIONS } from '../database-migrations'
import { HIVE_WAKE_CAUSE_MIGRATION } from '../hive-wake-cause-migration'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'

describe('Hive wake cause migration', () => {
  it('is the newest migration this binary supports, after 86', () => {
    expect(HIVE_WAKE_CAUSE_MIGRATION.id).toBe(87)
    expect(APP_MIGRATIONS.at(-1)).toBe(HIVE_WAKE_CAUSE_MIGRATION)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(HIVE_WAKE_CAUSE_MIGRATION.id)
  })

  // A row recorded before has no cause, which a wake treats as the Host's own.
  it('adds empty causes to the updates and Runs recorded before it', () => {
    const database = new Database(':memory:')
    try {
      database.exec('CREATE TABLE session_orchestration_updates (id TEXT PRIMARY KEY)')
      database.exec('CREATE TABLE session_runs (id TEXT PRIMARY KEY)')
      database.exec(`INSERT INTO session_orchestration_updates (id) VALUES ('update-1')`)
      database.exec(`INSERT INTO session_runs (id) VALUES ('run-1')`)
      for (const statement of HIVE_WAKE_CAUSE_MIGRATION.statements) database.exec(statement)
      expect(
        database.prepare('SELECT trigger_caller_id FROM session_orchestration_updates').get(),
      ).toEqual({ trigger_caller_id: null })
      expect(database.prepare('SELECT interrupted_by_caller_id FROM session_runs').get()).toEqual({
        interrupted_by_caller_id: null,
      })
    } finally {
      database.close()
    }
  })
})
