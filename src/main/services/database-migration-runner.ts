import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { APP_MIGRATIONS, type AppMigration } from './database-migrations'
import { normalizeSessionSummaryMigrationLedger } from './database-summary-migration-compatibility'

const STRICT_MIGRATION_IDENTITY_FROM = 26

const createMigrationsTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
})

export function runMigrations(migrations: readonly AppMigration[] = APP_MIGRATIONS) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* createMigrationsTable
    yield* normalizeSessionSummaryMigrationLedger(sql)

    for (const migration of migrations) {
      const existingRows = yield* sql<{ id: number; name: string }>`
      SELECT id, name
      FROM _migrations
      WHERE id = ${migration.id}
      LIMIT 1
    `

      if (existingRows.length > 0) {
        if (
          migration.id >= STRICT_MIGRATION_IDENTITY_FROM &&
          existingRows[0]?.name !== migration.name
        ) {
          return yield* Effect.fail(
            new Error(
              `Migration ${migration.id} belongs to ${existingRows[0]?.name}, not ${migration.name}.`,
            ),
          )
        }
        continue
      }

      // A column that is already present means the change landed under a different ledger id, so the
      // ALTER would fail and take boot with it. Record the migration and move on.
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

      yield* sql.withTransaction(
        Effect.gen(function* () {
          if (migration.run) yield* migration.run(sql)
          for (const statement of migration.statements) {
            yield* sql.unsafe(statement)
          }
          yield* sql`
          INSERT INTO _migrations (id, name, applied_at)
          VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
        `
        }),
      )
    }
  })
}
