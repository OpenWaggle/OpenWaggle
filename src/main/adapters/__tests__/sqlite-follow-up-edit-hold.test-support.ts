import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { editSessionFollowUp } from '../../application/session-control-queue-edit-service'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SqliteFollowUpEditHoldRepositoryLive } from '../sqlite-follow-up-edit-hold-repository'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

export const USER = 'gui:local-user'
export const SESSION = 'session-target'
export const FOLLOW_UP = 'follow-up-next'
export const HOLD = 'follow-up-edit-hold-follow-up-next'

let requestCount = 0

export function resetFollowUpEditRequests() {
  requestCount = 0
}

export function request<Command extends SessionControlMutationCommand>(command: Command) {
  requestCount += 1
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${requestCount}`,
    idempotencyKey: `idempotency-${requestCount}`,
    command,
  }
}

export function edit(
  command: Extract<
    SessionControlMutationCommand,
    { operation: 'queue-edit-begin' | 'queue-edit-save' | 'queue-edit-cancel' }
  >,
  callerId = USER,
) {
  return editSessionFollowUp({
    callerId,
    desktopUser: callerId === USER,
    request: request(command),
  })
}

/** An active Run with one Follow-up the desktop user queued behind it. */
export const activeRunWithQueuedFollowUp = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Delivery re-checks the Follow-up's authority against the target's execution profile.
  yield* sql`
    INSERT INTO session_execution_profiles (
      session_id, profile_json, authority_origin_caller_id,
      authorization_ceiling, created_at, updated_at
    ) VALUES (
      ${SESSION}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
      ${USER}, ${'ask-for-approval'}, ${1000}, ${1000}
    )
  `
  yield* submitSessionMessage({
    callerId: USER,
    request: request({
      operation: 'message',
      sessionId: SESSION,
      input: { text: 'Start', attachmentIds: [] },
    }),
  })
  yield* queueSessionFollowUp({
    callerId: USER,
    request: request({
      operation: 'follow-up',
      sessionId: SESSION,
      input: { text: 'Original', attachmentIds: [], thinkingLevel: 'high' },
    }),
  })
})

export function settleRun() {
  return SessionControlRunLifecycleRepository.pipe(
    Effect.flatMap((runs) =>
      runs.settle({
        sessionId: SessionId(SESSION),
        runId: RunId('run-next'),
        nextRunId: RunId('run-after'),
        terminalStatus: 'completed',
      }),
    ),
  )
}

export function followUpEditLayer(tmpRoot: string, name: string) {
  return Layer.provideMerge(
    SqliteFollowUpEditHoldRepositoryLive,
    makeSessionControlTestLayer(path.join(tmpRoot, name)),
  )
}
