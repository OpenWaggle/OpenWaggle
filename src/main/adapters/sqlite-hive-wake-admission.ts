import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { asAgentsHiveWakeKey, HIVE_WAKE_NOT_NEEDED } from '../domain/session-control/hive-wake'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import { messageCallerBlockReason } from './session-follow-up-authorization'
import { selectHiveParentWakeCandidate } from './sqlite-hive-parent-wake-candidate'
import { wakeCandidateMayWake } from './sqlite-hive-wake-trigger-authority'
import { wakeCausedOutsideHive } from './sqlite-hive-wake-work'
import { newRunAdmissionRefusal } from './sqlite-session-control-queue-delivery'

/** The starting wake as the capacity rule reads it when something outside its Hive caused it. */
function asAgentsWake(state: SessionControlSessionState): SessionControlSessionState {
  if (state.run.state !== 'starting') return state
  const idempotencyKey = asAgentsHiveWakeKey(state.run.intent.idempotencyKey)
  return { ...state, run: { ...state.run, intent: { ...state.run.intent, idempotencyKey } } }
}

/** Whether this decision starts a Host-authored Hive wake Run. */
export function startsHiveWake(state: SessionControlSessionState) {
  return state.run.state === 'starting' && state.run.intent.hiveWake === true
}

/**
 * A Hive wake checks its parent and its authority before it starts, but outside the mutation's
 * transaction. It starts only if both still hold inside it: the parent is idle, unarchived, with
 * no Follow-up (a queue paused at the Worker limits does not count) and an unread update; its
 * last Run's caller is still the wake's caller and may still message it; that Run asks for no
 * wider mode than the wake carries; and an update it acts on has a cause that may wake the parent.
 *
 * `state` is what to persist when it starts: a wake that something outside the Queen's Hive
 * caused since the Host built its key gets the marked key here, so the Run that starts counts.
 */
export function hiveWakeAdmission(
  sql: SqlClient.SqlClient,
  starting: SessionControlSessionState,
  callerId: string,
  hostRunCeiling: number,
) {
  return Effect.gen(function* () {
    const refused = <Code extends string>(refusal: Code) => ({ refusal, state: starting })
    const { run, sessionId } = starting
    const candidate = yield* selectHiveParentWakeCandidate(sql, { parentSessionId: sessionId })
    if (!candidate || candidate.callerId !== callerId) return refused(HIVE_WAKE_NOT_NEEDED)
    const narrowed =
      run.state === 'starting' && run.intent.runAuthorizationOverride === 'ask-for-approval'
    if (candidate.runAuthorizationOverride === 'ask-for-approval' && !narrowed) {
      return refused(HIVE_WAKE_NOT_NEEDED)
    }
    const callerBlock = yield* messageCallerBlockReason(sql, sessionId, callerId)
    if (callerBlock) return refused(callerBlock)
    if (!(yield* wakeCandidateMayWake(sql, candidate))) return refused(HIVE_WAKE_NOT_NEEDED)
    const state = (yield* wakeCausedOutsideHive(sql, candidate)) ? asAgentsWake(starting) : starting
    return { refusal: yield* newRunAdmissionRefusal(sql, state, hostRunCeiling), state }
  })
}
