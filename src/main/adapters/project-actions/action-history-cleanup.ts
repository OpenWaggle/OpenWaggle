import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { TerminalHistoryStore } from '../terminal/terminal-history-store'

/** The SQL delete queues cleanup transactionally; failed disk removal is retried on Host recovery. */
export function cleanupDeletedActionHistory(
  sql: SqlClient.SqlClient,
  history: Pick<TerminalHistoryStore, 'removeForOwner'>,
  reportFailure: (workspaceId: string, cause: unknown) => void,
) {
  return Effect.gen(function* () {
    const pending = yield* sql<{ readonly workspace_id: string }>`
      SELECT workspace_id FROM project_action_history_cleanup ORDER BY workspace_id
    `
    for (const row of pending) {
      yield* Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => history.removeForOwner(`action:${row.workspace_id}`),
          catch: (cause) =>
            new Error('Failed to remove deleted workspace action history.', { cause }),
        })
        yield* sql`DELETE FROM project_action_history_cleanup WHERE workspace_id = ${row.workspace_id}`
      }).pipe(Effect.catchAll((cause) => Effect.sync(() => reportFailure(row.workspace_id, cause))))
    }
  }).pipe(Effect.mapError((cause) => new Error('Action history cleanup failed.', { cause })))
}
