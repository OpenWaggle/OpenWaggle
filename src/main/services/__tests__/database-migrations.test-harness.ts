import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { APP_MIGRATIONS } from '../database-migrations'

export interface ColumnInfo {
  readonly name: string
  readonly notnull: number
}

export function withMigrationDatabase<A>(
  tmpRoot: string,
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(tmpRoot, 'migrations.sqlite'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })

  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* run(sql)
    }).pipe(Effect.provide(layer), Effect.orDie),
  )
}

export function applyMigrations(sql: SqlClient.SqlClient, upToId: number) {
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

export function sessionColumns(sql: SqlClient.SqlClient) {
  return sql<ColumnInfo>`PRAGMA table_info(sessions)`
}

export function insertSession(sql: SqlClient.SqlClient, id: string) {
  return sql`
    INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
    VALUES (${id}, ${`pi-${id}`}, ${'Older session'}, ${1}, ${1})
  `
}
