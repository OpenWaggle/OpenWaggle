import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HiveWorkerCleanupRepository } from '../../ports/hive-worker-cleanup-repository'
import {
  makeHiveWorkerCleanupTestLayer,
  QUEEN_CALLER_ID,
  recordOperation,
  seedHiveWorker,
} from './hive-worker-cleanup-fixture'

describe('SQLite Hive Worker cleanup eligibility', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-cleanup-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  function eligibleWorkerIds(
    name: string,
    arrange: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>,
    lookup: { readonly sessionId: string; readonly includeDirectWorkers: boolean } = {
      sessionId: 'worker',
      includeDirectWorkers: false,
    },
  ) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* arrange(sql)
        const repository = yield* HiveWorkerCleanupRepository
        const candidates = yield* repository.findEligibleWorkers({
          sessionId: SessionId(lookup.sessionId),
          includeDirectWorkers: lookup.includeDirectWorkers,
        })
        return candidates
      }).pipe(
        Effect.provide(makeHiveWorkerCleanupTestLayer(path.join(temporaryRoot, `${name}.sqlite`))),
      ),
    )
  }

  it('selects an accepted, idle Worker that only agents acted on, attributed to its parent', async () => {
    const candidates = await eligibleWorkerIds('accepted', (sql) => seedHiveWorker(sql))

    expect(candidates).toEqual([
      {
        workerSessionId: 'worker',
        parentSessionId: 'queen',
        parentCallerId: QUEEN_CALLER_ID,
        delegationId: 'delegation-worker',
        delegationState: 'accepted',
        delegationUpdatedAt: 2000,
      },
    ])
  })

  it('selects cancelled Workers too, and finds direct Workers from their parent', async () => {
    const candidates = await eligibleWorkerIds(
      'cancelled',
      (sql) =>
        Effect.gen(function* () {
          yield* seedHiveWorker(sql, { workerId: 'worker-a', state: 'cancelled' })
          yield* seedHiveWorker(sql, { workerId: 'worker-b', seedParent: false })
          yield* seedHiveWorker(sql, {
            workerId: 'worker-c',
            state: 'working',
            seedParent: false,
          })
        }),
      { sessionId: 'queen', includeDirectWorkers: true },
    )

    expect(candidates.map((candidate) => candidate.workerSessionId)).toEqual([
      'worker-a',
      'worker-b',
    ])
  })

  it.each([
    'working',
    'waiting',
    'needs_attention',
    'ready_for_review',
    'revision_requested',
  ] as const)('keeps a Worker whose Delegation is %s', async (state) => {
    const candidates = await eligibleWorkerIds(`state-${state}`, (sql) =>
      seedHiveWorker(sql, { state }),
    )
    expect(candidates).toEqual([])
  })

  it.each([
    ['GUI message', 'gui:local-user', 'message'],
    ['GUI follow-up', 'gui:local-user', 'follow-up'],
    ['GUI steer', 'gui:local-user', 'steer'],
    ['GUI interaction answer', 'gui:local-user', 'request-respond'],
    ['GUI authorization answer', 'gui:local-user', 'approval-respond'],
    ['GUI rename', 'gui:local-user', 'rename'],
    ['GUI restore', 'gui:local-user', 'unarchive'],
    ['CLI start', 'local-user:machine', 'start'],
    ['CLI profile replace', 'profile:reviewer', 'replace'],
    ['a rejected GUI message', 'gui:local-user', 'message'],
  ])('keeps a Worker after a user %s', async (name, callerId, operation) => {
    const candidates = await eligibleWorkerIds(`user-${name.replaceAll(' ', '-')}`, (sql) =>
      Effect.gen(function* () {
        yield* seedHiveWorker(sql)
        yield* recordOperation(sql, { callerId, operation, sessionId: 'worker' })
      }),
    )
    expect(candidates).toEqual([])
  })

  it('ignores agent-authored operations such as the Queen unarchiving or following up', async () => {
    const candidates = await eligibleWorkerIds('agent-operations', (sql) =>
      Effect.gen(function* () {
        yield* seedHiveWorker(sql)
        yield* recordOperation(sql, {
          callerId: 'session-agent:queen:run-later',
          operation: 'unarchive',
          sessionId: 'worker',
        })
        yield* recordOperation(sql, {
          callerId: 'session-agent:sibling:run-sibling',
          operation: 'report',
          sessionId: 'worker',
        })
      }),
    )
    expect(candidates.map((candidate) => candidate.workerSessionId)).toEqual(['worker'])
  })

  it('keeps a Worker that a user spawned directly', async () => {
    const candidates = await eligibleWorkerIds('user-spawned', (sql) =>
      seedHiveWorker(sql, { spawnCallerId: 'local-user:machine' }),
    )
    expect(candidates).toEqual([])
  })

  it.each([
    ['a user-created branch', 0, null],
    ['an archived main branch', 1, 3000],
  ])('keeps a Worker with %s', async (name, isMain, archivedAt) => {
    const candidates = await eligibleWorkerIds(`branch-${name.replaceAll(' ', '-')}`, (sql) =>
      Effect.gen(function* () {
        yield* seedHiveWorker(sql)
        yield* sql`
          INSERT INTO session_branches (
            id, session_id, name, is_main, created_at, updated_at, archived_at
          ) VALUES (
            ${'branch-extra'}, ${'worker'}, ${'Try again'}, ${isMain}, ${3000}, ${3000},
            ${archivedAt}
          )
        `
      }),
    )
    expect(candidates).toEqual([])
  })

  it('keeps a pinned Worker', async () => {
    const candidates = await eligibleWorkerIds('pinned', (sql) =>
      Effect.gen(function* () {
        yield* seedHiveWorker(sql)
        yield* sql`
          INSERT INTO pinned_sessions (session_id, pinned_at, sort_key)
          VALUES (${'worker'}, ${3000}, ${'a0'})
        `
      }),
    )
    expect(candidates).toEqual([])
  })

  it('keeps an already archived Worker, a busy Worker, and a Worker with queued or parked work', async () => {
    const archived = await eligibleWorkerIds('archived', (sql) =>
      Effect.gen(function* () {
        yield* seedHiveWorker(sql)
        yield* sql`UPDATE sessions SET archived = 1 WHERE id = ${'worker'}`
      }),
    )
    const active = await eligibleWorkerIds('active-run', (sql) =>
      Effect.gen(function* () {
        yield* seedHiveWorker(sql)
        yield* sql`UPDATE session_runs SET status = ${'active'} WHERE id = ${'run-worker'}`
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${'run-worker'}
          WHERE session_id = ${'worker'}
        `
      }),
    )
    const queued = await eligibleWorkerIds('queued-follow-up', (sql) =>
      Effect.gen(function* () {
        yield* seedHiveWorker(sql)
        yield* sql`UPDATE session_control_states SET queue_state = ${'paused'}
          WHERE session_id = ${'worker'}`
        yield* sql`
          INSERT INTO session_follow_ups (
            id, session_id, position, delivery_state, intent_json, created_at, updated_at
          ) VALUES (${'follow-up-1'}, ${'worker'}, ${0}, ${'pending'}, ${'{}'}, ${3000}, ${3000})
        `
      }),
    )
    const parked = await eligibleWorkerIds('parked-authorization', (sql) =>
      Effect.gen(function* () {
        yield* seedHiveWorker(sql)
        yield* sql`
          INSERT INTO session_authorization_requests (
            id, session_id, run_id, request_json, status, created_at
          ) VALUES (${'request-1'}, ${'worker'}, ${'run-worker'}, ${'{}'}, ${'pending'}, ${3000})
        `
      }),
    )

    expect({ archived, active, queued, parked }).toEqual({
      archived: [],
      active: [],
      queued: [],
      parked: [],
    })
  })

  it('keeps a Worker whose own Workers are still unfinished', async () => {
    const candidates = await eligibleWorkerIds('nested', (sql) =>
      Effect.gen(function* () {
        yield* seedHiveWorker(sql)
        yield* seedHiveWorker(sql, {
          workerId: 'grandchild',
          parentId: 'worker',
          state: 'working',
          seedParent: false,
        })
      }),
    )
    expect(candidates).toEqual([])
  })
})
