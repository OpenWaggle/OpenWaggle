import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import {
  SessionControlRunLifecycleRepository,
  type SessionControlTerminalRunStatus,
} from '../../ports/session-control-run-lifecycle-repository'

export const UNSUCCESSFUL_TERMINAL_STATUSES = [
  'failed',
  'interrupted',
  'interrupted-by-interaction-timeout',
] as const satisfies readonly SessionControlTerminalRunStatus[]

export const PAUSE_REASON_BY_STATUS = {
  failed: 'run-failed',
  interrupted: 'run-interrupted',
  'interrupted-by-interaction-timeout': 'run-timed-out',
} as const

export function submitMessage(text: string, key: string) {
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

export function queueFollowUp(text: string, key: string) {
  return queueSessionFollowUp({
    callerId: 'local-user',
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: `request-${key}`,
      idempotencyKey: `idempotency-${key}`,
      command: {
        operation: 'follow-up',
        sessionId: 'session-target',
        input: { text, attachmentIds: [] },
      },
    },
  })
}

export function prepareRunWithFollowUp() {
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

export function readSettlementState() {
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
    const [pause] = yield* sql<{ readonly queue_pause_reason: string | null }>`
      SELECT queue_pause_reason FROM session_control_states
      WHERE session_id = ${'session-target'}
    `
    const followUps = yield* sql<{ readonly id: string }>`
      SELECT id FROM session_follow_ups ORDER BY position, id
    `
    const [run] = yield* sql<{ readonly status: string }>`
      SELECT status FROM session_runs WHERE id = ${'run-next'}
    `
    return { state, followUps, run, pauseReason: pause?.queue_pause_reason ?? null }
  })
}
