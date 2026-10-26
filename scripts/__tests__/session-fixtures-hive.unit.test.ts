import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDatabasePath, seedHive } from '../support/session-fixtures'
import { runAppDatabaseMigrations } from '../../src/main/services/database-service'

describe('Hive Session fixtures', () => {
  let userDataDir = ''

  beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-fixture-test-'))
    await fs.mkdir(path.dirname(getDatabasePath(userDataDir)), { recursive: true })
    await Effect.runPromise(runAppDatabaseMigrations.pipe(
      Effect.provide(SqliteClient.layer({ filename: getDatabasePath(userDataDir) })),
    ))
  })

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  it('seeds a Worker spawned by another Worker one level deeper in the same Hive', async () => {
    const hive = await seedHive(
      userDataDir,
      { title: 'Queen', updatedAt: 30, messages: [] },
      [
        { title: 'Lead', updatedAt: 20, messages: [], delegationState: 'working' },
        {
          title: 'Helper',
          updatedAt: 10,
          messages: [],
          delegationState: 'needs_attention',
          attentionCause: 'worker_request',
          parentWorkerIndex: 0,
        },
      ],
    )
    const [lead, helper] = hive.workerSessionIds
    const database = new Database(getDatabasePath(userDataDir))
    try {
      const lineage = database.prepare(`
        SELECT lineage.child_session_id AS child, lineage.parent_session_id AS parent,
               lineage.hive_root_session_id AS root, lineage.depth,
               contracts.parent_session_id AS delegation_parent, contracts.attention_cause,
               runs.session_id AS parent_run_session
        FROM session_spawn_lineage AS lineage
        JOIN delegation_contracts AS contracts ON contracts.child_session_id = lineage.child_session_id
        JOIN session_runs AS runs ON runs.id = lineage.parent_run_id
        ORDER BY lineage.depth
      `).all()
      expect(lineage).toEqual([
        {
          child: lead, parent: hive.queenSessionId, root: hive.queenSessionId, depth: 1,
          delegation_parent: hive.queenSessionId, attention_cause: null,
          parent_run_session: hive.queenSessionId,
        },
        {
          child: helper, parent: lead, root: hive.queenSessionId, depth: 2,
          delegation_parent: lead, attention_cause: 'worker_request', parent_run_session: lead,
        },
      ])
    } finally {
      database.close()
    }
  })

  it('refuses a parent that is not an earlier Worker', async () => {
    await expect(
      seedHive(userDataDir, { title: 'Queen', updatedAt: 30, messages: [] }, [
        { title: 'Orphan', updatedAt: 20, messages: [], delegationState: 'working', parentWorkerIndex: 0 },
      ]),
    ).rejects.toThrow('must name an earlier Worker')
  })
})
