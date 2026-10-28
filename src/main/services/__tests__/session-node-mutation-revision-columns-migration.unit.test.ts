import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { runMigrations } from '../database-migration-runner'
import { APP_MIGRATIONS } from '../database-migrations'
import { runAppDatabaseMigrations } from '../database-service'
import {
  PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION_ID,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
  SESSION_NODE_MUTATION_REVISION_COLUMNS_MIGRATION_ID,
} from '../session-host-schema-identity'

let temporaryRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(temporaryRoot, 'node-mutation-columns.sqlite'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(Effect.flatMap(SqlClient.SqlClient, run).pipe(Effect.provide(layer)))
}

function revision(sql: SqlClient.SqlClient) {
  return Effect.map(
    sql<{ readonly node_mutation_revision: number }>`
      SELECT node_mutation_revision FROM session_control_states WHERE session_id = ${'session-a'}
    `,
    (rows) => rows[0]?.node_mutation_revision,
  )
}

describe('upgrading a database through migration 85', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-node-mutation-columns-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('is one this binary supports, after 84 in the ledger', () => {
    expect(SESSION_NODE_MUTATION_REVISION_COLUMNS_MIGRATION_ID).toBe(85)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(
      SESSION_NODE_MUTATION_REVISION_COLUMNS_MIGRATION_ID,
    )
    const ids = APP_MIGRATIONS.map(({ id }) => id)
    expect(ids.at(-1)).toBe(SESSION_NODE_MUTATION_REVISION_COLUMNS_MIGRATION_ID)
    expect(ids.indexOf(SESSION_NODE_MUTATION_REVISION_COLUMNS_MIGRATION_ID)).toBeGreaterThan(
      ids.indexOf(PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION_ID),
    )
  })

  it('bumps the node-mutation revision for content, not for a digest alone', async () => {
    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runMigrations(
          APP_MIGRATIONS.filter(
            ({ id }) => id < SESSION_NODE_MUTATION_REVISION_COLUMNS_MIGRATION_ID,
          ),
        )
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          VALUES (${'session-a'}, ${'pi-a'}, ${'A'}, 1, 1)
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, queue_state, queue_revision, node_mutation_revision,
            updated_at
          ) VALUES (${'session-a'}, 0, 'running', 0, 0, 0)
        `
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms, content_json,
            metadata_json, path_depth, created_order
          ) VALUES (
            ${'node-a'}, ${'session-a'}, NULL, 'message', 'user_message', 'user', 1,
            ${'{"text":"a"}'}, '{}', 0, 0
          )
        `
      }),
    )

    const result = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        const start = yield* revision(sql)
        yield* sql`UPDATE session_nodes SET content_hash = ${'digest'} WHERE id = ${'node-a'}`
        const afterDigest = yield* revision(sql)
        yield* sql`UPDATE session_nodes SET content_json = ${'{"text":"b"}'} WHERE id = ${'node-a'}`
        const afterContent = yield* revision(sql)
        return { start, afterDigest, afterContent }
      }),
    )
    expect(result).toEqual({ start: 0, afterDigest: 0, afterContent: 1 })
  })
})
