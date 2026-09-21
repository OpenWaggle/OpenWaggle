import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { ExecuteSessionReportInput } from '../ports/session-report-repository'

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
      WHERE id = ${sourceRunId} AND session_id = ${sourceSessionId}
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
