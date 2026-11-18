import type { DelegationState } from '@shared/types/session-collaboration'
import { MCP_SETTLED_WORKER_IDLE_CLOSE_MS } from './adapters/mcp/pool/mcp-session-connection-pool-types'

/** Delegation states after which a Worker rarely runs again soon. */
const SETTLED_DELEGATION_STATES: ReadonlySet<DelegationState> = new Set([
  'ready_for_review',
  'accepted',
  'cancelled',
])

/**
 * The MCP idle close of a Session: a Worker whose Delegation is under review, accepted, or
 * cancelled closes its servers after a minute instead of the default five (D1.1).
 */
export function settledWorkerIdleCloseMs(state: DelegationState | null) {
  return state !== null && SETTLED_DELEGATION_STATES.has(state)
    ? MCP_SETTLED_WORKER_IDLE_CLOSE_MS
    : undefined
}

/** Where the idle policy reads a Worker's Delegation state: the Delegation repository's port. */
export type WorkerDelegationStateOf = (sessionId: string) => Promise<DelegationState | null>

/** The pool's idle policy over the Delegation repository (D1.1). */
export function settledWorkerIdleClosePolicy(delegationStateOf: WorkerDelegationStateOf) {
  return async (sessionId: string) => settledWorkerIdleCloseMs(await delegationStateOf(sessionId))
}
