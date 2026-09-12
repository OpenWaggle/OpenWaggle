import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { APP_MIGRATIONS } from '../database-migrations'
import { runAppDatabaseMigrations } from '../database-service'
import { SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION_ID } from '../session-host-schema-identity'

describe('browser preview prepared attachment migration', () => {
  it('preserves prepared bytes and ownership, allows browser origin, and keeps Session cascade cleanup', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('PRAGMA foreign_keys = ON')
        yield* sql.unsafe(
          'CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
        )
        for (const migration of APP_MIGRATIONS.filter(
          (row) => row.id < SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION_ID,
        )) {
          const skip = migration.skipIfColumns
          const columns = skip
            ? yield* sql<{
                readonly name: string
              }>`SELECT name FROM pragma_table_info(${skip.table})`
            : []
          if (!skip?.columns.every((name) => columns.some((column) => column.name === name))) {
            for (const statement of migration.statements)
              yield* sql
                .unsafe(statement)
                .pipe(
                  Effect.mapError(
                    (cause) => new Error(`Migration ${migration.id}: ${statement}`, { cause }),
                  ),
                )
          }
          yield* sql`INSERT INTO _migrations VALUES (${migration.id}, ${migration.name}, 'prior-build')`
        }
        yield* sql`INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at) VALUES ('s', 'pi-s', 'Preserved', 1, 2)`
        yield* sql`INSERT INTO session_prepared_attachments (id, owner_caller_id, preparation_request_id, session_id, kind, origin, name, real_path, mime_type, size_bytes, source_base64, extracted_text, created_at, bound_at, expires_at) VALUES ('a', 'caller', 'request', 's', 'image', 'user-file', 'snapshot.png', '/project/snapshot.png', 'image/png', 3, 'YWJj', '', 1, 2, 100)`
        const before = yield* sql`SELECT * FROM session_prepared_attachments`
        yield* runAppDatabaseMigrations
        expect(yield* sql`SELECT * FROM session_prepared_attachments`).toEqual(
          before.map((row) => ({ ...row, browser_preview_json: null })),
        )
        yield* sql`UPDATE session_prepared_attachments SET origin = 'browser-preview', browser_preview_json = ${'{"pageUrl":"http://localhost"}'} WHERE id = 'a'`
        expect(
          (yield* Effect.either(
            sql`UPDATE session_prepared_attachments SET browser_preview_json = 'not-json' WHERE id = 'a'`,
          ))._tag,
        ).toBe('Left')
        yield* runAppDatabaseMigrations
        expect(yield* sql`SELECT origin, source_base64 FROM session_prepared_attachments`).toEqual([
          { origin: 'browser-preview', source_base64: 'YWJj' },
        ])
        expect(
          yield* sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_session_prepared_attachments_%'`,
        ).toHaveLength(3)
        yield* sql`DELETE FROM sessions WHERE id = 's'`
        expect(yield* sql`SELECT * FROM session_prepared_attachments`).toEqual([])
        expect(yield* sql.unsafe('PRAGMA foreign_key_check')).toEqual([])
      }).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' }))),
    )
  })
})
