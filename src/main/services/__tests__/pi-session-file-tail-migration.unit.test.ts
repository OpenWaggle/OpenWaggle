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
import { PI_SESSION_FILE_TAIL_MIGRATION } from '../pi-session-file-tail-migration'
import {
  PI_SESSION_FILE_TAIL_MIGRATION_ID,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
  SESSION_NODE_CONTENT_HASH_MIGRATION_ID,
} from '../session-host-schema-identity'

let temporaryRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(temporaryRoot, 'tail-upgrade.sqlite'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(Effect.flatMap(SqlClient.SqlClient, run).pipe(Effect.provide(layer)))
}

function readState(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly revision: number
      readonly file_size: number | null
      readonly tail_offset: number | null
      readonly tail_entry_count: number | null
    }>`SELECT revision, file_size, tail_offset, tail_entry_count FROM pi_session_file_projections`
    const ledger = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM _migrations WHERE id = ${PI_SESSION_FILE_TAIL_MIGRATION_ID}
    `
    return { rows, ledger: ledger.map((row) => [row.id, row.name]) }
  })
}

describe('upgrading a database through migration 81', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-file-tail-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('is one this binary supports', () => {
    expect(PI_SESSION_FILE_TAIL_MIGRATION.id).toBe(81)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBeGreaterThanOrEqual(
      PI_SESSION_FILE_TAIL_MIGRATION_ID,
    )
  })

  it('keeps each recorded projection and gives it no tail, once', async () => {
    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runMigrations(
          APP_MIGRATIONS.filter(({ id }) => id <= SESSION_NODE_CONTENT_HASH_MIGRATION_ID),
        )
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          VALUES (${'session-a'}, ${'pi-a'}, ${'A'}, 1, 1)
        `
        yield* sql`
          INSERT INTO pi_session_file_projections (
            session_id, file_size, file_mtime_ms, revision, updated_at
          ) VALUES (${'session-a'}, ${120}, ${5}, ${3}, ${1})
        `
      }),
    )

    const upgraded = await withDatabase((sql) =>
      Effect.zipRight(runAppDatabaseMigrations, readState(sql)),
    )
    expect(upgraded).toEqual({
      rows: [{ revision: 3, file_size: 120, tail_offset: null, tail_entry_count: null }],
      ledger: [[81, 'pi-session-file-tail']],
    })
    const again = await withDatabase((sql) =>
      Effect.zipRight(runAppDatabaseMigrations, readState(sql)),
    )
    expect(again).toEqual(upgraded)
  })
})
