import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
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

function applyMigrations(sql: SqlClient.SqlClient, upToId: number) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `)
    for (const migration of APP_MIGRATIONS) {
      if (migration.id > upToId) continue
      const existing = yield* sql<{ id: number }>`
        SELECT id FROM _migrations WHERE id = ${migration.id} LIMIT 1
      `
      if (existing.length > 0) continue
      const skip = migration.skipIfColumn
      if (skip) {
        const columns = yield* sql<{ name: string }>`
          SELECT name FROM pragma_table_info(${skip.table})
        `
        if (columns.some((column) => column.name === skip.column)) {
          yield* sql`
            INSERT INTO _migrations (id, name, applied_at)
            VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
          `
          continue
        }
      }
      if (migration.run) yield* migration.run(sql)
      for (const statement of migration.statements) yield* sql.unsafe(statement)
      yield* sql`
        INSERT INTO _migrations (id, name, applied_at)
        VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
      `
    }
  })
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

  it('adds both provenance columns to an existing migration 30 database', async () => {
    const columns = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 30)
        yield* sql.unsafe(`ALTER TABLE session_output_retries DROP COLUMN node_id`)
        yield* sql.unsafe(`ALTER TABLE session_output_retries DROP COLUMN branch_id`)
        yield* applyMigrations(sql, 32)
        return yield* outputRetryColumns(sql)
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 31)?.name).toBe(
      'session-output-retry-node-provenance',
    )
    expect(APP_MIGRATIONS.find((migration) => migration.id === 32)?.name).toBe(
      'session-output-retry-branch-provenance',
    )
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['node_id', 'branch_id']),
    )
  })

  it('repairs a partially applied provenance migration', async () => {
    const columns = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 31)
        yield* sql.unsafe(`ALTER TABLE session_output_retries DROP COLUMN branch_id`)
        yield* applyMigrations(sql, 32)
        return yield* outputRetryColumns(sql)
      }),
    )

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['node_id', 'branch_id']),
    )
  })
})
