import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { replaceWithExternalSessionRun } from '../domain/session-control/run-lifecycle'
import { SessionControlRepositoryError } from '../errors'
import type { SessionControlRunLifecycleRepositoryShape } from '../ports/session-control-run-lifecycle-repository'
import { loadSessionControlState, persistSessionControlState } from './sqlite-session-control-state'
import { reservedFollowUpIds } from './sqlite-session-follow-up-reservation'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

export function externalRunAdmission(
  sql: SqlClient.SqlClient,
  input: { readonly sessionId: SessionId; readonly hostRunCeiling?: number },
) {
  return Effect.gen(function* () {
    const parentAdmission = yield* directWorkerRunAdmission(sql, input.sessionId)
    if (!parentAdmission.admitted) {
      return { accepted: false, code: 'parent_concurrency_limit_reached' } as const
    }
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM session_control_states
      WHERE active_run_id IS NOT NULL
    `
    const hostRunCeiling = input.hostRunCeiling ?? DEFAULT_SETTINGS.sessionHostRunCeiling
    return (rows[0]?.count ?? 0) >= hostRunCeiling
      ? ({ accepted: false, code: 'host_run_ceiling_reached' } as const)
      : undefined
  })
}

export function replaceWithExternal(
  sql: SqlClient.SqlClient,
  input: Parameters<
    NonNullable<SessionControlRunLifecycleRepositoryShape['replaceWithExternal']>
  >[0],
) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const state = yield* loadSessionControlState(sql, input.sessionId)
        const replaced = replaceWithExternalSessionRun(
          state,
          input.previousRunId,
          input.runId,
          input.intent,
        )
        if (!replaced.accepted) return replaced
        // Like a replacement through Session Control: a promotion waiting for Pi to incorporate
        // its steer must complete into the Run it was promoted into, or the steered Follow-up
        // stays queued and is delivered again after the replacing Run.
        if (
          state.run.state !== 'idle' &&
          (yield* reservedFollowUpIds(sql, input.sessionId)).size > 0
        ) {
          return { accepted: false, code: 'follow_up_reserved' } as const
        }
        if (state.run.state === 'idle') {
          const admission = yield* externalRunAdmission(sql, input)
          if (admission) return admission
        }
        const now = Date.now()
        if (state.run.state !== 'idle') {
          yield* sql`
            UPDATE session_runs SET status = ${'interrupted'}, updated_at = ${now}
            WHERE id = ${state.run.runId} AND session_id = ${input.sessionId}
          `
        }
        yield* persistSessionControlState(sql, replaced.state, now)
        return {
          accepted: true,
          stateRevision: replaced.state.revision,
          intent: input.intent,
        } as const
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('replace-with-external-run', cause),
      ),
    )
}
