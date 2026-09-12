import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mutateSessionQueue, submitSessionMessage } from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

let temporaryRoot = ''

describe('SQLite Session Control Run lifecycle repository', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-run-lifecycle-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('durably activates and settles the exact Run', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'lifecycle.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-start',
            idempotencyKey: 'idempotency-start',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        const stale = yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-stale'),
        })
        const activated = yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        const settled = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
        })
        const sql = yield* SqlClient.SqlClient
        const states = yield* sql<{
          readonly active_run_id: string | null
          readonly state_revision: number
        }>`SELECT active_run_id, state_revision FROM session_control_states`
        const runs = yield* sql<{ readonly status: string }>`
          SELECT status FROM session_runs WHERE id = ${'run-next'}
        `
        return { stale, activated, settled, state: states[0], run: runs[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      stale: { accepted: false, code: 'run_changed', state: expect.anything() },
      activated: {
        accepted: true,
        stateRevision: 2,
        intent: {
          text: 'Start working.',
          attachmentIds: [],
          callerId: 'local-user',
          acceptedAt: 1234,
          idempotencyKey: 'idempotency-start',
        },
      },
      settled: { accepted: true, stateRevision: 3 },
      state: { active_run_id: null, state_revision: 3 },
      run: { status: 'completed' },
    })
  })

  it('marks live Runs lost and pauses their Follow-up queues during host recovery', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'recovery.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-start',
            idempotencyKey: 'idempotency-start',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        const recovered = yield* lifecycle.recoverHostLoss
        const sql = yield* SqlClient.SqlClient
        const states = yield* sql<{
          readonly active_run_id: string | null
          readonly queue_state: string
          readonly queue_revision: number
        }>`SELECT active_run_id, queue_state, queue_revision FROM session_control_states`
        const runs = yield* sql<{ readonly status: string }>`SELECT status FROM session_runs`
        return { recovered, state: states[0], run: runs[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      recovered: [{ sessionId: SessionId('session-target'), runId: RunId('run-next') }],
      state: { active_run_id: null, queue_state: 'paused', queue_revision: 1 },
      run: { status: 'interrupted-by-host-loss' },
    })
  })

  it('restores the paused invariant when a reordered attention item becomes the head', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'reordered-attention.sqlite'),
    )
    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const blockedIntent = JSON.stringify({
          text: 'Blocked work.',
          attachmentIds: [],
          callerId: 'profile:missing',
          acceptedAt: 1000,
          idempotencyKey: 'blocked',
        })
        const pendingIntent = JSON.stringify({
          text: 'Run first.',
          attachmentIds: [],
          callerId: 'local-user',
          acceptedAt: 1001,
          idempotencyKey: 'pending',
        })
        yield* sql`
          INSERT INTO session_follow_ups (
            id, session_id, position, delivery_state, attention_reason,
            intent_json, created_at, updated_at
          ) VALUES
            (
              ${'follow-up-blocked'}, ${'session-target'}, ${0}, ${'needs_attention'},
              ${'authority_changed'}, ${blockedIntent}, ${1000}, ${1000}
            ),
            (
              ${'follow-up-pending'}, ${'session-target'}, ${1}, ${'pending'},
              ${null}, ${pendingIntent}, ${1001}, ${1001}
            )
        `
        yield* sql`
          UPDATE session_control_states
          SET queue_state = ${'paused'}, queue_revision = ${2}, state_revision = ${2}
          WHERE session_id = ${'session-target'}
        `
        yield* mutateSessionQueue({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-reorder-attention',
            idempotencyKey: 'idempotency-reorder-attention',
            command: {
              operation: 'queue-reorder',
              sessionId: 'session-target',
              expectedQueueRevision: 2,
              orderedFollowUpIds: ['follow-up-pending', 'follow-up-blocked'],
            },
          },
        })
        yield* mutateSessionQueue({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-resume-attention',
            idempotencyKey: 'idempotency-resume-attention',
            command: {
              operation: 'queue-resume',
              sessionId: 'session-target',
              expectedQueueRevision: 3,
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
        })
        const rows = yield* sql<{
          readonly active_run_id: string | null
          readonly queue_state: string
          readonly queue_revision: number
        }>`
          SELECT active_run_id, queue_state, queue_revision
          FROM session_control_states WHERE session_id = ${'session-target'}
        `
        return rows[0]
      }).pipe(Effect.provide(layer)),
    )

    expect(state).toEqual({ active_run_id: null, queue_state: 'paused', queue_revision: 6 })
  })
})
