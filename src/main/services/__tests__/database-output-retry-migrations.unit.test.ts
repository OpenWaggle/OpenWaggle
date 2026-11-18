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

let tmpRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(tmpRoot, 'output-retry-migrations.sqlite'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* run(sql)
    }).pipe(Effect.provide(layer), Effect.orDie),
  )
}

function applyMigrations(_sql: SqlClient.SqlClient, upToId: number) {
  return runMigrations(APP_MIGRATIONS.filter((migration) => migration.id <= upToId))
}
function outputRetryColumns(sql: SqlClient.SqlClient) {
  return sql<{ readonly name: string }>`PRAGMA table_info(session_output_retries)`
}

describe('Output retry provenance migrations', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-output-migrations-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('adds both provenance columns to an existing migration 32 database', async () => {
    const columns = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 32)
        yield* sql.unsafe(`ALTER TABLE session_output_retries DROP COLUMN node_id`)
        yield* sql.unsafe(`ALTER TABLE session_output_retries DROP COLUMN branch_id`)
        yield* applyMigrations(sql, 34)
        return yield* outputRetryColumns(sql)
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 33)?.name).toBe(
      'session-output-retry-node-provenance',
    )
    expect(APP_MIGRATIONS.find((migration) => migration.id === 34)?.name).toBe(
      'session-output-retry-branch-provenance',
    )
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['node_id', 'branch_id']),
    )
  })

  it('repairs a partially applied provenance migration', async () => {
    const columns = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 33)
        yield* sql.unsafe(`ALTER TABLE session_output_retries DROP COLUMN branch_id`)
        yield* applyMigrations(sql, 34)
        return yield* outputRetryColumns(sql)
      }),
    )

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['node_id', 'branch_id']),
    )
  })

  it('backfills the metadata revision for existing retries', async () => {
    const result = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 35)
        yield* sql.unsafe(`ALTER TABLE session_output_retries DROP COLUMN updated_at`)
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, title, archived, created_at, updated_at)
          VALUES ('session-1', 'pi-session-1', 'Session', 0, 1000, 1000)
        `
        yield* sql`
          INSERT INTO session_output_retries (
            id, session_id, kind, title, url, node_id, branch_id, created_at
          ) VALUES (
            'pending-request', 'session-1', 'change-request', 'Title',
            'https://example.invalid/pull/1', 'node-1', 'branch-1', 1234
          )
        `
        yield* applyMigrations(sql, 36)
        const beforeBackfill = yield* sql<{ readonly updated_at: number }>`
          SELECT updated_at FROM session_output_retries WHERE id = 'pending-request'
        `
        yield* applyMigrations(sql, 37)
        const rows = yield* sql<{ readonly updated_at: number }>`
          SELECT updated_at FROM session_output_retries WHERE id = 'pending-request'
        `
        return {
          columns: yield* outputRetryColumns(sql),
          beforeBackfill: beforeBackfill[0]?.updated_at,
          updatedAt: rows[0]?.updated_at,
        }
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 36)?.name).toBe(
      'session-output-retry-metadata-revision',
    )
    expect(APP_MIGRATIONS.find((migration) => migration.id === 37)?.name).toBe(
      'session-output-retry-metadata-revision-backfill',
    )
    expect(result.columns.map((column) => column.name)).toContain('updated_at')
    expect(result.beforeBackfill).toBe(0)
    expect(result.updatedAt).toBe(1234)
  })
})
