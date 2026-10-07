import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'
import { SESSION_MCP_SWITCH_MIGRATION } from '../session-mcp-switch-migration'

describe('Session MCP switch migration', () => {
  it('adds the switch table, whose rows go with their Session', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('PRAGMA foreign_keys = ON')
      database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL)')
      database.exec("INSERT INTO sessions VALUES ('kept', 'Kept'), ('gone', 'Gone')")
      for (const statement of SESSION_MCP_SWITCH_MIGRATION.statements) {
        database.exec(statement)
      }
      database.exec("INSERT INTO session_mcp_disabled VALUES ('kept', 1), ('gone', 2)")

      database.exec("DELETE FROM sessions WHERE id = 'gone'")

      expect(database.prepare('SELECT session_id FROM session_mcp_disabled').all()).toEqual([
        { session_id: 'kept' },
      ])
    } finally {
      database.close()
    }
  })

  it('is the newest migration this binary supports', () => {
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(SESSION_MCP_SWITCH_MIGRATION.id)
  })
})
