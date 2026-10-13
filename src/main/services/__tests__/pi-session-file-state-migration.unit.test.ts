import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { PI_SESSION_ADOPTION_MIGRATION } from '../pi-session-adoption-migration'
import { PI_SESSION_FILE_STATE_MIGRATION } from '../pi-session-file-state-migration'

describe('Pi session file state migration', () => {
  it('records file state per Session and the working directory of an adopted one', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('PRAGMA foreign_keys = ON')
      database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL)')
      database.exec("INSERT INTO sessions VALUES ('found', 'From pi')")
      for (const statement of PI_SESSION_ADOPTION_MIGRATION.statements) database.exec(statement)
      // An adoption recorded before this migration keeps its row, with no working directory.
      database.exec("INSERT INTO pi_session_adoptions VALUES ('found', 1)")

      for (const statement of PI_SESSION_FILE_STATE_MIGRATION.statements) database.exec(statement)

      expect(database.prepare('SELECT session_id, cwd FROM pi_session_adoptions').all()).toEqual([
        { session_id: 'found', cwd: null },
      ])
      database.exec(
        "INSERT INTO pi_session_file_projections VALUES ('found', 120, 1700000000000.5, 1, 2)",
      )
      expect(database.prepare('SELECT * FROM pi_session_file_projections').all()).toEqual([
        {
          session_id: 'found',
          file_size: 120,
          file_mtime_ms: 1700000000000.5,
          revision: 1,
          updated_at: 2,
        },
      ])
      // A projection's file state goes with its Session.
      database.exec("DELETE FROM sessions WHERE id = 'found'")
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM pi_session_file_projections').get(),
      ).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })
})
