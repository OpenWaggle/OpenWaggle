import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION } from '../session-host-project-catalog-generation-migration'

describe('Session Host project catalog generation migration', () => {
  it('upgrades an existing Sessions table and invalidates only on catalog mutations', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec(`CREATE TABLE sessions (
        id TEXT PRIMARY KEY, project_path TEXT NOT NULL, archived INTEGER NOT NULL, title TEXT NOT NULL
      )`)
      for (const statement of SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION.statements) {
        database.exec(statement)
      }
      const generation = () =>
        database
          .prepare('SELECT generation FROM session_project_catalog_generation WHERE singleton = 1')
          .get()?.generation
      expect(generation()).toBe(0)
      database.exec("INSERT INTO sessions VALUES ('one', '/repo/alpha', 0, 'First')")
      expect(generation()).toBe(1)
      database.exec("UPDATE sessions SET title = 'Renamed' WHERE id = 'one'")
      expect(generation()).toBe(1)
      database.exec("UPDATE sessions SET project_path = '/repo/bravo' WHERE id = 'one'")
      expect(generation()).toBe(2)
      database.exec("UPDATE sessions SET archived = 1 WHERE id = 'one'")
      expect(generation()).toBe(3)
      database.exec("DELETE FROM sessions WHERE id = 'one'")
      expect(generation()).toBe(4)
      for (const statement of SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION.statements) {
        database.exec(statement)
      }
      expect(generation()).toBe(4)
    } finally {
      database.close()
    }
  })
})
