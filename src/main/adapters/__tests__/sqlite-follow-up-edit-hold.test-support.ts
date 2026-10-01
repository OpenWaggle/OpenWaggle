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
import { loadSessionControlState } from '../sqlite-session-control-state'
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

/** Delivery re-checks a Follow-up's authority against the target's execution profile. */
const executionProfile = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO session_execution_profiles (
      session_id, profile_json, authority_origin_caller_id,
      authorization_ceiling, created_at, updated_at
    ) VALUES (
      ${SESSION}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
      ${USER}, ${'ask-for-approval'}, ${1000}, ${1000}
    )
  `
})

/**
 * An idle Session whose queue holds the desktop user's Follow-ups, in order. The queue is stored
 * directly because the test identities give every queued Follow-up the same id.
 */
export function idleQueue(
  items: readonly { readonly id: string; readonly acceptedAt?: number }[],
  queueState: 'running' | 'paused' = 'running',
) {
  return Effect.gen(function* () {
    yield* executionProfile
    const sql = yield* SqlClient.SqlClient
    for (const [position, item] of items.entries()) {
      const intent = {
        text: `Text of ${item.id}`,
        attachmentIds: [],
        callerId: USER,
        acceptedAt: item.acceptedAt ?? position + 1,
        idempotencyKey: `key-${item.id}`,
      }
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, intent_json, created_at, updated_at
        ) VALUES (
          ${item.id}, ${SESSION}, ${position}, ${'pending'}, ${JSON.stringify(intent)}, ${1}, ${1}
        )
      `
    }
    yield* sql`UPDATE session_control_states SET queue_state = ${queueState} WHERE session_id = ${SESSION}`
  })
}

/** An active Run with one Follow-up the desktop user queued behind it. */
export const activeRunWithQueuedFollowUp = Effect.gen(function* () {
  yield* executionProfile
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

export function beginEdit(followUpId: string) {
  return edit({ operation: 'queue-edit-begin', sessionId: SESSION, followUpId })
}

export function loadState() {
  return SqlClient.SqlClient.pipe(Effect.flatMap((sql) => loadSessionControlState(sql, SESSION)))
}
