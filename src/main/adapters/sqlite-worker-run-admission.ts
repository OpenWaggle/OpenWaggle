import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { isScheduledTaskRunKey } from '../domain/scheduled-tasks/scheduled-task-run-key'
import { isLocalUserCallerId } from '../domain/session-control/root-session-project-reach'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

/** Why the Host would not start an agent's Run now. Both are retryable. */
export type WorkerRunAdmissionRefusal =
  | 'parent_concurrency_limit_reached'
  | 'host_run_ceiling_reached'

/** Who a Run acts for, as its intent records it, or who sent the request that starts it. */
export interface RunCaller {
  readonly callerId: string
  /** The request's key. A Scheduled task's firing is known by it (`scheduledTaskRunKey`). */
  readonly idempotencyKey?: string
  /** A Host-authored Hive wake: the Host acts, even when it acts for the person. */
  readonly hiveWake?: true
}

/**
 * Whether the person acts: from the app, the CLI or another local-user client. A Hive wake is the
 * Host acting, and a Scheduled task that an agent or a client profile created fires as its owner
 * but is that creator's work, so neither is the person (ADR 0030, amended 2026-11-09).
 */
export function isPersonCaller(sql: SqlClient.SqlClient, caller: RunCaller) {
  if (caller.hiveWake || !isLocalUserCallerId(caller.callerId)) return Effect.succeed(false)
  const { idempotencyKey } = caller
  if (!isScheduledTaskRunKey(idempotencyKey)) return Effect.succeed(true)
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly creator_kind: string }>`
      SELECT tasks.creator_kind
      FROM scheduled_task_runs AS task_runs
      JOIN scheduled_tasks AS tasks ON tasks.id = task_runs.task_id
      WHERE task_runs.idempotency_key = ${idempotencyKey}
      LIMIT 1
    `
    // A run whose task is gone is held to the agent's rule: the safe side for a resource limit.
    return rows[0]?.creator_kind === 'local-user'
  })
}

/** The caller a stored Run intent names; an intent without one reads as the person's. */
function intentCaller(intentJson: string | null): RunCaller | undefined {
  if (intentJson === null) return undefined
  const intent = parseJsonUnknown(intentJson)
  if (typeof intent !== 'object' || intent === null) return undefined
  const callerId = 'callerId' in intent ? intent.callerId : undefined
  if (typeof callerId !== 'string') return undefined
  const idempotencyKey = 'idempotencyKey' in intent ? intent.idempotencyKey : undefined
  return typeof idempotencyKey === 'string' ? { callerId, idempotencyKey } : { callerId }
}

/**
 * Whether agents made `sessionId`, so its Runs are agents' work the Worker limits apply to: a
 * Worker some parent spawned, or a root whose first Run an agent, a client profile or an agent's
 * Scheduled task started (by `launch`, or `create` and then a message). `firstRunCaller` stands in
 * for a Session with no Run yet. The person's own Sessions are never agent-made.
 */
export function isAgentMadeSession(
  sql: SqlClient.SqlClient,
  sessionId: string,
  firstRunCaller?: RunCaller,
) {
  return Effect.gen(function* () {
    const lineage = yield* sql<{ readonly found: number }>`
      SELECT 1 AS found FROM session_spawn_lineage WHERE child_session_id = ${sessionId} LIMIT 1
    `
    if (lineage.length > 0) return true
    const firstRuns = yield* sql<{ readonly intent_json: string | null }>`
      SELECT intent_json FROM session_runs
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `
    const first = firstRuns[0] ? intentCaller(firstRuns[0].intent_json) : firstRunCaller
    return first !== undefined && !(yield* isPersonCaller(sql, first))
  })
}

/**
 * Active Runs of agent-made Sessions across the Host: what the Active Workers ceiling counts.
 * The person's Sessions never use a slot. `exceptSessionId` leaves out the Session being admitted.
 */
export function countActiveWorkerRuns(sql: SqlClient.SqlClient, exceptSessionId?: string) {
  return Effect.gen(function* () {
    const active = yield* sql<{ readonly session_id: string }>`
      SELECT session_id FROM session_control_states
      WHERE active_run_id IS NOT NULL AND session_id <> ${exceptSessionId ?? ''}
    `
    let count = 0
    for (const { session_id: sessionId } of active) {
      if (yield* isAgentMadeSession(sql, sessionId)) count += 1
    }
    return count
  })
}

/**
 * The capacity rule for a Run about to start in `sessionId`, which acts for `runCaller` and is
 * started by a request from `requestCaller`. A Run is always admitted when the person sent that
 * request (a message, or a queue action such as Resume) or when it acts for the person, and in a
 * root Session the person made. Otherwise it is an agent's Run in an agent-made Session: a
 * Worker's waits for its parent's Worker limit, and any waits for the Active Workers ceiling.
 */
export function workerRunAdmissionRefusal(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly runCaller: RunCaller
    readonly requestCaller?: RunCaller
    readonly hostRunCeiling: number
  },
): Effect.Effect<WorkerRunAdmissionRefusal | undefined, unknown> {
  return Effect.gen(function* () {
    if (input.requestCaller && (yield* isPersonCaller(sql, input.requestCaller))) return undefined
    if (yield* isPersonCaller(sql, input.runCaller)) return undefined
    if (!(yield* isAgentMadeSession(sql, input.sessionId, input.runCaller))) return undefined
    const parentAdmission = yield* directWorkerRunAdmission(sql, input.sessionId)
    if (!parentAdmission.admitted) return 'parent_concurrency_limit_reached' as const
    const activeWorkerRuns = yield* countActiveWorkerRuns(sql, input.sessionId)
    return activeWorkerRuns >= input.hostRunCeiling
      ? ('host_run_ceiling_reached' as const)
      : undefined
  })
}
