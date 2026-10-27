import * as SqlClient from '@effect/sql/SqlClient'
import type { DelegationState } from '@shared/types/session-collaboration'
import * as Effect from 'effect/Effect'
import { MCP_SETTLED_WORKER_IDLE_CLOSE_MS } from './adapters/mcp/pool/mcp-session-connection-pool-types'

/** Delegation states after which a Worker rarely runs again soon. */
const SETTLED_DELEGATION_STATES: ReadonlySet<DelegationState> = new Set([
  'ready_for_review',
  'accepted',
  'cancelled',
])

/** The Delegation state of the Worker Session, or null for a Session that is not a Worker. */
export function workerDelegationState(sessionId: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly state: DelegationState }>`
      SELECT state FROM delegation_contracts WHERE child_session_id = ${sessionId} LIMIT 1
    `
    return rows[0]?.state ?? null
  })
}

/**
 * The MCP idle close of a Session: a Worker whose Delegation is under review, accepted, or
 * cancelled closes its servers after a minute instead of the default five (D1.1).
 */
export function settledWorkerIdleCloseMs(state: DelegationState | null) {
  return state !== null && SETTLED_DELEGATION_STATES.has(state)
    ? MCP_SETTLED_WORKER_IDLE_CLOSE_MS
    : undefined
}
