import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import {
  SessionExportOperationRepository,
  type SessionExportOperationRepositoryShape,
} from '../../ports/session-export-operation-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { SqliteSessionExportOperationRepositoryLive } from '../sqlite-session-export-operation-repository'

function makeLayer(filename: string) {
  const sqlite = SqliteClient.layer({ filename, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
      for (const statement of SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      yield* sql`INSERT INTO sessions (id) VALUES (${'session-1'})`
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    SqliteSessionExportOperationRepositoryLive.pipe(Layer.provide(sqlite)),
  )
}

export function makeSessionExportOperationRuntime(filename: string) {
  return ManagedRuntime.make(makeLayer(filename))
}

export function withSessionExportOperationRepository<A, E>(
  runtime: ReturnType<typeof makeSessionExportOperationRuntime>,
  effect: (repository: SessionExportOperationRepositoryShape) => Effect.Effect<A, E, never>,
) {
  return runtime.runPromise(
    Effect.gen(function* () {
      return yield* effect(yield* SessionExportOperationRepository)
    }),
  )
}
