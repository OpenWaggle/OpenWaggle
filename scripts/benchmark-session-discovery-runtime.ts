import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { SQLITE_PREPARE_CACHE_SIZE } from '../src/main/services/database-constants'

export function sessionDiscoveryBenchmarkQueryExecutor(databasePath: string) {
  const runtime = ManagedRuntime.make(
    SqliteClient.layer({ filename: databasePath, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE }),
  )
  return {
    run: <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  }
}
