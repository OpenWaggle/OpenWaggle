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

  it('populates indexed node-to-FTS rowids without the retired transcript index', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath)

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
            SELECT search_rows.node_id
            FROM session_node_search_rows AS search_rows
            JOIN session_node_search AS search ON search.rowid = search_rows.search_rowid
            JOIN session_node_discovery_search AS discovery
              ON discovery.rowid = search_rows.discovery_search_rowid
            WHERE search_rows.node_id = 'node-1'
          `)
          .get(),
      ).toEqual({ node_id: 'node-1' })
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
