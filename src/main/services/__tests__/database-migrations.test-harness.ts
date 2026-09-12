import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { runMigrations } from '../database-migration-runner'
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

export function applyMigrations(_sql: SqlClient.SqlClient, upToId: number) {
  return runMigrations(APP_MIGRATIONS.filter((migration) => migration.id <= upToId))
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
