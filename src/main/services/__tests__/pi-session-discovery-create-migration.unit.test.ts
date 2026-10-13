import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { PI_SESSION_DISCOVERY_CREATE_MIGRATION } from '../pi-session-discovery-create-migration'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'

describe('Pi session discovery create migration', () => {
  it('adds the table of creates discovery sent, one row per key', () => {
    const database = new DatabaseSync(':memory:')
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

  it('is the newest migration this binary supports', () => {
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(PI_SESSION_DISCOVERY_CREATE_MIGRATION.id)
  })
})
