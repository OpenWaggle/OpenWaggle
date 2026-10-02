import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { SESSION_TITLE_PROVENANCE_MIGRATION } from '../session-title-provenance-migration'

describe('Session title provenance migration', () => {
  it('marks still-untitled Sessions as default and keeps every existing title manual', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL)')
      database.exec(
        "INSERT INTO sessions VALUES ('untitled', 'New session'), ('titled', 'Fix the sidebar')",
      )
      for (const statement of SESSION_TITLE_PROVENANCE_MIGRATION.statements) {
        database.exec(statement)
      }

      expect(
        database
          .prepare('SELECT id, title_source, title_needs_refinement FROM sessions ORDER BY id DESC')
          .all(),
      ).toEqual([
        { id: 'untitled', title_source: 'default', title_needs_refinement: 0 },
        { id: 'titled', title_source: 'manual', title_needs_refinement: 0 },
      ])
      expect(() =>
        database.exec("UPDATE sessions SET title_source = 'guessed' WHERE id = 'titled'"),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      database.close()
    }
  })
})
