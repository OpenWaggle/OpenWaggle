import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Context, Effect, Layer } from 'effect'
import { app } from 'electron'
import { DatabaseBootstrapError } from '../errors'
import { DATABASE_FILE_NAME, SQLITE_PREPARE_CACHE_SIZE } from './database-constants'
import { APP_MIGRATIONS } from './database-migrations'

export interface AppDatabaseService {
  readonly path: string
}

export class AppDatabase extends Context.Tag('@openwaggle/AppDatabase')<
  AppDatabase,
  AppDatabaseService
>() {}

function getDatabasePath() {
  return join(app.getPath('userData'), DATABASE_FILE_NAME)
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

const runMigrations = Effect.gen(function* () {
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
  const databasePath = getDatabasePath()

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

      yield* sql.unsafe('PRAGMA journal_mode = WAL;')
      yield* sql.unsafe('PRAGMA foreign_keys = ON;')
      yield* sql.unsafe('PRAGMA busy_timeout = 5000;')
      yield* runMigrations
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
