import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { APP_MIGRATIONS } from '../database-migrations'
import { SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID } from '../session-host-schema-identity'

let tmpRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(tmpRoot, 'lazy-semantic-migration.sqlite'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })

  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* run(sql)
    }).pipe(Effect.provide(layer), Effect.orDie),
  )
}

function applyMigrations(sql: SqlClient.SqlClient, upToId: number) {
  return Effect.gen(function* () {
    yield* sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `)

    for (const migration of APP_MIGRATIONS) {
      if (migration.id > upToId) continue
      const existing = yield* sql<{ readonly id: number }>`
        SELECT id FROM _migrations WHERE id = ${migration.id} LIMIT 1
      `
      if (existing.length > 0) continue
      const skip = migration.skipIfColumns
      if (skip) {
        const columns = yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info(${skip.table})
        `
        const names = new Set(columns.map((column) => column.name))
        if (skip.columns.every((column) => names.has(column))) {
          yield* sql`
            INSERT INTO _migrations (id, name, applied_at)
            VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
          `
          continue
        }
      }
      for (const statement of migration.statements) yield* sql.unsafe(statement)
      yield* sql`
        INSERT INTO _migrations (id, name, applied_at)
        VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
      `
    }
  })
}

const LEGACY_TRIGGER_STATEMENTS = [
  `CREATE TRIGGER session_node_search_insert AFTER INSERT ON session_nodes BEGIN SELECT 1; END`,
  `CREATE TRIGGER session_node_search_update AFTER UPDATE ON session_nodes BEGIN SELECT 1; END`,
  `CREATE TRIGGER session_node_search_delete BEFORE DELETE ON session_nodes BEGIN SELECT 1; END`,
  `CREATE TRIGGER session_node_discovery_search_delete AFTER DELETE ON session_nodes BEGIN SELECT 1; END`,
]

describe('Session Host lazy semantic-scope migration', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lazy-scope-migration-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('upgrades a revision-26 scope and replaces its eager node triggers', async () => {
    const result = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID - 1)
        for (const trigger of [
          'session_node_search_insert',
          'session_node_search_update',
          'session_node_search_delete',
          'session_node_discovery_search_delete',
        ]) {
          yield* sql.unsafe(`DROP TRIGGER ${trigger}`)
        }
        yield* sql.unsafe(
          'ALTER TABLE session_transcript_semantic_scopes DROP COLUMN prepared_source_revision',
        )
        yield* sql.unsafe(
          'ALTER TABLE session_transcript_semantic_scopes DROP COLUMN source_revision',
        )
        for (const statement of LEGACY_TRIGGER_STATEMENTS) yield* sql.unsafe(statement)

        yield* applyMigrations(sql, SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID)
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          VALUES (${'semantic-upgrade'}, ${'pi-semantic-upgrade'}, ${'Older session'}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO session_transcript_semantic_scopes (
            session_id, requested_at, last_accessed_at, expires_at,
            node_limit, vector_bytes_per_node
          ) VALUES (${'semantic-upgrade'}, ${1}, ${1}, ${10_000}, ${10}, ${8})
        `
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, pi_entry_type, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, path_depth, created_order
          ) VALUES (
            ${'semantic-upgrade-node'}, ${'semantic-upgrade'}, ${'message'}, ${'message'},
            ${'assistant'}, ${1}, ${'{"text":"lazy upgrade"}'}, ${'{}'}, NULL, ${0}, ${0}
          )
        `
        const columns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(session_transcript_semantic_scopes)
        `
        const scope = yield* sql<{
          readonly source_revision: number
          readonly prepared_source_revision: number
        }>`
          SELECT source_revision, prepared_source_revision
          FROM session_transcript_semantic_scopes WHERE session_id = ${'semantic-upgrade'}
        `
        const migration = yield* sql<{ readonly id: number }>`
          SELECT id FROM _migrations
          WHERE id = ${SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID}
        `
        return { columns: columns.map((column) => column.name), scope, migration }
      }),
    )

    expect(result.columns).toEqual(
      expect.arrayContaining(['source_revision', 'prepared_source_revision']),
    )
    expect(result.scope).toEqual([{ source_revision: 1, prepared_source_revision: -1 }])
    expect(result.migration).toEqual([{ id: SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID }])
  })
})
