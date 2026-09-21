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
import {
  SessionControlRunLifecycleRepository,
  type SessionControlTerminalRunStatus,
} from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

const UNSUCCESSFUL_TERMINAL_STATUSES = [
  'failed',
  'interrupted',
  'interrupted-by-interaction-timeout',
] as const satisfies readonly SessionControlTerminalRunStatus[]

function prepareRunWithFollowUp() {
  return Effect.gen(function* () {
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
          input: { text: 'Retain this work.', attachmentIds: [] },
        },
      },
    })
    const lifecycle = yield* SessionControlRunLifecycleRepository
    yield* lifecycle.activate({
      sessionId: SessionId('session-target'),
      runId: RunId('run-next'),
    })
    return lifecycle
  })
}

function readSettlementState() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [state] = yield* sql<{
      readonly active_run_id: string | null
      readonly queue_state: string
      readonly queue_revision: number
    }>`
      SELECT active_run_id, queue_state, queue_revision FROM session_control_states
      WHERE session_id = ${'session-target'}
    `
    const followUps = yield* sql<{ readonly id: string }>`
      SELECT id FROM session_follow_ups ORDER BY position, id
    `
    const [run] = yield* sql<{ readonly status: string }>`
      SELECT status FROM session_runs WHERE id = ${'run-next'}
    `
    return { state, followUps, run }
  })
}

describe('SQLite Session Control terminal settlement', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-settlement-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each(UNSUCCESSFUL_TERMINAL_STATUSES)(
    'pauses and retains queued work after %s settlement',
    async (terminalStatus) => {
      const layer = makeSessionControlRunLifecycleTestLayer(
        path.join(temporaryRoot, `${terminalStatus}.sqlite`),
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const lifecycle = yield* prepareRunWithFollowUp()
          const settlement = yield* lifecycle.settle({
            sessionId: SessionId('session-target'),
            runId: RunId('run-next'),
            nextRunId: RunId('run-after'),
            terminalStatus,
          })
          return { settlement, ...(yield* readSettlementState()) }
        }).pipe(Effect.provide(layer)),
      )

      expect(result).toEqual({
        settlement: { accepted: true, stateRevision: 5 },
        state: { active_run_id: null, queue_state: 'paused', queue_revision: 2 },
        followUps: [{ id: 'follow-up-next' }],
        run: { status: terminalStatus },
      })
    },
  )

  it('leaves retained work running for a claimed replacement successor', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'claimed-successor.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* prepareRunWithFollowUp()
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'interrupted',
          suppressFollowUpScheduling: true,
        })
        return { settlement, ...(yield* readSettlementState()) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      settlement: { accepted: true, stateRevision: 4 },
      state: { active_run_id: null, queue_state: 'running', queue_revision: 1 },
      followUps: [{ id: 'follow-up-next' }],
      run: { status: 'interrupted' },
    })
  })
})
