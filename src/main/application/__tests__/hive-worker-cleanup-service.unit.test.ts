import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  makeHiveWorkerCleanupTestLayer,
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { reserveActiveSessionRun } from '../active-session-runs'
import { reconcileHiveWorkerCleanup } from '../hive-worker-cleanup-service'
import { organizeSession } from '../session-organization-service'

function archivedState(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<{ readonly archived: number }>`
    SELECT archived FROM sessions WHERE id = ${sessionId}
  `.pipe(Effect.map((rows) => rows[0]?.archived))
}

function unarchive(callerId: string, key: string) {
  return organizeSession({
    callerId,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: key,
      idempotencyKey: key,
      command: { operation: 'unarchive', sessionId: 'worker' },
    },
  })
}

describe('Hive Worker cleanup service', () => {
  let temporaryRoot = ''
  let events: SessionHostEventPayload[] = []
  let releasePublisher: (() => void) | undefined

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-cleanup-service-'))
    events = []
    releasePublisher = installSessionHostEventPublisher((event) => events.push(event))
  })

  afterEach(async () => {
    releasePublisher?.()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  function store(name: string) {
    return makeHiveWorkerCleanupTestLayer(path.join(temporaryRoot, `${name}.sqlite`))
  }

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
      }).pipe(Effect.provide(store('archive'))),
    )

    expect(result.responses.map((response) => response.outcome)).toEqual([
      { operation: 'archive', effect: 'session-archived', sessionId: 'worker' },
    ])
    expect(result.archived).toBe(1)
    expect(result.journal).toEqual([
      { caller_id: QUEEN_CALLER_ID, idempotency_key: 'hive-cleanup:delegation-worker:2000' },
    ])
    expect(result.again).toEqual([])
    expect(events).toEqual([
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
      }).pipe(Effect.provide(store('user-restore'))),
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
      }).pipe(Effect.provide(store('queen-restore'))),
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
      }).pipe(Effect.provide(store('live-work'))),
    )

    expect(archived).toBe(0)
    expect(events).toEqual([])
  })
})
