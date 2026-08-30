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
import { reservedFollowUpIds } from '../sqlite-session-follow-up-reservation'
import { SqliteSessionHostRecoveryRepositoryLive } from '../sqlite-session-host-recovery-repository'

function makeLayer(filename: string) {
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
        VALUES (${'session-1'}, ${'pi-1'}, ${'/project'}, ${'Session'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (${'run-1'}, ${'session-1'}, ${'active'}, ${'{}'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_control_states (
          session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
        ) VALUES (${'session-1'}, ${2}, ${'run-1'}, ${'running'}, ${3}, ${1})
      `
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, intent_json, created_at, updated_at
        ) VALUES (${'follow-up-1'}, ${'session-1'}, ${0}, ${'pending'}, ${'{}'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_authorization_requests (
          id, session_id, run_id, request_json, status, created_at
        ) VALUES (${'authorization-1'}, ${'session-1'}, ${'run-1'}, ${'{}'}, ${'pending'}, ${1})
      `
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    SqliteSessionHostRecoveryRepositoryLive.pipe(Layer.provide(sqlite)),
  )
}

describe('SQLite Session Host recovery repository', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-recovery-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('interrupts uncertain Runs, denies pending authorization, and preserves paused Follow-ups', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'recovery.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionHostRecoveryRepository
        const recovery = yield* repository.recoverAfterHostLoss(10)
        const sql = yield* SqlClient.SqlClient
        const [run] = yield* sql<{ status: string }>`SELECT status FROM session_runs`
        const [state] = yield* sql<{
          active_run_id: string | null
          queue_state: string
          state_revision: number
          queue_revision: number
        }>`SELECT active_run_id, queue_state, state_revision, queue_revision FROM session_control_states`
        const [authorization] = yield* sql<{
          status: string
          decision_reason: string
          decided_at: number
        }>`SELECT status, decision_reason, decided_at FROM session_authorization_requests`
        const [followUp] = yield* sql<{ delivery_state: string }>`
          SELECT delivery_state FROM session_follow_ups
        `
        return { recovery, run, state, authorization, followUp }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      recovery: {
        interruptedRunIds: ['run-1'],
        affectedSessionIds: ['session-1'],
        deniedAuthorizationRequestIds: ['authorization-1'],
        recoveredOperationIds: [],
        pendingHandoffs: [],
      },
      run: { status: 'interrupted-by-host-loss' },
      state: {
        active_run_id: null,
        queue_state: 'paused',
        state_revision: 3,
        queue_revision: 4,
      },
      authorization: { status: 'denied', decision_reason: 'host_lost', decided_at: 10 },
      followUp: { delivery_state: 'pending' },
    })
  })

  it('completes orphaned two-phase operations even when no Run survived', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'pending-operation.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_control_states SET active_run_id = ${null}`
        yield* sql`DELETE FROM session_authorization_requests`
        yield* sql`DELETE FROM session_runs`
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${'local-user'}, ${'promote'}, ${'session-1'}, ${'orphaned'},
            ${JSON.stringify({
              operation: 'promote',
              sessionId: 'session-1',
              expectedRunId: 'run-1',
              followUpId: 'follow-up-1',
            })},
            ${'pending'}, ${null}, ${1}, ${1}
          )
        `
        const reservedBefore = yield* reservedFollowUpIds(sql, 'session-1')
        const repository = yield* SessionHostRecoveryRepository
        const recovery = yield* repository.recoverAfterHostLoss(20)
        const reservedAfter = yield* reservedFollowUpIds(sql, 'session-1')
        const [operation] = yield* sql<{
          readonly id: number
          readonly status: string
          readonly outcome_json: string
        }>`SELECT id, status, outcome_json FROM session_operations`
        return { recovery, operation, reservedBefore, reservedAfter }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.recovery).toMatchObject({
      interruptedRunIds: [],
      recoveredOperationIds: [String(result.operation?.id)],
    })
    expect(result.operation?.status).toBe('completed')
    expect([...result.reservedBefore]).toEqual(['follow-up-1'])
    expect([...result.reservedAfter]).toEqual([])
    expect(JSON.parse(result.operation?.outcome_json ?? '{}')).toEqual({
      operation: 'promote',
      effect: 'rejected',
      sessionId: 'session-1',
      code: 'host_lost',
    })
  })

  it('retains pending Workspace handoffs for idempotent replay after host loss', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'pending-handoff.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_control_states SET active_run_id = ${null}`
        yield* sql`DELETE FROM session_authorization_requests`
        yield* sql`DELETE FROM session_runs`
        const command = {
          operation: 'handoff',
          sessionId: 'session-1',
          workspace: { mode: 'existing', workspaceId: 'workspace-target' },
        }
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${'local-user'}, ${'handoff'}, ${'session-1'}, ${'handoff-key'},
            ${JSON.stringify(command)}, ${'pending'}, ${null}, ${1}, ${1}
          )
        `
        const repository = yield* SessionHostRecoveryRepository
        const recovery = yield* repository.recoverAfterHostLoss(20)
        const [operation] = yield* sql<{ readonly id: number; readonly status: string }>`
          SELECT id, status FROM session_operations
        `
        return { recovery, operation }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.operation?.status).toBe('pending')
    expect(result.recovery.recoveredOperationIds).toEqual([])
    expect(result.recovery.pendingHandoffs).toEqual([
      {
        operationId: String(result.operation?.id),
        callerId: 'local-user',
        idempotencyKey: 'handoff-key',
        requestJson: JSON.stringify({
          operation: 'handoff',
          sessionId: 'session-1',
          workspace: { mode: 'existing', workspaceId: 'workspace-target' },
        }),
      },
    ])
  })

  it('replays completed Workspace handoffs whose Git ref cleanup remains durable', async () => {
    const layer = makeLayer(path.join(temporaryRoot, 'handoff-cleanup.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_control_states SET active_run_id = ${null}`
        yield* sql`DELETE FROM session_authorization_requests`
        yield* sql`DELETE FROM session_runs`
        const command = {
          operation: 'handoff',
          sessionId: 'session-1',
          workspace: { mode: 'existing', workspaceId: 'workspace-target' },
        }
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, cleanup_json, created_at, updated_at
          ) VALUES (
            ${'local-user'}, ${'handoff'}, ${'session-1'}, ${'handoff-cleanup-key'},
            ${JSON.stringify(command)}, ${'completed'},
            ${JSON.stringify({ operation: 'handoff', effect: 'session-handed-off' })},
            ${JSON.stringify({ kind: 'workspace-handoff-refs' })}, ${1}, ${1}
          )
        `
        const repository = yield* SessionHostRecoveryRepository
        const recovery = yield* repository.recoverAfterHostLoss(20)
        const [operation] = yield* sql<{ readonly id: number; readonly status: string }>`
          SELECT id, status FROM session_operations
        `
        return { recovery, operation }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.operation?.status).toBe('completed')
    expect(result.recovery.recoveredOperationIds).toEqual([])
    expect(result.recovery.pendingHandoffs).toEqual([
      {
        operationId: String(result.operation?.id),
        callerId: 'local-user',
        idempotencyKey: 'handoff-cleanup-key',
        requestJson: JSON.stringify({
          operation: 'handoff',
          sessionId: 'session-1',
          workspace: { mode: 'existing', workspaceId: 'workspace-target' },
        }),
      },
    ])
  })
})
