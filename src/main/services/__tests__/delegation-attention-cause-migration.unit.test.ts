import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { runMigrations } from '../database-migration-runner'
import { APP_MIGRATIONS } from '../database-migrations'
import { runAppDatabaseMigrations } from '../database-service'
import { DELEGATION_ATTENTION_CAUSE_MIGRATION } from '../delegation-attention-cause-migration'
import {
  DELEGATION_ATTENTION_CAUSE_MIGRATION_ID,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
  SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_ID,
} from '../session-host-schema-identity'
import { V1_BETA_MIGRATIONS } from '../v1-beta-migrations'

const DATABASE_FILE = 'attention-cause-upgrade.sqlite'
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
      return yield* run(sql)
    }).pipe(Effect.provide(layer)),
  )
}

function insertContract(sql: SqlClient.SqlClient, id: string, state: string) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
      VALUES (${`worker-${id}`}, ${`pi-${id}`}, ${id}, 1, 1)
    `
    yield* sql`
      INSERT INTO delegation_contracts (
        id, parent_session_id, child_session_id, state,
        current_specification_revision, created_at, updated_at
      ) VALUES (${id}, ${'queen'}, ${`worker-${id}`}, ${state}, 1, 1, 1)
    `
  })
}

function workerTransition(sql: SqlClient.SqlClient, id: string, toState: string, at: number) {
  return sql`
    INSERT INTO delegation_state_transitions (
      delegation_id, from_state, to_state, reason, actor_session_id, authored_by, created_at
    ) VALUES (
      ${id}, ${'working'}, ${toState}, ${'Blocked'}, ${`worker-${id}`}, ${'session-agent:w'}, ${at}
    )
  `
}

function hostFailure(sql: SqlClient.SqlClient, id: string, at: number) {
  return sql`
    INSERT INTO session_orchestration_updates (
      id, parent_session_id, worker_session_id, delegation_id, source_run_id,
      state, summary, status, created_at
    ) VALUES (
      ${`update-${id}`}, ${'queen'}, ${`worker-${id}`}, ${id}, ${`run-${id}`},
      ${'needs_attention'}, ${'Run failed.'}, ${'pending'}, ${at}
    )
  `
}

/** A beta.25 Hive: its Delegations have no `attention_cause` column yet. */
function seedBeta25Hive(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    // Orchestration updates name Runs this seed does not create.
    yield* sql.unsafe('PRAGMA foreign_keys = OFF')
    yield* sql.unsafe('ALTER TABLE delegation_contracts DROP COLUMN attention_cause')
    yield* sql`
      INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
      VALUES (${'queen'}, ${'pi-queen'}, ${'Queen'}, 1, 1)
    `
    // The Worker asked for help, and nothing failed after.
    yield* insertContract(sql, 'asked', 'needs_attention')
    yield* workerTransition(sql, 'asked', 'needs_attention', 10)
    // The Host set it for a failed Run, with no transition row.
    yield* insertContract(sql, 'failed', 'needs_attention')
    yield* hostFailure(sql, 'failed', 10)
    // The Worker asked, then a later Run failed: the failure is the latest cause.
    yield* insertContract(sql, 'asked-then-failed', 'needs_attention')
    yield* workerTransition(sql, 'asked-then-failed', 'needs_attention', 10)
    yield* hostFailure(sql, 'asked-then-failed', 20)
    // An old failure, then the Worker asked: the request is the latest cause.
    yield* insertContract(sql, 'failed-then-asked', 'needs_attention')
    yield* hostFailure(sql, 'failed-then-asked', 10)
    yield* workerTransition(sql, 'failed-then-asked', 'needs_attention', 20)
    // Not in needs_attention: no cause.
    yield* insertContract(sql, 'working', 'working')
    yield* workerTransition(sql, 'working', 'needs_attention', 10)
  })
}

function readCauses(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string; readonly attention_cause: string | null }>`
      SELECT id, attention_cause FROM delegation_contracts ORDER BY id
    `
    const ledger = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM _migrations WHERE id > ${SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_ID}
    `
    return {
      causes: Object.fromEntries(rows.map((row) => [row.id, row.attention_cause])),
      ledger: ledger.map((row) => [row.id, row.name]),
    }
  })
}

describe('upgrading a beta.25 Hive through migration 74', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-attention-cause-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('is the newest beta migration, and one this binary supports', () => {
    expect(V1_BETA_MIGRATIONS.at(-1)).toBe(DELEGATION_ATTENTION_CAUSE_MIGRATION)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(DELEGATION_ATTENTION_CAUSE_MIGRATION.id)
  })

  it('records why each needs_attention Delegation got there, once', async () => {
    expect(DELEGATION_ATTENTION_CAUSE_MIGRATION_ID).toBe(74)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(DELEGATION_ATTENTION_CAUSE_MIGRATION_ID)

    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runMigrations(
          APP_MIGRATIONS.filter(({ id }) => id <= SESSION_RESOURCE_DOCS_IMAGE_MIGRATION_ID),
        )
        yield* seedBeta25Hive(sql)
      }),
    )

    const upgraded = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        return yield* readCauses(sql)
      }),
    )
    expect(upgraded).toEqual({
      causes: {
        asked: 'worker_request',
        'asked-then-failed': 'run_failed',
        failed: 'run_failed',
        'failed-then-asked': 'worker_request',
        working: null,
      },
      ledger: [[74, 'delegation-attention-cause']],
    })

    const again = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        return yield* readCauses(sql)
      }),
    )
    expect(again).toEqual(upgraded)
  })

  it('refuses a cause outside the two the Host writes', async () => {
    const result = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          VALUES (${'queen'}, ${'pi-queen'}, ${'Queen'}, 1, 1)
        `
        yield* insertContract(sql, 'bad', 'needs_attention')
        return yield* sql`
          UPDATE delegation_contracts SET attention_cause = ${'user_request'} WHERE id = ${'bad'}
        `.pipe(Effect.either)
      }),
    )
    expect(result._tag).toBe('Left')
  })
})
