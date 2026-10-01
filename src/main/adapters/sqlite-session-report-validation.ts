import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { durableSessionRunId } from '../domain/session-control/root-session-project-reach'
import type { ExecuteSessionReportInput } from '../ports/session-report-repository'

/**
 * The durable Run a report records as its source. A requested Waggle has no `session_runs` row
 * of its own, so its reports name the classic Run it acts for.
 */
export function reportSourceRunId(input: ExecuteSessionReportInput) {
  const sourceRunId = input.request.command.sourceRunId
  return sourceRunId ? durableSessionRunId(sourceRunId) : null
}

export function sourceRunAuthorized(
  sql: SqlClient.SqlClient,
  input: ExecuteSessionReportInput,
  sourceSessionId: string,
) {
  const sourceRunId = input.request.command.sourceRunId
  if (!sourceRunId) return Effect.succeed(true)
  if (input.callerId !== `session-agent:${sourceSessionId}:${sourceRunId}`) {
    return Effect.succeed(false)
  }
  return Effect.gen(function* () {
    const sourceRuns = yield* sql<{ readonly id: string }>`
      SELECT id FROM session_runs
      WHERE id = ${durableSessionRunId(sourceRunId)} AND session_id = ${sourceSessionId}
      LIMIT 1
    `
    return sourceRuns[0] !== undefined
  })
}

export function resolveReportCorrelationId(
  sql: SqlClient.SqlClient,
  input: ExecuteSessionReportInput,
  targetIds: readonly string[],
) {
  const replyTo = input.request.command.input.replyToReportId
  if (!replyTo) return Effect.succeed({ valid: true as const, correlationId: input.correlationId })
  return Effect.gen(function* () {
    const replied = yield* sql<{ correlation_id: string; source_session_id: string }>`
      SELECT correlation_id, source_session_id FROM cross_session_reports WHERE id = ${replyTo}
    `
    const row = replied[0]
    return row && targetIds.includes(row.source_session_id)
      ? { valid: true as const, correlationId: row.correlation_id }
      : { valid: false as const }
  })
}
