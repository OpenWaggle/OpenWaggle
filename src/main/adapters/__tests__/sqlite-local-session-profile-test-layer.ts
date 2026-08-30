import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { SqliteLocalSessionProfileRepositoryLive } from '../sqlite-local-session-profile-repository'

export function makeLocalSessionProfileTestLayer(filename: string) {
  const sqlite = SqliteClient.layer({ filename, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          pi_session_id TEXT NOT NULL UNIQUE,
          project_path TEXT,
          title TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)
      for (const statement of SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      yield* sql`
        INSERT INTO session_client_profiles (
          id, name, credential_verifier, capabilities_json, scope_json,
          authorization_ceiling, revoked_at, created_at, updated_at
        ) VALUES (
          ${'profile-review'}, ${'review-bot'}, ${'verifier'},
          ${JSON.stringify(['sessions:read', 'sessions:message'])},
          ${JSON.stringify({ projectPaths: ['/project'] })},
          ${'ask-for-approval'}, ${null}, ${1}, ${1}
        )
      `
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    SqliteLocalSessionProfileRepositoryLive.pipe(Layer.provide(sqlite)),
  )
}
