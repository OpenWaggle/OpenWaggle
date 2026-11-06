import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { APP_MIGRATIONS } from '../database-migrations'
import { ORCHESTRATION_UPDATE_TRIGGER_MIGRATION } from '../orchestration-update-trigger-migration'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'

describe('Orchestration update trigger migration', () => {
  it('is the newest migration this binary supports, after 86', () => {
    expect(ORCHESTRATION_UPDATE_TRIGGER_MIGRATION.id).toBe(87)
    expect(APP_MIGRATIONS.at(-1)).toBe(ORCHESTRATION_UPDATE_TRIGGER_MIGRATION)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(ORCHESTRATION_UPDATE_TRIGGER_MIGRATION.id)
  })

  // An update recorded before has no cause, which a wake treats as the Host's own.
  it('adds an empty cause to the updates recorded before it', () => {
    const database = new Database(':memory:')
    try {
      database.exec(`CREATE TABLE session_orchestration_updates (id TEXT PRIMARY KEY)`)
      database.exec(`INSERT INTO session_orchestration_updates (id) VALUES ('update-1')`)
      for (const statement of ORCHESTRATION_UPDATE_TRIGGER_MIGRATION.statements) {
        database.exec(statement)
      }
      expect(
        database.prepare('SELECT trigger_caller_id FROM session_orchestration_updates').get(),
      ).toEqual({ trigger_caller_id: null })
    } finally {
      database.close()
    }
  })
})
