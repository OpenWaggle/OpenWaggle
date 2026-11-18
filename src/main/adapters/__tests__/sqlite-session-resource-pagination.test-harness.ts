import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import {
  CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
  CURRENT_SESSION_SCHEMA_STATEMENTS,
} from '../../services/database-schema'
import { SqliteSessionResourceRepositoryLive } from '../sqlite-session-resource-repository'

export function makeSessionResourceCatalogTestLayer(databasePath: string) {
  const sqliteLayer = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schemaLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('PRAGMA foreign_keys = ON')
      for (const statement of [
        ...CURRENT_SESSION_SCHEMA_STATEMENTS,
        ...CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
      ]) {
        yield* sql.unsafe(statement)
      }
      yield* sql`
        INSERT INTO sessions (
          id, pi_session_id, title, archived, created_at, updated_at, last_active_branch_id
        ) VALUES
          ('session-1', 'pi-session-1', 'Session', 0, 1, 1, 'branch-active'),
          ('session-2', 'pi-session-2', 'Other Session', 0, 1, 1, 'other-active')
      `
      yield* sql`
        WITH RECURSIVE resource_numbers(number) AS (
          SELECT 0
          UNION ALL
          SELECT number + 1 FROM resource_numbers WHERE number < 299
        )
        INSERT INTO session_resources (
          id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
          available, is_source, is_output, created_at, updated_at
        )
        SELECT
          'resource-' || number,
          'session-1',
          'file:/resource-' || number,
          CASE WHEN number % 2 = 0 THEN 'image' ELSE 'file' END,
          'Resource ' || number,
          CASE WHEN number % 2 = 0 THEN 'image/png' ELSE 'text/plain' END,
          '/resource-' || number,
          NULL,
          1,
          CASE WHEN number % 3 IN (0, 2) THEN 1 ELSE 0 END,
          CASE WHEN number % 3 IN (1, 2) THEN 1 ELSE 0 END,
          1000 + number,
          1000 + number
        FROM resource_numbers
      `
      yield* sql`
        WITH RECURSIVE
          resource_numbers(number) AS (
            SELECT 0
            UNION ALL
            SELECT number + 1 FROM resource_numbers WHERE number < 299
          ),
          occurrence_numbers(number) AS (
            SELECT 0
            UNION ALL
            SELECT number + 1 FROM occurrence_numbers WHERE number < 11
          )
        INSERT INTO session_resource_occurrences (
          id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
        )
        SELECT
          'occurrence-' || resource_numbers.number || '-' || occurrence_numbers.number,
          'resource-' || resource_numbers.number,
          'node-' || resource_numbers.number || '-' || occurrence_numbers.number,
          CASE
            WHEN resource_numbers.number % 4 = 0 AND occurrence_numbers.number = 0
              THEN 'branch-active'
            ELSE 'branch-hidden'
          END,
          'agent',
          CASE
            WHEN resource_numbers.number % 3 = 0 THEN 'read'
            WHEN resource_numbers.number % 3 = 1 THEN 'created'
            WHEN occurrence_numbers.number % 2 = 0 THEN 'read'
            ELSE 'created'
          END,
          NULL,
          '/resource-' || resource_numbers.number || '-occurrence-' || occurrence_numbers.number,
          100000 + resource_numbers.number * 100 + occurrence_numbers.number
        FROM resource_numbers CROSS JOIN occurrence_numbers
      `
      yield* sql`
        INSERT INTO session_resources (
          id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
          available, is_source, is_output, created_at, updated_at
        ) VALUES (
          'other-resource', 'session-2', 'file:/other', 'image', 'Other', 'image/png',
          '/other', NULL, 1, 1, 0, 1, 1
        )
      `
    }).pipe(Effect.provide(sqliteLayer)),
  )
  return Layer.mergeAll(
    schemaLayer,
    SqliteSessionResourceRepositoryLive.pipe(Layer.provide(sqliteLayer)),
    sqliteLayer,
  )
}
