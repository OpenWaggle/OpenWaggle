import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { HIVE_WAKE_NOT_NEEDED } from '../domain/session-control/hive-wake'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import { messageCallerBlockReason } from './session-follow-up-authorization'
import { selectHiveParentWakeCandidate } from './sqlite-hive-parent-wake-candidate'
import { wakeCandidateMayWake } from './sqlite-hive-wake-trigger-authority'
import { newRunAdmissionRefusal } from './sqlite-session-control-queue-delivery'

/** Whether this decision starts a Host-authored Hive wake Run. */
export function startsHiveWake(state: SessionControlSessionState) {
  return state.run.state === 'starting' && state.run.intent.hiveWake === true
}

/**
 * A Hive wake checks its parent and its authority before it starts, but outside the mutation's
 * transaction. It starts only if both still hold inside it: the parent is idle, unarchived, with
 * no Follow-up (or only agents' ones a Worker limit holds back) and an unread update; its last
 * Run's caller is still the wake's caller and may still message it; that Run asks for no wider
 * mode than the wake carries; and an update it acts on has a cause that may wake the parent.
 */
export function hiveWakeRefusal(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  callerId: string,
  hostRunCeiling: number,
) {
  return Effect.gen(function* () {
    const { run, sessionId } = state
    const candidate = yield* selectHiveParentWakeCandidate(sql, { parentSessionId: sessionId })
    if (!candidate || candidate.callerId !== callerId) return HIVE_WAKE_NOT_NEEDED
    const narrowed =
      run.state === 'starting' && run.intent.runAuthorizationOverride === 'ask-for-approval'
    if (candidate.runAuthorizationOverride === 'ask-for-approval' && !narrowed) {
      return HIVE_WAKE_NOT_NEEDED
    }
    const callerBlock = yield* messageCallerBlockReason(sql, sessionId, callerId)
    if (callerBlock) return callerBlock
    if (!(yield* wakeCandidateMayWake(sql, candidate))) return HIVE_WAKE_NOT_NEEDED
    return yield* newRunAdmissionRefusal(sql, state, hostRunCeiling)
  })
}
