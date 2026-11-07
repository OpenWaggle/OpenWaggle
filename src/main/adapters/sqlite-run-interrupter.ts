import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import { HOST_SHUTDOWN_CALLER_ID } from '../domain/session-control/root-session-project-reach'
import { persistSessionControlState } from './sqlite-session-control-state'

/**
 * Records who stopped a Run, when a Session Control mutation moves it to `stopping`. An
 * interrupted Worker Run's orchestration update names that caller as its cause
 * (`sqlite-hive-wake-trigger-authority.ts`), not whoever started the Run: a client that may only
 * interrupt a Worker must not wake its parent through it. The first stop wins.
 */
export function recordRunInterrupter(
  sql: SqlClient.SqlClient,
  input: {
    readonly before: SessionControlSessionState
    readonly after: SessionControlSessionState
    readonly callerId: string
  },
) {
  const { before, after } = input
  // The Host's own shutdown stop leaves the cause with whoever started the Run.
  if (input.callerId === HOST_SHUTDOWN_CALLER_ID) return Effect.void
  if (after.run.state !== 'stopping') return Effect.void
  if (before.run.state !== 'active' && before.run.state !== 'starting') return Effect.void
  if (before.run.runId !== after.run.runId) return Effect.void
  return sql`
    UPDATE session_runs SET interrupted_by_caller_id = ${input.callerId}
    WHERE id = ${after.run.runId} AND session_id = ${after.sessionId}
      AND interrupted_by_caller_id IS NULL
  `.pipe(Effect.asVoid)
}

/** Persists a mutation's new state and records who stopped a Run it stopped. */
export function persistAndRecordStop(
  sql: SqlClient.SqlClient,
  before: SessionControlSessionState,
  after: SessionControlSessionState,
  callerId: string,
  now: number,
) {
  return persistSessionControlState(sql, after, now).pipe(
    Effect.zipRight(recordRunInterrupter(sql, { before, after, callerId })),
  )
}
