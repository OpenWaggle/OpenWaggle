import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEmbeddingModel } from '../../adapters/multilingual-e5-session-embedding-model'
import type { LocalSessionHostPaths } from '../local-session-paths'
import { runSessionHostCutover } from '../session-host-cutover'
import {
  deletePreCutoverDatabase,
  restorePreCutoverDatabase,
  sessionHostRecoveryStatus,
} from '../session-host-recovery'

const fakeEmbeddingModel: SessionEmbeddingModel = {
  metadata: { id: 'test/e5', revision: 'test-revision', dimensions: 3, dtype: 'f32' },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
}

function seedEmptyLegacyDatabase(databasePath: string) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`
      CREATE TABLE _migrations (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
      );
      INSERT INTO _migrations VALUES (25, 'session-authorization-mode-override', 'now');
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, pi_session_id TEXT NOT NULL UNIQUE, pi_session_file TEXT,
        project_path TEXT, title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
        waggle_config_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        last_active_node_id TEXT, last_active_branch_id TEXT,
        environment_mode TEXT NOT NULL DEFAULT 'local', worktree_path TEXT,
        worktree_base_ref TEXT, worktree_start_from_origin INTEGER NOT NULL DEFAULT 0,
        authorization_mode_override TEXT
      );
      CREATE TABLE session_nodes (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        parent_id TEXT, pi_entry_type TEXT NOT NULL, kind TEXT NOT NULL, role TEXT,
        timestamp_ms INTEGER NOT NULL, content_json TEXT NOT NULL, metadata_json TEXT NOT NULL,
        branch_hint_id TEXT, path_depth INTEGER NOT NULL, created_order INTEGER NOT NULL
      );
      CREATE TABLE session_active_runs (
        run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL, run_mode TEXT NOT NULL, status TEXT NOT NULL,
        runtime_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
    `)
  } finally {
    database.close()
  }
}

function pathsFor(root: string): LocalSessionHostPaths {
  const stateRoot = path.join(root, 'session-host')
  return {
    stateRoot,
    legacyDatabasePath: path.join(root, 'openwaggle.db'),
    databasePath: path.join(stateRoot, 'session-host.sqlite'),
    recoveryDatabasePath: path.join(stateRoot, 'pre-cutover-openwaggle.sqlite'),
    credentialPath: path.join(stateRoot, 'local-user.credential'),
    endpoint: path.join(stateRoot, 'host-v2.sock'),
    endpointDirectory: stateRoot,
  }
}

describe('Session Host explicit recovery', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-recovery-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('reports, restores, and explicitly deletes the retained pre-cutover copy', async () => {
    const paths = pathsFor(temporaryRoot)
    seedEmptyLegacyDatabase(paths.legacyDatabasePath)
    await runSessionHostCutover(
      {
        sourceDatabasePath: paths.legacyDatabasePath,
        targetDatabasePath: paths.databasePath,
        recoveryDatabasePath: paths.recoveryDatabasePath,
      },
      Date.now(),
      fakeEmbeddingModel,
    )

    await expect(sessionHostRecoveryStatus(paths)).resolves.toMatchObject({
      active: { exists: true, schema: { compatible: true } },
      recovery: { exists: true },
    })

    const restored = await restorePreCutoverDatabase(paths, 2_000, fakeEmbeddingModel)
    expect(restored).toMatchObject({ status: 'restored', migration: { status: 'migrated' } })
    await expect(fs.access(restored.preservedActivePath)).resolves.toBeUndefined()
    await expect(sessionHostRecoveryStatus(paths)).resolves.toMatchObject({
      active: { exists: true, schema: { compatible: true } },
      recovery: { exists: true },
    })

    await expect(deletePreCutoverDatabase(paths)).resolves.toMatchObject({ status: 'deleted' })
    await expect(sessionHostRecoveryStatus(paths)).resolves.toMatchObject({
      active: { exists: true },
      recovery: { exists: false },
    })
  })
})
