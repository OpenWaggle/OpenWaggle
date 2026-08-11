import type { McpEffectiveState, McpIntegrationState, McpScopeResolution } from '@shared/types/mcp'

/**
 * An MCP turn that is currently in flight for a session. While a turn is active
 * it keeps its immutable snapshot revision, so the resolved integration state
 * can report "pending" until the turn settles.
 */
export interface ActiveMcpTurn {
  readonly applied: McpEffectiveState
  readonly revision: string | null
}

/** Derive the active-turn record for a turn that began at the given revision. */
export function activeMcpTurnFromRevision(revision: string | null): ActiveMcpTurn {
  return { applied: revision ? 'on' : 'off', revision }
}

/**
 * Pure resolution of the integration state for a session, given the session's
 * currently active turn (if any). No global/mutable state: callers supply the
 * active turn they read from {@link McpTurnStateService} (or a tracker).
 */
export function resolveMcpIntegrationState(
  active: ActiveMcpTurn | undefined,
  input: {
    readonly desired: McpScopeResolution
    readonly desiredRevision: string | null
  },
): McpIntegrationState {
  if (!active) {
    return { desired: input.desired, applied: input.desired.effective, applyState: 'applied' }
  }
  const pending = active.revision !== input.desiredRevision
  return {
    desired: input.desired,
    applied: active.applied,
    applyState: pending ? 'pending' : 'applied',
    ...(pending
      ? { pendingReason: 'The active turn keeps its immutable MCP snapshot until it settles.' }
      : {}),
  }
}

/**
 * Synchronous in-memory tracker of active MCP turns.
 *
 * Each instance owns its own state (there is no module-global map), so it is
 * safe to use per runtime instance in tests and the CLI. The production Layer
 * graph instead shares a single {@link McpTurnStateService} across the config
 * and runtime adapters so the settings view observes in-flight turns.
 */
export interface McpTurnStateTracker {
  begin(sessionId: string, revision: string | null): void
  complete(sessionId: string): void
  clear(): void
  isActive(sessionId: string): boolean
  getActive(sessionId: string | null): ActiveMcpTurn | undefined
}

/** Create a fresh, isolated in-memory {@link McpTurnStateTracker}. */
export function createInMemoryMcpTurnStateTracker(): McpTurnStateTracker {
  const activeTurns = new Map<string, ActiveMcpTurn>()
  return {
    begin(sessionId, revision) {
      activeTurns.set(sessionId, activeMcpTurnFromRevision(revision))
    },
    complete(sessionId) {
      activeTurns.delete(sessionId)
    },
    clear() {
      activeTurns.clear()
    },
    isActive(sessionId) {
      return activeTurns.has(sessionId)
    },
    getActive(sessionId) {
      return sessionId ? activeTurns.get(sessionId) : undefined
    },
  }
}
