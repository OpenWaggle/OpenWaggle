import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { populateSessionTranscriptTermCatalog } from '../session-transcript-term-cutover'
import { createTranscriptTermCutoverDatabase } from './session-transcript-term-cutover.test-support'

describe('Session transcript term cutover', () => {
  let database: DatabaseSync

  beforeEach(() => {
    database = createTranscriptTermCutoverDatabase()
  })

  afterEach(() => {
    database.close()
  })

  it('builds and verifies an exact catalog from bounded Session batches', () => {
    populateSessionTranscriptTermCatalog(database)

    expect(
      database
        .prepare(`
          SELECT terms.term, terms.occurrences, terms.first_node_id, terms.first_run_id,
            CAST(terms.occurrences AS REAL) / documents.token_count AS term_frequency
          FROM session_transcript_terms AS terms
          JOIN session_transcript_term_documents AS documents
            ON documents.session_id = terms.session_id
          ORDER BY terms.term
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
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM pragma_table_info('session_transcript_terms')
           WHERE name = 'term_frequency'`,
        )
        .get(),
    ).toEqual({ count: 0 })
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'index' AND name = 'idx_session_transcript_terms_rank'`,
        )
        .get(),
    ).toEqual({ count: 0 })
  })

  it('traverses Session boundaries and tied node orders across multiple node batches', () => {
    database.exec(`
      CREATE TABLE cutover_batch_audit (token_count INTEGER NOT NULL);
      CREATE TRIGGER audit_skewed_cutover_batch
      AFTER UPDATE ON session_transcript_term_documents
      WHEN new.session_id = 'skewed'
      BEGIN
        INSERT INTO cutover_batch_audit (token_count) VALUES (new.token_count);
      END;

      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < 300
      )
      INSERT INTO sessions (id)
      SELECT printf('session-%03d', value) FROM sequence;

      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < 300
      )
      INSERT INTO session_nodes (
        id, session_id, created_order, kind, role, content_json, metadata_json
      )
      SELECT printf('batch-node-%03d', value), printf('session-%03d', value), 1,
        'message', 'user',
        json_object('parts', json_array(
          json_object('type', 'text', 'text', printf('shared batch marker-%03d', value))
        )), '{}'
      FROM sequence;

      INSERT INTO sessions (id) VALUES ('skewed');
      WITH RECURSIVE sequence(value) AS (
        SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < 1000
      )
      INSERT INTO session_nodes (
        id, session_id, created_order, kind, role, content_json, metadata_json
      )
      SELECT printf('skew-node-%04d', value), 'skewed', value / 3,
        'message', 'assistant',
        json_object('parts', json_array(
          json_object('type', 'text', 'text', printf('shared skew marker-%04d', value))
        )), '{}'
      FROM sequence;
    `)

    populateSessionTranscriptTermCatalog(database)

    expect(
      database.prepare('SELECT COUNT(*) AS count FROM session_transcript_term_documents').get(),
    ).toEqual({ count: 302 })
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM session_transcript_terms WHERE term = 'shared'")
        .get(),
    ).toEqual({ count: 301 })
    expect(
      database
        .prepare(`
          SELECT occurrences, first_node_id
          FROM session_transcript_terms WHERE term = 'shared' AND session_id = 'skewed'
        `)
        .get(),
    ).toEqual({ occurrences: 1000, first_node_id: 'skew-node-0000' })
    expect(database.prepare('SELECT COUNT(*) AS count FROM cutover_batch_audit').get()).toEqual({
      count: 3,
    })
    expect(
      database
        .prepare(`
          SELECT term, occurrences, first_node_id
          FROM session_transcript_terms
          WHERE session_id = 'skewed' AND length(term) = 4 AND term GLOB '[0-9]*'
          ORDER BY term
        `)
        .all(),
    ).toEqual(
      Array.from({ length: 1000 }, (_, index) => ({
        term: String(index).padStart(4, '0'),
        occurrences: 1,
        first_node_id: `skew-node-${String(index).padStart(4, '0')}`,
      })),
    )
  })

  it('resumes at the last admitted node when the content-byte limit shortens a page', () => {
    database.exec(`
      INSERT INTO sessions (id) VALUES ('large');
      CREATE TABLE cutover_batch_audit (token_count INTEGER NOT NULL);
      CREATE TRIGGER audit_large_cutover_batch
      AFTER UPDATE ON session_transcript_term_documents
      WHEN new.session_id = 'large'
      BEGIN
        INSERT INTO cutover_batch_audit (token_count) VALUES (new.token_count);
      END;
    `)
    const insert = database.prepare(`
      INSERT INTO session_nodes (
        id, session_id, created_order, kind, role, content_json, metadata_json
      ) VALUES (?, 'large', 0, 'message', 'user', ?, '{}')
    `)
    for (let index = 0; index < 360; index += 1) {
      const marker = String(index).padStart(3, '0')
      insert.run(
        `large-node-${marker}`,
        JSON.stringify({
          parts: [{ type: 'text', text: `shared marker${marker}`.padEnd(12_000) }],
        }),
      )
    }

    populateSessionTranscriptTermCatalog(database)

    expect(
      database.prepare('SELECT token_count FROM cutover_batch_audit ORDER BY rowid').all(),
    ).toEqual([{ token_count: 698 }, { token_count: 720 }])
    expect(
      database
        .prepare(`
          SELECT term, occurrences, first_node_id
          FROM session_transcript_terms WHERE session_id = 'large' AND term LIKE 'marker%'
          ORDER BY term
        `)
        .all(),
    ).toEqual(
      Array.from({ length: 360 }, (_, index) => ({
        term: `marker${String(index).padStart(3, '0')}`,
        occurrences: 1,
        first_node_id: `large-node-${String(index).padStart(3, '0')}`,
      })),
    )
  })

  it('rejects a missing Session document before discarding its batch ground truth', () => {
    database.exec(`
      CREATE TRIGGER remove_cutover_document AFTER INSERT ON session_transcript_terms
      WHEN new.term = 'alpha'
      BEGIN
        DELETE FROM session_transcript_term_documents WHERE session_id = new.session_id;
      END;
    `)

    expect(() => populateSessionTranscriptTermCatalog(database)).toThrow(
      'Session Host transcript document counts do not match the FTS vocabulary.',
    )
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
