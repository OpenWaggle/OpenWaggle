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
})
