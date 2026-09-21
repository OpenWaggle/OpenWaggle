import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { queueSessionFollowUp } from '../../application/session-control-service'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

let temporaryRoot = ''

describe('SQLite Session Follow-up admission', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-admission-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('applies the app-wide Run ceiling when an idle Follow-up becomes the next Run', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'host-ceiling.sqlite'))
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
        const response = yield* queueSessionFollowUp({
          callerId: 'local-user',
          hostRunCeiling: 1,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-follow-up-ceiling',
            idempotencyKey: 'idempotency-follow-up-ceiling',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'Wait for Host capacity.', attachmentIds: [] },
            },
          },
        })
        const runs = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_runs WHERE session_id = ${'session-target'}
        `
        const followUps = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_follow_ups WHERE session_id = ${'session-target'}
        `
        return { response, runCount: runs[0]?.count, followUpCount: followUps[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      operation: 'follow-up',
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
    })
    expect(result.runCount).toBe(0)
    expect(result.followUpCount).toBe(0)
  })

  it('starts an explicit Follow-up when settlement wins the enqueue race', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'settlement-race.sqlite'))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* queueSessionFollowUp({
          callerId: 'local-user',
          hostRunCeiling: 4,
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-follow-up-after-settle',
            idempotencyKey: 'idempotency-follow-up-after-settle',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'Continue with verification.', attachmentIds: [] },
            },
          },
        })
        const sql = yield* SqlClient.SqlClient
        const [state] = yield* sql<{
          readonly active_run_id: string | null
          readonly state_revision: number
          readonly queue_revision: number
        }>`
          SELECT active_run_id, state_revision, queue_revision
          FROM session_control_states
          WHERE session_id = ${'session-target'}
        `
        const runs = yield* sql<{ readonly id: string; readonly status: string }>`
          SELECT id, status FROM session_runs WHERE session_id = ${'session-target'}
        `
        const followUps = yield* sql<{ readonly id: string }>`
          SELECT id FROM session_follow_ups WHERE session_id = ${'session-target'}
        `
        return { response, state, runs, followUps }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toEqual({
      operation: 'follow-up',
      effect: 'started-run',
      sessionId: 'session-target',
      runId: 'run-next',
      stateRevision: 1,
    })
    expect(result.state).toEqual({
      active_run_id: 'run-next',
      state_revision: 1,
      queue_revision: 0,
    })
    expect(result.runs).toEqual([{ id: 'run-next', status: 'starting' }])
    expect(result.followUps).toEqual([])
  })
})
