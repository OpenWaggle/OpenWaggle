import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'

const PROFILE_CALLER_PREFIX = 'profile:'
const SESSION_AGENT_CALLER_PREFIX = 'session-agent:'
/**
 * Other Sessions that reach and ceiling checks follow through agents starting each other's Runs.
 * Counted by distinct Session, so two roots that keep answering each other with Follow-ups keep
 * their reach up to `MAX_RUN_INITIATOR_CHAIN_HOPS` Runs rather than losing it after four round trips.
 */
export const MAX_RUN_INITIATOR_CHAIN_DEPTH = 8
/** Runs a check follows at most, however few Sessions they belong to; beyond it, it fails closed. */
export const MAX_RUN_INITIATOR_CHAIN_HOPS = 256

/**
 * The Runs a reach or ceiling check has followed so far, and the verdicts it has already reached
 * for Runs, shared by every branch of one check: a Run with both an initiator and an author forks
 * the walk, and without the shared verdicts a chain of them would cost exponentially many reads.
 */
export interface RunInitiatorChain<Verdict> {
  readonly hops: number
  readonly sessionIds: ReadonlySet<string>
  readonly verdicts: Map<string, Verdict>
}

/** A fresh chain for one check. */
export function startRunInitiatorChain<Verdict>(): RunInitiatorChain<Verdict> {
  return { hops: 0, sessionIds: new Set(), verdicts: new Map() }
}

/** The key a chain records a Run's verdict under. */
export function runInitiatorVerdictKey(sessionId: string, runId: string) {
  return JSON.stringify([sessionId, durableSessionRunId(runId)])
}

/**
 * Follow one more Run, in `sessionId`. Returns undefined once the chain passes more than
 * `MAX_RUN_INITIATOR_CHAIN_DEPTH` other Sessions or `MAX_RUN_INITIATOR_CHAIN_HOPS` Runs, which the
 * caller treats as failing closed.
 */
export function followRunInitiatorChain<Verdict>(
  chain: RunInitiatorChain<Verdict>,
  sessionId: string,
): RunInitiatorChain<Verdict> | undefined {
  const sessionIds = chain.sessionIds.has(sessionId)
    ? chain.sessionIds
    : new Set([...chain.sessionIds, sessionId])
  if (chain.hops >= MAX_RUN_INITIATOR_CHAIN_HOPS) return undefined
  if (sessionIds.size > MAX_RUN_INITIATOR_CHAIN_DEPTH + 1) return undefined
  return { hops: chain.hops + 1, sessionIds, verdicts: chain.verdicts }
}

type ReachScope = Pick<LocalSessionProfileScope, 'all'>

/** The local desktop user: the GUI, or the `openwaggle` CLI authenticated as the local user. */
export function isLocalUserCallerId(callerId: string) {
  return (
    callerId === 'local-user' || callerId === 'gui:local-user' || callerId.startsWith('local-user:')
  )
}

export function isProfileCallerId(callerId: string) {
  return callerId.startsWith(PROFILE_CALLER_PREFIX)
}

/** The Session and Run of a `session-agent:<sessionId>:<runId>` caller, or undefined. */
export function parseSessionAgentCallerId(callerId: string) {
  if (!callerId.startsWith(SESSION_AGENT_CALLER_PREFIX)) return undefined
  const separator = callerId.lastIndexOf(':')
  if (separator <= SESSION_AGENT_CALLER_PREFIX.length) return undefined
  return {
    sessionId: callerId.slice(SESSION_AGENT_CALLER_PREFIX.length, separator),
    runId: callerId.slice(separator + 1),
  }
}

/**
 * Whether a root Session agent's own authority reaches every project (ADR 0042).
 *
 * Only a root qualifies, and only when its authority came from the local desktop user or from a
 * CLI profile whose live scope is catalog-wide. A stored authority snapshot narrower than the
 * whole catalog keeps it inside its own project. The origin is read from the caller id, never
 * inferred from missing data, so a transient MCP or unknown origin never qualifies.
 *
 * This is necessary but not sufficient: the Run must also have been started by a caller that
 * reaches every project (see `sessionAgentRunReachesEveryProject`), or a project-scoped caller
 * could drive a desktop Session into other projects.
 *
 * The Sessions tool (when the agent calls it) and queued Follow-up delivery (when a Follow-up it
 * sent is delivered later) both decide with this function, so the two cannot drift apart.
 */
export function rootSessionReachesEveryProject(input: {
  readonly isRoot: boolean
  readonly originCallerId: string
  readonly liveProfileScope?: ReachScope | undefined
  readonly snapshotScope?: ReachScope | undefined
}) {
  if (!input.isRoot) return false
  if (input.snapshotScope && input.snapshotScope.all !== true) return false
  if (isLocalUserCallerId(input.originCallerId)) return true
  if (isProfileCallerId(input.originCallerId)) return input.liveProfileScope?.all === true
  return false
}

const REQUESTED_WAGGLE_RUN_PREFIX = 'waggle-of-'

/**
 * The Run id of the Waggle an agent requests from a classic Run. It has no `session_runs` row of
 * its own; reach and ceiling checks read the classic Run it names instead.
 */
export function requestedWaggleRunId(classicRunId: string) {
  return `${REQUESTED_WAGGLE_RUN_PREFIX}${classicRunId}`
}

/** The classic Run a requested Waggle's Run id names, or undefined for any other Run id. */
export function requestedWaggleClassicRunId(runId: string) {
  return runId.startsWith(REQUESTED_WAGGLE_RUN_PREFIX)
    ? runId.slice(REQUESTED_WAGGLE_RUN_PREFIX.length)
    : undefined
}

/**
 * The `session_runs` row that stands for a Run: the classic Run behind a requested Waggle, or
 * the Run itself. Checks that need a durable Run (reach, ceiling, report source, spawn parent)
 * read this row.
 */
export function durableSessionRunId(runId: string) {
  return requestedWaggleClassicRunId(runId) ?? runId
}
