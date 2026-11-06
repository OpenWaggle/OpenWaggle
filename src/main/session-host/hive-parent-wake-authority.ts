import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { messageCallerBlockReason } from '../adapters/session-follow-up-authorization'
import type { HiveWakeAuthority } from '../application/hive-parent-wake'
import type { HiveParentWakeCandidate } from '../ports/session-orchestration-update-repository'
import { runInitiatorCeiling } from './session-agent-run-ceiling'

/**
 * What a Hive wake may do for the caller of the parent's latest Run (`hive-parent-wake.ts`). That
 * caller must still be allowed to send the parent a message, checked as Follow-up delivery checks
 * a queued Follow-up's caller. A Run mode override belongs to the one Run it was sent with, so the
 * wake keeps only a narrowing one: it runs in ask-for-approval when the latest Run did, or when the
 * live ceiling of whoever started that Run is ask-for-approval, and otherwise in the Session's own
 * mode. It never runs with more than a Run that caller could start now.
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
    const asks =
      ceiling === 'ask-for-approval' || candidate.runAuthorizationOverride === 'ask-for-approval'
    return (
      asks ? { runAuthorizationOverride: 'ask-for-approval' } : {}
    ) satisfies HiveWakeAuthority
  })
}
