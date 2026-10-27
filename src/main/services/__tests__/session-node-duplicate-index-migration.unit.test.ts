import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../database-migration-runner'
import { APP_MIGRATIONS } from '../database-migrations'
import { runAppDatabaseMigrations } from '../database-service'
import {
  DELEGATION_ATTENTION_CAUSE_MIGRATION_ID,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
} from '../session-host-schema-identity'
import { SESSION_NODE_DUPLICATE_INDEX_MIGRATION } from '../session-node-duplicate-index-migration'
import { V1_BETA_MIGRATIONS } from '../v1-beta-migrations'

let temporaryRoot = ''

function withDatabase<A>(
  body: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  return Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, body).pipe(
      Effect.provide(SqliteClient.layer({ filename: path.join(temporaryRoot, 'nodes.sqlite') })),
    ),
  )
}

function nodeIndexes(sql: SqlClient.SqlClient) {
  return Effect.map(
    sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'session_nodes' AND name LIKE 'idx_session_nodes_session_created_order%'
      ORDER BY name
    `,
    (rows) => rows.map((row) => row.name),
  )
}

describe('dropping the duplicate session node index (D7.1)', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-node-index-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('is the newest migration, and one this binary supports', () => {
    expect(V1_BETA_MIGRATIONS.at(-1)).toBe(SESSION_NODE_DUPLICATE_INDEX_MIGRATION)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(SESSION_NODE_DUPLICATE_INDEX_MIGRATION.id)
  })

  it('leaves only the unique index, which still serves a Session ordered by created order', async () => {
    const before = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runMigrations(
          APP_MIGRATIONS.filter(({ id }) => id <= DELEGATION_ATTENTION_CAUSE_MIGRATION_ID),
        )
        return yield* nodeIndexes(sql)
      }),
    )
    expect(before).toEqual([
      'idx_session_nodes_session_created_order',
      'idx_session_nodes_session_created_order_unique',
    ])

    const after = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        const plan = yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN
          SELECT id FROM session_nodes WHERE session_id = ${'s'} ORDER BY created_order
        `
        return { indexes: yield* nodeIndexes(sql), plan: plan.map((row) => row.detail).join(' ') }
      }),
    )
    expect(after.indexes).toEqual(['idx_session_nodes_session_created_order_unique'])
    expect(after.plan).toContain('idx_session_nodes_session_created_order_unique')
    expect(after.plan).not.toContain('TEMP B-TREE')
  })
})
