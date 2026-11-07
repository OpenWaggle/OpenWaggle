import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  durableSessionRunId,
  requestedWaggleRunId,
  sessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import { callerActsWithin } from './sqlite-hive-wake-trigger-authority'

const HOST_CAPTURED_SUBMITTER = 'session-host'

/**
 * Whether Worker Run `runId` may replace its Delegation's unreviewed result: it is a Hive wake
 * (the Worker's own Workers reported) that started no earlier than that result, and no result
 * came from it yet. A nested Queen's first "still waiting" answer must not be the last its parent
 * hears. Identity, not only time, decides "from it": a wake may start in the millisecond the
 * previous Run's result was captured. A Waggle the wake requested acts in the wake Run.
 *
 * `whileActive` is a submission from inside the Run: the Run must be the Worker's current one,
 * and it may replace any result. Otherwise the Run's reply is captured at settlement, and it
 * replaces only a result the Host captured the same way: a reply such as "my result is already
 * submitted" must not bury a result the Worker submitted with its evidence.
 *
 * A wake acts for whoever started the Worker's latest Run, so every CLI client profile or MCP
 * client behind it must be behind the result it replaces too: a profile that may only message the
 * Worker must not replace, through a wake, a result it could never change itself.
 */
export function wakeMayReplaceResult(
  sql: SqlClient.SqlClient,
  input: {
    readonly delegationId: string
    readonly workerSessionId: string
    readonly runId: string
    readonly whileActive: boolean
  },
) {
  const runId = durableSessionRunId(input.runId)
  const classicAgent = sessionAgentCallerId(input.workerSessionId, runId)
  const waggleAgent = sessionAgentCallerId(input.workerSessionId, requestedWaggleRunId(runId))
  return sql<{ readonly replaces: number }>`
    SELECT EXISTS (
      SELECT 1 FROM session_runs AS runs
      WHERE runs.id = ${runId}
        AND runs.session_id = ${input.workerSessionId}
        AND json_extract(runs.intent_json, '$.hiveWake') = 1
        AND (${input.whileActive ? 0 : 1} = 1 OR (
          runs.status IN (${'starting'}, ${'active'})
          AND runs.id = (
            SELECT latest.id FROM session_runs AS latest
            WHERE latest.session_id = ${input.workerSessionId}
            ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
          )
        ))
        AND (${input.whileActive ? 1 : 0} = 1 OR (
          SELECT latest.provenance FROM delegation_submissions AS latest
          WHERE latest.delegation_id = ${input.delegationId}
          ORDER BY latest.revision DESC LIMIT 1
        ) = ${'host-captured'})
        AND runs.created_at >= COALESCE((
          SELECT MAX(submissions.created_at) FROM delegation_submissions AS submissions
          WHERE submissions.delegation_id = ${input.delegationId}
        ), 0)
        AND NOT EXISTS (
          SELECT 1 FROM delegation_submissions AS own
          WHERE own.delegation_id = ${input.delegationId}
            AND (
              own.source_run_id = ${runId}
              OR own.submitted_by IN (${classicAgent}, ${waggleAgent})
            )
        )
    ) AS replaces
  `.pipe(
    Effect.flatMap((rows) =>
      rows[0]?.replaces === 1
        ? wakeActsWithinResult(sql, { ...input, runId })
        : Effect.succeed(false),
    ),
  )
}

/** Whether the clients behind wake Run `runId` are all behind the result it would replace. */
function wakeActsWithinResult(
  sql: SqlClient.SqlClient,
  input: {
    readonly delegationId: string
    readonly workerSessionId: string
    readonly runId: string
  },
) {
  return Effect.gen(function* () {
    const [latest] = yield* sql<{
      readonly submitted_by: string
      readonly source_run_id: string | null
    }>`
      SELECT submitted_by, source_run_id FROM delegation_submissions
      WHERE delegation_id = ${input.delegationId}
      ORDER BY revision DESC LIMIT 1
    `
    if (!latest) return true
    // A result the Host captured is caused by the Worker Run it captured it from.
    const ownerCallerId =
      latest.submitted_by === HOST_CAPTURED_SUBMITTER && latest.source_run_id
        ? sessionAgentCallerId(input.workerSessionId, latest.source_run_id)
        : latest.submitted_by
    return yield* callerActsWithin(sql, {
      actorCallerId: sessionAgentCallerId(input.workerSessionId, input.runId),
      ownerCallerId,
    })
  })
}
