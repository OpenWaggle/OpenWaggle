import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION } from '../session-host-transcript-term-migration'
import { SESSION_TRANSCRIPT_TERM_SCHEMA_STATEMENTS } from '../session-host-transcript-term-schema'

function applyMigration(database: DatabaseSync) {
  for (const statement of SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION.statements) {
    database.exec(statement)
  }
}

function termColumns(database: DatabaseSync) {
  return database
    .prepare("SELECT name FROM pragma_table_info('session_transcript_terms') ORDER BY cid")
    .all()
}

describe('Session Host transcript term normalization migration', () => {
  const databases: DatabaseSync[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
  })

  it('removes persisted frequency state while preserving an alpha catalog', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE sessions (id TEXT PRIMARY KEY);
      CREATE TABLE session_transcript_terms (
        term TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        occurrences INTEGER NOT NULL,
        first_node_id TEXT NOT NULL,
        first_created_order INTEGER NOT NULL,
        first_run_id TEXT,
        term_frequency REAL NOT NULL,
        PRIMARY KEY (term, session_id)
      ) WITHOUT ROWID;
      CREATE INDEX idx_session_transcript_terms_session
        ON session_transcript_terms (session_id, term);
      CREATE INDEX idx_session_transcript_terms_rank
        ON session_transcript_terms (term, term_frequency DESC, session_id);
      INSERT INTO sessions (id) VALUES ('session-a');
      INSERT INTO session_transcript_terms (
        term, session_id, occurrences, first_node_id, first_created_order,
        first_run_id, term_frequency
      ) VALUES ('alpha', 'session-a', 2, 'node-a', 1, 'run-a', 0.5);
    `)

    applyMigration(database)

    expect(termColumns(database)).toEqual([
      { name: 'term' },
      { name: 'session_id' },
      { name: 'occurrences' },
      { name: 'first_node_id' },
      { name: 'first_created_order' },
      { name: 'first_run_id' },
    ])
    expect(database.prepare('SELECT * FROM session_transcript_terms').get()).toEqual({
      term: 'alpha',
      session_id: 'session-a',
      occurrences: 2,
      first_node_id: 'node-a',
      first_created_order: 1,
      first_run_id: 'run-a',
    })
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name LIKE 'idx_session_transcript_terms_%'`,
        )
        .all(),
    ).toEqual([{ name: 'idx_session_transcript_terms_session' }])
  })

  it('also applies after the current alpha target schema', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
    for (const statement of SESSION_TRANSCRIPT_TERM_SCHEMA_STATEMENTS) database.exec(statement)

    expect(() => applyMigration(database)).not.toThrow()
    expect(termColumns(database).some((column) => column.name === 'term_frequency')).toBe(false)
  })
})
