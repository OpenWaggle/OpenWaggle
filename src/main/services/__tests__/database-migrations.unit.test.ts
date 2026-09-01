import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { APP_MIGRATIONS } from '../database-migrations'

/**
 * Applies the real migration list to a real database file.
 *
 * The authorization-mode column had no coverage, and it is the one place where a mistake stays
 * invisible until an existing database is opened: a column added with the wrong nullability would
 * read as `yolo` for every session that predates the feature, silently granting full access to
 * sessions the user never configured.
 */
const AUTHORIZATION_MIGRATION_ID = 25
const BEFORE_AUTHORIZATION_ID = AUTHORIZATION_MIGRATION_ID - 1

interface ColumnInfo {
  readonly name: string
  readonly notnull: number
}

let tmpRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(tmpRoot, 'migrations.sqlite'),
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

      const existing = yield* sql<{ id: number }>`
        SELECT id FROM _migrations WHERE id = ${migration.id} LIMIT 1
      `
      if (existing.length > 0) continue

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

      for (const statement of migration.statements) {
        yield* sql.unsafe(statement)
      }
      yield* sql`
        INSERT INTO _migrations (id, name, applied_at)
        VALUES (${migration.id}, ${migration.name}, ${new Date().toISOString()})
      `
    }
  })
}

function sessionColumns(sql: SqlClient.SqlClient) {
  return sql<ColumnInfo>`PRAGMA table_info(sessions)`
}

function insertSession(sql: SqlClient.SqlClient, id: string) {
  return sql`
    INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
    VALUES (${id}, ${`pi-${id}`}, ${'Older session'}, ${1}, ${1})
  `
}

describe('session authorization-mode migration', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-migrations-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('tolerates a database that already carries the column under a different ledger id', async () => {
    // This migration was renumbered from 24 to 25 so pinned-sessions could keep 24, so a database
    // from the earlier build already has the column. Without a guard the ALTER fails on
    // `duplicate column name` and takes application boot with it.
    const columns = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, BEFORE_AUTHORIZATION_ID)
        yield* sql.unsafe(`ALTER TABLE sessions ADD COLUMN authorization_mode_override TEXT`)

        yield* applyMigrations(sql, AUTHORIZATION_MIGRATION_ID)

        return yield* sessionColumns(sql)
      }),
    )

    expect(columns.filter((column) => column.name === 'authorization_mode_override')).toHaveLength(
      1,
    )
  })

  it('adds a nullable override column to a database created before it existed', async () => {
    const result = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, BEFORE_AUTHORIZATION_ID)
        const before = yield* sessionColumns(sql)

        yield* applyMigrations(sql, AUTHORIZATION_MIGRATION_ID)
        const after = yield* sessionColumns(sql)

        return {
          before: before.map((column) => column.name),
          override: after.find((column) => column.name === 'authorization_mode_override'),
        }
      }),
    )

    expect(result.before).not.toContain('authorization_mode_override')
    expect(result.override).toBeDefined()
    expect(result.override?.notnull).toBe(0)
  })

  it('leaves a pre-existing session inheriting rather than pinned to full access', async () => {
    const rows = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, BEFORE_AUTHORIZATION_ID)
        yield* insertSession(sql, 'old-session')
        yield* applyMigrations(sql, AUTHORIZATION_MIGRATION_ID)

        return yield* sql<{ authorization_mode_override: string | null }>`
          SELECT authorization_mode_override FROM sessions WHERE id = ${'old-session'}
        `
      }),
    )

    // NULL means inherit. Defaulting to 'yolo' would pin every session that predates the feature to
    // full access and make it ignore the user's global default forever.
    expect(rows[0]?.authorization_mode_override).toBeNull()
  })

  it('rejects a value that is not a known mode', async () => {
    const rejected = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, AUTHORIZATION_MIGRATION_ID)
        yield* insertSession(sql, 'session-1')

        return yield* sql`
          UPDATE sessions SET authorization_mode_override = ${'always-allow'} WHERE id = ${'session-1'}
        `.pipe(
          Effect.as(false),
          Effect.catchAll(() => Effect.succeed(true)),
        )
      }),
    )

    expect(rejected).toBe(true)
  })

  it('accepts both known modes and a cleared override', async () => {
    const accepted = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, AUTHORIZATION_MIGRATION_ID)
        yield* insertSession(sql, 'session-1')

        for (const mode of ['yolo', 'ask-for-approval', null]) {
          yield* sql`
            UPDATE sessions SET authorization_mode_override = ${mode} WHERE id = ${'session-1'}
          `
        }
        return true
      }),
    )

    expect(accepted).toBe(true)
  })

  it('keeps the pinned-sessions migration that shares the release, under its own id', async () => {
    // Migration 24 belongs to pinned sessions and had already shipped. An earlier merge silently
    // replaced it, which would have dropped that table for everyone upgrading.
    const tables = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, AUTHORIZATION_MIGRATION_ID)
        return yield* sql<{ name: string }>`
          SELECT name FROM sqlite_master WHERE type = ${'table'}
        `
      }),
    )

    expect(tables.map((table) => table.name)).toContain('pinned_sessions')
    expect(APP_MIGRATIONS.find((migration) => migration.id === 24)?.name).toBe('pinned-sessions')
  })

  it('adds the session resource catalog at migration 27 and keeps it session-owned', async () => {
    const result = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 27)
        yield* insertSession(sql, 'resource-session')
        yield* sql`
          INSERT INTO session_resources (
            id, session_id, canonical_key, kind, title, available, created_at, updated_at
          ) VALUES (
            'resource-1', 'resource-session', 'sha256:image', 'image', 'image.png', 1, 1, 1
          )
        `
        yield* sql`
          INSERT INTO session_resource_occurrences (
            id, resource_id, actor, activity, created_at
          ) VALUES ('occurrence-1', 'resource-1', 'user', 'provided', 1)
        `
        yield* sql`DELETE FROM sessions WHERE id = 'resource-session'`
        const resources = yield* sql<{ readonly id: string }>`SELECT id FROM session_resources`
        const occurrences = yield* sql<{ readonly id: string }>`
          SELECT id FROM session_resource_occurrences
        `
        return { resources, occurrences }
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 27)?.name).toBe(
      'session-resource-catalog',
    )
    expect(APP_MIGRATIONS.find((migration) => migration.id === 26)?.name).toBe(
      'session-hive-lineage',
    )
    expect(result).toEqual({ resources: [], occurrences: [] })
  })

  it('adds session-owned resource backfill progress at migration 28', async () => {
    const state = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 28)
        yield* insertSession(sql, 'backfill-session')
        yield* sql`
          INSERT INTO session_resource_backfill_state (session_id, through_created_order)
          VALUES ('backfill-session', 42)
        `
        yield* sql`DELETE FROM sessions WHERE id = 'backfill-session'`
        return yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_resource_backfill_state
        `
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 28)?.name).toBe(
      'session-resource-backfill-state',
    )
    expect(state).toEqual([])
  })

  it('adds durable managed-resource cleanup work at migration 29', async () => {
    const queued = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 28)
        yield* sql`DROP TABLE session_resource_cleanup_queue`
        yield* applyMigrations(sql, 29)
        yield* sql`
          INSERT INTO session_resource_cleanup_queue (session_id, queued_at)
          VALUES ('deleted-session', 1)
        `
        return yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_resource_cleanup_queue
        `
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 29)?.name).toBe(
      'session-resource-cleanup-queue',
    )
    expect(queued).toEqual([{ session_id: 'deleted-session' }])
  })

  it('adds session-owned durable Output retry work at migration 30', async () => {
    const pending = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 30)
        yield* insertSession(sql, 'output-session')
        yield* sql`
          INSERT INTO session_output_retries (
            id, session_id, kind, commit_hash, summary, created_at
          ) VALUES (
            'pending-commit', 'output-session', 'commit', 'abc123', 'Complete hub', 1
          )
        `
        yield* sql`DELETE FROM sessions WHERE id = 'output-session'`
        return yield* sql<{ readonly id: string }>`
          SELECT id FROM session_output_retries
        `
      }),
    )

    expect(APP_MIGRATIONS.find((migration) => migration.id === 30)?.name).toBe(
      'session-output-retry-queue',
    )
    expect(pending).toEqual([])
  })
})
