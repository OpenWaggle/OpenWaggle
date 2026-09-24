import type * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownExactOrThrow, parseJsonUnknown } from '@shared/schema'
import { actionRunSchema } from '@shared/schemas/action-runs'
import type { ActionRun } from '@shared/types/action-runs'
import * as Effect from 'effect/Effect'
import type { ActionRunPersistence } from './action-run-persistence'

interface ActionRunRow {
  readonly record_json: string
}
const RECENT_TERMINAL_RUN_LIMIT = 50
const decodeRun = (row: ActionRunRow): ActionRun =>
  decodeUnknownExactOrThrow(actionRunSchema, parseJsonUnknown(row.record_json))

export function createSqliteActionRunPersistence(sql: SqlClient.SqlClient): ActionRunPersistence {
  return {
    get: (id) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const rows =
            yield* sql<ActionRunRow>`SELECT record_json FROM project_action_runs WHERE id = ${id}`
          return rows[0] ? decodeRun(rows[0]) : null
        }),
      ),
    list: (workspaceId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const rows = yield* sql<ActionRunRow>`SELECT record_json FROM (
              SELECT record_json, started_at, id FROM project_action_runs
              WHERE workspace_id = ${workspaceId} AND status IN ('starting', 'running', 'stopping')
              UNION ALL
              SELECT record_json, started_at, id FROM (
                SELECT record_json, started_at, id FROM project_action_runs
                WHERE workspace_id = ${workspaceId} AND status NOT IN ('starting', 'running', 'stopping')
                ORDER BY started_at DESC, id DESC LIMIT ${RECENT_TERMINAL_RUN_LIMIT}
              )
            ) ORDER BY started_at DESC, id DESC`
          return rows.map(decodeRun)
        }),
      ),
    findRequest: (workspaceId, actionId, requestId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const rows =
            yield* sql<ActionRunRow>`SELECT runs.record_json FROM project_action_run_requests requests
        JOIN project_action_runs runs ON runs.id = requests.run_id
        WHERE requests.workspace_id = ${workspaceId} AND requests.action_id = ${actionId} AND requests.request_id = ${requestId}`
          return rows[0] ? decodeRun(rows[0]) : null
        }),
      ),
    recordRequest: (workspaceId, actionId, requestId, runId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* sql`INSERT INTO project_action_run_requests (workspace_id, action_id, request_id, run_id)
        VALUES (${workspaceId}, ${actionId}, ${requestId}, ${runId})
        ON CONFLICT(workspace_id, action_id, request_id) DO NOTHING`
          const rows = yield* sql<{
            readonly run_id: string
          }>`SELECT run_id FROM project_action_run_requests
        WHERE workspace_id = ${workspaceId} AND action_id = ${actionId} AND request_id = ${requestId}`
          if (rows[0]?.run_id !== runId)
            return yield* Effect.fail(
              new Error('Action request identity already belongs to another run.'),
            )
        }),
      ),
    save: (input) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const run = decodeUnknownExactOrThrow(actionRunSchema, input)
          yield* sql`INSERT INTO project_action_runs (id, workspace_id, action_id, status, started_at, record_json)
        VALUES (${run.id}, ${run.workspaceId}, ${run.action.id}, ${run.status}, ${run.startedAt}, ${JSON.stringify(run)})
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, record_json = excluded.record_json`
        }),
      ),
    interruptAfterHostLoss: () =>
      Effect.runPromise(
        sql.withTransaction(
          Effect.gen(function* () {
            const rows =
              yield* sql<ActionRunRow>`SELECT record_json FROM project_action_runs WHERE status IN ('starting', 'running', 'stopping')`
            for (const row of rows) {
              const run: ActionRun = {
                ...decodeRun(row),
                status: 'interrupted',
                finishedAt: Date.now(),
                ready: false,
                error: 'The action’s owning Host stopped. Restart explicitly to run it again.',
              }
              yield* sql`UPDATE project_action_runs SET status = ${run.status}, record_json = ${JSON.stringify(run)} WHERE id = ${run.id}`
            }
          }),
        ),
      ),
  }
}
