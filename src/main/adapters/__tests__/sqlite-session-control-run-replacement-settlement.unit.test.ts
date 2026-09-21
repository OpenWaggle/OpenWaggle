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

describe('SQLite Session Control replacement settlement', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-replacement-settlement-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('terminalizes an interrupted Run without consuming its queue while replacement is pending', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'replacement-handoff.sqlite'),
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
              input: { text: 'Keep this queued.', attachmentIds: [] },
            },
          },
        })
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_runs SET status = ${'stopping'} WHERE id = ${'run-next'}`
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${'local-user'}, ${'replace'}, ${'session-target'}, ${'replace-key'},
            ${JSON.stringify({
              operation: 'replace',
              sessionId: 'session-target',
              expectedRunId: 'run-next',
              input: { text: 'Replacement.', attachmentIds: [] },
            })}, ${'pending'}, ${null}, ${1000}, ${1000}
          )
        `
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'interrupted',
        })
        const states = yield* sql<{ readonly active_run_id: string | null }>`
          SELECT active_run_id FROM session_control_states
        `
        const followUps = yield* sql<{ readonly id: string }>`SELECT id FROM session_follow_ups`
        const runs = yield* sql<{ readonly status: string }>`
          SELECT status FROM session_runs WHERE id = ${'run-next'}
        `
        return { settlement, state: states[0], followUps, run: runs[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      settlement: { accepted: false, code: 'run_not_active' },
      state: { active_run_id: 'run-next' },
      followUps: [{ id: 'follow-up-next' }],
      run: { status: 'stopping' },
    })
  })
})
