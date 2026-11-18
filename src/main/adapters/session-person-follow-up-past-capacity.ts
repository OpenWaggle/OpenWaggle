import type * as SqlClient from '@effect/sql/SqlClient'
import type { RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import {
  deliverPersonFollowUpPastCapacity,
  markFollowUpNeedsAttention,
} from '../domain/session-control/follow-up-delivery'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import { messageCallerBlockReason } from './session-follow-up-authorization'

/**
 * Starts the person's Follow-up past agents' capacity (`deliverPersonFollowUpPastCapacity`) after
 * the current-authority check automatic delivery makes (ADR 0057): one whose authority changed
 * needs attention instead, and the person's next Follow-up is tried.
 */
export function deliverAuthorizedPersonFollowUpPastCapacity(
  sql: SqlClient.SqlClient,
  state: SessionControlSessionState,
  nextRunId: RunId,
  retriesAfter?: number,
) {
  return Effect.gen(function* () {
    let current = state
    for (const _item of state.followUpQueue.items) {
      const delivery = deliverPersonFollowUpPastCapacity(current, nextRunId, retriesAfter)
      if (!delivery.delivered) return delivery
      const { followUpId, intent } = delivery.delivered
      const reason = yield* messageCallerBlockReason(sql, current.sessionId, intent.callerId)
      if (!reason) return delivery
      current = markFollowUpNeedsAttention(current, followUpId, reason)
    }
    return { state: current }
  })
}
