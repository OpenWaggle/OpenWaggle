import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../database-migration-runner'
import { APP_MIGRATIONS } from '../database-migrations'
import {
  applyMigrations,
  insertSession,
  withMigrationDatabase,
} from './database-migrations.test-harness'

let tmpRoot = ''

function legacySummaryDatabase(sql: SqlClient.SqlClient, through = 45) {
  return Effect.gen(function* () {
    yield* applyMigrations(sql, through)
    // Reproduce the former branch's schema and exact ledger IDs. Only main's Setup table and
    // ledger entries are removed; resource and lineage schema remain as that branch created them.
    yield* sql`DROP TABLE session_worktree_setup`
    yield* sql`DELETE FROM _migrations WHERE id IN (26, 27)`
    for (const migration of APP_MIGRATIONS.filter(({ id }) => id >= 28 && id <= through)) {
      yield* sql`UPDATE _migrations SET id = ${migration.id - 2}, applied_at = 'legacy'
        WHERE id = ${migration.id}`
    }
    yield* insertSession(sql, 'queen')
    yield* insertSession(sql, 'worker')
    yield* sql`INSERT INTO session_lineage
      (session_id, parent_session_id, delegation_state, created_at, updated_at)
      VALUES ('worker', 'queen', 'accepted', 1, 1)`
    yield* sql`INSERT INTO session_resources
      (id, session_id, canonical_key, kind, title, available, created_at, updated_at)
      VALUES ('image', 'worker', 'url:https://example.com/image.png', 'image', 'Reference', 1, 1, 1)`
    yield* sql`INSERT INTO session_resource_occurrences (id, resource_id, actor, activity, created_at)
      VALUES ('occurrence', 'image', 'user', 'provided', 1)`
  })
}

describe('Session Summary migration ledger compatibility', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'summary-ledger-'))
  })
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('upgrades an old branch ledger without replaying resource migrations or losing data', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* legacySummaryDatabase(sql)
        yield* runMigrations()
        const first = yield* sql`SELECT * FROM _migrations ORDER BY id`
        yield* runMigrations()
        const second = yield* sql`SELECT * FROM _migrations ORDER BY id`
        const resources = yield* sql`SELECT id, canonical_key FROM session_resources`
        const lineage = yield* sql`SELECT session_id, parent_session_id FROM session_lineage`
        const occurrences = yield* sql`SELECT id, resource_id FROM session_resource_occurrences`
        const setup = yield* sql`SELECT name FROM pragma_table_info('session_worktree_setup')`
        const migrated =
          yield* sql`SELECT id, name, applied_at FROM _migrations WHERE id IN (26, 27, 28, 45) ORDER BY id`
        return { first, second, resources, lineage, occurrences, setup, migrated }
      }),
    )
    expect(result.second).toEqual(result.first)
    expect(result.resources).toEqual([
      { id: 'image', canonical_key: 'url:https://example.com/image.png' },
    ])
    expect(result.lineage).toEqual([{ session_id: 'worker', parent_session_id: 'queen' }])
    expect(result.occurrences).toEqual([{ id: 'occurrence', resource_id: 'image' }])
    expect(result.setup).toContainEqual({ name: 'dispatch_state' })
    expect(result.migrated).toEqual([
      { id: 26, name: 'session-worktree-setup-dispatch', applied_at: expect.any(String) },
      { id: 27, name: 'session-worktree-setup-receipt', applied_at: expect.any(String) },
      { id: 28, name: 'session-hive-lineage', applied_at: 'legacy' },
      { id: 45, name: 'session-resource-change-request-catalog-index', applied_at: 'legacy' },
    ])
  })

  it('preserves main migration IDs and existing Setup receipts while adding Summary tables', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 27)
        yield* insertSession(sql, 'main-session')
        yield* sql`INSERT INTO session_worktree_setup
        (session_id, worktree_path, generation, created_at, updated_at, dispatch_state, claim_token, accepted_at)
        VALUES ('main-session', '/worktree', 'generation', 1, 2, 'accepted', 'claim', 2)`
        const ledgerBefore = yield* sql`SELECT * FROM _migrations WHERE id IN (26, 27) ORDER BY id`
        const receiptBefore = yield* sql`SELECT * FROM session_worktree_setup`
        yield* runMigrations()
        yield* runMigrations()
        const ledgerAfter = yield* sql`SELECT * FROM _migrations WHERE id IN (26, 27) ORDER BY id`
        const receiptAfter = yield* sql`SELECT * FROM session_worktree_setup`
        const tables = yield* sql`SELECT name FROM sqlite_master WHERE type = 'table'`
        return { ledgerBefore, ledgerAfter, receiptBefore, receiptAfter, tables }
      }),
    )
    expect(result.ledgerAfter).toEqual(result.ledgerBefore)
    expect(result.receiptAfter).toEqual(result.receiptBefore)
    expect(result.tables).toContainEqual({ name: 'session_resources' })
    expect(result.tables).toContainEqual({ name: 'session_lineage' })
  })

  it.each([29, 35])(
    'upgrades a partially migrated branch through canonical ID %s',
    async (through) => {
      const result = await withMigrationDatabase(tmpRoot, (sql) =>
        Effect.gen(function* () {
          yield* legacySummaryDatabase(sql, through)
          yield* runMigrations()
          const first = yield* sql`SELECT * FROM _migrations ORDER BY id`
          yield* runMigrations()
          const second = yield* sql`SELECT * FROM _migrations ORDER BY id`
          const ledger = yield* sql`SELECT id, name FROM _migrations ORDER BY id`
          const resources = yield* sql`SELECT id, session_id FROM session_resources`
          const lineage = yield* sql`SELECT session_id, parent_session_id FROM session_lineage`
          return { first, second, ledger, resources, lineage }
        }),
      )
      expect(result.second).toEqual(result.first)
      expect(result.ledger).toEqual(APP_MIGRATIONS.map(({ id, name }) => ({ id, name })))
      expect(result.resources).toEqual([{ id: 'image', session_id: 'worker' }])
      expect(result.lineage).toEqual([{ session_id: 'worker', parent_session_id: 'queen' }])
    },
  )

  it('rolls back every remapped row when a later ledger update fails', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* legacySummaryDatabase(sql)
        yield* sql.unsafe(`CREATE TRIGGER reject_ledger_update BEFORE UPDATE ON _migrations
        WHEN OLD.id = 30 BEGIN SELECT RAISE(ABORT, 'Ledger write failed'); END`)
        const before = yield* sql`SELECT * FROM _migrations ORDER BY id`
        const outcome = yield* Effect.either(runMigrations())
        const after = yield* sql`SELECT * FROM _migrations ORDER BY id`
        yield* sql`DROP TRIGGER reject_ledger_update`
        yield* runMigrations()
        return { before, after, failed: outcome._tag === 'Left' }
      }),
    )
    expect(result.failed).toBe(true)
    expect(result.after).toEqual(result.before)
  })

  it('rejects unknown destination names without changing the old ledger', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* legacySummaryDatabase(sql)
        yield* sql`INSERT INTO _migrations VALUES (45, 'unrelated-migration', 'preserve-me')`
        const before = yield* sql`SELECT * FROM _migrations ORDER BY id`
        const outcome = yield* Effect.either(runMigrations())
        const after = yield* sql`SELECT * FROM _migrations ORDER BY id`
        return { before, after, failed: outcome._tag === 'Left' }
      }),
    )
    expect(result.failed).toBe(true)
    expect(result.after).toEqual(result.before)
  })

  it('never treats an unknown ID 26 entry as an applied Setup migration', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, 25)
        yield* sql`INSERT INTO _migrations VALUES (26, 'unrelated-migration', 'preserve-me')`
        const before = yield* sql`SELECT * FROM _migrations ORDER BY id`
        const outcome = yield* Effect.either(runMigrations())
        const after = yield* sql`SELECT * FROM _migrations ORDER BY id`
        return { before, after, failed: outcome._tag === 'Left' }
      }),
    )
    expect(result.failed).toBe(true)
    expect(result.after).toEqual(result.before)
  })
})
