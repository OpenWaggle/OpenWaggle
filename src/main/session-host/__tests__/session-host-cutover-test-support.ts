import { DatabaseSync } from 'node:sqlite'
import type { SessionEmbeddingModel } from '../../adapters/multilingual-e5-session-embedding-model'

export const fakeEmbeddingModel: SessionEmbeddingModel = {
  metadata: { id: 'test/e5', revision: 'test-revision', dimensions: 3, dtype: 'f32' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
}

export function seedLegacyDatabase(databasePath: string, runtimeJson = '{"model":"test"}') {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO _migrations VALUES (25, 'session-authorization-mode-override', 'now');
      CREATE TABLE settings_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO settings_store VALUES ('selectedModel', '"openai/gpt-5.4"', 1);
      INSERT INTO settings_store VALUES ('thinkingLevel', '"high"', 1);
      INSERT INTO settings_store VALUES ('defaultAuthorizationMode', '"yolo"', 1);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        pi_session_id TEXT NOT NULL UNIQUE,
        pi_session_file TEXT,
        project_path TEXT,
        title TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        waggle_config_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_node_id TEXT,
        last_active_branch_id TEXT,
        environment_mode TEXT NOT NULL DEFAULT 'local',
        worktree_path TEXT,
        worktree_base_ref TEXT,
        worktree_start_from_origin INTEGER NOT NULL DEFAULT 0,
        authorization_mode_override TEXT
      );
      CREATE TABLE session_nodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        parent_id TEXT,
        pi_entry_type TEXT NOT NULL,
        kind TEXT NOT NULL,
        role TEXT,
        timestamp_ms INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        branch_hint_id TEXT,
        path_depth INTEGER NOT NULL,
        created_order INTEGER NOT NULL
      );
      CREATE TABLE session_active_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL,
        run_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        runtime_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    database
      .prepare(`
        INSERT INTO sessions (
          id, pi_session_id, project_path, title, created_at, updated_at,
          environment_mode, authorization_mode_override
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run('session-root', 'pi-root', '/project', 'Root', 10, 20, 'local', 'ask-for-approval')
    database
      .prepare(`
        INSERT INTO session_nodes (
          id, session_id, pi_entry_type, kind, role, timestamp_ms,
          content_json, metadata_json, path_depth, created_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run('node-1', 'session-root', 'message', 'message', 'user', 11, '{}', '{}', 0, 0)
    database
      .prepare(`
        INSERT INTO session_active_runs (
          run_id, session_id, branch_id, run_mode, status, runtime_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run('run-legacy', 'session-root', 'branch-main', 'classic', 'active', runtimeJson, 18)
  } finally {
    database.close()
  }
}
