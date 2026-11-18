import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { PI_SESSION_DISCOVERY_CREATE_MIGRATION } from '../pi-session-discovery-create-migration'

describe('Pi session discovery create migration', () => {
  it('adds the table of creates discovery sent, one row per key', () => {
    const database = new Database(':memory:')
    try {
      for (const statement of PI_SESSION_DISCOVERY_CREATE_MIGRATION.statements) {
        database.exec(statement)
      }
      database.exec("INSERT INTO pi_session_discovery_creates VALUES ('pi-session-discovery:a', 1)")

      expect(() =>
        database.exec(
          "INSERT INTO pi_session_discovery_creates VALUES ('pi-session-discovery:a', 2)",
        ),
      ).toThrow()
    } finally {
      database.close()
    }
  })
})
