import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../database-migration-runner'
import { APP_MIGRATIONS } from '../database-migrations'
import { runAppDatabaseMigrations } from '../database-service'
import { planSessionHostLedgerUpgrade } from '../session-host-ledger-compatibility'
import { repairSessionHostMigrationLedger } from '../session-host-ledger-repair'
import {
  SESSION_HOST_BASELINE_MIGRATION_ID,
  SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID,
  SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID,
} from '../session-host-schema-identity'

const oldHiveRows = [
  { id: 26, name: 'session-host-v2-target-schema' },
  { id: 27, name: 'session-host-lazy-semantic-scope-invalidation' },
  { id: 28, name: 'session-host-query-time-transcript-term-normalization' },
  { id: 29, name: 'session-host-export-path-checkpoints' },
  { id: 30, name: 'session-host-cascade-safe-node-deletion' },
  { id: 31, name: 'session-host-native-discovery-signatures' },
]
const preSummaryHostRows = [
  { id: 28, name: 'session-host-v2-target-schema' },
  { id: 29, name: 'session-host-lazy-semantic-scope-invalidation' },
  { id: 30, name: 'session-host-query-time-transcript-term-normalization' },
  { id: 31, name: 'session-host-export-path-checkpoints' },
  { id: 32, name: 'session-host-cascade-safe-node-deletion' },
  { id: 33, name: 'session-host-native-discovery-signatures' },
  { id: 34, name: 'session-host-desktop-mutation-fences' },
  { id: 35, name: 'session-host-browser-preview-attachments' },
]

function withDatabase<A, E>(operation: Effect.Effect<A, E, SqlClient.SqlClient>) {
  return Effect.runPromise(
    operation.pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' }))),
  )
}

describe('Session Host migration identity compatibility', () => {
  it('maps only known alpha Hive identities, including a sealed sparse cutover', () => {
    expect(planSessionHostLedgerUpgrade(oldHiveRows)).toEqual(
      oldHiveRows.map((row) => ({ ...row, targetId: row.id + 23 })).reverse(),
    )
    expect(
      planSessionHostLedgerUpgrade(
        [oldHiveRows[0], oldHiveRows[5]].filter((row) => row !== undefined),
      ),
    ).toHaveLength(2)
    expect(planSessionHostLedgerUpgrade(APP_MIGRATIONS.filter((row) => row.id >= 26))).toEqual([])
  })

  it('moves the pre-Summary Host ledger behind released Summary migrations', () => {
    const releasedSetupRows = APP_MIGRATIONS.filter((row) => row.id === 26 || row.id === 27)
    expect(planSessionHostLedgerUpgrade([...releasedSetupRows, ...preSummaryHostRows])).toEqual(
      preSummaryHostRows.map((row) => ({ ...row, targetId: row.id + 21 })).reverse(),
    )
  })

  it.each(
    [
      [...oldHiveRows, { id: 32, name: 'unexpected' }],
      [oldHiveRows[0], { id: 27, name: 'session-worktree-setup-receipt' }],
      [{ id: 28, name: 'session-host-query-time-transcript-term-normalization' }],
      [...preSummaryHostRows, { id: 36, name: 'session-resource-source-projection' }],
      [{ id: 26, name: 'unknown' }],
    ].map((rows) => ({ rows })),
  )('fails closed for mixed, future, or unknown identities %#', ({ rows }) => {
    expect(() => planSessionHostLedgerUpgrade(rows.filter((row) => row !== undefined))).toThrow(
      'migration ledger',
    )
  })

  it('upgrades released main without changing Setup receipts or their released migration identities', async () => {
    await withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(
          'CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
        )
        for (const migration of APP_MIGRATIONS.filter((row) => row.id <= 27)) {
          for (const statement of migration.statements) yield* sql.unsafe(statement)
          yield* sql`INSERT INTO _migrations VALUES (${migration.id}, ${migration.name}, 'released-main')`
        }
        yield* sql`INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at) VALUES ('kept', 'pi-kept', 'Released main', 1, 2)`
        yield* sql`INSERT INTO session_worktree_setup (session_id, worktree_path, generation, created_at, updated_at, dispatch_state, claim_token, accepted_at) VALUES ('kept', '/project/worktree', 'generation-1', 1, 2, 'accepted', 'claim-1', 2)`
        yield* runAppDatabaseMigrations
        expect(
          yield* sql`SELECT dispatch_state, claim_token, accepted_at FROM session_worktree_setup WHERE session_id = 'kept'`,
        ).toEqual([{ dispatch_state: 'accepted', claim_token: 'claim-1', accepted_at: 2 }])
        expect(yield* sql`SELECT applied_at FROM _migrations WHERE id IN (26, 27)`).toEqual([
          { applied_at: 'released-main' },
          { applied_at: 'released-main' },
        ])
        expect(yield* sql.unsafe('PRAGMA foreign_key_check')).toEqual([])
      }),
    )
  })

  it('repairs the known alpha ledger atomically and preserves timestamps and all Session content', async () => {
    await withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* runMigrations(
          APP_MIGRATIONS.filter(
            ({ id }) => id <= SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID,
          ),
        )
        yield* sql`INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at) VALUES ('kept', 'pi-kept', 'Retained hive 🐝', 1, 2)`
        yield* sql`DELETE FROM _migrations WHERE id >= 26`
        yield* sql.unsafe('DROP TABLE session_worktree_setup')
        for (const row of oldHiveRows)
          yield* sql`INSERT INTO _migrations VALUES (${row.id}, ${row.name}, ${'original-time'})`
        yield* runAppDatabaseMigrations
        const updated = yield* sql<{
          readonly id: number
          readonly name: string
          readonly applied_at: string
        }>`SELECT * FROM _migrations WHERE id BETWEEN ${SESSION_HOST_BASELINE_MIGRATION_ID} AND ${SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID} ORDER BY id`
        expect(updated).toEqual(
          oldHiveRows.map((row) => ({
            id: row.id + 23,
            name: row.name,
            applied_at: 'original-time',
          })),
        )
        expect(yield* sql`SELECT title FROM sessions WHERE id = 'kept'`).toEqual([
          { title: 'Retained hive 🐝' },
        ])
        expect(yield* sql`SELECT name FROM _migrations WHERE id IN (26, 27) ORDER BY id`).toEqual([
          { name: 'session-worktree-setup-dispatch' },
          { name: 'session-worktree-setup-receipt' },
        ])
        expect(
          yield* sql`SELECT name FROM pragma_table_info('session_worktree_setup') WHERE name = 'claim_token'`,
        ).toHaveLength(1)
        yield* runAppDatabaseMigrations
        expect(
          yield* sql`SELECT * FROM _migrations WHERE id BETWEEN ${SESSION_HOST_BASELINE_MIGRATION_ID} AND ${SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID} ORDER BY id`,
        ).toEqual(updated)
      }),
    )
  })

  it('upgrades a pre-Summary Host database while preserving its Session data and migration timestamps', async () => {
    await withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* runMigrations(APP_MIGRATIONS.filter(({ id }) => id <= 58))
        yield* sql`INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at) VALUES ('kept', 'pi-kept', 'Pre-Summary worker', 1, 2)`
        yield* sql`DELETE FROM _migrations WHERE id BETWEEN 28 AND 48`
        yield* sql`DELETE FROM _migrations WHERE id = ${SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID}`
        yield* sql`UPDATE _migrations SET id = id - 21, applied_at = 'pre-summary-host'
          WHERE id BETWEEN 49 AND 58`

        expect(
          yield* sql`SELECT id, name FROM _migrations WHERE id BETWEEN 28 AND 35 ORDER BY id`,
        ).toEqual(preSummaryHostRows)
        yield* runAppDatabaseMigrations

        const ledger = yield* sql<{
          readonly id: number
          readonly name: string
          readonly applied_at: string
        }>`SELECT id, name, applied_at FROM _migrations WHERE id >= 26 ORDER BY id`
        expect(ledger.map(({ id, name }) => ({ id, name }))).toEqual(
          APP_MIGRATIONS.filter((row) => row.id >= 26).map(({ id, name }) => ({ id, name })),
        )
        expect(
          ledger.filter(
            (row) =>
              row.id >= SESSION_HOST_BASELINE_MIGRATION_ID &&
              row.id < SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID,
          ),
        ).toEqual(
          preSummaryHostRows.map((row) => ({
            id: row.id + 21,
            name: row.name,
            applied_at: 'pre-summary-host',
          })),
        )
        expect(
          ledger.find((row) => row.id === SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID),
        ).toMatchObject({ name: 'session-host-project-catalog-generation' })
        expect(yield* sql`SELECT title FROM sessions WHERE id = 'kept'`).toEqual([
          { title: 'Pre-Summary worker' },
        ])
        expect(yield* sql.unsafe('PRAGMA foreign_key_check')).toEqual([])
      }),
    )
  })

  it('rolls back every moved ID when a write fails midway', async () => {
    await withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(
          'CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
        )
        for (const row of oldHiveRows)
          yield* sql`INSERT INTO _migrations VALUES (${row.id}, ${row.name}, 'original-time')`
        yield* sql.unsafe(
          "CREATE TRIGGER reject_move BEFORE UPDATE ON _migrations WHEN old.id = 28 BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
        )
        expect((yield* Effect.either(repairSessionHostMigrationLedger))._tag).toBe('Left')
        expect(yield* sql`SELECT id, name FROM _migrations ORDER BY id`).toEqual(oldHiveRows)
      }),
    )
  })
})
