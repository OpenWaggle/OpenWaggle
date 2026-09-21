import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSessionHostCutover } from '../session-host-cutover'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

describe('Session Host cutover search indexes', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cutover-search-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('populates full transcript rows and one compact discovery row per Session', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath)
    const source = new DatabaseSync(sourceDatabasePath)
    try {
      source.exec(`
        INSERT INTO session_nodes (
          id, session_id, parent_id, pi_entry_type, kind, timestamp_ms,
          content_json, metadata_json, path_depth, created_order
        ) VALUES ('node-summary', 'session-root', 'node-1', 'compaction',
          'compaction_summary', 12, '{"summary":"searchable summary"}', '{}', 1, 1)
      `)
    } finally {
      source.close()
    }

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        1_000,
        fakeEmbeddingModel,
      ),
    ).resolves.toMatchObject({ status: 'migrated' })

    const target = new DatabaseSync(targetDatabasePath, { readOnly: true })
    try {
      expect(
        target
          .prepare(`
            SELECT search_rows.node_id, discovery.initial_objective,
              discovery.current_preview
            FROM session_node_search_rows AS search_rows
            JOIN session_node_search AS search ON search.rowid = search_rows.search_rowid
            JOIN session_discovery_search_rows AS discovery_rows
              ON discovery_rows.session_id = search_rows.session_id
            JOIN session_node_discovery_search AS discovery
              ON discovery.rowid = discovery_rows.search_rowid
            WHERE search_rows.node_id = 'node-1'
          `)
          .get(),
      ).toEqual({ node_id: 'node-1', initial_objective: '', current_preview: '' })
      expect(
        target
          .prepare(`
        SELECT search_rows.created_order, search_rows.searchable,
          stats.searchable_node_count
        FROM session_node_search_rows AS search_rows
        JOIN session_transcript_search_stats AS stats ON stats.session_id = search_rows.session_id
        WHERE search_rows.node_id = 'node-1'
      `)
          .get(),
      ).toEqual({ created_order: 0, searchable: 0, searchable_node_count: 1 })
      expect(
        target
          .prepare(`
        SELECT created_order, searchable FROM session_node_search_rows WHERE node_id = 'node-summary'
      `)
          .get(),
      ).toEqual({ created_order: 1, searchable: 1 })
      expect(
        target
          .prepare(`
            SELECT name FROM sqlite_master
            WHERE name = 'session_transcript_search'
          `)
          .get(),
      ).toBeUndefined()
    } finally {
      target.close()
    }
  })

  it('preserves exact counts and earliest evidence as repeated terms cross cutover batches', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath)
    const source = new DatabaseSync(sourceDatabasePath)
    try {
      source.exec(`
        WITH RECURSIVE sequence(value) AS (
          SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 1025
        )
        INSERT INTO session_nodes (
          id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
          content_json, metadata_json, path_depth, created_order
        )
        SELECT printf('repeated-%04d', value), 'session-root',
          CASE WHEN value = 1 THEN 'node-1' ELSE printf('repeated-%04d', value - 1) END,
          'message', 'message', 'user', value + 20,
          json_object('text', CASE WHEN value <= 512
            THEN 'alpha alpha beta' ELSE 'alpha gamma gamma' END),
          CASE WHEN value IN (1, 513) THEN json_object('openWaggle', json_object(
            'runId', CASE WHEN value = 1 THEN 'run-first' ELSE 'run-later' END
          )) ELSE '{}' END,
          value, value
        FROM sequence;
        INSERT INTO sessions (id, pi_session_id, project_path, title, created_at, updated_at)
        VALUES ('session-secondary', 'pi-secondary', '/project', 'Secondary', 10, 20);
        INSERT INTO session_nodes (
          id, session_id, pi_entry_type, kind, role, timestamp_ms,
          content_json, metadata_json, path_depth, created_order
        ) VALUES ('other-alpha', 'session-secondary', 'message', 'message', 'user', 11,
          '{"text":"alpha alpha"}', '{}', 0, 0);
      `)
    } finally {
      source.close()
    }

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        1_000,
        fakeEmbeddingModel,
      ),
    ).resolves.toMatchObject({ status: 'migrated', sessionCount: 2, nodeCount: 1027 })

    const target = new DatabaseSync(targetDatabasePath, { readOnly: true })
    try {
      expect(
        target.prepare('SELECT * FROM session_transcript_terms ORDER BY session_id, term').all(),
      ).toEqual([
        {
          term: 'alpha',
          session_id: 'session-root',
          occurrences: 1537,
          first_node_id: 'repeated-0001',
          first_created_order: 1,
          first_run_id: 'run-first',
        },
        {
          term: 'beta',
          session_id: 'session-root',
          occurrences: 512,
          first_node_id: 'repeated-0001',
          first_created_order: 1,
          first_run_id: 'run-first',
        },
        {
          term: 'gamma',
          session_id: 'session-root',
          occurrences: 1026,
          first_node_id: 'repeated-0513',
          first_created_order: 513,
          first_run_id: 'run-later',
        },
        {
          term: 'alpha',
          session_id: 'session-secondary',
          occurrences: 2,
          first_node_id: 'other-alpha',
          first_created_order: 0,
          first_run_id: null,
        },
      ])
      expect(
        target.prepare('SELECT * FROM session_transcript_term_documents ORDER BY session_id').all(),
      ).toEqual([
        { session_id: 'session-root', token_count: 3075 },
        { session_id: 'session-secondary', token_count: 2 },
      ])
    } finally {
      target.close()
    }
  })
})
