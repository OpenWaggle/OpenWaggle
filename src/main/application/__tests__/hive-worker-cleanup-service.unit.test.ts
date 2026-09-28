import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { reserveActiveSessionRun } from '../active-session-runs'
import { reconcileHiveWorkerCleanup } from '../hive-worker-cleanup-service'
import {
  archivedState,
  unarchive,
  useHiveCleanupServiceContext,
  withTerminals,
} from './hive-worker-cleanup-service.test-harness'

describe('Hive Worker cleanup service', () => {
  const service = useHiveCleanupServiceContext('openwaggle-hive-cleanup-service-')

  it('archives a finished untouched Worker on behalf of its parent and publishes the change', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        const responses = yield* reconcileHiveWorkerCleanup(SessionId('queen'))
        const archived = yield* archivedState(sql, 'worker')
        const journal = yield* sql<{
          readonly caller_id: string
          readonly idempotency_key: string
        }>`
          SELECT caller_id, idempotency_key FROM session_operations
          WHERE operation = ${'archive'} AND target_scope = ${'worker'}
        `
        const again = yield* reconcileHiveWorkerCleanup(SessionId('worker'))
        return { responses, archived, journal, again }
      }).pipe(Effect.provide(service.store('archive'))),
    )

    expect(result.responses.map((response) => response.outcome)).toEqual([
      { operation: 'archive', effect: 'session-archived', sessionId: 'worker' },
    ])
    expect(result.archived).toBe(1)
    expect(result.journal).toEqual([
      { caller_id: QUEEN_CALLER_ID, idempotency_key: 'hive-cleanup:delegation-worker:2000' },
    ])
    expect(result.again).toEqual([])
    expect(service.events).toEqual([
      { kind: 'session-list-changed', sessionId: 'worker', change: 'archived' },
    ])
  })

  it('never re-archives a Worker the user restored', async () => {
    const archived = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        yield* reconcileHiveWorkerCleanup(SessionId('worker'))
        yield* unarchive('gui:local-user', 'user-restore')
        yield* reconcileHiveWorkerCleanup(SessionId('worker'))
        yield* reconcileHiveWorkerCleanup(SessionId('queen'))
        return yield* archivedState(sql, 'worker')
      }).pipe(Effect.provide(service.store('user-restore'))),
    )

    expect(archived).toBe(0)
  })

  it('archives at most once per terminal Delegation transition when the Queen restores it', async () => {
    const archived = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        yield* reconcileHiveWorkerCleanup(SessionId('worker'))
        yield* unarchive('session-agent:queen:run-later', 'queen-restore')
        const replayed = yield* reconcileHiveWorkerCleanup(SessionId('worker'))
        return { replayed, archived: yield* archivedState(sql, 'worker') }
      }).pipe(Effect.provide(service.store('queen-restore'))),
    )

    expect(archived).toEqual({ replayed: [], archived: 0 })
  })

  it('leaves a Worker alone while the Host still owns live work for it', async () => {
    const archived = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        const reservation = reserveActiveSessionRun(SessionId('worker'), 'run-live')
        try {
          yield* reconcileHiveWorkerCleanup(SessionId('worker'))
        } finally {
          reservation.release()
        }
        return yield* archivedState(sql, 'worker')
      }).pipe(Effect.provide(service.store('live-work'))),
    )

    expect(archived).toBe(0)
    expect(service.events).toEqual([])
  })
  it('keeps a Worker pinned after the eligibility scan, before the archive commits', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        // The pin is a local-ui-v1 write that does not take the Worker's command
        // serialization, so it can land while cleanup tears the desktop down.
        yield* withTerminals(
          (sql) => ({
            closeAllForOwner: () =>
              sql`
                INSERT INTO pinned_sessions (session_id, pinned_at, sort_key)
                VALUES (${'worker'}, ${3000}, ${'a0'})
              `.pipe(Effect.orDie, Effect.asVoid),
          }),
          reconcileHiveWorkerCleanup(SessionId('worker')),
        )
        const pins = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM pinned_sessions
        `
        const journal = yield* sql<{ readonly operation: string }>`
          SELECT operation FROM session_operations
          WHERE target_scope = ${'worker'} AND operation = ${'archive'}
        `
        return { archived: yield* archivedState(sql, 'worker'), pins, journal }
      }).pipe(Effect.provide(service.store('pin-race'))),
    )

    expect(result).toEqual({ archived: 0, pins: [{ session_id: 'worker' }], journal: [] })
  })

  it('does not archive on behalf of a parent agent whose authority was revoked', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'working' })
        yield* seedHiveWorker(sql, {
          workerId: 'grandchild',
          parentId: 'worker',
          seedParent: false,
        })
        yield* sql`
          UPDATE derived_child_management_grants SET revoked_at = ${3000}
          WHERE child_session_id = ${'worker'}
        `
        const responses = yield* reconcileHiveWorkerCleanup(SessionId('grandchild'))
        return { responses, archived: yield* archivedState(sql, 'grandchild') }
      }).pipe(Effect.provide(service.store('revoked-parent'))),
    )

    expect(result).toEqual({ responses: [], archived: 0 })
  })
})
