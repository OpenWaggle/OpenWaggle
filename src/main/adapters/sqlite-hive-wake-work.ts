import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  type RunInitiatorWalk,
  type RunReference,
  type RunVerdictStep,
  walkRunInitiators,
} from '../application/run-initiator-walk'
import { isAgentsHiveWakeKey } from '../domain/session-control/hive-wake'
import {
  durableSessionRunId,
  isLocalUserCallerId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'

type Origin = 'hive' | 'outside'

function inHive(sql: SqlClient.SqlClient, parentSessionId: string, sessionId: string) {
  if (sessionId === parentSessionId) return Effect.succeed(true)
  return Effect.map(
    sql<{ readonly found: number }>`
      SELECT 1 AS found FROM session_spawn_lineage
      WHERE child_session_id = ${sessionId} AND hive_root_session_id = ${parentSessionId}
      LIMIT 1
    `,
    (rows) => rows.length > 0,
  )
}

function callerStep(callerId: string | null | undefined): RunVerdictStep<Origin> {
  if (callerId && isLocalUserCallerId(callerId)) return { verdict: 'hive', followRuns: [] }
  const agent = callerId ? parseSessionAgentCallerId(callerId) : undefined
  // A client profile, an MCP client, or a caller the Host cannot identify: from outside.
  return agent ? { verdict: 'hive', followRuns: [agent] } : { verdict: 'outside', followRuns: [] }
}

function originWalk(
  sql: SqlClient.SqlClient,
  parentSessionId: string,
): RunInitiatorWalk<Origin, unknown> {
  return {
    step: (run: RunReference) =>
      Effect.gen(function* () {
        if (!(yield* inHive(sql, parentSessionId, run.sessionId))) {
          return { verdict: 'outside', followRuns: [] } satisfies RunVerdictStep<Origin>
        }
        const [row] = yield* sql<{
          readonly caller_id: string | null
          readonly idempotency_key: string | null
        }>`
          SELECT json_extract(intent_json, '$.callerId') AS caller_id,
            json_extract(intent_json, '$.idempotencyKey') AS idempotency_key
          FROM session_runs
          WHERE id = ${durableSessionRunId(run.runId)} AND session_id = ${run.sessionId}
          LIMIT 1
        `
        // A nested Queen's wake that something outside caused passes that cause on.
        if (isAgentsHiveWakeKey(row?.idempotency_key ?? undefined)) {
          return { verdict: 'outside', followRuns: [] } satisfies RunVerdictStep<Origin>
        }
        return callerStep(row?.caller_id)
      }),
    combine: (verdicts) => (verdicts.includes('outside') ? 'outside' : 'hive'),
    failClosed: 'outside',
  }
}

/**
 * Whether anything outside a top-level Queen's own Hive caused the updates a wake would act on:
 * a Session agent from another Hive or Session, or a client, directly or through the Runs that
 * led to the change (an agent elsewhere messaging one of its Workers, say). The wake is then that
 * outside caller's work, held to the Worker limits and counted, though it acts for the Queen's
 * last caller (ADR 0030, amended 2026-11-09). A cause recorded before updates named one is the
 * Host's own. Anything the Host cannot follow counts as outside: the safe side for a limit.
 */
export function wakeCausedOutsideHive(
  sql: SqlClient.SqlClient,
  input: {
    readonly parentSessionId: string
    readonly triggerCallerIds: readonly (string | null)[]
  },
) {
  return Effect.gen(function* () {
    for (const triggerCallerId of new Set(input.triggerCallerIds)) {
      if (triggerCallerId === null) continue
      const step = callerStep(triggerCallerId)
      const [agentRun] = step.followRuns
      if (step.verdict === 'outside') return true
      if (!agentRun) continue
      const origin = yield* walkRunInitiators(originWalk(sql, input.parentSessionId), agentRun)
      if (origin === 'outside') return true
    }
    return false
  }).pipe(Effect.orElseSucceed(() => true))
}
