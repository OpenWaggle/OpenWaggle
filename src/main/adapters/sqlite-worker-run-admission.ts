import type * as SqlClient from '@effect/sql/SqlClient'
import type { SESSION_LIFECYCLE_OPERATIONS } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import {
  isPersonStartedRun,
  type StartingRunCaller,
} from '../domain/session-control/person-started-run'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

/** Why the Host would not start an agent-made Session's Run now. Both are retryable. */
export type WorkerRunAdmissionRefusal =
  | 'parent_concurrency_limit_reached'
  | 'host_run_ceiling_reached'

/**
 * SQL for the Sessions agents made: Workers some parent spawned, and roots recorded in
 * `session_agent_origins` (`recordAgentMadeSession`). The person's own Sessions are never among
 * them. Both are primary-key lookups.
 */
const AGENT_MADE_SESSION = `(
  EXISTS (
    SELECT 1 FROM session_spawn_lineage AS lineage
    WHERE lineage.child_session_id = states.session_id
  )
  OR EXISTS (
    SELECT 1 FROM session_agent_origins AS origins WHERE origins.session_id = states.session_id
  )
)`

/**
 * Records a root that an agent, a client profile or a Session agent's Scheduled task created,
 * launched or forked, in the transaction that makes it: its Runs then count toward Active Workers.
 * The person's root is not recorded, and a spawned Worker is known by its lineage.
 */
export function recordAgentMadeSession(
  sql: SqlClient.SqlClient,
  input: {
    readonly operation: (typeof SESSION_LIFECYCLE_OPERATIONS)[number]
    readonly sessionId: string
    readonly callerId: string
    readonly idempotencyKey: string
    readonly now: number
  },
) {
  if (input.operation === 'spawn' || isPersonStartedRun(input)) return Effect.void
  return sql`
    INSERT OR IGNORE INTO session_agent_origins (session_id, caller_id, created_at)
    VALUES (${input.sessionId}, ${input.callerId}, ${input.now})
  `.pipe(Effect.asVoid)
}

/**
 * Active Runs of agent-made Sessions across the Host: the Runs the Active Workers ceiling counts.
 * `exceptSessionId` leaves out the Session whose Run is being admitted.
 */
export function countActiveWorkerRuns(sql: SqlClient.SqlClient, exceptSessionId?: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM session_control_states AS states
      WHERE states.active_run_id IS NOT NULL
        AND states.session_id <> ${exceptSessionId ?? ''}
        AND ${sql.unsafe(AGENT_MADE_SESSION)}
    `
    return rows[0]?.count ?? 0
  })
}

/** Whether an agent made `sessionId` (see `AGENT_MADE_SESSION`). */
function isAgentMadeSession(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly agentMade: number }>`
      SELECT EXISTS (
        SELECT 1 FROM (SELECT ${sessionId} AS session_id) AS states
        WHERE ${sql.unsafe(AGENT_MADE_SESSION)}
      ) AS agentMade
    `
    return rows[0]?.agentMade === 1
  })
}

/** The Active Workers ceiling for one more agent-made Run, or undefined when there is room. */
export function hostWorkerCeilingRefusal(
  sql: SqlClient.SqlClient,
  input: { readonly exceptSessionId?: string; readonly hostRunCeiling: number },
) {
  return Effect.gen(function* () {
    const hostActiveRuns = yield* countActiveWorkerRuns(sql, input.exceptSessionId)
    return hostActiveRuns >= input.hostRunCeiling
      ? { code: 'host_run_ceiling_reached' as const, hostActiveRuns }
      : undefined
  })
}

/**
 * The capacity rule for a Run about to start in `sessionId`. Only an agent- or Host-started Run
 * of an agent-made Session is limited: a Worker's by its parent's Worker limit, then any by the
 * Host's Active Workers ceiling. The person's Sessions' Runs, and any Run the person starts, are
 * always admitted.
 */
export function workerRunAdmissionRefusal(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly caller: StartingRunCaller
    /** Read only when the ceiling applies; settlement reads the stored setting. */
    readonly hostRunCeiling: number | Effect.Effect<number, unknown>
  },
): Effect.Effect<WorkerRunAdmissionRefusal | undefined, unknown> {
  if (isPersonStartedRun(input.caller)) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    const parentAdmission = yield* directWorkerRunAdmission(sql, input.sessionId)
    const isWorker = 'parentSessionId' in parentAdmission
    if (isWorker && !parentAdmission.admitted) return 'parent_concurrency_limit_reached' as const
    // A root Session the person made: no capacity limit applies.
    if (!isWorker && !(yield* isAgentMadeSession(sql, input.sessionId))) return undefined
    const hostRunCeiling =
      typeof input.hostRunCeiling === 'number' ? input.hostRunCeiling : yield* input.hostRunCeiling
    const ceiling = yield* hostWorkerCeilingRefusal(sql, {
      exceptSessionId: input.sessionId,
      hostRunCeiling,
    })
    return ceiling?.code
  })
}
