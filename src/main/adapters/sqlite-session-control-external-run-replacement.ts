import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import type { SessionControlRunIntent } from '../domain/session-control/message-aggregate'
import { replaceWithExternalSessionRun } from '../domain/session-control/run-lifecycle'
import { SessionControlRepositoryError } from '../errors'
import type { SessionControlRunLifecycleRepositoryShape } from '../ports/session-control-run-lifecycle-repository'
import { loadSessionControlState, persistSessionControlState } from './sqlite-session-control-state'
import { reservedFollowUpIds } from './sqlite-session-follow-up-reservation'
import { workerRunAdmissionRefusal } from './sqlite-worker-run-admission'

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

/**
 * An external Run (an explicit Waggle command's Run) follows the same capacity rule as any other:
 * only agents' work can be refused, never the person's.
 */
export function externalRunAdmission(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: SessionId
    readonly intent: SessionControlRunIntent
    readonly hostRunCeiling?: number
  },
) {
  return Effect.gen(function* () {
    const { callerId, idempotencyKey, hiveWake } = input.intent
    const refusal = yield* workerRunAdmissionRefusal(sql, {
      sessionId: input.sessionId,
      runCaller: hiveWake ? { callerId, idempotencyKey, hiveWake } : { callerId, idempotencyKey },
      hostRunCeiling: input.hostRunCeiling ?? DEFAULT_SETTINGS.sessionHostRunCeiling,
    })
    return refusal ? ({ accepted: false, code: refusal } as const) : undefined
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
