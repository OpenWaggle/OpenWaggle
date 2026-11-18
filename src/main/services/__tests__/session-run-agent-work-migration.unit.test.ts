import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { APP_MIGRATIONS } from '../database-migrations'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'
import { SESSION_RUN_AGENT_WORK_MIGRATION } from '../session-run-agent-work-migration'

describe('Session Run agent work migration', () => {
  it('is the newest migration this binary supports, after 88', () => {
    expect(SESSION_RUN_AGENT_WORK_MIGRATION.id).toBe(89)
    expect(APP_MIGRATIONS.at(-1)).toBe(SESSION_RUN_AGENT_WORK_MIGRATION)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(SESSION_RUN_AGENT_WORK_MIGRATION.id)
  })

  // A Run from before counts as the person's, as it did when it started.
  it('marks every Run recorded before as the person’s work', () => {
    const database = new Database(':memory:')
    try {
      database.exec('CREATE TABLE session_runs (id TEXT PRIMARY KEY)')
      database.exec(`INSERT INTO session_runs (id) VALUES ('run-1')`)
      for (const statement of SESSION_RUN_AGENT_WORK_MIGRATION.statements) database.exec(statement)
      expect(database.prepare('SELECT work_by_agent FROM session_runs').get()).toEqual({
        work_by_agent: 0,
      })
    } finally {
      database.close()
    }
  })
})
