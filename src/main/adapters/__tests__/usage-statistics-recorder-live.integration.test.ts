import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageStatisticsObservation } from '../../domain/usage-statistics/usage-statistics-observations'

const harness = vi.hoisted(() => {
  const observations: UsageStatisticsObservation[] = []
  return { enabled: true, observations }
})

vi.mock('../../services/database-service', async () => {
  const { Layer } = await import('effect')
  return { AppDatabaseLive: Layer.empty }
})
vi.mock('../../store/settings', () => ({
  getSettings: () => ({ defaultAuthorizationMode: 'yolo' }),
}))
vi.mock('../../usage-statistics/usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => harness.enabled,
}))
vi.mock('../../usage-statistics/usage-statistics-recorder', () => ({
  recordUsageStatistics: (observation: UsageStatisticsObservation) =>
    harness.observations.push(observation),
}))

import {
  noteUsageStatisticsRunModel,
  resetUsageStatisticsRunsForTests,
} from '../../usage-statistics/usage-statistics-runs'
import { loadUsageStatisticsInstallEvidenceTime } from '../sqlite-usage-statistics-facts'
import { makeUsageStatisticsRecorder } from '../usage-statistics-recorder-live'

const createSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE sessions(id TEXT PRIMARY KEY, created_at INTEGER, authorization_mode_override TEXT)`
  yield* sql`CREATE TABLE workspace_resources(id TEXT PRIMARY KEY, kind TEXT)`
  yield* sql`CREATE TABLE session_workspace_bindings(session_id TEXT, workspace_id TEXT)`
  yield* sql`CREATE TABLE session_spawn_lineage(child_session_id TEXT, parent_session_id TEXT)`
  yield* sql`CREATE TABLE session_execution_profiles(session_id TEXT, authorization_ceiling TEXT)`
  yield* sql`CREATE TABLE _migrations(id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)`
  return sql
})

function runInDatabase<A>(
  effect: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  return Effect.runPromise(
    createSchema.pipe(
      Effect.flatMap(effect),
      Effect.provide(SqliteClient.layer({ filename: ':memory:' })),
    ),
  )
}

function insertSession(
  sql: SqlClient.SqlClient,
  input: {
    readonly id: string
    readonly createdAt?: number
    readonly mode?: string | null
    readonly ceiling?: string
    readonly kind?: string
    readonly parent?: string
  },
) {
  return Effect.gen(function* () {
    yield* sql`INSERT INTO sessions VALUES (${input.id}, ${input.createdAt ?? 0}, ${input.mode ?? null})`
    yield* sql`INSERT INTO workspace_resources VALUES (${`workspace-${input.id}`}, ${input.kind ?? 'local'})`
    yield* sql`INSERT INTO session_workspace_bindings VALUES (${input.id}, ${`workspace-${input.id}`})`
    yield* sql`INSERT INTO session_execution_profiles VALUES (${input.id}, ${input.ceiling ?? 'yolo'})`
    if (input.parent)
      yield* sql`INSERT INTO session_spawn_lineage VALUES (${input.id}, ${input.parent})`
  })
}

function startAndFinish(
  sql: SqlClient.SqlClient,
  sessionId: string,
  runAuthorizationOverride?: 'yolo',
) {
  const recorder = makeUsageStatisticsRecorder(sql)
  return Effect.gen(function* () {
    yield* recorder.runStarted({
      sessionId: SessionId(sessionId),
      runId: `run-${sessionId}`,
      originCallerId: 'gui:local-user',
      waggle: false,
      attachments: false,
      runAuthorizationOverride,
    })
    noteUsageStatisticsRunModel(`run-${sessionId}`, { provider: 'openai', model: 'gpt-5' }, 'high')
    yield* recorder.runFinished({
      runId: `run-${sessionId}`,
      originCallerId: 'gui:local-user',
      waggle: false,
      thinkingLevel: 'high',
      terminalStatus: 'completed',
    })
  })
}

function finishedAccessMode() {
  const finished = harness.observations.find((observation) => observation.kind === 'run-finished')
  return finished?.kind === 'run-finished' ? finished.properties.access_mode : undefined
}

describe('Usage statistics recorder adapter', () => {
  beforeEach(() => {
    harness.enabled = true
    harness.observations.length = 0
    resetUsageStatisticsRunsForTests()
  })

  it('records the worktree and Worker flags of the Run’s Session in one lookup', async () => {
    await runInDatabase((sql) =>
      insertSession(sql, { id: 'worker', kind: 'managed-worktree', parent: 'queen' }).pipe(
        Effect.zipRight(startAndFinish(sql, 'worker')),
      ),
    )

    expect(harness.observations.slice(0, 3)).toEqual([
      { kind: 'run-started', entryPoint: 'app' },
      { kind: 'feature', flag: 'worktree' },
      { kind: 'feature', flag: 'worker_session' },
    ])
    expect(finishedAccessMode()).toBe('yolo')
  })

  it('starts a Run under its Session mode, and an Ask for Approval ceiling over any override', async () => {
    await runInDatabase((sql) =>
      insertSession(sql, { id: 'asking', mode: 'ask-for-approval' }).pipe(
        Effect.zipRight(startAndFinish(sql, 'asking')),
      ),
    )
    expect(finishedAccessMode()).toBe('ask-for-approval')

    harness.observations.length = 0
    await runInDatabase((sql) =>
      insertSession(sql, { id: 'capped', ceiling: 'ask-for-approval' }).pipe(
        Effect.zipRight(startAndFinish(sql, 'capped', 'yolo')),
      ),
    )
    expect(finishedAccessMode()).toBe('ask-for-approval')
  })

  it('still counts a Run whose Session facts cannot be read, without its flags', async () => {
    await runInDatabase((sql) => startAndFinish(sql, 'missing'))

    expect(harness.observations).toContainEqual({ kind: 'run-started', entryPoint: 'app' })
    expect(harness.observations.some((observation) => observation.kind === 'feature')).toBe(false)
  })

  it('records nothing while statistics are off', async () => {
    harness.enabled = false

    await runInDatabase((sql) =>
      insertSession(sql, { id: 'worker', kind: 'managed-worktree', parent: 'queen' }).pipe(
        Effect.zipRight(startAndFinish(sql, 'worker')),
      ),
    )

    expect(harness.observations).toEqual([])
  })

  it('reads when the profile was first used from the oldest Session or the first migration', async () => {
    const times = await runInDatabase((sql) =>
      Effect.gen(function* () {
        const empty = yield* loadUsageStatisticsInstallEvidenceTime
        yield* sql`INSERT INTO _migrations VALUES (1, 'initial', '2026-05-04T10:00:00.000Z')`
        const fromMigration = yield* loadUsageStatisticsInstallEvidenceTime
        yield* insertSession(sql, { id: 'old', createdAt: Date.parse('2026-02-01T23:30:00.000Z') })
        const fromSession = yield* loadUsageStatisticsInstallEvidenceTime
        return { empty, fromMigration, fromSession }
      }),
    )

    expect(times).toEqual({
      empty: null,
      fromMigration: Date.parse('2026-05-04T10:00:00.000Z'),
      fromSession: Date.parse('2026-02-01T23:30:00.000Z'),
    })
  })

  it('reads a database without those tables as no evidence rather than a failure', async () => {
    const time = await Effect.runPromise(
      loadUsageStatisticsInstallEvidenceTime.pipe(
        Effect.provide(SqliteClient.layer({ filename: ':memory:' })),
      ),
    )

    expect(time).toBeNull()
  })
})
