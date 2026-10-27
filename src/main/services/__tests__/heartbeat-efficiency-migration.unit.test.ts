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
import { HEARTBEAT_EFFICIENCY_MIGRATION } from '../heartbeat-efficiency-migration'
import {
  DELEGATION_ATTENTION_CAUSE_MIGRATION_ID,
  HEARTBEAT_EFFICIENCY_MIGRATION_ID,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
} from '../session-host-schema-identity'
import { V1_BETA_MIGRATIONS } from '../v1-beta-migrations'

const DATABASE_FILE = 'heartbeat-efficiency-upgrade.sqlite'
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

function insertTask(
  sql: SqlClient.SqlClient,
  input: {
    readonly id: string
    readonly kind: 'heartbeat' | 'launch'
    readonly endsAt?: number
    readonly maxRuns?: number
  },
) {
  return sql`
    INSERT INTO scheduled_tasks (id, owner_key, creator_caller_id, creator_kind, creator_label,
      kind, name, prompt, enabled, schedule_json, time_zone, anchor_at, ends_at, max_runs,
      target_session_id, target_json, notification_policy, created_at, updated_at)
    VALUES (${input.id}, 'local-user', 'gui:local-user', 'local-user', 'You', ${input.kind},
      'Task', 'Prompt', 1, '{}', 'UTC', 0, ${input.endsAt ?? null}, ${input.maxRuns ?? null},
      ${input.kind === 'heartbeat' ? 'session-1' : null}, '{}', 'failures-only', 0, 0)
  `
}

/** A beta.27 database: Scheduled tasks exist, with no Heartbeat stop settings yet. */
function seedBeta27Tasks(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
      VALUES ('session-1', 'pi-1', 'Watched', 1, 1)
    `
    yield* insertTask(sql, { id: 'open-ended', kind: 'heartbeat' })
    yield* insertTask(sql, { id: 'ends', kind: 'heartbeat', endsAt: 5 })
    yield* insertTask(sql, { id: 'limited', kind: 'heartbeat', maxRuns: 3 })
    yield* insertTask(sql, { id: 'launch', kind: 'launch' })
    yield* sql`
      INSERT INTO scheduled_task_runs (id, task_id, task_name, trigger, nominal_at, fired_at,
        status, idempotency_key, caller_id)
      VALUES ('run-1', 'open-ended', 'Task', 'schedule', 0, 0, 'started', 'key-1', 'gui:local-user')
    `
  })
}

function readTasks(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const tasks = yield* sql<{
      readonly id: string
      readonly indefinite: number
      readonly idle_pause_after: number
      readonly consecutive_idle_runs: number
      readonly wake_check_on_failure: string
    }>`
      SELECT id, indefinite, idle_pause_after, consecutive_idle_runs, wake_check_on_failure
      FROM scheduled_tasks ORDER BY id
    `
    const runs = yield* sql<{ readonly outcome: string | null; readonly context_json: null }>`
      SELECT outcome, context_json FROM scheduled_task_runs
    `
    const ledger = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM _migrations WHERE id > ${DELEGATION_ATTENTION_CAUSE_MIGRATION_ID}
    `
    return {
      indefinite: Object.fromEntries(tasks.map((task) => [task.id, task.indefinite])),
      defaults: tasks.map((task) => [
        task.idle_pause_after,
        task.consecutive_idle_runs,
        task.wake_check_on_failure,
      ]),
      runs,
      ledger: ledger.map((row) => [row.id, row.name]),
    }
  })
}

describe('upgrading beta.27 Scheduled tasks through migration 75', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-heartbeat-efficiency-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('is the newest beta migration, at 75, and one this binary supports', () => {
    expect(HEARTBEAT_EFFICIENCY_MIGRATION_ID).toBe(75)
    expect(V1_BETA_MIGRATIONS.at(-1)).toBe(HEARTBEAT_EFFICIENCY_MIGRATION)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(HEARTBEAT_EFFICIENCY_MIGRATION_ID)
  })

  it('grandfathers only open-ended Heartbeats as indefinite, once', async () => {
    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runMigrations(
          APP_MIGRATIONS.filter(({ id }) => id <= DELEGATION_ATTENTION_CAUSE_MIGRATION_ID),
        )
        yield* seedBeta27Tasks(sql)
      }),
    )
    const upgraded = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        return yield* readTasks(sql)
      }),
    )
    expect(upgraded).toEqual({
      indefinite: { ends: 0, launch: 0, limited: 0, 'open-ended': 1 },
      defaults: Array.from({ length: 4 }, () => [3, 0, 'wake']),
      runs: [{ outcome: null, context_json: null }],
      ledger: [[75, 'heartbeat-efficiency']],
    })
    const again = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        return yield* readTasks(sql)
      }),
    )
    expect(again).toEqual(upgraded)
  })

  it('refuses values outside what the Host writes', async () => {
    const results = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        yield* seedBeta27Tasks(sql)
        const attempts = [
          sql`UPDATE scheduled_tasks SET idle_pause_after = 21 WHERE id = 'open-ended'`,
          sql`UPDATE scheduled_tasks SET wake_check_on_failure = 'ignore' WHERE id = 'open-ended'`,
          sql`UPDATE scheduled_tasks SET auto_pause_reason = 'bored' WHERE id = 'open-ended'`,
          sql`UPDATE scheduled_task_runs SET outcome = 'maybe' WHERE id = 'run-1'`,
          sql`UPDATE scheduled_task_runs SET wake_check = 'asleep' WHERE id = 'run-1'`,
        ]
        return yield* Effect.all(attempts.map((attempt) => Effect.either(attempt)))
      }),
    )
    expect(results.map((result) => result._tag)).toEqual(Array.from({ length: 5 }, () => 'Left'))
  })
})
