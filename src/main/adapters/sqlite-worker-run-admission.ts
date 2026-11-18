import type * as SqlClient from '@effect/sql/SqlClient'
import type { SESSION_LIFECYCLE_OPERATIONS } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import {
  isAgentWorkRun,
  isPersonStartedRun,
  type StartingRunCaller,
} from '../domain/session-control/person-started-run'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

/** Why the Host would not start a Run of agents' work now. Both are retryable. */
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
 * The active Runs the Active Workers ceiling counts across the Host: every Run of an agent-made
 * Session, and an agent's Run in a Session the person made (`session_runs.work_by_agent`, set by
 * `isAgentWorkRun` when it started). `exceptSessionId` leaves out the Session whose Run is being
 * admitted.
 */
export function countActiveWorkerRuns(sql: SqlClient.SqlClient, exceptSessionId?: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM session_control_states AS states
      LEFT JOIN session_runs AS runs ON runs.id = states.active_run_id
      WHERE states.active_run_id IS NOT NULL
        AND states.session_id <> ${exceptSessionId ?? ''}
        AND (runs.work_by_agent = 1 OR ${sql.unsafe(AGENT_MADE_SESSION)})
    `
    return rows[0]?.count ?? 0
  })
}

/**
 * Whether an agent made `sessionId` (see `AGENT_MADE_SESSION`): every Run there but the person's
 * is held to the Worker limits, a Hive wake included.
 */
export function isAgentMadeSession(sql: SqlClient.SqlClient, sessionId: string) {
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

/** The Active Workers ceiling for one more Run of agents' work, or undefined when there is room. */
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
 * The capacity rule for a Run about to start in `sessionId`. Any Run the person starts is always
 * admitted. Otherwise a Worker's Run meets its parent's Workers per parent, and then the Host's
 * Active Workers ceiling holds every agent-made Session's Run and an agent's Run in a Session the
 * person made (`isAgentWorkRun`). The Host's Hive wake of a Queen the person made is never limited.
 */
export function workerRunAdmissionRefusal(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly caller: StartingRunCaller
    /** Read only when the ceiling applies; settlement reads the stored setting. */
    readonly hostRunCeiling: number | Effect.Effect<number, unknown>
  },
) {
  if (isPersonStartedRun(input.caller)) {
    const effect: Effect.Effect<WorkerRunAdmissionRefusal | undefined, unknown> =
      Effect.succeed(undefined)
    return effect
  }
  const effect: Effect.Effect<WorkerRunAdmissionRefusal | undefined, unknown> = Effect.gen(
    function* () {
      const parentAdmission = yield* directWorkerRunAdmission(sql, input.sessionId)
      const isWorker = 'parentSessionId' in parentAdmission
      if (isWorker && !parentAdmission.admitted) return 'parent_concurrency_limit_reached' as const
      // A root Session the person made holds back only an agent's work, never the Host's wake of it.
      if (
        !isWorker &&
        !isAgentWorkRun(input.caller) &&
        !(yield* isAgentMadeSession(sql, input.sessionId))
      ) {
        return undefined
      }
      const hostRunCeiling =
        typeof input.hostRunCeiling === 'number'
          ? input.hostRunCeiling
          : yield* input.hostRunCeiling
      const ceiling = yield* hostWorkerCeilingRefusal(sql, {
        exceptSessionId: input.sessionId,
        hostRunCeiling,
      })
      return ceiling?.code
    },
  )
  return effect
}
