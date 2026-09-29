import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

let temporaryRoot = ''

function message(key: string, text: string) {
  return submitSessionMessage({
    callerId: 'local-user',
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: `request-${key}`,
      idempotencyKey: `idempotency-${key}`,
      command: {
        operation: 'message',
        sessionId: 'session-target',
        input: { text, attachmentIds: [] },
      },
    },
  })
}

describe('settling a Run while the Session Host stops', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-stop-settle-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each([
    [false, { active_run_id: 'run-after', queue_state: 'running', queue_pause_reason: null }],
    [true, { active_run_id: null, queue_state: 'paused', queue_pause_reason: 'host-lost' }],
  ])('with pauseFollowUpsForHostStop=%s, leaves the queue %j', async (stopping, expected) => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, `stop-${String(stopping)}.sqlite`),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* message('start', 'Start working.')
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
        })
        yield* message('follow-up', 'Then do this.')
        const settled = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          pauseFollowUpsForHostStop: stopping,
        })
        const sql = yield* SqlClient.SqlClient
        const states = yield* sql<{
          readonly active_run_id: string | null
          readonly queue_state: string
          readonly queue_pause_reason: string | null
        }>`SELECT active_run_id, queue_state, queue_pause_reason FROM session_control_states`
        return { settled, state: states[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.settled).toMatchObject({ accepted: true })
    expect(result.state).toEqual(expected)
  })
})
