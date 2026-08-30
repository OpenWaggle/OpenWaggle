import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../../adapters/multilingual-e5-session-embedding-model'
import { runSessionHostCutover } from '../session-host-cutover'

const fakeEmbeddingModel: SessionEmbeddingModel = {
  metadata: { id: 'test/e5', revision: 'test-revision', dimensions: 3, dtype: 'f32' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
}

function seedLegacyDatabase(databasePath: string, revision: number) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE settings_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO settings_store VALUES ('selectedModel', '"openai/gpt-5.4"', 1);
      INSERT INTO settings_store VALUES ('thinkingLevel', '"high"', 1);
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
      INSERT INTO sessions (
        id, pi_session_id, project_path, title, created_at, updated_at
      ) VALUES ('session-root', 'pi-root', '/project', 'Root', 10, 20);
      INSERT INTO session_nodes (
        id, session_id, pi_entry_type, kind, role, timestamp_ms,
        content_json, metadata_json, path_depth, created_order
      ) VALUES ('node-1', 'session-root', 'message', 'message', 'user', 11, '{}', '{}', 0, 0);
    `)
    database
      .prepare('INSERT INTO _migrations VALUES (?, ?, ?)')
      .run(revision, `legacy-revision-${String(revision)}`, 'now')
    if (revision < 25) database.exec('ALTER TABLE sessions DROP COLUMN authorization_mode_override')
    if (revision < 22) {
      database.exec('ALTER TABLE sessions DROP COLUMN worktree_start_from_origin')
      database.exec('ALTER TABLE sessions DROP COLUMN worktree_base_ref')
    }
    if (revision < 19) {
      database.exec('ALTER TABLE sessions DROP COLUMN worktree_path')
      database.exec('ALTER TABLE sessions DROP COLUMN environment_mode')
    }
  } finally {
    database.close()
  }
}

describe('Session Host cutover from older legacy revisions', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cutover-revision-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each(Array.from({ length: 14 }, (_, index) => index + 11))(
    'upgrades directly from supported legacy schema revision %s',
    async (revision) => {
      const sourceDatabasePath = path.join(temporaryRoot, `openwaggle-${String(revision)}.db`)
      const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
      const recoveryDatabasePath = path.join(temporaryRoot, 'pre-cutover-openwaggle.sqlite')
      seedLegacyDatabase(sourceDatabasePath, revision)

      await expect(
        runSessionHostCutover(
          { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
          1_000,
          fakeEmbeddingModel,
        ),
      ).resolves.toMatchObject({ status: 'migrated', sessionCount: 1, nodeCount: 1 })

      const target = new DatabaseSync(targetDatabasePath, { readOnly: true })
      try {
        expect(
          target
            .prepare(`
              SELECT sessions.environment_mode, sessions.worktree_path,
                sessions.worktree_base_ref, sessions.worktree_start_from_origin,
                sessions.authorization_mode_override,
                session_execution_profiles.authorization_ceiling
              FROM sessions
              JOIN session_execution_profiles
                ON session_execution_profiles.session_id = sessions.id
              WHERE sessions.id = 'session-root'
            `)
            .get(),
        ).toMatchObject({
          environment_mode: 'local',
          worktree_path: null,
          worktree_base_ref: null,
          worktree_start_from_origin: 0,
          authorization_mode_override: null,
          authorization_ceiling: 'yolo',
        })
      } finally {
        target.close()
      }
    },
  )
})
