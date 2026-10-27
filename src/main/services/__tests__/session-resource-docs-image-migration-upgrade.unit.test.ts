import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import Database from 'better-sqlite3'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateSessionHostCompletionSeal } from '../../session-host/session-host-completion-seal'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { runMigrations } from '../database-migration-runner'
import { APP_MIGRATIONS } from '../database-migrations'
import { runAppDatabaseMigrations } from '../database-service'
import {
  DELEGATION_ATTENTION_CAUSE_MIGRATION_ID,
  HIVE_TOOL_NAME_MIGRATION_ID,
  SESSION_HOST_DEFERRED_DISCOVERY_REFRESH_MIGRATION_ID,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
  SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_ID,
} from '../session-host-schema-identity'

const DATABASE_FILE = 'docs-image-upgrade.sqlite'
let temporaryRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(temporaryRoot, DATABASE_FILE),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('PRAGMA foreign_keys = ON')
      return yield* run(sql)
    }).pipe(Effect.provide(layer)),
  )
}

/** One Session with a pre-#356 docs image output, an agent's unavailable image, and backfill state. */
function seedBeta25Resources(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
      VALUES (${'docs-session'}, ${'pi-docs-session'}, ${'Docs Session'}, 1, 1)
    `
    for (const [id, label, actor] of [
      ['docs-image', 'openwaggle_docs', 'tool'],
      ['agent-image', null, 'agent'],
    ] as const) {
      yield* sql`
        INSERT INTO session_resources (
          id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
          available, is_source, is_output, created_at, updated_at
        ) VALUES (
          ${id}, ${'docs-session'}, ${`unavailable-image:docs-session:node:${id}`}, ${'image'},
          ${id}, ${'image/png'}, NULL, NULL, 0, 0, 1, 1, 1
        )
      `
      yield* sql`
        INSERT INTO session_resource_occurrences (
          id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
        ) VALUES (
          ${`${id}-occurrence`}, ${id}, ${'node'}, NULL, ${actor}, ${'created'}, ${label},
          ${'/screenshots/hive-sessions.png'}, 1
        )
      `
    }
    yield* sql`
      INSERT INTO session_resource_backfill_state (session_id, through_created_order)
      VALUES (${'docs-session'}, 10)
    `
  })
}

function readState(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const resources = yield* sql<{ readonly id: string }>`
      SELECT id FROM session_resources ORDER BY id
    `
    const backfill = yield* sql<{ readonly session_id: string }>`
      SELECT session_id FROM session_resource_backfill_state
    `
    const ledger = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM _migrations WHERE id > ${HIVE_TOOL_NAME_MIGRATION_ID} ORDER BY id
    `
    return {
      resources: resources.map((row) => row.id),
      backfill: backfill.map((row) => row.session_id),
      ledger: ledger.map((row) => [row.id, row.name]),
    }
  })
}

describe('upgrading a beta.25 database through migrations 72 and 73', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-docs-image-upgrade-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps #366 at 72, applies the docs-image cleanup at 73, and is idempotent', async () => {
    expect(SESSION_HOST_DEFERRED_DISCOVERY_REFRESH_MIGRATION_ID).toBe(72)
    expect(SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_ID).toBe(73)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBeGreaterThanOrEqual(
      DELEGATION_ATTENTION_CAUSE_MIGRATION_ID,
    )

    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runMigrations(APP_MIGRATIONS.filter(({ id }) => id <= HIVE_TOOL_NAME_MIGRATION_ID))
        yield* seedBeta25Resources(sql)
      }),
    )

    const upgraded = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        return yield* readState(sql)
      }),
    )
    expect(upgraded).toEqual({
      resources: ['agent-image'],
      backfill: [],
      ledger: [
        [72, 'session-host-deferred-discovery-refresh'],
        [73, 'session-resource-docs-image-references'],
        [74, 'delegation-attention-cause'],
        [82, 'session-node-duplicate-index'],
        [83, 'session-authority-revision'],
      ],
    })

    const again = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        return yield* readState(sql)
      }),
    )
    expect(again).toEqual(upgraded)

    const database = new Database(path.join(temporaryRoot, DATABASE_FILE), { readonly: true })
    try {
      expect(() => validateSessionHostCompletionSeal(database)).not.toThrow()
    } finally {
      database.close()
    }
  })
})
