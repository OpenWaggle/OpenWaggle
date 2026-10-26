import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionControlReportTarget } from '@shared/types/session-collaboration'
import * as Effect from 'effect/Effect'

/**
 * Whether a report names a Session ID that does not exist, which answers `session_not_found`
 * like every other action (#351); an existing Session the caller cannot reach still answers
 * `target_not_authorized`.
 */
export function namesUnknownReportTarget(
  sql: SqlClient.SqlClient,
  target: SessionControlReportTarget,
) {
  const named =
    target.type === 'session'
      ? [target.sessionId]
      : target.type === 'sessions'
        ? target.sessionIds
        : []
  const sessionIds = [...new Set(named)]
  if (sessionIds.length === 0) return Effect.succeed(false)
  return sql<{ readonly id: string }>`
    SELECT id FROM sessions WHERE id IN ${sql.in(sessionIds)}
  `.pipe(Effect.map((rows) => rows.length < sessionIds.length))
}
