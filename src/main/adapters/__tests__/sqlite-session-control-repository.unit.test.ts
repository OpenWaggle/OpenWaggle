import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

let tmpRoot = ''

describe('SqliteSessionControlRepositoryLive', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-control-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('replays an idempotent adaptive Message outcome without a second Run', async () => {
    const layer = makeSessionControlTestLayer(path.join(tmpRoot, 'session-host.sqlite'))
    const request = {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-message',
      idempotencyKey: 'idempotency-message',
      command: {
        operation: 'message',
        sessionId: 'session-target',
        input: { text: 'Implement the target schema.', attachmentIds: [] },
      },
    } as const

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* submitSessionMessage({ callerId: 'local-user', request })
        const replay = yield* submitSessionMessage({ callerId: 'local-user', request })
        const sql = yield* SqlClient.SqlClient
        const runs = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_runs WHERE session_id = ${'session-target'}
        `
        const states = yield* sql<{ readonly state_revision: number }>`
          SELECT state_revision FROM session_control_states WHERE session_id = ${'session-target'}
        `
        return { first, replay, runCount: runs[0]?.count, stateRevision: states[0]?.state_revision }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.first.replayed).toBe(false)
    expect(result.replay).toEqual({ ...result.first, replayed: true })
    expect(result.runCount).toBe(1)
    expect(result.stateRevision).toBe(1)
    expect(result.first.outcome).toMatchObject({
      effect: 'started-run',
      sessionId: SessionId('session-target'),
      runId: RunId('run-next'),
    })
  })

  it('atomically rejects a new independent Run when the app-wide ceiling is full', async () => {
    const layer = makeSessionControlTestLayer(path.join(tmpRoot, 'session-host-ceiling.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (id, project_path) VALUES (${'session-running'}, ${'/project'})
        `
        yield* sql`
          INSERT INTO session_runs (
            id, session_id, status, intent_json, created_at, updated_at
          ) VALUES (
            ${'run-running'}, ${'session-running'}, ${'active'}, ${null}, ${1}, ${1}
          )
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (
            ${'session-running'}, ${1}, ${'run-running'}, ${'running'}, ${0}, ${1}
          )
        `
        const response = yield* submitSessionMessage({
          callerId: 'local-user',
          hostRunCeiling: 1,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-ceiling',
            idempotencyKey: 'idempotency-ceiling',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Must wait for capacity.', attachmentIds: [] },
            },
          },
        })
        const targetRuns = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_runs WHERE session_id = ${'session-target'}
        `
        return { response, targetRunCount: targetRuns[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      operation: 'message',
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
    })
    expect(result.targetRunCount).toBe(0)
  })

  it('revalidates profile revocation inside durable Run admission', async () => {
    const layer = makeSessionControlTestLayer(path.join(tmpRoot, 'revoked-admission.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_client_profiles (
            id, name, credential_verifier, capabilities_json, scope_json,
            authorization_ceiling, revoked_at, created_at, updated_at
          ) VALUES (
            ${'profile-revoked'}, ${'revoked-client'}, ${'verifier'},
            ${'["sessions:message"]'}, ${'{"all":true}'}, ${'yolo'}, ${2000}, ${1000}, ${2000}
          )
        `
        const response = yield* submitSessionMessage({
          callerId: 'profile:profile-revoked',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-revoked',
            idempotencyKey: 'idempotency-revoked',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Must not run.', attachmentIds: [] },
            },
          },
        })
        const runs = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_runs WHERE session_id = ${'session-target'}
        `
        return { response, runCount: runs[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      effect: 'rejected',
      code: 'profile_revoked',
    })
    expect(result.runCount).toBe(0)
  })

  it('rejects reuse of an idempotency key with a different payload', async () => {
    const layer = makeSessionControlTestLayer(path.join(tmpRoot, 'session-host-conflict.sqlite'))
    const baseRequest = {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-message',
      idempotencyKey: 'idempotency-message',
      command: {
        operation: 'message',
        sessionId: 'session-target',
        input: { text: 'Implement the target schema.', attachmentIds: [] },
      },
    } as const

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        yield* submitSessionMessage({ callerId: 'local-user', request: baseRequest })
        return yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            ...baseRequest,
            requestId: 'request-message-retry',
            command: {
              ...baseRequest.command,
              input: { text: 'Use a different payload.', attachmentIds: [] },
            },
          },
        }).pipe(Effect.flip)
      }).pipe(Effect.provide(layer)),
    )

    expect(error).toMatchObject({
      _tag: 'SessionControlRepositoryError',
      operation: 'idempotency-key-reused',
    })
  })

  it('persists an explicit Follow-up independently from the active Run', async () => {
    const layer = makeSessionControlTestLayer(path.join(tmpRoot, 'session-host-follow-up.sqlite'))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-message',
            idempotencyKey: 'idempotency-message',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        const followUp = yield* queueSessionFollowUp({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-follow-up',
            idempotencyKey: 'idempotency-follow-up',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'Run verification next.', attachmentIds: [] },
            },
          },
        })
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly id: string
          readonly position: number
          readonly delivery_state: string
        }>`
          SELECT id, position, delivery_state
          FROM session_follow_ups
          WHERE session_id = ${'session-target'}
        `
        const states = yield* sql<{
          readonly active_run_id: string | null
          readonly state_revision: number
          readonly queue_revision: number
        }>`
          SELECT active_run_id, state_revision, queue_revision
          FROM session_control_states
          WHERE session_id = ${'session-target'}
        `
        return { followUp, rows, state: states[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.followUp.outcome).toMatchObject({
      operation: 'follow-up',
      effect: 'queued-follow-up',
      followUpId: FollowUpId('follow-up-next'),
    })
    expect(result.rows).toEqual([{ id: 'follow-up-next', position: 0, delivery_state: 'pending' }])
    expect(result.state).toEqual({
      active_run_id: 'run-next',
      state_revision: 2,
      queue_revision: 1,
    })
  })
})
