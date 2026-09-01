import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionHostRecoveryRepository } from '../../ports/session-host-recovery-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { SqliteSessionHostRecoveryRepositoryLive } from '../sqlite-session-host-recovery-repository'

function makeQueueRecoveryLayer(filename: string) {
  const sqlite = SqliteClient.layer({ filename, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          pi_session_id TEXT NOT NULL UNIQUE,
          project_path TEXT,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)
      for (const statement of SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      yield* sql`
        INSERT INTO sessions (id, pi_session_id, project_path, title, created_at, updated_at)
        VALUES (${'session-queued'}, ${'pi-queued'}, ${'/project'}, ${'Queued'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_control_states (
          session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
        ) VALUES (${'session-queued'}, ${4}, ${null}, ${'running'}, ${7}, ${1})
      `
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, intent_json, created_at, updated_at
        ) VALUES (${'follow-up-queued'}, ${'session-queued'}, ${0}, ${'pending'}, ${'{}'}, ${1}, ${1})
      `
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    SqliteSessionHostRecoveryRepositoryLive.pipe(Layer.provide(sqlite)),
  )
}

describe('SQLite Session Host queue recovery', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-queue-recovery-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('pauses a running pending queue even when it has no active Run', async () => {
    const layer = makeQueueRecoveryLayer(path.join(temporaryRoot, 'queue-recovery.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionHostRecoveryRepository
        const recovery = yield* repository.recoverAfterHostLoss(10)
        const sql = yield* SqlClient.SqlClient
        const [state] = yield* sql<{
          readonly active_run_id: string | null
          readonly queue_state: string
          readonly state_revision: number
          readonly queue_revision: number
        }>`
          SELECT active_run_id, queue_state, state_revision, queue_revision
          FROM session_control_states WHERE session_id = ${'session-queued'}
        `
        const followUps = yield* sql<{ readonly id: string }>`SELECT id FROM session_follow_ups`
        return { recovery, state, followUps }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      recovery: {
        interruptedRunIds: [],
        affectedSessionIds: ['session-queued'],
        deniedAuthorizationRequestIds: [],
        recoveredOperationIds: [],
        pendingHandoffs: [],
        pendingWorktreeRemovals: [],
      },
      state: {
        active_run_id: null,
        queue_state: 'paused',
        state_revision: 5,
        queue_revision: 8,
      },
      followUps: [{ id: 'follow-up-queued' }],
    })
  })
})
