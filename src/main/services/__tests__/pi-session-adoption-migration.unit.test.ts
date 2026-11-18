import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { PI_SESSION_ADOPTION_MIGRATION } from '../pi-session-adoption-migration'

describe('Pi session adoption migration', () => {
  it('adds the adoption and dismissal tables without touching existing Sessions', () => {
    const database = new Database(':memory:')
    try {
      database.exec('PRAGMA foreign_keys = ON')
      database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL)')
      database.exec("INSERT INTO sessions VALUES ('own', 'Mine'), ('found', 'From pi')")
      for (const statement of PI_SESSION_ADOPTION_MIGRATION.statements) {
        database.exec(statement)
      }
      database.exec("INSERT INTO pi_session_adoptions VALUES ('found', 1)")
      database.exec("INSERT INTO pi_session_dismissals VALUES ('/pi/found.jsonl', 'pi-id', 2)")

      database.exec("DELETE FROM sessions WHERE id = 'found'")

      expect(database.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 'own' }])
      // The adoption goes with its Session; the dismissal outlives it so discovery skips the file.
      expect(database.prepare('SELECT COUNT(*) AS count FROM pi_session_adoptions').get()).toEqual({
        count: 0,
      })
      expect(database.prepare('SELECT pi_session_file FROM pi_session_dismissals').all()).toEqual([
        { pi_session_file: '/pi/found.jsonl' },
      ])
    } finally {
      database.close()
    }
  })
})
