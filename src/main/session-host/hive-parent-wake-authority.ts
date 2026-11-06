import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { messageCallerBlockReason } from '../adapters/session-follow-up-authorization'
import type { HiveWakeAuthority } from '../application/hive-parent-wake'
import type { HiveParentWakeCandidate } from '../ports/session-orchestration-update-repository'
import { runInitiatorCeiling } from './session-agent-run-ceiling'

/**
 * What a Hive wake may do for the caller of the parent's latest Run (`hive-parent-wake.ts`). That
 * caller must still be allowed to send the parent a message, checked as Follow-up delivery checks
 * a queued Follow-up's caller. The wake keeps the latest Run's Run mode override and is clamped to
 * ask-for-approval when the live ceiling of whoever started that Run is, so it never runs with
 * more than a Run that caller could start now.
 */
export function resolveHiveWakeAuthority(
  sql: SqlClient.SqlClient,
  candidate: HiveParentWakeCandidate,
) {
  return Effect.gen(function* () {
    const blocked = yield* messageCallerBlockReason(
      sql,
      candidate.parentSessionId,
      candidate.callerId,
    )
    if (blocked) return { blocked } satisfies HiveWakeAuthority
    const ceiling = yield* runInitiatorCeiling(
      sql,
      candidate.parentSessionId,
      candidate.latestRunId,
    )
    const runAuthorizationOverride =
      ceiling === 'ask-for-approval' ? ceiling : candidate.runAuthorizationOverride
    return (
      runAuthorizationOverride ? { runAuthorizationOverride } : {}
    ) satisfies HiveWakeAuthority
  })
}
