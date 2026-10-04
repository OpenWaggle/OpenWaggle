import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { FOLLOW_UP_EDIT_CALLER_ID } from '@shared/types/session-control-queue'
import * as Effect from 'effect/Effect'
import { adoptSessionFollowUp } from '../../application/session-control-queue-adopt-service'
import { submitSessionMessage } from '../../application/session-control-service'
import { loadSessionControlState } from '../sqlite-session-control-state'

export const SESSION = 'session-target'
export const USER = FOLLOW_UP_EDIT_CALLER_ID
export const PROFILE = 'profile:ci'

export const STUCK_INTENT: {
  readonly text: string
  readonly attachmentIds: readonly string[]
  readonly callerId: string
  readonly acceptedAt: number
  readonly idempotencyKey: string
} = {
  text: 'Then list every project.',
  attachmentIds: [],
  callerId: PROFILE,
  acceptedAt: 1,
  idempotencyKey: 'stored-follow-up',
}

export function startRunAndQueueStuckFollowUp(intent: Partial<typeof STUCK_INTENT> = {}) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* submitSessionMessage({
      callerId: USER,
      request: {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: 'request-message',
        idempotencyKey: 'message',
        command: {
          operation: 'message',
          sessionId: SESSION,
          input: { text: 'Start working.', attachmentIds: [] },
        },
      },
    })
    yield* sql`
      INSERT INTO session_follow_ups (
        id, session_id, position, delivery_state, attention_reason, intent_json,
        created_at, updated_at
      ) VALUES (
        ${'follow-up-stuck'}, ${SESSION}, ${0}, ${'needs_attention'}, ${'profile_revoked'},
        ${JSON.stringify({ ...STUCK_INTENT, ...intent })}, ${1}, ${1}
      )
    `
    return (yield* loadSessionControlState(sql, SESSION)).followUpQueue.revision
  })
}

export function adopt(input: {
  readonly key: string
  readonly desktopUser: boolean
  readonly callerId?: string
  readonly expectedQueueRevision: number
}) {
  return adoptSessionFollowUp({
    callerId: input.callerId ?? USER,
    desktopUser: input.desktopUser,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: `request-${input.key}`,
      idempotencyKey: input.key,
      command: {
        operation: 'queue-adopt',
        sessionId: SESSION,
        followUpId: 'follow-up-stuck',
        expectedQueueRevision: input.expectedQueueRevision,
      },
    },
  })
}
