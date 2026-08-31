import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

describe('SQLite external Session Run lifecycle', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-external-run-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('retains a queued Follow-up across replacement and schedules it after external Waggle', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'external.sqlite'),
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
        yield* queueSessionFollowUp({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-follow-up',
            idempotencyKey: 'idempotency-follow-up',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'Run after Waggle.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        if (!lifecycle.replaceWithExternal) {
          return yield* Effect.die('external replacement lifecycle unavailable')
        }
        const external = yield* lifecycle.replaceWithExternal({
          sessionId: SessionId('session-target'),
          previousRunId: RunId('run-next'),
          runId: RunId('waggle-run'),
          intent: {
            text: 'Use Waggle.',
            attachmentIds: [],
            callerId: 'gui:local-user',
            acceptedAt: 2000,
            idempotencyKey: 'waggle-once',
          },
        })
        const staleSettlement = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('unused-run'),
          terminalStatus: 'interrupted',
        })
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('waggle-run'),
        })
        const settled = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('waggle-run'),
          nextRunId: RunId('run-after-waggle'),
          terminalStatus: 'completed',
        })
        const sql = yield* SqlClient.SqlClient
        const states = yield* sql<{ readonly active_run_id: string | null }>`
          SELECT active_run_id FROM session_control_states
        `
        const runs = yield* sql<{ readonly id: string; readonly status: string }>`
          SELECT id, status FROM session_runs ORDER BY created_at, id
        `
        const queue = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_follow_ups
        `
        return {
          external,
          staleSettlement,
          settled,
          activeRunId: states[0]?.active_run_id,
          runs,
          queue,
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.external).toMatchObject({ accepted: true })
    expect(result.staleSettlement).toMatchObject({ accepted: false, code: 'run_changed' })
    expect(result.settled).toMatchObject({
      accepted: true,
      scheduled: { runId: 'run-after-waggle', intent: { text: 'Run after Waggle.' } },
    })
    expect(result.activeRunId).toBe('run-after-waggle')
    expect(result.queue).toEqual([{ count: 0 }])
    expect(result.runs).toEqual([
      { id: 'run-next', status: 'interrupted' },
      { id: 'waggle-run', status: 'completed' },
      { id: 'run-after-waggle', status: 'starting' },
    ])
  })
})
