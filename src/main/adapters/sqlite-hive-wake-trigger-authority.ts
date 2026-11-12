import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  type RunInitiatorWalk,
  type RunReference,
  type RunVerdictStep,
  walkRunInitiators,
} from '../application/run-initiator-walk'
import {
  durableSessionRunId,
  isLocalUserCallerId,
  isProfileCallerId,
  isTransientMcpCallerId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'

/**
 * The external clients behind a caller (CLI client profiles and transient-authority MCP clients):
 * itself, or whoever started the Runs it acts in.
 */
type Profiles = ReadonlySet<string>

function isExternalClientCallerId(callerId: string) {
  return isProfileCallerId(callerId) || isTransientMcpCallerId(callerId)
}

const NO_PROFILES: Profiles = new Set()
/** A caller or Run the Host cannot identify. No other Run can lift it. */
const UNKNOWN: Profiles = new Set(['\u0000unknown'])

function callerStep(callerId: string | null | undefined) {
  if (!callerId) {
    const step: RunVerdictStep<Profiles> = { verdict: UNKNOWN, followRuns: [] }
    return step
  }
  if (isLocalUserCallerId(callerId)) {
    const step: RunVerdictStep<Profiles> = { verdict: NO_PROFILES, followRuns: [] }
    return step
  }
  if (isExternalClientCallerId(callerId)) {
    const step: RunVerdictStep<Profiles> = { verdict: new Set([callerId]), followRuns: [] }
    return step
  }
  const agent = parseSessionAgentCallerId(callerId)
  const step: RunVerdictStep<Profiles> = agent
    ? { verdict: NO_PROFILES, followRuns: [agent] }
    : { verdict: UNKNOWN, followRuns: [] }
  return step
}

function runCallerId(sql: SqlClient.SqlClient, run: RunReference) {
  return sql<{ readonly caller_id: string | null }>`
    SELECT json_extract(intent_json, '$.callerId') AS caller_id FROM session_runs
    WHERE id = ${durableSessionRunId(run.runId)} AND session_id = ${run.sessionId}
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]?.caller_id))
}

function profilesWalk(sql: SqlClient.SqlClient) {
  return {
    step: (run) => runCallerId(sql, run).pipe(Effect.map(callerStep)),
    combine: (verdicts) =>
      verdicts.includes(UNKNOWN) ? UNKNOWN : new Set(verdicts.flatMap((profiles) => [...profiles])),
    failClosed: UNKNOWN,
  } satisfies RunInitiatorWalk<Profiles, unknown>
}

function callerProfiles(sql: SqlClient.SqlClient, callerId: string | null | undefined) {
  const step = callerStep(callerId)
  const [agentRun] = step.followRuns
  if (step.verdict === UNKNOWN || !agentRun) return Effect.succeed(step.verdict)
  return walkRunInitiators(profilesWalk(sql), agentRun)
}

/**
 * Whether a Worker change by `triggerCallerId` (a result, a request for help, or a Worker Run
 * that ended) may wake its idle parent. The wake acts as the caller of the parent's latest Run, so
 * a CLI client profile (or transient-authority MCP client) behind the change, directly or through
 * the Runs that led to it, must be behind that Run too. A profile that may only contribute to a Worker, or message it, must not
 * start Runs on the parent as someone else; a Hive the profile started still wakes its Queen.
 * Anything the Host cannot identify fails closed: the update then waits for the parent's next Run.
 */
export function workerChangeMayWakeParent(
  sql: SqlClient.SqlClient,
  input: { readonly parentSessionId: string; readonly triggerCallerId: string },
) {
  return Effect.gen(function* () {
    const trigger = yield* callerProfiles(sql, input.triggerCallerId)
    if (trigger === UNKNOWN) return false
    if (trigger.size === 0) return true
    const [latest] = yield* sql<{ readonly caller_id: string | null }>`
      SELECT json_extract(intent_json, '$.callerId') AS caller_id FROM session_runs
      WHERE session_id = ${input.parentSessionId}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
    const wake = yield* callerProfiles(sql, latest?.caller_id)
    if (wake === UNKNOWN) return false
    return [...trigger].every((profile) => wake.has(profile))
  }).pipe(Effect.orElseSucceed(() => false))
}

/**
 * Whether any update a wake would act on may wake the parent: one recorded before updates named
 * their cause counts as the Host's own, and any other must pass `workerChangeMayWakeParent`. An
 * update that cannot wake the parent still reaches its next Run.
 */
export function wakeCandidateMayWake(
  sql: SqlClient.SqlClient,
  candidate: {
    readonly parentSessionId: string
    readonly triggerCallerIds: readonly (string | null)[]
  },
) {
  return Effect.gen(function* () {
    if (candidate.triggerCallerIds.includes(null)) return true
    for (const triggerCallerId of new Set(candidate.triggerCallerIds)) {
      if (triggerCallerId === null) continue
      const parentSessionId = candidate.parentSessionId
      if (yield* workerChangeMayWakeParent(sql, { parentSessionId, triggerCallerId })) return true
    }
    return false
  })
}
