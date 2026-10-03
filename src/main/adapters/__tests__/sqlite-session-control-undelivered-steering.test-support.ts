import * as SqlClient from '@effect/sql/SqlClient'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { SessionControlFollowUp } from '../../domain/session-control/message-aggregate'
import type { UndeliveredSteer } from '../../domain/session-control/undelivered-steering'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'
import { queueFollowUp, submitMessage } from './sqlite-session-control-settlement-test-support'

export const directSteer: SessionControlFollowUp = {
  id: FollowUpId('follow-up-direct-steer'),
  deliveryState: 'pending',
  intent: {
    text: 'Also check the migration rollback.',
    attachmentIds: ['attachment-steer'],
    visualizationContext: { title: 'Plan', sourcePath: '/repo/plan.html', state: { step: 2 } },
    callerId: 'session-agent:queen',
    acceptedAt: 1500,
    idempotencyKey: 'idempotency-direct-steer',
  },
}

export function layer(databasePath: string) {
  let followUpCount = 0
  return makeSessionControlRunLifecycleTestLayer(databasePath, {
    nextFollowUpId: Effect.sync(() => {
      followUpCount += 1
      return FollowUpId(`follow-up-${followUpCount}`)
    }),
  })
}

/** A started Run with Follow-ups `follow-up-2` ("First queued.") and `follow-up-3` (the message start takes `follow-up-1`). */
export function prepareRunWithTwoFollowUps() {
  return Effect.gen(function* () {
    yield* submitMessage('Start working.', 'start')
    yield* queueFollowUp('First queued.', 'first')
    yield* queueFollowUp('Promoted, then stopped.', 'second')
    const lifecycle = yield* SessionControlRunLifecycleRepository
    yield* lifecycle.activate({ sessionId: SessionId('session-target'), runId: RunId('run-next') })
    return lifecycle
  })
}

export function insertPendingReplacement(sql: SqlClient.SqlClient) {
  return sql`
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
}

export function readQueue() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [state] = yield* sql<{
      readonly state_revision: number
      readonly queue_state: string
      readonly queue_pause_reason: string | null
      readonly queue_revision: number
    }>`
      SELECT state_revision, queue_state, queue_pause_reason, queue_revision
      FROM session_control_states WHERE session_id = ${'session-target'}
    `
    const followUps = yield* sql<{ readonly id: string; readonly intent_json: string }>`
      SELECT id, intent_json FROM session_follow_ups ORDER BY position
    `
    return {
      state,
      followUps: followUps.map((row) => row.id),
      intents: new Map(followUps.map((row) => [row.id, JSON.parse(row.intent_json)])),
    }
  })
}

export const undelivered: readonly UndeliveredSteer[] = [
  { delivery: { kind: 'steer', followUp: directSteer }, handedOff: true },
  {
    delivery: { kind: 'promoted-follow-up', followUpId: FollowUpId('follow-up-3') },
    handedOff: true,
  },
]
