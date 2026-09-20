import { DatabaseSync } from 'node:sqlite'
import { SESSION_TRANSCRIPT_TERM_SCHEMA_STATEMENTS } from '../../services/session-host-transcript-term-schema'

export function createTranscriptTermCutoverDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE session_nodes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      created_order INTEGER NOT NULL,
      kind TEXT NOT NULL,
      role TEXT,
      content_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE session_node_search USING fts5(
      session_id UNINDEXED,
      node_id UNINDEXED,
      content,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    ${SESSION_TRANSCRIPT_TERM_SCHEMA_STATEMENTS.join(';')};
    INSERT INTO sessions (id) VALUES ('worker');
    INSERT INTO session_nodes (
      id, session_id, created_order, kind, role, content_json, metadata_json
    ) VALUES
      ('node-a', 'worker', 1, 'message', 'user',
        '{"parts":[{"type":"text","text":"Alpha beta alpha"}]}',
        '{"openWaggle":{"runId":"run-a"}}'),
      ('node-b', 'worker', 2, 'message', 'assistant',
        '{"parts":[{"type":"text","text":"beta gamma"}]}', '{}');
    INSERT INTO session_node_search (session_id, node_id, content) VALUES
      ('worker', 'node-a', 'Alpha beta alpha'),
      ('worker', 'node-b', 'beta gamma');
  `)
  return database
}
