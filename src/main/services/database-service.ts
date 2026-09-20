import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Context, Effect, Layer } from 'effect'
import { app } from 'electron'
import { DatabaseBootstrapError } from '../errors'
import { DATABASE_FILE_NAME, SQLITE_PREPARE_CACHE_SIZE } from './database-constants'
import { runMigrations } from './database-migration-runner'

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
      yield* runMigrations()
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
