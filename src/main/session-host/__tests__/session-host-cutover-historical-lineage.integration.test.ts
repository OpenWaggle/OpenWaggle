import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSessionHostCutover } from '../session-host-cutover'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

describe('Session Host historical Hive cutover', () => {
  let root = ''
  let sourceDatabasePath = ''
  let targetDatabasePath = ''
  let recoveryDatabasePath = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-historical-hive-'))
    sourceDatabasePath = path.join(root, 'openwaggle.sqlite')
    targetDatabasePath = path.join(root, 'host', 'session-host.sqlite')
    recoveryDatabasePath = path.join(root, 'recovery.sqlite')
    seedLegacyDatabase(sourceDatabasePath)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('retains released MCP Worker ancestry without inventing a Host grant or parent Run', async () => {
    const source = new DatabaseSync(sourceDatabasePath)
    try {
      source.exec(`
        CREATE TABLE session_lineage (
          session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
          parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          agent_definition_name TEXT,
          delegation_state TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO sessions (id, pi_session_id, project_path, title, created_at, updated_at)
          VALUES ('session-worker', 'pi-worker', '/project', 'Worker', 12, 22);
        INSERT INTO session_lineage (
          session_id, parent_session_id, agent_definition_name, delegation_state,
          created_at, updated_at
        ) VALUES ('session-worker', 'session-root', 'reviewer', 'working', 12, 22);
      `)
    } finally {
      source.close()
    }

    await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      1_000,
      fakeEmbeddingModel,
    )

    const target = new DatabaseSync(targetDatabasePath, { readOnly: true })
    try {
      expect(
        target
          .prepare(`SELECT parent_session_id, agent_definition_name, delegation_state
          FROM session_lineage WHERE session_id = 'session-worker'`)
          .get(),
      ).toMatchObject({
        parent_session_id: 'session-root',
        agent_definition_name: 'reviewer',
        delegation_state: 'working',
      })
      expect(target.prepare('SELECT COUNT(*) AS count FROM session_spawn_lineage').get()).toEqual({
        count: 0,
      })
      expect(
        target.prepare('SELECT COUNT(*) AS count FROM derived_child_management_grants').get(),
      ).toEqual({ count: 0 })
      expect(target.prepare(`SELECT name FROM _migrations WHERE id = 51`).get()).toEqual({
        name: 'session-host-query-time-transcript-term-normalization',
      })
      expect(
        target
          .prepare(`SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'session_transcript_terms_before_normalization'`)
          .get(),
      ).toBeUndefined()
    } finally {
      target.close()
    }
  })
})
