import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Context, Effect, Layer } from 'effect'
import { app } from 'electron'
import { DatabaseBootstrapError } from '../errors'
import { SQLITE_PREPARE_CACHE_SIZE } from './database-constants'
import { APP_MIGRATIONS } from './database-migrations'

export interface AppDatabaseService {
  readonly path: string
}

export class AppDatabase extends Context.Tag('@openwaggle/AppDatabase')<
  AppDatabase,
  AppDatabaseService
>() {}

function getDatabasePath() {
  return join(app.getPath('userData'), 'session-host', 'session-host.sqlite')
}

export type AppDatabaseAccess = 'owner' | 'client-isolated'

let configuredAccess: AppDatabaseAccess = 'owner'
let databaseLayerCreated = false

export function configureAppDatabaseAccess(access: AppDatabaseAccess) {
  if (databaseLayerCreated) {
    throw new Error('App database access must be configured before runtime initialization.')
  }
  configuredAccess = access
}

export function isAppDatabaseClientIsolated() {
  return configuredAccess === 'client-isolated'
}

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

export const runAppDatabaseMigrations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* createMigrationsTable

  for (const migration of APP_MIGRATIONS) {
    const existingRows = yield* sql<{ id: number }>`
      SELECT id
      FROM _migrations
      WHERE id = ${migration.id}
      LIMIT 1
    `

    if (existingRows.length > 0) {
      continue
    }

    // A column that is already present means the change landed under a different ledger id, so the
    // ALTER would fail and take boot with it. Record the migration and move on.
    const skip = migration.skipIfColumns
    if (skip) {
      const columns = yield* sql<{ name: string }>`
        SELECT name FROM pragma_table_info(${skip.table})
      `
      const existingColumns = new Set(columns.map((column) => column.name))
      if (skip.columns.every((column) => existingColumns.has(column))) {
        yield* sql`
          INSERT INTO _migrations (id, name, applied_at)
          VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
        `
        continue
      }
    }

    yield* sql.withTransaction(
      Effect.gen(function* () {
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

const makeDatabaseLayer = Effect.gen(function* () {
  databaseLayerCreated = true
  const databasePath = configuredAccess === 'client-isolated' ? ':memory:' : getDatabasePath()

  yield* Effect.tryPromise({
    try: () => mkdir(dirname(databasePath), { recursive: true }),
    catch: (cause) =>
      new DatabaseBootstrapError({
        stage: 'mkdir',
        message: `Failed to prepare database directory for ${databasePath}`,
        cause,
      }),
  })

  const sqliteLayer = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  }).pipe(
    Layer.mapError(
      (cause) =>
        new DatabaseBootstrapError({
          stage: 'connect',
          message: `Failed to open database at ${databasePath}`,
          cause,
        }),
    ),
  )

  const setupLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql.unsafe('PRAGMA foreign_keys = ON;')
      yield* sql.unsafe('PRAGMA busy_timeout = 5000;')
      yield* sql.unsafe('PRAGMA journal_mode = WAL;')
      yield* runAppDatabaseMigrations
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DatabaseBootstrapError({
            stage: 'setup',
            message: `Failed to initialize database at ${databasePath}`,
            cause,
          }),
      ),
    ),
  )

  return Layer.mergeAll(
    sqliteLayer,
    Layer.succeed(AppDatabase, { path: databasePath } satisfies AppDatabaseService),
    setupLayer.pipe(Layer.provide(sqliteLayer)),
  )
}).pipe(Layer.unwrapEffect)

export const AppDatabaseLive = makeDatabaseLayer
