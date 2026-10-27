import * as SqlClient from '@effect/sql/SqlClient'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { run, runSql } from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import type { WakeCheckExecution } from '../../domain/scheduled-tasks/wake-check-decision'

export const QUIET: WakeCheckExecution = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: '',
  stderr: '',
  truncated: false,
}

/** Installs a fake Wake check runner and Authorization mode, and returns the recorded calls. */
export async function installHeartbeatHooks(input: {
  readonly executions: WakeCheckExecution[]
  readonly mode?: AgentAuthorizationMode
}) {
  const { installScheduledTaskHooks } = await import('../../application/scheduled-task-hooks')
  const commands: string[] = []
  const release = installScheduledTaskHooks({
    runWakeCheck: (request) =>
      Effect.sync(() => {
        commands.push(request.command)
        return input.executions.shift() ?? QUIET
      }),
    sessionAuthorizationMode: () => Effect.succeed(input.mode ?? 'yolo'),
  })
  return { commands, release }
}

/** The Session Run a dispatched firing started, as Session Control would have recorded it. */
export async function recordSessionRun(taskId: string, sessionId: string, runId: string) {
  const key = await runSql((sql) =>
    sql<{ readonly idempotency_key: string }>`
      SELECT idempotency_key FROM scheduled_task_runs
      WHERE task_id = ${taskId} AND status = 'started'
      ORDER BY fired_at DESC LIMIT 1
    `.pipe(Effect.map((rows) => rows[0]?.idempotency_key ?? '')),
  )
  await runSql((sql) =>
    Effect.gen(function* () {
      yield* sql`UPDATE scheduled_task_runs SET run_id = ${runId} WHERE idempotency_key = ${key}`
      yield* sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (${runId}, ${sessionId}, 'completed',
          ${JSON.stringify({ idempotencyKey: key, callerId: 'gui:local-user' })}, 0, 0)`
    }),
  )
}

export async function runProfile(sessionId: string, runId: string) {
  const { loadRunExecutionProfile } = await import(
    '../../adapters/session-control-run-executor-profile'
  )
  return run(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      loadRunExecutionProfile(sql, { sessionId: SessionId(sessionId), runId: RunId(runId) }),
    ),
  )
}

export async function settleRunEnd(
  sessionId: string,
  runId: string,
  toolUses: readonly { readonly name: string; readonly args: Record<string, unknown> }[],
) {
  const { settleHeartbeatRunOutcome } = await import(
    '../../application/scheduled-task-heartbeat-commands'
  )
  await run(settleHeartbeatRunOutcome({ sessionId, runId, completed: true, toolUses }))
}
