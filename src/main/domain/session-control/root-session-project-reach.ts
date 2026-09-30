import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'

const PROFILE_CALLER_PREFIX = 'profile:'
const SESSION_AGENT_CALLER_PREFIX = 'session-agent:'
/** Hops through agents starting each other's Runs that reach and ceiling checks follow. */
export const MAX_RUN_INITIATOR_CHAIN_DEPTH = 8

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
 * Whether a root Session agent's own authority reaches every project (ADR 0040).
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
