import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { populateSessionTranscriptTermCatalog } from '../session-transcript-term-cutover'

function createDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE session_nodes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      created_order INTEGER NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE session_node_search USING fts5(
      session_id UNINDEXED,
      node_id UNINDEXED,
      content,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE session_transcript_terms (
      term TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      occurrences INTEGER NOT NULL,
      first_node_id TEXT NOT NULL,
      first_created_order INTEGER NOT NULL,
      first_run_id TEXT,
      term_frequency REAL NOT NULL,
      PRIMARY KEY (term, session_id)
    ) WITHOUT ROWID;
    CREATE TABLE session_transcript_term_documents (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      token_count INTEGER NOT NULL
    );
    INSERT INTO sessions (id) VALUES ('worker');
    INSERT INTO session_nodes (id, session_id, created_order, metadata_json) VALUES
      ('node-a', 'worker', 1, '{"openWaggle":{"runId":"run-a"}}'),
      ('node-b', 'worker', 2, '{}');
    INSERT INTO session_node_search (session_id, node_id, content) VALUES
      ('worker', 'node-a', 'Alpha beta alpha'),
      ('worker', 'node-b', 'beta gamma');
  `)
  return database
}

describe('Session transcript term cutover', () => {
  let database: DatabaseSync

  beforeEach(() => {
    database = createDatabase()
  })

  afterEach(() => {
    database.close()
  })

  it('builds and verifies one exact catalog from a single grouped FTS vocabulary', () => {
    populateSessionTranscriptTermCatalog(database)

    expect(
      database
        .prepare(`
          SELECT term, occurrences, first_node_id, first_run_id, term_frequency
          FROM session_transcript_terms ORDER BY term
        `)
        .all(),
    ).toEqual([
      {
        term: 'alpha',
        occurrences: 2,
        first_node_id: 'node-a',
        first_run_id: 'run-a',
        term_frequency: 0.4,
      },
      {
        term: 'beta',
        occurrences: 2,
        first_node_id: 'node-a',
        first_run_id: 'run-a',
        term_frequency: 0.4,
      },
      {
        term: 'gamma',
        occurrences: 1,
        first_node_id: 'node-b',
        first_run_id: null,
        term_frequency: 0.2,
      },
    ])
    expect(
      database.prepare('SELECT token_count FROM session_transcript_term_documents').get(),
    ).toEqual({ token_count: 5 })
  })

  it('rejects a self-consistent semantic substitution before discarding its FTS ground truth', () => {
    database.exec(`
      CREATE TRIGGER corrupt_cutover_term AFTER INSERT ON session_transcript_terms
      WHEN new.term = 'alpha'
      BEGIN
        UPDATE session_transcript_terms SET term = 'tampered'
        WHERE term = new.term AND session_id = new.session_id;
      END;
    `)

    expect(() => populateSessionTranscriptTermCatalog(database)).toThrow(
      'Session Host transcript terms do not match the FTS vocabulary.',
    )
    expect(
      database
        .prepare(`
          SELECT COUNT(*) AS count FROM sqlite_temp_master
          WHERE name IN (?, ?)
        `)
        .get('session_node_search_cutover_vocabulary', 'session_transcript_cutover_term_groups'),
    ).toEqual({ count: 0 })
  })
})
